#!/usr/bin/env node
// Démarre le serveur Claude Office s'il ne tourne pas (hook SessionStart du plugin), ou le relance
// quand une autre version tourne (mise à jour du plugin) — jamais pendant qu'un agent du bureau travaille.
// --open : ouvre aussi le bureau dans le navigateur (commande /office).
// Doit rester rapide et silencieux : il s'exécute au démarrage de chaque session Claude Code.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
const DATA_DIR = process.env.CLAUDE_OFFICE_HOME || path.join(os.homedir(), '.claude-office');
const DIRECT_PORT = Number(process.env.DIRECT_PORT || 4748);
const URL_PAGE = `http://localhost:${process.env.PORT || 4747}`;
const URL_PORT80 = 'http://office.localhost'; // option macOS (scripts/setup-port80.sh)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function health() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: DIRECT_PORT, path: '/health', timeout: 800 }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function start() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const log = fs.openSync(path.join(DATA_DIR, 'server.log'), 'a');
  // détaché : survit à la fin du hook et de la session
  spawn(process.execPath, [path.join(ROOT, 'server.mjs')], { detached: true, stdio: ['ignore', log, log], env: process.env }).unref();
}

function responds(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 800 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// l'adresse sans port si elle est installée, sinon le port de la page
async function openPage() {
  const url = (await responds(`${URL_PORT80}/`)) ? URL_PORT80 : URL_PAGE;
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  return url;
}

const h = await health();
if (!h) start();
else if (h.version !== VERSION && !h.busy) {
  try { process.kill(h.pid, 'SIGTERM'); } catch {}
  for (let i = 0; i < 20 && (await health()); i++) await sleep(150);
  start();
}
if (process.argv.includes('--open')) {
  for (let i = 0; i < 20 && !(await health()); i++) await sleep(150);
  console.log(`Claude Office : ${await openPage()}`);
}
