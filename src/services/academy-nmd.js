'use strict';

/**
 * Academy NMD — загрузка нормативных документов + RAG-чанки для генерации рун.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = process.env.NMD_UPLOAD_DIR
  || path.join(process.cwd(), 'uploads', 'nmd');

function ensureDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function chunkText(text, size = 900, overlap = 120) {
  const clean = String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!clean) return [];
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(clean.length, i + size);
    chunks.push(clean.slice(i, end).trim());
    if (end >= clean.length) break;
    i = Math.max(i + 1, end - overlap);
  }
  return chunks.filter(Boolean);
}

async function extractText(buf, mime, originalName) {
  const name = String(originalName || '').toLowerCase();
  const isPdf = mime === 'application/pdf' || name.endsWith('.pdf');
  const isDocx = mime?.includes('word') || name.endsWith('.docx');
  const isTxt = mime === 'text/plain' || name.endsWith('.txt') || name.endsWith('.md');

  if (isTxt) return buf.toString('utf8');
  if (isPdf) {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buf);
    return data.text || '';
  }
  if (isDocx) {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value || '';
  }
  throw new Error('Поддерживаются PDF, DOCX, TXT/MD');
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return -1;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!na || !nb) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embedTexts(texts) {
  try {
    const ai = require('./ai-provider');
    const vectors = await ai.embed({ texts });
    return vectors;
  } catch (e) {
    console.warn('[NMD] embed failed:', e.message);
    return texts.map(() => null);
  }
}

async function ingestBuffer(db, {
  buffer,
  originalName,
  mimeType,
  title,
  objectTag = 'mlsp',
  uploadedBy
}) {
  ensureDir();
  const text = await extractText(buffer, mimeType, originalName);
  if (!String(text).trim()) throw new Error('Не удалось извлечь текст из файла');

  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16);
  const safeName = String(originalName || 'doc').replace(/[^\w.\-а-яА-ЯёЁ]+/gi, '_').slice(0, 80);
  const fileName = `${Date.now()}_${hash}_${safeName}`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  fs.writeFileSync(filePath, buffer);

  const { rows: [doc] } = await db.query(`
    INSERT INTO academy_nmd_docs
      (title, object_tag, original_name, file_path, mime_type, byte_size, uploaded_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *
  `, [
    title || originalName || 'НМД',
    objectTag,
    originalName || null,
    filePath,
    mimeType || null,
    buffer.length,
    uploadedBy || null
  ]);

  const parts = chunkText(text);
  const vectors = await embedTexts(parts);
  for (let i = 0; i < parts.length; i++) {
    await db.query(`
      INSERT INTO academy_nmd_chunks (doc_id, chunk_idx, content, embedding)
      VALUES ($1,$2,$3,$4)
    `, [doc.id, i, parts[i], vectors[i] ? JSON.stringify(vectors[i]) : null]);
  }

  return { doc, chunks: parts.length };
}

/**
 * Retrieve top-K NMD chunks for a topic (RAG).
 */
async function retrieveNmdContext(db, { query, objectTag = 'mlsp', limit = 8 }) {
  const { rows: chunks } = await db.query(`
    SELECT c.id, c.content, c.embedding, d.title, d.object_tag
    FROM academy_nmd_chunks c
    JOIN academy_nmd_docs d ON d.id = c.doc_id
    WHERE ($1::text IS NULL OR d.object_tag = $1)
    ORDER BY c.id DESC
    LIMIT 400
  `, [objectTag || null]);

  if (!chunks.length) return { context: '', hits: [] };

  let qVec = null;
  try {
    const vecs = await embedTexts([String(query || '').slice(0, 2000)]);
    qVec = vecs[0];
  } catch (_) { /* fallback lexical */ }

  let ranked;
  if (qVec) {
    ranked = chunks
      .map((c) => {
        let emb = c.embedding;
        if (typeof emb === 'string') {
          try { emb = JSON.parse(emb); } catch { emb = null; }
        }
        return { ...c, score: cosine(qVec, emb) };
      })
      .sort((a, b) => b.score - a.score);
  } else {
    const q = String(query || '').toLowerCase();
    const terms = q.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 3);
    ranked = chunks
      .map((c) => {
        const t = (c.content || '').toLowerCase();
        let score = 0;
        for (const term of terms) if (t.includes(term)) score += 1;
        return { ...c, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  const hits = ranked.filter((h) => h.score > 0).slice(0, limit);
  if (!hits.length) {
    // если эмбеддинги null — берём первые чанки по тегу
    hits.push(...chunks.slice(0, Math.min(limit, 4)).map((c) => ({ ...c, score: 0 })));
  }

  const context = hits.map((h, i) =>
    `[НМД ${i + 1}: ${h.title}]\n${h.content}`
  ).join('\n\n---\n\n');

  return { context, hits: hits.map((h) => ({ id: h.id, title: h.title, score: h.score })) };
}

async function listDocs(db, objectTag) {
  const { rows } = await db.query(`
    SELECT d.*,
      (SELECT count(*)::int FROM academy_nmd_chunks c WHERE c.doc_id = d.id) AS chunk_count
    FROM academy_nmd_docs d
    WHERE ($1::text IS NULL OR d.object_tag = $1)
    ORDER BY d.id DESC
  `, [objectTag || null]);
  return rows;
}

/** Re-embed all chunks missing vectors (or force all). */
async function reembedChunks(db, { force = false, batchSize = 16 } = {}) {
  const { rows: chunks } = await db.query(`
    SELECT id, content FROM academy_nmd_chunks
    WHERE ($1::boolean = true OR embedding IS NULL)
    ORDER BY id
  `, [force]);
  let updated = 0;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vectors = await embedTexts(batch.map((c) => c.content));
    for (let j = 0; j < batch.length; j++) {
      if (!vectors[j]) continue;
      await db.query(
        `UPDATE academy_nmd_chunks SET embedding = $2 WHERE id = $1`,
        [batch[j].id, JSON.stringify(vectors[j])]
      );
      updated++;
    }
    console.log(`[NMD] reembed ${Math.min(i + batchSize, chunks.length)}/${chunks.length}`);
  }
  return { total: chunks.length, updated };
}

module.exports = {
  ingestBuffer,
  retrieveNmdContext,
  listDocs,
  reembedChunks,
  chunkText,
  UPLOAD_DIR,
};
