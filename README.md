# autosnake

Programmable Autonomous Dual Snake. Write a brain for your snake in **SnakeScript**, JavaScript with a
snake-sized vocabulary, and watch it fight another snake live.

```js
// A complete brain: chase the food, otherwise find room to breathe.
return toward(food) ?? safest();
```

## Play

Open `index.html` in a browser. It works straight from disk, no build step. To serve it instead, run
`npm start`.

Each player picks a preset brain or writes their own. Changes go live as you type. Code that does not
parse never replaces the brain that is playing, so you can edit in the middle of a round.

| Key | Action |
| --- | --- |
| `Space` | pause / play |
| `→` | step one tick (while paused) |
| `R` | restart the round |
| `?` | open the SnakeScript reference |
| `Ctrl` + `Space` | autocomplete in the editor |

Set the speed slider to **MAX** with **auto-play** on to run dozens of rounds in a few seconds and
compare two brains.

## SnakeScript

Your code is the body of a function that runs once per tick. Look at the world, then `return` `'up'`,
`'down'`, `'left'` or `'right'`. If you return nothing, an unknown move or the reverse of your current
direction, the snake keeps going straight.

### Your world

| Name | What it is |
| --- | --- |
| `me` | your snake: `head`, `tail`, `body` (head first), `length`, `dir`, `health` |
| `enemy` | the other snake, with the same fields |
| `food` | `{x, y}` of the food |
| `board` | `board.width` × `board.height`. `{x: 0, y: 0}` is the top-left corner and `y` grows downward |
| `tick` | ticks played this round |
| `memory` | an object that survives between ticks and is emptied every round |

### Directions

| Function | Returns |
| --- | --- |
| `directions` | `['up', 'down', 'left', 'right']` |
| `turnLeft(dir = me.dir)` / `turnRight(dir = me.dir)` | the direction to that side, from the snake's point of view |
| `opposite(dir = me.dir)` | the reverse direction |

### Senses

| Function | Returns |
| --- | --- |
| `isSafe(dir)` | `true` if that move does not hit a wall or a body next tick |
| `isRisky(dir)` | `true` if the enemy's head could reach the same cell and would win (or tie) the head-on |
| `safeMoves()` | the safe directions, straight ahead first |
| `look(dir = me.dir)` | `{thing, distance, cell}`: the first `'wall'`, `'me'`, `'enemy'` or `'food'` in that direction |
| `whatsAt(cell)` | `'empty'`, `'wall'`, `'food'`, `'me'` or `'enemy'` |
| `neighbor(dir, from = me.head)` | the cell one step away |
| `distance(a, b = me.head)` | steps between two cells, ignoring obstacles |

### Planning

| Function | Returns |
| --- | --- |
| `pathTo(target, from = me.head)` | the shortest safe path as a list of cells, or `null` |
| `toward(target)` | the first direction of that path, or `null` |
| `space(dir)` | how many free cells you can still reach after that move (low = dead end) |
| `best(score, options = safeMoves())` | the option with the highest `score(option)` |
| `safest()` | the safe move with the most room, avoiding risky head-ons when it can |

### Debug & fun

| Function | Effect |
| --- | --- |
| `say(...text)` | speech bubble over your snake |
| `mark(cells, color?)` | highlights cells on the board, e.g. `mark(pathTo(food))` |
| `log(...values)` | prints to the console under your editor |
| `random(list)` / `chance(p)` | a random item / `true` with probability `p` |

Errors never crash the game. They show up in the status line and the console with the line number,
and the line is highlighted in the editor. A brain gets 300 ms per tick. A slower one (an infinite
loop, say) is switched off until you edit it or the next round starts.

Scripts written for the first version still run: `gameState` and `{x, y}` return values are
supported. See the **Classic (raw JS)** preset.

### Example: the Hunter preset

```js
// Eats until it is bigger, then goes for the head.
if (me.health > 30 && me.length > enemy.length) {
  const targets = directions
    .map(dir => neighbor(dir, enemy.head))
    .filter(cell => ['empty', 'food'].includes(whatsAt(cell)))
    .sort((a, b) => distance(a) - distance(b));

  for (const target of targets) {
    const dir = toward(target);
    if (dir && space(dir) >= me.length) {
      say('HUNT!');
      mark(target, 'red');
      return dir;
    }
  }
}

const dir = toward(food);
if (dir && !isRisky(dir) && space(dir) >= me.length) return dir;
return safest();
```

## Rules

- Both brains see the same moment and both snakes move at the same time.
- Food makes you one segment longer and refills your health to 100.
- Health drops by 1 every tick. At 0 the snake starves.
- Hitting a wall, yourself or the other snake is fatal.
- In a head-on collision the longer snake survives. Equal lengths: both die.
- The round ends when a snake dies. The survivor wins; if both die it is a draw.

## Development

```
index.html        page
css/style.css     styles and the editor theme
js/engine.js      game rules (pure, no DOM)
js/runtime.js     SnakeScript: compiles and runs brains; booted inside a Web Worker
js/brain.js       main-thread side of a brain: worker, time budget, syntax error lines
js/docs.js        the language reference (API panel + autocomplete)
js/bots.js        preset brains
js/editor.js      CodeMirror editor (plain textarea when the CDN is unreachable)
js/main.js        UI, rendering and game loop
tests/            unit tests for the rules, the language and the presets
```

Run the tests with `npm test` (Node 18 or newer, no dependencies).
