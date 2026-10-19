// Sessions de terminal reliées au bureau par le channel « office » (channel/office-channel.mjs).
// Le channel donne le pid de son process Claude ; Claude Code écrit ~/.claude/sessions/<pid>.json avec l'id
// de la session de ce process (relu à chaque refresh : /resume peut en changer). À défaut, on rattache
// le channel à la session de terminal la plus récemment active dans le même dossier.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');
function sessionOfPid(pid) {
  if (!pid) return null;
  try { return JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, `${pid}.json`), 'utf8')).sessionId || null; } catch { return null; }
}

const channels = new Map(); // id -> { id, cwd, pid, res, sessionId }
let seq = 0;

export function openChannel(req, res, { cwd, pid }) {
  const id = ++seq;
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write('\n');
  channels.set(id, { id, cwd, pid, res, sessionId: null });
  req.on('close', () => channels.delete(id));
  return id;
}

// à chaque refresh : rattache chaque channel à sa session et marque les sessions reliées
export function bindChannels(agents) {
  for (const ch of channels.values()) {
    const exact = sessionOfPid(ch.pid);
    if (exact) { ch.sessionId = exact; continue; }
    const candidates = agents.filter((a) => !a.parent && a.cwd === ch.cwd && a.origin === 'terminal').sort((x, y) => x.age - y.age);
    ch.sessionId = candidates[0]?.id || null;
  }
  for (const a of agents) a.channel = !a.parent && [...channels.values()].some((ch) => ch.sessionId === a.id);
}

const forSession = (sessionId) => [...channels.values()].find((ch) => ch.sessionId === sessionId);
export const hasChannel = (sessionId) => !!forSession(sessionId);
// autorisation relayée : on retrouve la session par le pid du channel qui l'envoie, sinon par son dossier
export const sessionForChannel = ({ pid, cwd }) => sessionOfPid(pid) || [...channels.values()].find((ch) => ch.cwd === cwd)?.sessionId || null;

function push(sessionId, order) {
  const ch = forSession(sessionId);
  if (!ch) return false;
  ch.res.write(JSON.stringify(order) + '\n');
  return true;
}

export const sendViaChannel = (sessionId, text) => push(sessionId, { type: 'message', text });
export const answerViaChannel = (sessionId, requestId, behavior) => push(sessionId, { type: 'permission', request_id: requestId, behavior });

export const pingChannels = () => { for (const ch of channels.values()) ch.res.write('\n'); };
