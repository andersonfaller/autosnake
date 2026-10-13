'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SnakeRuntime = require('../js/runtime.js');
const { Game } = require('../js/engine.js');
const bots = require('../js/bots.js');
const docs = require('../js/docs.js');

function seeded(seed) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function play(a, b, seed) {
  const game = new Game({ random: seeded(seed) });
  const brains = [a, b].map((bot) => SnakeRuntime.compile(bot.code).fn);
  const memories = [{}, {}];
  while (!game.over && game.tick < 3000) {
    const results = [1, 2].map((id, i) => SnakeRuntime.run(brains[i], game.stateFor(id), memories[i]));
    for (const [i, result] of results.entries()) {
      assert.equal(result.error, null, [a, b][i].id + ': ' + (result.error && result.error.message));
    }
    game.step(results.map((r) => r.move));
  }
  return game;
}

test('every preset compiles', () => {
  for (const bot of bots) assert.ok(SnakeRuntime.compile(bot.code).ok, bot.id);
});

test('every preset plays full rounds against every other without errors', () => {
  for (const a of bots) {
    for (const b of bots) {
      if (a !== b) play(a, b, a.id.length * 31 + b.id.length);
    }
  }
});

test('smart presets beat the random one', () => {
  const wanderer = bots.find((b) => b.id === 'wanderer');
  for (const id of ['greedy', 'cautious', 'hunter']) {
    const bot = bots.find((b) => b.id === id);
    let wins = 0;
    for (let seed = 1; seed <= 6; seed++) if (play(bot, wanderer, seed).winner === 1) wins++;
    assert.ok(wins >= 4, id + ' won only ' + wins + '/6');
  }
});

test('the docs cover every name a brain can use', () => {
  const documented = new Set(docs.sections.flatMap((s) => s.entries.map((e) => e.name)));
  const legacy = new Set(['gameState']);
  for (const name of SnakeRuntime.GLOBALS) {
    if (!legacy.has(name)) assert.ok(documented.has(name), name + ' is not documented');
  }
  for (const name of documented) assert.ok(SnakeRuntime.GLOBALS.includes(name), name + ' is documented but missing');
});
