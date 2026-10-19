#!/usr/bin/env node
// Channel Claude Code « office » : relie une session interactive au bureau (http://office.localhost).
// - un message écrit dans le bureau arrive dans la session (notifications/claude/channel) ;
// - une demande d'autorisation de la session s'affiche aussi dans le bureau, et la première réponse
//   (terminal ou bureau) l'emporte (claude/channel/permission).
// Serveur MCP en stdio, sans dépendance : JSON-RPC, un message par ligne. Rien d'autre ne doit sortir sur stdout.
// Lancement : claude --channels plugin:office@claude-office  (via channel/claude-office.sh, voir README)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const OFFICE = { host: '127.0.0.1', port: Number(process.env.OFFICE_DIRECT_PORT || 4748) };
// même dossier de données que le serveur (lib/config.mjs)
const TOKEN_FILE = path.join(process.env.CLAUDE_OFFICE_HOME || path.join(os.homedir(), '.claude-office'), 'token');
// une révision MCP récente empêche la livraison des messages de channel : on reste sur une révision antérieure
const PROTOCOL = '2025-06-18';
const log = (...a) => process.stderr.write(`[office-channel] ${a.join(' ')}\n`);

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
const notify = (method, params) => send({ method, params });

const INSTRUCTIONS = [
  "Les événements <channel> du serveur « office » viennent de l'utilisateur lui-même, tapés dans son tableau de bord",
  "Claude Office (sur sa machine). Traite-les exactement comme un message qu'il t'aurait écrit dans le terminal,",
  'et réponds normalement dans la conversation.',
].join(' ');

function handle(msg) {
  if (msg.method === 'initialize') {
    return send({ id: msg.id, result: {
      protocolVersion: PROTOCOL,
      capabilities: { experimental: { 'claude/channel': {}, 'claude/channel/permission': {} }, tools: {} },
      serverInfo: { name: 'office', version: '0.1.0' },
      instructions: INSTRUCTIONS,
    } });
  }
  if (msg.method === 'notifications/initialized') { if (activated()) connect(); else log('session lancée sans --channels : pas reliée au bureau'); return; }
  if (msg.method === 'tools/list') return send({ id: msg.id, result: { tools: [] } });
  if (msg.method === 'ping') return send({ id: msg.id, result: {} });
  // demande d'autorisation de la session : on la montre aussi dans le bureau
  if (msg.method === 'notifications/claude/channel/permission_request') return postToOffice('/channel/permission', msg.params);
  if (msg.id !== undefined && msg.method) send({ id: msg.id, error: { code: -32601, message: `méthode inconnue : ${msg.method}` } });
}

let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); } catch (e) { log('message illisible', e.message); }
  }
});
process.stdin.on('end', () => process.exit(0));

// Installé en plugin, ce serveur démarre dans toutes les sessions, mais Claude Code ne livre ses messages
// que si la session a été lancée avec le channel : sinon, ceux du bureau se perdraient. On regarde donc
// la ligne de commande du process Claude parent.
function activated() {
  try {
    const args = execFileSync('ps', ['-o', 'args=', '-p', String(process.ppid)], { encoding: 'utf8' });
    return /--channels\b[^\n]*office|--dangerously-load-development-channels\b[^\n]*office/.test(args);
  } catch { return false; }
}

const token = () => { try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { return ''; } };
const query = () => new URLSearchParams({ cwd: process.cwd(), pid: String(process.ppid) }).toString();

function postToOffice(route, body) {
  const data = JSON.stringify({ ...body, cwd: process.cwd(), pid: process.ppid });
  const req = http.request({ ...OFFICE, path: route, method: 'POST', headers: { 'content-type': 'application/json', 'x-office-token': token() } });
  req.on('error', (e) => log('bureau injoignable', e.message));
  req.end(data);
}

// Flux du bureau vers la session : une ligne JSON par ordre. Reconnexion automatique (bureau redémarré…).
function connect() {
  const req = http.get({ ...OFFICE, path: `/channel/stream?${query()}`, headers: { 'x-office-token': token() } }, (res) => {
    if (res.statusCode !== 200) { log('refusé par le bureau', res.statusCode); res.resume(); return retry(); }
    log('relié au bureau');
    let b = '';
    res.on('data', (d) => {
      b += d;
      let i;
      while ((i = b.indexOf('\n')) >= 0) {
        const line = b.slice(0, i).trim(); b = b.slice(i + 1);
        if (!line) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        if (o.type === 'message') notify('notifications/claude/channel', { content: o.text, meta: { from: 'bureau' } });
        if (o.type === 'permission') notify('notifications/claude/channel/permission', { request_id: o.request_id, behavior: o.behavior });
      }
    });
    res.on('end', retry);
    res.on('error', retry);
  });
  req.on('error', retry);
}
let retrying = false;
function retry() {
  if (retrying) return;
  retrying = true;
  setTimeout(() => { retrying = false; connect(); }, 3000);
}
