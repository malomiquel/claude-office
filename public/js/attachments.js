// Fichiers joints à une consigne ou à un recrutement (images, PDF, texte) : bouton, collage (⌘V)
// et glisser-déposer (routé par main.js). Ils partent en base64 avec la requête ; le serveur les enregistre
// et donne leur chemin à l'agent, qui les ouvre avec son outil Read.

import { esc } from './text.js';

const MAX_FILES = 6;
const MAX_BYTES = 20 * 1024 * 1024;
// formats que l'outil Read sait lire ; même liste côté serveur (lib/uploads.mjs)
const TEXT_EXT = ['txt', 'md', 'csv', 'json', 'log', 'xml', 'yaml', 'yml', 'html'];
const ACCEPT = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', ...TEXT_EXT.map((e) => `.${e}`)].join(',');

const extOf = (name) => String(name || '').split('.').pop().toLowerCase();
const isImage = (f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type);
const isAccepted = (f) => isImage(f) || f.type === 'application/pdf' || TEXT_EXT.includes(extOf(f.name));

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

// Image glissée depuis une page web : pas de fichier, seulement son adresse (uri-list ou <img src> dans le HTML).
function imageUrlFrom(dt) {
  const html = dt.getData('text/html');
  const src = html && new DOMParser().parseFromString(html, 'text/html').querySelector('img')?.src;
  const uri = dt.getData('text/uri-list').split('\n').find((l) => l && !l.startsWith('#'));
  return src || uri || '';
}

async function fetchFile(url) {
  const r = await fetch(url); // marche pour data:, blob: et les sites qui autorisent CORS
  const blob = await r.blob();
  const name = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || '') || 'fichier-web';
  return new File([blob], name, { type: blob.type });
}

// box : conteneur .attach ; pasteTarget : champ qui accepte le collage
export function createAttachments({ box, pasteTarget, onError }) {
  let files = [];
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: ACCEPT, multiple: true, hidden: true });

  const preview = (f) => isImage(f.file)
    ? `<img src="${f.url}" alt="">`
    : `<span class="doc"><b>${esc(extOf(f.name).toUpperCase() || 'FICHIER')}</b><small>${esc(f.name)}</small></span>`;

  function render() {
    box.innerHTML = `<div class="thumbs">${files.map((f, i) =>
      `<div class="thumb${isImage(f.file) ? '' : ' file'}" title="${esc(f.name)}">${preview(f)}<button type="button" data-i="${i}" aria-label="Retirer">✕</button></div>`).join('')}</div>
      <button type="button" class="add-img">📎 Joindre un fichier</button>`;
    box.append(input);
    box.querySelector('.add-img').onclick = () => input.click();
    box.querySelectorAll('.thumb button').forEach((b) => b.onclick = () => {
      const [f] = files.splice(Number(b.dataset.i), 1);
      if (f?.url) URL.revokeObjectURL(f.url);
      render();
    });
  }

  function add(list) {
    let added = 0;
    for (const file of list) {
      if (!isAccepted(file)) { onError?.(`${file.name || 'ce fichier'} : format non pris en charge (images, PDF, texte)`); continue; }
      if (files.length >= MAX_FILES) { onError?.(`${MAX_FILES} fichiers maximum`); break; }
      if (file.size > MAX_BYTES) { onError?.(`${file.name} dépasse 20 Mo`); continue; }
      files.push({ file, name: file.name || 'image-collee.png', url: isImage(file) ? URL.createObjectURL(file) : null });
      added++;
    }
    if (added) { onError?.(''); render(); }
  }

  input.onchange = () => { add(input.files); input.value = ''; };
  pasteTarget.addEventListener('paste', (e) => {
    const pasted = [...(e.clipboardData?.files || [])];
    if (pasted.length) { e.preventDefault(); add(pasted); }
  });

  render();
  return {
    // contenu d'un glisser-déposer : fichiers du Finder, ou image venant d'une page web
    async addFrom(dt) {
      if (dt.files?.length) return add(dt.files);
      const url = imageUrlFrom(dt);
      if (!url) return onError?.('Rien à joindre : glisse un fichier.');
      try { add([await fetchFile(url)]); }
      catch { onError?.('Ce site ne laisse pas récupérer le fichier : enregistre-le, ou copie l\'image (clic droit › Copier l\'image) puis colle-la ici.'); }
    },
    // [{ name, type, data }] avec data en base64, prêt pour l'API
    async payload() {
      return Promise.all(files.map(async (f) => ({ name: f.name, type: f.file.type, data: (await readAsDataUrl(f.file)).split(',')[1] })));
    },
    clear() { files.forEach((f) => f.url && URL.revokeObjectURL(f.url)); files = []; render(); },
  };
}
