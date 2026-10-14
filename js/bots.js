/*
 * Ready-made brains. Each one shows off a different part of SnakeScript.
 */
(function (root, factory) {
  'use strict';
  const bots = factory();
  if (typeof module === 'object' && module.exports) module.exports = bots;
  else root.SnakeBots = bots;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  return [
    {
      id: 'starter',
      name: 'Starter',
      code: `// STARTER - your first snake brain.
// This code runs once per tick.
// Return where to go next:
//   'up', 'down', 'left' or 'right'.
// "? API" lists the whole language and
// Ctrl+Space autocompletes.

// Is there a safe path to the food?
// Show it on the board and follow it.
const path = pathTo(food);
if (path) {
  mark(path);
  return toward(food);
}

// No path? Go where there is most room.
say('hmm...');
return safest();
`,
    },
    {
      id: 'greedy',
      name: 'Greedy',
      code: `// GREEDY - the shortest brain that works.
// Chase the food; when it is out of reach, find room to breathe.
return toward(food) ?? safest();
`,
    },
    {
      id: 'cautious',
      name: 'Cautious',
      code: `// CAUTIOUS - scores every safe move and never walks into a trap.
// Room to live comes first; the hungrier it gets, the more food matters.

const hunger = (100 - me.health) / 10;

return best(dir => {
  let score = 0;
  const room = space(dir);
  if (room < me.length * 2) score -= 10000;   // dead end ahead
  if (isRisky(dir)) score -= 5000;            // enemy could bite

  const path = pathTo(food, neighbor(dir));
  const steps = path ? path.length : 100;
  return score + room / 20 - steps * (1 + hunger);
}) ?? me.dir;
`,
    },
    {
      id: 'hunter',
      name: 'Hunter',
      code: `// HUNTER - eats until it is bigger, then goes for the head.
// Head-on collisions are won by the LONGER snake.

const fed = me.health > 30;

if (fed && me.length > enemy.length) {
  // Every cell the enemy's head could move into next tick.
  const targets = directions
    .map(dir => neighbor(dir, enemy.head))
    .filter(cell => ['empty', 'food'].includes(whatsAt(cell)))
    .sort((a, b) => distance(a) - distance(b));

  for (const target of targets) {
    const dir = toward(target);
    if (dir && space(dir) >= me.length) {
      memory.hunts = (memory.hunts ?? 0) + 1;
      say('HUNT!');
      mark(target, 'red');
      return dir;
    }
  }
}

const dir = toward(food);
if (dir && !isRisky(dir) && space(dir) >= me.length) {
  mark(pathTo(food));
  return dir;
}
return safest();
`,
    },
    {
      id: 'patient',
      name: 'Patient',
      code: `// PATIENT - circles its own tail (always safe!) and only leaves
// the loop when it is hungry or when it would win the race to the food.

const hungry = me.health < 60;
const winsRace = distance(food) < distance(food, enemy.head);

if (hungry || winsRace) {
  const dir = toward(food);
  if (dir && !isRisky(dir) && space(dir) >= me.length) {
    say(hungry ? 'snack time' : 'mine!');
    return dir;
  }
}

// The tail moves out of the way every tick, so chasing it is safe.
mark(me.tail, 'cyan');
return toward(me.tail) ?? safest();
`,
    },
    {
      id: 'wanderer',
      name: 'Wanderer',
      code: `// WANDERER - a carefree sparring partner.
// Mostly goes straight, sometimes turns for no reason.

if (isSafe(me.dir) && chance(0.85)) return me.dir;
return random(safeMoves()) ?? me.dir;
`,
    },
    {
      id: 'classic',
      name: 'Classic (raw JS)',
      code: `// CLASSIC - the original brain, written in plain JavaScript
// against the legacy gameState API. Compare it with GREEDY,
// which does the same in one line.
/*
  API: gameState Object
  {
    me: { head: {x,y}, body: [{x,y}...], dir: {x,y} },
    enemy: { head: {x,y}, body: [{x,y}...] },
    food: {x,y},
    board: { cols, rows }
  }
  Output must be an object: {x: dx, y: dy}
  where dx and dy are 1, 0, or -1.
*/
const { me, enemy, food, board } = gameState;

// Helper to find safe adjacent tiles
function getNeighbors(cell) {
  return [{x: 0, y: -1}, {x: 0, y: 1}, {x: -1, y: 0}, {x: 1, y: 0}]
    .map(m => ({x: cell.x + m.x, y: cell.y + m.y, dx: m.x, dy: m.y}))
    .filter(n =>
      n.x >= 0 && n.x < board.cols &&
      n.y >= 0 && n.y < board.rows &&
      !me.body.some((p, i) => i < me.body.length - 1 && p.x === n.x && p.y === n.y) &&
      !enemy.body.some(p => p.x === n.x && p.y === n.y)
    );
}

// Breadth-First Search for food
let queue = [me.head];
let cameFrom = {[\`\${me.head.x},\${me.head.y}\`]: null};
let found = false;

while (queue.length > 0) {
  let curr = queue.shift();
  if (curr.x === food.x && curr.y === food.y) { found = true; break; }
  for (let n of getNeighbors(curr)) {
    let key = \`\${n.x},\${n.y}\`;
    if (!(key in cameFrom)) {
      cameFrom[key] = {parent: curr, dx: n.dx, dy: n.dy};
      queue.push(n);
    }
  }
}

// Backtrack path if food is reachable
if (found) {
  let step = cameFrom[\`\${food.x},\${food.y}\`];
  while (step && step.parent && (step.parent.x !== me.head.x || step.parent.y !== me.head.y)) {
    step = cameFrom[\`\${step.parent.x},\${step.parent.y}\`];
  }
  if (step) return {x: step.dx, y: step.dy};
}

// Survival mode: pick first available safe move
let neighbors = getNeighbors(me.head);
if (neighbors.length > 0) return {x: neighbors[0].dx, y: neighbors[0].dy};

// Inevitable collision, keep moving forward
return me.dir;
`,
    },
  ];
});
