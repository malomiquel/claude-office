// Fenêtre « Recruter un agent » : dossier (sélecteur du Finder ou dossiers récents), mission, fichiers joints, autorisations.

import { state } from './state.js';
import { $, esc, tilde } from './text.js';
import { post } from './api.js';
import { createAttachments } from './attachments.js';

let cwd = '';
let attachments;

function setCwd(p) {
  cwd = p || '';
  if (cwd) {
    const parts = tilde(cwd).split('/');
    const name = parts.pop() || '/';
    $('hCwdLabel').innerHTML = `<b>${esc(name)}</b><small>${esc(parts.join('/') || '/')}</small>`;
  } else $('hCwdLabel').textContent = 'Choisir un dossier…';
  $('hPick').title = cwd;
  $('hPick').classList.toggle('set', !!cwd);
  $('hPick').querySelector('.change').textContent = cwd ? 'Changer' : 'Parcourir';
  $('hRecents').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.path === cwd));
}

function renderRecents() {
  $('hRecents').innerHTML = state.recentCwds.slice(0, 6).map((c) =>
    `<button type="button" data-path="${esc(c)}" title="${esc(c)}">${esc(c.split('/').pop())}</button>`).join('');
  $('hRecents').querySelectorAll('button').forEach((b) => b.onclick = () => setCwd(b.dataset.path));
  setCwd(cwd);
}

export const isHireOpen = () => $('hireModal').classList.contains('open');
export const closeHire = () => $('hireModal').classList.remove('open');
export const hireDrop = () => (isHireOpen() ? { zone: $('hireForm'), attachments } : null);

export function initHire() {
  const showErr = (m) => { $('hErr').textContent = m; };
  attachments = createAttachments({ box: $('hAttach'), pasteTarget: $('hTask'), onError: showErr });

  // le navigateur ne donne pas le chemin absolu d'un dossier : c'est le serveur qui ouvre le sélecteur du Finder
  $('hPick').onclick = async () => {
    showErr('');
    $('hPick').classList.add('busy');
    try {
      const r = await post('pick-folder', { start: cwd });
      if (r.path) setCwd(r.path);
      if (r.unavailable) { $('hPath').hidden = false; $('hPath').focus(); showErr('Pas de sélecteur de dossier sur ce système : saisis le chemin.'); }
    } catch (e) { showErr(e.message); }
    finally { $('hPick').classList.remove('busy'); }
  };
  $('hireBtn').onclick = () => { showErr(''); renderRecents(); $('hireModal').classList.add('open'); $('hPick').focus(); };
  $('hPath').onchange = () => setCwd($('hPath').value.trim());
  $('hCancel').onclick = closeHire;
  $('hireModal').onclick = (e) => { if (e.target === $('hireModal')) closeHire(); };
  $('hireForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!cwd) { showErr('Choisis d\'abord un dossier.'); return; }
    try {
      await post('hire', { cwd, task: $('hTask').value, mode: $('hMode').value, files: await attachments.payload() });
      $('hTask').value = '';
      attachments.clear();
      closeHire();
    } catch (err) { showErr(err.message); }
  };
}
