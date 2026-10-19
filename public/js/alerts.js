// Notifications du navigateur : un agent te pose une question ou attend ta permission alors que tu regardes ailleurs.

import { state } from './state.js';
import { $ } from './text.js';
import { who } from './people.js';
import { select } from './panel.js';

const KEY = 'office-alerts';
const seen = new Map(); // id -> ce qu'il attendait au dernier passage
let primed = false;

const supported = 'Notification' in window;
const wanted = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
const on = () => supported && Notification.permission === 'granted' && wanted();

function need(a) {
  if (a.state === 'blocked') return 'permission';
  if (a.state === 'waiting' && a.kind === 'ask') return a.ask?.type === 'plan' ? 'plan' : 'question';
  return null;
}

const TITLE = { permission: 'attend ta permission', question: 'te pose une question', plan: 'a un plan à valider' };

function body(a, kind) {
  if (kind === 'permission') return a.ask?.tool ? `${a.ask.tool} · ${a.project}` : a.project;
  const q = a.ask?.questions?.[0];
  return q ? `${q.question || q.header} · ${a.project}` : a.project;
}

export function alerts() {
  for (const a of state.agents) {
    if (a.parent) continue;
    const n = need(a);
    const before = seen.get(a.id);
    seen.set(a.id, n);
    if (!primed || !n || n === before || !on()) continue;
    if (document.visibilityState === 'visible' && document.hasFocus()) continue; // tu as déjà le bureau sous les yeux
    const note = new Notification(`${who(a.id).name} ${TITLE[n]}`, { body: body(a, n), tag: a.id });
    note.onclick = () => { window.focus(); select(a.id); note.close(); };
  }
  primed = true;
}

function renderBell() {
  const b = $('alertBtn');
  if (!supported) { b.hidden = true; return; }
  const p = Notification.permission;
  b.textContent = on() ? '🔔' : '🔕';
  b.title = p === 'denied' ? 'Notifications bloquées par le navigateur (réglages du site)'
    : on() ? 'Notifications activées : clic pour les couper'
    : 'Être prévenu quand un agent te pose une question ou attend ta permission';
}

export function initAlerts() {
  renderBell();
  $('alertBtn').onclick = async () => {
    if (Notification.permission === 'default') await Notification.requestPermission();
    else if (Notification.permission === 'granted') { try { localStorage.setItem(KEY, wanted() ? 'off' : 'on'); } catch {} }
    renderBell();
  };
}
