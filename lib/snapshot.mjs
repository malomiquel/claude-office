// État du bureau diffusé en SSE : employés, quota, questions en direct.

import { listTranscripts, analyze, forgetOthers } from './transcripts.mjs';
import { filterDismissed } from './dismissed.mjs';
import { readQuota } from './quota.mjs';
import { publicAsks, onAsksChange, dropStaleRelays } from './live-asks.mjs';
import { bindChannels } from './channels.mjs';
import { onWorkersChange, wasHired } from './workers.mjs';
import { settleIfNewer } from './permissions.mjs';

let snapshot = { agents: [], quota: null, live: [], at: 0 };
const clients = new Set();

export const getSnapshot = () => snapshot;

function broadcast() {
  const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
  for (const res of clients) res.write(payload);
}

// Un chef qui a fini son tour mais dont les sous-agents travaillent encore n'est pas en pause : il attend son équipe.
function keepBossesWithTeam(agents) {
  for (const a of agents) {
    if (a.parent || a.state !== 'coffee') continue;
    if (agents.some((i) => i.parent === a.id && (i.state === 'working' || i.state === 'blocked'))) {
      Object.assign(a, { state: 'waiting', kind: 'done', activity: 'attend son équipe' });
    }
  }
}

let refreshing = null;
// un seul refresh à la fois : la première lecture des gros transcripts peut prendre quelques secondes
export function refresh() {
  refreshing ||= doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}

async function doRefresh() {
  const all = await listTranscripts();
  forgetOthers(new Set(all.map((t) => t.file)));
  const ts = filterDismissed(all);
  // une demande de permission arrive au nom du chef, même quand c'est un de ses sous-agents qui la pose
  for (const t of ts) if (t.parent) settleIfNewer(t.parent, t.mtime);
  const analyzed = (await Promise.all(ts.map((t) => analyze(t).catch(() => null)))).filter(Boolean);
  // sessions « claude -p » qui ne viennent ni d'un terminal ni du bureau : automatisations (hooks de résumé…), pas des employés
  const hidden = new Set(analyzed.filter((a) => !a.parent && a.headless && !wasHired(a.id)).map((a) => a.id));
  const agents = analyzed.filter((a) => !hidden.has(a.id) && !hidden.has(a.parent));
  keepBossesWithTeam(agents);
  bindChannels(agents);
  dropStaleRelays(agents);
  // un sous-agent n'est affiché que si son chef est dans le bureau
  const ids = new Set(agents.filter((a) => !a.parent).map((a) => a.id));
  snapshot = { agents: agents.filter((a) => !a.parent || ids.has(a.parent)), quota: await readQuota(), live: publicAsks(), at: Date.now() };
  broadcast();
}

// une question qui arrive ou part se voit tout de suite, sans attendre le prochain refresh
onAsksChange(() => { snapshot = { ...snapshot, live: publicAsks() }; broadcast(); });
// un agent du bureau qui démarre, finit une tâche ou s'arrête : on relit tout de suite
onWorkersChange(() => setTimeout(refresh, 100));

export function addClient(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

export function pingClients() {
  for (const c of clients) c.write(': ping\n\n');
}
