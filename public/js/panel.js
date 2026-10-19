// Panneau de détail d'un agent : fiche, question en attente, historique, consigne, renvoi.

import { state, findAgent, rerender } from './state.js';
import { $, esc, plain, tilde, fmtTime, confirmClick } from './text.js';
import { md } from './markdown.js';
import { who, sprite } from './people.js';
import { post } from './api.js';
import { renderAsk } from './ask.js';
import { createAttachments } from './attachments.js';

const STATE_FR = { working: 'Au travail', waiting: 'T\'attend', blocked: 'Attend ta permission', coffee: 'En pause', done: 'A rendu son rapport' };
const STATE_COLOR = { working: 'var(--ok)', waiting: 'var(--warn)', blocked: 'var(--bad)', coffee: '#b5643c', done: 'var(--muted)' };

let missionOpen = false;
let renderedLogKey = '';
let attachments;

// zone de dépôt de fichiers quand on peut écrire une consigne (voir main.js)
export const panelDrop = () => (state.selected && !$('pCompose').hidden ? { zone: $('panel'), attachments } : null);

export function select(id) {
  if (state.selected !== id) { missionOpen = false; $('pFacts').dataset.html = ''; }
  state.selected = id;
  $('pErr').textContent = '';
  $('panel').classList.add('open');
  rerender();
}

export function closePanel() {
  state.selected = null;
  $('panel').classList.remove('open');
  rerender();
}

function renderFacts(a) {
  const statusText = a.state === 'working' ? `${STATE_FR[a.state]} · ${plain(a.activity)}`
    : a.ask?.type === 'plan' ? 'Attend que tu valides son plan'
    : a.state === 'waiting' && a.kind === 'ask' ? 'Te pose une question' : STATE_FR[a.state];
  const chips = [
    a.branch && a.branch !== 'HEAD' ? ['Branche', a.branch] : null,
    ['Modèle', (a.model || '?').replace(/^claude-/, '')],
    a.tokens ? ['Contexte', `${Math.round(a.tokens / 1000)}k`] : null,
    ['Session', a.id.slice(0, 8)],
  ].filter(Boolean);
  const html = `<p class="mission${missionOpen ? ' full' : ''}" title="Cliquer pour tout lire">${esc(plain(a.title))}</p>
    <div class="status"><i style="background:${STATE_COLOR[a.state]}"></i>${esc(statusText)}</div>
    <div class="chips">${chips.map(([k, v]) => `<span class="chip" title="${esc(k === 'Session' ? a.id : v)}">${k} <b>${esc(v)}</b></span>`).join('')}</div>`;
  const box = $('pFacts');
  if (box.dataset.html === html) return;
  box.dataset.html = html;
  box.innerHTML = html;
  box.querySelector('.mission').onclick = (e) => { missionOpen = !missionOpen; e.target.classList.toggle('full', missionOpen); };
}

function renderLog(a) {
  const log = a.log;
  const key = a.id + ':' + log.length + ':' + (log.at(-1)?.ts || 0) + ':' + !!a.ask;
  if (key === renderedLogKey) return;
  renderedLogKey = key;
  const box = $('pLog');
  const body = $('pBody');
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
  const fresh = box.dataset.agent !== a.id;
  box.dataset.agent = a.id;
  // question en attente : historique court pour que la carte ne bouge pas pendant qu'on répond
  const shown = a.ask ? log.slice(-6) : log;
  const lastTalk = shown.findLastIndex((e) => e.kind === 'talk');
  box.innerHTML = shown.map((e, i) => {
    if (e.kind !== 'talk' && e.kind !== 'you') return `<div class="e ${e.kind}"><time>${fmtTime(e.ts)}</time>${esc(plain(e.text))}</div>`;
    const clamp = i !== lastTalk; // le dernier message de l'agent s'affiche en entier
    return `<div class="e ${e.kind}${clamp ? ' clamp' : ''}"><time>${fmtTime(e.ts)}</time>${e.kind === 'you' ? `<b>${e.via ? 'Toi (depuis le bureau) :' : 'Toi :'}</b>` : ''}
      <div class="md">${md(e.text)}</div>${e.short ? '<span class="cut-note">message ancien raccourci</span>' : ''}
      <button type="button" class="more">Voir tout</button></div>`;
  }).join('') || '<div class="hint">Rien pour l\'instant.</div>';
  box.querySelectorAll('.clamp').forEach((el) => {
    const m = el.querySelector('.md');
    el.classList.toggle('over', m.scrollHeight > m.clientHeight + 4);
  });
  box.querySelectorAll('.more').forEach((b) => b.onclick = () => {
    const el = b.closest('.e');
    const closed = el.classList.toggle('clamp');
    el.classList.toggle('open', !closed);
    b.textContent = closed ? 'Voir tout' : 'Réduire';
  });
  if (fresh && a.ask) body.scrollTop = 0; // la question juste sous la fiche
  else if ((atBottom || fresh) && !a.ask) body.scrollTop = body.scrollHeight;
}

