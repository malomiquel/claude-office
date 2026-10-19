// Lecture des transcripts Claude Code (~/.claude/projects/<projet>/<session>.jsonl et leurs sous-agents)
// et traduction de la fin de chaque transcript en « employé » : état, activité, historique.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { PROJECTS_DIR, WINDOW_MIN } from './config.mjs';
import { base, cut, clip, host } from './text.mjs';
import { askQuestions } from './live-asks.mjs';
import { isHired, isRunning, isBusy } from './workers.mjs';
import { permissionWait } from './permissions.mjs';

const titleCache = new Map(); // fichier -> titre (premier prompt)
const metaCache = new Map(); // fichier -> .meta.json du sous-agent

export async function listTranscripts() {
  const out = [];
  const cutoff = Date.now() - WINDOW_MIN * 60_000;
  let projects = [];
  try { projects = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true }); } catch { return out; }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const dir = path.join(PROJECTS_DIR, p.name);
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        const file = path.join(dir, e.name);
        const st = await fsp.stat(file).catch(() => null);
        if (st && st.mtimeMs > cutoff) out.push({ file, mtime: st.mtimeMs, id: e.name.slice(0, -6), parent: null });
      } else if (e.isDirectory()) {
        // <session>/subagents/agent-*.jsonl : les sous-agents de cette session
        const subDir = path.join(dir, e.name, 'subagents');
        let subs = [];
        try { subs = await fsp.readdir(subDir); } catch { continue; }
        for (const s of subs) {
          if (!s.endsWith('.jsonl')) continue;
          const file = path.join(subDir, s);
          const st = await fsp.stat(file).catch(() => null);
          if (st && st.mtimeMs > cutoff) out.push({ file, mtime: st.mtimeMs, id: s.slice(0, -6), parent: e.name });
        }
      }
    }
  }
  return out;
}

async function readChunk(file, start, len) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally { await fh.close(); }
}

function parseLines(text, dropFirst) {
  const lines = text.split('\n');
  if (dropFirst) lines.shift();
  const out = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l)); } catch { /* ligne tronquée */ }
  }
  return out;
}

const isNoise = (s) => typeof s === 'string' && (/^\s*<(command-|local-command|system-reminder|task-notification|user-prompt-submit-hook)/.test(s) || /^This session is being continued/.test(s));

// contenu d'un message reçu par le channel « office » : <channel source="office" …>texte</channel>
// (source="plugin:<plugin>:office" quand le channel est chargé en plugin)
export function channelText(msg) {
  const c = typeof msg?.content === 'string' ? msg.content : '';
  const m = c.match(/^\s*<channel source="(?:plugin:[\w-]+:)?office"[^>]*>\n?([\s\S]*?)\n?<\/channel>\s*$/);
  return m ? m[1] : null;
}

function userText(msg) {
  const c = msg?.content;
  if (typeof c === 'string') return isNoise(c) ? null : c;
  if (Array.isArray(c)) {
    const t = c.filter((b) => b.type === 'text' && !isNoise(b.text)).map((b) => b.text).join('\n');
    return t || null;
  }
  return null;
}

async function firstPrompt(file) {
  if (titleCache.has(file)) return titleCache.get(file);
  let title = null;
  try {
    const recs = parseLines(await readChunk(file, 0, 256 * 1024), false);
    for (const r of recs) {
      if (r.type === 'user' && !r.isMeta) { title = userText(r.message); if (title) break; }
    }
  } catch {}
  titleCache.set(file, title);
  return title;
}

