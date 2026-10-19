// Pauses café données à la main : l'agent reste au coin café jusqu'à ce qu'il se remette au travail
// (son transcript bouge) ou qu'on le rappelle à son bureau.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, WINDOW_MIN } from './config.mjs';

const FILE = path.join(DATA_DIR, 'breaks.json');
const breaks = new Map(); // sessionId -> date de la mise en pause (ms)
try { for (const [id, at] of Object.entries(JSON.parse(fs.readFileSync(FILE, 'utf8')))) breaks.set(id, at); } catch {}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(breaks)));
}

export function setBreak(id, on) {
  if (on) breaks.set(id, Date.now()); else breaks.delete(id);
  save();
}

// envoie au café les chefs mis en pause qui n'ont pas rebougé depuis ; mtimes : id -> dernière écriture du transcript
export function applyBreaks(agents, mtimes) {
  let changed = false;
  for (const a of agents) {
    const at = breaks.get(a.id);
    if (at === undefined || a.parent) continue;
    if ((mtimes.get(a.id) || 0) > at + 5000) { breaks.delete(a.id); changed = true; continue; } // il est retourné bosser
    Object.assign(a, { state: 'coffee', kind: 'done', activity: 'en pause café', onBreak: true });
  }
  const cutoff = Date.now() - WINDOW_MIN * 60_000;
  for (const [id, at] of breaks) if (at < cutoff) { breaks.delete(id); changed = true; }
  if (changed) save();
}
