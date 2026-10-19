// Point d'entrée de la page : flux temps réel (SSE) et branchement des modules.

import { state, onRender, rerender } from './state.js';
import { renderOffice } from './office.js';
import { renderPanel, initPanel, closePanel, panelDrop, select } from './panel.js';
import { startCountdown } from './ask.js';
import { initHire, isHireOpen, closeHire, hireDrop } from './hire.js';
import { renderQuota } from './quota.js';
import { feed } from './ticker.js';
import { initCamera, cameraAfterRender, focusOn } from './camera.js';
import { alerts, initAlerts } from './alerts.js';
import { initAmbiance } from './ambiance.js';
import { $ } from './text.js';

onRender(renderOffice);
onRender(renderPanel);
initPanel();
initHire();
initCamera();
initAlerts();
initAmbiance();
startCountdown();

// les chefs, du plus pressé au moins pressé : question, permission, fini, puis les autres (ordre de l'open space)
function byUrgency() {
  const rank = (a) => (a.state === 'waiting' && a.kind === 'ask' ? 0 : a.state === 'blocked' ? 1 : a.state === 'waiting' ? 2 : 3);
  return state.agents.filter((a) => !a.parent).sort((x, y) => rank(x) - rank(y) || x.id.localeCompare(y.id));
}

function goTo(a) {
  if (!a) return;
  select(a.id);
  const el = document.querySelector(`[data-agent="${a.id}"]`);
  if (el) focusOn(el);
}

// Raccourcis : Tab / Maj+Tab = agent suivant qui t'attend, 1-9 = n-ième bureau, N = recruter, M = écrire, Échap = fermer
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isHireOpen()) closeHire();
    else if (state.selected) closePanel();
    return;
  }
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if (typing || e.metaKey || e.ctrlKey || e.altKey || isHireOpen()) return;
  if (e.key === 'Tab') {
    const list = byUrgency();
    if (!list.length) return;
    e.preventDefault();
    const i = list.findIndex((a) => a.id === state.selected);
    goTo(list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length] || list[0]);
  } else if (/^[1-9]$/.test(e.key)) {
    goTo(state.agents.filter((a) => !a.parent).sort((x, y) => x.id.localeCompare(y.id))[Number(e.key) - 1]);
  } else if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    $('hireBtn').click();
  } else if ((e.key === 'm' || e.key === 'M') && state.selected && !$('pCompose').hidden) {
    e.preventDefault();
    $('pMsg').focus();
  }
});

// Glisser-déposer de fichiers, géré au niveau de la fenêtre : on peut lâcher n'importe où dans le panneau
// (ou la fenêtre de recrutement), et le navigateur n'ouvre jamais le fichier à la place de la page.
const dropTarget = () => hireDrop() || panelDrop();
let dragDepth = 0;
const setDragging = (on) => {
  const active = on && dropTarget()?.zone;
  for (const t of [hireDrop(), panelDrop()]) t?.zone.classList.toggle('dragging', t.zone === active);
};
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; setDragging(true); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; setDragging(false); } });
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = dropTarget() ? 'copy' : 'none';
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  setDragging(false);
  dropTarget()?.attachments.addFrom(e.dataTransfer);
});

// le panneau s'ouvre sous l'en-tête pour laisser « Recruter » accessible
new ResizeObserver(([e]) => document.documentElement.style.setProperty('--header-h', `${e.target.offsetHeight}px`))
  .observe(document.querySelector('header'));

function connect() {
  const es = new EventSource('/events');
  es.onmessage = (m) => {
    const d = JSON.parse(m.data);
    state.agents = d.agents;
    state.quota = d.quota;
    // une question tenue en direct par le hook prime sur ce que dit le transcript
    for (const l of d.live || []) {
      const a = state.agents.find((x) => x.id === l.sessionId && !x.parent);
      if (!a) continue;
      if (l.type === 'permission') Object.assign(a, { ask: l, state: 'blocked', kind: 'tool', activity: `attend ta permission : ${l.tool}` });
      else Object.assign(a, { ask: l, state: 'waiting', kind: 'ask', activity: 'te pose une question' });
    }
    rerender();
    cameraAfterRender();
    feed();
    alerts();
    renderQuota();
  };
  es.onerror = () => { es.close(); setTimeout(connect, 2000); };
}
connect();
