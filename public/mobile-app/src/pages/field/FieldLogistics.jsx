import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { ArrowLeft, Plane, Building, Car, FileText, Shield, Eye, Download, ExternalLink } from 'lucide-react';

const TYPE_CONFIG = {
  ticket_to:    { label: 'Билет туда',      Icon: Plane,     group: 'tickets' },
  ticket_back:  { label: 'Билет обратно',   Icon: Plane,     group: 'tickets' },
  flight:       { label: 'Авиабилет',       Icon: Plane,     group: 'tickets' },
  train:        { label: 'Ж/Д билет',       Icon: FileText,  group: 'tickets' },
  transfer:     { label: 'Трансфер',        Icon: Car,       group: 'tickets' },
  hotel:        { label: 'Гостиница',       Icon: Building,  group: 'housing' },
  housing:      { label: 'Жильё',           Icon: Building,  group: 'housing' },
  hostel:       { label: 'Хостел',          Icon: Building,  group: 'housing' },
  visa:         { label: 'Виза',            Icon: FileText,  group: 'tickets' },
  insurance:    { label: 'Страховка',       Icon: Shield,    group: 'tickets' },
  directive_mo: { label: 'Направление МО',  Icon: FileText,  group: 'directives' },
  training:     { label: 'Обучение',        Icon: FileText,  group: 'training' },
  certification:{ label: 'Аттестация',      Icon: Shield,    group: 'training' },
};

const TAB_GROUPS = [
  { id: 'all',        label: 'Все' },
  { id: 'tickets',    label: '✈️ Билеты' },
  { id: 'housing',    label: '🏠 Жильё' },
  { id: 'directives', label: '📋 МО' },
  { id: 'training',   label: '📚 Обучение' },
];

const STATUS_COLORS = { confirmed: '#22c55e', sent: '#3b82f6', pending: '#f59e0b', ready: '#6366f1' };
const STATUS_LABELS = { confirmed: 'Подтверждено', sent: 'Отправлено', pending: 'Ожидает', ready: 'Готово' };

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ru-RU') : '';

export default function FieldLogistics() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('current');
  const [groupTab, setGroupTab] = useState('all');
  const [current, setCurrent] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [cur, hist] = await Promise.all([
        fieldApi.get('/logistics/my').catch(() => []),
        fieldApi.get('/logistics/my/history').catch(() => []),
      ]);
      const normalize = (data) => (Array.isArray(data) ? data : data?.logistics || data?.items || data?.rows || []);
      setCurrent(normalize(cur));
      setHistory(normalize(hist));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const rawItems = tab === 'current' ? current : history;
  const items = groupTab === 'all'
    ? rawItems
    : rawItems.filter(it => {
        const cfg = TYPE_CONFIG[it.item_type || it.type];
        return cfg?.group === groupTab;
      });

  if (loading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/home')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Логистика</h1>
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}

      {/* Current / History tabs */}
      <div className="flex gap-2">
        {['current', 'history'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              backgroundColor: tab === t ? 'var(--gold)' : 'var(--bg-elevated)',
              color: tab === t ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {t === 'current' ? 'Текущие' : 'Архив'}
          </button>
        ))}
      </div>

      {/* Group filter tabs */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {TAB_GROUPS.map((g) => (
          <button
            key={g.id}
            onClick={() => setGroupTab(g.id)}
            className="py-1.5 px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors"
            style={{
              backgroundColor: groupTab === g.id ? 'rgba(242,208,138,0.2)' : 'var(--bg-elevated)',
              color: groupTab === g.id ? 'var(--gold)' : 'var(--text-secondary)',
              border: groupTab === g.id ? '1px solid var(--gold)' : '1px solid transparent',
            }}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Items */}
      {items.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <Plane size={32} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p style={{ color: 'var(--text-tertiary)' }}>Нет записей</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const cfg = TYPE_CONFIG[item.item_type || item.type] || TYPE_CONFIG.ticket_to;
            const Icon = cfg.Icon;
            const statusColor = STATUS_COLORS[item.status] || '#6b7280';
            return (
              <div key={item.id} className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: statusColor + '15' }}>
                    <Icon size={18} style={{ color: statusColor }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.title || cfg.label}</p>
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: statusColor + '20', color: statusColor }}>
                        {STATUS_LABELS[item.status] || item.status}
                      </span>
                    </div>
                    {/* Details */}
                    <div className="mt-1 space-y-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {item.work_title && <p className="font-medium">{item.work_title}</p>}
                      {(item.departure || item.details?.departure) && <p>Отправление: {item.departure || item.details?.departure}</p>}
                      {item.route && <p>{item.route}</p>}
                      {item.carrier && <p>{item.carrier}</p>}
                      {item.hotel_name && <p>{item.hotel_name}</p>}
                      {item.address && <p>{item.address}</p>}
                      {item.date_from && (
                        <p>{fmtDate(item.date_from)}{item.date_to ? ' — ' + fmtDate(item.date_to) : ''}</p>
                      )}
                      {item.flight_number && <p>Рейс: {item.flight_number}</p>}
                    </div>
                    {/* Actions */}
                    {(item.file_url || item.details?.receipt_url) && (() => {
                      const rawUrl = item.file_url || item.details?.receipt_url;
                      // Extract filename from /api/files/preview/UUID.pdf → use field endpoint
                      const filename = rawUrl.split('/').pop();
                      const token = localStorage.getItem('field_token');
                      const fieldUrl = `/api/field/logistics/my/file/${filename}?token=${encodeURIComponent(token)}`;
                      return (
                        <div className="mt-2 flex items-center gap-3">
                          <button onClick={() => window.open(fieldUrl, '_blank')}
                            className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--gold)' }}>
                            <Eye size={14} /> Открыть
                          </button>
                          <a href={fieldUrl} download className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                            <Download size={14} /> Скачать
                          </a>
                        </div>
                      );
                    })()}
                    {item.driver_phone && (
                      <a href={`tel:${item.driver_phone}`} className="mt-1 flex items-center gap-1 text-xs" style={{ color: 'var(--gold)' }}>
                        <ExternalLink size={12} /> Водитель: {item.driver_phone}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
