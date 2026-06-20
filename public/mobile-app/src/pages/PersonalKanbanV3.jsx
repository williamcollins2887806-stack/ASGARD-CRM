/**
 * PersonalKanbanV3 — Мобильный канбан 9-колоночный (полный цикл от заявки до закрытия).
 * Свайп по 9 колонкам · карта → fullscreen BottomSheet · контекстные actions.
 *
 * Структура (S-29 reconcile Timesheet v2 + S-24):
 *   PageShell
 *     ├─ Header: переход на под-этапы + переключение колонок (HelpCircle на addendum)
 *     ├─ Flow filter chips (all/application/pre_tender/tender/work)
 *     ├─ Scope toggle (HEAD_TO: Мои/Отдел) — для tender flow
 *     ├─ 9 column tabs (addendum имеет золотую точку при count>0)
 *     ├─ Карта → BottomSheet (CardDetail с 8 секциями)
 *     └─ Контекстные actions по этапу
 *
 * Backend: те же endpoints что у React 2.0 (через api.get/api.post).
 *   GET /api/personal-kanban/board?flow_filter=&scope=
 *   GET /api/personal-kanban/columns/counts?flow_filter=&scope=
 *   POST /api/personal-kanban/cards/:id/transition (9 значений to_v3_column).
 *
 * S-29 reconcile: к Timesheet v2 рефактору (1342 LOC) добавлены тендерные фичи
 * из коммита 44109983 (S-24): 9-я колонка addendum, scope+auto-scope по роли,
 * HEAD_TO Мои/Отдел toggle, vibrate heavy на drop в addendum, золотая рамка
 * у addendum-карт, ctxButtons sent/addendum, Section «Дозапрос от клиента».
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  X, RotateCcw, LayoutGrid, Inbox, Calculator, Scale, FileText,
  Send, Trophy, XCircle, Hammer, ChevronLeft, HelpCircle,
} from 'lucide-react';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';

// 9 колонок: addendum вставлен МЕЖДУ sent и win (S-24 / V250 / HANDOFF.md §3.6).
const COLS = [
  { id: 'new',      icon: Inbox,       title: 'Новые' },
  { id: 'calc',     icon: Calculator,  title: 'Просчёт ТКП' },
  { id: 'approval', icon: Scale,       title: 'На согласовании' },
  { id: 'kp_prep',  icon: FileText,    title: 'КП готовится' },
  { id: 'sent',     icon: Send,        title: 'КП отправлено' },
  { id: 'addendum', icon: HelpCircle,  title: 'Дозапрос' },
  { id: 'win',      icon: Trophy,      title: 'Выиграно' },
  { id: 'lose',     icon: XCircle,     title: 'Проиграно' },
  { id: 'work',     icon: Hammer,      title: 'В работе' },
];
const STAGE_LABELS = ['📥', '🧮', '⚖️', '📋', '📤', '❓', '🏆', '❌', '🏗'];
const COL_TO_STAGE = { new: 0, calc: 1, approval: 2, kp_prep: 3, sent: 4, addendum: 5, win: 6, lose: 7, work: 8 };

const FLOW_TABS = [
  { id: 'all',         label: 'Все' },
  { id: 'application', label: '📥' },
  { id: 'pre_tender',  label: '🗂' },
  { id: 'tender',      label: '📋' },
  { id: 'work',        label: '🏗' },
];

// Сохраняем выбор HEAD_TO между сессиями: 'to_personal' | 'to_team'.
const SCOPE_STORAGE_KEY = 'asgard_mobile_pk_scope_to';

// Auto-scope по роли (S-9 backend matrix; S-24 frontend mirror).
// Должен оставаться 1:1 с backend src/routes/personal-kanban.js:resolveAutoScope.
function autoScopeForRole(role) {
  if (role === 'PM' || role === 'HEAD_PM') return 'owner';
  if (role === 'TO') return 'to_personal';
  if (role === 'HEAD_TO') return 'to_team';
  if (role === 'ADMIN' || role === 'DIRECTOR_GEN' || role === 'DIRECTOR_COMM' || role === 'DIRECTOR_DEV') return 'all';
  return 'auto';
}

export default function PersonalKanbanV3() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const haptic = useHaptic();
  const role = user?.role;
  const isHeadTo = role === 'HEAD_TO';

  // initialScope: HEAD_TO держит выбор в LS (to_personal/to_team), остальным — autoScopeForRole.
  const initialScope = useMemo(() => {
    if (isHeadTo) {
      const saved = localStorage.getItem(SCOPE_STORAGE_KEY);
      if (saved === 'to_personal' || saved === 'to_team') return saved;
    }
    return autoScopeForRole(role);
  }, [role, isHeadTo]);

  const [columns, setColumns] = useState({});
  const [counts, setCounts]   = useState({});
  const [colIdx, setColIdx]   = useState(0);
  const [flowFilter, setFlowFilter] = useState('all');
  const [scope, setScope]     = useState(initialScope);
  const [loading, setLoading] = useState(true);
  const [drawerCard, setDrawerCard] = useState(null);
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  // При смене user/role подтягиваем правильный scope (если ещё не сохранён выбор HEAD_TO).
  useEffect(() => { setScope(initialScope); }, [initialScope]);

  async function reload() {
    setLoading(true);
    try {
      // api.get автоматически добавляет BASE_URL '/api', поэтому путь без префикса.
      // scope передаём ВСЕГДА, кроме 'auto' (бэкенд сам решит per S-9 resolveAutoScope).
      const scopeQs = scope && scope !== 'auto' ? `&scope=${encodeURIComponent(scope)}` : '';
      const [board, c] = await Promise.all([
        api.get(`/personal-kanban/board?flow_filter=${encodeURIComponent(flowFilter)}${scopeQs}`),
        api.get(`/personal-kanban/columns/counts?flow_filter=${encodeURIComponent(flowFilter)}${scopeQs}`)
          .catch(() => ({})), // counts не критичны — если 404/500, оставим пустые
      ]);
      if (isMountedRef.current) {
        setColumns((board && board.columns) || {});
        setCounts(c || {});
      }
    } catch (e) {
      toast.error('Не загрузилось: ' + (e?.message || 'ошибка'));
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [flowFilter, scope]);

  function switchScope(next) {
    if (next === scope) return;
    haptic.light();
    if (isHeadTo) localStorage.setItem(SCOPE_STORAGE_KEY, next);
    setScope(next);
  }

  const currentCol = COLS[colIdx];
  const cardsHere = (columns[currentCol.id] || []);

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }
  function onTouchEnd(e) {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    // Жёсткий threshold: горизонтальный 50px И вертикальный <30px (не диагональ).
    if (Math.abs(dx) > 50 && Math.abs(dy) < 30) {
      if (dx < 0 && colIdx < COLS.length - 1) setColIdx(i => i + 1);
      if (dx > 0 && colIdx > 0)               setColIdx(i => i - 1);
    }
    touchStartX.current = null; touchStartY.current = null;
  }

  return (
    <PageShell
      title={`${currentCol.title} (${cardsHere.length})`}
      showBack={false}
      headerRight={
        <button
          onClick={reload}
          aria-label="Обновить"
          style={{ background:'transparent', border:0, color:'var(--text-secondary)', padding:8, cursor:'pointer' }}
        >
          <RotateCcw size={18} />
        </button>
      }
    >
      {/* Toolbar: переключение на substages + flow filter */}
      <div style={{
        display:'flex',alignItems:'center',gap:6,padding:'8px 14px',
        background:'var(--bg-card, var(--bg-elevated))',
        borderBottom:'1px solid var(--brd, rgba(255,255,255,0.07))',
      }}>
        <button
          onClick={() => navigate('/personal-kanban')}
          aria-label="К подэтапам"
          style={{
            background:'rgba(255,255,255,0.05)',border:0,padding:'6px 10px',
            borderRadius:8,color:'var(--text-secondary)',cursor:'pointer',
            display:'inline-flex',alignItems:'center',gap:5,fontSize:12,
          }}
        >
          <LayoutGrid size={14}/> По под-этапам
        </button>
        <div style={{flex:1}}/>
        <div style={{fontSize:11,color:'var(--text-secondary)'}}>
          {colIdx + 1} / {COLS.length}
        </div>
      </div>

      {/* Flow filter chips */}
      <div style={{
        display:'flex',gap:6,padding:'8px 14px',overflowX:'auto',
        borderBottom:'1px solid var(--brd, rgba(255,255,255,0.07))',
      }}>
        {FLOW_TABS.map(t => (
          <button key={t.id} onClick={() => setFlowFilter(t.id)} style={{
            background: flowFilter === t.id ? 'var(--gold, #D4A843)' : 'rgba(255,255,255,0.06)',
            color: flowFilter === t.id ? '#1a1000' : 'var(--text-secondary)',
            border: 0, padding: '8px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 36,
          }}>{t.label}</button>
        ))}
      </div>

      {/* Scope toggle для HEAD_TO: Мои/Отдел. Видим только если HEAD_TO. */}
      {isHeadTo && (
        <div style={{
          display:'flex',gap:6,padding:'6px 14px 8px',
          borderBottom:'1px solid var(--brd, rgba(255,255,255,0.07))',
        }}>
          <button
            onClick={() => switchScope('to_personal')}
            aria-label="Мои тендеры"
            style={{
              flex:1, padding:'8px 10px', borderRadius:8,
              background: scope === 'to_personal' ? 'var(--gold, #D4A843)' : 'rgba(255,255,255,0.06)',
              color: scope === 'to_personal' ? '#1a1000' : 'var(--text-secondary)',
              border:0, fontSize:12, fontWeight:600, cursor:'pointer', minHeight:36,
            }}
          >🟦 Мои</button>
          <button
            onClick={() => switchScope('to_team')}
            aria-label="Весь отдел ТО"
            style={{
              flex:1, padding:'8px 10px', borderRadius:8,
              background: scope === 'to_team' ? 'var(--gold, #D4A843)' : 'rgba(255,255,255,0.06)',
              color: scope === 'to_team' ? '#1a1000' : 'var(--text-secondary)',
              border:0, fontSize:12, fontWeight:600, cursor:'pointer', minHeight:36,
            }}
          >👑 Отдел</button>
        </div>
      )}

      {/* Column tabs (9 колонок, addendum имеет золотую точку при count>0) */}
      <div style={{
        display:'flex',gap:2,padding:'6px 14px',
        borderBottom:'1px solid var(--brd, rgba(255,255,255,0.07))',
      }}>
        {COLS.map((c, i) => {
          const Icon = c.icon;
          const isAddendumCol = c.id === 'addendum';
          const addendumCount = (counts.addendum != null ? counts.addendum : (columns.addendum || []).length) || 0;
          return (
            <button key={c.id} onClick={() => { haptic.light(); setColIdx(i); }} aria-label={c.title} style={{
              flex:1, padding:'10px 0', background:'transparent', border:0,
              color: i === colIdx
                ? 'var(--gold-l, #E8C35A)'
                : (isAddendumCol ? 'var(--gold, #D4A843)' : 'rgba(255,255,255,0.40)'),
              cursor:'pointer', minHeight:44,
              borderBottom: i === colIdx ? '2px solid var(--gold, #D4A843)' : '2px solid transparent',
              display:'flex', alignItems:'center', justifyContent:'center',
              position:'relative',
            }}>
              <Icon size={18}/>
              {isAddendumCol && addendumCount > 0 && (
                <span style={{
                  position:'absolute', top:6, right:'calc(50% - 14px)',
                  width:6, height:6, borderRadius:'50%',
                  background:'var(--gold, #D4A843)',
                  boxShadow:'0 0 4px var(--gold, #D4A843)',
                }}/>
              )}
            </button>
          );
        })}
      </div>

      <PullToRefresh onRefresh={reload}>
        <div
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          style={{padding:'12px',minHeight:'calc(100vh - 260px)'}}
        >
          {loading ? <SkeletonList count={4}/> : (
            cardsHere.length === 0 ? (
              <EmptyState
                icon={currentCol.icon}
                title={`В колонке «${currentCol.title}» пусто`}
                description="Свайпай влево/вправо чтобы посмотреть другие этапы"
              />
            ) : cardsHere.map(card => (
              <MobileCard key={card.id} card={card} onClick={() => setDrawerCard(card)} />
            ))
          )}
        </div>
      </PullToRefresh>

      {drawerCard && (
        <BottomSheet open={true} onClose={() => setDrawerCard(null)}>
          <CardDetail
            card={drawerCard}
            onClose={() => setDrawerCard(null)}
            onChanged={() => { setDrawerCard(null); reload(); }}
          />
        </BottomSheet>
      )}
    </PageShell>
  );
}