async function subMeta(file) {
  if (metaCache.has(file)) return metaCache.get(file);
  let meta = null;
  try { meta = JSON.parse(await fsp.readFile(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch {}
  metaCache.set(file, meta);
  return meta;
}

// texte complet pour les 4 derniers messages (le bilan qu'on veut lire) ; les plus anciens raccourcis pour alléger le flux
function slimLog(log) {
  let full = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.kind !== 'talk' && e.kind !== 'you') continue;
    if (++full > 4) log[i] = { ...e, text: clip(e.text, 600), short: e.text.length > 600 };
  }
  return log;
}

export function classifyTool(name, input = {}) {
  const n = name || '';
  if (/^(Read|Glob|Grep|LS|NotebookRead|ToolSearch|LSP)$/.test(n)) return { kind: 'read', text: `lit ${base(input.file_path || input.path) || cut(input.pattern || input.query, 40)}` };
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(n)) return { kind: 'code', text: `écrit ${base(input.file_path)}` };
  if (n === 'Bash') {
    // sans description, on montre la commande utile plutôt que le « cd … && » de tête
    const cmd = String(input.command || '').replace(/^\s*cd\s+\S+\s*&&\s*/, '');
    return { kind: 'terminal', text: `$ ${cut(input.description || cmd, 60)}` };
  }
  if (n === 'WebSearch') return { kind: 'web', text: `cherche « ${cut(input.query, 45)} »` };
  if (n === 'WebFetch') return { kind: 'web', text: `lit ${host(input.url) || 'une page web'}` };
  if (/chrome|browser|obscura|devtools/i.test(n)) {
    const target = host(input.url) || cut(input.action_summary || input.action || '', 40);
    return { kind: 'web', text: target ? `navigue : ${target}` : 'navigue sur le web' };
  }
  if (/^(Agent|Task|Workflow)$/.test(n)) return { kind: 'delegate', text: `délègue : ${cut(input.description || input.prompt, 50)}` };
  if (/^(TodoWrite|TaskCreate|TaskUpdate|EnterPlanMode)$/.test(n)) return { kind: 'plan', text: 'organise sa todo-list' };
  if (/^(AskUserQuestion|ExitPlanMode)$/.test(n)) return { kind: 'ask', text: 'te pose une question' };
  if (n === 'Skill') return { kind: 'read', text: `ouvre le manuel ${cut(input.skill, 30)}` };
  return { kind: 'tool', text: `utilise ${cut(n.replace(/^mcp__/, '').replace(/__/g, ' › '), 40)}` };
}

// États : working, waiting (a fini ou pose une question), blocked (attend ta permission), coffee (inactif),
// done (sous-agent qui a rendu son rapport)
export function deriveState({ isSub, age, last, lastStop, handedBack, interrupted, permission }) {
  let state, activity = last?.text || 's\'installe…', kind = last?.kind || 'think';
  const doneTalking = last?.kind === 'talk' && lastStop === 'end_turn';
  if (isSub) {
    // sous-agent : fini dès qu'il a rendu son rapport ; une commande longue en cours, c'est du travail
    if (handedBack || doneTalking || interrupted) state = 'done'; // interrompu (Échap) : il ne reprendra pas
    else if (age < 30 * 60) state = 'working';
    else state = 'coffee'; // abandonné
    if (state === 'working' && age >= 45 && last && !['talk', 'think'].includes(last.kind)) activity = `${activity} (en cours…)`;
  }
  else if (permission) { state = 'blocked'; activity = `attend ta permission : ${cut(permission.message.replace(/^Claude needs your permission to /i, ''), 50)}`; }
  else if (interrupted) state = age > 600 ? 'coffee' : 'waiting';
  else if (last?.kind === 'ask' && age > 5) state = 'waiting';
  else if (doneTalking) state = age > 600 ? 'coffee' : 'waiting';
  else if (age < 45) state = 'working';
  // action sans résultat : commande longue (CI, tests, build…) ; une vraie attente de permission arrive par le hook
  else if (last?.kind && !['talk', 'think'].includes(last.kind) && age < 900) { state = 'working'; activity = `${activity} (en cours…)`; }
  else state = 'coffee';
  if (state === 'waiting' && last?.kind !== 'ask') { kind = 'done'; activity = interrupted ? 'interrompu, attend tes ordres' : 'a fini, attend tes ordres'; }
  if (state === 'coffee') { kind = 'coffee'; activity = 'pause café'; }
  if (state === 'done') { kind = 'done'; activity = interrupted ? 'interrompu' : 'a rendu son rapport'; }
  return { state, kind, activity };
}

