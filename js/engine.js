/*
 * AutoSnake rules engine.
 * Pure game logic (no DOM, no timers) so it runs in the browser and in Node tests.
 */
(function (root, factory) {
  'use strict';
  const SnakeEngine = factory();
  if (typeof module === 'object' && module.exports) module.exports = SnakeEngine;
  else root.SnakeEngine = SnakeEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VECTORS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

  const DEFAULTS = { width: 25, height: 25, startLength: 3, maxHealth: 100 };

  const same = (a, b) => a.x === b.x && a.y === b.y;
  const copyCell = (c) => ({ x: c.x, y: c.y });

  function createSnake(id, head, dir, length, health) {
    const v = VECTORS[dir];
    const body = [];
    for (let i = 0; i < length; i++) body.push({ x: head.x - v.x * i, y: head.y - v.y * i });
    return { id, body, dir, health, alive: true, eaten: 0 };
  }

  // A move keeps the snake going straight when it is missing, unknown,
  // or would reverse the snake into its own neck.
  function resolveMove(move, current) {
    if (typeof move !== 'string' || !VECTORS[move]) return current;
    if (move === OPPOSITE[current]) return current;
    return move;
  }

  class Game {
    constructor(options = {}) {
      const cfg = Object.assign({}, DEFAULTS, options);
      this.width = cfg.width;
      this.height = cfg.height;
      this.maxHealth = cfg.maxHealth;
      this.random = cfg.random || Math.random;
      this.tick = 0;
      this.over = false;
      this.winner = null;
      this.deaths = [];

      const midY = Math.floor(this.height / 2);
      const starts = cfg.snakes || [
        { head: { x: 5, y: midY }, dir: 'right' },
        { head: { x: this.width - 6, y: midY }, dir: 'left' },
      ];
      this.snakes = starts.map((s, i) => {
        if (s.body) {
          return {
            id: i + 1,
            body: s.body.map(copyCell),
            dir: s.dir,
            health: s.health ?? this.maxHealth,
            alive: true,
            eaten: 0,
          };
        }
        return createSnake(i + 1, s.head, s.dir, cfg.startLength, this.maxHealth);
      });

      this.food = cfg.food ? copyCell(cfg.food) : this.spawnFood();
    }

    snake(id) {
      return this.snakes.find((s) => s.id === id);
    }

    inside(cell) {
      return cell.x >= 0 && cell.y >= 0 && cell.x < this.width && cell.y < this.height;
    }

    spawnFood() {
      const taken = new Set();
      for (const s of this.snakes) for (const p of s.body) taken.add(p.y * this.width + p.x);
      const free = [];
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          if (!taken.has(y * this.width + x)) free.push({ x, y });
        }
      }
      if (!free.length) return null;
      return free[Math.floor(this.random() * free.length)];
    }

    // What a brain gets to see. Both brains receive a snapshot of the same
    // moment, so neither one can react to the other's move.
    stateFor(id) {
      const view = (s) => ({
        body: s.body.map(copyCell),
        dir: s.dir,
        health: s.health,
      });
      const me = this.snake(id);
      const enemy = this.snakes.find((s) => s.id !== id);
      return {
        tick: this.tick,
        board: { width: this.width, height: this.height },
        food: this.food ? copyCell(this.food) : null,
        me: view(me),
        enemy: view(enemy),
      };
    }

    // Advances one tick. `moves` holds one direction per snake, in order.
    // Every snake moves at the same time; deaths are resolved together.
    step(moves = []) {
      if (this.over) return null;
      this.tick++;
      const events = { tick: this.tick, ate: [], deaths: [], over: false, winner: null };

      const tails = this.snakes.map((s, i) => {
        s.dir = resolveMove(moves[i], s.dir);
        const v = VECTORS[s.dir];
        const head = s.body[0];
        s.body.unshift({ x: head.x + v.x, y: head.y + v.y });
        s.health -= 1;
        return s.body.pop();
      });

      if (this.food) {
        this.snakes.forEach((s, i) => {
          if (!same(s.body[0], this.food)) return;
          s.body.push(tails[i]); // grow: the tail stays where it was
          s.health = this.maxHealth;
          s.eaten++;
          events.ate.push({ id: s.id, at: copyCell(this.food) });
        });
        if (events.ate.length) this.food = null;
      }

      for (const s of this.snakes) {
        const cause = this.deathCause(s);
        if (cause) events.deaths.push({ id: s.id, cause, at: copyCell(s.body[0]) });
      }
      for (const d of events.deaths) this.snake(d.id).alive = false;

      if (events.deaths.length) {
        const survivors = this.snakes.filter((s) => s.alive);
        this.over = true;
        this.winner = survivors.length === 1 ? survivors[0].id : null;
        this.deaths = events.deaths;
        events.over = true;
        events.winner = this.winner;
      } else if (!this.food) {
        this.food = this.spawnFood();
      }
      return events;
    }

    deathCause(s) {
      const head = s.body[0];
      if (!this.inside(head)) return 'wall';
      if (s.health <= 0) return 'starved';
      for (let i = 1; i < s.body.length; i++) if (same(s.body[i], head)) return 'self';
      for (const other of this.snakes) {
        if (other === s) continue;
        for (let i = 1; i < other.body.length; i++) if (same(other.body[i], head)) return 'collision';
        // Head-on: the longer snake survives, equal lengths both die.
        if (same(other.body[0], head) && other.body.length >= s.body.length) return 'head-on';
      }
      return null;
    }
  }

  return { Game, VECTORS, OPPOSITE, DEFAULTS, resolveMove };
});
