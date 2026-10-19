// Réglages et chemins partagés par tous les modules du serveur.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;

// Données hors du dossier du plugin : celui-ci change à chaque mise à jour (~/.claude/plugins/cache/…/<version>).
// Même dossier lu par le channel (channel/office-channel.mjs) et les scripts.
export const DATA_DIR = process.env.CLAUDE_OFFICE_HOME || path.join(os.homedir(), '.claude-office');
// anciennes installations : données dans <projet>/data, recopiées une fois
const LEGACY_DATA = path.join(ROOT, 'data');
if (!fs.existsSync(DATA_DIR) && fs.existsSync(LEGACY_DATA)) fs.cpSync(LEGACY_DATA, DATA_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

// PORT reçoit la redirection pf du port 80 (http://office.localhost).
// DIRECT_PORT sert aux accès directs (hook, scripts) : une connexion directe sur PORT peut tomber
// sur un état pf d'une ancienne connexion redirigée (même port client) et rester bloquée.
export const PORT = Number(process.env.PORT || 4747);
export const DIRECT_PORT = Number(process.env.DIRECT_PORT || 4748);
export const HOST = process.env.HOST || '127.0.0.1';

export const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
// quota 5 h / semaine : écrit par scripts/statusline-tap.mjs (branché sur la barre de statut, voir /office-setup)
export const QUOTA_FILES = [path.join(DATA_DIR, 'rate-limits.json'), path.join(os.homedir(), '.claude', 'statusline', 'rate-limits.json')];

export const WINDOW_MIN = Number(process.env.OFFICE_WINDOW_MIN || 120); // sessions visibles si actives depuis < N min
export const ASK_WAIT_MS = Number(process.env.OFFICE_ASK_WAIT_S || 90) * 1000;
export const REFRESH_MS = 1500;

// injecté dans la page ; exigé sur chaque POST /api/* pour qu'un site web quelconque ne pilote pas Claude via localhost.
// Gardé dans data/token : un onglet déjà ouvert reste valide après un redémarrage du serveur.
function loadToken() {
  const file = path.join(DATA_DIR, 'token');
  try { const t = fs.readFileSync(file, 'utf8').trim(); if (/^[a-f0-9]{32}$/.test(t)) return t; } catch {}
  const t = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, t, { mode: 0o600 });
  return t;
}
export const TOKEN = loadToken();
