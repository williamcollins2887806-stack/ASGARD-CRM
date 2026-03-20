'use strict';

/**
 * RecordingFetcher — фоновый сервис, который через Mango Stats API
 * забирает recording_id для звонков, у которых он отсутствует.
 *
 * Mango Office не всегда отправляет recording_id через вебхуки.
 * Этот сервис компенсирует это, запрашивая статистику напрямую
 * и запуская пайплайн (скачивание → транскрипция → AI-анализ).
 */

const { getMangoService } = require('./mango');

class RecordingFetcher {
  constructor(db, logger) {
    this.db = db;
    this.mango = getMangoService();
    this.logger = logger || console;
    this._interval = null;
    this._running = false;
    this._jobQueue = null;
    this._fetchIntervalMs = 5 * 60 * 1000; // 5 минут
  }

  setJobQueue(jq) {
    this._jobQueue = jq;
  }

  start() {
    if (this._interval) return;
    if (!this.mango.isConfigured()) {
      this.logger.warn('[RecordingFetcher] Mango not configured, skipping');
      return;
    }
    this.logger.info('[RecordingFetcher] Started (polling every 5 min)');
    this._interval = setInterval(() => this._run(), this._fetchIntervalMs);
    // Первый запуск через 30с — дать серверу стабилизироваться
    setTimeout(() => this._run(), 30000);
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  async _run() {
    if (this._running) return;
    this._running = true;
    try {
      await this._fetchAndMatch();
    } catch (err) {
      this.logger.error('[RecordingFetcher] Error: ' + err.message);
    }
    this._running = false;
  }

  async _fetchAndMatch() {
    // 1. Звонки без recording_id (только отвеченные, duration > 0)
    const { rows: pending } = await this.db.query(`
      SELECT id, mango_entry_id, created_at
      FROM call_history
      WHERE mango_entry_id IS NOT NULL
        AND (recording_id IS NULL OR recording_id = '')
        AND record_path IS NULL
        AND duration_seconds > 0
        AND created_at > NOW() - interval '30 days'
      ORDER BY created_at DESC
      LIMIT 500
    `);

    if (!pending.length) {
      return; // Все звонки уже обработаны
    }

    this.logger.info('[RecordingFetcher] Found ' + pending.length + ' calls without recording_id');

    // 2. Карта entry_id → call_history.id
    const entryMap = new Map();
    for (const row of pending) {
      entryMap.set(row.mango_entry_id, row.id);
    }

    // 3. Диапазон дат (Mango не принимает date_to в будущем)
    const dates = pending.map(r => new Date(r.created_at));
    const minDate = new Date(Math.min.apply(null, dates));
    const now = new Date();
    const dateTo = Math.floor(now.getTime() / 1000);
    const dateFrom = Math.floor(minDate.getTime() / 1000);

    // 4. Запрос статистики с полем records + entry_id
    this.logger.info('[RecordingFetcher] Requesting stats from ' + new Date(dateFrom * 1000).toISOString().slice(0,10) + ' to ' + new Date(dateTo * 1000).toISOString().slice(0,10));
    var statsKey;
    try {
      const resp = await this.mango.requestStats(dateFrom, dateTo, 'records,entry_id');
      this.logger.info('[RecordingFetcher] Stats response: ' + JSON.stringify(resp).slice(0, 500));
      statsKey = resp.key;
    } catch (err) {
      this.logger.error('[RecordingFetcher] Stats request failed: ' + err.message);
      if (err.response) this.logger.error('[RecordingFetcher] API response: ' + JSON.stringify(err.response));
      return;
    }

    if (!statsKey) {
      this.logger.warn('[RecordingFetcher] No key returned from stats/request');
      return;
    }

    // 5. Поллинг результата (макс 60 секунд, каждые 5с)
    var csvData = null;
    for (var attempt = 0; attempt < 12; attempt++) {
      await this._delay(5000);
      try {
        const resp = await this.mango.getStatsResult(statsKey);

        // 204 = ещё не готово
        if (resp.statusCode === 204 || (resp.raw !== undefined && resp.raw === '')) {
          continue;
        }

        // CSV данные (raw = string или Buffer)
        if (resp.raw) {
          csvData = typeof resp.raw === 'string' ? resp.raw : resp.raw.toString('utf8');
          this.logger.info('[RecordingFetcher] Got CSV data: ' + csvData.length + ' bytes, first 500 chars: ' + csvData.slice(0, 500));
          break;
        }

        // JSON-ответ (может быть ошибка или неожиданный формат)
        if (typeof resp === 'object' && !resp.raw) {
          this.logger.info('[RecordingFetcher] Stats result response: ' + JSON.stringify(resp).slice(0, 500));
          // Может быть JSON вместо CSV — попробуем обработать
          if (resp.statusCode && resp.statusCode !== 200) continue;
          break;
        }
      } catch (err) {
        this.logger.warn('[RecordingFetcher] Stats result poll error: ' + err.message);
        break;
      }
    }

    if (!csvData || !csvData.trim()) {
      this.logger.warn('[RecordingFetcher] No data from Mango stats API');
      return;
    }

    // 6. Парсинг CSV: колонки = [records, entry_id], разделитель = ;
    const lines = csvData.trim().split('\n');
    this.logger.info('[RecordingFetcher] CSV lines: ' + lines.length + ', sample entry_ids from DB: ' + Array.from(entryMap.keys()).slice(0, 3).join(', '));
    if (lines.length > 0) {
      this.logger.info('[RecordingFetcher] First 3 CSV lines: ' + lines.slice(0, 3).join(' | '));
    }
    var matched = 0;

    for (var i = 0; i < lines.length; i++) {
      const parts = lines[i].split(';');
      if (parts.length < 2) continue;

      var recordsStr = (parts[0] || '').trim();
      const entryId = (parts[1] || '').trim();

      if (!entryId || !entryMap.has(entryId)) continue;
      if (!recordsStr) continue;

      // Убираем скобки если есть: [rec1,rec2] → rec1,rec2
      recordsStr = recordsStr.replace(/^\[|\]$/g, '');
      if (!recordsStr) continue;

      // Берём первый recording_id
      const recordingId = recordsStr.split(',')[0].trim();
      if (!recordingId) continue;

      const callHistoryId = entryMap.get(entryId);

      await this.db.query(
        "UPDATE call_history SET recording_id = $1, updated_at = NOW() WHERE id = $2 AND (recording_id IS NULL OR recording_id = '')",
        [recordingId, callHistoryId]
      );

      matched++;
      this.logger.info('[RecordingFetcher] Call #' + callHistoryId + ': recording_id = ' + recordingId);
    }

    this.logger.info('[RecordingFetcher] Matched ' + matched + ' recordings out of ' + pending.length + ' pending');

    // 7. Запуск пайплайна для найденных записей
    if (matched > 0 && this._jobQueue) {
      const { rows: toProcess } = await this.db.query(`
        SELECT id FROM call_history
        WHERE recording_id IS NOT NULL
          AND recording_id != ''
          AND record_path IS NULL
          AND created_at > NOW() - interval '30 days'
        ORDER BY created_at DESC
      `);

      for (var j = 0; j < toProcess.length; j++) {
        try {
          await this._jobQueue.enqueue('download_recording', toProcess[j].id);
        } catch (err) {
          // Дубликат задачи — игнорируем
        }
      }
      this.logger.info('[RecordingFetcher] Enqueued ' + toProcess.length + ' download jobs');
    }
  }

  _delay(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }
}

module.exports = RecordingFetcher;
