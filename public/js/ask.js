// Carte « question pour toi » du panneau.
// Cliquable quand le hook tient la question en direct (state.agents[].ask.live), sinon lecture seule (réponse dans le terminal).

import { state, findAgent, rerender } from './state.js';
import { $, esc, plain, tilde, fmtTime } from './text.js';
import { post } from './api.js';

const drafts = {}; // id de la question -> { [texte de la question]: [labels choisis] | texte libre }
let sentId = null; // id de la question à laquelle on vient de répondre

function questionHtml(q, qi, live) {
  const options = live
    ? `<div class="opts" role="${q.multiSelect ? 'group' : 'radiogroup'}">${q.options.map((o, oi) => `
        <button type="button" class="opt" data-o="${oi}" role="${q.multiSelect ? 'checkbox' : 'radio'}" aria-checked="false">
          <i class="mark ${q.multiSelect ? 'sq' : ''}"></i><span><b>${esc(plain(o.label))}</b>${o.description ? `<small>${esc(plain(o.description))}</small>` : ''}</span>
        </button>`).join('')}
        <input class="other" type="text" placeholder="Autre réponse…">
      </div>`
    : `<ol>${q.options.map((o) => `<li><b>${esc(plain(o.label))}</b>${o.description ? `<span>${esc(plain(o.description))}</span>` : ''}</li>`).join('')}</ol>`;
  return `<div class="q" data-q="${qi}">
      ${q.header ? `<span class="chip">${esc(q.header)}</span>` : ''}
      <p>${esc(plain(q.question))}</p>
      ${options}
      ${q.multiSelect ? '<em>Plusieurs choix possibles</em>' : ''}
    </div>`;
}

function cardHtml(a, ask, live) {
  const head = (label) => `<div class="ask-head"><span class="tag">${label}</span>${live ? '<span class="countdown"></span>' : `<time>${fmtTime(ask.ts)}</time>`}</div>`;
  let html;
  if (ask.type === 'permission') {
    html = head('🔐 Autorisation demandée')
      + `<div class="perm"><span class="chip">${esc(ask.tool)}</span>${ask.why ? `<p>${esc(ask.why)}</p>` : ''}<pre class="perm-what">${esc(ask.what)}</pre></div>`
      + `<textarea class="reason" rows="2" placeholder="Si tu refuses : pourquoi, ou quoi faire à la place ? (optionnel)"></textarea>
         <div class="ask-actions"><button class="btn" data-act="allow">Autoriser</button><button class="btn ghost" data-act="deny">Refuser</button></div>`;
  } else if (ask.type === 'plan') {
    html = head('📋 Plan à valider') + `<pre class="plan">${esc(plain(ask.plan))}</pre>`
      + (live ? `<textarea class="reason" rows="2" placeholder="Si tu refuses : quoi changer ? (optionnel)"></textarea>
         <div class="ask-actions"><button class="btn" data-act="approve">Approuver le plan</button><button class="btn ghost" data-act="deny">Refuser</button></div>` : '');
  } else {
    html = head(`❓ ${ask.questions.length > 1 ? `${ask.questions.length} questions pour toi` : 'Question pour toi'}`)
      + ask.questions.map((q, qi) => questionHtml(q, qi, live)).join('')
      + (live ? '<div class="ask-actions"><button class="btn" data-act="send" disabled>Envoyer la réponse</button></div>' : '');
  }
  if (ask.relay) return html + `<div class="ask-foot">🔗 Aussi affichée dans son terminal : réponds où tu veux, la première réponse compte.</div><div class="err ask-err"></div>`;
  return html + (live
    ? `<div class="ask-foot">${sentId === ask.id ? '✓ Réponse envoyée, l\'agent reprend…' : 'Sans réponse ici, la demande repasse dans le terminal à la fin du décompte.'}
         <button type="button" class="linkish" data-act="release">Répondre dans le terminal</button></div><div class="err ask-err"></div>`
    : `<div class="ask-foot">⌨️ Pour répondre, va dans le <b>terminal</b> de cette session${a.cwd ? ` (<code>${esc(tilde(a.cwd))}</code>)` : ''}.</div>`);
}

export function renderAsk(a) {
  const box = $('pAsk');
  const ask = a.ask;
  const live = !!ask?.live;
  const html = ask ? cardHtml(a, ask, live) : '';
  if (box.dataset.html === html) return; // même contenu : on garde le DOM (et les sélections en cours)
  box.dataset.html = html;
  box.hidden = !html;
  box.innerHTML = html;
  box.classList.toggle('live', live);
  if (live) wire(box, ask);
}

function wire(box, ask) {
  const draft = drafts[ask.id] ||= {};
  const err = (m) => { box.querySelector('.ask-err').textContent = m; };
  const answered = () => ask.type !== 'questions' || ask.questions.every((q) => {
    const v = draft[q.question];
    return Array.isArray(v) ? v.length : String(v ?? '').trim();
  });
  const sync = () => {
    box.querySelectorAll('.q').forEach((qEl) => {
      const q = ask.questions[qEl.dataset.q];
      const v = draft[q.question];
      qEl.querySelectorAll('.opt').forEach((b) => {
        const on = Array.isArray(v) && v.includes(q.options[b.dataset.o].label);
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on);
      });
      const other = qEl.querySelector('.other');
      if (typeof v === 'string' && document.activeElement !== other) other.value = v;
    });
    const send = box.querySelector('[data-act="send"]');
    if (send) send.disabled = !answered() || sentId === ask.id;
  };
  box.querySelectorAll('.q').forEach((qEl) => {
    const q = ask.questions[qEl.dataset.q];
    qEl.querySelectorAll('.opt').forEach((b) => b.onclick = () => {
      const label = q.options[b.dataset.o].label;
      const cur = Array.isArray(draft[q.question]) ? draft[q.question] : [];
      draft[q.question] = q.multiSelect ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label];
      sync();
    });
    qEl.querySelector('.other').oninput = (e) => { draft[q.question] = e.target.value; sync(); };
  });
  const act = async (body) => {
    err('');
    try { await post('answer', { id: ask.id, ...body }); sentId = ask.id; box.dataset.html = ''; rerender(); }
    catch (e) { err(e.message); }
  };
  box.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => {
    const k = b.dataset.act;
    if (k === 'send') act({ answers: draft });
    if (k === 'approve') act({ decision: 'approve' });
    if (k === 'allow') act({ decision: 'allow' });
    if (k === 'deny') act({ decision: 'deny', reason: box.querySelector('.reason').value });
    if (k === 'release') act({ release: true });
  });
  sync();
}

// décompte avant que la question reparte dans le terminal
export function startCountdown() {
  setInterval(() => {
    const el = document.querySelector('#pAsk.live .countdown');
    const ask = state.selected && findAgent(state.selected)?.ask;
    if (!el || !ask?.deadline) return;
    const s = Math.max(0, Math.round((ask.deadline - Date.now()) / 1000));
    el.textContent = `encore ${s} s`;
    el.classList.toggle('low', s <= 15);
  }, 500);
}
