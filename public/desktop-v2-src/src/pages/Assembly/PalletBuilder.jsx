/**
 * PalletBuilder — drag&drop сборки палет с эффектами.
 *
 * Источник: vanilla `public/assets/js/assembly-dnd.js` (605).
 *
 * Реализовано:
 *   • HTML5 drag (desktop) + Pointer-events drag (mobile / touch)
 *   • FLIP-анимация (First-Last-Invert-Play) при перемещении позиций
 *   • Ripple-эффект клика по карточке (см. PalletItem.jsx)
 *   • Drop-ripple на палете в точке падения
 *   • Web Audio thud-звук (60Hz sine + 200Hz click) при успешном drop
 *   • Capacity-overfill: пульсирующая красная рамка + shake + warning-toast
 *   • Ghost cursor: полупрозрачный preview-элемент следует за курсором
 *     (HTML5 — `dataTransfer.setDragImage`, touch — DOM-элемент position:fixed)
 *   • Stretch-film overlay + штамп «УПАКОВАНО» для статуса packed
 *   • «Wooden pallets» background: CSS gradient + tile-pattern + light wood texture
 *   • + Новый палет / редактирование capacity inline / 🗑 удалить пустой
 *
 * Backend (см. src/routes/assembly.js, prefix /api/assembly):
 *   PUT  /:id/items/:itemId/assign-pallet      — назначить
 *   PUT  /:id/items/:itemId/unassign-pallet    — снять
 *   POST /:id/pallets                          — создать
 *   DELETE /:id/pallets/:pid                   — удалить
 *   PUT  /:id/pallets/:pid                     — обновить (label/capacity)
 *   PUT  /:id/pallets/:pid/pack                — упаковать (stretch film)
 *   PUT  /:id/items/:itemId/return-status      — статус возврата (demob)
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useModal, ConfirmModal, PromptModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import {
  assignPallet, unassignPallet, createPallet, deletePallet, packPallet,
  setReturnStatus
} from './api';
import { api } from '@/api/client';
import { PalletItem, getSourceMeta, SOURCE_COLORS_MAP } from './PalletItem';
import './assembly-dnd.css';

// ── Web Audio context (singleton) ─────────────────────────────
let _audioCtx = null;
function playThud() {
  try {
    if (!_audioCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      _audioCtx = new Ctor();
    }
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) { /* noop */ } }

    // deep thud
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2);

    // click overlay
    const click = ctx.createOscillator();
    const cg = ctx.createGain();
    click.type = 'square';
    click.frequency.setValueAtTime(200, ctx.currentTime);
    click.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.05);
    cg.gain.setValueAtTime(0.15, ctx.currentTime);
    cg.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    click.connect(cg); cg.connect(ctx.destination);
    click.start(ctx.currentTime); click.stop(ctx.currentTime + 0.08);
  } catch (_) { /* audio not supported */ }
}

