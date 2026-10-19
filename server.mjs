#!/usr/bin/env node
// Claude Office — un bureau où chaque session Claude Code est un employé.
// Point d'entrée : routes HTTP. La logique vit dans lib/, l'interface dans public/.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PORT, DIRECT_PORT, PF_PORT, HOST, TOKEN, PUBLIC_DIR, REFRESH_MS, VERSION, ROOT } from './lib/config.mjs';
import { expandHome } from './lib/text.mjs';
import { getSnapshot, refresh, addClient, pingClients } from './lib/snapshot.mjs';
import { dismiss } from './lib/dismissed.mjs';
import { getAsk, waitForAnswer, hookAnswer, addRelay } from './lib/live-asks.mjs';
import { startWorker, restartWorker, sendToWorker, isRunning, isBusy, workerMode, stopWorker, pickFolder } from './lib/workers.mjs';
import { saveFiles, withFiles } from './lib/uploads.mjs';
import { notePermission } from './lib/permissions.mjs';
import { openChannel, hasChannel, sessionForChannel, sendViaChannel, answerViaChannel, pingChannels } from './lib/channels.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

async function readJson(req) {
  let body = '';
  for await (const c of req) { body += c; if (body.length > 160e6) throw new Error('trop gros'); } // fichiers joints en base64
  return JSON.parse(body || '{}');
}

async function serveStatic(pathname, res) {
  const file = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !TYPES[path.extname(file)]) return false;
  let body;
  try { body = await fsp.readFile(file, 'utf8'); } catch { return false; }
  if (file.endsWith('index.html')) body = body.replace('__TOKEN__', TOKEN);
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)], 'cache-control': 'no-store' });
  res.end(body);
  return true;
}

