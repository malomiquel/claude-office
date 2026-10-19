// L'open space et le coin café : un îlot par équipe (chef + petits bureaux des sous-agents), les compteurs de l'en-tête.

import { state } from './state.js';
import { $, esc, plain, short } from './text.js';
import { who, sprite } from './people.js';
import { select } from './panel.js';

const ICON = { code: '⌨️', terminal: '🖥️', web: '🌐', read: '📄', think: '💭', delegate: '📣', plan: '📋', ask: '✋', tool: '🔧', talk: '💬', done: '✅' };
const els = new Map(); // id -> îlot de l'open space (réutilisé pour ne pas relancer les animations)
const awayEls = new Map(); // id -> sa place en salle de réunion ou au coin café
const zones = new Map(); // id -> où il était au rendu précédent (pour le faire marcher quand ça change)
const walkers = new Map(); // id -> perso en train de marcher
const miniWalkers = new Map(); // id -> sous-agent en train d'arriver
const calm = matchMedia('(prefers-reduced-motion: reduce)');
let rendered = false; // premier rendu : tout le monde est déjà à sa place, personne ne marche

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
  box.querySelectorAll('.mini').forEach((m) => {
    if (keep.has(m.dataset.id)) return;
    // rapport rendu : il repart par la porte
    const body = !calm.matches && m.querySelector('.char');
    if (body) { const from = toWorld(body.getBoundingClientRect()); stroll(m.dataset.id, from, entrance(from.w), from.w, () => {}); }
    m.remove();
  });
  const arrivals = [];
  for (const i of mine) {
    let m = box.querySelector(`.mini[data-id="${i.id}"]`);
    if (!m) { m = miniEl(i); box.appendChild(m); if (rendered && !calm.matches) arrivals.push(m); }
    m.className = `mini state-${i.state} kind-${i.kind}${state.selected === i.id ? ' selected' : ''}${miniWalkers.has(i.id) ? ' arriving' : ''}`;
    m.title = `${who(i.id).name} · ${i.agentType || 'sous-agent'}\n${plain(i.title)}\n→ ${plain(i.activity)}`;
    m.querySelector('.mini-bubble').textContent = ICON[i.kind] || '•';
    m.querySelector('.mini-name').textContent = who(i.id).name;
  }
  team.classList.toggle('has-minis', mine.length > 0);
  // nouveau sous-agent : il entre par la porte et va s'asseoir à son petit bureau
  for (const m of arrivals) {
    const id = m.dataset.id;
    const to = toWorld(m.querySelector('.char').getBoundingClientRect());
    m.classList.add('arriving');
    const w = stroll(id, entrance(to.w), to, to.w, () => { miniWalkers.delete(id); box.querySelector(`.mini[data-id="${id}"]`)?.classList.remove('arriving'); });
    if (w) miniWalkers.set(id, w);
  }
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

// où est le perso : à son bureau, en salle de réunion (il t'attend et son équipe a fini) ou au café (en pause)
function zoneOf(a, team) {
  if (a.state === 'coffee') return 'lounge';
  return (isAsk(a) || a.state === 'blocked') && !team ? 'meeting' : 'desk';
}

// range les éléments d'un conteneur dans l'ordre des chefs (ordre des ids), sans toucher à ceux déjà en place
function keepOrder(box, bosses, map) {
  let prev = null;
  for (const a of bosses) {
    const el = map.get(a.id);
    if (el?.parentNode !== box) continue;
    const want = prev ? prev.nextElementSibling : box.firstElementChild;
    if (want !== el) box.insertBefore(el, want);
    prev = el;
  }
}

const leave = (el) => { el.classList.add('leaving'); setTimeout(() => el.remove(), 700); };

// le perso à sa place dans une zone : au bureau (son îlot) ou ailleurs (salle de réunion, café)
const placeOf = (id, zone) => (zone === 'desk' ? els.get(id)?.querySelector('.pod') : awayEls.get(id)) || null;
const bodyOf = (place) => place?.querySelector(':scope > .char, :scope > svg');

// rectangle d'écran -> coordonnées du monde (la caméra translate et zoome #world)
function toWorld(r) {
  const world = $('world');
  const w = world.getBoundingClientRect();
  const z = w.width / world.offsetWidth || 1;
  return { x: (r.left - w.left) / z, y: (r.top - w.top) / z, w: r.width / z };
}

// Un perso traverse le bureau à pied d'un point à un autre (coordonnées du monde) ; done() à l'arrivée ou à l'annulation.
function stroll(id, from, to, width, done) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 8) { done(); return null; }
  const el = document.createElement('div');
  el.className = `walker${dx < 0 ? ' left' : ''}`;
  el.style.width = `${width}px`;
  el.innerHTML = sprite(id, { legs: true });
  $('world').appendChild(el);
  const anim = el.animate(
    [{ transform: `translate(${from.x}px, ${from.y}px)` }, { transform: `translate(${to.x}px, ${to.y}px)` }],
    { duration: Math.min(3000, Math.max(800, dist * 4)), easing: 'linear' },
  );
  const end = () => { el.remove(); done(); };
  anim.onfinish = end;
  return { cancel: () => { anim.cancel(); end(); } };
}

// la porte de l'open space : on arrive et on repart par là
function entrance(width) {
  const r = toWorld(document.querySelector('.entrance').getBoundingClientRect());
  return { x: r.x + r.w / 2 - width / 2, y: r.y - width * 1.6 };
}

