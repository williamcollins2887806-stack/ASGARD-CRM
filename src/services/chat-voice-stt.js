'use strict';

/**
 * Chat voice STT via SpeechKit — does NOT edit speechkit.js.
 * Pattern mirrors thing_jobs / telephony_jobs.
 */

const path = require('path');
const fs = require('fs');
const { getSpeechKitService } = require('./speechkit');
const huginnEvents = require('./huginn-events');

let _timer = null;
let _running = false;

async function enqueue(db, { messageId, chatId }) {
  const { rows } = await db.query(
    `INSERT INTO chat_voice_jobs (message_id, chat_id, status, scheduled_at)
     VALUES ($1, $2, 'pending', NOW())
     RETURNING *`,
    [messageId, chatId]
  );
  return rows[0];
}

function resolveAudioPath(fileUrl, uploadRoot) {
  if (!fileUrl || typeof fileUrl !== 'string') return null;
  const trimmed = fileUrl.trim().replace(/\\/g, '/');
  let rel = null;
  if (trimmed.startsWith('/uploads/')) rel = trimmed.slice('/uploads/'.length);
  else if (trimmed.startsWith('uploads/')) rel = trimmed.slice('uploads/'.length);
  else if (trimmed.startsWith('chat/')) rel = trimmed;
  else return null;
  const abs = path.resolve(uploadRoot, rel);
  const root = path.resolve(uploadRoot);
  if (!abs.startsWith(root)) return null;
  if (!fs.existsSync(abs)) return null;
  return abs;
}

async function processOne(db, job, uploadRoot) {
  const sk = getSpeechKitService();
  if (!sk || !sk.isConfigured()) {
    await db.query(
      `UPDATE chat_voice_jobs
       SET status = 'failed', error_text = $2, finished_at = NOW(), attempts = attempts + 1
       WHERE id = $1`,
      [job.id, 'SpeechKit not configured']
    );
    return;
  }

  await db.query(
    `UPDATE chat_voice_jobs
     SET status = 'running', started_at = NOW(), attempts = attempts + 1
     WHERE id = $1`,
    [job.id]
  );

  const { rows: msgs } = await db.query(
    `SELECT id, chat_id, file_url, message_type, metadata
     FROM chat_messages WHERE id = $1 AND deleted_at IS NULL`,
    [job.message_id]
  );
  const msg = msgs[0];
  if (!msg) {
    await db.query(
      `UPDATE chat_voice_jobs SET status = 'failed', error_text = 'message gone', finished_at = NOW() WHERE id = $1`,
      [job.id]
    );
    return;
  }

  const audioPath = resolveAudioPath(msg.file_url, uploadRoot);
  if (!audioPath) {
    await db.query(
      `UPDATE chat_voice_jobs SET status = 'failed', error_text = 'audio missing', finished_at = NOW() WHERE id = $1`,
      [job.id]
    );
    return;
  }

  try {
    const result = await sk.transcribeFile(audioPath, {
      languageCode: 'ru-RU',
      enableSpeakerDiarization: false,
      maxSpeakers: 1
    });
    const transcript = (result && result.text) ? String(result.text).trim() : '';
    const meta = typeof msg.metadata === 'object' && msg.metadata ? { ...msg.metadata } : {};
    meta.transcript = transcript;
    meta.transcript_status = 'done';

    await db.query(
      `UPDATE chat_messages SET metadata = $2::jsonb WHERE id = $1`,
      [msg.id, JSON.stringify(meta)]
    );
    await db.query(
      `UPDATE chat_voice_jobs
       SET status = 'done', transcript = $2, finished_at = NOW(), error_text = NULL
       WHERE id = $1`,
      [job.id, transcript]
    );

    await huginnEvents.publishToChatMembers(db, {
      chatId: msg.chat_id,
      eventType: 'chat:transcript_ready',
      payload: {
        chat_id: msg.chat_id,
        message_id: msg.id,
        transcript
      }
    });
  } catch (e) {
    await db.query(
      `UPDATE chat_voice_jobs
       SET status = 'failed', error_text = $2, finished_at = NOW()
       WHERE id = $1`,
      [job.id, (e && e.message) ? e.message.slice(0, 500) : 'stt failed']
    );
  }
}

async function tick(db, uploadRoot) {
  if (_running) return;
  _running = true;
  try {
    const { rows } = await db.query(
      `SELECT * FROM chat_voice_jobs
       WHERE status = 'pending' AND scheduled_at <= NOW()
       ORDER BY id ASC
       LIMIT 3`
    );
    for (const job of rows) {
      await processOne(db, job, uploadRoot);
    }
  } finally {
    _running = false;
  }
}

function startWorker(db, { uploadDir = './uploads', intervalMs = 4000 } = {}) {
  if (_timer) return;
  const uploadRoot = path.resolve(uploadDir);
  _timer = setInterval(() => {
    tick(db, uploadRoot).catch((e) => console.error('[chat-voice-stt]', e.message));
  }, intervalMs);
  if (_timer.unref) _timer.unref();
}

function stopWorker() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

module.exports = { enqueue, startWorker, stopWorker, tick, processOne };
