// Fil d'actu en bas de l'écran : les nouvelles actions de tout le monde.

import { state } from './state.js';
import { $, esc, plain, short } from './text.js';
import { who } from './people.js';

const lastTs = new Map(); // id -> horodatage de la dernière entrée déjà vue
let primed = false; // au premier passage on mémorise seulement, sans afficher l'historique
let lastLine = '';

export function feed() {
  const news = [];
  for (const a of state.agents) {
    const prev = lastTs.get(a.id) || 0;
    for (const e of a.log) if (e.ts > prev && e.kind !== 'you') news.push({ a, e });
    lastTs.set(a.id, Math.max(prev, ...a.log.map((e) => e.ts || 0)));
  }
  if (!primed) { primed = true; return; }
  const ticker = $('ticker');
  news.sort((x, y) => x.e.ts - y.e.ts).slice(-6).forEach(({ a, e }) => {
    const txt = e.kind === 'talk' ? `dit « ${short(plain(e.text), 60)} »` : plain(e.text);
    const line = `${who(a.id).name} ${txt}`;
    if (line === lastLine) return; // pas de doublons à la suite
    lastLine = line;
    const n = document.createElement('span');
    n.className = 'item';
    n.title = txt;
    n.innerHTML = `<em>${esc(who(a.id).name)}</em> ${esc(txt)}`;
    ticker.firstElementChild.after(n);
  });
  while (ticker.children.length > 14) ticker.lastElementChild.remove();
}
