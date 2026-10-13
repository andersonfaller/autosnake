/*
 * AutoSnake page: wires the editors, the brains (Web Workers), the rules engine,
 * the canvas and the controls together.
 */
(function () {
  'use strict';

  const { Game, VECTORS, DEFAULTS } = window.SnakeEngine;
  const BOTS = window.SnakeBots;
  const DOCS = window.SnakeDocs;

  const CELL = 20;
  const COLS = DEFAULTS.width;
  const ROWS = DEFAULTS.height;
  const SPEED_MAX = 61; // the slider's last notch: as fast as the brains can think
  const AUTOPLAY_DELAY_MS = 1800;
  const COMPILE_DELAY_MS = 300;
  const SAY_MS = 1400;
  const EFFECT_MS = 500;
  const CONSOLE_LINES = 150;

  const CAUSES = {
    wall: 'crashed into a wall',
    self: 'bit its own body',
    collision: 'crashed into the other snake',
    'head-on': 'lost a head-on collision',
    starved: 'starved',
  };

  const $ = (id) => document.getElementById(id);
  const store = {
    get(key) {
      try { return localStorage.getItem(key); } catch (_) { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch (_) { /* private mode: nothing to keep */ }
    },
  };

  const players = [
    { id: 1, name: 'P1', color: '#39ff14', bright: '#c8ffb8', defaultBot: 'starter' },
    { id: 2, name: 'P2', color: '#ff003c', bright: '#ffb3c2', defaultBot: 'hunter' },
  ];
  const playerById = (id) => players.find((p) => p.id === id);

  let game = null;
  let round = 0;
  let roundToken = 0;
  let booted = false;
  let running = true;
  let busy = false;
  let turbo = false;
  let ticksPerSecond = 15;
  let accumulated = 0;
  let lastFrame = 0;
  let autoplayTimer = 0;
  let hudDirty = true;
  const stats = { wins: { 1: 0, 2: 0 }, draws: 0 };
  const effects = [];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- players: editor, brain, feedback ------------------------------------

  function setupPlayer(p) {
    Object.assign(p, {
      brain: new window.SnakeBrain(),
      select: $('preset-' + p.id),
      statusEl: $('status-' + p.id),
      consoleEl: $('console-' + p.id),
      loaded: false,
      syntaxError: null,
      runtimeError: null,
      warning: null,
      frozen: false,
      ms: 0,
      marks: [],
      say: null,
      sayAt: 0,
      compileTimer: 0,
    });

    for (const bot of BOTS) p.select.add(new Option(bot.name, bot.id));
    p.customOption = new Option('Custom', 'custom');
    p.select.add(p.customOption);
    p.select.addEventListener('change', () => choosePreset(p, p.select.value));

    p.editor = window.createCodeEditor($('code-' + p.id), () => {
      clearTimeout(p.compileTimer);
      p.compileTimer = setTimeout(() => compile(p), COMPILE_DELAY_MS);
      syncPreset(p);
    });
    const bot = BOTS.find((b) => b.id === p.defaultBot);
    p.editor.setValue(store.get('autosnake.code.' + p.id) ?? bot.code);
    syncPreset(p);
  }

  function presetFor(code) {
    return BOTS.find((bot) => bot.code.trim() === code.trim()) || null;
  }

  function syncPreset(p) {
    const bot = presetFor(p.editor.getValue());
    p.customOption.hidden = !!bot;
    p.select.value = bot ? bot.id : 'custom';
  }

  function choosePreset(p, id) {
    const bot = BOTS.find((b) => b.id === id);
    if (!bot) return;
    const current = p.editor.getValue();
    if (current.trim() && !presetFor(current) && !window.confirm('Replace your code with the ' + bot.name + ' brain?')) {
      syncPreset(p);
      return;
    }
    p.editor.setValue(bot.code);
    syncPreset(p);
    compile(p);
  }

  // Parses first so a half-typed edit never replaces the brain that is playing.
  async function compile(p) {
    clearTimeout(p.compileTimer);
    const code = p.editor.getValue();
    const check = await window.checkSyntax(code);
    if (code !== p.editor.getValue()) return; // a newer edit will compile itself
    if (!check.ok) {
      p.syntaxError = check.error;
      refreshFeedback(p);
      return;
    }
    const reply = await p.brain.load(code);
    if (code !== p.editor.getValue()) return;
    if (!reply.ok) {
      p.syntaxError = reply.error || { message: 'Could not load this code.', line: null };
    } else {
      p.syntaxError = null;
      p.runtimeError = null;
      p.warning = null;
      p.frozen = false;
      p.loaded = true;
      store.set('autosnake.code.' + p.id, code);
    }
    refreshFeedback(p);
  }

  const atLine = (error) => (error && error.line ? ' (line ' + error.line + ')' : '');

  function updateStatus(p) {
    let kind = 'ok';
    let text;
    if (p.syntaxError) {
      kind = 'error';
      text = p.syntaxError.message + atLine(p.syntaxError) + ' - ' +
        (p.loaded ? 'still playing your last working code.' : 'your snake just goes straight.');
    } else if (p.frozen) {
      kind = 'error';
      text = 'Brain switched off: it took longer than ' + window.THINK_TIMEOUT_MS + ' ms. Edit the code or restart the round.';
    } else if (p.runtimeError) {
      kind = 'error';
      text = p.runtimeError.message + atLine(p.runtimeError);
    } else if (p.warning) {
      kind = 'warn';
      text = p.warning;
    } else {
      text = p.loaded ? 'Brain OK - changes go live as you type.' : 'Loading...';
    }
    if (p.statusEl.textContent !== text || p.statusEl.className !== 'status ' + kind) {
      p.statusEl.className = 'status ' + kind;
      p.statusEl.textContent = text;
    }
  }

  function refreshFeedback(p) {
    updateStatus(p);
    const error = p.syntaxError || p.runtimeError;
    p.editor.markLine(error ? error.line : null);
  }

  function logTo(p, text, kind = 'log') {
    const list = p.consoleEl;
    const last = list.lastElementChild;
    if (last && last.dataset.text === text && last.dataset.kind === kind) {
      const count = Number(last.dataset.count) + 1;
      last.dataset.count = count;
      last.querySelector('.count').textContent = '×' + count;
      return;
    }
    const item = document.createElement('li');
    item.className = kind;
    item.dataset.text = text;
    item.dataset.kind = kind;
    item.dataset.count = 1;
    const tick = document.createElement('span');
    tick.className = 'tick';
    tick.textContent = game ? 't' + game.tick : '';
    const msg = document.createElement('span');
    msg.className = 'msg';
    msg.textContent = text;
    const count = document.createElement('span');
    count.className = 'count';
    item.append(tick, msg, count);

    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
    list.append(item);
    while (list.childElementCount > CONSOLE_LINES) list.firstElementChild.remove();
    if (atBottom) list.scrollTop = list.scrollHeight;
  }

  function applyThought(p, result) {
    p.ms = result.ms || 0;
    p.marks = result.marks || [];
    if (result.say) {
      p.say = result.say;
      p.sayAt = performance.now();
    }
    for (const line of result.logs || []) logTo(p, line);
    if (result.warning) logTo(p, result.warning, 'warn');
    if (result.error) logTo(p, result.error.message + atLine(result.error), 'error');
    p.frozen = !!result.frozen;
    p.runtimeError = p.frozen ? null : result.error || null;
    p.warning = result.warning || null;
    refreshFeedback(p);
  }

  // ---- rounds and ticks ------------------------------------------------------

  function newRound() {
    clearTimeout(autoplayTimer);
    roundToken++;
    busy = false;
    accumulated = 0;
    round++;
    game = new Game();
    effects.length = 0;
    for (const p of players) {
      p.brain.reset();
      p.marks = [];
      p.say = null;
      p.frozen = false;
      p.runtimeError = null;
      p.warning = null;
      refreshFeedback(p);
      logTo(p, '--- round ' + round + ' ---', 'info');
    }
    $('overlay').hidden = true;
    hudDirty = true;
    updateControls();
  }

  async function runTick() {
    if (!booted || busy || !game || game.over) return;
    busy = true;
    const token = roundToken;
    const current = game;
    let results;
    try {
      results = await Promise.all(players.map((p) => p.brain.think(current.stateFor(p.id))));
    } finally {
      if (token === roundToken) busy = false;
    }
    if (token !== roundToken) return; // the round was restarted while the brains were thinking

    results.forEach((result, i) => applyThought(players[i], result));
    handleEvents(current.step(results.map((r) => r.move)));
    hudDirty = true;

    if (turbo && running && !current.over) setTimeout(runTick, 0);
  }

  function handleEvents(events) {
    for (const meal of events.ate) addEffect(meal.at, '#ffd400');
    for (const death of events.deaths) {
      addEffect(clampToBoard(death.at), '#ff3030');
      logTo(playerById(death.id), 'Your snake ' + CAUSES[death.cause] + '.', 'error');
    }
    if (events.over) endRound(events);
  }

  function describeDeaths(deaths) {
    if (deaths.length === 2 && deaths.every((d) => d.cause === 'head-on')) {
      return 'Head-on collision between snakes of the same length.';
    }
    return deaths.map((d) => playerById(d.id).name + ' ' + CAUSES[d.cause]).join(' · ') + '.';
  }

  function endRound(events) {
    const winner = playerById(events.winner);
    if (winner) stats.wins[winner.id]++;
    else stats.draws++;

    const title = $('overlay-title');
    title.textContent = winner ? winner.name + ' WINS' : 'DRAW';
    title.style.color = winner ? winner.color : '#fff';
    $('overlay-reason').textContent = describeDeaths(events.deaths);

    const auto = $('autoplay').checked && running;
    $('overlay-auto').hidden = !auto;
    $('overlay').hidden = false;
    if (auto) autoplayTimer = setTimeout(newRound, turbo ? 400 : AUTOPLAY_DELAY_MS);
    updateControls();
  }

  // ---- drawing ---------------------------------------------------------------

  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  let pixelRatio = 0;

  function fitCanvas() {
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    if (ratio === pixelRatio) return;
    pixelRatio = ratio;
    canvas.width = COLS * CELL * ratio;
    canvas.height = ROWS * CELL * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  const inside = (c) => c.x >= 0 && c.y >= 0 && c.x < COLS && c.y < ROWS;
  const clampToBoard = (c) => ({
    x: Math.max(0, Math.min(COLS - 1, c.x)),
    y: Math.max(0, Math.min(ROWS - 1, c.y)),
  });

  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(hex, factor) {
    const [r, g, b] = rgb(hex);
    return 'rgb(' + Math.round(r * factor) + ',' + Math.round(g * factor) + ',' + Math.round(b * factor) + ')';
  }
  function translucent(hex, alpha) {
    const [r, g, b] = rgb(hex);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function addEffect(cell, color) {
    effects.push({ x: cell.x, y: cell.y, color, start: performance.now() });
  }

  function drawGrid() {
    ctx.fillStyle = '#030303';
    ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);
    ctx.fillStyle = '#171717';
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) ctx.fillRect(x * CELL + CELL / 2 - 1, y * CELL + CELL / 2 - 1, 2, 2);
    }
  }

  function drawMarks(p) {
    for (const m of p.marks) {
      if (!inside(m)) continue;
      ctx.fillStyle = translucent(p.color, 0.22);
      if (m.color) {
        ctx.fillStyle = m.color; // an invalid CSS color is ignored and keeps the default
        ctx.globalAlpha = 0.45;
      }
      ctx.fillRect(m.x * CELL + 3, m.y * CELL + 3, CELL - 6, CELL - 6);
      ctx.globalAlpha = 1;
    }
  }

  function drawFood(food, now) {
    const pulse = reducedMotion ? 1 : 1 + Math.sin(now / 160) * 0.08;
    const size = (CELL - 6) * pulse;
    const x = food.x * CELL + (CELL - size) / 2;
    const y = food.y * CELL + (CELL - size) / 2;
    ctx.shadowColor = '#ffd400';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ffd400';
    ctx.fillRect(x, y, size, size);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff7c2';
    ctx.fillRect(x + 2, y + 2, 4, 4);
  }

  function drawSnake(p, snake) {
    const body = snake.body;
    const n = body.length;
    const dead = !snake.alive;
    for (let i = n - 1; i >= 0; i--) {
      const seg = body[i];
      if (!inside(seg)) continue;
      const fade = 1 - (i / n) * 0.55;
      ctx.fillStyle = dead ? shade('#a0a0a0', fade) : i === 0 ? p.bright : shade(p.color, fade);
      ctx.fillRect(seg.x * CELL + 2, seg.y * CELL + 2, CELL - 4, CELL - 4);
      const next = body[i - 1]; // bridge the gap towards the head
      if (next && inside(next) && Math.abs(next.x - seg.x) + Math.abs(next.y - seg.y) === 1) {
        ctx.fillRect(
          Math.min(seg.x, next.x) * CELL + 2,
          Math.min(seg.y, next.y) * CELL + 2,
          (Math.abs(seg.x - next.x) + 1) * CELL - 4,
          (Math.abs(seg.y - next.y) + 1) * CELL - 4
        );
      }
    }

    const head = body[0];
    if (!inside(head)) return;
    const v = VECTORS[snake.dir];
    const cx = head.x * CELL + CELL / 2;
    const cy = head.y * CELL + CELL / 2;
    ctx.fillStyle = dead ? '#ff2a2a' : '#000';
    for (const side of [1, -1]) {
      const ex = cx + v.x * 3 - v.y * 4 * side;
      const ey = cy + v.y * 3 + v.x * 4 * side;
      ctx.fillRect(ex - 2, ey - 2, 4, 4);
    }
  }

  function drawBubble(p, snake, now) {
    if (!p.say || now - p.sayAt > SAY_MS) return;
    const head = snake.body.find(inside);
    if (!head) return;
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.textBaseline = 'middle';
    const width = Math.ceil(ctx.measureText(p.say).width) + 12;
    const height = 18;
    let x = head.x * CELL + CELL / 2 - width / 2;
    let y = head.y * CELL - height - 4;
    if (y < 2) y = head.y * CELL + CELL + 4;
    x = Math.max(2, Math.min(COLS * CELL - width - 2, x));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(p.say, x + 6, y + height / 2 + 1);
  }

  function drawEffects(now) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      const t = (now - e.start) / EFFECT_MS;
      if (t >= 1 || reducedMotion) {
        effects.splice(i, 1);
        continue;
      }
      const half = 4 + t * 16;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(e.x * CELL + CELL / 2 - half, e.y * CELL + CELL / 2 - half, half * 2, half * 2);
    }
    ctx.globalAlpha = 1;
  }

  function render(now) {
    drawGrid();
    if (!game) return;
    for (const p of players) drawMarks(p);
    if (game.food) drawFood(game.food, now);
    for (const p of players) drawSnake(p, game.snake(p.id));
    drawEffects(now);
    for (const p of players) drawBubble(p, game.snake(p.id), now);
  }

  function updateHud() {
    hudDirty = false;
    $('round').textContent = round;
    $('tick').textContent = game.tick;
    $('draws').textContent = stats.draws;
    for (const p of players) {
      const snake = game.snake(p.id);
      const health = Math.max(0, snake.health) / game.maxHealth;
      const bar = $('hp-' + p.id);
      bar.style.width = health * 100 + '%';
      bar.className = health > 0.5 ? '' : health > 0.25 ? 'warn' : 'low';
      $('len-' + p.id).textContent = snake.body.length;
      $('wins-' + p.id).textContent = stats.wins[p.id];
      $('ms-' + p.id).textContent = p.frozen ? 'OFF' : p.ms ? p.ms.toFixed(2) + ' ms' : '';
    }
  }

  // ---- main loop -------------------------------------------------------------

  function frame(now) {
    const dt = Math.min(now - (lastFrame || now), 250);
    lastFrame = now;
    if (booted && running && game && !game.over) {
      if (turbo) {
        runTick();
      } else {
        const interval = 1000 / ticksPerSecond;
        accumulated = Math.min(accumulated + dt, interval * 2);
        if (accumulated >= interval && !busy) {
          accumulated -= interval;
          runTick();
        }
      }
    }
    render(now);
    if (hudDirty && game) updateHud();
    requestAnimationFrame(frame);
  }

  // ---- controls --------------------------------------------------------------

  function updateControls() {
    $('playBtn').textContent = running ? '❚❚ PAUSE' : '▶ PLAY';
    $('stepBtn').disabled = running || !game || game.over;
  }

  function togglePlay() {
    if (game && game.over) {
      running = true;
      newRound();
      return;
    }
    running = !running;
    updateControls();
  }

  function step() {
    if (!running && game && !game.over) runTick().then(updateControls);
  }

  function setSpeed(value) {
    const speed = Math.max(1, Math.min(SPEED_MAX, Math.round(value) || 15));
    turbo = speed >= SPEED_MAX;
    ticksPerSecond = Math.min(speed, 60);
    $('speed').value = speed;
    $('speedOut').textContent = turbo ? 'MAX' : speed + '/s';
    store.set('autosnake.speed', speed);
  }

  function openDocs() {
    const dialog = $('docs');
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDocs() {
    const dialog = $('docs');
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function buildDocs() {
    const api = $('docs-api');
    for (const section of DOCS.sections) {
      const heading = document.createElement('h3');
      heading.textContent = section.title;
      const list = document.createElement('dl');
      for (const entry of section.entries) {
        const term = document.createElement('dt');
        const sig = document.createElement('code');
        sig.textContent = entry.sig;
        term.append(sig);
        const detail = document.createElement('dd');
        detail.innerHTML = entry.desc; // static markup from docs.js
        if (entry.example) {
          const example = document.createElement('pre');
          example.textContent = entry.example;
          detail.append(example);
        }
        list.append(term, detail);
      }
      api.append(heading, list);
    }
    for (const rule of DOCS.rules) {
      const item = document.createElement('li');
      item.textContent = rule;
      $('docs-rules').append(item);
    }
  }

  function bindControls() {
    $('playBtn').addEventListener('click', togglePlay);
    $('stepBtn').addEventListener('click', step);
    $('restartBtn').addEventListener('click', () => {
      if (game && game.over) running = true;
      newRound();
    });
    $('nextBtn').addEventListener('click', () => {
      running = true;
      newRound();
    });
    $('speed').addEventListener('input', (event) => setSpeed(Number(event.target.value)));
    $('autoplay').addEventListener('change', (event) => {
      store.set('autosnake.autoplay', event.target.checked ? '1' : '0');
      if (event.target.checked && game && game.over && running) {
        $('overlay-auto').hidden = false;
        autoplayTimer = setTimeout(newRound, AUTOPLAY_DELAY_MS);
      } else if (!event.target.checked) {
        clearTimeout(autoplayTimer);
        $('overlay-auto').hidden = true;
      }
    });
    $('resetStatsBtn').addEventListener('click', () => {
      stats.wins[1] = stats.wins[2] = stats.draws = 0;
      round = 0;
      newRound();
    });
    for (const button of document.querySelectorAll('[data-clear]')) {
      button.addEventListener('click', () => {
        playerById(Number(button.dataset.clear)).consoleEl.innerHTML = '';
      });
    }

    const dialog = $('docs');
    $('docsBtn').addEventListener('click', openDocs);
    $('docsClose').addEventListener('click', closeDocs);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDocs(); // click on the backdrop
    });

    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (dialog.open || !target.closest || target.closest('.CodeMirror, textarea, input, select')) return;
      const onButton = target.tagName === 'BUTTON';
      if (event.key === ' ' && !onButton) {
        event.preventDefault();
        togglePlay();
      } else if (event.key === 'ArrowRight' || event.key === 'n') {
        event.preventDefault();
        step();
      } else if (event.key === 'r' || event.key === 'R') {
        if (game && game.over) running = true;
        newRound();
      } else if (event.key === '?') {
        openDocs();
      } else if (event.key === 'Enter' && !onButton && game && game.over) {
        running = true;
        newRound();
      }
    });

    window.addEventListener('resize', fitCanvas);
  }

  // ---- boot ------------------------------------------------------------------

  async function boot() {
    fitCanvas();
    buildDocs();
    bindControls();
    players.forEach(setupPlayer);
    setSpeed(Number(store.get('autosnake.speed')) || 15);
    $('autoplay').checked = store.get('autosnake.autoplay') !== '0';
    newRound();
    requestAnimationFrame(frame);

    await Promise.all(players.map(compile));
    booted = true;
    if (document.fonts) document.fonts.ready.then(() => players.forEach((p) => p.editor.refresh()));
  }

  boot();
})();
