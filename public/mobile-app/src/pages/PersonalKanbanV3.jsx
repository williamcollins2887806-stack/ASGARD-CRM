/**
 * PersonalKanbanV3 — Мобильный канбан 8-колоночный (полный цикл от заявки до закрытия).
 *
 * Структура:
 *   PageShell
 *     ├─ Header: switch вид (substages ↔ v3) + flow_filter
 *     ├─ Горизонтальный свайп между 8 колонками (1 экран = 1 колонка)
 *     ├─ Карта → fullscreen BottomSheet (8 секций с аккордеоном)
 *     └─ Контекстные actions по этапу
 *
 * Backend: те же endpoints что у React 2.0:
 *   GET  /api/personal-kanban/board?flow_filter=
 *   POST /api/personal-kanban/cards/:id/transition
 *   GET  /api/tkp/:tkpId/blocks  ... и т.д.
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft, ChevronLeft, ChevronRight, X, Send, FileText,
  Calculator, Scale, Inbox, Trophy, Hammer, CircleX, Mail,
  Search, Filter, RotateCcw,
} from 'lucide-react';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';

const COLS = [
  { id: 'new',      ic: '📥', title: 'Новые',          tone: 'gold' },
  { id: 'calc',     ic: '🧮', title: 'Просчёт ТКП',    tone: 'info' },
  { id: 'approval', ic: '⚖️', title: 'На согласовании', tone: 'warn' },
  { id: 'kp_prep',  ic: '📋', title: 'КП готовится',   tone: 'amber' },
  { id: 'sent',     ic: '📤', title: 'КП отправлено',  tone: 'info' },
  { id: 'win',      ic: '🏆', title: 'Выиграно',        tone: 'ok' },
  { id: 'lose',     ic: '❌', title: 'Проиграно',       tone: 'err' },
  { id: 'work',     ic: '🏗', title: 'В работе',        tone: 'gold' },
];
const STAGE_LABELS = ['📥 Новая', '🧮 Просчёт', '⚖️ Согл.', '📋 КП готов', '📤 КП ушло', '🏆 Выигр.', '❌ Проигр.', '🏗 В работе'];
const COL_TO_STAGE = { new: 0, calc: 1, approval: 2, kp_prep: 3, sent: 4, win: 5, lose: 6, work: 7 };

const FLOW_TABS = [
  { id: 'all',         label: 'Все' },
  { id: 'application', label: '📥' },
  { id: 'pre_tender',  label: '🗂' },
  { id: 'tender',      label: '📋' },
  { id: 'work',        label: '🏗' },
];

const STORAGE_KEY = 'asgard_mobile_pk_view_mode';

export default function PersonalKanbanV3({ onSwitchToSubstages }) {
  const [columns, setColumns] = useState({});
  const [counts, setCounts]   = useState({});
  const [colIdx, setColIdx]   = useState(0);
  const [flowFilter, setFlowFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [drawerCard, setDrawerCard] = useState(null);
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);

  async function reload() {
    setLoading(true);
    try {
      const [b, c] = await Promise.all([
        api(`/api/personal-kanban/board?flow_filter=${encodeURIComponent(flowFilter)}`),
        api(`/api/personal-kanban/columns/counts?flow_filter=${encodeURIComponent(flowFilter)}`),
      ]);
      setColumns((b && b.columns) || {});
      setCounts((c) || {});
    } catch (e) {
      toast.error('Не загрузилось: ' + e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [flowFilter]);

  const currentCol = COLS[colIdx];
  const cardsHere = (columns[currentCol.id] || []);
  const totalCount = counts.total || Object.values(counts).reduce((s, n) => s + (typeof n === 'number' ? n : 0), 0);

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }
  function onTouchEnd(e) {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && colIdx < COLS.length - 1) setColIdx(i => i + 1);
      if (dx > 0 && colIdx > 0)               setColIdx(i => i - 1);
    }
    touchStartX.current = null; touchStartY.current = null;
  }

  return (
    <PageShell
      title={
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span>{currentCol.ic} {currentCol.title}</span>
          <span style={{
            fontSize:11,padding:'2px 7px',borderRadius:999,
            background:'rgba(212,168,67,0.15)',color:'#E8C35A',fontWeight:600
          }}>{cardsHere.length}</span>
        </div>
      }
      leftAction={
        <button onClick={onSwitchToSubstages} style={{background:'transparent',border:0,color:'#bbb',padding:8,fontSize:12}}>
          📋
        </button>
      }
      rightAction={
        <button onClick={reload} style={{background:'transparent',border:0,color:'#bbb',padding:8}}>
          <RotateCcw size={18}/>
        </button>
      }
    >
      <div style={{
        display:'flex',gap:6,padding:'10px 14px',overflowX:'auto',
        borderBottom:'1px solid rgba(255,255,255,0.07)',background:'var(--bg-1, #0D1117)'
      }}>
        {FLOW_TABS.map(t => (
          <button key={t.id} onClick={() => setFlowFilter(t.id)} style={{
            background: flowFilter === t.id ? 'var(--gold, #D4A843)' : 'rgba(255,255,255,0.06)',
            color: flowFilter === t.id ? '#1a1000' : '#bbb',
            border: 0, padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{t.label}</button>
        ))}
        <div style={{flex:1}}/>
        <div style={{fontSize:11,color:'rgba(255,255,255,0.5)',alignSelf:'center'}}>
          {colIdx + 1} / {COLS.length}
        </div>
      </div>

      <div style={{display:'flex',gap:4,padding:'8px 14px',borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
        {COLS.map((c, i) => (
          <button key={c.id} onClick={() => setColIdx(i)} style={{
            flex:1, padding:'5px 0', background:'transparent', border:0,
            color: i === colIdx ? 'var(--gold-l, #E8C35A)' : 'rgba(255,255,255,0.35)',
            fontSize:16, cursor:'pointer',
            borderBottom: i === colIdx ? '2px solid var(--gold, #D4A843)' : '2px solid transparent',
          }}>{c.ic}</button>
        ))}
      </div>

      <PullToRefresh onRefresh={reload}>
        <div
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          style={{padding:'10px 12px',minHeight:'calc(100vh - 200px)'}}
        >
          {loading ? <SkeletonList n={4}/> : (
            cardsHere.length === 0 ? (
              <EmptyState
                icon={currentCol.ic}
                title={`В колонке «${currentCol.title}» пусто`}
                hint="Свайпай влево/вправо чтобы посмотреть другие этапы"
              />
            ) : cardsHere.map(card => (
              <MobileCard key={card.id} card={card} onClick={() => setDrawerCard(card)} />
            ))
          )}
        </div>
      </PullToRefresh>

      {drawerCard && (
        <BottomSheet open={true} onClose={() => setDrawerCard(null)} fullHeight>
          <CardDetail card={drawerCard} onClose={() => setDrawerCard(null)} onChanged={() => { setDrawerCard(null); reload(); }} />
        </BottomSheet>
      )}
    </PageShell>
  );
}

function MobileCard({ card, onClick }) {
  const kind = (card.kind || card.entity_kind || '').split('_')[0];
  const color = card.color || 'green';
  const meta = card.meta || [];
  const progress = card.progress || [0,0,0,0,0,0,0,0];
  const borderColor = color === 'yellow' ? '#FBBF24' : (color === 'red' ? '#F87171' : '#4ADE80');
  return (
    <div
      onClick={onClick}
      style={{
        background:'linear-gradient(160deg, var(--bg-2, #131A2A), var(--bg-3, #1B2336) 140%)',
        border:'1px solid rgba(255,255,255,0.08)',
        borderLeft:`3px solid ${borderColor}`,
        borderRadius:10, padding:'12px 14px', marginBottom:8,
        cursor:'pointer', boxShadow:'0 2px 6px rgba(0,0,0,0.16)',
      }}
    >
      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:5}}>
        <span style={{
          fontSize:9,fontWeight:700,padding:'2px 6px',borderRadius:4,letterSpacing:.4,textTransform:'uppercase',
          background: kind === 'application' ? 'rgba(212,168,67,0.15)' : (kind === 'pre' ? 'rgba(74,222,128,0.13)' : (kind === 'tender' ? 'rgba(96,165,250,0.13)' : 'rgba(248,113,113,0.13)')),
          color: kind === 'application' ? '#E8C35A' : (kind === 'pre' ? '#4ADE80' : (kind === 'tender' ? '#60A5FA' : '#F87171')),
        }}>{card.kindLabel || kind}</span>
        <span style={{fontSize:10,color:'rgba(255,255,255,0.4)',fontFamily:'monospace',marginLeft:'auto'}}>{card.code || '#' + card.id}</span>
      </div>
      <div style={{fontSize:14,fontWeight:600,color:'rgba(255,255,255,0.95)',marginBottom:3}}>
        {card.title || ''}
      </div>
      <div style={{fontSize:12,color:'rgba(255,255,255,0.7)',marginBottom:8}}>
        {card.customer || ''}
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:5,fontSize:10.5,color:'rgba(255,255,255,0.5)'}}>
        {meta.map((m, i) => <span key={i} style={{background:'rgba(255,255,255,0.06)',padding:'2px 7px',borderRadius:999}}>{m}</span>)}
      </div>
      <div style={{display:'flex',gap:2,marginTop:8}}>
        {progress.map((s, i) => (
          <div key={i} style={{
            flex:1,height:3,borderRadius:1.5,
            background: s === 2 ? '#D4A843' : (s === 1 ? '#E8C35A' : 'rgba(255,255,255,0.1)'),
            boxShadow: s === 1 ? '0 0 4px #D4A843' : 'none',
          }}/>
        ))}
      </div>
    </div>
  );
}

function CardDetail({ card, onClose, onChanged }) {
  const activeStage = COL_TO_STAGE[card.col] ?? 0;
  const [sending, setSending] = useState(false);
  const fin = card.finance || {};
  async function doTransition(toCol) {
    let note = null;
    if (toCol === 'lose' || toCol === 'kp_prep' || toCol === 'approval') {
      note = window.prompt('Комментарий (опц.):') || null;
    }
    setSending(true);
    const r = await api(`/api/personal-kanban/cards/${card.id}/transition`, {
      method: 'POST', body: { to_v3_column: toCol, note, confirm: true }
    });
    setSending(false);
    if (r && r.error) toast.error(r.message || r.error);
    else { toast.success('Перемещено'); onChanged(); }
  }

  function ctxButtons() {
    if (card.col === 'new') return (
      <>
        <Btn full onClick={() => doTransition('calc')} primary>🚀 К просчёту</Btn>
      </>
    );
    if (card.col === 'calc') return (
      <Btn full onClick={() => doTransition('approval')} primary>⚖️ На согласование</Btn>
    );
    if (card.col === 'approval') return (
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <Btn onClick={() => doTransition('lose')} danger>❌ Отклонить</Btn>
        <Btn onClick={() => doTransition('kp_prep')} primary>✅ Утвердить</Btn>
      </div>
    );
    if (card.col === 'kp_prep') return (
      <Btn full onClick={() => toast.info('ТКП-конструктор откроется на десктопе')} primary>🛠 Открыть ТКП</Btn>
    );
    if (card.col === 'sent') return (
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <Btn onClick={() => doTransition('lose')} danger>❌ Проиграли</Btn>
        <Btn onClick={() => doTransition('win')} primary>🏆 Выиграли</Btn>
      </div>
    );
    if (card.col === 'win')  return <Btn full onClick={() => doTransition('work')} primary>🏗 В работу</Btn>;
    return null;
  }

  return (
    <div style={{padding:'14px 16px 20px',color:'rgba(255,255,255,0.95)',maxHeight:'90vh',overflowY:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
        <div>
          <h2 style={{fontSize:17,margin:0,fontFamily:'Cinzel, serif',lineHeight:1.3}}>
            {card.title || '(без названия)'}
          </h2>
          <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',marginTop:3}}>
            {card.code || '#' + card.id} · {card.customer || '—'}
          </div>
        </div>
        <button onClick={onClose} style={{background:'transparent',border:0,color:'#bbb',padding:4}}>
          <X size={20}/>
        </button>
      </div>

      <div style={{display:'flex',gap:2,marginBottom:14,padding:'8px 0',background:'rgba(255,255,255,0.04)',borderRadius:8}}>
        {STAGE_LABELS.map((lbl, i) => (
          <div key={i} style={{
            flex:1,padding:'4px 2px',textAlign:'center',fontSize:9,fontWeight:500,
            color: i === activeStage ? '#E8C35A' : (i < activeStage ? '#4ADE80' : 'rgba(255,255,255,0.4)'),
            borderBottom: i === activeStage ? '2px solid #D4A843' : 'none',
          }}>{lbl.split(' ')[0]}</div>
        ))}
      </div>

      <Section title="🤖 AI разбор" defaultOpen>
        <div style={{
          background:'rgba(74,222,128,0.06)',borderLeft:'3px solid #4ADE80',
          padding:'11px 13px',borderRadius:'0 10px 10px 0',fontSize:13,lineHeight:1.55
        }}>
          {card.ai_summary || '(AI ещё не разобрал)'}
          {card.ai_recommendation && (
            <p style={{marginTop:7}}><b>💡</b> {card.ai_recommendation}</p>
          )}
        </div>
      </Section>

      <Section title="👤 Клиент">
        <Field label="Заказчик" value={card.customer_name || card.customer || '—'}/>
        <Field label="ИНН"      value={card.customer_inn || '—'}/>
        <Field label="Контакт"  value={card.contact_person || '—'}/>
        <Field label="Email"    value={card.customer_email || '—'}/>
        <Field label="Телефон"  value={card.contact_phone || '—'}/>
      </Section>

      <Section title="🔧 Работа">
        <Field label="Описание" value={card.work_description || '—'}/>
        <Field label="Дедлайн КП" value={card.work_deadline || '—'}/>
      </Section>

      <Section title="💰 Финансы">
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <FinTile label="С/С" v={fin.cost_planned}/>
          <FinTile label="КП без НДС" v={fin.kp_price_without_vat}/>
          <FinTile label="С НДС" v={fin.kp_price_with_vat}/>
          <FinTile label="Маржа" v={fin.margin_planned_pct != null ? Number(fin.margin_planned_pct).toFixed(1) + '%' : null} margin/>
        </div>
      </Section>

      <Section title="📎 Документы" count={(card.email_attachments?.length || 0)}>
        {((card.email_attachments || [])).length ? card.email_attachments.map((d, i) => (
          <div key={d.id || i} style={{
            display:'flex',alignItems:'center',gap:9,padding:'8px 11px',
            background:'rgba(255,255,255,0.04)',borderRadius:6,marginBottom:4,fontSize:12
          }}>
            <span>{(d.mime_type || '').includes('pdf') ? '📄' : ((d.mime_type || '').includes('sheet') ? '📊' : '📝')}</span>
            <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.original_filename || d.filename}</span>
          </div>
        )) : <div style={{color:'rgba(255,255,255,0.4)',fontSize:11.5}}>Нет вложений</div>}
      </Section>

      <Section title="🕘 История" defaultOpen={false} count={(card.history || []).length}>
        {(card.history || []).length ? (card.history || []).map((h, i) => (
          <div key={i} style={{padding:'5px 0',borderBottom:'1px solid rgba(255,255,255,0.06)',fontSize:12}}>
            <b>{h.when || ''}</b> · {h.who || ''} — {h.action || ''}
          </div>
        )) : <div style={{color:'rgba(255,255,255,0.4)',fontSize:11.5}}>История пуста</div>}
      </Section>

      <div style={{marginTop:16,position:'sticky',bottom:0,paddingTop:10,background:'linear-gradient(180deg, transparent, var(--bg-1, #0D1117) 30%)'}}>
        {ctxButtons()}
      </div>
    </div>
  );
}

function Section({ title, children, defaultOpen = true, count }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{marginBottom:14,background:'rgba(255,255,255,0.03)',borderRadius:10,overflow:'hidden'}}>
      <div onClick={() => setOpen(o => !o)} style={{padding:'10px 13px',display:'flex',alignItems:'center',gap:7,cursor:'pointer'}}>
        <span style={{fontSize:13,fontWeight:600,flex:1}}>{title}</span>
        {count != null && <span style={{background:'rgba(255,255,255,0.08)',color:'#bbb',padding:'1px 7px',borderRadius:999,fontSize:11}}>{count}</span>}
        <span style={{color:'#888',fontSize:11}}>{open ? '▾' : '▸'}</span>
      </div>
      {open && <div style={{padding:'4px 13px 13px'}}>{children}</div>}
    </div>
  );
}
function Field({ label, value }) {
  return (
    <div style={{display:'grid',gridTemplateColumns:'90px 1fr',gap:8,padding:'5px 0',fontSize:12.5}}>
      <span style={{color:'rgba(255,255,255,0.5)'}}>{label}</span>
      <span style={{color:'rgba(255,255,255,0.95)'}}>{value}</span>
    </div>
  );
}
function FinTile({ label, v, margin }) {
  return (
    <div style={{background:'rgba(255,255,255,0.04)',borderRadius:8,padding:'9px 11px'}}>
      <div style={{fontSize:9.5,color:'rgba(255,255,255,0.4)',textTransform:'uppercase',marginBottom:3,letterSpacing:.4}}>{label}</div>
      <div style={{fontSize:14,fontWeight:600,fontFamily:'monospace',color: margin ? '#4ADE80' : '#E8C35A'}}>
        {v != null ? (typeof v === 'number' ? Number(v).toLocaleString('ru-RU') + ' ₽' : v) : '—'}
      </div>
    </div>
  );
}
function Btn({ children, onClick, primary, danger, full }) {
  const bg = danger ? '#C8293B' : (primary ? '#D4A843' : 'rgba(255,255,255,0.08)');
  const color = danger ? '#fff' : (primary ? '#1a1000' : 'rgba(255,255,255,0.95)');
  return (
    <button onClick={onClick} style={{
      width: full ? '100%' : 'auto',
      padding: '11px 14px', background: bg, color, border: 0, borderRadius: 10,
      fontSize: 14, fontWeight: 600, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    }}>{children}</button>
  );
}
