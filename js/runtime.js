/*
 * SnakeScript runtime: turns the code typed in an editor into a snake brain.
 *
 * A brain is the body of a function that runs once per tick and returns a
 * direction. It sees the world through a small vocabulary (me, food, isSafe,
 * toward, space, say, mark...) defined here.
 *
 * The factory below is self-contained on purpose: it is stringified and booted
 * inside a Web Worker, so user code never touches the page or the game state.
 */
(function (root, factory) {
  'use strict';
  const SnakeRuntime = factory();
  SnakeRuntime.source = '(' + factory.toString() + ')()';
  if (typeof module === 'object' && module.exports) module.exports = SnakeRuntime;
  else root.SnakeRuntime = SnakeRuntime;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';

  const DIRECTIONS = ['up', 'down', 'left', 'right'];
  const VECTORS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const LEFT_OF = { up: 'left', left: 'down', down: 'right', right: 'up' };
  const RIGHT_OF = { up: 'right', right: 'down', down: 'left', left: 'up' };

  const LIMITS = { say: 40, log: 200, logsPerTick: 20, marksPerTick: 625 };

  // Every name a brain can use without declaring it.
  const GLOBALS = [
    'me', 'enemy', 'food', 'board', 'tick', 'memory', 'directions',
    'turnLeft', 'turnRight', 'opposite', 'neighbor', 'distance', 'whatsAt', 'look',
    'isSafe', 'isRisky', 'safeMoves', 'pathTo', 'toward', 'space', 'best', 'safest',
    'random', 'chance', 'say', 'mark', 'log', 'gameState',
  ];

  // User code lives in its own block, so it may redeclare any of the globals
  // (scripts written for the original API start with `const { me } = gameState`).
  const PRELUDE = '"use strict"; const { ' + GLOBALS.join(', ') + ' } = __api; {';

  function wrap(code) {
    return PRELUDE + '\n' + code + '\n}';
  }

  // --- error reporting -----------------------------------------------------

  // Stack frames of code built with `new Function`:
  //   V8:     "... <anonymous>:5:6)"     Firefox: "... > Function:5:6"
  const FRAME = /(?:<anonymous>|> Function):(\d+):\d+/;

  function frameLine(error) {
    const match = FRAME.exec(String(error && error.stack));
    return match ? Number(match[1]) : null;
  }

  // Lines the engine adds in front of the user's first line, measured once.
  const LINE_OFFSET = (function () {
    try {
      new Function('__api', wrap('throw new Error("probe")'))({});
    } catch (error) {
      const line = frameLine(error);
      return line === null ? null : line - 1;
    }
    return null;
  })();

  function userLine(error) {
    const line = frameLine(error);
    return line === null || LINE_OFFSET === null ? null : line - LINE_OFFSET;
  }

  function describe(error, line) {
    const message = error instanceof Error ? error.name + ': ' + error.message : 'Thrown: ' + show(error);
    return { message, line: line ?? null };
  }

  function show(value) {
    if (typeof value === 'string') return value;
    if (value === undefined) return 'undefined';
    if (typeof value === 'function') return '[function ' + (value.name || 'anonymous') + ']';
    try {
      const json = JSON.stringify(value);
      return json === undefined ? String(value) : json;
    } catch (_) {
      return String(value);
    }
  }

  // --- values --------------------------------------------------------------

  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
  }

  // Accepts 'up' | 'down' | 'left' | 'right' (any case), or a legacy {x, y} vector.
  function toDirection(value) {
    if (typeof value === 'string') {
      const dir = value.trim().toLowerCase();
      return VECTORS[dir] ? dir : null;
    }
    if (value && typeof value.x === 'number' && typeof value.y === 'number') {
      const x = Math.sign(value.x);
      const y = Math.sign(value.y);
      if (Math.abs(x) + Math.abs(y) !== 1) return null;
      return DIRECTIONS.find((d) => VECTORS[d].x === x && VECTORS[d].y === y);
    }
    return null;
  }

  function dirArg(value, fn) {
    const dir = typeof value === 'string' ? toDirection(value) : null;
    if (!dir) {
      throw new TypeError(fn + "(): " + show(value) + " is not a direction. Use 'up', 'down', 'left' or 'right'.");
    }
    return dir;
  }

  function isCell(value) {
    return !!value && Number.isFinite(value.x) && Number.isFinite(value.y);
  }

  function cellArg(value, fn) {
    if (!isCell(value)) throw new TypeError(fn + '(): expected a cell like {x: 3, y: 7}, got ' + show(value) + '.');
    return value;
  }

  // --- the vocabulary ------------------------------------------------------

  function createApi(state, memory, out) {
    const { width, height } = state.board;
    const view = (s) => {
      const body = s.body.map((p) => ({ x: p.x, y: p.y }));
      return deepFreeze({
        head: body[0],
        tail: body[body.length - 1],
        body,
        length: body.length,
        dir: s.dir,
        health: s.health,
      });
    };
    const me = view(state.me);
    const enemy = view(state.enemy);
    const food = state.food ? deepFreeze({ x: state.food.x, y: state.food.y }) : null;
    const board = deepFreeze({ width, height });

    const inside = (c) => c.x >= 0 && c.y >= 0 && c.x < width && c.y < height;
    const key = (c) => c.y * width + c.x;
    const same = (a, b) => a.x === b.x && a.y === b.y;
    const gap = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

    // What is on each cell right now.
    const contents = new Array(width * height).fill('empty');
    if (food) contents[key(food)] = 'food';
    for (const p of me.body) if (inside(p)) contents[key(p)] = 'me';
    for (const p of enemy.body) if (inside(p)) contents[key(p)] = 'enemy';

    // Cells that will still be occupied after everyone moves. Tails move away,
    // unless the enemy is next to the food and might grow this tick.
    const blocked = new Uint8Array(width * height);
    const block = (s, keepTail) => {
      s.body.forEach((p, i) => {
        if (inside(p) && (keepTail || i < s.body.length - 1)) blocked[key(p)] = 1;
      });
    };
    block(me, false);
    block(enemy, !!food && gap(enemy.head, food) === 1);
    const free = (c) => inside(c) && !blocked[key(c)];

    const step = (c, dir) => ({ x: c.x + VECTORS[dir].x, y: c.y + VECTORS[dir].y });

    function turnLeft(dir = me.dir) {
      return LEFT_OF[dirArg(dir, 'turnLeft')];
    }

    function turnRight(dir = me.dir) {
      return RIGHT_OF[dirArg(dir, 'turnRight')];
    }

    function opposite(dir = me.dir) {
      return OPPOSITE[dirArg(dir, 'opposite')];
    }

    function neighbor(dir, from = me.head) {
      if (isCell(dir) && typeof from === 'string') [dir, from] = [from, dir]; // neighbor(cell, dir) works too
      const d = dirArg(dir, 'neighbor');
      const c = cellArg(from, 'neighbor');
      return step(c, d);
    }

    function distance(a, b = me.head) {
      return gap(cellArg(a, 'distance'), cellArg(b, 'distance'));
    }

    function whatsAt(x, y) {
      const c = typeof x === 'number' ? cellArg({ x, y }, 'whatsAt') : cellArg(x, 'whatsAt');
      return inside(c) ? contents[key(c)] : 'wall';
    }

    function look(dir = me.dir) {
      const d = dirArg(dir, 'look');
      let cell = me.head;
      for (let steps = 1; ; steps++) {
        cell = step(cell, d);
        const thing = whatsAt(cell);
        if (thing !== 'empty') return { thing, distance: steps, cell };
      }
    }

    function isSafe(dir) {
      const d = dirArg(dir, 'isSafe');
      return d !== OPPOSITE[me.dir] && free(step(me.head, d));
    }

    function isRisky(dir) {
      const cell = step(me.head, dirArg(dir, 'isRisky'));
      const enemyNeck = enemy.body[1];
      return (
        inside(cell) &&
        enemy.length >= me.length &&
        gap(cell, enemy.head) === 1 &&
        !(enemyNeck && same(cell, enemyNeck))
      );
    }

    function safeMoves() {
      return [me.dir, LEFT_OF[me.dir], RIGHT_OF[me.dir]].filter(isSafe);
    }

    function pathTo(target, from = me.head) {
      if (target == null) return null;
      const goal = cellArg(target, 'pathTo');
      const start = cellArg(from, 'pathTo');
      if (same(goal, start)) return [];
      if (!inside(start) || !free(goal)) return null;

      const startKey = key(start);
      const goalKey = key(goal);
      const cameFrom = new Int32Array(width * height).fill(-1);
      cameFrom[startKey] = startKey;
      const queue = [startKey];
      for (let i = 0; i < queue.length && cameFrom[goalKey] === -1; i++) {
        const k = queue[i];
        const here = { x: k % width, y: Math.floor(k / width) };
        for (const d of DIRECTIONS) {
          const next = step(here, d);
          if (!free(next) || cameFrom[key(next)] !== -1) continue;
          cameFrom[key(next)] = k;
          queue.push(key(next));
        }
      }
      if (cameFrom[goalKey] === -1) return null;

      const path = [];
      for (let k = goalKey; k !== startKey; k = cameFrom[k]) {
        path.push({ x: k % width, y: Math.floor(k / width) });
      }
      return path.reverse();
    }

    function toward(target) {
      const path = pathTo(target);
      if (!path || !path.length) return null;
      return DIRECTIONS.find((d) => same(step(me.head, d), path[0]));
    }

    const roomCache = {};
    function space(dir) {
      const d = dirArg(dir, 'space');
      if (d in roomCache) return roomCache[d];
      let count = 0;
      if (isSafe(d)) {
        const start = step(me.head, d);
        const seen = new Uint8Array(width * height);
        seen[key(start)] = 1;
        const stack = [start];
        while (stack.length) {
          const cell = stack.pop();
          count++;
          for (const n of DIRECTIONS) {
            const next = step(cell, n);
            if (free(next) && !seen[key(next)]) {
              seen[key(next)] = 1;
              stack.push(next);
            }
          }
        }
      }
      roomCache[d] = count;
      return count;
    }

    function best(scoreFn, options) {
      if (Array.isArray(scoreFn) && typeof options === 'function') [scoreFn, options] = [options, scoreFn];
      if (typeof scoreFn !== 'function') {
        throw new TypeError('best(): pass a scoring function, e.g. best(dir => space(dir)).');
      }
      const list = options === undefined ? safeMoves() : options;
      if (!Array.isArray(list)) throw new TypeError('best(): the options must be a list, e.g. safeMoves().');
      let winner = null;
      let top = -Infinity;
      for (const option of list) {
        let score = Number(scoreFn(option));
        if (Number.isNaN(score)) score = -Infinity;
        if (winner === null || score > top) {
          winner = option;
          top = score;
        }
      }
      return winner;
    }

    function safest() {
      const moves = safeMoves();
      if (!moves.length) return me.dir; // nothing is safe: brace for impact
      const roomy = moves.filter((d) => space(d) >= me.length);
      const calm = roomy.filter((d) => !isRisky(d));
      return best(space, calm.length ? calm : roomy.length ? roomy : moves);
    }

    function random(list) {
      if (!Array.isArray(list) || !list.length) return null;
      return list[Math.floor(Math.random() * list.length)];
    }

    function chance(probability) {
      return Math.random() < probability;
    }

    function say(...parts) {
      out.say = parts.map(show).join(' ').slice(0, LIMITS.say);
    }

    function mark(cells, color) {
      if (cells == null) return;
      for (const c of Array.isArray(cells) ? cells : [cells]) {
        if (c == null) continue;
        if (out.marks.length >= LIMITS.marksPerTick) break;
        const cell = cellArg(c, 'mark');
        out.marks.push({ x: cell.x, y: cell.y, color: typeof color === 'string' ? color.slice(0, 40) : null });
      }
    }

    function log(...values) {
      if (out.logs.length < LIMITS.logsPerTick) out.logs.push(values.map(show).join(' ').slice(0, LIMITS.log));
    }

    // The original API, kept so older scripts keep working.
    const gameState = deepFreeze({
      me: { head: me.head, body: me.body, dir: { x: VECTORS[me.dir].x, y: VECTORS[me.dir].y } },
      enemy: { head: enemy.head, body: enemy.body },
      food,
      board: { cols: width, rows: height },
    });

    return {
      me, enemy, food, board, tick: state.tick, memory, directions: Object.freeze(DIRECTIONS.slice()),
      turnLeft, turnRight, opposite, neighbor, distance, whatsAt, look,
      isSafe, isRisky, safeMoves, pathTo, toward, space, best, safest,
      random, chance, say, mark, log, gameState,
    };
  }

  // --- compiling and running -----------------------------------------------

  function compile(code) {
    if (typeof code !== 'string') return { ok: false, error: { message: 'No code to run.', line: null } };
    try {
      return { ok: true, fn: new Function('__api', wrap(code)) };
    } catch (error) {
      return { ok: false, error: describe(error, null) };
    }
  }

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function emptyResult() {
    return { move: null, say: null, marks: [], logs: [], error: null, warning: null, ms: 0 };
  }

  function normalizeMove(result, current, out) {
    if (result === undefined || result === null) return null;
    const move = toDirection(result);
    if (!move) {
      out.warning = 'Ignored move ' + show(result) + " - return 'up', 'down', 'left' or 'right'.";
      return null;
    }
    if (move === OPPOSITE[current]) {
      out.warning = "Can't reverse into your own neck - kept going '" + current + "'.";
      return null;
    }
    return move;
  }

  // Runs one tick of a compiled brain. Never throws: problems are reported in the result.
  function run(fn, state, memory) {
    const out = emptyResult();
    const started = now();
    try {
      const api = createApi(state, memory, out);
      out.move = normalizeMove(fn(api), api.me.dir, out);
    } catch (error) {
      out.move = null;
      out.error = describe(error, userLine(error));
    }
    out.ms = now() - started;
    return out;
  }

  // Message loop used inside the Web Worker.
  function startWorker(scope) {
    let brain = null;
    let memory = {};
    scope.onmessage = function (event) {
      const msg = event.data || {};
      if (msg.type === 'load') {
        const compiled = compile(msg.code);
        if (compiled.ok) brain = compiled.fn;
        scope.postMessage({ id: msg.id, ok: compiled.ok, error: compiled.error || null });
      } else if (msg.type === 'reset') {
        memory = {};
      } else if (msg.type === 'think') {
        let result;
        if (brain) {
          result = run(brain, msg.state, memory);
        } else {
          result = emptyResult();
          result.error = { message: 'No working code loaded yet.', line: null };
        }
        scope.postMessage({ id: msg.id, result });
      }
    };
  }

  return { DIRECTIONS, GLOBALS, LINE_OFFSET, wrap, compile, run, toDirection, startWorker };
});
