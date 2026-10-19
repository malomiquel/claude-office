// Rendu markdown minimal des messages : paragraphes, listes, titres, tableaux, gras, code.
// Le texte est échappé avant toute transformation : aucun HTML venant d'un agent n'est interprété.

import { esc } from './text.js';

const inline = (t) => t
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1');

const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isSeparator = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

function table(lines) {
  const align = cells(lines[1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'c' : c.endsWith(':') ? 'r' : ''));
  const cls = (i) => (align[i] ? ` class="${align[i]}"` : '');
  const head = cells(lines[0]).map((c, i) => `<th${cls(i)}>${inline(c)}</th>`).join('');
  const body = lines.slice(2).map((l) => `<tr>${cells(l).map((c, i) => `<td${cls(i)}>${inline(c)}</td>`).join('')}</tr>`).join('');
  return `<div class="tbl"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function md(src) {
  const lines = esc(src).split('\n');
  const out = [];
  let para = [], fence = null;
  const flush = () => { if (para.length) out.push(`<p>${inline(para.join('<br>'))}</p>`); para = []; };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*```/.test(raw)) {
      if (fence) { out.push(`<pre>${fence.join('\n')}</pre>`); fence = null; } else { flush(); fence = []; }
      continue;
    }
    if (fence) { fence.push(raw); continue; }
    // tableau : ligne d'en-tête | … | suivie d'une ligne |---|---:|
    if (isRow(raw) && isSeparator(lines[i + 1] || '')) {
      flush();
      let j = i + 2;
      while (j < lines.length && isRow(lines[j])) j++;
      out.push(table(lines.slice(i, j)));
      i = j - 1;
      continue;
    }
    let m;
    const lvl = (s) => Math.min(3, Math.floor(s.length / 2));
    if (!raw.trim()) flush();
    else if ((m = raw.match(/^(\s*)[-*•]\s+(.*)$/))) { flush(); out.push(`<div class="li" style="--lvl:${lvl(m[1])}">${inline(m[2])}</div>`); }
    else if ((m = raw.match(/^(\s*)(\d+)[.)]\s+(.*)$/))) { flush(); out.push(`<div class="li num" data-n="${m[2]}." style="--lvl:${lvl(m[1])}">${inline(m[3])}</div>`); }
    else if ((m = raw.match(/^#{1,6}\s+(.*)$/))) { flush(); out.push(`<div class="h">${inline(m[1])}</div>`); }
    else para.push(raw.trim());
  }
  if (fence) out.push(`<pre>${fence.join('\n')}</pre>`);
  flush();
  return out.join('');
}
