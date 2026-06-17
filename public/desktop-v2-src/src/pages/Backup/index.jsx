/**
 * Страница /backup — Резерв (резервные копии БД).
 *
 * Источник: vanilla `public/assets/js/backup.js` (~135 строк, локальный
 * экспорт IndexedDB). В CRM 2.0 — pg_dump на сервере через
 * `POST /api/admin/system/action` (action='run-command').
 *
 * RBAC: только ADMIN (admin-system endpoints requireRoles ADMIN).
 *
 * Альтернатива для не-ADMIN директоров — экспорт настроек в JSON
 * (через `GET /api/settings`).
 */
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal, PromptModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';

import {
  ADMIN_ROLE,
  listBackups, createBackup, deleteBackup, exportSettings, fmtBytes
} from './api';
import './backup.css';

export default function BackupPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);

  const isAdmin = user?.role === ADMIN_ROLE;
  const isDirector = String(user?.role || '').startsWith('DIRECTOR_');

  const refresh = useCallback(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    listBackups()
      .then(setBackups)
      .catch((e) => toast.error('Не удалось получить список: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  useEffect(() => { refresh(); }, [refresh]);

  const onCreate = () => {
    modal.open(
      <PromptModal
        title="Новый бэкап БД"
        subtitle="Будет создан файл asgard_backup_{метка}_{timestamp}.dump"
        label="Метка для имени файла (необязательно)"
        placeholder="manual, before_migration, etc."
        required={false}
        okText="Создать pg_dump"
        cancelText="Отмена"
        onSubmit={async (label) => {
          setCreating(true);
          try {
            const r = await createBackup(label || '');
            if (r?.ok === false) {
              toast.error('Не удалось создать дамп: ' + (r?.output || ''));
              return;
            }
            toast.success('Бэкап создан: ' + (r?.file || ''));
            refresh();
          } catch (e) {
            toast.error('Ошибка: ' + (e?.message || e));
          } finally {
            setCreating(false);
          }
        }}
      />
    );
  };

  const onDelete = (item) => {
    modal.open(
      <ConfirmModal
        title="Удалить бэкап?"
        message={`Файл ${item.name} будет безвозвратно удалён с сервера. Восстановить нельзя.`}
        tone="danger"
        okText="Удалить"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            await deleteBackup(item.path);
            toast.success('Бэкап удалён');
            refresh();
          } catch (e) {
            toast.error('Не удалось удалить: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onExportSettings = async () => {
    setExporting(true);
    try {
      await exportSettings();
      toast.success('JSON настроек скачан');
    } catch (e) {
      toast.error('Не удалось экспортировать: ' + (e?.message || e));
    } finally {
      setExporting(false);
    }
  };

  if (!user) return null;

  if (!isAdmin) {
    // Не-ADMIN всё равно видят экспорт настроек (если хотя бы директор)
    if (!isDirector) {
      return (
        <div className="col gap-12">
          <TopActionsBar kicker="Раздел" title="Резерв" />
          <EmptyState
            icon="🔒"
            title="Нет доступа"
            hint="Бэкапы БД доступны только администраторам, экспорт настроек — администраторам и директорам"
          />
        </div>
      );
    }
    return (
      <div className="col gap-12">
        <TopActionsBar
          kicker="Раздел"
          title="Резерв"
          subtitle="Экспорт настроек системы"
        />
        <div className="bkp-grid">
          <div className="bkp-card">
            <h3>📥 Экспорт настроек</h3>
            <p className="bkp-hint">
              Скачать все настройки CRM (профиль компании, SLA, калькулятор, цвета, справочники)
              одним JSON-файлом. Используется для переноса между средами или восстановления.
            </p>
            <Btn onClick={onExportSettings} disabled={exporting}>
              {exporting ? 'Готовим…' : '📥 Скачать JSON'}
            </Btn>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Раздел"
        title="Резерв"
        subtitle={
          loading
            ? 'Загружаем…'
            : `${backups.length} бэкап${pluralize(backups.length)} · ${fmtBytes(
                backups.reduce((s, b) => s + (b.size || 0), 0)
              )} итого`
        }
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={onExportSettings} disabled={exporting}>
              📥 Настройки JSON
            </Btn>
            <Btn onClick={onCreate} disabled={creating}>
              {creating ? '⏳ pg_dump…' : '＋ Новый pg_dump'}
            </Btn>
          </>
        }
      />

      <div className="bkp-grid">
        <div className="bkp-card col-span-2">
          <h3>📦 Бэкапы БД на сервере</h3>
          <p className="bkp-hint">
            Файлы <code>{'/root/asgard_backup_*.dump'}</code> — кастомный формат pg_dump (восстановление через <code>pg_restore -d asgard_crm</code>).
            Создаются вручную и автоматически перед деплоями/миграциями.
          </p>

          {loading ? (
            <div className="bkp-empty">⏳ Запрашиваем список…</div>
          ) : backups.length === 0 ? (
            <div className="bkp-empty">
              Бэкапов нет. Нажмите «＋ Новый pg_dump», чтобы создать первый.
            </div>
          ) : (
            <div className="bkp-list">
              {backups.map((b) => (
                <div key={b.path} className="bkp-row">
                  <div className="name" title={b.path}>{b.name}</div>
                  <div className="size">{b.sizeText}</div>
                  <div className="when">{b.modified}</div>
                  <Btn size="sm" variant="ghost" onClick={() => onDelete(b)} title="Удалить">
                    🗑
                  </Btn>
                </div>
              ))}
            </div>
          )}

          <p className="bkp-cmd">
            {`# Восстановление:
PGPASSWORD=… pg_restore -U asgard -d asgard_crm --clean --if-exists \\
  /root/asgard_backup_…dump`}
          </p>
        </div>
      </div>
    </div>
  );
}

function pluralize(n) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'ов';
  if (b > 1 && b < 5) return 'а';
  if (b === 1) return '';
  return 'ов';
}