// Lecture incrémentale : chaque transcript est lu une fois en entier, puis seules les lignes ajoutées depuis
// sont lues à chaque refresh (pas de relecture de la fin d'un fichier de 100 Mo toutes les 1,5 s).
const LIVE_LOG = 60; // entrées gardées et envoyées dans le flux en direct
const CHUNK = 8 * 1024 * 1024;
const readers = new Map(); // fichier -> { offset, acc }

export const newAcc = () => ({
  cwd: null, model: null, last: null, lastStop: null, branch: null,
  handedBack: false, // un sous-agent termine en rendant son rapport via SubagentHandback
  interrupted: false, // dernier tour arrêté par l'utilisateur (Échap) : « [Request interrupted by user…] »
  pendingAsk: null, // question (AskUserQuestion / ExitPlanMode) encore sans réponse
  log: [], tokens: 0,
  // consommation cumulée de la session ; un message est écrit en plusieurs lignes (une par bloc) avec le même id
  // et un usage qui grossit : on remplace celui du message en cours au lieu de l'additionner
  used: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, usedMsg: null, usedLast: null,
  lastEventTs: 0, // dernier message user/assistant : sert à savoir si une permission a été réglée
  entrypoint: null, // « cli » = session interactive dans un terminal, « sdk-cli » = claude -p (bureau)
  everCli: false, // déjà ouverte au moins une fois dans un terminal
});

export function consume(acc, r) {
  const log = acc.log;
  if (r.cwd) acc.cwd = r.cwd;
  if (r.gitBranch) acc.branch = r.gitBranch;
  const ts = r.timestamp ? Date.parse(r.timestamp) : null;
  if ((r.type === 'user' || r.type === 'assistant') && ts) acc.lastEventTs = ts;
  if ((r.type === 'user' || r.type === 'assistant') && r.entrypoint) acc.entrypoint = r.entrypoint;
  if (r.entrypoint === 'cli') acc.everCli = true;
  if (r.type === 'user' && r.message) {
    const c = r.message.content;
    if (Array.isArray(c) && c.some((b) => b.type === 'tool_result')) {
      if (acc.pendingAsk && c.some((b) => b.tool_use_id === acc.pendingAsk.toolUseId)) acc.pendingAsk = null; // on y a répondu
      if (c.some((b) => b.type === 'tool_result' && b.is_error)) log.push({ ts, kind: 'error', text: 'oups, une erreur' });
      acc.last = { kind: 'think', text: 'réfléchit…', ts };
    } else if (r.isMeta && channelText(r.message)) {
      // message envoyé depuis le bureau par le channel : Claude Code l'enregistre en note système
      log.push({ ts, kind: 'you', via: 'bureau', text: clip(channelText(r.message), 20000) });
      acc.last = { kind: 'think', text: 'réfléchit…', ts }; acc.lastStop = null;
    } else if (!r.isMeta) {
      const txt = userText(r.message);
      if (txt && /^\[Request interrupted by user/.test(txt)) { acc.interrupted = true; log.push({ ts, kind: 'error', text: 'interrompu' }); }
      else if (txt) { log.push({ ts, kind: 'you', text: clip(txt, 20000) }); acc.last = { kind: 'think', text: 'réfléchit…', ts }; acc.lastStop = null; acc.interrupted = false; }
    }
  } else if (r.type === 'assistant' && r.message) {
    acc.model = r.message.model || acc.model;
    const u = r.message.usage;
    if (u) {
      acc.tokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
      addUsage(acc, r.message.id, u);
    }
    for (const b of r.message.content || []) {
      if (b.type === 'tool_use' && b.name === 'SubagentHandback') { acc.handedBack = true; log.push({ ts, kind: 'done', text: 'rend son rapport' }); }
      else if (b.type === 'tool_use') {
        const a = classifyTool(b.name, b.input); acc.last = { ...a, ts, tool: b.name }; log.push({ ts, ...a }); acc.handedBack = false; acc.interrupted = false;
        if (b.name === 'AskUserQuestion') acc.pendingAsk = { toolUseId: b.id, ts, type: 'questions', questions: askQuestions(b.input) };
        else if (b.name === 'ExitPlanMode') acc.pendingAsk = { toolUseId: b.id, ts, type: 'plan', plan: String(b.input?.plan || '').slice(0, 6000) };
      }
      else if (b.type === 'text' && b.text?.trim()) { acc.last = { kind: 'talk', text: cut(b.text, 90), ts }; log.push({ ts, kind: 'talk', text: clip(b.text, 20000) }); }
      else if (b.type === 'thinking') acc.last = { kind: 'think', text: 'réfléchit…', ts };
    }
    if (r.message.stop_reason) acc.lastStop = r.message.stop_reason;
  }
  if (log.length > LIVE_LOG * 2) acc.log = log.slice(-LIVE_LOG);
}

function addUsage(acc, id, u) {
  const cur = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 };
  const prev = id && id === acc.usedMsg ? acc.usedLast : null;
  for (const k in cur) acc.used[k] += cur[k] - (prev?.[k] || 0);
  acc.usedMsg = id;
  acc.usedLast = cur;
}

