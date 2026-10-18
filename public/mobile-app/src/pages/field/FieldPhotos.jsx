import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import {
  ArrowLeft, Camera, ImagePlus, X, Image, Trash2,
  ChevronLeft, ChevronRight, Filter, CheckCircle, MapPin,
  Upload, AlertTriangle, Eye, Hammer, ClipboardList, Swords,
} from 'lucide-react';
import { Card, IconTile, KeyButton, Chip, ProgressBar, EmptyState, SectionLabel } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import './field-screens.css';

// ── Constants ──────────────────────────────────────────────────────────
const PHOTO_TYPES = [
  { val: 'all',      label: 'Все',       Icon: null,          color: 'var(--value)' },
  { val: 'work',     label: 'Работа',    Icon: Hammer,        color: 'var(--acc)' },
  { val: 'before',   label: 'До',        Icon: ClipboardList, color: 'var(--acc)' },
  { val: 'after',    label: 'После',     Icon: CheckCircle,   color: 'var(--ok)' },
  { val: 'incident', label: 'Инцидент',  Icon: AlertTriangle, color: 'var(--danger-ink)' },
];

const UPLOAD_QUOTES = [
  'Руны зафиксированы! Летопись пополнена',
  'Запечатлено! История не забудет',
  'Фото добавлено в хроники Асгарда',
  'Один видит всё — и это тоже!',
  'Славная работа зафиксирована в скрижалях',
];

function randomQuote() {
  return UPLOAD_QUOTES[Math.floor(Math.random() * UPLOAD_QUOTES.length)];
}

function typeBadge(type) {
  const t = PHOTO_TYPES.find((p) => p.val === type);
  return t ? { label: t.label, color: t.color, Icon: t.Icon } : null;
}

