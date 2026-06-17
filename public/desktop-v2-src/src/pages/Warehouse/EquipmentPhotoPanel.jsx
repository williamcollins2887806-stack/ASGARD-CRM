/**
 * Equipment Photo Manager (E-PHOTO).
 *
 * Универсальная панель управления фото/иконкой оборудования. Используется:
 *   • в EquipmentCardModal — таб «📷 Фото» (с серверным сохранением)
 *   • в EquipmentFormModal — inline-секция (при создании — отложенная отправка)
 *
 * Vanilla источник: public/assets/js/equipment.js строки 228-345 (renderPhotoZone,
 * initPhotoZone, handlePhotoFile, uploadPendingPhoto, pickIcon, removePhoto).
 * Backend: POST/DELETE /api/equipment/:id/photo (см. equipment.js:2206-2258).
 *
 * Контракт props:
 *   eqId      - id оборудования (>0 → серверное сохранение; 0/null → отложенный режим)
 *   photoUrl  - текущий photo_url (для превью)
 *   customIcon- текущий custom_icon (emoji)
 *   onChange  - колбэк ({ photo_url, custom_icon, pending_file }) — для отложенного режима
 *   onSaved   - колбэк после успешного сохранения на сервере
 *   compact   - true для inline-режима (меньше превью)
 */
import { useState, useRef } from 'react';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  uploadEquipmentPhoto, setEquipmentIcon, deleteEquipmentPhoto, ICON_LIBRARY
} from './api';

