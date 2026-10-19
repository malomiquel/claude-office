// Pauses café données à la main.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CLAUDE_OFFICE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'office-test-'));
const { setBreak, applyBreaks } = await import('../lib/breaks.mjs');

test('en pause tant que son transcript ne bouge pas', () => {
  setBreak('a', true);
  const agents = [{ id: 'a', state: 'waiting', kind: 'done' }];
  applyBreaks(agents, new Map([['a', Date.now() - 60_000]]));
  assert.equal(agents[0].state, 'coffee');
  assert.equal(agents[0].onBreak, true);
});

test('retourne au bureau dès qu\'il se remet au travail', () => {
  setBreak('b', true);
  const agents = [{ id: 'b', state: 'working' }];
  applyBreaks(agents, new Map([['b', Date.now() + 10_000]]));
  assert.equal(agents[0].state, 'working');
  applyBreaks(agents, new Map()); // et la pause est oubliée
  assert.equal(agents[0].onBreak, undefined);
});

test('rappelé à son bureau', () => {
  setBreak('c', true);
  setBreak('c', false);
  const agents = [{ id: 'c', state: 'waiting' }];
  applyBreaks(agents, new Map());
  assert.equal(agents[0].state, 'waiting');
});

test('les sous-agents ne vont pas au café', () => {
  setBreak('d', true);
  const agents = [{ id: 'd', parent: 'x', state: 'working' }];
  applyBreaks(agents, new Map());
  assert.equal(agents[0].state, 'working');
});

test('les pauses survivent à un redémarrage', () => {
  setBreak('e', true);
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.CLAUDE_OFFICE_HOME, 'breaks.json'), 'utf8'));
  assert.ok(saved.e);
});
