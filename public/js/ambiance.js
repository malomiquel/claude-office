// Ambiance : la lumière des fenêtres suit l'heure, et le thème clair / sombre (sombre par défaut).

import { $ } from './text.js';

const KEY = 'office-theme';

function daylight() {
  const h = new Date().getHours();
  const time = h >= 21 || h < 6 ? 'night' : h < 9 ? 'dawn' : h < 18 ? 'day' : 'dusk';
  document.documentElement.dataset.time = time;
}

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  $('themeBtn').textContent = t === 'light' ? '☾' : '☀';
  $('themeBtn').title = t === 'light' ? 'Passer en sombre' : 'Passer en clair';
}

export function initAmbiance() {
  daylight();
  setInterval(daylight, 60_000);
  let t = 'dark';
  try { t = localStorage.getItem(KEY) || 'dark'; } catch {}
  setTheme(t);
  $('themeBtn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    try { localStorage.setItem(KEY, next); } catch {}
  };
}
