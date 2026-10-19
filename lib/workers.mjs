// Agents pilotés par le bureau : un process `claude -p` en entrée stream-json qui reste ouvert.
// On peut lui écrire un nouveau message à tout moment ; s'il travaille, Claude Code le met en file
// et le traite juste après, comme quand on tape dans le terminal pendant qu'il bosse.
// Aussi : le sélecteur de dossier du Finder.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { UPLOADS_DIR } from './uploads.mjs';
import { DATA_DIR } from './config.mjs';

// '' = pas de --permission-mode : l'agent garde le mode de tes réglages (ex. auto)
const MODES = new Set(['default', 'acceptEdits', 'plan', 'bypassPermissions']);
const normMode = (m) => (MODES.has(m) ? m : '');
const IDLE_CLOSE_MS = 20 * 60_000; // un agent sans message depuis 20 min libère son process

const workers = new Map(); // sessionId -> worker

// Sessions lancées un jour par le bureau, gardées sur disque : une session « claude -p » qui n'en fait pas partie
// est une automatisation (ex. résumés lancés par un hook) et n'a pas sa place dans l'open space.
const HIRED_FILE = path.join(DATA_DIR, 'hired.json');
const everHired = new Set();
try { for (const id of JSON.parse(fs.readFileSync(HIRED_FILE, 'utf8'))) everHired.add(id); } catch {}
function rememberHired(id) {
  if (everHired.has(id)) return;
  everHired.add(id);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HIRED_FILE, JSON.stringify([...everHired]));
}
export const wasHired = (id) => everHired.has(id);
const listeners = new Set();
const changed = () => { for (const fn of listeners) fn(); };
export const onWorkersChange = (fn) => listeners.add(fn);

const alive = (w) => !!w && w.proc.exitCode === null && !w.proc.killed;
export const isHired = (id) => workers.has(id);
export const isRunning = (id) => alive(workers.get(id));
export const isBusy = (id) => isRunning(id) && workers.get(id).pending > 0;
export const workerMode = (id) => (isRunning(id) ? workers.get(id).mode : null);

function write(w, text) {
  w.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n');
  w.pending++;
  clearTimeout(w.idleTimer);
}

// Démarre un agent (nouveau, ou reprise d'une session avec resume) et lui envoie ses premiers messages.
export function startWorker({ cwd, resume, mode, messages }) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
  if (normMode(mode)) args.push('--permission-mode', normMode(mode));
  if (resume) args.push('--resume', resume);
  args.push('--add-dir', UPLOADS_DIR); // fichiers joints ; --add-dir est variadique : toujours en dernier
  const proc = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
  const w = { proc, mode: normMode(mode), pending: 0, idleTimer: null, ids: new Set() };
  if (resume) { w.ids.add(resume); workers.set(resume, w); }

  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      // le session id d'un nouvel agent arrive dans le message d'init
      if (m.session_id && !w.ids.has(m.session_id)) { w.ids.add(m.session_id); workers.set(m.session_id, w); rememberHired(m.session_id); changed(); }
      if (m.type === 'result') {
        w.pending = Math.max(0, w.pending - 1);
        if (!w.pending) w.idleTimer = setTimeout(() => proc.stdin.end(), IDLE_CLOSE_MS);
        changed();
      }
    }
  });
  proc.stderr.on('data', (d) => process.stderr.write(`[claude ${proc.pid}] ${d}`));
  proc.stdin.on('error', () => {}); // process déjà fermé
  proc.on('exit', () => { clearTimeout(w.idleTimer); for (const id of w.ids) if (workers.get(id) === w) workers.delete(id); changed(); });
  proc.on('error', (e) => console.error('spawn claude:', e.message));

  for (const text of messages) write(w, text);
  changed();
  return w;
}

// Les autorisations sont fixées au lancement : pour en changer, on relance l'agent sur la même session.
export function restartWorker(id, { cwd, mode, messages }) {
  const w = workers.get(id);
  if (!alive(w)) return startWorker({ cwd, resume: id, mode, messages });
  w.proc.once('exit', () => startWorker({ cwd, resume: id, mode, messages }));
  w.proc.stdin.end();
}

// Envoie à un agent déjà en ligne ; false s'il n'y en a pas pour cette session.
export function sendToWorker(id, text) {
  const w = workers.get(id);
  if (!alive(w)) return false;
  write(w, text);
  changed();
  return true;
}

// arrête le process lancé par le bureau pour cette session ; false s'il n'y en a pas
export function stopWorker(id) {
  const w = workers.get(id);
  if (!alive(w)) return false;
  w.proc.kill('SIGINT');
  return true;
}

// Sélecteur de dossier natif (le navigateur ne donne pas les chemins absolus) : Finder sur macOS,
// zenity ou kdialog sur Linux. Le dossier de départ passe en argument, jamais interpolé dans une commande.
const PICK_SCRIPT = [
  'on run argv',
  'activate',
  'set p to POSIX path of (choose folder with prompt "Dossier de travail de l\'agent" default location (POSIX file (item 1 of argv)))',
  'return p',
  'end run',
];
const PICKERS = process.platform === 'darwin'
  ? [['osascript', (start) => [...PICK_SCRIPT.flatMap((l) => ['-e', l]), start]]]
  : [
    ['zenity', (start) => ['--file-selection', '--directory', '--title=Dossier de travail de l\'agent', `--filename=${start.replace(/\/?$/, '/')}`]],
    ['kdialog', (start) => ['--getexistingdirectory', start, '--title', 'Dossier de travail de l\'agent']],
  ];

function tryPicker([cmd, args], start) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args(start), { timeout: 5 * 60_000 }, (err, stdout, stderr) => {
      if (err?.code === 'ENOENT') return resolve(null); // pas installé : on essaie le suivant
      // annulé : code -128 (osascript) ou sortie 1 (zenity, kdialog)
      if (err) return /-128/.test(stderr) || err.code === 1 ? resolve({ cancelled: true }) : reject(new Error('impossible d\'ouvrir le sélecteur de dossier'));
      resolve({ path: stdout.trim().replace(/\/$/, '') });
    });
  });
}

export async function pickFolder(start) {
  for (const p of PICKERS) {
    const r = await tryPicker(p, start);
    if (r) return r;
  }
  return { unavailable: true }; // la page propose alors de saisir le chemin
}