// ── HTML-canvas для setDragImage (полупрозрачный ghost) ───────
function makeDragGhostCanvas(text, color) {
  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  const w = 220, h = 32;
  canvas.width  = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width  = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = 'rgba(20, 22, 26, 0.85)';
  ctx.strokeStyle = '#d4a13c';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(0.5, 0.5, w - 1, h - 1, 6);
  else ctx.rect(0.5, 0.5, w - 1, h - 1);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = color || '#d4a13c';
  ctx.beginPath();
  ctx.arc(14, h / 2, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e3e6ed';
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const maxText = text.length > 26 ? text.slice(0, 25) + '…' : text;
  ctx.fillText(maxText, 26, h / 2);
  return canvas;
}

/**
 * @param {{
 *   assemblyId: number,
 *   items: Array,
 *   pallets: Array,
 *   canEdit: boolean,
 *   isDemob?: boolean,
 *   onChanged: () => void
 * }} props
 */
export function PalletBuilder({ assemblyId, items, pallets, canEdit, isDemob = false, onChanged }) {
  const { open } = useModal();
  const rootRef = useRef(null);
  const ghostElRef = useRef(null);          // HTML5 ghost-canvas
  const touchGhostRef = useRef(null);       // touch / pointer ghost (DOM)
  const flipMapRef = useRef(new Map());     // FLIP positions cache
  const [pendingAssign, setPendingAssign] = useState(null); // optimistic state during async
  const [returnMenu, setReturnMenu] = useState(null); // {x,y,itemId,current}

  // эффективный список (учитывает оптимистичный pallet_id)
  const effItems = items.map((it) => {
    if (pendingAssign && pendingAssign.itemId === it.id) {
      return { ...it, pallet_id: pendingAssign.palletId };
    }
    return it;
  });

  // ── FLIP capture before render ──────────────────────────────
  // Snapshot positions before list changes (called before optimistic update)
  const captureFlip = useCallback(() => {
    const m = new Map();
    if (!rootRef.current) return m;
    rootRef.current.querySelectorAll('[data-iid]').forEach((el) => {
      m.set(el.dataset.iid, el.getBoundingClientRect());
    });
    flipMapRef.current = m;
    return m;
  }, []);

  // After render — play FLIP transition
  useEffect(() => {
    const prev = flipMapRef.current;
    if (!prev || !prev.size || !rootRef.current) return;
    const els = rootRef.current.querySelectorAll('[data-iid]');
    requestAnimationFrame(() => {
      els.forEach((el) => {
        const old = prev.get(el.dataset.iid);
        if (!old) return;
        const cur = el.getBoundingClientRect();
        const dx = old.left - cur.left;
        const dy = old.top - cur.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        el.style.transform = `translate(${dx}px,${dy}px)`;
        el.style.transition = 'none';
        requestAnimationFrame(() => {
          el.classList.add('vpb__flip');
          el.style.transform = '';
          el.style.transition = '';
          const onEnd = () => {
            el.classList.remove('vpb__flip');
            el.removeEventListener('transitionend', onEnd);
          };
          el.addEventListener('transitionend', onEnd);
        });
      });
      flipMapRef.current = new Map();
    });
  });

  // ── Capacity helpers ────────────────────────────────────────
  const isOverCapacity = useCallback((palletId) => {
    const p = pallets.find((x) => x.id === palletId);
    if (!p?.capacity_items) return false;
    const cnt = effItems.filter((i) => i.pallet_id === palletId).length;
    return cnt >= p.capacity_items;
  }, [pallets, effItems]);

  const triggerShake = useCallback((palletId) => {
    const el = rootRef.current?.querySelector(`[data-pid="${palletId}"]`);
    if (!el) return;
    el.classList.remove('is-shake');
    // force reflow to re-trigger animation
    void el.offsetWidth;
    el.classList.add('is-shake');
    setTimeout(() => el.classList.remove('is-shake'), 600);
  }, []);

  const popCount = useCallback((palletId) => {
    const el = rootRef.current?.querySelector(`[data-pcnt="${palletId}"]`);
    if (el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    const pool = rootRef.current?.querySelector('#vpb-pool-n');
    if (pool) { pool.classList.remove('pop'); void pool.offsetWidth; pool.classList.add('pop'); }
  }, []);

  // ── Server actions ──────────────────────────────────────────
  const doAssign = useCallback(async (itemId, palletId, dropPoint) => {
    if (!canEdit) return;
    if (isOverCapacity(palletId)) {
      triggerShake(palletId);
      toast.warn(`Палет переполнен (максимум ${pallets.find((p) => p.id === palletId)?.capacity_items} поз.)`);
      return;
    }
    // drop ripple at exact pointer position
    const palletEl = rootRef.current?.querySelector(`[data-pid="${palletId}"]`);
    if (palletEl && dropPoint) {
      const rect = palletEl.getBoundingClientRect();
      const rip = document.createElement('span');
      rip.className = 'vpb__ripple';
      rip.style.left = (dropPoint.x - rect.left) + 'px';
      rip.style.top  = (dropPoint.y - rect.top)  + 'px';
      palletEl.appendChild(rip);
      rip.addEventListener('animationend', () => rip.remove(), { once: true });
    }
    captureFlip();
    setPendingAssign({ itemId, palletId });
    playThud();
    popCount(palletId);
    try {
      await assignPallet(assemblyId, itemId, palletId);
      setPendingAssign(null);
      if (onChanged) onChanged();
    } catch (e) {
      setPendingAssign(null);
      toast.error('Не удалось переместить: ' + (e?.message || e));
    }
  }, [assemblyId, canEdit, captureFlip, isOverCapacity, onChanged, pallets, popCount, triggerShake]);

  const doUnassign = useCallback(async (itemId) => {
    if (!canEdit) return;
    captureFlip();
    setPendingAssign({ itemId, palletId: null });
    try {
      await unassignPallet(assemblyId, itemId);
      setPendingAssign(null);
      if (onChanged) onChanged();
    } catch (e) {
      setPendingAssign(null);
      toast.error('Не удалось снять: ' + (e?.message || e));
    }
  }, [assemblyId, canEdit, captureFlip, onChanged]);

  // ── HTML5 drag handlers ─────────────────────────────────────
  const onItemDragStart = useCallback((e, itemId) => {
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(itemId));
    e.target.classList.add('is-dragging');
    // полупрозрачный canvas ghost
    const src = getSourceMeta(it.source);
    const canvas = makeDragGhostCanvas(it.name + ' · ' + it.quantity + ' ' + (it.unit || 'шт'), src.c);
    // canvas должен быть в DOM на момент setDragImage в некоторых браузерах
    canvas.style.position = 'fixed';
    canvas.style.top = '-9999px';
    canvas.style.left = '-9999px';
    canvas.style.opacity = '0.85';
    document.body.appendChild(canvas);
    ghostElRef.current = canvas;
    try { e.dataTransfer.setDragImage(canvas, 16, 16); } catch (_) { /* noop */ }
  }, [items]);

  const onItemDragEnd = useCallback((e, _itemId) => {
    e.target.classList.remove('is-dragging');
    if (ghostElRef.current) {
      ghostElRef.current.remove();
      ghostElRef.current = null;
    }
    rootRef.current?.querySelectorAll('.is-over').forEach((x) => x.classList.remove('is-over'));
  }, []);

  // ── Pointer-events touch drag ───────────────────────────────
  const onPointerDragStart = useCallback((startEvt, itemId) => {
    if (!canEdit) return;
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    const src = getSourceMeta(it.source);
    const startX = startEvt.clientX, startY = startEvt.clientY;
    let started = false;
    let ghost = null;
    const sourceEl = startEvt.currentTarget;

    const ensureGhost = () => {
      if (ghost) return;
      ghost = document.createElement('div');
      ghost.className = 'vpb__ghost';
      ghost.innerHTML =
        `<span class="vpb__ghost-dot" style="background:${src.c}"></span>` +
        `<span>${escapeHtml(it.name)}</span>` +
        `<span class="vpb__ghost-qty">${it.quantity} ${escapeHtml(it.unit || 'шт')}</span>`;
      document.body.appendChild(ghost);
      touchGhostRef.current = ghost;
      sourceEl.classList.add('is-dragging');
    };

    const onMove = (ev) => {
      if (!started && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 10) {
        started = true;
        ensureGhost();
      }
      if (!started) return;
      if (ghost) {
        ghost.style.left = (ev.clientX + 14) + 'px';
        ghost.style.top  = (ev.clientY - 14) + 'px';
      }
      // подсветка целевого паллета
      rootRef.current?.querySelectorAll('.vpb__pallet:not(.is-packed)').forEach((p) => {
        const r = p.getBoundingClientRect();
        const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
        p.classList.toggle('is-over', inside);
      });
      const pool = rootRef.current?.querySelector('#vpb-pool');
      if (pool) {
        const r = pool.getBoundingClientRect();
        const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
        pool.classList.toggle('is-over', inside);
      }
    };

    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      sourceEl.classList.remove('is-dragging');
      if (ghost) { ghost.remove(); touchGhostRef.current = null; }
      if (!started) return;

      const target = rootRef.current?.querySelector('.vpb__pallet.is-over');
      rootRef.current?.querySelectorAll('.is-over').forEach((x) => x.classList.remove('is-over'));

      if (target) {
        const pid = +target.dataset.pid;
        if (pid && it.pallet_id !== pid) {
          doAssign(it.id, pid, { x: ev.clientX, y: ev.clientY });
        }
      } else {
        const pool = rootRef.current?.querySelector('#vpb-pool');
        if (pool && it.pallet_id) {
          const r = pool.getBoundingClientRect();
          if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
            doUnassign(it.id);
          }
        }
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }, [canEdit, doAssign, doUnassign, items]);

  // ── Drop zone handlers ──────────────────────────────────────
  const onZoneDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const onZoneDragEnter = (e) => {
    e.preventDefault();
    const zone = e.currentTarget;
    zone.classList.add('is-over');
  };
  const onZoneDragLeave = (e) => {
    const zone = e.currentTarget;
    const r = zone.getBoundingClientRect();
    if (e.clientX <= r.left || e.clientX >= r.right || e.clientY <= r.top || e.clientY >= r.bottom) {
      zone.classList.remove('is-over');
    }
  };
  const onPalletDrop = (e, palletId) => {
    e.preventDefault();
    const zone = e.currentTarget;
    zone.classList.remove('is-over');
    const itemId = +e.dataTransfer.getData('text/plain');
    if (!itemId || !palletId) return;
    const it = items.find((x) => x.id === itemId);
    if (!it || it.pallet_id === palletId) return;
    doAssign(itemId, palletId, { x: e.clientX, y: e.clientY });
  };
  const onPoolDrop = (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('is-over');
    const itemId = +e.dataTransfer.getData('text/plain');
    if (!itemId) return;
    const it = items.find((x) => x.id === itemId);
    if (!it?.pallet_id) return;
    doUnassign(itemId);
  };

  // ── Pallet actions ──────────────────────────────────────────
  const onAddPallet = () => {
    open(
      <PromptModal
        title="Новое паллетоместо"
        label="Метка (опц.)"
        placeholder="Хрупкое, Тяжёлое…"
        required={false}
        okText="Далее →"
        onSubmit={(label) => {
          open(
            <PromptModal
              title="Вместимость, позиций"
              label="Максимум позиций"
              placeholder="например 12 (пусто = без лимита)"
              required={false}
              okText="✓ Создать"
              onSubmit={async (cap) => {
                const capNum = cap && /^\d+$/.test(cap.trim()) ? Number(cap.trim()) : null;
                try {
                  await createPallet(assemblyId, {
                    label: label || null,
                    capacity_items: capNum
                  });
                  toast.success('Палет создан');
                  if (onChanged) onChanged();
                } catch (e) {
                  toast.error('Не удалось: ' + (e?.message || e));
                }
              }}
            />
          );
        }}
      />
    );
  };

  const onPackPallet = (p, count) => {
    open(
      <ConfirmModal
        tone="warn"
        title={`Обмотать стретчем и упаковать палет №${p.pallet_number}?`}
        message={`${count} поз. на палете. После упаковки изменить состав нельзя.`}
        okText="🎞️ Упаковать"
        onConfirm={async () => {
          try {
            await packPallet(assemblyId, p.id);
            playThud();
            toast.success('Палет упакован');
            if (onChanged) onChanged();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onDeletePallet = (p, count) => {
    if (count > 0) {
      toast.warn('Сначала уберите позиции с палета');
      return;
    }
    open(
      <ConfirmModal
        tone="danger"
        title={`Удалить пустой палет №${p.pallet_number}?`}
        message="Действие необратимо."
        okText="🗑 Удалить"
        onConfirm={async () => {
          try {
            await deletePallet(assemblyId, p.id);
            toast.success('Удалён');
            if (onChanged) onChanged();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onChangeCapacity = async (p, newCapStr) => {
    const cleaned = newCapStr === '' ? null : (/^\d+$/.test(String(newCapStr).trim()) ? Number(newCapStr) : undefined);
    if (cleaned === undefined) {
      toast.warn('Введите целое число или оставьте пустым');
      return;
    }
    try {
      await api(`/api/assembly/${assemblyId}/pallets/${p.id}`, {
        method: 'PUT',
        body: { capacity_items: cleaned }
      });
      if (onChanged) onChanged();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    }
  };

  // ── Return status menu (demob only) ─────────────────────────
  const openReturnMenu = (anchorEl, itemId) => {
    const rect = anchorEl.getBoundingClientRect();
    const it = items.find((x) => x.id === itemId);
    setReturnMenu({
      x: rect.left,
      y: rect.bottom + 4,
      itemId,
      current: it?.return_status || 'returning'
    });
  };

  useEffect(() => {
    if (!returnMenu) return;
    const close = (e) => {
      const m = document.querySelector('.vpb__ret-menu');
      if (m && m.contains(e.target)) return;
      setReturnMenu(null);
    };
    const t = setTimeout(() => document.addEventListener('click', close), 30);
    return () => { clearTimeout(t); document.removeEventListener('click', close); };
  }, [returnMenu]);

  const applyReturnStatus = async (itemId, status) => {
    let reason = null;
    if (status === 'damaged' || status === 'lost') {
      reason = window.prompt(status === 'damaged' ? 'Что сломано / почему?' : 'Где утеряно?');
      if (!reason) { toast.warn('Причина обязательна'); return; }
    }
    try {
      await setReturnStatus(assemblyId, itemId, { return_status: status, return_reason: reason });
      setReturnMenu(null);
      if (onChanged) onChanged();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    }
  };

  // cleanup ghost on unmount
  useEffect(() => () => {
    if (ghostElRef.current) { ghostElRef.current.remove(); ghostElRef.current = null; }
    if (touchGhostRef.current) { touchGhostRef.current.remove(); touchGhostRef.current = null; }
  }, []);

  // ══════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════
  const freeItems = effItems.filter((i) => !i.pallet_id && !i.packed);
  const itemsOf   = (pid) => effItems.filter((i) => i.pallet_id === pid);

  return (
    <div ref={rootRef}>
      {/* Legend */}
      <div className="vpb__legend">
        {Object.entries(SOURCE_COLORS_MAP).map(([k, v]) => (
          <span key={k} className="vpb__legend-item">
            <span className="vpb__legend-dot" style={{ background: v.c }} />
            {v.l}
          </span>
        ))}
      </div>

      <div className="vpb">
        {/* ── Pool ─────────────────────────────────────────── */}
        <div
          id="vpb-pool"
          className="vpb__pool"
          onDragOver={canEdit ? onZoneDragOver : undefined}
          onDragEnter={canEdit ? onZoneDragEnter : undefined}
          onDragLeave={canEdit ? onZoneDragLeave : undefined}
          onDrop={canEdit ? onPoolDrop : undefined}
        >
          <div className="vpb__pool-head">
            <span>Неразмещённые</span>
            <span id="vpb-pool-n" className="vpb__pool-badge">{freeItems.length}</span>
          </div>
          {freeItems.length === 0 ? (
            <div className="vpb__pool-empty">
              <svg viewBox="0 0 56 56" fill="none">
                <rect x="8" y="18" width="40" height="30" rx="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
                <path d="M22 38l6-6 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="28" cy="44" r="1.5" fill="currentColor" />
              </svg>
              <span>Всё на палетах ✓</span>
            </div>
          ) : (
            freeItems.map((it) => (
              <PalletItem
                key={it.id}
                item={it}
                variant="card"
                draggable={canEdit && !it.packed}
                isDemob={isDemob}
                onDragStart={onItemDragStart}
                onDragEnd={onItemDragEnd}
                onPointerDragStart={onPointerDragStart}
              />
            ))
          )}
        </div>

        {/* ── Pallets ──────────────────────────────────────── */}
        <div className="vpb__pallets">
          {pallets.map((p) => {
            const pIt = itemsOf(p.id);
            const packed = ['packed', 'shipped', 'received'].includes(p.status);
            const cap = p.capacity_items;
            let fillPct = 0, capState = '';
            if (cap) {
              fillPct = Math.round((pIt.length / cap) * 100);
              if (fillPct >= 100) capState = pIt.length > cap ? 'overfill' : 'full';
              else if (fillPct >= 80) capState = 'warning';
            } else {
              fillPct = Math.min(95, Math.round((pIt.length / 8) * 100));
            }
            const palletCls = [
              'vpb__pallet',
              packed ? 'is-packed' : '',
              capState ? 'is-' + capState : ''
            ].filter(Boolean).join(' ');
            return (
              <div
                key={p.id}
                className={palletCls}
                data-pid={p.id}
                onDragOver={canEdit && !packed ? onZoneDragOver : undefined}
                onDragEnter={canEdit && !packed ? onZoneDragEnter : undefined}
                onDragLeave={canEdit && !packed ? onZoneDragLeave : undefined}
                onDrop={canEdit && !packed ? (e) => onPalletDrop(e, p.id) : undefined}
              >
                {/* Шапка */}
                <div className="vpb__pallet-head">
                  <div>
                    <div className="vpb__pallet-num">№{p.pallet_number}</div>
                    {p.label && <div className="vpb__pallet-lbl">{p.label}</div>}
                  </div>
                  <div className="vpb__pallet-tools">
                    {cap !== null && cap !== undefined && canEdit && !packed ? (
                      <CapacityEditor value={cap} onCommit={(v) => onChangeCapacity(p, v)} />
                    ) : null}
                    {canEdit && !packed && pIt.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onPackPallet(p, pIt.length)}
                        title="Обмотать стретчем и упаковать"
                      >🎞️</button>
                    )}
                    {canEdit && !packed && pIt.length === 0 && (
                      <button
                        type="button"
                        onClick={() => onDeletePallet(p, 0)}
                        title="Удалить пустой палет"
                      >🗑</button>
                    )}
                  </div>
                </div>

                {/* Capacity бейдж */}
                {cap !== null && cap !== undefined ? (
                  <div className={'vpb__cap ' + (capState === 'overfill' || capState === 'full' ? 'vpb__cap-full' : capState === 'warning' ? 'vpb__cap-warn' : '')}>
                    {pIt.length}/{cap} поз.
                    {capState === 'full' && ' — ПОЛНЫЙ'}
                    {capState === 'overfill' && ' — ПЕРЕГРУЗ!'}
                    {capState === 'warning' && ' — почти полный'}
                  </div>
                ) : null}

                {/* Стопка позиций */}
                <div className="vpb__pallet-items">
                  {pIt.length === 0 && !packed ? (
                    <div style={{ fontSize: 11, color: '#f5e0b5', opacity: 0.55, textAlign: 'center', padding: '8px 0' }}>
                      Перетащите позицию сюда
                    </div>
                  ) : (
                    pIt.map((it, idx) => (
                      <PalletItem
                        key={it.id}
                        item={it}
                        variant="stacked"
                        stackIdx={idx}
                        draggable={canEdit && !packed}
                        isDemob={isDemob}
                        onDragStart={onItemDragStart}
                        onDragEnd={onItemDragEnd}
                        onPointerDragStart={onPointerDragStart}
                        onUnassign={canEdit && !packed ? doUnassign : undefined}
                        onClickReturn={openReturnMenu}
                      />
                    ))
                  )}
                </div>

                {/* Stretch film + штамп */}
                {packed && (
                  <>
                    <div className="vpb__film" />
                    <div className="vpb__stamp">📦 УПАКОВАНО</div>
                  </>
                )}

                {/* Footer */}
                <div className="vpb__pallet-foot">
                  <span data-pcnt={p.id} className="vpb__pallet-foot-count">{pIt.length} поз.</span>
                  <span>{packed ? '✅ отправляется' : pIt.length ? '⏳ готов' : ''}</span>
                </div>
              </div>
            );
          })}

          {canEdit && (
            <div className="vpb__add" onClick={onAddPallet}>
              <span className="vpb__add-icon">+</span>
              <span>Новое паллетоместо</span>
            </div>
          )}
        </div>
      </div>

      {/* Return-status menu (демоб) */}
      {returnMenu && (
        <div
          className="vpb__ret-menu"
          style={{
            position: 'fixed',
            top: returnMenu.y,
            left: returnMenu.x,
            zIndex: 99998,
            background: 'var(--card-bg, #1d1f24)',
            border: '1px solid var(--brd-1, #3a3d44)',
            borderRadius: 8,
            padding: 4,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 180
          }}
        >
          {[
            { val: 'returning', label: '✅ Возвращается', color: 'var(--ok, #4caf50)' },
            { val: 'damaged',   label: '🔧 Сломано',      color: 'var(--err, #ff5050)' },
            { val: 'lost',      label: '❓ Утеряно',       color: 'var(--t-3, #7a7e87)' },
            { val: 'consumed',  label: '🔥 Израсходовано', color: 'var(--warn, #ffa028)' }
          ].map((opt) => {
            const active = returnMenu.current === opt.val;
            return (
              <button
                key={opt.val}
                type="button"
                onClick={() => applyReturnStatus(returnMenu.itemId, opt.val)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  background: active ? 'rgba(212, 161, 60, 0.12)' : 'transparent',
                  border: 'none',
                  color: 'var(--t-1, #e3e6ed)',
                  fontSize: 13,
                  textAlign: 'left',
                  borderRadius: 4,
                  cursor: 'pointer'
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: opt.color }} />
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
function CapacityEditor({ value, onCommit }) {
  const [v, setV] = useState(String(value ?? ''));
  const [editing, setEditing] = useState(false);
  useEffect(() => { setV(String(value ?? '')); }, [value]);
  if (!editing) {
    return (
      <button
        type="button"
        className="vpb__pallet-cap-edit"
        onClick={() => setEditing(true)}
        title="Изменить вместимость"
      >max {value}</button>
    );
  }
  return (
    <input
      autoFocus
      className="vpb__cap-input"
      value={v}
      onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ''))}
      onBlur={() => { setEditing(false); if (v !== String(value)) onCommit(v); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.currentTarget.blur(); }
        else if (e.key === 'Escape') { setV(String(value)); setEditing(false); }
      }}
    />
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}