// lit ce qui a été ajouté depuis la dernière fois ; une ligne pas encore terminée attend le prochain passage
async function readNew(file, size) {
  let rd = readers.get(file);
  if (!rd || size < rd.offset) { rd = { offset: 0, acc: newAcc() }; readers.set(file, rd); } // nouveau ou réécrit
  while (rd.offset < size) {
    const len = Math.min(CHUNK, size - rd.offset);
    const text = await readChunk(file, rd.offset, len);
    const end = text.lastIndexOf('\n');
    if (end < 0) {
      if (len < CHUNK) break; // ligne en cours d'écriture
      rd.offset += Buffer.byteLength(text); continue; // ligne géante (image) : on la saute
    }
    const done = text.slice(0, end + 1);
    for (const r of parseLines(done, false)) consume(rd.acc, r);
    rd.offset += Buffer.byteLength(done);
  }
  return rd.acc;
}

// oublie les fichiers sortis de la fenêtre d'affichage
export function forgetOthers(files) {
  for (const f of readers.keys()) if (!files.has(f)) readers.delete(f);
}

export async function analyze(t) {
  const st = await fsp.stat(t.file);
  const acc = await readNew(t.file, st.size);
  const age = (Date.now() - st.mtimeMs) / 1000;
  const meta = t.parent ? await subMeta(t.file) : null;
  return {
    id: t.id,
    parent: t.parent,
    cwd: acc.cwd,
    project: base(acc.cwd) || 'nouvelle session',
    branch: acc.branch,
    title: cut(meta?.description || (await firstPrompt(t.file)) || 'Session', 120),
    agentType: meta?.agentType || null,
    model: acc.model,
    tokens: acc.tokens,
    used: { ...acc.used },
    ...deriveState({ isSub: !!t.parent, age, last: acc.last, lastStop: acc.lastStop, handedBack: acc.handedBack, interrupted: acc.interrupted, permission: t.parent ? null : permissionWait(t.id, acc.lastEventTs) }),
    age: Math.round(age),
    hired: isHired(t.id),
    origin: acc.entrypoint === 'cli' ? 'terminal' : 'bureau', // dernier message écrit depuis un terminal ou par le bureau
    headless: !acc.everCli, // jamais ouverte dans un terminal : claude -p (bureau ou automatisation)
    running: isRunning(t.id), // agent piloté par le bureau, process ouvert
    busy: isBusy(t.id), // … et en train de traiter un message
    ask: acc.pendingAsk,
    log: slimLog(acc.log.slice(-LIVE_LOG)),
  };
}
