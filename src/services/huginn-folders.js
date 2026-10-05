'use strict';

async function listFolders(db, userId) {
  const { rows } = await db.query(
    `SELECT f.*,
       (SELECT COUNT(*)::int FROM huginn_chat_folder_members m WHERE m.folder_id = f.id) AS chat_count
     FROM huginn_chat_folders f
     WHERE f.user_id = $1
     ORDER BY f.sort_order ASC, f.id ASC`,
    [userId]
  );
  const active = await db.query(
    'SELECT huginn_active_folder_id FROM users WHERE id = $1',
    [userId]
  );
  return {
    folders: rows,
    active_folder_id: active.rows[0] ? active.rows[0].huginn_active_folder_id : null
  };
}

async function createFolder(db, userId, { name, iconEmoji, sortOrder }) {
  const n = String(name || '').trim().slice(0, 64);
  if (!n) {
    const err = new Error('name_required');
    err.code = 'bad_request';
    throw err;
  }
  let order = Number.isFinite(sortOrder) ? sortOrder : null;
  if (order == null) {
    const { rows } = await db.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM huginn_chat_folders WHERE user_id = $1',
      [userId]
    );
    order = rows[0].n;
  }
  const { rows } = await db.query(
    `INSERT INTO huginn_chat_folders (user_id, name, icon_emoji, sort_order)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [userId, n, iconEmoji || null, order]
  );
  return rows[0];
}

async function updateFolder(db, userId, folderId, patch) {
  const id = parseInt(folderId, 10);
  if (!Number.isFinite(id)) {
    const err = new Error('bad_id');
    err.code = 'bad_request';
    throw err;
  }
  const fields = [];
  const vals = [];
  let i = 1;
  if (patch.name != null) {
    fields.push(`name = $${i++}`);
    vals.push(String(patch.name).trim().slice(0, 64));
  }
  if (patch.iconEmoji !== undefined) {
    fields.push(`icon_emoji = $${i++}`);
    vals.push(patch.iconEmoji || null);
  }
  if (patch.sortOrder != null) {
    fields.push(`sort_order = $${i++}`);
    vals.push(parseInt(patch.sortOrder, 10));
  }
  if (!fields.length) {
    const err = new Error('nothing_to_update');
    err.code = 'bad_request';
    throw err;
  }
  fields.push('updated_at = NOW()');
  vals.push(id, userId);
  const { rows } = await db.query(
    `UPDATE huginn_chat_folders SET ${fields.join(', ')}
     WHERE id = $${i++} AND user_id = $${i}
     RETURNING *`,
    vals
  );
  if (!rows[0]) {
    const err = new Error('not_found');
    err.code = 'not_found';
    throw err;
  }
  return rows[0];
}

async function deleteFolder(db, userId, folderId) {
  const id = parseInt(folderId, 10);
  await db.query(
    'UPDATE users SET huginn_active_folder_id = NULL WHERE id = $1 AND huginn_active_folder_id = $2',
    [userId, id]
  );
  const { rowCount } = await db.query(
    'DELETE FROM huginn_chat_folders WHERE id = $1 AND user_id = $2 AND is_system = false',
    [id, userId]
  );
  if (!rowCount) {
    const err = new Error('not_found');
    err.code = 'not_found';
    throw err;
  }
  return { ok: true };
}

async function reorderFolders(db, userId, orderedIds) {
  if (!Array.isArray(orderedIds) || !orderedIds.length) {
    const err = new Error('ids_required');
    err.code = 'bad_request';
    throw err;
  }
  for (let i = 0; i < orderedIds.length; i++) {
    const id = parseInt(orderedIds[i], 10);
    if (!Number.isFinite(id)) continue;
    await db.query(
      'UPDATE huginn_chat_folders SET sort_order = $3, updated_at = NOW() WHERE id = $1 AND user_id = $2',
      [id, userId, i]
    );
  }
  return listFolders(db, userId);
}

async function assignChat(db, userId, chatId, folderId) {
  const cid = parseInt(chatId, 10);
  if (!Number.isFinite(cid)) {
    const err = new Error('bad_chat');
    err.code = 'bad_request';
    throw err;
  }
  // Remove from all of this user's folders first (one folder per chat per user)
  await db.query(
    `DELETE FROM huginn_chat_folder_members m
     USING huginn_chat_folders f
     WHERE m.folder_id = f.id AND f.user_id = $1 AND m.chat_id = $2`,
    [userId, cid]
  );
  if (folderId == null || folderId === '' || folderId === 0) {
    return { chat_id: cid, folder_id: null };
  }
  const fid = parseInt(folderId, 10);
  const own = await db.query(
    'SELECT id FROM huginn_chat_folders WHERE id = $1 AND user_id = $2',
    [fid, userId]
  );
  if (!own.rows[0]) {
    const err = new Error('folder_not_found');
    err.code = 'not_found';
    throw err;
  }
  await db.query(
    `INSERT INTO huginn_chat_folder_members (folder_id, chat_id)
     VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [fid, cid]
  );
  return { chat_id: cid, folder_id: fid };
}

async function setActiveFolder(db, userId, folderId) {
  if (folderId == null || folderId === '' || folderId === 0) {
    await db.query('UPDATE users SET huginn_active_folder_id = NULL WHERE id = $1', [userId]);
    return { active_folder_id: null };
  }
  const fid = parseInt(folderId, 10);
  const own = await db.query(
    'SELECT id FROM huginn_chat_folders WHERE id = $1 AND user_id = $2',
    [fid, userId]
  );
  if (!own.rows[0]) {
    const err = new Error('folder_not_found');
    err.code = 'not_found';
    throw err;
  }
  await db.query('UPDATE users SET huginn_active_folder_id = $2 WHERE id = $1', [userId, fid]);
  return { active_folder_id: fid };
}

module.exports = {
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  reorderFolders,
  assignChat,
  setActiveFolder
};