export function EquipmentPhotoPanel({
  eqId,
  photoUrl,
  customIcon,
  onChange,
  onSaved,
  compact = false
}) {
  const isPersisted = !!(eqId && Number(eqId) > 0);
  const [localPhotoUrl, setLocalPhotoUrl] = useState(photoUrl || '');
  const [localIcon, setLocalIcon] = useState(customIcon || '');
  const [previewDataUrl, setPreviewDataUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [showIcons, setShowIcons] = useState(false);
  const [iconQuery, setIconQuery] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const hasPhoto = !!(localPhotoUrl && !localPhotoUrl.startsWith('icon:')) || !!previewDataUrl;
  const hasIcon = !!localIcon && !hasPhoto;
  const previewSrc = previewDataUrl || localPhotoUrl;
  const previewSize = compact ? 120 : 200;

  function notifyChange(next) {
    onChange?.({
      photo_url: next.photoUrl ?? localPhotoUrl,
      custom_icon: next.customIcon ?? localIcon,
      pending_file: next.pendingFile ?? null
    });
  }

  async function handleFile(file) {
    if (!file || !file.type?.startsWith('image/')) {
      toast.warn('Выберите изображение');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.warn('Файл больше 10 МБ');
      return;
    }
    // Локальное превью (всегда — UX).
    const reader = new FileReader();
    reader.onload = (e) => setPreviewDataUrl(e.target?.result || '');
    reader.readAsDataURL(file);

    if (!isPersisted) {
      // Отложенный режим: файл сохраняется в onChange, форма пошлёт после создания eqId.
      notifyChange({ pendingFile: file, customIcon: '' });
      setLocalIcon('');
      return;
    }
    // Серверное сохранение сразу.
    setBusy(true);
    try {
      const res = await uploadEquipmentPhoto(eqId, file);
      const url = res.photo_url || '';
      setLocalPhotoUrl(url);
      setLocalIcon('');
      setPreviewDataUrl('');
      notifyChange({ photoUrl: url, customIcon: '' });
      toast.success('Фото загружено');
      onSaved?.();
    } catch (e) {
      toast.error('Не удалось загрузить: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function handleIconPick(icon) {
    if (!isPersisted) {
      setLocalIcon(icon);
      setLocalPhotoUrl('');
      setPreviewDataUrl('');
      notifyChange({ customIcon: icon, photoUrl: '', pendingFile: null });
      setShowIcons(false);
      return;
    }
    setBusy(true);
    try {
      await setEquipmentIcon(eqId, icon);
      setLocalIcon(icon);
      setLocalPhotoUrl('');
      setPreviewDataUrl('');
      notifyChange({ customIcon: icon, photoUrl: '' });
      toast.success('Иконка установлена');
      setShowIcons(false);
      onSaved?.();
    } catch (e) {
      toast.error('Не удалось установить: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!isPersisted) {
      setLocalIcon('');
      setLocalPhotoUrl('');
      setPreviewDataUrl('');
      notifyChange({ customIcon: '', photoUrl: '', pendingFile: null });
      return;
    }
    setBusy(true);
    try {
      await deleteEquipmentPhoto(eqId);
      setLocalIcon('');
      setLocalPhotoUrl('');
      setPreviewDataUrl('');
      notifyChange({ customIcon: '', photoUrl: '' });
      toast.success('Удалено');
      onSaved?.();
    } catch (e) {
      toast.error('Не удалось удалить: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }

  function onFileChange(e) {
    const file = e.target?.files?.[0];
    if (file) handleFile(file);
    // Сброс — чтобы можно было выбрать тот же файл снова после удаления.
    if (e.target) e.target.value = '';
  }

  const filteredLib = !iconQuery.trim()
    ? ICON_LIBRARY
    : ICON_LIBRARY
        .map((g) => ({ ...g, icons: g.icons.filter(() => g.cat.toLowerCase().includes(iconQuery.toLowerCase())) }))
        .filter((g) => g.icons.length > 0);

  return (
    <div className="wh-photo-panel">
      {/* Превью / dropzone */}
      <div
        className={'wh-photo-zone' + (dragOver ? ' wh-photo-zone--drag' : '')}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => { if (!hasPhoto && !hasIcon) fileInputRef.current?.click(); }}
        style={{
          width: '100%',
          minHeight: previewSize + 40,
          border: '2px dashed var(--border)',
          borderRadius: 'var(--r-md)',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          cursor: (hasPhoto || hasIcon) ? 'default' : 'pointer',
          background: dragOver ? 'rgba(99,102,241,0.08)' : 'var(--bg-card, transparent)',
          transition: 'all .15s'
        }}
      >
        {hasPhoto && (
          <img
            src={previewSrc}
            alt="Фото оборудования"
            style={{
              width: previewSize,
              height: previewSize,
              objectFit: 'cover',
              borderRadius: 'var(--r-sm)',
              background: '#fff'
            }}
          />
        )}
        {hasIcon && !hasPhoto && (
          <span style={{ fontSize: compact ? 64 : 96, lineHeight: 1 }}>{localIcon}</span>
        )}
        {!hasPhoto && !hasIcon && (
          <>
            <div style={{ fontSize: 48, opacity: 0.6 }}>📷</div>
            <div className="fs-13 c-t3 t-center">
              Перетащите изображение сюда<br/>или <b>нажмите для выбора файла</b>
            </div>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onFileChange}
        />
      </div>

      {/* Кнопки действий */}
      <div className="row gap-8 mt-10 u-wrap">
        <Btn variant="ghost" size="sm" disabled={busy} onClick={() => fileInputRef.current?.click()}>
          📷 {hasPhoto ? 'Заменить фото' : 'Загрузить фото'}
        </Btn>
        <Btn variant="ghost" size="sm" disabled={busy} onClick={() => setShowIcons((v) => !v)}>
          😀 {showIcons ? 'Скрыть иконки' : 'Выбрать иконку'}
        </Btn>
        {(hasPhoto || hasIcon) && (
          <Btn variant="ghost" size="sm" disabled={busy} onClick={handleRemove}>
            🗑 Удалить
          </Btn>
        )}
      </div>

      {/* Библиотека иконок */}
      {showIcons && (
        <div className="mt-12 wh-icon-lib" style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          padding: 12,
          maxHeight: 320,
          overflowY: 'auto'
        }}>
          <input
            className="m-input mb-10"
            placeholder="Поиск категории…"
            value={iconQuery}
            onChange={(e) => setIconQuery(e.target.value)}
            style={{ width: '100%' }}
          />
          {filteredLib.map((g) => (
            <div key={g.cat} className="mb-10">
              <div className="fs-11 c-t3 fw-600 mb-4" style={{ textTransform: 'uppercase' }}>
                {g.cat}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))',
                gap: 6
              }}>
                {g.icons.map((ic) => (
                  <button
                    type="button"
                    key={ic}
                    onClick={() => handleIconPick(ic)}
                    disabled={busy}
                    title={g.cat}
                    style={{
                      fontSize: 24,
                      padding: 6,
                      background: ic === localIcon ? 'rgba(99,102,241,0.15)' : 'transparent',
                      border: ic === localIcon ? '1px solid var(--primary, #6366f1)' : '1px solid var(--border)',
                      borderRadius: 'var(--r-sm)',
                      cursor: busy ? 'default' : 'pointer',
                      lineHeight: 1
                    }}
                  >{ic}</button>
                ))}
              </div>
            </div>
          ))}
          {filteredLib.length === 0 && (
            <div className="t-center c-t3 fs-13 p-12">Ничего не найдено</div>
          )}
        </div>
      )}
    </div>
  );
}
