// Questions et autorisations en direct :
// - hook PreToolUse (AskUserQuestion / ExitPlanMode) : une question ou un plan à valider ;
// - hook PermissionRequest : une action qui a besoin de ton accord.
// Le hook envoie la demande et attend : on garde sa requête ouverte jusqu'à ta réponse depuis le bureau,
// ou jusqu'au délai, après quoi la demande repart dans le terminal comme d'habitude.

import crypto from 'node:crypto';
import { ASK_WAIT_MS } from './config.mjs';
import { cut, clip } from './text.mjs';

const liveAsks = new Map(); // id -> { id, kind ('question' | 'permission'), sessionId, tool, input, ts, deadline, settle }
const listeners = new Set();
const changed = () => { for (const fn of listeners) fn(); };

export const onAsksChange = (fn) => listeners.add(fn);
export const getAsk = (id) => liveAsks.get(id);

// garde seulement ce qu'il faut pour afficher la question (pas les aperçus volumineux)
export function askQuestions(input) {
  return (Array.isArray(input?.questions) ? input.questions : []).slice(0, 4).map((q) => ({
    question: cut(q.question, 400),
    header: cut(q.header, 30),
    multiSelect: !!q.multiSelect,
    options: (Array.isArray(q.options) ? q.options : []).slice(0, 6).map((o) => ({ label: cut(o.label, 80), description: cut(o.description, 240) })),
  }));
}

// ce qu'on montre d'une demande d'autorisation : l'outil et l'action précise (commande, fichier, adresse…)
function describePermission(tool, input = {}) {
  if (tool === 'Bash') return { what: clip(input.command, 2000), why: cut(input.description, 160) };
  if (input.file_path) return { what: input.file_path, why: '' };
  if (input.url) return { what: input.url, why: cut(input.prompt, 160) };
  return { what: clip(JSON.stringify(input, null, 2), 1500), why: '' };
}

export function publicAsks() {
  return [...liveAsks.values()].map((a) => {
    const common = { id: a.id, sessionId: a.sessionId, ts: a.ts, deadline: a.deadline, live: true };
    if (a.kind === 'permission') return { ...common, type: 'permission', tool: a.tool, ...describePermission(a.tool, a.input) };
    if (a.kind === 'relay') return { ...common, type: 'permission', relay: true, tool: a.tool, what: a.what, why: a.why };
    return a.tool === 'ExitPlanMode'
      ? { ...common, type: 'plan', plan: String(a.input?.plan || '').slice(0, 6000) }
      : { ...common, type: 'questions', questions: askQuestions(a.input) };
  });
}

// résout avec la sortie du hook, ou null pour rendre la main au terminal
export function waitForAnswer(input, req, kind = 'question') {
  return new Promise((resolve) => {
    const id = `${kind}:${input.tool_use_id || crypto.randomUUID()}`;
    const settle = (out) => {
      if (!liveAsks.has(id)) return;
      liveAsks.delete(id);
      clearTimeout(timer);
      resolve(out);
      changed();
    };
    const timer = setTimeout(() => settle(null), ASK_WAIT_MS);
    liveAsks.set(id, { id, kind, sessionId: input.session_id, tool: input.tool_name, input: input.tool_input || {}, ts: Date.now(), deadline: Date.now() + ASK_WAIT_MS, settle });
    req.on('close', () => settle(null)); // session interrompue (Échap) : on oublie la question
    changed();
  });
}

// Autorisation relayée par le channel : affichée aussi dans le terminal, la première réponse l'emporte.
// Pas de hook qui attend ici : la réponse du bureau repart par le channel (onAnswer).
export function addRelay({ requestId, sessionId, tool, what, why, onAnswer }) {
  const id = `relay:${requestId}`;
  const settle = (out) => {
    if (!liveAsks.has(id)) return;
    liveAsks.delete(id);
    clearTimeout(timer);
    if (out) onAnswer(out.behavior);
    changed();
  };
  const timer = setTimeout(() => settle(null), 30 * 60_000);
  liveAsks.set(id, { id, kind: 'relay', sessionId, tool, what, why, input: {}, ts: Date.now(), deadline: null, settle });
  changed();
}

// une autorisation relayée réglée dans le terminal : on la retire quand la session reprend après elle
export function dropStaleRelays(agents) {
  for (const a of [...liveAsks.values()]) {
    if (a.kind !== 'relay') continue;
    const s = agents.find((x) => x.id === a.sessionId);
    if (!s || Date.now() - s.age * 1000 > a.ts + 3000) a.settle(null);
  }
}

// réponse au format attendu par Claude Code : PermissionRequest pour une autorisation, PreToolUse sinon
export function hookAnswer(ask, body) {
  if (ask.kind === 'relay') return { behavior: body.decision === 'allow' ? 'allow' : 'deny' };
  if (ask.kind === 'permission') {
    const decision = body.decision === 'allow'
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: String(body.reason || '').trim() || 'Refusé depuis Claude Office.' };
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
  }
  const out = (o) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...o } });
  if (ask.tool === 'ExitPlanMode') {
    if (body.decision === 'approve') return out({ permissionDecision: 'allow', updatedInput: ask.input });
    return out({ permissionDecision: 'deny', permissionDecisionReason: String(body.reason || '').trim() || 'Plan refusé depuis Claude Office.' });
  }
  const questions = Array.isArray(ask.input.questions) ? ask.input.questions : [];
  const answers = {};
  for (const q of questions) {
    const a = body.answers?.[q.question];
    if (Array.isArray(a) ? !a.length : !String(a ?? '').trim()) throw new Error(`pas de réponse à « ${cut(q.question, 60)} »`);
    answers[q.question] = Array.isArray(a) ? a.map(String).join(', ') : String(a).trim(); // multi-choix : labels séparés par des virgules
  }
  return out({ permissionDecision: 'allow', updatedInput: { ...ask.input, answers } });
}