// POST /api/* : actions déclenchées depuis la page (token exigé)
const api = {
  async hire(body) {
    const cwd = expandHome(body.cwd);
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return [400, { error: `dossier introuvable : ${cwd}` }];
    if (!body.task?.trim()) return [400, { error: 'il faut une mission' }];
    startWorker({ cwd, mode: body.mode, messages: [withFiles(body.task, saveFiles(body.files))] });
    return [200, { ok: true }];
  },
  async message(body) {
    const a = getSnapshot().agents.find((x) => x.id === body.id && !x.parent);
    if (!a) return [404, { error: 'employé introuvable' }];
    if (!body.text?.trim()) return [400, { error: 'message vide' }];
    // session de terminal reliée par le channel : le message arrive dans le terminal, comme si tu l'avais tapé
    if (a.channel && sendViaChannel(a.id, withFiles(body.text, saveFiles(body.files)))) return [200, { status: 'channel' }];
    const mode = body.mode || '';
    if (isRunning(a.id)) {
      // agent piloté par le bureau : on lui écrit directement ; s'il travaille, il le lira juste après
      if (workerMode(a.id) === mode) {
        const busy = isBusy(a.id);
        sendToWorker(a.id, withFiles(body.text, saveFiles(body.files)));
        return [200, { status: busy ? 'next' : 'sent' }];
      }
      // autre niveau d'autorisation : il faut le relancer, donc attendre qu'il ait fini
      if (isBusy(a.id)) return [409, { error: 'il travaille encore avec les anciennes autorisations : attends qu\'il ait fini, ou arrête-le (Stop)' }];
      restartWorker(a.id, { cwd: a.cwd, mode, messages: [withFiles(body.text, saveFiles(body.files))] });
      return [200, { status: 'restarted' }];
    }
    // Session ouverte dans un terminal : la reprendre ici lancerait une 2e copie en parallèle du terminal.
    // On ne le fait que sur demande explicite (terminal fermé).
    if (a.origin === 'terminal' && !body.takeover) return [409, { error: 'terminal', terminal: true }];
    startWorker({ cwd: a.cwd, resume: a.id, mode, messages: [withFiles(body.text, saveFiles(body.files))] });
    return [200, { status: 'sent' }];
  },
  async 'pick-folder'(body) {
    const start = body.start ? expandHome(body.start) : path.join(os.homedir(), 'Desktop');
    return [200, await pickFolder(fs.existsSync(start) ? start : os.homedir())];
  },
  async answer(body) {
    const ask = getAsk(body.id);
    if (!ask) return [404, { error: 'question expirée : réponds dans le terminal' }];
    if (ask.kind === 'relay' && body.release) return [400, { error: 'elle est déjà affichée dans le terminal' }];
    ask.settle(body.release ? null : hookAnswer(ask, body));
    return [200, { ok: true }];
  },
  async fire(body) {
    if (!stopWorker(body.id)) return [404, { error: 'aucun process lancé par le bureau pour cet agent' }];
    return [200, { ok: true }];
  },
  async dismiss(body) {
    const { agents } = getSnapshot();
    const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).filter((id) => agents.some((a) => a.id === id));
    if (!ids.length) return [404, { error: 'personne à virer' }];
    for (const id of ids) stopWorker(id); // lancé par le bureau : on l'arrête vraiment
    // ses stagiaires partent avec lui
    dismiss([...ids, ...agents.filter((a) => ids.includes(a.parent)).map((a) => a.id)]);
    await refresh();
    return [200, { ok: true, count: ids.length }];
  },
};

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

  if (req.method === 'GET') {
    if (url.pathname === '/events') return addClient(req, res);
    // utilisé par scripts/ensure-server.mjs : relancer si une autre version tourne, mais jamais en plein travail
    if (url.pathname === '/health') return send(200, { ok: true, version: VERSION, root: ROOT, pid: process.pid, busy: getSnapshot().agents.some((a) => a.busy) });
    if (await serveStatic(url.pathname, res)) return;
  }

  // hook Notification : une session attend ta permission
  if (req.method === 'POST' && url.pathname === '/hook/notify') {
    if (req.headers['x-office-hook'] !== '1') return send(403, { error: 'réservé au hook' });
    try { notePermission(await readJson(req)); refresh(); } catch {}
    res.writeHead(204); return res.end();
  }

  // hook PermissionRequest : une action attend ton accord ; même principe que /hook/ask
  if (req.method === 'POST' && url.pathname === '/hook/permission') {
    if (req.headers['x-office-hook'] !== '1') return send(403, { error: 'réservé au hook' });
    let input;
    try { input = await readJson(req); } catch { res.writeHead(204); return res.end(); }
    // questions et plans passent déjà par /hook/ask
    if (/^(AskUserQuestion|ExitPlanMode)$/.test(input.tool_name || '')) { res.writeHead(204); return res.end(); }
    // session reliée par le channel : on laisse la demande s'afficher dans le terminal, le channel la relaie au bureau
    if (hasChannel(input.session_id)) { res.writeHead(204); return res.end(); }
    const result = await waitForAnswer(input, req, 'permission');
    if (!result) { res.writeHead(204); return res.end(); }
    return send(200, result);
  }

  // channel « office » (channel/office-channel.mjs) : flux d'ordres vers la session, et autorisations relayées
  if (url.pathname === '/channel/stream' && req.method === 'GET') {
    if (req.headers['x-office-token'] !== TOKEN) return send(403, { error: 'token invalide' });
    openChannel(req, res, { cwd: url.searchParams.get('cwd') || '', pid: Number(url.searchParams.get('pid')) || 0 });
    return refresh();
  }
  if (url.pathname === '/channel/permission' && req.method === 'POST') {
    if (req.headers['x-office-token'] !== TOKEN) return send(403, { error: 'token invalide' });
    const p = await readJson(req).catch(() => ({}));
    const sessionId = sessionForChannel({ pid: Number(p.pid) || 0, cwd: p.cwd });
    if (sessionId && p.request_id) {
      addRelay({
        requestId: p.request_id, sessionId, tool: p.tool_name || '?', what: String(p.input_preview || '').slice(0, 2000), why: String(p.description || '').slice(0, 200),
        onAnswer: (behavior) => answerViaChannel(sessionId, p.request_id, behavior),
      });
    }
    res.writeHead(204); return res.end();
  }

  if (req.method === 'POST' && url.pathname === '/hook/ask') {
    // en-tête exigé : un navigateur ne peut pas l'envoyer depuis un autre site sans pré-requête CORS (refusée)
    if (req.headers['x-office-hook'] !== '1') return send(403, { error: 'réservé au hook' });
    let input;
    try { input = await readJson(req); } catch { res.writeHead(204); return res.end(); }
    const result = await waitForAnswer(input, req);
    if (!result) { res.writeHead(204); return res.end(); } // pas de réponse : le terminal reprend la main
    return send(200, result);
  }

  const action = req.method === 'POST' && url.pathname.startsWith('/api/') && api[url.pathname.slice(5)];
  if (action) {
    if (req.headers['x-office-token'] !== TOKEN) return send(403, { error: 'token invalide' });
    try { return send(...await action(await readJson(req))); }
    catch (e) { return send(400, { error: e.message }); }
  }

  res.writeHead(404); res.end();
}

// Si HOST écoute plus large que la boucle locale, on coupe tout ce qui ne vient pas de cette machine.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const server = http.createServer(handler);
const direct = http.createServer(handler);
const redirected = http.createServer(handler);
for (const srv of [server, direct, redirected]) srv.on('connection', (sock) => { if (!LOOPBACK.has(sock.remoteAddress)) sock.destroy(); });

direct.listen(DIRECT_PORT, HOST);
redirected.listen(PF_PORT, HOST);
server.listen(PORT, HOST, () => {
  console.log(`🏢 Claude Office ouvert sur http://localhost:${PORT}`);
  refresh();
  setInterval(refresh, REFRESH_MS);
  setInterval(() => { pingClients(); pingChannels(); }, 20_000);
});