// ── Main Component ─────────────────────────────────────────────────────
export default function FieldPhotos() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  // Data
  const [project, setProject] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMaster, setIsMaster] = useState(false);

  // Upload state
  const [pendingFiles, setPendingFiles] = useState([]); // {file, preview, type, caption}
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0); // 0..total
  const [uploadTotal, setUploadTotal] = useState(0);
  const [lastQuote, setLastQuote] = useState(null);

  // View state
  const [filterType, setFilterType] = useState('all');
  const [viewIndex, setViewIndex] = useState(-1); // -1 = closed
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Geolocation
  const [geoCoords, setGeoCoords] = useState(null);

  // ── Load data ──
  useEffect(() => { loadData(); captureGeo(); }, []);

  function captureGeo() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setGeoCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  }

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const projData = await fieldApi.get('/worker/active-project');
      const proj = projData?.project || projData;
      setProject(proj);
      const role = proj?.field_role || '';
      setIsMaster(role === 'shift_master' || role === 'senior_master');
      const wid = proj?.work_id || proj?.id;
      if (wid) {
        const [list, st] = await Promise.all([
          fieldApi.get(`/photos/?work_id=${wid}`).catch(() => ({ photos: [] })),
          fieldApi.get(`/photos/stats?work_id=${wid}`).catch(() => null),
        ]);
        const arr = Array.isArray(list) ? list : list?.photos || list?.rows || [];
        setPhotos(arr);
        setStats(st);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  // ── File selection ──
  function handleFileSelect(e, fromCamera) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    haptic.light();

    const newPending = files.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      type: 'work',
      caption: '',
      fromCamera,
    }));
    setPendingFiles(prev => [...prev, ...newPending]);

    // Reset input
    e.target.value = '';
  }

  function removePending(idx) {
    setPendingFiles(prev => {
      const next = [...prev];
      URL.revokeObjectURL(next[idx].preview);
      next.splice(idx, 1);
      return next;
    });
  }

  function updatePendingType(idx, type) {
    setPendingFiles(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], type };
      return next;
    });
  }

  function updatePendingCaption(idx, caption) {
    setPendingFiles(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], caption };
      return next;
    });
  }

  // ── Upload ──
  async function handleUploadAll() {
    if (!pendingFiles.length || uploading) return;
    haptic.medium();
    setUploading(true);
    setUploadProgress(0);
    setUploadTotal(pendingFiles.length);
    setError(null);

    const wid = project?.work_id || project?.id;
    const token = localStorage.getItem('field_token');
    let successCount = 0;

    for (let i = 0; i < pendingFiles.length; i++) {
      const pf = pendingFiles[i];
      try {
        const formData = new FormData();
        formData.append('photo', pf.file);
        formData.append('work_id', wid);
        formData.append('photo_type', pf.type);
        if (pf.caption.trim()) formData.append('caption', pf.caption.trim());
        if (geoCoords) {
          formData.append('lat', geoCoords.lat);
          formData.append('lng', geoCoords.lng);
        }

        const res = await fetch('/api/field/photos/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Ошибка (${res.status})`);
        }
        successCount++;
        setUploadProgress(i + 1);
      } catch (e) {
        setError(`Фото ${i + 1}: ${e.message}`);
      }
    }

    // Cleanup previews
    pendingFiles.forEach(pf => URL.revokeObjectURL(pf.preview));
    setPendingFiles([]);
    setUploading(false);

    if (successCount > 0) {
      haptic.success();
      setLastQuote(randomQuote());
      setTimeout(() => setLastQuote(null), 3000);
      loadData();
    }
  }

  // ── Delete ──
  async function handleDelete(photoId) {
    haptic.heavy();
    setDeleting(true);
    try {
      const token = localStorage.getItem('field_token');
      const res = await fetch(`/api/field/photos/${photoId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Ошибка удаления');
      }
      haptic.success();
      setViewIndex(-1);
      setShowDeleteConfirm(false);
      loadData();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleting(false);
    }
  }

  // ── Filtered photos ──
  const filtered = filterType === 'all'
    ? photos
    : photos.filter(p => p.photo_type === filterType);

  // Group by date
  const grouped = {};
  filtered.forEach(p => {
    const date = new Date(p.created_at || p.uploaded_at).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'long', weekday: 'short',
    });
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(p);
  });

  // Viewer photo
  const viewPhoto = viewIndex >= 0 && viewIndex < filtered.length ? filtered[viewIndex] : null;
  const canDeleteViewed = viewPhoto && (viewPhoto.employee_id === project?.employee_id || isMaster);

  // ── Pull to refresh ──
  const containerRef = useRef(null);
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStart = useRef(0);

  function onTouchStart(e) {
    if (containerRef.current?.scrollTop === 0) {
      touchStart.current = e.touches[0].clientY;
    }
  }
  function onTouchMove(e) {
    if (!touchStart.current) return;
    const diff = e.touches[0].clientY - touchStart.current;
    if (diff > 0 && diff < 120) setPullY(diff);
  }
  function onTouchEnd() {
    if (pullY > 60 && !refreshing) {
      setRefreshing(true);
      loadData().finally(() => { setRefreshing(false); setPullY(0); });
    } else {
      setPullY(0);
    }
    touchStart.current = 0;
  }

  // ── Keyboard nav for viewer ──
  useEffect(() => {
    if (viewIndex < 0) return;
    function handleKey(e) {
      if (e.key === 'ArrowLeft') setViewIndex(i => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setViewIndex(i => Math.min(filtered.length - 1, i + 1));
      if (e.key === 'Escape') setViewIndex(-1);
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [viewIndex, filtered.length]);

  // ── Swipe nav for viewer ──
  const swipeStart = useRef(0);
  function onViewerTouchStart(e) { swipeStart.current = e.touches[0].clientX; }
  function onViewerTouchEnd(e) {
    const diff = e.changedTouches[0].clientX - swipeStart.current;
    if (Math.abs(diff) > 60) {
      if (diff > 0 && viewIndex > 0) setViewIndex(i => i - 1);
      if (diff < 0 && viewIndex < filtered.length - 1) setViewIndex(i => i + 1);
    }
    swipeStart.current = 0;
  }

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="fs-root p-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}>
        <SkeletonList count={4} />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fs-root"
      style={{ overflowY: 'auto' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      {/* Pull-to-refresh indicator */}
      {pullY > 10 && (
        <div className="flex justify-center py-2 transition-all" style={{ transform: `translateY(${pullY * 0.3}px)`, opacity: pullY / 80 }}>
          <div className={`w-6 h-6 border-2 rounded-full ${refreshing ? 'animate-spin' : ''}`}
            style={{ borderColor: 'var(--value)', borderTopColor: 'transparent' }} />
        </div>
      )}

      <div className="fs-content space-y-4">
        {/* ── Header ── */}
        <div className="fs-head">
          <button onClick={() => navigate('/field/home')} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={Camera} tone="accent" size={40} />
          <div style={{ flex: 1 }}>
            <h1 className="fs-head__title">Фотохроники</h1>
            {stats && (
              <p className="fs-head__sub">
                Сегодня: {stats.today || 0} · Всего: {stats.total || 0}
              </p>
            )}
          </div>
          {geoCoords && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ backgroundColor: 'var(--soft-ok)' }}>
              <MapPin size={12} style={{ color: 'var(--on-soft-ok)' }} />
              <span className="text-xs font-semibold" style={{ color: 'var(--ok)' }}>GPS</span>
            </span>
          )}
        </div>

        {/* ── Upload area ── */}
        {project && (
          <Card variant="raised" tone="danger" className="overflow-hidden p-0">
            {/* Camera + Gallery buttons */}
            <div className="p-4 flex gap-3">
              <KeyButton tone="value" icon={Camera} style={{ flex: 1, height: 64 }} onClick={() => cameraRef.current?.click()}>
                Сделать фото
              </KeyButton>
              <KeyButton tone="neutral" icon={ImagePlus} style={{ flex: 1, height: 64 }} onClick={() => galleryRef.current?.click()}>
                Из галереи
              </KeyButton>
            </div>

            {/* Hidden inputs */}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment"
              onChange={(e) => handleFileSelect(e, true)} className="hidden" />
            <input ref={galleryRef} type="file" accept="image/*" multiple
              onChange={(e) => handleFileSelect(e, false)} className="hidden" />

            {/* ── Pending files preview ── */}
            {pendingFiles.length > 0 && (
              <div className="px-4 pb-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Выбрано: {pendingFiles.length}
                  </span>
                  <button onClick={() => { pendingFiles.forEach((pf) => URL.revokeObjectURL(pf.preview)); setPendingFiles([]); }}
                    className="text-xs px-2 py-1 rounded-lg" style={{ color: 'var(--text-tertiary)' }}>
                    Очистить
                  </button>
                </div>

                {/* Thumbnails with type selector */}
                <div className="space-y-3">
                  {pendingFiles.map((pf, idx) => (
                    <div key={idx} className="flex gap-3 rounded-xl p-2" style={{ backgroundColor: 'var(--bg-surface-alt)' }}>
                      {/* Preview thumb */}
                      <div className="relative w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden">
                        <img src={pf.preview} alt="" className="w-full h-full object-cover" />
                        <button onClick={() => removePending(idx)}
                          className="absolute top-0.5 right-0.5 p-0.5 rounded-full"
                          aria-label="Убрать фото"
                          style={{ backgroundColor: 'color-mix(in oklab, var(--bg-primary) 60%, transparent)' }}>
                          <X size={14} className="text-white" />
                        </button>
                      </div>
                      {/* Type + caption */}
                      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                        <div className="flex gap-1 flex-wrap">
                          {PHOTO_TYPES.filter((t) => t.val !== 'all').map((t) => (
                            <button key={t.val} onClick={() => updatePendingType(idx, t.val)}
                              className="px-2 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1"
                              style={{
                                backgroundColor: pf.type === t.val ? t.color : 'var(--bg-surface)',
                                color: pf.type === t.val ? 'var(--bg-primary)' : 'var(--text-secondary)',
                                border: `1px solid ${pf.type === t.val ? t.color : 'var(--tile-brd)'}`,
                              }}>
                              {t.Icon ? <t.Icon size={11} strokeWidth={2.4} aria-hidden /> : null}
                              {t.label}
                            </button>
                          ))}
                        </div>
                        <input
                          type="text"
                          placeholder="Подпись..."
                          value={pf.caption}
                          onChange={(e) => updatePendingCaption(idx, e.target.value)}
                          className="w-full px-2 py-1.5 rounded-lg text-xs"
                          style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Upload button */}
                <KeyButton tone="value" block icon={Upload} onClick={handleUploadAll} disabled={uploading}>
                  {uploading
                    ? `Загрузка ${uploadProgress}/${uploadTotal}...`
                    : `Загрузить${pendingFiles.length > 1 ? ` (${pendingFiles.length})` : ''}`}
                </KeyButton>

                {/* Upload progress bar */}
                {uploading && <ProgressBar value={uploadProgress} max={uploadTotal} color="var(--value)" />}
              </div>
            )}
          </Card>
        )}

        {/* ── Success quote ── */}
        {lastQuote && (
          <Card variant="raised" tone="value" className="p-3 text-center text-sm font-medium">
            {lastQuote}
          </Card>
        )}

        {/* ── Error ── */}
        {error && (
          <Card variant="flat" tone="danger" className="p-3 text-sm flex items-center gap-2" style={{ color: 'var(--danger-ink)' }}>
            <AlertTriangle size={16} />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} aria-label="Скрыть ошибку"><X size={14} style={{ color: 'var(--danger-ink)' }} /></button>
          </Card>
        )}

        {/* ── Filter tabs ── */}
        {photos.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {PHOTO_TYPES.map((t) => {
              const count = t.val === 'all' ? photos.length : photos.filter((p) => p.photo_type === t.val).length;
              if (t.val !== 'all' && count === 0) return null;
              return (
                <Chip key={t.val} tone="value" active={filterType === t.val} icon={t.Icon} onClick={() => setFilterType(t.val)}>
                  {t.label} ({count})
                </Chip>
              );
            })}
          </div>
        )}

        {/* ── Photo grid ── */}
        {filtered.length === 0 ? (
          <EmptyState
            icon={Image}
            title={filterType !== 'all' ? 'Нет фото в этой категории' : 'Хроники пусты'}
            description={filterType !== 'all'
              ? 'Попробуйте другую категорию'
              : 'Сделайте фото, чтобы начать летопись объекта'}
          />
        ) : (
          Object.entries(grouped).map(([date, items]) => (
            <div key={date}>
              <SectionLabel>
                <span className="inline-flex items-center gap-2">
                  {date}
                  <span className="text-xs px-1.5 py-0.5 rounded-md" style={{ backgroundColor: 'var(--bg-surface-alt)', color: 'var(--text-tertiary)' }}>{items.length}</span>
                </span>
              </SectionLabel>
              <div className="grid grid-cols-3 gap-1.5">
                {items.map((photo) => {
                  const flatIdx = filtered.indexOf(photo);
                  const badge = typeBadge(photo.photo_type);
                  const BadgeIcon = badge?.Icon;
                  return (
                    <button
                      key={photo.id}
                      onClick={() => { setViewIndex(flatIdx); haptic.light(); }}
                      className="aspect-square rounded-xl overflow-hidden relative group active:scale-95 transition-transform"
                      style={{ backgroundColor: 'var(--bg-surface-alt)' }}
                    >
                      <img
                        src={photo.url || photo.file_url || `/api/field/photos/${photo.id}/thumb`}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      {/* Type badge */}
                      {photo.photo_type && photo.photo_type !== 'work' && badge && (
                        <span className="absolute top-1 left-1 text-xs px-1.5 py-0.5 rounded-md font-medium flex items-center gap-1"
                          style={{ backgroundColor: badge.color, color: 'var(--bg-primary)', fontSize: '0.625rem' }}>
                          {BadgeIcon ? <BadgeIcon size={9} strokeWidth={2.8} aria-hidden /> : null}
                          {badge.label}
                        </span>
                      )}
                      {/* Author for masters */}
                      {isMaster && photo.author_name && (
                        <span className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-center truncate"
                          style={{
                            backgroundColor: 'color-mix(in oklab, var(--bg-primary) 65%, transparent)',
                            color: 'var(--text-primary)',
                            fontSize: '0.5625rem',
                            backdropFilter: 'blur(4px)',
                          }}>
                          {photo.author_name.split(' ').slice(0, 2).join(' ')}
                        </span>
                      )}
                      {/* Caption indicator */}
                      {photo.caption && (
                        <div className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: 'color-mix(in oklab, var(--bg-primary) 50%, transparent)' }}>
                          <Eye size={8} className="text-white" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Fullscreen Viewer ── */}
      {viewPhoto && (
        <div
          className="fixed inset-0 z-50 flex flex-col"
          style={{ backgroundColor: 'var(--bg-primary)' }}
          onTouchStart={onViewerTouchStart}
          onTouchEnd={onViewerTouchEnd}
        >
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-3 safe-area-top"
            style={{ background: 'linear-gradient(to bottom, color-mix(in oklab, var(--bg-primary) 80%, transparent), transparent)' }}>
            <button onClick={() => { setViewIndex(-1); setShowDeleteConfirm(false); }} className="p-2">
              <X size={24} className="text-white" />
            </button>
            <span className="text-white text-sm font-medium">
              {viewIndex + 1} / {filtered.length}
            </span>
            {canDeleteViewed && (
              <button onClick={() => setShowDeleteConfirm(true)} className="p-2">
                <Trash2 size={20} style={{ color: 'var(--danger-ink)' }} />
              </button>
            )}
          </div>

          {/* Image */}
          <div className="flex-1 flex items-center justify-center px-2 relative">
            <img
              src={viewPhoto.url || viewPhoto.file_url || `/api/field/photos/${viewPhoto.id}/full`}
              alt=""
              className="max-w-full max-h-full object-contain"
            />
            {/* Nav arrows */}
            {viewIndex > 0 && (
              <button onClick={() => setViewIndex(i => i - 1)}
                className="absolute left-2 p-2 rounded-full" style={{ backgroundColor: 'color-mix(in oklab, var(--text-primary) 15%, transparent)' }}>
                <ChevronLeft size={24} className="text-white" />
              </button>
            )}
            {viewIndex < filtered.length - 1 && (
              <button onClick={() => setViewIndex(i => i + 1)}
                className="absolute right-2 p-2 rounded-full" style={{ backgroundColor: 'color-mix(in oklab, var(--text-primary) 15%, transparent)' }}>
                <ChevronRight size={24} className="text-white" />
              </button>
            )}
          </div>

          {/* Bottom info */}
          <div className="px-4 py-4 safe-area-bottom"
            style={{ background: 'linear-gradient(to top, color-mix(in oklab, var(--bg-primary) 80%, transparent), transparent)' }}>
            {/* Type badge */}
            {viewPhoto.photo_type && viewPhoto.photo_type !== 'work' && (() => {
              const b = typeBadge(viewPhoto.photo_type);
              return b ? (
                <span className="inline-block px-2 py-1 rounded-md text-xs font-medium mb-2"
                  style={{ backgroundColor: b.color, color: 'var(--text-primary)' }}>
                  {b.icon} {b.label}
                </span>
              ) : null;
            })()}
            {viewPhoto.caption && (
              <p className="text-sm text-white mb-1">{viewPhoto.caption}</p>
            )}
            <div className="flex items-center gap-3 text-xs" style={{ color: 'color-mix(in oklab, var(--text-primary) 60%, transparent)' }}>
              <span>{new Date(viewPhoto.created_at || viewPhoto.uploaded_at).toLocaleString('ru-RU')}</span>
              {viewPhoto.author_name && <span>&middot; {viewPhoto.author_name}</span>}
              {viewPhoto.lat && viewPhoto.lng && (
                <span className="flex items-center gap-0.5"><MapPin size={10} /> GPS</span>
              )}
            </div>
          </div>

          {/* Delete confirmation overlay */}
          {showDeleteConfirm && (
            <div className="absolute inset-0 z-60 flex items-center justify-center" style={{ backgroundColor: 'color-mix(in oklab, var(--bg-primary) 70%, transparent)' }}>
              <div className="rounded-2xl p-6 mx-8 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                <Trash2 size={32} className="mx-auto mb-3" style={{ color: 'var(--danger-ink)' }} />
                <p className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Удалить фото?</p>
                <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>Это действие нельзя отменить</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                    style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                    Отмена
                  </button>
                  <button
                    onClick={() => handleDelete(viewPhoto.id)}
                    disabled={deleting}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                    style={{ backgroundColor: 'var(--danger)', opacity: deleting ? 0.6 : 1 }}>
                    {deleting ? 'Удаление...' : 'Удалить'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
