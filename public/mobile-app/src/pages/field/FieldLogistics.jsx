import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import {
  ArrowLeft, Plane, Building, Car, FileText, Shield, Eye, Download, ExternalLink,
  MapPin, Route as RouteIcon, Stethoscope, Calendar, PlaneTakeoff, PlaneLanding, Phone,
} from 'lucide-react';
import { Card, IconTile, KeyButton, Chip, Segmented, SectionLabel, EmptyState } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import './field-screens.css';

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
  { id: 'tickets',    label: 'Билеты' },
  { id: 'housing',    label: 'Жильё' },
  { id: 'directives', label: 'МО' },
  { id: 'training',   label: 'Обучение' },
];

// Канон бэка field_logistics.status (V183 + field-logistics.js): pending → purchased → ready → sent.
// До 23.06.2026 здесь были `confirmed` (никогда не пишется бэком) и не было `purchased` —
// рабочий видел латинскую строку «purchased» на карточке купленного билета.
const STATUS_COLORS = { pending: 'var(--value)', purchased: 'var(--ok)', ready: 'var(--acc)', sent: 'var(--acc)' };
const STATUS_LABELS = { pending: 'Не куплено', purchased: 'Куплено', ready: 'Готово', sent: 'Отправлено' };

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
      <div className="fs-root p-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
        <SkeletonList count={3} />
      </div>
    );
  }

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content space-y-4">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate('/field/home')} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={Plane} tone="accent" size={40} />
          <h1 className="fs-head__title">Поездки и направления</h1>
        </div>

        {error && (
          <Card variant="flat" tone="danger" className="p-3 text-sm" style={{ color: 'var(--danger-ink)' }}>{error}</Card>
        )}

        {/* Current / History tabs */}
        <Segmented
          items={[{ value: 'current', label: 'Текущие' }, { value: 'history', label: 'Архив' }]}
          value={tab}
          onChange={setTab}
        />

        {/* Group filter tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {TAB_GROUPS.map((g) => (
            <Chip key={g.id} tone="value" active={groupTab === g.id} onClick={() => setGroupTab(g.id)}>
              {g.label}
            </Chip>
          ))}
        </div>

      {/* Items */}
      {items.length === 0 ? (
        <EmptyState icon={Plane} title="Нет записей" description="Поездки и направления появятся здесь" />
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const cfg = TYPE_CONFIG[item.item_type || item.type] || TYPE_CONFIG.ticket_to;
            const Icon = cfg.Icon;
            const statusColor = STATUS_COLORS[item.status] || 'var(--text-tertiary)';
            return (
              <Card key={item.id} variant="raised" className="p-4">
                <div className="flex items-start gap-3">
                  <IconTile icon={Icon} tone="neutral" size={40} style={{ color: statusColor }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.title || cfg.label}</p>
                      <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: `color-mix(in oklab, ${statusColor} 13%, transparent)`, color: statusColor }}>
                        {STATUS_LABELS[item.status] || item.status}
                      </span>
                    </div>
                    {/* Details */}
                    <div className="mt-1 space-y-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {item.work_title && <p className="font-medium">{item.work_title}</p>}
                      {item.description && <p>{item.description}</p>}
                      {(item.departure || item.details?.departure) && <p>Отправление: {item.departure || item.details?.departure}</p>}
                      {item.departure_at && (
                        <p style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <PlaneTakeoff size={12} strokeWidth={2.3} aria-hidden />
                          Вылет: {new Date(item.departure_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
                        </p>
                      )}
                      {item.arrival_at && (
                        <p style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <PlaneLanding size={12} strokeWidth={2.3} aria-hidden />
                          Прилёт: {new Date(item.arrival_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
                        </p>
                      )}
                      {item.transport_no && <p>№ рейса/поезда: {item.transport_no}</p>}
                      {item.route && <p style={{ display: 'flex', alignItems: 'center', gap: 4 }}><RouteIcon size={12} strokeWidth={2.3} aria-hidden />{item.route}</p>}
                      {item.carrier && <p>{item.carrier}</p>}
                      {item.hotel_name && <p>{item.hotel_name}</p>}
                      {item.hotel_address && (
                        <p style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <MapPin size={12} strokeWidth={2.3} aria-hidden />
                          {item.hotel_address}
                        </p>
                      )}
                      {item.address && <p>{item.address}</p>}
                      {item.referral_at && (
                        <p style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Stethoscope size={12} strokeWidth={2.3} aria-hidden />
                          Направление выдано: {fmtDate(item.referral_at)}
                        </p>
                      )}
                      {item.date_from && (
                        <p style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Calendar size={12} strokeWidth={2.3} aria-hidden />
                          {fmtDate(item.date_from)}{item.date_to ? ' — ' + fmtDate(item.date_to) : ''}
                        </p>
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
                            className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--value-ink)' }}>
                            <Eye size={14} /> Открыть
                          </button>
                          <a href={fieldUrl} download className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                            <Download size={14} /> Скачать
                          </a>
                        </div>
                      );
                    })()}
                    {item.driver_phone && (
                      <a href={`tel:${item.driver_phone}`} className="mt-1 flex items-center gap-1 text-xs" style={{ color: 'var(--value-ink)' }}>
                        <Phone size={12} strokeWidth={2.3} aria-hidden />
                        Водитель: {item.driver_phone}
                      </a>
                    )}
                    {item.hotel_address && (
                      <a
                        href={`https://yandex.ru/maps/?text=${encodeURIComponent(item.hotel_address)}`}
                        target="_blank" rel="noreferrer"
                        className="mt-1 flex items-center gap-1 text-xs" style={{ color: 'var(--value-ink)' }}
                      >
                        <ExternalLink size={12} /> Открыть на карте
                      </a>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
