'use strict';

/**
 * RecordingFetcher — фоновый сервис, который через Mango Stats API
 * забирает recording_id для звонков, у которых он отсутствует.
 *
 * Стратегия:
 * 1. Basic Stats API (stats/request) — быстрый, CSV с полем records
 * 2. Extended Stats API (stats/calls/request) — JSON с recording_id в context_calls
 * Если Basic Stats вернул пустые records, пробуем Extended.
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
    // 1. Звонки без recording_id (отвеченные, duration > 0)
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

    if (!pending.length) return;

    this.logger.info('[RecordingFetcher] Found ' + pending.length + ' calls without recording_id');

    // 2. Карта entry_id → call_history.id
    const entryMap = new Map();
    for (const row of pending) {
      entryMap.set(row.mango_entry_id, row.id);
    }

    // 3. Диапазон дат
    const dates = pending.map(r => new Date(r.created_at));
    const minDate = new Date(Math.min.apply(null, dates));
    const now = new Date();

    // === Попытка 1: Basic Stats API ===
    var matched = await this._tryBasicStats(entryMap, minDate, now);

    // === Попытка 2: Extended Stats API (если Basic не нашёл записей) ===
    if (matched === 0) {
      this.logger.info('[RecordingFetcher] Basic Stats found 0 recordings, trying Extended Stats API...');
      matched = await this._tryExtendedStats(entryMap, minDate, now);
    }

    this.logger.info('[RecordingFetcher] Total matched: ' + matched + ' out of ' + pending.length + ' pending');

    // 4. Запуск пайплайна для найденных
    if (matched > 0 && this._jobQueue) {
      const { rows: toProcess } = await this.db.query(`
        SELECT id FROM call_history
        WHERE recording_id IS NOT NULL AND recording_id != ''
          AND record_path IS NULL
          AND created_at > NOW() - interval '30 days'
        ORDER BY created_at DESC
      `);
      for (var j = 0; j < toProcess.length; j++) {
        try {
          await this._jobQueue.enqueue('download_recording', toProcess[j].id);
        } catch (err) { /* дубликат — ок */ }
      }
      this.logger.info('[RecordingFetcher] Enqueued ' + toProcess.length + ' download jobs');
    }
  }

  // ─── Basic Stats API (CSV) ───
  async _tryBasicStats(entryMap, minDate, now) {
    const dateFrom = Math.floor(minDate.getTime() / 1000);
    const dateTo = Math.floor(now.getTime() / 1000);

    var statsKey;
    try {
      const resp = await this.mango.requestStats(dateFrom, dateTo, 'records,entry_id');
      statsKey = resp.key;
    } catch (err) {
      this.logger.error('[RecordingFetcher] Basic stats request failed: ' + err.message);
      return 0;
    }
    if (!statsKey) return 0;

    // Поллинг CSV (макс 60с)
    var csvData = null;
    for (var attempt = 0; attempt < 12; attempt++) {
      await this._delay(5000);
      try {
        const resp = await this.mango.getStatsResult(statsKey);
        if (resp.statusCode === 204 || (resp.raw !== undefined && resp.raw === '')) continue;
        if (resp.raw) {
          csvData = typeof resp.raw === 'string' ? resp.raw : resp.raw.toString('utf8');
          break;
        }
        if (typeof resp === 'object' && !resp.raw) {
          if (resp.statusCode && resp.statusCode !== 200) continue;
          break;
        }
      } catch (err) {
        this.logger.warn('[RecordingFetcher] Basic stats poll error: ' + err.message);
        break;
      }
    }

    if (!csvData || !csvData.trim()) return 0;

    // Парсинг CSV: [records];[entry_id]
    const lines = csvData.trim().split('\n');
    var matched = 0;

    for (var i = 0; i < lines.length; i++) {
      const parts = lines[i].split(';');
      if (parts.length < 2) continue;

      var recordsStr = (parts[0] || '').trim().replace(/^\[|\]$/g, '');
      const entryId = (parts[1] || '').trim();

      if (!entryId || !entryMap.has(entryId) || !recordsStr) continue;

      const recordingId = recordsStr.split(',')[0].trim();
      if (!recordingId) continue;

      await this._updateRecordingId(entryMap.get(entryId), recordingId);
      matched++;
    }

    this.logger.info('[RecordingFetcher] Basic Stats: ' + matched + ' recordings matched');
    return matched;
  }

  // ─── Extended Stats API (JSON) ───
  async _tryExtendedStats(entryMap, minDate, now) {
    // Формат даты: DD.MM.YYYY HH:MM:SS
    const fmtDate = function(d) {
      var dd = String(d.getDate()).padStart(2, '0');
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var yyyy = d.getFullYear();
      return dd + '.' + mm + '.' + yyyy + ' 00:00:00';
    };
    const fmtDateEnd = function(d) {
      var dd = String(d.getDate()).padStart(2, '0');
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var yyyy = d.getFullYear();
      return dd + '.' + mm + '.' + yyyy + ' 23:59:59';
    };

    var statsKey;
    try {
      const resp = await this.mango.requestCallStats(fmtDate(minDate), fmtDateEnd(now));
      this.logger.info('[RecordingFetcher] Extended stats response: ' + JSON.stringify(resp).slice(0, 300));
      statsKey = resp.key;
    } catch (err) {
      this.logger.error('[RecordingFetcher] Extended stats request failed: ' + err.message);
      return 0;
    }
    if (!statsKey) return 0;

    // Поллинг JSON (макс 60с)
    var result = null;
    for (var attempt = 0; attempt < 12; attempt++) {
      await this._delay(5000);
      try {
        const resp = await this.mango.getCallStatsResult(statsKey);
        if (resp.statusCode === 204 || (resp.raw !== undefined && resp.raw === '')) continue;
        if (resp.data || resp.status === 'complete') {
          result = resp;
          break;
        }
        // Может прийти как raw JSON строка
        if (resp.raw && typeof resp.raw === 'string') {
          try { result = JSON.parse(resp.raw); break; } catch (e) { /* not JSON */ }
        }
      } catch (err) {
        this.logger.warn('[RecordingFetcher] Extended stats poll error: ' + err.message);
        break;
      }
    }

    if (!result) {
      this.logger.warn('[RecordingFetcher] No Extended Stats result');
      return 0;
    }

    this.logger.info('[RecordingFetcher] Extended stats status: ' + (result.status || 'unknown') +
      ', data periods: ' + (result.data ? result.data.length : 0));

    // Парсинг JSON: data[].list[].entry_id + context_calls[].recording_id[]
    var matched = 0;
    var totalEntries = 0;
    var entriesWithRecording = 0;
    var sampleMangoIds = [];
    var sampleDbIds = Array.from(entryMap.keys()).slice(0, 5);

    if (result.data && Array.isArray(result.data)) {
      for (var p = 0; p < result.data.length; p++) {
        var period = result.data[p];
        if (!period.list) continue;
        for (var e = 0; e < period.list.length; e++) {
          var entry = period.list[e];
          var entryId = entry.entry_id;
          totalEntries++;
          if (sampleMangoIds.length < 5) sampleMangoIds.push(entryId || 'null');

          // Проверяем recording_id
          if (entry.context_calls) {
            for (var cc = 0; cc < entry.context_calls.length; cc++) {
              if (entry.context_calls[cc].recording_id && entry.context_calls[cc].recording_id.length > 0) {
                entriesWithRecording++;
                break;
              }
            }
          }

          if (!entryId || !entryMap.has(entryId)) continue;

          // Ищем recording_id в context_calls
          if (!entry.context_calls) continue;
          for (var c = 0; c < entry.context_calls.length; c++) {
            var call = entry.context_calls[c];
            if (call.recording_id && Array.isArray(call.recording_id) && call.recording_id.length > 0) {
              var recId = call.recording_id[0];
              await this._updateRecordingId(entryMap.get(entryId), recId);
              matched++;
              this.logger.info('[RecordingFetcher] Extended: call #' + entryMap.get(entryId) + ' recording_id = ' + recId);
              break;
            }
          }
        }
      }
    }

    this.logger.info('[RecordingFetcher] Extended Stats: ' + matched + ' matched, ' + totalEntries + ' total entries, ' + entriesWithRecording + ' with recordings');
    this.logger.info('[RecordingFetcher] Sample Mango entry_ids: ' + sampleMangoIds.join(', '));
    this.logger.info('[RecordingFetcher] Sample DB entry_ids: ' + sampleDbIds.join(', '));
    return matched;
  }

  async _updateRecordingId(callHistoryId, recordingId) {
    await this.db.query(
      "UPDATE call_history SET recording_id = $1, updated_at = NOW() WHERE id = $2 AND (recording_id IS NULL OR recording_id = '')",
      [recordingId, callHistoryId]
    );
  }

  _delay(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }
}

module.exports = RecordingFetcher;
