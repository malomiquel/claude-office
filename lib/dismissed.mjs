// Agents virés : masqués tant que leur transcript ne bouge plus. S'ils se remettent au travail, ils reviennent.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, WINDOW_MIN } from './config.mjs';

const FILE = path.join(DATA_DIR, 'dismissed.json');
const dismissed = new Map(); // sessionId -> date du renvoi (ms)
try { for (const [id, at] of Object.entries(JSON.parse(fs.readFileSync(FILE, 'utf8')))) dismissed.set(id, at); } catch {}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(dismissed)));
}

export function dismiss(ids) {
  const now = Date.now();
  for (const id of ids) dismissed.set(id, now);
  save();
}

// retire des transcripts ceux qui ont été virés et n'ont pas rebougé depuis
export function filterDismissed(transcripts) {
  let changed = false;
  const kept = transcripts.filter((t) => {
    const at = dismissed.get(t.id);
    if (at === undefined) return true;
    if (t.mtime > at + 5000) { dismissed.delete(t.id); changed = true; return true; } // il est revenu bosser
    return false;
  });
  // oublie les renvois de sessions sorties de la fenêtre d'affichage
  const cutoff = Date.now() - WINDOW_MIN * 60_000;
  for (const [id, at] of dismissed) if (at < cutoff) { dismissed.delete(id); changed = true; }
  if (changed) save();
  return kept;
}
