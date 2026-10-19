// Petits utilitaires de texte et de DOM.

export const $ = (id) => document.getElementById(id);

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// les agents parlent en markdown : on retire la syntaxe là où on affiche du texte brut (bulles, fil d'actu)
export const plain = (s) => String(s ?? '').replace(/\*\*|__|`+|^#+\s*/gm, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

export const tilde = (p) => String(p ?? '').replace(/^\/Users\/[^/]+/, '~');
export const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export const fmtTime = (t) => t ? new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

export function untilText(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
}

// premier clic : « Sûr ? », second clic dans les 3 s : action
export function confirmClick(btn, action) {
  if (btn.classList.contains('confirm')) {
    clearTimeout(btn._t);
    btn.classList.remove('confirm');
    btn.textContent = btn.dataset.label;
    return action();
  }
  btn.dataset.label = btn.textContent;
  btn.classList.add('confirm');
  btn.textContent = 'Sûr ?';
  btn._t = setTimeout(() => { btn.classList.remove('confirm'); btn.textContent = btn.dataset.label; }, 3000);
}