// session de terminal : l'envoi devient une reprise explicite, confirmée en deux clics
function renderSend(a) {
  const takeover = !a.running && a.origin === 'terminal' && !a.channel;
  const b = $('pSend');
  if (b.classList.contains('confirm')) return;
  b.textContent = takeover ? 'Reprendre ici (sans le terminal)' : 'Envoyer';
  b.dataset.takeover = takeover ? '1' : '';
}

const SENT_FR = {
  sent: 'Envoyé.',
  next: 'Envoyé : il le lira juste après sa tâche en cours.',
  restarted: 'Relancé avec les nouvelles autorisations : il lit ton message.',
  channel: 'Envoyé dans son terminal par le channel.',
};

export function renderPanel() {
  if (!state.selected) return;
  const a = findAgent(state.selected);
  if (!a) { $('pSub').textContent = 'parti du bureau'; return; }
  const boss = a.parent && findAgent(a.parent);
  $('pAvatar').innerHTML = sprite(a.id);
  $('pName').textContent = who(a.id).name;
  $('pSub').textContent = a.parent ? `Sous-agent de ${boss ? who(boss.id).name : '?'} · ${a.agentType || 'sous-agent'}` : tilde(a.cwd);
  $('pSub').title = a.cwd || '';
  renderFacts(a);
  renderLog(a);
  renderAsk(a);
  $('pCompose').hidden = !!a.parent || !!a.ask;
  $('pFire').hidden = !a.busy;
  renderSend(a);
  $('pHint').innerHTML = a.channel
    ? '🔗 <b>Reliée par le channel</b> : ton message arrive dans son terminal, comme si tu l\'avais tapé là-bas.'
    : a.running
    ? 'Piloté par le bureau : tes messages lui arrivent même pendant qu\'il travaille, il les lit à la suite. Changer les autorisations le relance.'
    : a.origin === 'terminal'
      ? '<b>Ouverte dans ton terminal</b> : écris-lui là-bas. Le bureau ne peut pas écrire dans un terminal ; la reprendre ici lancerait une 2e copie en parallèle. Si tu as fermé le terminal, « Reprendre ici » la confie au bureau.'
      : 'Reprend la session en arrière-plan (<code>claude -p --resume</code>) ; elle sera ensuite pilotée par le bureau.';
  const d = $('pDismiss');
  if (!d.classList.contains('confirm')) {
    d.textContent = a.running ? 'Arrêter et virer' : 'Virer';
    d.dataset.label = d.textContent;
  }
  d.title = a.running ? 'Arrête le process lancé par le bureau et le retire'
    : a.state === 'working' ? 'Il bosse encore dans un terminal : il reviendra dès sa prochaine action'
    : 'Le retire du bureau. Il reviendra s\'il se remet au travail';
}

export function initPanel() {
  let okTimer;
  const showOk = (m) => { clearTimeout(okTimer); $('pOk').textContent = m; okTimer = setTimeout(() => { $('pOk').textContent = ''; }, 5000); };
  const showErr = (m) => { $('pErr').textContent = m; if (m) showOk(''); };
  attachments = createAttachments({ box: $('pAttach'), pasteTarget: $('pMsg'), onError: showErr });

  $('pClose').onclick = closePanel;
  const send = async (takeover) => {
    const text = $('pMsg').value.trim();
    if (!text) return;
    showErr('');
    try {
      const r = await post('message', { id: state.selected, text, mode: $('pMode').value, takeover, files: await attachments.payload() });
      $('pMsg').value = '';
      attachments.clear();
      showOk(SENT_FR[r.status] || 'Envoyé.');
    } catch (e) { showErr(e.message === 'terminal' ? 'Ouverte dans ton terminal : écris-lui là-bas, ou « Reprendre ici » si tu l\'as fermé.' : e.message); }
  };
  $('pSend').onclick = () => ($('pSend').dataset.takeover ? confirmClick($('pSend'), () => send(true)) : send(false));
  $('pMsg').onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('pSend').click(); };
  $('pFire').onclick = async () => { try { await post('fire', { id: state.selected }); } catch (e) { showErr(e.message); } };

  $('pDismiss').onclick = () => confirmClick($('pDismiss'), async () => {
    try { await post('dismiss', { id: state.selected }); closePanel(); }
    catch (e) { showErr(e.message); }
  });
  $('fireAll').onclick = () => confirmClick($('fireAll'), async () => {
    const ids = state.agents.filter((a) => !a.parent && a.state === 'coffee').map((a) => a.id);
    if (!ids.length) return;
    try { await post('dismiss', { ids }); if (ids.includes(state.selected)) closePanel(); }
    catch (e) { console.error(e); }
  });
}
