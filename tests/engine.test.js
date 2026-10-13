'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../js/engine.js');

const line = (x, y, dx, length) => Array.from({ length }, (_, i) => ({ x: x - dx * i, y }));

function game(snakes, food = { x: 0, y: 0 }) {
  return new Game({ width: 10, height: 10, snakes, food, random: () => 0 });
}

test('a new game puts both snakes face to face and spawns food on a free cell', () => {
  const g = new Game({ random: () => 0.5 });
  assert.deepEqual(g.snake(1).body[0], { x: 5, y: 12 });
  assert.deepEqual(g.snake(2).body[0], { x: 19, y: 12 });
  assert.equal(g.snake(1).body.length, 3);
  const occupied = g.snakes.flatMap((s) => s.body);
  assert.ok(!occupied.some((p) => p.x === g.food.x && p.y === g.food.y));
});

test('snakes keep going straight on missing, unknown or reversing moves', () => {
  const g = game([
    { body: line(3, 2, 1, 3), dir: 'right' },
    { body: line(3, 7, 1, 3), dir: 'right' },
  ]);
  g.step(['left', 'sideways']);
  assert.deepEqual(g.snake(1).body[0], { x: 4, y: 2 });
  assert.deepEqual(g.snake(2).body[0], { x: 4, y: 7 });
  assert.equal(g.snake(1).dir, 'right');
});

test('eating grows the snake, refills health and respawns the food', () => {
  const g = game(
    [
      { body: line(3, 2, 1, 3), dir: 'right', health: 40 },
      { body: line(3, 7, 1, 3), dir: 'right' },
    ],
    { x: 4, y: 2 }
  );
  const events = g.step(['right', 'right']);
  assert.deepEqual(events.ate.map((e) => e.id), [1]);
  assert.equal(g.snake(1).body.length, 4);
  assert.equal(g.snake(1).health, 100);
  assert.notDeepEqual(g.food, { x: 4, y: 2 });
});

test('health drops every tick and a snake starves at zero', () => {
  const g = game([
    { body: line(3, 2, 1, 3), dir: 'right', health: 1 },
    { body: line(3, 7, 1, 3), dir: 'right' },
  ]);
  const events = g.step(['right', 'right']);
  assert.deepEqual(events.deaths.map((d) => [d.id, d.cause]), [[1, 'starved']]);
  assert.equal(events.winner, 2);
  assert.equal(g.snake(2).health, 99);
});

test('deaths are resolved at the same time', () => {
  // P1 leaves the board while P2 runs into P1's body in the same tick: both die.
  const g = game([
    { body: [{ x: 9, y: 5 }, { x: 8, y: 5 }, { x: 7, y: 5 }], dir: 'right' },
    { body: [{ x: 8, y: 4 }, { x: 8, y: 3 }, { x: 8, y: 2 }], dir: 'down' },
  ]);
  const events = g.step(['right', 'down']);
  assert.deepEqual(
    events.deaths.map((d) => [d.id, d.cause]),
    [[1, 'wall'], [2, 'collision']]
  );
  assert.equal(events.winner, null);
  assert.equal(g.over, true);
});

test('head-on: the longer snake survives, equals both die', () => {
  const longer = game([
    { body: line(3, 5, 1, 4), dir: 'right' },
    { body: line(5, 5, -1, 3), dir: 'left' },
  ]);
  let events = longer.step(['right', 'left']);
  assert.deepEqual(events.deaths.map((d) => [d.id, d.cause]), [[2, 'head-on']]);
  assert.equal(events.winner, 1);

  const equal = game([
    { body: line(3, 5, 1, 3), dir: 'right' },
    { body: line(5, 5, -1, 3), dir: 'left' },
  ]);
  events = equal.step(['right', 'left']);
  assert.equal(events.deaths.length, 2);
  assert.equal(events.winner, null);
});

test('moving into a tail that moves away is safe, biting yourself is not', () => {
  // A 2x2 loop: the head follows the tail around.
  const g = game([
    { body: [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 2 }], dir: 'up' },
    { body: line(3, 8, 1, 3), dir: 'right' },
  ]);
  assert.equal(g.step(['right', 'right']).deaths.length, 0);

  const bite = game([
    { body: [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 2 }, { x: 3, y: 1 }], dir: 'up' },
    { body: line(3, 8, 1, 3), dir: 'right' },
  ]);
  assert.deepEqual(bite.step(['right', 'right']).deaths.map((d) => d.cause), ['self']);
});

test('stateFor gives each brain its own point of view, as a copy', () => {
  const g = new Game({ random: () => 0.5 });
  const state = g.stateFor(2);
  assert.deepEqual(state.me.body[0], g.snake(2).body[0]);
  assert.deepEqual(state.enemy.body[0], g.snake(1).body[0]);
  assert.deepEqual(state.board, { width: 25, height: 25 });
  state.me.body[0].x = 99;
  assert.notEqual(g.snake(2).body[0].x, 99);
});
