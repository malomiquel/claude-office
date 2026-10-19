// Vue du bureau : déplacement (glisser, trackpad, flèches) et zoom (pincement, ⌘ + molette, boutons, + / - / 0).
// La carte (#world) est transformée dans la fenêtre de vue (#viewport) ; la vue est mémorisée dans localStorage.
// Le sol est le fond du viewport, recalé sur la caméra : il se répète à l'infini, sans bord de carte.

import { $ } from './text.js';

const MIN_Z = 0.3;
const MAX_Z = 2.5;
const KEY = 'office.camera';
const DRAG_THRESHOLD = 5; // px avant qu'un appui devienne un déplacement (sinon c'est un clic)

let cam = { x: 0, y: 0, z: 1 };
let viewport, world;
let needsFit = false; // pas de vue mémorisée : cadrer une fois les bureaux affichés

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function apply({ smooth = false } = {}) {
  world.classList.toggle('smooth', smooth);
  viewport.classList.toggle('smooth', smooth);
  world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
  viewport.style.setProperty('--cam-x', `${cam.x}px`);
  viewport.style.setProperty('--cam-y', `${cam.y}px`);
  viewport.style.setProperty('--cam-z', cam.z);
  $('camZoom').textContent = `${Math.round(cam.z * 100)} %`;
  save();
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(cam)); } catch {} }, 300);
}

// zoome en gardant fixe le point (px, py) de la fenêtre de vue
function zoomAt(px, py, factor, opts) {
  const z = clamp(cam.z * factor, MIN_Z, MAX_Z);
  cam.x = px - (px - cam.x) * (z / cam.z);
  cam.y = py - (py - cam.y) * (z / cam.z);
  cam.z = z;
  apply(opts);
}

const center = () => ({ x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 });

export function fit({ smooth = true } = {}) {
  const w = world.offsetWidth, h = world.offsetHeight;
  const vw = viewport.clientWidth, vh = viewport.clientHeight;
  cam.z = clamp(Math.min(vw / w, vh / h) * 0.94, MIN_Z, 1.2);
  cam.x = (vw - w * cam.z) / 2;
  cam.y = (vh - h * cam.z) / 2;
  apply({ smooth });
}

// cadre un élément de la carte (un bureau) au centre, zoomé
function focusOn(el) {
  const vr = viewport.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  // centre de l'élément en coordonnées de la carte
  const wx = (r.left + r.width / 2 - vr.left - cam.x) / cam.z;
  const wy = (r.top + r.height / 2 - vr.top - cam.y) / cam.z;
  cam.z = 1.6;
  cam.x = viewport.clientWidth / 2 - wx * cam.z;
  cam.y = viewport.clientHeight / 2 - wy * cam.z;
  apply({ smooth: true });
}

function hideHint() { $('camHint')?.classList.add('gone'); }

function initPointer() {
  const pointers = new Map(); // pointerId -> {x, y}
  let start = null; // { x, y, camX, camY } du premier doigt / clic
  let pinch = null; // { dist, z }
  let dragged = false;

  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.cam-ctrl, button, input, textarea, select')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { start = { x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y }; dragged = false; }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), z: cam.z };
    }
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const vr = viewport.getBoundingClientRect();
      const factor = (pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist) / cam.z;
      zoomAt((a.x + b.x) / 2 - vr.left, (a.y + b.y) / 2 - vr.top, factor);
      dragged = true;
      return;
    }
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!dragged) { dragged = true; viewport.setPointerCapture(e.pointerId); viewport.classList.add('panning'); hideHint(); }
    cam.x = start.camX + dx;
    cam.y = start.camY + dy;
    apply();
  });

  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) { start = null; viewport.classList.remove('panning'); }
  };
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);

  // après un déplacement, le relâchement ne doit pas ouvrir le panneau du bureau survolé
  viewport.addEventListener('click', (e) => {
    if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; }
  }, true);
}

function initWheel() {
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    hideHint();
    const vr = viewport.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      // pincement trackpad (ctrlKey) ou ⌘ + molette
      zoomAt(e.clientX - vr.left, e.clientY - vr.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
    } else {
      // défilement à deux doigts / molette : déplacement
      cam.x -= e.deltaX;
      cam.y -= e.deltaY;
      apply();
    }
  }, { passive: false });
}

function initKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('.modal-bg.open')) return;
    const c = center();
    const step = 80;
    const actions = {
      '+': () => zoomAt(c.x, c.y, 1.25, { smooth: true }),
      '=': () => zoomAt(c.x, c.y, 1.25, { smooth: true }),
      '-': () => zoomAt(c.x, c.y, 0.8, { smooth: true }),
      '0': () => fit(),
      ArrowLeft: () => { cam.x += step; apply({ smooth: true }); },
      ArrowRight: () => { cam.x -= step; apply({ smooth: true }); },
      ArrowUp: () => { cam.y += step; apply({ smooth: true }); },
      ArrowDown: () => { cam.y -= step; apply({ smooth: true }); },
    };
    if (actions[e.key]) { e.preventDefault(); actions[e.key](); }
  });
}

// appelé après chaque rendu des agents : le premier cadrage attend que la carte ait sa vraie taille
export function cameraAfterRender() {
  if (!needsFit) return;
  needsFit = false;
  fit({ smooth: false });
}

export function initCamera() {
  viewport = $('viewport');
  world = $('world');
  initPointer();
  initWheel();
  initKeys();

  $('camIn').onclick = () => { const c = center(); zoomAt(c.x, c.y, 1.25, { smooth: true }); };
  $('camOut').onclick = () => { const c = center(); zoomAt(c.x, c.y, 0.8, { smooth: true }); };
  $('camZoom').onclick = () => { const c = center(); zoomAt(c.x, c.y, 1 / cam.z, { smooth: true }); };
  $('camFit').onclick = () => fit();
  viewport.addEventListener('dblclick', (e) => {
    const desk = e.target.closest('.mini, .pod, .seat, .idler');
    if (desk) focusOn(desk);
  });

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch {}
  if (saved && Number.isFinite(saved.z)) { cam = { x: saved.x, y: saved.y, z: clamp(saved.z, MIN_Z, MAX_Z) }; apply(); }
  else needsFit = true;
  setTimeout(hideHint, 8000);
}
