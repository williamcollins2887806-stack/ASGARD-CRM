import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Mail, Search, Plus, ChevronRight, X, ExternalLink } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import AsgardSelect from '@/components/ui/AsgardSelect';

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'incoming', label: 'Входящие' },
  { id: 'outgoing', label: 'Исходящие' },
];

export default function Correspondence() {
  const haptic = useHaptic();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/correspondence?limit=100');
      setDocs(api.extractRows(res) || []);
    } catch { setDocs([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const filtered = useMemo(() => {
    let list = docs;
    if (filter === 'incoming') list = list.filter((d) => (d.direction || '').toLowerCase().includes('вход') || d.direction === 'incoming');
    else if (filter === 'outgoing') list = list.filter((d) => (d.direction || '').toLowerCase().includes('исход') || d.direction === 'outgoing');
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((d) => (d.title || '').toLowerCase().includes(q) || (d.number || '').toLowerCase().includes(q));
    }
    return list;
  }, [docs, filter, search]);

  return (
    <PageShell title="Корреспонденция" headerRight={
      <div className="flex items-center gap-1">
        <button onClick={() => { haptic.light(); setShowSearch(!showSearch); }} className="btn-icon spring-tap"><Search size={20} /></button>
        <button onClick={() => { haptic.light(); setShowCreate(true); }} className="btn-icon spring-tap c-blue"><Plus size={22} /></button>
      </div>
    }>
      <PullToRefresh onRefresh={fetchDocs}>
        {showSearch && <SearchBar search={search} setSearch={setSearch} placeholder="Поиск документов..." />}
        <FilterPills filters={FILTERS} active={filter} onChange={(f) => { haptic.light(); setFilter(f); }} />
        {loading ? <SkeletonList count={5} /> : filtered.length === 0 ? (
          <EmptyState icon={Mail} iconColor="var(--blue)" iconBg="rgba(74,144,217,0.1)" title={search ? 'Ничего не найдено' : 'Нет документов'} description="Корреспонденция появится здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((doc, i) => {
              const isIn = (doc.direction || '').toLowerCase().includes('вход') || doc.direction === 'incoming';
              return (
                <button key={doc.id} onClick={() => { haptic.light(); setDetail(doc); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap card-glass" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight c-primary">{doc.title || doc.number || `Документ #${doc.id}`}</p>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: isIn ? 'color-mix(in srgb, var(--blue) 15%, transparent)' : 'color-mix(in srgb, var(--green) 15%, transparent)', color: isIn ? 'var(--blue)' : 'var(--green)' }}>
                      {isIn ? 'Входящий' : 'Исходящий'}
                    </span>
                    {doc.number && <span className="text-[10px] c-tertiary">№ {doc.number}</span>}
                    {doc.date && <span className="text-[10px] c-tertiary">{formatDate(doc.date)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <DetailSheet doc={detail} onClose={() => setDetail(null)} />
      <CreateSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchDocs} />
    </PageShell>
  );
}

function DetailSheet({ doc, onClose }) {
  if (!doc) return null;
  const fields = [
    doc.number && { label: '№', value: doc.number },
    doc.date && { label: 'Дата', value: formatDate(doc.date) },
    doc.direction && { label: 'Направление', value: doc.direction === 'incoming' || (doc.direction || '').toLowerCase().includes('вход') ? 'Входящий' : 'Исходящий' },
    doc.type && { label: 'Тип', value: doc.type },
    doc.sender && { label: 'Отправитель', value: doc.sender },
    doc.recipient && { label: 'Получатель', value: doc.recipient },
    (doc.note || doc.comment) && { label: 'Примечание', value: doc.note || doc.comment, full: true },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!doc} onClose={onClose} title={doc.title || `Документ #${doc.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => (<FieldRow key={i} {...f} />))}
        {doc.file_url && <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[14px] spring-tap mt-1 c-blue bg-elevated"><ExternalLink size={16} /> Скачать документ</a>}
      </div>
    </BottomSheet>
  );
}

function CreateSheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [title, setTitle] = useState('');
  const [number, setNumber] = useState('');
  const [direction, setDirection] = useState('incoming');
  const [type, setType] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const handleSubmit = async () => {
    if (!title.trim()) return;
    haptic.light(); setSaving(true);
    try {
      await api.post('/correspondence', { title: title.trim(), number: number || null, direction, type: type || null, note: note || null });
      haptic.success(); setTitle(''); setNumber(''); setDirection('incoming'); setType(''); setNote(''); onClose(); onCreated();
    } catch {} setSaving(false);
  };
  return (
    <BottomSheet open={open} onClose={onClose} title="Новый документ">
      <div className="flex flex-col gap-3 pb-4">
        <FormField label="Название *"><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название документа..." className="input-field" /></FormField>
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Номер"><input type="text" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Вх-001" className="input-field" /></FormField>
          <FormField label="Направление"><AsgardSelect options={[{ value: 'incoming', label: 'Входящий' }, { value: 'outgoing', label: 'Исходящий' }]} value={direction} onChange={(val) => setDirection(val)} placeholder="Направление" /></FormField>
        </div>
        <FormField label="Тип"><input type="text" value={type} onChange={(e) => setType(e.target.value)} placeholder="Письмо, приказ..." className="input-field" /></FormField>
        <FormField label="Примечание"><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Детали..." rows={2} className="input-field resize-none" /></FormField>
        <SubmitBtn label="Создать" disabled={!title.trim()} saving={saving} onClick={handleSubmit} />
      </div>
    </BottomSheet>
  );
}

function FormField({ label, children }) { return <div><label className="input-label">{label}</label>{children}</div>; }
function FieldRow({ label, value, color, full }) { return <div><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">{label}</p>{color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>{value}</span> : <p className={`text-[14px] c-primary ${full ? 'whitespace-pre-wrap' : ''}`}>{value}</p>}</div>; }
function SubmitBtn({ label, disabled, saving, onClick }) { return <button onClick={onClick} disabled={disabled || saving} className="btn-primary spring-tap mt-1">{saving ? 'Сохранение...' : label}</button>; }
function SearchBar({ search, setSearch, placeholder }) { return <div className="px-1 pb-2" style={{ animation: 'fadeInUp 150ms var(--ease-spring) forwards' }}><div className="search-bar"><Search size={16} className="c-tertiary" style={{ flexShrink: 0 }} /><input type="text" placeholder={placeholder} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />{search && <button onClick={() => setSearch('')} className="c-tertiary"><X size={16} /></button>}</div></div>; }
function FilterPills({ filters, active, onChange }) { return <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">{filters.map((f) => <button key={f.id} onClick={() => onChange(f.id)} className="filter-pill spring-tap" data-active={active === f.id}>{f.label}</button>)}</div>; }
