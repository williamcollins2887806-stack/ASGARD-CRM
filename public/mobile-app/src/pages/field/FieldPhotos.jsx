import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, Camera, Plus, X, Image } from 'lucide-react';

export default function FieldPhotos() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const fileRef = useRef(null);
  const [project, setProject] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [viewPhoto, setViewPhoto] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      setLoading(true);
      const projData = await fieldApi.get('/worker/active-project');
      const proj = projData?.project || projData;
      setProject(proj);
      const wid = proj?.work_id || proj?.id;
      if (wid) {
        const list = await fieldApi.get(`/photos/?work_id=${wid}`).catch(() => []);
        setPhotos(Array.isArray(list) ? list : list?.rows || list?.photos || []);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    haptic.medium();
    setUploading(true);
    try {
      const wid = project?.work_id || project?.id;
      const formData = new FormData();
      formData.append('photo', file);
      formData.append('work_id', wid);

      const token = localStorage.getItem('field_token');
      const res = await fetch('/api/field/photos/', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error('Ошибка загрузки');
      haptic.success();
      loadData();
    } catch (e) { setError(e.message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  if (loading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        <div className="h-10 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
        <div className="grid grid-cols-3 gap-2">{[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="aspect-square rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}</div>
      </div>
    );
  }

  // Group by date
  const grouped = {};
  photos.forEach((p) => {
    const date = new Date(p.created_at || p.uploaded_at).toLocaleDateString('ru-RU');
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(p);
  });

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/field/home')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
          </button>
          <Camera size={22} style={{ color: 'var(--gold)' }} />
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Фото</h1>
        </div>
        {project && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="p-2 rounded-lg"
            style={{ background: 'var(--gold-gradient)' }}
          >
            <Plus size={20} className="text-white" />
          </button>
        )}
      </div>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleUpload} className="hidden" />

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}
      {uploading && <div className="p-3 rounded-lg text-sm text-center" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--gold)' }}>Загрузка...</div>}

      {/* Photos grid */}
      {photos.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <Image size={40} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p style={{ color: 'var(--text-tertiary)' }}>Нет фотографий</p>
          {project && <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Нажмите + чтобы добавить</p>}
        </div>
      ) : (
        Object.entries(grouped).map(([date, items]) => (
          <div key={date}>
            <p className="text-xs font-medium mb-2 px-1" style={{ color: 'var(--text-tertiary)' }}>{date}</p>
            <div className="grid grid-cols-3 gap-2">
              {items.map((photo) => (
                <button
                  key={photo.id}
                  onClick={() => setViewPhoto(photo)}
                  className="aspect-square rounded-lg overflow-hidden"
                  style={{ backgroundColor: 'var(--bg-elevated)' }}
                >
                  <img
                    src={photo.url || photo.file_url || `/api/field/photos/${photo.id}/thumb`}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Fullscreen viewer */}
      {viewPhoto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.9)' }} onClick={() => setViewPhoto(null)}>
          <button className="absolute top-4 right-4 p-2" onClick={() => setViewPhoto(null)}>
            <X size={24} className="text-white" />
          </button>
          <img src={viewPhoto.url || viewPhoto.file_url || `/api/field/photos/${viewPhoto.id}/full`} alt="" className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </div>
  );
}
