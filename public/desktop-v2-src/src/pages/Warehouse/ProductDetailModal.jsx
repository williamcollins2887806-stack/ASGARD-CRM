import { useState, useEffect, useRef } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { loadProductCard, MOVE_META, fmt, categoryIcon } from './api';
import { api } from '@/api/client';
import { validateFile, MAX_PHOTO_SIZE } from '@/api/upload';

/**
 * Карточка позиции каталога (vanilla openProduct).
 * Содержит: фото, описание, остатки по ячейкам, последние движения,
 * последняя цена, подтверждение черновика.
 */
export function ProductDetailModal({ productId, onChanged }) {
  const { close } = useModal();
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef(null);

  const reload = () => {
    setLoading(true);
    loadProductCard(productId)
      .then(setCard)
      .catch((e) => toast.error('Ошибка: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(reload, [productId]);

  if (loading || !card) {
    return (
      <MCard>
        <MHead icon="📦" title="Позиция" onClose={close} />
        <MBody><div className="wh-loading">⏳ Загрузка…</div></MBody>
      </MCard>
    );
  }

  const p = card.item || {};
  const slots = card.slots || [];
  const moves = card.movements || [];
  const lp = card.last_price;

  const onUploadPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // G-5: размер/тип фото товара.
    try {
      validateFile(file, { maxSize: MAX_PHOTO_SIZE, accept: 'image/*' });
    } catch (vErr) {
      toast.error(vErr?.message || 'Файл не подходит'); return;
    }
    const token = localStorage.getItem('asgard_token') || '';
    const form = new FormData();
    form.append('photo', file);
    try {
      const r = await fetch('/api/stock/product/' + productId + '/photo', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: form
      });
      if (!r.ok) throw new Error('Не удалось загрузить');
      toast.success('Фото загружено');
      reload();
    } catch (err) {
      toast.error('Ошибка: ' + (err?.message || err));
    }
  };

  const onConfirmDraft = async () => {
    try {
      await api('/api/stock/products/' + productId + '/confirm', { method: 'PUT' });
      toast.success('Позиция подтверждена');
      onChanged?.();
      close();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    }
  };

  return (
    <MCard>
      <MHead icon={categoryIcon(p.category_name)} title={p.name} subtitle={p.category_name || 'Без категории'} accent="info" onClose={close} />
      <MBody>
        <div className="row gap-16 mb-16">
          <label className="wh-prod-photo">
            {p.photo_url ? (
              <img src={p.photo_url} alt="" className="wh-prod-img" />
            ) : (
              <div className="wh-prod-img wh-prod-img--blank">📦</div>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="u-hidden" onChange={onUploadPhoto} />
            <span className="wh-prod-cam" onClick={() => fileRef.current?.click()}>📷</span>
          </label>
          <div className="flex-1">
            <div className="row gap-6 u-wrap mb-8">
              {p.is_draft && <span className="wh-chip wh-chip--draft">черновик</span>}
              {p.is_consumable
                ? <span className="wh-chip wh-chip--cons">расходник</span>
                : <span className="wh-chip wh-chip--ok">учётная единица</span>}
            </div>
            <div className="fs-12 c-t3">
              {p.unit || 'шт'}
              {p.article && ' · арт. ' + p.article}
              {p.ean && ' · EAN ' + p.ean}
            </div>
            <div className="mt-6">
              <strong className="fs-28" style={{ color: card.total ? 'var(--ok)' : 'var(--t-3)' }}>{fmt(card.total)}</strong>
              <span className="fs-13 c-t3 ml-6">{p.unit || 'шт'} в наличии</span>
            </div>
            {lp && (
              <div className="fs-12 c-t3 mt-4">
                💰 посл. цена: <strong>{fmt(lp.unit_price)} ₽</strong>
                {lp.supplier_name ? ' · ' + lp.supplier_name : ''}
              </div>
            )}
          </div>
        </div>

        {slots.length > 0 && (
          <div className="mt-14">
            <div className="fs-12 c-t3 fw-600 mb-6">Где лежит</div>
            <div className="wh-table-wrap">
              <table className="wh-table">
                <tbody>
                  {slots.map((s, i) => (
                    <tr key={i}>
                      <td>{s.warehouse_name || '—'}</td>
                      <td><strong className="c-gold">{s.location_label || 'без ячейки'}</strong></td>
                      <td className="t-right">{fmt(s.quantity)} {s.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {moves.length > 0 && (
          <div className="mt-14">
            <div className="fs-12 c-t3 fw-600 mb-6">Последние движения</div>
            <div className="wh-mv-list wh-mv-list--pad">
              {moves.slice(0, 8).map((m, i) => {
                const meta = MOVE_META[m.movement_type] || { icon: '•', label: m.movement_type, tone: 'mute' };
                return (
                  <div key={i} className="wh-mv">
                    <div className="wh-mv__ic">{meta.icon}</div>
                    <div className="flex-1">
                      <span className="fs-13">{meta.label} {fmt(m.qty)} {m.unit}</span>
                      {m.reason && <span className="ml-6 c-t3 fs-12">· {m.reason}</span>}
                    </div>
                    <span className="fs-12 c-t3">
                      {new Date(m.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {p.is_draft && (
          <div className="mt-14">
            <Btn variant="primary" block onClick={onConfirmDraft}>
              ✅ Подтвердить позицию (снять черновик)
            </Btn>
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
