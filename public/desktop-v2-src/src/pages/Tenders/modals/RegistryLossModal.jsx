/**
 * Модалка «Почему проиграли?»
 */
import { useEffect, useState } from 'react';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { MoneyInput } from '@/inputs/Inputs';
import { patchRegistryStatus, loadLossReasons, enrichOutcomeFromTenderGuru } from '../api';

const LOSS_REASONS_FALLBACK = [
  { id: 'price', label: 'Цена выше конкурентов' },
  { id: 'deadline', label: 'Сроки / график не устроили' },
  { id: 'qual', label: 'Не прошли квалификацию / допуск' },
  { id: 'docs', label: 'Ошибка или неполнота документов' },
  { id: 'lobby', label: 'Предпочтение другому подрядчику' },
  { id: 'cancel', label: 'Закупка отменена / не состоялась' },
  { id: 'nobid', label: 'Не подали заявку' }
];

const emptyCompetitor = () => ({ place: '', company_name: '', company_inn: '', price_no_vat: '' });

export default function RegistryLossModal({ tender, onClose, onSaved, onCancel }) {
  const close = onClose || onCancel;
  const [reasonOptions, setReasonOptions] = useState(LOSS_REASONS_FALLBACK);
  const [selected, setSelected] = useState(new Set());
  const [winnerPrice, setWinnerPrice] = useState('');
  const [winnerName, setWinnerName] = useState('');
  const [winnerInn, setWinnerInn] = useState('');
  const [ourPriceNoVat, setOurPriceNoVat] = useState(
    tender?.submission_price != null ? String(tender.submission_price) : ''
  );
  const [lossPlace, setLossPlace] = useState('');
  const [participantsCount, setParticipantsCount] = useState('');
  const [lossReport, setLossReport] = useState('');
  const [comment, setComment] = useState('');
  const [protocolUrl, setProtocolUrl] = useState('');
  const [resultAt, setResultAt] = useState('');
  const [competitors, setCompetitors] = useState([emptyCompetitor()]);
  const [busy, setBusy] = useState(false);
  const [tgBusy, setTgBusy] = useState(false);
  const [queueHint, setQueueHint] = useState('');

  useEffect(() => {
    loadLossReasons()
      .then((list) => {
        if (list?.length) setReasonOptions(list.map((r) => ({ id: r.code, label: r.label })));
      })
      .catch(() => {});
  }, []);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateCompetitor = (idx, field, value) => {
    setCompetitors((prev) => prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  };

  const addCompetitor = () => setCompetitors((prev) => [...prev, emptyCompetitor()]);

  const removeCompetitor = (idx) => {
    setCompetitors((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : [emptyCompetitor()];
    });
  };

  const pullTenderGuru = async () => {
    setTgBusy(true);
    try {
      const resp = await enrichOutcomeFromTenderGuru(tender.id);
      const r = resp?.result ?? resp;
      if (r?.reason === 'no_api_key' || resp?.code === 'no_api_key') {
        toast.warn('TenderGuru API не настроен на сервере');
        return;
      }
      if (!r?.matched) {
        if (r?.ambiguous) {
          setQueueHint('Неоднозначное совпадение — подтвердите в реестре (блок «TenderGuru: неоднозначные матчи»).');
        }
        toast.warn(r?.ambiguous ? 'Несколько совпадений — очередь в реестре' : 'Совпадение не найдено');
        return;
      }
      if (r.winner_price != null) setWinnerPrice(String(r.winner_price));
      if (r.winner_name) setWinnerName(r.winner_name);
      if (r.winner_inn) setWinnerInn(String(r.winner_inn));
      toast.success(r.partial ? 'Частичные данные из TenderGuru' : 'Данные подставлены');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setTgBusy(false);
    }
  };

  const save = async () => {
    if (!selected.size) return toast.warn('Выберите хотя бы одну причину');
    setBusy(true);
    try {
      const reasons = [...selected];
      const compPayload = competitors
        .filter((c) => c.place || c.company_name || c.company_inn || c.price_no_vat)
        .map((c) => ({
          place: c.place !== '' ? Number(c.place) : null,
          company_name: c.company_name.trim() || null,
          company_inn: c.company_inn.trim() || null,
          price_no_vat: c.price_no_vat !== '' && c.price_no_vat != null ? Number(c.price_no_vat) : null,
          is_winner: Number(c.place) === 1
        }));
      await patchRegistryStatus(tender.id, {
        registry_status: 'проиграли',
        loss_reasons: reasons,
        loss_reason_code: reasons[0],
        winner_price: winnerPrice !== '' && winnerPrice != null ? Number(winnerPrice) : null,
        winner_price_no_vat: winnerPrice !== '' && winnerPrice != null ? Number(winnerPrice) : null,
        winner_inn: winnerInn.trim() || null,
        winner_name: winnerName.trim() || null,
        our_price_no_vat: ourPriceNoVat !== '' ? Number(ourPriceNoVat) : null,
        loss_place: lossPlace !== '' ? Number(lossPlace) : null,
        participants_count: participantsCount !== '' ? Number(participantsCount) : null,
        loss_report: lossReport.trim() || null,
        result_protocol_url: protocolUrl.trim() || null,
        result_at: resultAt || null,
        competitors: compPayload.length ? compPayload : undefined,
        comment: comment.trim() || null
      });
      toast.success('Сохранено');
      onSaved?.();
      close?.();
    } catch (e) {
      toast.error(e.message);
      setBusy(false);
    }
  };

  const scoreHint = tender.score?.win_chance_pct != null
    ? `Скор заказчика: ${tender.score.win_chance_pct}%` + (selected.has('price') ? ' · учтена причина «Цена»' : '')
    : '';

  return (
    <MCard style={{ width: 'min(520px, 96vw)' }}>
      <MHead title="Почему проиграли?" onClose={close} />
      <MBody>
        <p className="muted" style={{ marginTop: 0 }}>
          {tender.customer_name} · {tender.tender_title}
        </p>
        {queueHint && <div className="alert" style={{ marginBottom: 12, fontSize: 12 }}>{queueHint}</div>}
        <p style={{ fontSize: 13, marginBottom: 12 }}>
          Выберите одну или несколько причин. Данные учитываются в скоре заказчика.
        </p>
        <div className="reg-loss-reasons">
          {reasonOptions.map((r) => (
            <label key={r.id} className="reg-loss-reason">
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
          <div>
            <label className="muted" style={{ fontSize: 12 }}>Наше место</label>
            <input className="inp" type="number" min={1} value={lossPlace} onChange={(e) => setLossPlace(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <label className="muted" style={{ fontSize: 12 }}>Участников</label>
            <input className="inp" type="number" min={1} value={participantsCount} onChange={(e) => setParticipantsCount(e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>
        <label className="muted" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>Наша цена без НДС</label>
        <MoneyInput value={ourPriceNoVat} onChange={setOurPriceNoVat} placeholder="0 ₽" />
        <label className="muted" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>Цена победителя без НДС</label>
        <MoneyInput value={winnerPrice} onChange={setWinnerPrice} placeholder="0 ₽" />
        <label className="muted" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>ИНН победителя</label>
        <input className="inp" maxLength={12} value={winnerInn} onChange={(e) => setWinnerInn(e.target.value)} style={{ width: '100%' }} />
        <label className="muted" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>Кто выиграл</label>
        <input className="inp" value={winnerName} onChange={(e) => setWinnerName(e.target.value)} style={{ width: '100%' }} />
        <label className="muted" style={{ fontSize: 12, display: 'block', marginTop: 12, fontWeight: 600 }}>Участники протокола</label>
        {competitors.map((c, idx) => (
          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '48px 1fr 90px 110px 28px', gap: 6, marginBottom: 6, alignItems: 'end' }}>
            <input className="inp" type="number" min={1} placeholder="#" value={c.place} onChange={(e) => updateCompetitor(idx, 'place', e.target.value)} />
            <input className="inp" placeholder="Участник" value={c.company_name} onChange={(e) => updateCompetitor(idx, 'company_name', e.target.value)} />
            <input className="inp" placeholder="ИНН" maxLength={12} value={c.company_inn} onChange={(e) => updateCompetitor(idx, 'company_inn', e.target.value)} />
            <input className="inp" type="number" placeholder="₽" value={c.price_no_vat} onChange={(e) => updateCompetitor(idx, 'price_no_vat', e.target.value)} />
            <button type="button" className="btn mini ghost" onClick={() => removeCompetitor(idx)} aria-label="Удалить">×</button>
          </div>
        ))}
        <Btn variant="ghost" className="mini" onClick={addCompetitor} style={{ marginBottom: 12 }}>+ Участник</Btn>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 8 }}>
          <div>
            <label className="muted" style={{ fontSize: 12 }}>URL протокола</label>
            <input className="inp" value={protocolUrl} onChange={(e) => setProtocolUrl(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <label className="muted" style={{ fontSize: 12 }}>Дата итогов</label>
            <input className="inp" type="date" value={resultAt} onChange={(e) => setResultAt(e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>
        <label className="muted" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>Краткий отчёт по итогам</label>
        <textarea className="inp" rows={2} value={lossReport} onChange={(e) => setLossReport(e.target.value)} style={{ width: '100%' }} />
        <label className="muted" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>Комментарий</label>
        <textarea className="inp" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} style={{ width: '100%' }} />
        {scoreHint && <div className="alert" style={{ marginTop: 12, fontSize: 12 }}>{scoreHint}</div>}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy || tgBusy}>Отмена</Btn>
        <Btn variant="ghost" onClick={pullTenderGuru} disabled={busy || tgBusy}>Подтянуть из ТендерGuru</Btn>
        <span style={{ flex: 1 }} />
        <Btn onClick={save} disabled={busy || tgBusy}>Сохранить и закрыть</Btn>
      </MFoot>
    </MCard>
  );
}

export { LOSS_REASONS_FALLBACK as LOSS_REASONS };
