/**
 * ASGARD CRM — Mimir Conductor: in-process семафоры
 * ═══════════════════════════════════════════════════════════════════════════
 * Решает две проблемы tokenator:
 *   1. Лимит провайдера = 3 одновременных стрима. Семафор AI_SEMAPHORE
 *      ограничивает параллельные AI-вызовы числом max 3 во ВСЁМ процессе.
 *      Если 4-й вызов приходит — ждёт в очереди.
 *   2. Если 2 РП запустили просчёты одновременно — оба могут зависнуть на
 *      rate-limit. RUN_SEMAPHORE гарантирует, что одновременно работает
 *      МАКСИМУМ 1 Conductor-loop. Остальные ждут в FIFO-очереди.
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
  /** Запустить fn() с автоматическим acquire/release (try/finally). */
  async run(fn) {
    await this.acquire();
    try { return await fn(); }
    finally { this.release(); }
  }
  /** Сводка для war-room/телеметрии. */
  status() {
    return { name: this.name, max: this.max, active: this.active, queued: this.queue.length };
  }
}

// Лимит tokenator = 3 concurrent streams (общий на ключ). Держим 3 чтобы был
// небольшой запас от граничного значения.
const AI_SEMAPHORE = new Semaphore('ai_concurrent_streams', 3);

// Только один Conductor-loop одновременно. Второй РП — в FIFO-очереди.
const RUN_SEMAPHORE = new Semaphore('conductor_runs', 1);

module.exports = { Semaphore, AI_SEMAPHORE, RUN_SEMAPHORE };
