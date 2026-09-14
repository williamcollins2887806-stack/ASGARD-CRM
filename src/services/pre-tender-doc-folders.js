'use strict';

/** Системные папки проводника документов pre_tender (см. V270). */
const DEFAULT_DOCUMENT_FOLDERS = [
  { id: 'customer', name: 'От заказчика', system: true, parent_id: null },
  { id: 'pm_upload', name: 'Загружено РП', system: true, parent_id: null },
  { id: 'tkp', name: 'ТКП', system: true, parent_id: null },
  { id: 'mimir', name: 'Мимир', system: true, parent_id: null },
];

const MAX_FOLDER_DEPTH = 3;

function ensureDocumentFolders(folders) {
  if (Array.isArray(folders) && folders.length) {
    return folders.map((f) => ({
      ...f,
      parent_id: f.parent_id || null,
    }));
  }
  return DEFAULT_DOCUMENT_FOLDERS.map((f) => ({ ...f }));
}

function inferFolderId(doc) {
  if (!doc || typeof doc !== 'object') return 'pm_upload';
  if (doc.folder_id) return doc.folder_id;
  if (doc.generated_by === 'mimir' || doc.source === 'mimir') return 'mimir';
  if (doc.kind === 'tkp' || doc.source === 'tkp') return 'tkp';
  if (doc.source === 'email') return 'customer';
  return 'pm_upload';
}

function tagDocumentFolder(doc, folders) {
  const folderId = inferFolderId(doc);
  const list = ensureDocumentFolders(folders);
  const folder = list.find((f) => f.id === folderId);
  return {
    ...doc,
    folder_id: folderId,
    folder_name: folder?.name || doc.folder_name || folderId,
  };
}

function getFolderDepth(folders, folderId) {
  const byId = Object.fromEntries((folders || []).map((f) => [f.id, f]));
  let depth = 0;
  let cur = byId[folderId];
  while (cur && cur.parent_id) {
    depth += 1;
    cur = byId[cur.parent_id];
    if (depth > 10) break;
  }
  return depth;
}

function buildFolderTree(folders) {
  const list = ensureDocumentFolders(folders);
  const byParent = {};
  list.forEach((f) => {
    const pid = f.parent_id || '__root__';
    if (!byParent[pid]) byParent[pid] = [];
    byParent[pid].push(f);
  });
  const out = [];
  const walk = (parentId, depth) => {
    (byParent[parentId] || []).forEach((f) => {
      out.push({ ...f, depth });
      walk(f.id, depth + 1);
    });
  };
  walk('__root__', 0);
  return out;
}

function validateParentFolder(folders, parentId) {
  if (!parentId) return { ok: true };
  const list = ensureDocumentFolders(folders);
  const parent = list.find((f) => f.id === parentId);
  if (!parent) return { ok: false, error: 'parent_not_found' };
  const depth = getFolderDepth(list, parentId);
  if (depth >= MAX_FOLDER_DEPTH - 1) {
    return { ok: false, error: 'max_folder_depth' };
  }
  return { ok: true, parent };
}

function hasChildFolders(folders, folderId) {
  return (folders || []).some((f) => f.parent_id === folderId);
}

module.exports = {
  DEFAULT_DOCUMENT_FOLDERS,
  MAX_FOLDER_DEPTH,
  ensureDocumentFolders,
  inferFolderId,
  tagDocumentFolder,
  getFolderDepth,
  buildFolderTree,
  validateParentFolder,
  hasChildFolders,
};
