// Lecture des transcripts : états, messages du channel, outils, consommation.
// node --test   (depuis la racine du projet)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// jamais les vraies données : config.mjs crée le jeton dans ce dossier
process.env.CLAUDE_OFFICE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'office-test-'));
const { channelText, classifyTool, deriveState, newAcc, consume } = await import('../lib/transcripts.mjs');

const talk = { kind: 'talk', text: 'fini' };
const tool = { kind: 'terminal', text: '$ npm test' };

test('chef : au travail, fini, en pause', () => {
  assert.equal(deriveState({ age: 5, last: tool }).state, 'working');
  assert.equal(deriveState({ age: 30, last: talk, lastStop: 'end_turn' }).state, 'waiting');
  assert.equal(deriveState({ age: 700, last: talk, lastStop: 'end_turn' }).state, 'coffee');
});

test('chef : une commande longue reste du travail, pas une attente', () => {
  const s = deriveState({ age: 300, last: tool });
  assert.equal(s.state, 'working');
  assert.match(s.activity, /en cours/);
});

test('chef : permission en attente', () => {
  const s = deriveState({ age: 10, last: tool, permission: { message: 'Claude needs your permission to use Bash' } });
  assert.equal(s.state, 'blocked');
});

test('chef interrompu : il attend tes ordres', () => {
  const s = deriveState({ age: 10, last: tool, interrupted: true });
  assert.equal(s.state, 'waiting');
  assert.match(s.activity, /interrompu/);
});

test('sous-agent : quitte le bureau après son rapport ou une interruption', () => {
  assert.equal(deriveState({ isSub: true, age: 5, last: tool }).state, 'working');
  assert.equal(deriveState({ isSub: true, age: 5, last: tool, handedBack: true }).state, 'done');
  assert.equal(deriveState({ isSub: true, age: 5, last: tool, interrupted: true }).state, 'done');
});

test('message reçu par le channel, en plugin ou en dev', () => {
  assert.equal(channelText({ content: '<channel source="plugin:office:office" from="bureau">\nCoucou\n</channel>' }), 'Coucou');
  assert.equal(channelText({ content: '<channel source="office">salut</channel>' }), 'salut');
  assert.equal(channelText({ content: '<channel source="plugin:imessage:imessage">non</channel>' }), null);
  assert.equal(channelText({ content: 'texte normal' }), null);
});

test('outils classés par activité', () => {
  assert.equal(classifyTool('Edit', { file_path: '/a/b/c.js' }).kind, 'code');
  assert.equal(classifyTool('Bash', { command: 'cd /x && npm test' }).text, '$ npm test');
  assert.equal(classifyTool('mcp__claude-in-chrome__navigate', { url: 'https://example.com/a' }).kind, 'web');
  assert.equal(classifyTool('AskUserQuestion').kind, 'ask');
});

test('consommation : un message écrit en plusieurs lignes ne compte qu\'une fois', () => {
  const acc = newAcc();
  const line = (id, output) => ({ type: 'assistant', message: { id, content: [], usage: { input_tokens: 10, output_tokens: output, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 } } });
  consume(acc, line('m1', 2));
  consume(acc, line('m1', 40)); // même message, usage final
  consume(acc, line('m2', 7));
  assert.deepEqual(acc.used, { input: 20, output: 47, cacheRead: 200, cacheWrite: 10 });
});

test('interruption puis nouveau message : il se remet au travail', () => {
  const acc = newAcc();
  consume(acc, { type: 'user', message: { content: '[Request interrupted by user]' } });
  assert.equal(acc.interrupted, true);
  consume(acc, { type: 'user', message: { content: 'continue' } });
  assert.equal(acc.interrupted, false);
});
