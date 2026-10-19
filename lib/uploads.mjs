// Fichiers joints depuis la page (images, PDF, texte) : enregistrés dans data/uploads,
// puis signalés à l'agent par leur chemin. L'agent les ouvre avec son outil Read ; le dossier lui est ouvert avec --add-dir.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.mjs';

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// formats que l'outil Read sait lire ; même liste côté page (public/js/attachments.js)
const BY_TYPE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const TEXT_EXT = new Set(['txt', 'md', 'csv', 'json', 'log', 'xml', 'yaml', 'yml', 'html']);
const MAX_FILES = 6;
const MAX_BYTES = 20 * 1024 * 1024;

function extensionOf(f) {
  if (BY_TYPE[f.type]) return BY_TYPE[f.type];
  const ext = String(f.name || '').split('.').pop().toLowerCase();
  return TEXT_EXT.has(ext) ? ext : null;
}

// files : [{ name, type, data (base64) }] -> chemins absolus
export function saveFiles(files) {
  if (!Array.isArray(files) || !files.length) return [];
  if (files.length > MAX_FILES) throw new Error(`${MAX_FILES} fichiers maximum`);
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  return files.map((f) => {
    const ext = extensionOf(f);
    if (!ext) throw new Error(`format non pris en charge : ${f.name || f.type || '?'} (images, PDF, texte)`);
    const buf = Buffer.from(String(f.data || ''), 'base64');
    if (!buf.length || buf.length > MAX_BYTES) throw new Error(`fichier vide ou trop lourd : ${f.name || '?'}`);
    // le nom d'origine (nettoyé) aide l'agent à comprendre de quoi il s'agit
    const stem = String(f.name || 'fichier').replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40) || 'fichier';
    const file = path.join(UPLOADS_DIR, `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}-${stem}.${ext}`);
    fs.writeFileSync(file, buf);
    return file;
  });
}

export function withFiles(prompt, files) {
  if (!files.length) return prompt;
  return `${prompt}\n\nFichiers joints (ouvre-les avec l'outil Read) :\n${files.map((f) => `- ${f}`).join('\n')}`;
}