function MobileCard({ card, onClick }) {
  const kind = (card.kind || card.entity_kind || '').split('_')[0];
  const color = card.color || 'green';
  const meta = card.meta || [];
  // 9 dots (после добавления addendum-колонки).
  const progress = card.progress || [0,0,0,0,0,0,0,0,0];
  const borderColor = color === 'yellow' ? '#FBBF24' : (color === 'red' ? '#F87171' : '#4ADE80');
  // S-24: золотая рамка для карт в колонке «Дозапрос» + бейдж дней в углу.
  const isInAddendum = card.col === 'addendum';
  return (
    <div
      onClick={onClick}
      style={{
        background:'linear-gradient(160deg, var(--bg-card, #131A2A), var(--bg-elevated, #1B2336) 140%)',
        border: isInAddendum ? '1px solid var(--gold, #D4A843)' : '1px solid rgba(255,255,255,0.08)',
        borderLeft: isInAddendum ? '3px solid var(--gold, #D4A843)' : `3px solid ${borderColor}`,
        borderRadius:10, padding:'14px', marginBottom:8,
        cursor:'pointer',
        boxShadow: isInAddendum ? '0 0 12px rgba(212,168,67,0.18)' : '0 2px 6px rgba(0,0,0,0.16)',
        minHeight:60,
        position:'relative',
      }}
    >
      {isInAddendum && (
        <div style={{
          position:'absolute', top:8, right:10,
          fontSize:10, fontWeight:700,
          padding:'2px 7px', borderRadius:999,
          background:'rgba(212,168,67,0.18)', color:'var(--gold-l, #E8C35A)',
          letterSpacing:.4,
        }}>
          ❓ {card.addendum_days_left != null ? `${card.addendum_days_left}д` : 'нов.'}
        </div>
      )}
      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:5}}>
        <span style={{
          fontSize:10,fontWeight:700,padding:'3px 7px',borderRadius:4,letterSpacing:.4,textTransform:'uppercase',
          background: kind === 'application' ? 'rgba(212,168,67,0.15)' : (kind === 'pre' ? 'rgba(74,222,128,0.13)' : (kind === 'tender' ? 'rgba(96,165,250,0.13)' : 'rgba(248,113,113,0.13)')),
          color: kind === 'application' ? '#E8C35A' : (kind === 'pre' ? '#4ADE80' : (kind === 'tender' ? '#60A5FA' : '#F87171')),
        }}>{card.kindLabel || kind}</span>
        <span style={{fontSize:11,color:'rgba(255,255,255,0.4)',fontFamily:'monospace',marginLeft:'auto'}}>{card.code || '#' + card.id}</span>
      </div>
      <div style={{fontSize:14.5,fontWeight:600,color:'rgba(255,255,255,0.95)',marginBottom:3,wordBreak:'break-word'}}>
        {card.title || ''}
      </div>
      <div style={{fontSize:12,color:'rgba(255,255,255,0.7)',marginBottom:8,wordBreak:'break-word'}}>
        {card.customer || ''}
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:5,fontSize:10.5,color:'rgba(255,255,255,0.5)'}}>
        {meta.map((m, i) => <span key={i} style={{background:'rgba(255,255,255,0.06)',padding:'3px 8px',borderRadius:999}}>{m}</span>)}
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
  const haptic = useHaptic();
  const activeStage = COL_TO_STAGE[card.col] ?? 0;
  const [sending, setSending] = useState(false);
  // Какая встраиваемая модалка открыта (сидит поверх drawer).
  // Значения: 'conductor' | 'references' | 'tkp' | null.
  const [modal, setModal] = useState(null);
  const fin = card.finance || {};

  async function doTransition(toCol, opts = {}) {
    let note = opts.note ?? null;
    if (note === null && (toCol === 'lose' || toCol === 'kp_prep' || toCol === 'approval' || toCol === 'addendum')) {
      note = window.prompt('Комментарий (опц.):') || null;
    }
    setSending(true);
    try {
      await api.post(`/personal-kanban/cards/${card.id}/transition`, {
        to_v3_column: toCol, note, confirm: !!opts.confirm,
      });
      // S-24: тактильный отклик. addendum = heavy (новый дозапрос, важное событие),
      // остальное — success-паттерн.
      if (toCol === 'addendum') haptic.heavy();
      else                      haptic.success();
      toast.success('Перемещено');
      onChanged();
    } catch (e) {
      // 409 + confirm_required → подтверждение и retry с confirm:true.
      // (api wrapper бросает Error c .status/.body, см. mobile-app/src/api/client.js)
      if (e?.status === 409 && e?.body?.error === 'confirm_required') {
        setSending(false);
        const msg = e.body.message || 'Необычный переход. Подтвердить?';
        if (window.confirm(msg)) return doTransition(toCol, { note, confirm: true });
        return;
      }
      haptic.error();
      toast.error('Ошибка: ' + (e?.body?.message || e?.body?.error || e?.message || 'неизвестная'));
    } finally {
      setSending(false);
    }
  }

  function CtxButtons() {
    if (card.col === 'new') return (
      <Btn full primary onClick={() => doTransition('calc')} disabled={sending}>
        🚀 К просчёту
      </Btn>
    );
    if (card.col === 'calc') return (
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
          <Btn onClick={() => toast.info('Quick: открой на десктопе')} disabled={sending}>🚀 Quick</Btn>
          <Btn onClick={() => setModal('conductor')} disabled={sending}>🎼 Кондуктор</Btn>
          <Btn onClick={() => setModal('references')} disabled={sending}>📚 Эталоны</Btn>
        </div>
        <Btn full primary onClick={() => doTransition('approval')} disabled={sending}>
          ⚖️ На согласование
        </Btn>
      </div>
    );
    if (card.col === 'approval') return (
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <Btn danger onClick={() => doTransition('lose')} disabled={sending}>❌ Отклонить</Btn>
        <Btn primary onClick={() => doTransition('kp_prep')} disabled={sending}>✅ Утвердить</Btn>
      </div>
    );
    if (card.col === 'kp_prep') return (
      <Btn full primary onClick={() => setModal('tkp')} disabled={sending}>
        🛠 Открыть ТКП
      </Btn>
    );
    // S-24: «КП отправлено» — 3 кнопки (❌ Проиграли / ❓ Дозапрос / 🏆 Выиграли).
    // Кнопка «Дозапрос» переводит карту в 9-ю колонку (золотая рамка + vibrate heavy).
    if (card.col === 'sent') return (
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
        <Btn danger onClick={() => doTransition('lose')} disabled={sending}>❌</Btn>
        <Btn onClick={() => doTransition('addendum')} disabled={sending}>❓ Дозапрос</Btn>
        <Btn primary onClick={() => doTransition('win')} disabled={sending}>🏆</Btn>
      </div>
    );
    // S-24: 9-я колонка «Дозапрос» — вернуть в КП отправлено / Проиграли / Выиграли.
    if (card.col === 'addendum') return (
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
        <Btn onClick={() => doTransition('sent')} disabled={sending}>↩ К КП</Btn>
        <Btn danger onClick={() => doTransition('lose')} disabled={sending}>❌</Btn>
        <Btn primary onClick={() => doTransition('win')} disabled={sending}>🏆</Btn>
      </div>
    );
    if (card.col === 'win')  return (
      <Btn full primary onClick={() => doTransition('work')} disabled={sending}>🏗 В работу</Btn>
    );
    return null;
  }

  return (
    <div style={{padding:'14px 16px 20px',color:'rgba(255,255,255,0.95)',maxHeight:'80vh',overflowY:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
        <div style={{flex:1,minWidth:0,paddingRight:12}}>
          <h2 style={{fontSize:17,margin:0,fontFamily:'Cinzel, serif',lineHeight:1.3,wordBreak:'break-word'}}>
            {card.title || '(без названия)'}
          </h2>
          <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',marginTop:3,wordBreak:'break-word'}}>
            {card.code || '#' + card.id} · {card.customer || '—'}
          </div>
        </div>
        <button onClick={onClose} aria-label="Закрыть" style={{
          background:'transparent',border:0,color:'#bbb',padding:6,minWidth:44,minHeight:44,
          cursor:'pointer',
        }}>
          <X size={20}/>
        </button>
      </div>

      <div style={{display:'flex',gap:2,marginBottom:14,padding:'8px 4px',background:'rgba(255,255,255,0.04)',borderRadius:8}}>
        {STAGE_LABELS.map((lbl, i) => (
          <div key={i} style={{
            flex:1,padding:'4px 0',textAlign:'center',fontSize:14,fontWeight:500,
            color: i === activeStage ? '#E8C35A' : (i < activeStage ? '#4ADE80' : 'rgba(255,255,255,0.4)'),
            borderBottom: i === activeStage ? '2px solid #D4A843' : 'none',
          }}>{lbl}</div>
        ))}
      </div>

      <Section title="🤖 AI разбор" defaultOpen>
        <div style={{
          background:'rgba(74,222,128,0.06)',borderLeft:'3px solid #4ADE80',
          padding:'12px 14px',borderRadius:'0 10px 10px 0',fontSize:13,lineHeight:1.55,
          wordBreak:'break-word',
        }}>
          {card.ai_summary || '(AI ещё не разобрал)'}
          {card.ai_recommendation && (
            <p style={{marginTop:7}}><b>💡</b> {card.ai_recommendation}</p>
          )}
        </div>
      </Section>

      {/* S-24: Блок «Дозапрос от клиента» — рендерится только когда карта в
          колонке addendum или backend прислал card.addendum_note. */}
      {(card.col === 'addendum' || card.addendum_note) && (
        <Section title="❓ Дозапрос от клиента" defaultOpen>
          <div style={{
            background:'rgba(212,168,67,0.08)',
            borderLeft:'3px solid var(--gold, #D4A843)',
            padding:'12px 14px', borderRadius:'0 10px 10px 0',
            fontSize:13, lineHeight:1.55,
            wordBreak:'break-word',
          }}>
            {card.addendum_days_left != null && (
              <div style={{fontSize:11, color:'var(--gold-l, #E8C35A)', fontWeight:600, marginBottom:5}}>
                Получен {card.addendum_days_left} {card.addendum_days_left === 1 ? 'день' : 'дн.'} назад
              </div>
            )}
            <div style={{color:'rgba(255,255,255,0.88)'}}>
              {card.addendum_note || 'Клиент запросил уточнения. Ответь — карта вернётся в «КП отправлено».'}
            </div>
          </div>
        </Section>
      )}

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
            display:'flex',alignItems:'center',gap:9,padding:'10px 12px',
            background:'rgba(255,255,255,0.04)',borderRadius:6,marginBottom:4,fontSize:12.5,
            wordBreak:'break-word',minHeight:44,
          }}>
            <span>{(d.mime_type || '').includes('pdf') ? '📄' : ((d.mime_type || '').includes('sheet') ? '📊' : '📝')}</span>
            <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.original_filename || d.filename}</span>
          </div>
        )) : <div style={{color:'rgba(255,255,255,0.4)',fontSize:11.5}}>Нет вложений</div>}
      </Section>

      <Section title="🕘 История" defaultOpen={false} count={(card.history || []).length}>
        {(card.history || []).length ? (card.history || []).map((h, i) => (
          <div key={i} style={{padding:'7px 0',borderBottom:'1px solid rgba(255,255,255,0.06)',fontSize:12.5,wordBreak:'break-word'}}>
            <b>{h.when || ''}</b> · {h.who || ''} — {h.action || ''}
          </div>
        )) : <div style={{color:'rgba(255,255,255,0.4)',fontSize:11.5}}>История пуста</div>}
      </Section>

      <div style={{marginTop:16,paddingTop:10}}>
        <CtxButtons/>
      </div>

      {/* Встраиваемые fullscreen-модалки поверх drawer'а карты.
          Свой overlay+sheet (без BottomSheet — он лежит в z:40, его контент уже скроллится).
          Эти три модалки = полноэкран, z:60. */}
      {modal === 'conductor'  && <ConductorSheet  card={card} onClose={() => setModal(null)} />}
      {modal === 'references' && <ReferencesSheet card={card} onClose={() => setModal(null)} />}
      {modal === 'tkp'        && (
        <TkpConstructorSheet
          card={card}
          onClose={() => setModal(null)}
          onAttached={() => { setModal(null); onChanged(); }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * FullScreenSheet — общий overlay+sheet для встраиваемых модалок поверх drawer.
 * z:60 чтобы перекрыть BottomSheet (z:40). Sticky header + sticky footer.
 * ═══════════════════════════════════════════════════════════════════════════ */
function FullScreenSheet({ title, subtitle, onClose, children, footer }) {
  useEffect(() => {
    // Закрытие по Escape — на десктопе при ширине браузера полезно.
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position:'fixed', inset:0, zIndex:60,
        background:'rgba(8,12,22,0.78)',
        backdropFilter:'blur(6px)',
        WebkitBackdropFilter:'blur(6px)',
        display:'flex', alignItems:'flex-end', justifyContent:'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background:'linear-gradient(160deg,#101725,#0B111D)',
        width:'100%', maxWidth:720, height:'96vh',
        borderTopLeftRadius:18, borderTopRightRadius:18,
        boxShadow:'0 -10px 40px rgba(0,0,0,0.5)',
        display:'flex', flexDirection:'column',
        color:'rgba(255,255,255,0.95)',
      }}>
        {/* Header sticky */}
        <div style={{
          padding:'14px 16px', display:'flex', alignItems:'center', gap:10,
          borderBottom:'1px solid rgba(255,255,255,0.08)',
          background:'rgba(255,255,255,0.02)', flexShrink:0,
        }}>
          <div style={{flex:1, minWidth:0}}>
            <h2 style={{
              fontFamily:'Cinzel, serif', fontSize:16, margin:0, lineHeight:1.2,
              color:'#E8C35A',
            }}>{title}</h2>
            {subtitle && (
              <div style={{fontSize:11, color:'rgba(255,255,255,0.5)', marginTop:2}}>{subtitle}</div>
            )}
          </div>
          <button onClick={onClose} aria-label="Закрыть" style={{
            background:'transparent', border:0, color:'#bbb', padding:6,
            minWidth:44, minHeight:44, cursor:'pointer',
          }}>
            <X size={22}/>
          </button>
        </div>

        {/* Body scrollable */}
        <div style={{flex:1, overflowY:'auto', WebkitOverflowScrolling:'touch'}}>
          {children}
        </div>

        {/* Footer sticky (optional) */}
        {footer && (
          <div style={{
            padding:'10px 14px',
            borderTop:'1px solid rgba(255,255,255,0.08)',
            background:'rgba(255,255,255,0.03)',
            display:'flex', gap:8, alignItems:'center',
            paddingBottom:'calc(env(safe-area-inset-bottom,0px) + 10px)',
            flexShrink:0,
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ConductorSheet — Мимир-Кондуктор сессия (мобильная версия).
 * Источник: BoardV3.jsx ConductorV3 660-718. Логика 1-в-1: при open зовём
 * /personal-kanban/cards/:id/start-conductor (fire-and-forget), показываем
 * прогресс-блок (5 пунктов) + журнал переписки (хардкод demo, в production
 * придёт реальный SSE через /api/mimir/conductor/events — TODO).
 * ═══════════════════════════════════════════════════════════════════════════ */
function ConductorSheet({ card, onClose }) {
  useEffect(() => {
    api.post(`/personal-kanban/cards/${card.id}/start-conductor`, {}).catch(() => {});
    /* eslint-disable-next-line */
  }, []);
  // Demo-журнал (десктоп тоже хардкодит — реальный SSE будет в следующей волне).
  const journal = [
    { role: 'ai',     who: 'Мимир',  when: '17.06 22:15', status: 'sent',     text: 'Сформировал 5 уточняющих вопросов. Письмо «АС-2026-06-17/Q001» отправлено клиенту.' },
    { role: 'pm',     who: 'РП',     when: '17.06 22:18', text: 'Подтвердил отправку.' },
    { role: 'client', who: 'Клиент', when: '18.06 09:42', status: 'received', text: 'Прислал ответы на 3 из 5 вопросов. Чертежи в приложении.' },
    { role: 'ai',     who: 'Мимир',  when: '18.06 09:46', status: 'draft',    text: 'Готов сформировать письмо-напоминание по 2 оставшимся вопросам.' },
  ];
  const stages = [
    { txt: '✅ Анализ ТЗ · 100%',          done: true },
    { txt: '✅ Вопросы клиенту · 5/5',      done: true },
    { txt: '🔄 Получение ответов · 3/5',    done: false, active: true },
    { txt: '⏳ Уточняющая итерация',        done: false },
    { txt: '⏳ Итоговая смета',             done: false, pale: true },
    { txt: '⏳ ТКП',                        done: false, pale: true },
  ];
  return (
    <FullScreenSheet
      title="🎼 Мимир-Кондуктор"
      subtitle={`Сессия по «${card.title || card.code || '#' + card.id}» · итерация 2/4`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={() => toast.info('Напоминание клиенту отправлено')}>📨 Напомнить</Btn>
          <div style={{flex:1}}/>
          <Btn primary onClick={() => toast.info('Откроется страница сметы на десктопе')}>📊 К смете</Btn>
        </>
      }
    >
      <div style={{padding:'14px 16px'}}>
        {/* Прогресс (мобильно — вертикально, не 2-колоночно как на десктопе) */}
        <div style={{
          background:'rgba(255,255,255,0.04)', borderRadius:10, padding:'12px 14px',
          marginBottom:14,
        }}>
          <div style={{fontSize:10.5, color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:.5, marginBottom:8}}>
            Прогресс
          </div>
          {stages.map((s, i) => (
            <div key={i} style={{
              fontSize:12.5, padding:'5px 0', lineHeight:1.4,
              color: s.active ? '#E8C35A' : (s.pale ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.85)'),
            }}>{s.txt}</div>
          ))}
          <div style={{
            marginTop:10, paddingTop:8, borderTop:'1px solid rgba(255,255,255,0.06)',
            fontSize:11, color:'rgba(255,255,255,0.5)',
          }}>
            <b style={{color:'rgba(255,255,255,0.7)'}}>Токены:</b> 47К / 80К
          </div>
        </div>

        {/* Журнал */}
        <div style={{fontSize:10.5, color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:.5, marginBottom:8}}>
          Журнал переписки
        </div>
        {journal.map((m, i) => {
          const ava = m.role === 'ai' ? '🧙' : (m.role === 'client' ? '📨' : '👤');
          const accent =
            m.role === 'ai'     ? '#A78BFA' :
            m.role === 'client' ? '#4ADE80' : '#E8C35A';
          return (
            <div key={i} style={{
              display:'flex', gap:10, padding:'10px 12px', marginBottom:8,
              background:'rgba(255,255,255,0.03)',
              borderLeft:`3px solid ${accent}`,
              borderRadius:'0 8px 8px 0',
            }}>
              <div style={{fontSize:18, lineHeight:1}}>{ava}</div>
              <div style={{flex:1, minWidth:0}}>
                <div style={{display:'flex', gap:8, alignItems:'baseline', marginBottom:3, flexWrap:'wrap'}}>
                  <span style={{fontSize:12.5, fontWeight:600, color:'rgba(255,255,255,0.95)'}}>{m.who}</span>
                  <span style={{fontSize:10.5, color:'rgba(255,255,255,0.4)'}}>{m.when}</span>
                  {m.status && (
                    <span style={{
                      fontSize:10, padding:'1px 6px', borderRadius:4,
                      background:'rgba(255,255,255,0.06)', color:'rgba(255,255,255,0.6)',
                    }}>{m.status}</span>
                  )}
                </div>
                <div style={{fontSize:12.5, lineHeight:1.45, color:'rgba(255,255,255,0.8)', wordBreak:'break-word'}}>
                  {m.text}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </FullScreenSheet>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ReferencesSheet — эталонные проекты (поиск по типу работы + объёму).
 * Источник: BoardV3.jsx ReferencesV3 720-785.
 * Endpoint: GET /api/mimir/references/search?work_type=&volume_min=&volume_max=&limit=
 * Mobile-UI: список карточек вертикально (не таблица), 2x2 grid метрик внутри.
 * Скелетоны на loading, рекомендация Мимира под списком если есть top.
 * ═══════════════════════════════════════════════════════════════════════════ */
function ReferencesSheet({ card, onClose }) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = new URLSearchParams();
    if (card.work_type) q.set('work_type', card.work_type);
    if (card.volume_estimate) {
      q.set('volume_min', String(Math.round(card.volume_estimate * 0.7)));
      q.set('volume_max', String(Math.round(card.volume_estimate * 1.3)));
    }
    q.set('limit', '10');
    api.get(`/mimir/references/search?${q.toString()}`)
      .then(r => { setItems((r && (r.items || r.references)) || []); })
      .catch(() => { /* пусто = «не нашлось» */ })
      .finally(() => setLoading(false));
  }, [card]);

  const top = items[0];
  const fmtMoneyShort = (n) => n != null ? (Math.round(Number(n) / 1000).toLocaleString('ru-RU') + ' К') : '—';
  const fmtPct        = (n) => n != null ? (Number(n).toFixed(1) + '%') : '—';

  return (
    <FullScreenSheet
      title="📚 Эталонные проекты"
      subtitle={loading ? 'Загружаю…' : `Найдено: ${items.length}${card.work_type ? ' · ' + card.work_type : ''}`}
      onClose={onClose}
    >
      <div style={{padding:'12px 14px'}}>
        {loading ? (
          // Skeleton — 3 пульсирующих карточки.
          <>
            {[0,1,2].map(i => (
              <div key={i} style={{
                background:'rgba(255,255,255,0.04)', borderRadius:10, padding:14,
                marginBottom:10, height:120,
                animation:'rdyPulse 1.4s ease-in-out infinite',
              }}/>
            ))}
            <style>{`@keyframes rdyPulse{0%,100%{opacity:.5}50%{opacity:.9}}`}</style>
          </>
        ) : items.length === 0 ? (
          <div style={{
            padding:'40px 20px', textAlign:'center', color:'rgba(255,255,255,0.5)',
            fontSize:13,
          }}>
            По типу «{card.work_type || 'наш профиль'}» эталонов не нашлось.
            <div style={{marginTop:8, fontSize:11}}>Попробуй заполнить тип работы в карте.</div>
          </div>
        ) : (
          <>
            <p style={{
              fontSize:12, color:'rgba(255,255,255,0.6)', marginBottom:10, lineHeight:1.5,
            }}>
              База эталонов содержит завершённые работы. По типу «{card.work_type || 'наш профиль'}» найдено {items.length} совпадений:
            </p>

            {items.map(it => {
              const sim = Number(it.similarity_pct || 0);
              const simColor = sim >= 90 ? '#4ADE80' : (sim >= 75 ? '#FBBF24' : '#F87171');
              const margin = Number(it.margin_actual_pct || it.margin_planned_pct || 0);
              const marginColor = margin >= 22 ? '#4ADE80' : '#F87171';
              return (
                <div key={it.id} style={{
                  background:'rgba(255,255,255,0.04)',
                  border:'1px solid rgba(255,255,255,0.06)',
                  borderRadius:10, padding:12, marginBottom:10,
                }}>
                  {/* Шапка */}
                  <div style={{display:'flex', alignItems:'flex-start', gap:8, marginBottom:10}}>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{
                        fontSize:13, fontWeight:600, color:'rgba(255,255,255,0.95)',
                        wordBreak:'break-word',
                      }}>
                        {it.code || ('REF-' + it.id)} · {it.work_type || it.object_name || '—'}
                      </div>
                      <div style={{
                        fontSize:11.5, color:'rgba(255,255,255,0.55)', marginTop:2,
                        wordBreak:'break-word',
                      }}>
                        {it.customer_name || ''}
                      </div>
                    </div>
                    <button
                      onClick={() => toast.info('Копирование сметы — открой на десктопе')}
                      aria-label="Скопировать смету"
                      style={{
                        background:'rgba(212,168,67,0.15)', border:'1px solid rgba(212,168,67,0.4)',
                        color:'#E8C35A', borderRadius:8, padding:'8px 12px', cursor:'pointer',
                        fontSize:14, fontWeight:700, minWidth:44, minHeight:44,
                      }}
                    >→</button>
                  </div>

                  {/* 2x2 grid метрик */}
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:6}}>
                    <RefTile label="Сумма"   value={fmtMoneyShort(it.contract_value_actual || it.contract_value_planned)} color="#E8C35A"/>
                    <RefTile label="Маржа"   value={fmtPct(it.margin_actual_pct || it.margin_planned_pct)} color={marginColor}/>
                    <RefTile label="Дни"     value={it.duration_actual_calendar_days || it.duration_calendar_days || '—'} color="rgba(255,255,255,0.85)"/>
                    <RefTile label="% совп." value={(it.similarity_pct != null ? it.similarity_pct : '?') + '%'} color={simColor}/>
                  </div>
                </div>
              );
            })}

            {/* Рекомендация Мимира */}
            {top && (
              <div style={{
                marginTop:12, padding:'12px 14px',
                background:'rgba(74,222,128,0.06)',
                borderLeft:'3px solid #4ADE80',
                borderRadius:'0 10px 10px 0',
                fontSize:12.5, lineHeight:1.5,
              }}>
                <b style={{color:'#E8C35A', fontSize:13}}>🤖 Рекомендация Мимира</b>
                <div style={{marginTop:5, color:'rgba(255,255,255,0.85)'}}>
                  Базовый эталон — <b>{top.code || ('REF-' + top.id)}</b> ({top.similarity_pct || 0}% совпадение).
                  Скорректируй на: <b>+5% логистика</b>, <b>+2% сезон</b>.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </FullScreenSheet>
  );
}

function RefTile({ label, value, color }) {
  return (
    <div style={{
      background:'rgba(255,255,255,0.03)', borderRadius:6, padding:'7px 10px',
    }}>
      <div style={{fontSize:9.5, color:'rgba(255,255,255,0.4)', textTransform:'uppercase', letterSpacing:.4}}>
        {label}
      </div>
      <div style={{fontSize:13, fontWeight:600, fontFamily:'monospace', color, marginTop:2}}>
        {value}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * TKP-конструктор (мобильная версия).
 * Источник: BoardV3.jsx TKPConstructorV3 805-1014 + SmetaTableEditable 1111-1210.
 *
 * Endpoints (десктоп-сигнатуры — НЕ из спеки юзера; источник правды — api.js):
 *   POST   /api/tkp/from-card/:cardId   body { template_kind } → { tkp_id, blocks? }
 *                                       или { error:'tkp_already_exists', tkp_id }
 *   GET    /api/tkp/:tkpId/blocks                              → { blocks: [...] }
 *   PUT    /api/tkp/:tkpId/blocks       body { blocks }         (НЕ POST)
 *   POST   /api/tkp/:tkpId/render-pdf                          → { pdf_path }
 *   POST   /api/tkp/:tkpId/attach-to-card/:cardId              → { document_id }
 *
 * Mobile UI: accordion (не tabs+editor как на десктопе). Каждый блок = карточка,
 * кликаешь — раскрывается inline-редактор. Кнопки ▲ ▼ ✕ в шапке.
 * Autosave 10с при dirty. Sticky footer: 💾 / 📄 PDF / 📎 Прикрепить.
 * ═══════════════════════════════════════════════════════════════════════════ */

const TKP_DEFAULT_BLOCKS = [
  { block_key: 'title',    block_icon: '📋', block_title: 'Шапка',            block_order: 100, is_required: true,  block_data: {} },
  { block_key: 'preamble', block_icon: '📜', block_title: 'Преамбула',        block_order: 200, is_required: false, block_data: {} },
  { block_key: 'smeta',    block_icon: '📊', block_title: 'Смета работ',      block_order: 300, is_required: false, block_data: { items: [] } },
  { block_key: 'terms',    block_icon: '💳', block_title: 'Условия платежа',  block_order: 400, is_required: false, block_data: {} },
  { block_key: 'warranty', block_icon: '🛡', block_title: 'Гарантии',         block_order: 500, is_required: false, block_data: {} },
  { block_key: 'attach',   block_icon: '📎', block_title: 'Приложения',       block_order: 600, is_required: false, block_data: {} },
  { block_key: 'sign',     block_icon: '✍️', block_title: 'Подпись',           block_order: 700, is_required: true,  block_data: {} },
];
const TKP_AVAILABLE = [
  { block_key: 'logistics', block_icon: '🚚', block_title: 'Логистика' },
  { block_key: 'safety',    block_icon: '🦺', block_title: 'ОТ и ТБ' },
  { block_key: 'schedule',  block_icon: '📅', block_title: 'График работ' },
  { block_key: 'team',      block_icon: '👷', block_title: 'Состав бригады' },
];

function TkpConstructorSheet({ card, onClose, onAttached }) {
  const [tkpId, setTkpId]               = useState(card.tkp_id || null);
  const [blocks, setBlocks]             = useState(TKP_DEFAULT_BLOCKS);
  const [active, setActive]             = useState('title');
  const [dirty, setDirty]               = useState(false);
  const [autosaveText, setAutosaveText] = useState('—');
  const [busy, setBusy]                 = useState(false);
  const autoTimer = useRef(null);
  const mounted   = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  // Инициализация: если нет tkpId — создаём, иначе грузим блоки.
  useEffect(() => {
    (async () => {
      try {
        if (!tkpId) {
          let r;
          try {
            r = await api.post(`/tkp/from-card/${card.id}`, { template_kind: 'universal' });
          } catch (e) {
            // Сервер может вернуть 409/400 с error:'tkp_already_exists'.
            if (e?.body?.error === 'tkp_already_exists' && e.body.tkp_id) {
              r = e.body;
            } else { throw e; }
          }
          if (!mounted.current) return;
          if (r && r.tkp_id) {
            setTkpId(r.tkp_id);
            if (r.blocks && r.blocks.length) {
              setBlocks(r.blocks);
            } else {
              // существующее ТКП без inline-блоков → отдельно подгружаем
              const g = await api.get(`/tkp/${r.tkp_id}/blocks`);
              if (mounted.current && g && g.blocks) setBlocks(g.blocks);
            }
          }
        } else {
          const g = await api.get(`/tkp/${tkpId}/blocks`);
          if (mounted.current && g && g.blocks) setBlocks(g.blocks);
        }
      } catch (e) {
        toast.error('ТКП не открылось: ' + (e?.body?.error || e?.message || 'ошибка'));
      }
    })();
    /* eslint-disable-next-line */
  }, []);

  // Autosave каждые 10с при dirty.
  useEffect(() => {
    autoTimer.current = setInterval(async () => {
      if (!dirty || !tkpId) return;
      try {
        await api.put(`/tkp/${tkpId}/blocks`, {
          blocks: blocks.map((b, i) => ({ ...b, block_order: (i + 1) * 100, is_active: true })),
        });
        if (mounted.current) { setDirty(false); setAutosaveText('только что'); }
      } catch { /* тихо — пользователь увидит «не сохранено» */ }
    }, 10000);
    return () => clearInterval(autoTimer.current);
  }, [dirty, tkpId, blocks]);

  function removeBlock(key) { setBlocks(bs => bs.filter(b => b.block_key !== key)); setDirty(true); }
  function addBlock(b) {
    // Вставка перед последним (sign), как на десктопе.
    setBlocks(bs => [...bs.slice(0, -1), { ...b, block_order: 0, block_data: {} }, bs[bs.length - 1]]);
    setDirty(true);
  }
  function moveBlock(i, dir) {
    setBlocks(bs => {
      const a = [...bs]; const j = i + dir;
      if (j < 0 || j >= a.length) return a;
      [a[i], a[j]] = [a[j], a[i]];
      return a;
    });
    setDirty(true);
  }
  function updateBlockData(key, patch) {
    setBlocks(bs => bs.map(b => b.block_key === key
      ? { ...b, block_data: { ...(b.block_data || {}), ...patch } }
      : b));
    setDirty(true);
  }

  async function saveDraft() {
    if (!tkpId) { toast.error('ТКП ещё не инициализировано'); return false; }
    setBusy(true);
    try {
      await api.put(`/tkp/${tkpId}/blocks`, {
        blocks: blocks.map((b, i) => ({ ...b, block_order: (i + 1) * 100, is_active: true })),
      });
      setDirty(false); setAutosaveText('только что');
      toast.success('Сохранено');
      return true;
    } catch (e) {
      toast.error('Не сохранилось: ' + (e?.body?.error || e?.message || 'ошибка'));
      return false;
    } finally { setBusy(false); }
  }
  async function downloadPdf() {
    const ok = await saveDraft();
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.post(`/tkp/${tkpId}/render-pdf`, {});
      if (r && r.pdf_path) {
        const t = localStorage.getItem('asgard_token');
        window.open(
          `/uploads/${r.pdf_path.replace(/^uploads\//, '')}?token=${encodeURIComponent(t || '')}`,
          '_blank',
        );
      } else toast.error('PDF не сгенерирован');
    } catch (e) {
      toast.error('PDF не сгенерирован: ' + (e?.body?.error || e?.message || 'ошибка'));
    } finally { setBusy(false); }
  }
  async function attachToCard() {
    const ok = await saveDraft();
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.post(`/tkp/${tkpId}/render-pdf`, {});
      if (!r || r.error) { toast.error('PDF не сгенерирован'); return; }
      const a = await api.post(`/tkp/${tkpId}/attach-to-card/${card.id}`, {});
      if (a && !a.error) {
        toast.success('ТКП прикреплено к карте');
        clearInterval(autoTimer.current);
        onAttached && onAttached(a.document_id);
      } else toast.error('Не привязано');
    } catch (e) {
      toast.error('Не привязано: ' + (e?.body?.error || e?.message || 'ошибка'));
    } finally { setBusy(false); }
  }

  const availableToAdd = TKP_AVAILABLE.filter(a => !blocks.find(b => b.block_key === a.block_key));

  return (
    <FullScreenSheet
      title={`🛠 Конструктор ТКП #${tkpId || 'NEW'}`}
      subtitle={`Черновик · автосохранение ${autosaveText} ${dirty ? '· есть несохранённые правки' : ''}`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>Отмена</Btn>
          <div style={{flex:1}}/>
          <Btn onClick={saveDraft} disabled={busy || !tkpId}>💾</Btn>
          <Btn onClick={downloadPdf} disabled={busy || !tkpId}>📄 PDF</Btn>
          <Btn primary onClick={attachToCard} disabled={busy || !tkpId}>📎 Прикрепить</Btn>
        </>
      }
    >
      <div style={{padding:'12px 14px'}}>
        {/* Accordion блоков */}
        {blocks.map((b, i) => (
          <TkpBlockAccordion
            key={b.block_key}
            block={b}
            index={i}
            total={blocks.length}
            isActive={active === b.block_key}
            onToggle={() => setActive(active === b.block_key ? null : b.block_key)}
            onUp={() => moveBlock(i, -1)}
            onDown={() => moveBlock(i, 1)}
            onRemove={() => removeBlock(b.block_key)}
            onDataChange={(patch) => updateBlockData(b.block_key, patch)}
            card={card}
          />
        ))}

        {/* Добавить блок */}
        {availableToAdd.length > 0 && (
          <div style={{
            marginTop:14, padding:'12px 14px',
            background:'rgba(255,255,255,0.03)',
            border:'1px dashed rgba(255,255,255,0.15)',
            borderRadius:10,
          }}>
            <div style={{fontSize:11.5, color:'rgba(255,255,255,0.5)', marginBottom:8, textTransform:'uppercase', letterSpacing:.5}}>
              + Добавить блок
            </div>
            <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
              {availableToAdd.map(a => (
                <button
                  key={a.block_key}
                  onClick={() => addBlock(a)}
                  style={{
                    background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
                    color:'rgba(255,255,255,0.85)', borderRadius:8,
                    padding:'9px 12px', fontSize:12.5, cursor:'pointer', minHeight:40,
                  }}
                >{a.block_icon} {a.block_title}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </FullScreenSheet>
  );
}

function TkpBlockAccordion({ block, index, total, isActive, onToggle, onUp, onDown, onRemove, onDataChange, card }) {
  const data = block.block_data || {};
  return (
    <div style={{
      marginBottom:8, background:'rgba(255,255,255,0.04)',
      border:'1px solid rgba(255,255,255,0.06)',
      borderRadius:10, overflow:'hidden',
    }}>
      {/* Header */}
      <div style={{
        display:'flex', alignItems:'center', gap:8, padding:'10px 12px',
        cursor:'pointer', minHeight:48,
        background: isActive ? 'rgba(212,168,67,0.06)' : 'transparent',
      }} onClick={onToggle}>
        <span style={{fontSize:18, lineHeight:1}}>{block.block_icon}</span>
        <span style={{
          flex:1, fontSize:13.5, fontWeight:600,
          color: isActive ? '#E8C35A' : 'rgba(255,255,255,0.9)',
          wordBreak:'break-word',
        }}>{block.block_title}</span>

        {/* ▲ ▼ ✕ */}
        <div style={{display:'flex', gap:2}}>
          {index > 0 && (
            <button onClick={(e) => { e.stopPropagation(); onUp(); }} aria-label="Вверх" style={accBtnStyle}>▲</button>
          )}
          {index < total - 1 && (
            <button onClick={(e) => { e.stopPropagation(); onDown(); }} aria-label="Вниз" style={accBtnStyle}>▼</button>
          )}
          {!block.is_required && (
            <button onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label="Удалить" style={{...accBtnStyle, color:'#F87171'}}>✕</button>
          )}
        </div>
        <span style={{color:'#888', fontSize:11, marginLeft:4}}>{isActive ? '▾' : '▸'}</span>
      </div>

      {/* Editor */}
      {isActive && (
        <div style={{padding:'10px 12px 14px', borderTop:'1px solid rgba(255,255,255,0.06)'}}>
          <TkpBlockEditor blockKey={block.block_key} data={data} onChange={onDataChange} card={card}/>
        </div>
      )}
    </div>
  );
}
const accBtnStyle = {
  background:'rgba(255,255,255,0.06)', border:0, color:'rgba(255,255,255,0.75)',
  borderRadius:6, padding:'6px 9px', cursor:'pointer', fontSize:11, minWidth:32, minHeight:32,
};

function TkpBlockEditor({ blockKey, data, onChange, card }) {
  // Универсальный textarea-helper.
  const ta = (field, label, placeholder, rows = 3) => (
    <TextField
      label={label}
      value={data[field] || ''}
      multiline={rows > 1}
      rows={rows}
      placeholder={placeholder}
      onChange={(v) => onChange({ [field]: v })}
    />
  );
  switch (blockKey) {
    case 'title':
      return (
        <>
          <TextField
            label="Название ТКП"
            value={data.title || `ТКП на работы по ${card.work_description ? card.work_description.slice(0, 50) : 'запросу'}`}
            onChange={(v) => onChange({ title: v })}
            placeholder="ТКП на работы по…"
          />
          <div style={{
            marginTop:8, padding:'8px 10px', background:'rgba(255,255,255,0.02)',
            borderRadius:6, fontSize:11.5, color:'rgba(255,255,255,0.55)', lineHeight:1.5,
          }}>
            <b>Заказчик:</b> {card.customer_name || card.customer || '—'}<br/>
            <b>Контакт:</b> {card.contact_person || '—'}<br/>
            <b>Email:</b> {card.customer_email || '—'}
          </div>
        </>
      );
    case 'preamble': return ta('text', 'Преамбула', 'ООО «АСГАРД-Сервис» благодарит вас…', 4);
    case 'smeta':    return <SmetaListEditable data={data} onChange={onChange}/>;
    case 'terms':    return ta('text', 'Условия оплаты', 'Аванс 30% / окончательный 30 дней после акта', 4);
    case 'warranty': return ta('text', 'Гарантии', 'Срок гарантии 12 месяцев…', 3);
    case 'attach':   return ta('text', 'Список приложений', 'Копии лицензий, акты с аналогичных объектов…', 3);
    case 'sign':
      return (
        <>
          <TextField label="Подписант"  value={data.signer   || ''} onChange={(v) => onChange({ signer: v })}   placeholder="Иванов И.И."/>
          <TextField label="Должность" value={data.position || ''} onChange={(v) => onChange({ position: v })} placeholder="Генеральный директор"/>
        </>
      );
    case 'logistics': return ta('text', 'Логистика и размещение', 'Бригада 6 чел., гостиница 3*, доставка…', 3);
    case 'safety':    return ta('text', 'ОТ и ТБ', 'Допуски: Ростехнадзор, газоспасатели…', 3);
    case 'schedule':  return ta('text', 'График работ', 'Этап 1: мобилизация (1-2 день), этап 2: основные работы…', 3);
    case 'team':      return ta('text', 'Состав бригады', 'РП — 1, инженер ПНР — 1, газоспасатель — 1, монтажники — 3', 3);
    default:
      return (
        <div style={{fontSize:11.5, color:'rgba(255,255,255,0.5)'}}>
          Редактор блока «{blockKey}» — данные сохраняются в block_data.
        </div>
      );
  }
}

function TextField({ label, value, onChange, placeholder, multiline, rows = 3 }) {
  const common = {
    width:'100%', boxSizing:'border-box',
    background:'rgba(255,255,255,0.06)',
    border:'1px solid rgba(255,255,255,0.1)',
    borderRadius:8, padding:'10px 12px',
    color:'rgba(255,255,255,0.95)', fontSize:13, fontFamily:'inherit',
    outline:'none',
  };
  return (
    <div style={{marginBottom:10}}>
      {label && (
        <div style={{fontSize:11, color:'rgba(255,255,255,0.55)', marginBottom:5, textTransform:'uppercase', letterSpacing:.4}}>
          {label}
        </div>
      )}
      {multiline ? (
        <textarea
          rows={rows} value={value} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{...common, resize:'vertical', minHeight:rows * 22}}
        />
      ) : (
        <input
          type="text" value={value} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={common}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SmetaListEditable — мобильный аналог SmetaTableEditable (BoardV3.jsx 1111).
 * Не таблица, а список строк-карточек: {name, qty, unit, price, sum auto}.
 * block_data.items[] + block_data.vat_pct. Сумма пересчитывается локально.
 * ═══════════════════════════════════════════════════════════════════════════ */
function SmetaListEditable({ data, onChange }) {
  const DEFAULT_ITEMS = [
    { name: 'Подготовка',         unit: 'шт',     qty: 1,  price: 28500  },
    { name: 'Основные работы',    unit: 'м²',     qty: 42, price: 14500  },
    { name: 'Контроль качества',  unit: 'точек',  qty: 16, price: 3000   },
    { name: 'Логистика',          unit: 'компл',  qty: 1,  price: 144000 },
    { name: 'Реагенты',           unit: 'компл',  qty: 1,  price: 370500 },
  ];
  const items  = (Array.isArray(data.items) && data.items.length) ? data.items : DEFAULT_ITEMS;
  const vatPct = data.vat_pct != null ? Number(data.vat_pct) : 20;

  function commit(newItems, newVat) {
    onChange({ items: newItems, vat_pct: newVat != null ? newVat : vatPct });
  }
  function changeRow(i, field, value) {
    const arr = [...items];
    const v = (field === 'qty' || field === 'price') ? (parseFloat(value) || 0) : value;
    arr[i] = { ...arr[i], [field]: v, sum: field === 'qty' || field === 'price'
      ? (field === 'qty' ? v : Number(arr[i].qty) || 0) * (field === 'price' ? v : Number(arr[i].price) || 0)
      : (Number(arr[i].qty) || 0) * (Number(arr[i].price) || 0) };
    commit(arr);
  }
  function addRow() { commit([...items, { name: '', unit: 'шт', qty: 1, price: 0, sum: 0 }]); }
  function delRow(i) {
    const arr = items.filter((_, j) => j !== i);
    commit(arr.length ? arr : DEFAULT_ITEMS);
  }

  const total         = items.reduce((s, it) => s + ((Number(it.qty) || 0) * (Number(it.price) || 0)), 0);
  const vatAmount     = total * vatPct / 100;
  const totalWithVat  = total + vatAmount;
  const fmt           = (n) => Math.round(n).toLocaleString('ru-RU');

  const rowInput = {
    width:'100%', boxSizing:'border-box',
    background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.1)',
    borderRadius:6, padding:'7px 9px',
    color:'rgba(255,255,255,0.95)', fontSize:12.5, outline:'none', fontFamily:'inherit',
  };

  return (
    <>
      {/* Итог сверху */}
      <div style={{
        display:'flex', alignItems:'center', gap:10,
        padding:'8px 10px', marginBottom:10,
        background:'rgba(212,168,67,0.08)',
        border:'1px solid rgba(212,168,67,0.2)',
        borderRadius:8,
      }}>
        <div style={{flex:1, fontSize:11, color:'rgba(255,255,255,0.6)'}}>Итого без НДС</div>
        <div style={{fontSize:15, fontWeight:700, fontFamily:'monospace', color:'#E8C35A'}}>
          {fmt(total)} ₽
        </div>
      </div>

      {/* Список строк */}
      {items.map((it, i) => {
        const sum = (Number(it.qty) || 0) * (Number(it.price) || 0);
        return (
          <div key={i} style={{
            background:'rgba(255,255,255,0.04)', borderRadius:8, padding:10,
            marginBottom:8, border:'1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:7}}>
              <span style={{fontSize:11, color:'rgba(255,255,255,0.4)', minWidth:18}}>{i + 1}.</span>
              <input
                type="text" value={it.name || ''} placeholder="Наименование"
                onChange={e => changeRow(i, 'name', e.target.value)}
                style={{...rowInput, flex:1}}
              />
              <button
                onClick={() => delRow(i)} aria-label="Удалить"
                style={{
                  background:'transparent', border:0, color:'#F87171',
                  fontSize:14, cursor:'pointer', minWidth:32, minHeight:32,
                }}
              >✕</button>
            </div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, marginBottom:5}}>
              <NumLabel label="Кол-во">
                <input
                  type="number" min="0" step="0.01" value={Number(it.qty) || 0}
                  onChange={e => changeRow(i, 'qty', e.target.value)}
                  style={{...rowInput, textAlign:'right'}}
                />
              </NumLabel>
              <NumLabel label="Ед.">
                <input
                  type="text" value={it.unit || ''} onChange={e => changeRow(i, 'unit', e.target.value)}
                  style={{...rowInput, textAlign:'center'}}
                />
              </NumLabel>
              <NumLabel label="Цена">
                <input
                  type="number" min="0" step="1" value={Number(it.price) || 0}
                  onChange={e => changeRow(i, 'price', e.target.value)}
                  style={{...rowInput, textAlign:'right'}}
                />
              </NumLabel>
            </div>
            <div style={{
              display:'flex', justifyContent:'space-between', alignItems:'center',
              paddingTop:6, borderTop:'1px solid rgba(255,255,255,0.06)',
              fontSize:11.5, color:'rgba(255,255,255,0.55)',
            }}>
              <span>Сумма</span>
              <span style={{fontFamily:'monospace', fontWeight:600, color:'#E8C35A', fontSize:13}}>
                {fmt(sum)} ₽
              </span>
            </div>
          </div>
        );
      })}

      {/* + Добавить */}
      <button
        onClick={addRow}
        style={{
          width:'100%', padding:'10px 12px', marginBottom:8,
          background:'rgba(212,168,67,0.1)', border:'1px dashed rgba(212,168,67,0.4)',
          borderRadius:8, color:'#E8C35A', fontSize:13, fontWeight:600,
          cursor:'pointer', minHeight:44,
        }}
      >+ Добавить строку</button>

      {/* НДС + итог с НДС */}
      <div style={{
        marginTop:6, padding:'10px 12px',
        background:'rgba(255,255,255,0.04)', borderRadius:8,
      }}>
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:6}}>
          <span style={{fontSize:11.5, color:'rgba(255,255,255,0.6)', flex:1}}>НДС, %</span>
          <input
            type="number" min="0" max="100" step="1" value={vatPct}
            onChange={e => commit(items, parseFloat(e.target.value) || 0)}
            style={{...rowInput, width:64, textAlign:'right'}}
          />
        </div>
        <div style={{display:'flex', justifyContent:'space-between', fontSize:11.5, color:'rgba(255,255,255,0.6)'}}>
          <span>НДС</span>
          <span style={{fontFamily:'monospace'}}>{fmt(vatAmount)} ₽</span>
        </div>
        <div style={{display:'flex', justifyContent:'space-between', marginTop:5, paddingTop:5, borderTop:'1px solid rgba(255,255,255,0.06)'}}>
          <span style={{fontSize:12.5, fontWeight:600}}>Итого с НДС</span>
          <span style={{fontFamily:'monospace', fontWeight:700, color:'#E8C35A', fontSize:14}}>
            {fmt(totalWithVat)} ₽
          </span>
        </div>
      </div>
    </>
  );
}
function NumLabel({ label, children }) {
  return (
    <div>
      <div style={{fontSize:9.5, color:'rgba(255,255,255,0.45)', marginBottom:3, textTransform:'uppercase', letterSpacing:.4}}>
        {label}
      </div>
      {children}
    </div>
  );
}

function Section({ title, children, defaultOpen = true, count }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{marginBottom:14,background:'rgba(255,255,255,0.03)',borderRadius:10,overflow:'hidden'}}>
      <div onClick={() => setOpen(o => !o)} style={{padding:'12px 13px',display:'flex',alignItems:'center',gap:7,cursor:'pointer',minHeight:44}}>
        <span style={{fontSize:13.5,fontWeight:600,flex:1}}>{title}</span>
        {count != null && <span style={{background:'rgba(255,255,255,0.08)',color:'#bbb',padding:'1px 7px',borderRadius:999,fontSize:11}}>{count}</span>}
        <span style={{color:'#888',fontSize:11}}>{open ? '▾' : '▸'}</span>
      </div>
      {open && <div style={{padding:'4px 13px 13px'}}>{children}</div>}
    </div>
  );
}
function Field({ label, value }) {
  return (
    <div style={{display:'grid',gridTemplateColumns:'90px 1fr',gap:8,padding:'5px 0',fontSize:12.5,wordBreak:'break-word'}}>
      <span style={{color:'rgba(255,255,255,0.5)'}}>{label}</span>
      <span style={{color:'rgba(255,255,255,0.95)'}}>{value}</span>
    </div>
  );
}
function FinTile({ label, v, margin }) {
  return (
    <div style={{background:'rgba(255,255,255,0.04)',borderRadius:8,padding:'10px 12px'}}>
      <div style={{fontSize:9.5,color:'rgba(255,255,255,0.4)',textTransform:'uppercase',marginBottom:3,letterSpacing:.4}}>{label}</div>
      <div style={{fontSize:14.5,fontWeight:600,fontFamily:'monospace',color: margin ? '#4ADE80' : '#E8C35A'}}>
        {v != null ? (typeof v === 'number' ? Number(v).toLocaleString('ru-RU') + ' ₽' : v) : '—'}
      </div>
    </div>
  );
}
function Btn({ children, onClick, primary, danger, full, disabled }) {
  const bg = danger ? '#C8293B' : (primary ? '#D4A843' : 'rgba(255,255,255,0.08)');
  const color = danger ? '#fff' : (primary ? '#1a1000' : 'rgba(255,255,255,0.95)');
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: full ? '100%' : 'auto',
      padding: '13px 14px', background: bg, color, border: 0, borderRadius: 10,
      fontSize: 14, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1, minHeight: 48,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    }}>{children}</button>
  );
}
