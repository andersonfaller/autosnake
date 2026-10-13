/*
 * SnakeScript reference. Single source for the API panel and for editor autocomplete.
 * `desc` may contain inline <code> markup; `short` is plain text for the autocomplete popup.
 */
(function (root, factory) {
  'use strict';
  const docs = factory();
  if (typeof module === 'object' && module.exports) module.exports = docs;
  else root.SnakeDocs = docs;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const sections = [
    {
      title: 'Your world',
      entries: [
        {
          name: 'me', sig: 'me', short: 'your snake',
          desc: 'Your snake: <code>head</code>, <code>tail</code>, <code>body</code> (head first), <code>length</code>, <code>dir</code> and <code>health</code>.',
          example: "if (me.health < 30) say('hungry!');",
        },
        {
          name: 'enemy', sig: 'enemy', short: 'the other snake',
          desc: 'The other snake, with the same fields as <code>me</code>.',
          example: "if (enemy.length > me.length) say('uh oh');",
        },
        { name: 'food', sig: 'food', short: 'food position {x, y}', desc: 'Where the food is: <code>{x, y}</code>.' },
        {
          name: 'board', sig: 'board', short: 'board.width, board.height',
          desc: '<code>board.width</code> × <code>board.height</code> cells. <code>x</code> grows to the right, <code>y</code> grows downward and <code>{x: 0, y: 0}</code> is the top-left corner.',
        },
        { name: 'tick', sig: 'tick', short: 'ticks played this round', desc: 'How many ticks this round has lasted.' },
        {
          name: 'memory', sig: 'memory', short: 'survives between ticks',
          desc: 'An object that survives between ticks and is emptied when a new round starts. Keep plans and counters here.',
          example: 'memory.turns = (memory.turns ?? 0) + 1;',
        },
      ],
    },
    {
      title: 'Directions',
      entries: [
        { name: 'directions', sig: 'directions', short: "['up','down','left','right']", desc: "The four moves: <code>['up', 'down', 'left', 'right']</code>." },
        {
          name: 'turnLeft', sig: 'turnLeft(dir = me.dir)', short: 'direction to your left',
          desc: "The direction to the left of <code>dir</code>, from the snake's point of view.",
          example: "turnLeft('up')  // 'left'",
        },
        { name: 'turnRight', sig: 'turnRight(dir = me.dir)', short: 'direction to your right', desc: "The direction to the right of <code>dir</code>, from the snake's point of view." },
        { name: 'opposite', sig: 'opposite(dir = me.dir)', short: 'the reverse direction', desc: 'The reverse of <code>dir</code>.' },
      ],
    },
    {
      title: 'Senses',
      entries: [
        {
          name: 'isSafe', sig: 'isSafe(dir)', short: 'no wall or body there next tick',
          desc: 'True when moving in <code>dir</code> does not hit a wall or a body next tick. Tails that are about to move count as free.',
          example: "if (!isSafe(me.dir)) return turnLeft();",
        },
        {
          name: 'isRisky', sig: 'isRisky(dir)', short: 'enemy head could get there too',
          desc: "True when the enemy's head could reach the same cell next tick <em>and</em> the enemy is at least as long as you, so a head-on would kill you.",
        },
        { name: 'safeMoves', sig: 'safeMoves()', short: 'list of safe directions', desc: 'The safe directions, straight ahead first.' },
        {
          name: 'look', sig: 'look(dir = me.dir)', short: '{thing, distance, cell}',
          desc: "A ray from your head: the first thing in that direction (<code>'wall'</code>, <code>'me'</code>, <code>'enemy'</code> or <code>'food'</code>) and how many cells away it is.",
          example: "if (look().thing === 'wall' && look().distance === 1) return turnRight();",
        },
        {
          name: 'whatsAt', sig: 'whatsAt(cell)', short: "'empty','wall','food','me','enemy'",
          desc: "What occupies a cell right now: <code>'empty'</code>, <code>'wall'</code>, <code>'food'</code>, <code>'me'</code> or <code>'enemy'</code>. Also accepts <code>whatsAt(x, y)</code>.",
        },
        {
          name: 'neighbor', sig: 'neighbor(dir, from = me.head)', short: 'the next cell in that direction',
          desc: 'The cell one step away in <code>dir</code>.',
          example: "whatsAt(neighbor('up'))",
        },
        { name: 'distance', sig: 'distance(a, b = me.head)', short: 'steps between two cells', desc: 'Steps between two cells, ignoring obstacles (Manhattan distance).' },
      ],
    },
    {
      title: 'Planning',
      entries: [
        {
          name: 'pathTo', sig: 'pathTo(target, from = me.head)', short: 'shortest safe path (list of cells)',
          desc: 'The shortest path to <code>target</code> that avoids walls and bodies, as a list of cells (your head not included), or <code>null</code> when it cannot be reached.',
          example: 'mark(pathTo(food));',
        },
        {
          name: 'toward', sig: 'toward(target)', short: 'first step of the shortest path',
          desc: 'The first direction along <code>pathTo(target)</code>, or <code>null</code> when there is no path.',
          example: 'return toward(food) ?? safest();',
        },
        {
          name: 'space', sig: 'space(dir)', short: 'free cells reachable after moving',
          desc: 'How many free cells you could still reach after moving in <code>dir</code>. Low numbers mean a dead end (0 if the move is not safe).',
        },
        {
          name: 'best', sig: 'best(score, options = safeMoves())', short: 'option with the highest score',
          desc: 'Runs <code>score</code> on every option and returns the one with the highest score (<code>null</code> if there are no options).',
          example: 'return best(dir => space(dir) - distance(food, neighbor(dir)));',
        },
        {
          name: 'safest', sig: 'safest()', short: 'safe move with the most room',
          desc: 'The safe move with the most room, avoiding risky head-ons when it can. If nothing is safe, keeps going straight.',
        },
      ],
    },
    {
      title: 'Debug & fun',
      entries: [
        { name: 'say', sig: 'say(...text)', short: 'speech bubble over your head', desc: 'Shows a speech bubble over your snake.', example: "say('yum', tick);" },
        {
          name: 'mark', sig: 'mark(cells, color?)', short: 'highlight cells on the board',
          desc: 'Highlights a cell or a list of cells on the board for this tick. Great for showing your plan.',
          example: "mark(pathTo(food), 'gold');",
        },
        { name: 'log', sig: 'log(...values)', short: 'print to your console', desc: 'Prints to the console under your editor.' },
        { name: 'random', sig: 'random(list)', short: 'random item of a list', desc: 'A random item of a list (<code>null</code> if it is empty).' },
        { name: 'chance', sig: 'chance(p)', short: 'true with probability p', desc: 'True with probability <code>p</code> (0 to 1).', example: 'if (chance(0.1)) return random(safeMoves());' },
      ],
    },
  ];

  const snakeProps = [
    { name: 'head', short: '{x, y} of the head' },
    { name: 'tail', short: '{x, y} of the last segment' },
    { name: 'body', short: 'all segments, head first' },
    { name: 'length', short: 'number of segments' },
    { name: 'dir', short: "current direction, e.g. 'up'" },
    { name: 'health', short: '100 after eating, -1 per tick' },
  ];

  const props = {
    me: snakeProps,
    enemy: snakeProps,
    food: [{ name: 'x', short: 'column' }, { name: 'y', short: 'row' }],
    board: [{ name: 'width', short: 'columns' }, { name: 'height', short: 'rows' }],
  };

  const rules = [
    'Both brains see the same moment and move at the same time.',
    'Eating food makes you one segment longer and refills your health to 100.',
    'Health drops by 1 every tick. At 0 your snake starves.',
    'Hitting a wall, yourself or the other snake is fatal.',
    'Head-on collision: the longer snake survives. Equal lengths: both die.',
    'Returning nothing, an unknown move or the reverse of your direction keeps you going straight.',
    'A brain gets 300 ms per tick. Slower brains are switched off until you edit the code or a new round starts.',
    'The round ends when a snake dies. The survivor wins; if both die it is a draw.',
  ];

  return { sections, props, rules };
});
