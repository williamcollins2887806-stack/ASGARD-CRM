'use strict';

/** Системные папки проводника документов pre_tender (см. V270). */
const DEFAULT_DOCUMENT_FOLDERS = [
  { id: 'customer', name: 'От заказчика', system: true },
  { id: 'pm_upload', name: 'Загружено РП', system: true },
  { id: 'tkp', name: 'ТКП', system: true },
  { id: 'mimir', name: 'Мимир', system: true },
];

function ensureDocumentFolders(folders) {
  if (Array.isArray(folders) && folders.length) return folders;
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

module.exports = {
  DEFAULT_DOCUMENT_FOLDERS,
  ensureDocumentFolders,
  inferFolderId,
  tagDocumentFolder,
};
