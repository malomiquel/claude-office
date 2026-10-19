// Horloges de quota (5 h et semaine) dans l'en-tête.

import { state } from './state.js';
import { $, untilText } from './text.js';

// heure du reset : « à 14h30 » aujourd'hui, « demain 9h » ou « lun. 10h » au-delà
function resetText(d) {
  const hm = d.getMinutes() ? `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}` : `${d.getHours()}h`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date())) / 86400000);
  if (diff <= 0) return `à ${hm}`;
  if (diff === 1) return `demain ${hm}`;
  return `${d.toLocaleDateString('fr-FR', { weekday: 'short' })} ${hm}`;
}

function renderGauge(el, w, label, updatedAt) {
  if (!w) { el.hidden = true; return; }
  el.hidden = false;
  const left = Math.max(0, Math.min(100, Math.round(100 - w.used)));
  const clock = el.querySelector('.clock');
  clock.style.setProperty('--p', left);
  clock.style.setProperty('--c', left > 50 ? 'var(--ok)' : left > 20 ? 'var(--warn)' : 'var(--bad)');
  el.querySelector('b').textContent = `${left} %`;
  const reset = w.resetsAt ? new Date(w.resetsAt) : null;
  el.querySelector('span').textContent = reset ? `${label} · reset ${resetText(reset)}` : label;
  const at = reset ? `${reset.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} (dans ${untilText(w.resetsAt - Date.now())})` : '?';
  const seen = updatedAt ? `\nMesuré il y a ${untilText(Date.now() - updatedAt)}` : '';
  el.title = `Quota ${label} : ${left} % restant (${Math.round(w.used)} % utilisé)\nRéinitialisé ${at}${seen}`;
  // la mesure vient de la barre de statut : sans session Claude Code ouverte, elle vieillit
  el.classList.toggle('stale', !!updatedAt && Date.now() - updatedAt > 30 * 60000);
}

export function renderQuota() {
  const q = state.quota;
  $('quota').hidden = !q || (!q.fiveHour && !q.sevenDay);
  if ($('quota').hidden) return;
  renderGauge($('qFive'), q.fiveHour, '5 h', q.updatedAt);
  renderGauge($('qWeek'), q.sevenDay, 'semaine', q.updatedAt);
}
