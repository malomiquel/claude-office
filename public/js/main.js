// Point d'entrée de la page : flux temps réel (SSE) et branchement des modules.

import { state, onRender, rerender } from './state.js';
import { renderOffice } from './office.js';
import { renderPanel, initPanel, closePanel, panelDrop } from './panel.js';
import { startCountdown } from './ask.js';
import { initHire, isHireOpen, closeHire, hireDrop } from './hire.js';
import { renderQuota } from './quota.js';
import { feed } from './ticker.js';
import { initCamera, cameraAfterRender } from './camera.js';

onRender(renderOffice);
onRender(renderPanel);
initPanel();
initHire();
initCamera();
startCountdown();

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (isHireOpen()) closeHire();
  else if (state.selected) closePanel();
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
    renderQuota();
  };
  es.onerror = () => { es.close(); setTimeout(connect, 2000); };
}
connect();
