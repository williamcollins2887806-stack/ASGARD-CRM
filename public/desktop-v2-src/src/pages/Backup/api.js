/**
 * API-клиент страницы /backup.
 *
 * Vanilla `public/assets/js/backup.js` экспортировал/импортировал локальную
 * IndexedDB. В CRM 2.0 источник истины — серверный PostgreSQL, поэтому
 * страница «Резерв» использует `POST /api/admin/system/action` с
 * `action: 'run-command'` для:
 *   • листинг бэкапов:  `ls -la /root/backup_*.dump`
 *   • создание дампа:   `PGPASSWORD=… pg_dump -U asgard -Fc asgard_crm -f /root/backup_…dump`
 *   • размер дампа:     `du -h /root/backup_…dump`
 *
 * Все команды выполняются под root (см. admin-system.js) и доступны только ADMIN.
 *
 * Альтернатива (для не-ADMIN директоров) — экспорт настроек:
 *   GET /api/settings → JSON.stringify → скачать как файл.
 */
import { api } from '@/api/client';

export const ADMIN_ROLE = 'ADMIN';

const BACKUP_DIR = '/root';
const BACKUP_PREFIX = 'asgard_backup_';
const PG_USER = 'asgard';
const PG_DB = 'asgard_crm';
const PG_PASS = '123456789'; // совпадает с deploy_rules в admin-system.js

export async function runCommand(command) {
  return api('/api/admin/system/action', {
    method: 'POST',
    body: { action: 'run-command', command }
  });
}

/* ── Бэкапы на сервере ─────────────────────────────────────────────────── */
export async function listBackups() {
  // ls с timestamp + size + name; парсим вывод
  const cmd =
    `ls -la ${BACKUP_DIR}/${BACKUP_PREFIX}*.dump 2>/dev/null ` +
    `| awk '{ size=$5; date=$6" "$7" "$8; name=$9; printf "%s|%s|%s\\n", name, size, date }' ` +
    `|| true`;
  const r = await runCommand(cmd);
  const raw = (r?.output || '').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    const [path, sizeStr, date] = line.split('|');
    const name = (path || '').split('/').pop();
    return {
      path,
      name,
      size: Number(sizeStr) || 0,
      sizeText: fmtBytes(Number(sizeStr) || 0),
      modified: date || ''
    };
  });
}

export async function createBackup(label) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = (label || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'manual';
  const file = `${BACKUP_DIR}/${BACKUP_PREFIX}${safe}_${stamp}.dump`;
  const cmd = `PGPASSWORD=${PG_PASS} pg_dump -U ${PG_USER} -Fc ${PG_DB} -f ${file} && ls -la ${file}`;
  return runCommand(cmd).then((r) => ({ ...r, file }));
}

export async function deleteBackup(path) {
  // Защита от случайного удаления не-дампа
  if (!path || !path.endsWith('.dump') || !path.includes(BACKUP_PREFIX)) {
    throw new Error('Запрещённый путь');
  }
  return runCommand(`rm -f ${path}`);
}

/* ── Экспорт настроек (для не-ADMIN) ───────────────────────────────────── */
export async function exportSettings() {
  const data = await api('/api/settings');
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8'
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  triggerDownload(`asgard_settings_${stamp}.json`, blob);
}

/* ── helpers ──────────────────────────────────────────────────────────── */
export function fmtBytes(n) {
  if (!Number.isFinite(+n) || n <= 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = +n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? String(v) : v.toFixed(1)) + ' ' + u[i];
}

export function triggerDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 150);
}
