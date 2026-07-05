/**
 * ASGARD CRM — Mimir Conductor: in-process семафоры
 * ═══════════════════════════════════════════════════════════════════════════
 *   1. AI_SEMAPHORE — max 3 одновременных AI-вызова (консервативный лимит RouterAI).
 *   2. RUN_SEMAPHORE — max 1 Conductor-loop одновременно (FIFO).
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

class Semaphore {
  constructor(name, max) {
    this.name = name;
    this.max = max;
    this.active = 0;
    this.queue = [];
  }
  async acquire() {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.active++;
  }
  release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
  async run(fn) {
    await this.acquire();
    try { return await fn(); }
    finally { this.release(); }
  }
  status() {
    return { name: this.name, max: this.max, active: this.active, queued: this.queue.length };
  }
}

const AI_SEMAPHORE = new Semaphore('ai_concurrent_streams', 3);

module.exports = { Semaphore, AI_SEMAPHORE };
