import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import {
  ArrowLeft, Camera, ImagePlus, X, Image, Trash2,
  ChevronLeft, ChevronRight, Filter, CheckCircle, MapPin,
  Upload, AlertTriangle, Eye,
} from 'lucide-react';

// ── Constants ──────────────────────────────────────────────────────────
const PHOTO_TYPES = [
  { val: 'all',      label: 'Все',       icon: null,   color: 'var(--gold)' },
  { val: 'work',     label: 'Работа',    icon: '🔨',   color: '#60a5fa' },
  { val: 'before',   label: 'До',        icon: '📋',   color: '#a78bfa' },
  { val: 'after',    label: 'После',     icon: '✅',   color: '#34d399' },
  { val: 'incident', label: 'Инцидент',  icon: '⚠️',  color: '#f87171' },
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
  const t = PHOTO_TYPES.find(p => p.val === type);
  return t ? { label: t.label, color: t.color, icon: t.icon } : null;
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
      <div className="p-4 space-y-4 animate-pulse" style={{ backgroundColor: 'var(--bg-primary)', minHeight: '100vh' }}>
        <div className="h-12 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
        <div className="h-24 rounded-2xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
        <div className="grid grid-cols-3 gap-2">
          {[1,2,3,4,5,6].map(i => <div key={i} className="aspect-square rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="pb-24"
      style={{ backgroundColor: 'var(--bg-primary)', minHeight: '100vh', overflowY: 'auto' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      {pullY > 10 && (
        <div className="flex justify-center py-2 transition-all" style={{ transform: `translateY(${pullY * 0.3}px)`, opacity: pullY / 80 }}>
          <div className={`w-6 h-6 border-2 rounded-full ${refreshing ? 'animate-spin' : ''}`}
            style={{ borderColor: 'var(--gold)', borderTopColor: 'transparent' }} />
        </div>
      )}

      <div className="p-4 space-y-4">
        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/field/home')} className="p-2 rounded-xl"
              style={{ backgroundColor: 'var(--bg-elevated)' }}>
              <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
            </button>
            <div>
              <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                Фотохроники
              </h1>
              {stats && (
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Сегодня: {stats.today || 0} &middot; Всего: {stats.total || 0}
                </p>
              )}
            </div>
          </div>
          {geoCoords && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ backgroundColor: 'rgba(52,211,153,0.15)' }}>
              <MapPin size={12} style={{ color: '#34d399' }} />
              <span className="text-xs" style={{ color: '#34d399' }}>GPS</span>
            </div>
          )}
        </div>

        {/* ── Upload area ── */}
        {project && (
          <div className="rounded-2xl overflow-hidden" style={{
            background: 'linear-gradient(135deg, rgba(200,41,59,0.08) 0%, rgba(30,77,140,0.08) 100%)',
            border: '1px solid var(--border-norse)',
          }}>
            {/* Camera + Gallery buttons */}
            <div className="p-4 flex gap-3">
              <button
                onClick={() => cameraRef.current?.click()}
                className="flex-1 flex flex-col items-center gap-2 py-4 rounded-xl active:scale-95 transition-transform"
                style={{ background: 'var(--gold-gradient)', boxShadow: '0 4px 15px rgba(212,168,67,0.3)' }}
              >
                <Camera size={28} className="text-white" />
                <span className="text-sm font-semibold text-white">Сделать фото</span>
              </button>
              <button
                onClick={() => galleryRef.current?.click()}
                className="flex-1 flex flex-col items-center gap-2 py-4 rounded-xl active:scale-95 transition-transform"
                style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}
              >
                <ImagePlus size={28} style={{ color: 'var(--gold)' }} />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Из галереи</span>
              </button>
            </div>

            {/* Hidden inputs */}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment"
              onChange={e => handleFileSelect(e, true)} className="hidden" />
            <input ref={galleryRef} type="file" accept="image/*" multiple
              onChange={e => handleFileSelect(e, false)} className="hidden" />

            {/* ── Pending files preview ── */}
            {pendingFiles.length > 0 && (
              <div className="px-4 pb-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Выбрано: {pendingFiles.length}
                  </span>
                  <button onClick={() => { pendingFiles.forEach(pf => URL.revokeObjectURL(pf.preview)); setPendingFiles([]); }}
                    className="text-xs px-2 py-1 rounded-lg" style={{ color: 'var(--text-tertiary)' }}>
                    Очистить
                  </button>
                </div>

                {/* Thumbnails with type selector */}
                <div className="space-y-3">
                  {pendingFiles.map((pf, idx) => (
                    <div key={idx} className="flex gap-3 rounded-xl p-2" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                      {/* Preview thumb */}
                      <div className="relative w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden">
                        <img src={pf.preview} alt="" className="w-full h-full object-cover" />
                        <button onClick={() => removePending(idx)}
                          className="absolute top-0.5 right-0.5 p-0.5 rounded-full"
                          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
                          <X size={14} className="text-white" />
                        </button>
                      </div>
                      {/* Type + caption */}
                      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                        <div className="flex gap-1 flex-wrap">
                          {PHOTO_TYPES.filter(t => t.val !== 'all').map(t => (
                            <button key={t.val} onClick={() => updatePendingType(idx, t.val)}
                              className="px-2 py-1 rounded-md text-xs font-medium transition-colors"
                              style={{
                                backgroundColor: pf.type === t.val ? t.color : 'var(--bg-primary)',
                                color: pf.type === t.val ? '#fff' : 'var(--text-secondary)',
                                border: `1px solid ${pf.type === t.val ? t.color : 'var(--border-norse)'}`,
                              }}>
                              {t.icon} {t.label}
                            </button>
                          ))}
                        </div>
                        <input
                          type="text"
                          placeholder="Подпись..."
                          value={pf.caption}
                          onChange={e => updatePendingCaption(idx, e.target.value)}
                          className="w-full px-2 py-1.5 rounded-lg text-xs"
                          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Upload button */}
                <button
                  onClick={handleUploadAll}
                  disabled={uploading}
                  className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2 active:scale-98 transition-transform"
                  style={{
                    background: uploading ? 'var(--bg-elevated)' : 'var(--gold-gradient)',
                    opacity: uploading ? 0.6 : 1,
                    boxShadow: uploading ? 'none' : '0 4px 15px rgba(212,168,67,0.3)',
                  }}
                >
                  {uploading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Загрузка {uploadProgress}/{uploadTotal}...</span>
                    </>
                  ) : (
                    <>
                      <Upload size={18} />
                      <span>Загрузить {pendingFiles.length > 1 ? `(${pendingFiles.length})` : ''}</span>
                    </>
                  )}
                </button>

                {/* Upload progress bar */}
                {uploading && (
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
                    <div className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${(uploadProgress / uploadTotal) * 100}%`,
                        background: 'var(--gold-gradient)',
                      }} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Success quote ── */}
        {lastQuote && (
          <div className="rounded-xl p-3 text-center text-sm font-medium animate-pulse"
            style={{
              background: 'linear-gradient(135deg, rgba(212,168,67,0.15), rgba(212,168,67,0.05))',
              color: 'var(--gold)',
              border: '1px solid rgba(212,168,67,0.3)',
            }}>
            ⚔️ {lastQuote}
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="p-3 rounded-xl text-sm flex items-center gap-2"
            style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertTriangle size={16} />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X size={14} style={{ color: '#ef4444' }} /></button>
          </div>
        )}

        {/* ── Filter tabs ── */}
        {photos.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {PHOTO_TYPES.map(t => {
              const count = t.val === 'all' ? photos.length : photos.filter(p => p.photo_type === t.val).length;
              if (t.val !== 'all' && count === 0) return null;
              return (
                <button key={t.val} onClick={() => setFilterType(t.val)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all"
                  style={{
                    backgroundColor: filterType === t.val ? (t.val === 'all' ? 'var(--gold)' : t.color) : 'var(--bg-elevated)',
                    color: filterType === t.val ? '#fff' : 'var(--text-secondary)',
                    border: `1px solid ${filterType === t.val ? 'transparent' : 'var(--border-norse)'}`,
                  }}>
                  {t.icon && <span>{t.icon}</span>}
                  <span>{t.label}</span>
                  <span className="opacity-70">({count})</span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Photo grid ── */}
        {filtered.length === 0 ? (
          <div className="rounded-2xl p-10 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(212,168,67,0.15), rgba(30,77,140,0.1))' }}>
              <Image size={32} style={{ color: 'var(--gold)' }} />
            </div>
            <p className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              {filterType !== 'all' ? 'Нет фото в этой категории' : 'Хроники пусты'}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {filterType !== 'all'
                ? 'Попробуйте другую категорию'
                : 'Сделайте фото, чтобы начать летопись объекта'}
            </p>
          </div>
        ) : (
          Object.entries(grouped).map(([date, items]) => (
            <div key={date}>
              <div className="flex items-center gap-2 mb-2 px-1">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>{date}</p>
                <span className="text-xs px-1.5 py-0.5 rounded-md" style={{
                  backgroundColor: 'var(--bg-elevated)', color: 'var(--text-tertiary)',
                }}>{items.length}</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {items.map((photo) => {
                  const flatIdx = filtered.indexOf(photo);
                  const badge = typeBadge(photo.photo_type);
                  return (
                    <button
                      key={photo.id}
                      onClick={() => { setViewIndex(flatIdx); haptic.light(); }}
                      className="aspect-square rounded-xl overflow-hidden relative group active:scale-95 transition-transform"
                      style={{ backgroundColor: 'var(--bg-elevated)' }}
                    >
                      <img
                        src={photo.url || photo.file_url || `/api/field/photos/${photo.id}/thumb`}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      {/* Type badge */}
                      {photo.photo_type && photo.photo_type !== 'work' && badge && (
                        <span className="absolute top-1 left-1 text-xs px-1.5 py-0.5 rounded-md font-medium"
                          style={{ backgroundColor: badge.color, color: '#fff', fontSize: '0.625rem' }}>
                          {badge.icon} {badge.label}
                        </span>
                      )}
                      {/* Author for masters */}
                      {isMaster && photo.author_name && (
                        <span className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-center truncate"
                          style={{
                            backgroundColor: 'rgba(0,0,0,0.65)',
                            color: '#fff',
                            fontSize: '0.5625rem',
                            backdropFilter: 'blur(4px)',
                          }}>
                          {photo.author_name.split(' ').slice(0, 2).join(' ')}
                        </span>
                      )}
                      {/* Caption indicator */}
                      {photo.caption && (
                        <div className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
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
          style={{ backgroundColor: '#000' }}
          onTouchStart={onViewerTouchStart}
          onTouchEnd={onViewerTouchEnd}
        >
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-3 safe-area-top"
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)' }}>
            <button onClick={() => { setViewIndex(-1); setShowDeleteConfirm(false); }} className="p-2">
              <X size={24} className="text-white" />
            </button>
            <span className="text-white text-sm font-medium">
              {viewIndex + 1} / {filtered.length}
            </span>
            {canDeleteViewed && (
              <button onClick={() => setShowDeleteConfirm(true)} className="p-2">
                <Trash2 size={20} style={{ color: '#f87171' }} />
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
                className="absolute left-2 p-2 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
                <ChevronLeft size={24} className="text-white" />
              </button>
            )}
            {viewIndex < filtered.length - 1 && (
              <button onClick={() => setViewIndex(i => i + 1)}
                className="absolute right-2 p-2 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
                <ChevronRight size={24} className="text-white" />
              </button>
            )}
          </div>

          {/* Bottom info */}
          <div className="px-4 py-4 safe-area-bottom"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)' }}>
            {/* Type badge */}
            {viewPhoto.photo_type && viewPhoto.photo_type !== 'work' && (() => {
              const b = typeBadge(viewPhoto.photo_type);
              return b ? (
                <span className="inline-block px-2 py-1 rounded-md text-xs font-medium mb-2"
                  style={{ backgroundColor: b.color, color: '#fff' }}>
                  {b.icon} {b.label}
                </span>
              ) : null;
            })()}
            {viewPhoto.caption && (
              <p className="text-sm text-white mb-1">{viewPhoto.caption}</p>
            )}
            <div className="flex items-center gap-3 text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
              <span>{new Date(viewPhoto.created_at || viewPhoto.uploaded_at).toLocaleString('ru-RU')}</span>
              {viewPhoto.author_name && <span>&middot; {viewPhoto.author_name}</span>}
              {viewPhoto.lat && viewPhoto.lng && (
                <span className="flex items-center gap-0.5"><MapPin size={10} /> GPS</span>
              )}
            </div>
          </div>

          {/* Delete confirmation overlay */}
          {showDeleteConfirm && (
            <div className="absolute inset-0 z-60 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
              <div className="rounded-2xl p-6 mx-8 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                <Trash2 size={32} className="mx-auto mb-3" style={{ color: '#f87171' }} />
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
                    style={{ backgroundColor: '#ef4444', opacity: deleting ? 0.6 : 1 }}>
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
