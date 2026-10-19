// Quota 5 h / 7 j, lu dans le fichier que la barre de statut met à jour.

import fsp from 'node:fs/promises';
import { QUOTA_FILES } from './config.mjs';

// le plus récent des fichiers connus (l'ancien emplacement reste lu pour les installations d'avant le plugin)
async function latest() {
  let best = null;
  for (const f of QUOTA_FILES) {
    try { const d = JSON.parse(await fsp.readFile(f, 'utf8')); if (!best || (d.updated_at || 0) > (best.updated_at || 0)) best = d; } catch {}
  }
  if (!best) throw new Error('pas de quota');
  return best;
}

export async function readQuota() {
  try {
    const { rate_limits: rl = {}, updated_at } = await latest();
    const win = (w) => {
      if (!w || w.used_percentage == null) return null;
      const resetsAt = w.resets_at ? w.resets_at * 1000 : null;
      // fenêtre déjà réinitialisée depuis la dernière mesure : le quota est plein
      const used = resetsAt && resetsAt < Date.now() ? 0 : Number(w.used_percentage);
      return { used, resetsAt };
    };
    return { fiveHour: win(rl.five_hour), sevenDay: win(rl.seven_day), updatedAt: updated_at ? updated_at * 1000 : null };
  } catch { return null; }
}
