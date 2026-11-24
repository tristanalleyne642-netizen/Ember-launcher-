'use strict';
/**
 * Game process runner — spawns game executables detached so they keep
 * running even if the launcher is closed, and tracks whether each
 * one is still alive.
 */
const { spawn } = require('child_process');

class GameRunner {
  constructor() {
    /** Map of game index -> { pid } for currently-running games. */
    this.running = new Map();
  }

  /**
   * Launch a game. Returns { ok: true, pid } or { ok: false, error }.
   * The child is detached + unref'd: closing the launcher does not
   * kill the game.
   */
  launch(index, game) {
    if (this.running.has(index)) {
      return { ok: false, error: `"${game.name}" is already running.` };
    }
    let child;
    try {
      child = spawn(game.path, [], {
        detached: true,
        stdio: 'ignore',
      });
    } catch (err) {
      return { ok: false, error: `Could not start "${game.name}": ${err.message}` };
    }
    return new Promise((resolve) => {
      child.once('error', (err) => {
        resolve({ ok: false, error: `Could not start "${game.name}": ${err.message}` });
      });
      child.once('spawn', () => {
        child.unref();
        this.running.set(index, { pid: child.pid });
        resolve({ ok: true, pid: child.pid });
      });
    });
  }

  /** True while the process with this game's pid is alive. */
  isRunning(index) {
    const entry = this.running.get(index);
    if (!entry) return false;
    try {
      process.kill(entry.pid, 0);
      return true;
    } catch (_) {
      this.running.delete(index);
      return false;
    }
  }

  /** All running game indices (prunes ones that have exited). */
  runningIndices() {
    const alive = [];
    for (const index of [...this.running.keys()]) {
      if (this.isRunning(index)) alive.push(index);
    }
    return alive;
  }

  /** Stop a running game (SIGTERM the whole process group, then SIGKILL). */
  stop(index) {
    const entry = this.running.get(index);
    if (!entry) return false;
    this.running.delete(index);
    try { process.kill(-entry.pid, 'SIGTERM'); } catch (_) {}
    try { process.kill(entry.pid, 'SIGTERM'); } catch (_) {}
    setTimeout(() => {
      try { process.kill(-entry.pid, 'SIGKILL'); } catch (_) {}
      try { process.kill(entry.pid, 'SIGKILL'); } catch (_) {}
    }, 1000);
    return true;
  }

  /**
   * The library just removed the game at `removedIndex`, so every game
   * after it shifts down one slot — shift the running map with it so
   * Running badges stay on the right cards. (Removal is blocked while
   * a game is running, so the removed slot itself is never running.)
   */
  shiftAfterRemoval(removedIndex) {
    const next = new Map();
    for (const [index, entry] of this.running) {
      if (index === removedIndex) continue;
      next.set(index > removedIndex ? index - 1 : index, entry);
    }
    this.running = next;
  }
}

module.exports = { GameRunner };
