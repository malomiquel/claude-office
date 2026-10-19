// L'open space et le coin café : un îlot par équipe (chef + petits bureaux des sous-agents), les compteurs de l'en-tête.

import { state } from './state.js';
import { $, esc, plain, short } from './text.js';
import { who, sprite } from './people.js';
import { select } from './panel.js';

const ICON = { code: '⌨️', terminal: '🖥️', web: '🌐', read: '📄', think: '💭', delegate: '📣', plan: '📋', ask: '✋', tool: '🔧', talk: '💬', done: '✅' };
const els = new Map(); // id -> élément affiché (réutilisé pour ne pas relancer les animations)

// sous-agent présent à son petit bureau tant qu'il n'a pas rendu son rapport
export const busyIntern = (i) => i.state === 'working' || i.state === 'blocked';
const isAsk = (a) => a.state === 'waiting' && a.kind === 'ask';

function bubbleText(a, team = 0) {
  if (a.state === 'waiting' && a.kind !== 'ask' && team) return `⏳ Attend son équipe (${team})`;
  if (a.state === 'waiting' && a.ask?.type === 'plan') return '📋 Plan à valider';
  if (a.state === 'waiting' && a.ask?.questions?.length) return `❓ Question : ${plain(a.ask.questions[0].header || a.ask.questions[0].question)}`;
  if (a.state === 'waiting') return a.kind === 'ask' ? '❓ Question pour toi' : '✅ Fini ! Et maintenant ?';
  if (a.state === 'blocked') return '🔐 Attend ta permission';
  return `${ICON[a.kind] || '•'} ${plain(a.activity)}`;
}

// Un îlot par équipe : le grand bureau du chef (la session principale), puis un petit bureau par sous-agent au travail.
function teamEl(a) {
  const el = document.createElement('div');
  el.className = 'team';
  el.innerHTML = `<div class="team-sign"></div>
    <div class="pod boss"><div class="bubble"></div><div class="chair"></div>${sprite(a.id, { legs: false }).replace('<svg', '<svg class="char"')}
      <div class="desk"><div class="laptop"></div><div class="mug"></div><div class="lamp"></div></div>
      <div class="plate"><div class="name pixel"></div><div class="role">chef d'équipe</div></div>
    </div>
    <div class="minis"></div>`;
  el.querySelector('.pod').onclick = () => select(a.id);
  return el;
}

// salle de réunion : assis autour de la table, avec ce qu'ils attendent de toi
function seatEl(a) {
  const el = document.createElement('div');
  el.innerHTML = `<div class="seat-bubble"></div>${sprite(a.id, { legs: false })}<div class="name"></div><div class="proj"></div>`;
  el.onclick = () => select(a.id);
  return el;
}

function idlerEl(a) {
  const el = document.createElement('div');
  el.innerHTML = `${sprite(a.id, { mug: true })}<div class="name"></div><div class="proj"></div>`;
  el.onclick = () => select(a.id);
  return el;
}

function miniEl(i) {
  const el = document.createElement('div');
  el.dataset.id = i.id;
  el.innerHTML = `<div class="mini-bubble"></div>${sprite(i.id, { legs: false }).replace('<svg', '<svg class="char"')}
    <div class="mini-desk"><div class="screen"></div></div><div class="mini-name pixel"></div>`;
  el.onclick = (e) => { e.stopPropagation(); select(i.id); };
  return el;
}

// petits bureaux des sous-agents : réutilisés d'un rendu à l'autre, comme les postes des chefs
function renderMinis(team, a, interns) {
  const box = team.querySelector('.minis');
  const mine = interns.filter((i) => i.parent === a.id && busyIntern(i));
  const keep = new Set(mine.map((i) => i.id));
  box.querySelectorAll('.mini').forEach((m) => { if (!keep.has(m.dataset.id)) m.remove(); });
  for (const i of mine) {
    let m = box.querySelector(`.mini[data-id="${i.id}"]`);
    if (!m) { m = miniEl(i); box.appendChild(m); }
    m.className = `mini state-${i.state} kind-${i.kind}${state.selected === i.id ? ' selected' : ''}`;
    m.title = `${who(i.id).name} · ${i.agentType || 'sous-agent'}\n${plain(i.title)}\n→ ${plain(i.activity)}`;
    m.querySelector('.mini-bubble').textContent = ICON[i.kind] || '•';
    m.querySelector('.mini-name').textContent = who(i.id).name;
  }
  team.classList.toggle('has-minis', mine.length > 0);
}

