/*
 * Main-thread side of a snake brain: owns a Web Worker running SnakeScript,
 * enforces the per-tick time budget and reports syntax errors with line numbers.
 */
(function (root) {
  'use strict';

  const THINK_TIMEOUT_MS = 300;
  const LOAD_TIMEOUT_MS = 3000;

  let workerUrl = null;
  function brainWorkerUrl() {
    if (!workerUrl) {
      const source = 'self.SnakeRuntime = ' + root.SnakeRuntime.source + ';\nself.SnakeRuntime.startWorker(self);\n';
      workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    }
    return workerUrl;
  }

  class SnakeBrain {
    constructor() {
      this.worker = null;
      this.code = null;
      this.ready = Promise.resolve();
      this.pending = new Map();
      this.nextId = 1;
      this.frozen = false;
    }

    spawn() {
      this.worker = new Worker(brainWorkerUrl());
      this.worker.onmessage = (event) => {
        const reply = event.data || {};
        const request = this.pending.get(reply.id);
        if (!request) return;
        this.pending.delete(reply.id);
        clearTimeout(request.timer);
        request.resolve(reply);
      };
      this.worker.onerror = (event) => {
        event.preventDefault();
        this.kill();
        this.frozen = true;
      };
    }

    kill() {
      if (this.worker) this.worker.terminate();
      this.worker = null;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.resolve({ cancelled: true });
      }
      this.pending.clear();
    }

    request(message, timeout) {
      return new Promise((resolve) => {
        const id = this.nextId++;
        const timer = setTimeout(() => {
          this.pending.delete(id);
          resolve({ timedOut: true });
        }, timeout);
        this.pending.set(id, { resolve, timer });
        this.worker.postMessage(Object.assign({ id }, message));
      });
    }

    // Hot-swaps the code. The worker (and the round's memory) survives.
    load(code) {
      this.code = code;
      this.frozen = false;
      if (!this.worker) this.spawn();
      this.ready = this.request({ type: 'load', code }, LOAD_TIMEOUT_MS);
      return this.ready;
    }

    // New round: fresh memory, and a second chance for a brain that was switched off.
    reset() {
      if (this.worker && !this.frozen) {
        this.worker.postMessage({ type: 'reset' });
      } else if (this.code !== null) {
        this.kill();
        this.load(this.code);
      }
    }

    async think(state) {
      if (this.frozen) return { move: null, frozen: true };
      if (!this.worker) return { move: null }; // no code has compiled yet: keep going straight
      await this.ready;
      if (!this.worker) return { move: null, frozen: this.frozen };
      const reply = await this.request({ type: 'think', state }, THINK_TIMEOUT_MS);
      if (reply.timedOut) {
        this.kill();
        this.frozen = true;
        return {
          move: null,
          frozen: true,
          error: {
            message: 'Your brain took longer than ' + THINK_TIMEOUT_MS + ' ms and was switched off (infinite loop?). ' +
              'Edit the code or start a new round to wake it up.',
            line: null,
          },
        };
      }
      if (reply.cancelled) return { move: null };
      return reply.result;
    }
  }

  // Parses without running. Browsers do not put a line number on a SyntaxError
  // thrown by `new Function`, but a Worker that fails to parse reports one.
  function checkSyntax(code) {
    const compiled = root.SnakeRuntime.compile(code);
    if (compiled.ok) return Promise.resolve({ ok: true });
    return locateSyntaxError(code).then((line) => ({
      ok: false,
      error: { message: compiled.error.message, line },
    }));
  }

  function locateSyntaxError(code) {
    return new Promise((resolve) => {
      const header = '(function (__api) {\n';
      const source = header + root.SnakeRuntime.wrap(code) + '\n});\npostMessage(0);\n';
      const offset = header.split('\n').length; // header lines + the prelude line
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      let worker;
      const finish = (line) => {
        clearTimeout(timer);
        if (worker) worker.terminate();
        URL.revokeObjectURL(url);
        const lines = code.split('\n').length;
        resolve(Number.isFinite(line) && line >= 1 ? Math.min(line, lines) : null);
      };
      const timer = setTimeout(() => finish(null), 1500);
      try {
        worker = new Worker(url);
      } catch (_) {
        finish(null);
        return;
      }
      worker.onmessage = () => finish(null);
      worker.onerror = (event) => {
        event.preventDefault();
        finish(event.lineno ? event.lineno - offset : null);
      };
    });
  }

  root.SnakeBrain = SnakeBrain;
  root.checkSyntax = checkSyntax;
  root.THINK_TIMEOUT_MS = THINK_TIMEOUT_MS;
})(window);
