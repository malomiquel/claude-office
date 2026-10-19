#!/usr/bin/env node
// Branché sur la barre de statut de Claude Code pour récupérer le quota (5 h / semaine) :
//   "statusLine": { "type": "command", "command": "node ~/.claude-office/statusline-tap.mjs [ta commande d'origine]" }
// Recopie `rate_limits` dans ~/.claude-office/rate-limits.json, puis passe la main à ta barre de statut d'origine
// (même entrée, même sortie). Sans commande d'origine, n'affiche rien. Installé par /office-setup.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DATA_DIR = process.env.CLAUDE_OFFICE_HOME || path.join(os.homedir(), '.claude-office');
const chunks = [];
process.stdin.on('data', (d) => chunks.push(d));
process.stdin.on('end', () => {
  const input = Buffer.concat(chunks);
  try {
    const { rate_limits } = JSON.parse(input.toString('utf8'));
    if (rate_limits) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const file = path.join(DATA_DIR, 'rate-limits.json');
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ rate_limits, updated_at: Date.now() / 1000 }));
      fs.renameSync(`${file}.tmp`, file); // écriture atomique : le serveur ne lit jamais un fichier à moitié écrit
    }
  } catch {}
  const original = process.argv.slice(2).join(' ').trim();
  if (!original) return;
  const child = spawn(original, { shell: true, stdio: ['pipe', 'inherit', 'inherit'] });
  child.on('exit', (code) => process.exit(code ?? 0));
  child.stdin.end(input);
});
