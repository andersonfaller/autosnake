'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SnakeRuntime = require('../js/runtime.js');
const { Game } = require('../js/engine.js');

const line = (x, y, dx, length) => Array.from({ length }, (_, i) => ({ x: x - dx * i, y }));

// Runs `code` once against a small board and returns the result.
function think(code, { me, enemy, food = { x: 0, y: 0 }, memory = {}, size = 10 } = {}) {
  const g = new Game({
    width: size,
    height: size,
    food,
    snakes: [
      me || { body: line(4, 5, 1, 3), dir: 'right' },
      enemy || { body: line(4, 8, 1, 3), dir: 'right' },
    ],
  });
  const compiled = SnakeRuntime.compile(code);
  assert.ok(compiled.ok, compiled.error && compiled.error.message);
  return SnakeRuntime.run(compiled.fn, g.stateFor(1), memory);
}

const value = (expr, options) => {
  const result = think('log(JSON.stringify(' + expr + '));', options);
  assert.equal(result.error, null, result.error && result.error.message);
  return JSON.parse(result.logs[0]);
};

test('returns directions as words, case-insensitive', () => {
  assert.equal(think("return 'UP';").move, 'up');
  assert.equal(think('return turnRight();').move, 'down');
});

test('nothing, unknown moves and reversing keep the snake straight with a warning', () => {
  assert.equal(think('').move, null);
  const unknown = think("return 'north';");
  assert.equal(unknown.move, null);
  assert.match(unknown.warning, /north/);
  const reverse = think("return 'left';");
  assert.equal(reverse.move, null);
  assert.match(reverse.warning, /reverse/);
});

test('scripts written for the original gameState API still work', () => {
  const result = think('const { me, food } = gameState;\nreturn { x: 0, y: -1 };');
  assert.equal(result.error, null);
  assert.equal(result.move, 'up');
});

test('direction helpers', () => {
  assert.equal(value("turnLeft('up')"), 'left');
  assert.equal(value("turnRight('left')"), 'up');
  assert.equal(value('opposite()'), 'left');
  assert.deepEqual(value("neighbor('up')"), { x: 4, y: 4 });
  assert.deepEqual(value("neighbor({x: 1, y: 1}, 'down')"), { x: 1, y: 2 });
  assert.equal(value('distance({x: 0, y: 0}, {x: 3, y: 4})'), 7);
});

test('senses: whatsAt, look, isSafe, safeMoves', () => {
  const options = { food: { x: 7, y: 5 } };
  assert.equal(value('whatsAt(-1, 0)', options), 'wall');
  assert.equal(value('whatsAt(me.tail)', options), 'me');
  assert.equal(value('whatsAt(enemy.head)', options), 'enemy');
  assert.equal(value('whatsAt(food)', options), 'food');
  assert.deepEqual(value('look()', options), { thing: 'food', distance: 3, cell: { x: 7, y: 5 } });
  assert.equal(value("look('up').thing", options), 'wall');
  assert.deepEqual(value('safeMoves()', options), ['right', 'up', 'down']);

  // Facing the wall: straight ahead is no longer safe.
  const cornered = { me: { body: line(9, 0, 1, 3), dir: 'right' } };
  assert.deepEqual(value('safeMoves()', cornered), ['down']);
  assert.equal(value("isSafe('right')", cornered), false);
});

test('tails count as free, unless the enemy may grow this tick', () => {
  const enemy = { body: [{ x: 6, y: 6 }, { x: 6, y: 7 }, { x: 5, y: 7 }], dir: 'up' };
  const me = { body: [{ x: 5, y: 8 }, { x: 4, y: 8 }, { x: 3, y: 8 }], dir: 'right' };
  assert.equal(value("isSafe('up')", { me, enemy }), true); // enemy tail at (5,7) moves away
  assert.equal(value("isSafe('up')", { me, enemy, food: { x: 6, y: 5 } }), false); // ...unless it eats
});

test('isRisky flags cells the enemy head can reach when it is not shorter', () => {
  const me = { body: line(4, 5, 1, 3), dir: 'right' };
  const enemy = { body: [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }], dir: 'left' };
  assert.equal(value("isRisky('right')", { me, enemy }), true);
  assert.equal(value("isRisky('up')", { me, enemy }), false);
  const shorterEnemy = { body: [{ x: 6, y: 5 }, { x: 7, y: 5 }], dir: 'left' };
  assert.equal(value("isRisky('right')", { me, enemy: shorterEnemy }), false);
});

test('planning: pathTo, toward, space, best, safest', () => {
  const options = { food: { x: 4, y: 2 } };
  assert.deepEqual(value('pathTo(food)', options), [
    { x: 4, y: 4 },
    { x: 4, y: 3 },
    { x: 4, y: 2 },
  ]);
  assert.equal(value('toward(food)', options), 'up');
  assert.equal(value('pathTo(me.body[1])', options), null);
  assert.equal(value('toward(null)', options), null);

  // Walled in on the right by the enemy: room is what is left of the board.
  assert.equal(value("space('left')", options), 0);
  assert.ok(value("space('up')", options) > 80);
  assert.equal(value("best(dir => dir === 'down' ? 1 : 0)", options), 'down');
  assert.equal(value("best(['a', 'b'], x => x === 'b')", options), 'b');
  assert.ok(['right', 'up', 'down'].includes(value('safest()', options)));
});

test('safest avoids dead ends', () => {
  // Going up enters a one-cell pocket: the enemy's tail stays put because it is
  // about to eat, so the pocket has no way out.
  const me = { body: [{ x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }], dir: 'up' };
  const enemy = { body: [{ x: 3, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }], dir: 'right' };
  const options = { me, enemy, food: { x: 4, y: 0 } };
  assert.equal(value("space('up')", options), 1);
  assert.equal(think('return safest();', options).move, 'right');
});

test('memory survives between ticks', () => {
  const memory = {};
  think('memory.count = (memory.count ?? 0) + 1;', { memory });
  think('memory.count = (memory.count ?? 0) + 1;', { memory });
  assert.equal(memory.count, 2);
});

test('say, mark and log are collected for the page', () => {
  const result = think("say('hi', 3); mark([{x: 1, y: 1}, null], 'gold'); mark(null); log('a', {b: 1});");
  assert.equal(result.say, 'hi 3');
  assert.deepEqual(result.marks, [{ x: 1, y: 1, color: 'gold' }]);
  assert.deepEqual(result.logs, ['a {"b":1}']);
});

test('runtime errors are caught and point to the line in the user code', () => {
  const result = think('const a = 1;\n\nnull.x;');
  assert.equal(result.move, null);
  assert.match(result.error.message, /TypeError/);
  assert.equal(result.error.line, 3);

  const helper = think("\nneighbor('upp');");
  assert.match(helper.error.message, /not a direction/);
  assert.equal(helper.error.line, 2);
});

test('the world is read-only and accidental globals are errors', () => {
  assert.match(think('me.head.x = 3;').error.message, /read only|read-only/);
  assert.match(think('oops = 1;').error.message, /oops is not defined/);
});

test('syntax errors are reported by compile', () => {
  const compiled = SnakeRuntime.compile('if (');
  assert.equal(compiled.ok, false);
  assert.match(compiled.error.message, /SyntaxError/);
});

test('the runtime can be rebuilt from its source (as the Web Worker does)', () => {
  const rebuilt = eval(SnakeRuntime.source);
  assert.equal(typeof rebuilt.startWorker, 'function');
  assert.equal(rebuilt.LINE_OFFSET, SnakeRuntime.LINE_OFFSET);
});