function renderStats(bosses, interns) {
  const count = (s) => s === 'ask' ? bosses.filter(isAsk).length
    : s === 'waiting' ? bosses.filter((a) => a.state === 'waiting' && !isAsk(a)).length
    : bosses.filter((a) => a.state === s).length;
  const stat = (n, label, color) => `<span class="stat${n ? '' : ' zero'}">${color ? `<i style="background:${color}"></i>` : ''}<b>${n}</b> ${label}</span>`;
  const busy = interns.filter(busyIntern).length;
  $('stats').innerHTML = [
    stat(count('ask'), count('ask') > 1 ? 'questions' : 'question', 'var(--accent)'),
    stat(count('working'), 'au boulot', 'var(--ok)'),
    stat(count('waiting'), 'ont fini', 'var(--warn)'),
    stat(count('blocked'), count('blocked') > 1 ? 'permissions' : 'permission', 'var(--bad)'),
    stat(count('coffee'), 'en pause', '#b5643c'),
    stat(busy, `sous-agent${busy > 1 ? 's' : ''} au travail`),
  ].join('');
  const pending = count('ask') + count('waiting');
  document.title = count('ask') ? `❓ (${count('ask')}) Claude Office` : pending ? `(${pending}) Claude Office` : 'Claude Office';
}

export function renderOffice() {
  const bosses = state.agents.filter((a) => !a.parent).sort((x, y) => x.id.localeCompare(y.id));
  const interns = state.agents.filter((a) => a.parent);
  const seen = new Set();

  for (const a of bosses) {
    const team = interns.filter((i) => i.parent === a.id && busyIntern(i)).length;
    // t'attend (question, plan, permission) et son équipe a fini : il passe en salle de réunion
    const waitsForYou = (isAsk(a) || a.state === 'blocked') && !team;
    const zone = a.state === 'coffee' ? 'lounge' : waitsForYou ? 'meeting' : 'desk';
    let el = els.get(a.id);
    if (!el || el.dataset.zone !== zone) {
      el?.remove();
      el = zone === 'desk' ? teamEl(a) : zone === 'meeting' ? seatEl(a) : idlerEl(a);
      el.dataset.zone = zone;
      els.set(a.id, el);
    }
    const parent = { desk: $('openspace'), meeting: $('meeting'), lounge: $('lounge') }[zone];
    if (el.parentNode !== parent) parent.appendChild(el);
    seen.add(a.id);
    const cls = `state-${a.state} kind-${a.kind}${state.selected === a.id ? ' selected' : ''}`;
    el.querySelector('.name').textContent = who(a.id).name;
    if (zone === 'lounge') {
      el.className = `idler ${cls}`;
      el.querySelector('.proj').textContent = a.project;
      el.title = a.title;
      continue;
    }
    if (zone === 'meeting') {
      el.className = `seat ${cls}`;
      el.querySelector('.proj').textContent = a.project;
      el.querySelector('.seat-bubble').textContent = a.state === 'blocked' ? '🔐 permission' : a.ask?.type === 'plan' ? '📋 plan' : '❓ question';
      el.title = `${a.title}\n→ ${bubbleText(a)}`;
      continue;
    }
    const pod = el.querySelector('.pod');
    pod.className = `pod boss ${cls}${a.state === 'waiting' && a.kind !== 'ask' && team > 0 ? ' team-busy' : ''}`;
    pod.title = a.title;
    el.querySelector('.team-sign').textContent = a.project + (a.channel ? ' 🔗' : ''); // 🔗 : reliée par le channel
    const b = pod.querySelector('.bubble');
    const t = bubbleText(a, team);
    if (b.textContent !== t) b.textContent = t;
    renderMinis(el, a, interns);
  }
  // départ : animation du carton puis retrait
  for (const [id, el] of els) if (!seen.has(id)) {
    els.delete(id);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 700);
  }

  $('fireAll').hidden = !bosses.some((a) => a.state === 'coffee');
  const empty = $('openspace').querySelector('.empty');
  if (![...els.values()].some((el) => el.dataset.zone === 'desk')) {
    if (!empty) $('openspace').insertAdjacentHTML('beforeend', `<div class="empty">Personne au bureau pour l'instant. Lance <code>claude</code> dans un terminal, ou clique sur « Recruter ».</div>`);
  } else empty?.remove();

  renderStats(bosses, interns);
  state.recentCwds = [...new Set(bosses.map((a) => a.cwd).filter(Boolean))];
}