// Il va à pied de son ancienne place à la nouvelle ; la nouvelle reste vide jusqu'à son arrivée.
function walk(id, from, zone) {
  walkers.get(id)?.cancel();
  const body = bodyOf(placeOf(id, zone));
  if (!from || !body) return;
  const to = toWorld(body.getBoundingClientRect());
  const w = stroll(id, from, to, to.w, () => { walkers.delete(id); placeOf(id, zones.get(id))?.classList.remove('arriving'); });
  if (w) walkers.set(id, w);
}

export function renderOffice() {
  const bosses = state.agents.filter((a) => !a.parent).sort((x, y) => x.id.localeCompare(y.id));
  const interns = state.agents.filter((a) => a.parent);
  const seen = new Set();
  const moves = [];

  for (const a of bosses) {
    seen.add(a.id);
    const team = interns.filter((i) => i.parent === a.id && busyIntern(i)).length;
    const zone = zoneOf(a, team);
    const cls = `state-${a.state} kind-${a.kind}${state.selected === a.id ? ' selected' : ''}`;
    // il change d'endroit : on note d'où il part avant de toucher au DOM
    const was = zones.get(a.id);
    if (!was && rendered && !calm.matches) moves.push({ id: a.id, zone, from: 'door' });
    else if (was && was !== zone && !calm.matches) {
      const body = bodyOf(placeOf(a.id, was));
      moves.push({ id: a.id, zone, from: body && toWorld(body.getBoundingClientRect()) });
    }
    zones.set(a.id, zone);

    // l'îlot reste toujours dans l'open space : parti en réunion ou au café, son bureau reste vide
    let island = els.get(a.id);
    if (!island) { island = teamEl(a); els.set(a.id, island); $('openspace').appendChild(island); }
    const away = zone !== 'desk';
    island.classList.toggle('away', away);
    island.querySelector('.name').textContent = who(a.id).name;
    island.querySelector('.team-sign').textContent = a.project + (a.channel ? ' 🔗' : ''); // 🔗 : reliée par le channel
    const pod = island.querySelector('.pod');
    pod.className = away ? `pod boss away${state.selected === a.id ? ' selected' : ''}`
      : `pod boss ${cls}${a.state === 'waiting' && a.kind !== 'ask' && team > 0 ? ' team-busy' : ''}`;
    const b = pod.querySelector('.bubble');
    const t = zone === 'meeting' ? '📋 en réunion' : zone === 'lounge' ? '☕ en pause' : bubbleText(a, team);
    if (b.textContent !== t) b.textContent = t;
    pod.title = `${a.title}\n→ ${t}`;
    pod.dataset.agent = away ? '' : a.id; // où le trouver (raccourcis clavier)
    renderMinis(island, a, interns);

    // sa présence ailleurs : une place à la table de réunion, ou au coin café
    let other = awayEls.get(a.id);
    if (other && other.dataset.zone !== zone) { other.remove(); awayEls.delete(a.id); other = null; }
    if (walkers.has(a.id)) placeOf(a.id, zone)?.classList.add('arriving'); // className vient d'être réécrit
    if (!away) continue;
    if (!other) {
      other = zone === 'meeting' ? seatEl(a) : idlerEl(a);
      other.dataset.zone = zone;
      awayEls.set(a.id, other);
      (zone === 'meeting' ? $('meeting') : $('lounge')).appendChild(other);
    }
    other.className = `${zone === 'meeting' ? 'seat' : 'idler'} ${cls}`;
    other.querySelector('.name').textContent = who(a.id).name;
    other.querySelector('.proj').textContent = a.project;
    if (zone === 'meeting') {
      other.querySelector('.seat-bubble').textContent = a.state === 'blocked' ? '🔐 permission' : a.ask?.type === 'plan' ? '📋 plan' : '❓ question';
      other.title = `${a.title}\n→ ${bubbleText(a)}`;
    } else other.title = a.title;
    other.dataset.agent = a.id;
    if (walkers.has(a.id)) other.classList.add('arriving');
  }

  keepOrder($('openspace'), bosses, els);
  keepOrder($('meeting'), bosses, awayEls);
  keepOrder($('lounge'), bosses, awayEls);

  // départ du bureau (viré, ou session terminée depuis longtemps) : animation du carton puis retrait
  for (const [id, el] of els) if (!seen.has(id)) { els.delete(id); leave(el); }
  for (const [id, el] of awayEls) if (!seen.has(id)) { awayEls.delete(id); el.remove(); }
  for (const id of zones.keys()) if (!seen.has(id)) { zones.delete(id); walkers.get(id)?.cancel(); }

  // une fois le DOM à jour (places d'arrivée connues), ceux qui ont changé d'endroit y vont à pied
  for (const m of moves) {
    if (m.from === 'door') {
      const b = bodyOf(placeOf(m.id, m.zone));
      m.from = entrance(b ? toWorld(b.getBoundingClientRect()).w : 38);
    }
    walk(m.id, m.from, m.zone);
    if (walkers.has(m.id)) placeOf(m.id, m.zone).classList.add('arriving');
  }

  $('fireAll').hidden = !bosses.some((a) => a.state === 'coffee');
  const empty = $('openspace').querySelector('.empty');
  if (!els.size) {
    if (!empty) $('openspace').insertAdjacentHTML('beforeend', `<div class="empty">Personne au bureau pour l'instant. Lance <code>claude</code> dans un terminal, ou clique sur « Recruter ».</div>`);
  } else empty?.remove();

  if (bosses.length) rendered = true;
  renderStats(bosses, interns);
  state.recentCwds = [...new Set(bosses.map((a) => a.cwd).filter(Boolean))];
}
