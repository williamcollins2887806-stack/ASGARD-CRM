'use strict';

/**
 * RecordingFetcher — запасной путь: если webhook recording/summary не принёс
 * recording_id, забираем его через Mango Stats API.
 *
 * Основной путь — src/routes/telephony.js (events/recording + summary).
 */

const { getMangoService } = require('./mango');
const { entryIdAliases, firstRecordingId } = require('../lib/mango-entry-id');

class RecordingFetcher {
  constructor(db, logger) {
    this.db = db;
    this.mango = getMangoService();
    this.logger = logger || console;
    this._interval = null;
    this._running = false;
    this._jobQueue = null;
    this._fetchIntervalMs = 5 * 60 * 1000;
    this._lastZeroWarnAt = 0;
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

  _buildEntryMap(pending) {
    const entryMap = new Map();
    for (const row of pending) {
      for (const alias of entryIdAliases(row.mango_entry_id)) {
        entryMap.set(alias, row.id);
      }
    }
    return entryMap;
  }

  _dayWindows(pending, maxDays) {
    const keys = [];
    const seen = new Set();
    for (const row of pending) {
      const d = new Date(row.created_at);
      if (isNaN(d.getTime())) continue;
      const key = d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
    keys.sort();
    keys.reverse();
    const picked = keys.slice(0, maxDays);
    return picked.map((key) => {
      const from = new Date(key + 'T00:00:00');
      const to = new Date(key + 'T23:59:59');
      from.setHours(from.getHours() - 6);
      to.setHours(to.getHours() + 6);
      return { from, to, key };
    });
  }

  async _fetchAndMatch() {
    const { rows: pending } = await this.db.query(`
      SELECT id, mango_entry_id, created_at,
             COALESCE((webhook_payload->>'recording_fetch_attempts')::int, 0) AS fetch_attempts
      FROM call_history
      WHERE mango_entry_id IS NOT NULL
        AND (recording_id IS NULL OR recording_id = '')
        AND record_path IS NULL
        AND duration_seconds > 0
        AND created_at > NOW() - interval '14 days'
        AND (
          COALESCE((webhook_payload->>'recording_fetch_attempts')::int, 0) < 5
          OR COALESCE((webhook_payload->>'recording_fetch_last_at')::timestamptz, '1970-01-01'::timestamptz)
               < NOW() - interval '7 days'
        )
      ORDER BY created_at DESC
      LIMIT 150
    `);

    if (!pending.length) return;

    this.logger.info('[RecordingFetcher] Found ' + pending.length + ' calls without recording_id');

    const entryMap = this._buildEntryMap(pending);
    const pendingIds = pending.map((r) => r.id);
    const windows = this._dayWindows(pending, 4);
    if (!windows.length) {
      const dates = pending.map((r) => new Date(r.created_at)).filter((d) => !isNaN(d.getTime()));
      if (dates.length) {
        windows.push({
          from: new Date(Math.min.apply(null, dates)),
          to: new Date(Math.max.apply(null, dates)),
          key: 'span',
        });
      }
    }

    let matched = 0;
    for (const win of windows) {
      let n = await this._tryBasicStats(entryMap, win.from, win.to);
      if (n === 0) {
        n = await this._tryExtendedStats(entryMap, win.from, win.to);
      }
      matched += n;
    }

    await this._bumpFetchAttempts(pendingIds);

    if (matched === 0) {
      const nowMs = Date.now();
      if (nowMs - this._lastZeroWarnAt > 60 * 60 * 1000) {
        this._lastZeroWarnAt = nowMs;
        this.logger.warn(
          '[RecordingFetcher] Total matched: 0 out of ' + pending.length +
          ' pending (throttled 1/h). Primary path is webhook events/recording.'
        );
      }
    } else {
      this.logger.info('[RecordingFetcher] Total matched: ' + matched + ' out of ' + pending.length + ' pending');
    }

    if (matched > 0 && this._jobQueue) {
      const { rows: toProcess } = await this.db.query(`
        SELECT id FROM call_history
        WHERE recording_id IS NOT NULL AND recording_id != ''
          AND record_path IS NULL
          AND created_at > NOW() - interval '14 days'
        ORDER BY created_at DESC
      `);
      for (let j = 0; j < toProcess.length; j++) {
        try {
          await this._jobQueue.enqueue('download_recording', toProcess[j].id);
        } catch (err) { /* дубликат — ок */ }
      }
      this.logger.info('[RecordingFetcher] Enqueued ' + toProcess.length + ' download jobs');
    }
  }

  async _bumpFetchAttempts(ids) {
    if (!ids || !ids.length) return;
    try {
      await this.db.query(`
        UPDATE call_history
        SET webhook_payload = COALESCE(webhook_payload, '{}'::jsonb)
              || jsonb_build_object(
                   'recording_fetch_attempts',
                   COALESCE((webhook_payload->>'recording_fetch_attempts')::int, 0) + 1,
                   'recording_fetch_last_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                 ),
            updated_at = NOW()
        WHERE id = ANY($1::int[])
          AND (recording_id IS NULL OR recording_id = '')
      `, [ids]);
    } catch (err) {
      this.logger.warn('[RecordingFetcher] bump attempts failed: ' + err.message);
    }
  }

  async _tryBasicStats(entryMap, minDate, now) {
    const dateFrom = Math.floor(minDate.getTime() / 1000);
    const dateTo = Math.floor(now.getTime() / 1000);

    let statsKey;
    try {
      const resp = await this.mango.requestStats(dateFrom, dateTo, 'records,entry_id');
      statsKey = resp.key;
    } catch (err) {
      this.logger.error('[RecordingFetcher] Basic stats request failed: ' + err.message);
      return 0;
    }
    if (!statsKey) return 0;

    let csvData = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      await this._delay(3000);
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

    const lines = csvData.trim().split('\n');
    let matched = 0;

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(';');
      if (parts.length < 2) continue;

      const recordsStr = (parts[0] || '').trim().replace(/^\[|\]$/g, '');
      const entryId = (parts[1] || '').trim();
      if (!entryId || !recordsStr) continue;
      if (entryId === 'entry_id' || recordsStr === 'records') continue;

      const callHistoryId = this._lookupCall(entryMap, entryId);
      if (!callHistoryId) continue;

      const recordingId = firstRecordingId(recordsStr.split(','));
      if (!recordingId) continue;

      await this._updateRecordingId(callHistoryId, recordingId);
      matched++;
    }

    this.logger.info('[RecordingFetcher] Basic Stats: ' + matched + ' recordings matched');
    return matched;
  }

  _lookupCall(entryMap, entryId) {
    if (entryMap.has(entryId)) return entryMap.get(entryId);
    const aliases = entryIdAliases(entryId);
    for (let i = 0; i < aliases.length; i++) {
      if (entryMap.has(aliases[i])) return entryMap.get(aliases[i]);
    }
    return null;
  }

  async _tryExtendedStats(entryMap, minDate, now) {
    const fmtDate = function(d) {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return dd + '.' + mm + '.' + yyyy + ' 00:00:00';
    };
    const fmtDateEnd = function(d) {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return dd + '.' + mm + '.' + yyyy + ' 23:59:59';
    };

    let matched = 0;
    let totalEntries = 0;
    let entriesWithRecording = 0;
    const sampleMangoIds = [];
    const sampleDbIds = Array.from(entryMap.keys()).filter((k) => /^\d+$/.test(k) || k.includes('=')).slice(0, 5);

    const pageLimit = 1000;
    for (let page = 0; page < 3; page++) {
      const offset = page * pageLimit;
      let statsKey;
      try {
        const resp = await this.mango.requestCallStats(fmtDate(minDate), fmtDateEnd(now), {
          limit: pageLimit,
          offset,
        });
        if (page === 0) {
          this.logger.info('[RecordingFetcher] Extended stats response: ' + JSON.stringify(resp).slice(0, 300));
        }
        statsKey = resp.key;
      } catch (err) {
        this.logger.error('[RecordingFetcher] Extended stats request failed: ' + err.message);
        break;
      }
      if (!statsKey) break;

      let result = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        await this._delay(3000);
        try {
          const resp = await this.mango.getCallStatsResult(statsKey);
          if (resp.statusCode === 204 || (resp.raw !== undefined && resp.raw === '')) continue;
          if (resp.data || resp.status === 'complete') {
            result = resp;
            break;
          }
          if (resp.raw && typeof resp.raw === 'string') {
            try { result = JSON.parse(resp.raw); break; } catch (e) { /* not JSON */ }
          }
        } catch (err) {
          this.logger.warn('[RecordingFetcher] Extended stats poll error: ' + err.message);
          break;
        }
      }

      if (!result) {
        if (page === 0) this.logger.warn('[RecordingFetcher] No Extended Stats result');
        break;
      }

      let pageRows = 0;
      if (result.data && Array.isArray(result.data)) {
        for (let p = 0; p < result.data.length; p++) {
          const period = result.data[p];
          if (!period.list) continue;
          for (let e = 0; e < period.list.length; e++) {
            const entry = period.list[e];
            const entryId = entry.entry_id != null ? String(entry.entry_id) : '';
            totalEntries++;
            pageRows++;
            if (sampleMangoIds.length < 5) sampleMangoIds.push(entryId || 'null');

            let recId = null;
            if (entry.context_calls) {
              for (let c = 0; c < entry.context_calls.length; c++) {
                recId = firstRecordingId(entry.context_calls[c].recording_id);
                if (recId) break;
              }
            }
            if (!recId) recId = firstRecordingId(entry.recording_id);
            if (recId) entriesWithRecording++;

            const callHistoryId = this._lookupCall(entryMap, entryId);
            if (!callHistoryId || !recId) continue;
            await this._updateRecordingId(callHistoryId, recId);
            matched++;
            this.logger.info('[RecordingFetcher] Extended: call #' + callHistoryId + ' recording_id = ' + recId);
          }
        }
      }

      if (pageRows < pageLimit) break;
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
