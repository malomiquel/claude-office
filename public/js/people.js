// Identité et sprite pixel art de chaque employé, dérivés de son id de session (toujours les mêmes).

const NAMES = ['Camille','Léa','Hugo','Inès','Nathan','Chloé','Louis','Manon','Jules','Zoé','Arthur','Lina','Gabriel','Jade','Raphaël','Emma','Adam','Alice','Noah','Rose','Sacha','Lou','Théo','Mila','Tom','Nina','Paul','Eva','Victor','Anna'];
const SKIN = ['#f5d0b0','#e8b48f','#c98e66','#a26b45','#7a4d30','#f2c9a5'];
const HAIR = ['#2b1d16','#5a3824','#a8642c','#e3c16f','#1b1b22','#8f3b2e','#c9c3bb','#6d4a8f'];
const SHIRT = ['#e8915b','#6fb3f2','#7bd389','#c59af2','#ef6f6c','#f2c14e','#4fc1b5','#e86fa8','#8892f0'];

function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

export function who(id) {
  const h = hash(id);
  return {
    name: NAMES[h % NAMES.length],
    skin: SKIN[(h >>> 5) % SKIN.length],
    hair: HAIR[(h >>> 9) % HAIR.length],
    shirt: SHIRT[(h >>> 13) % SHIRT.length],
    style: (h >>> 17) % 4,
    glasses: ((h >>> 20) % 4) === 0,
  };
}

// sprite 10×17, '.' = vide
const HEAD = [
  '..hhhhhh..',
  '.hhhhhhhh.',
  '.hssssssh.',
  '.sesssses.',
  '.ssssssss.',
  '.sssmmsss.',
  '..ssssss..',
];
const BODY = [
  '..bbccbb..',
  '.bbbbbbbb.',
  '.bbbbbbbb.',
  '.bbbbbbbb.',
  '.bbbbbbbb.',
  '..pppppp..',
  '..pppppp..',
  '..pp..pp..',
  '..pp..pp..',
  '.fff..fff.',
];

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

// legs: false pour le perso assis derrière son bureau ; mug: true au coin café
export function sprite(id, { mug = false, legs = true } = {}) {
  const w = who(id);
  const col = { h: w.hair, s: w.skin, e: '#231d2b', m: shade(w.skin, .75), b: w.shirt, c: '#f3ece2', p: '#3c3f5a', f: '#231d2b' };
  let r = '';
  [...HEAD, ...BODY].forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.' || (!legs && y > 11)) return;
    const fill = ch === 'b' && x === 8 ? shade(w.shirt, .8) : col[ch];
    r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
  }));
  // coiffures
  const H = (x, y, wd = 1, ht = 1) => `<rect x="${x}" y="${y}" width="${wd}" height="${ht}" fill="${w.hair}"/>`;
  if (w.style === 1) r += H(1, 3, 1, 4) + H(8, 3, 1, 4); // cheveux longs
  if (w.style === 2) r += H(9, 2, 1, 3);                  // queue de cheval
  if (w.style === 3) r += H(2, -1, 6, 1);                 // volume
  if (w.glasses) r += `<rect x="1" y="3" width="8" height="1" fill="none" stroke="#231d2b" stroke-width=".25"/>`;
  // bras (animés par le CSS selon l'état)
  const sleeve = shade(w.shirt, .85);
  const arm = (x) => `<rect x="${x}" y="8" width="1" height="4" fill="${sleeve}"/><rect x="${x}" y="12" width="1" height="1" fill="${w.skin}"/>`;
  r += `<g class="arm-l">${arm(0)}</g><g class="arm-r">${arm(9)}</g>`;
  // bras levé : décollé de la tête pour ne pas ressembler à une mèche
  r += `<g class="hand-up"><rect x="9" y="8" width="1" height="1" fill="${sleeve}"/><rect x="10" y="3" width="1" height="6" fill="${sleeve}"/><rect x="10" y="2" width="1" height="1" fill="${w.skin}"/></g>`;
  if (mug) r += `<rect x="9.6" y="11" width="1.4" height="1.6" fill="#f3ece2"/><rect x="9.8" y="11.2" width="1" height=".4" fill="#6b3e22"/>`;
  const vh = legs ? 17 : 12;
  return `<svg viewBox="0 -1 11 ${vh + 1}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}
