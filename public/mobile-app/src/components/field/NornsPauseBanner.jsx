/**
 * Shared copy + UI for temporary pause of physical/privilege prizes.
 * Source of truth for wording also lives on API (pause_message*).
 */
export const PAUSE_BADGE = 'Обновление призов';

export const PAUSE_STRIP =
  'Список призов обновляется: еда, мерч и выходные на паузе. Уже оформленное — выдадим. Скоро новые призы.';

export const PAUSE_FULL = {
  title: 'Залы Норн обновляются',
  body: [
    'Пока собираем новый список призов, временно не разыгрываем еду, одежду, мерч, выходной и выбор смены.',
    'Всё, что вы уже выиграли и оформили на выдачу — отдадим как положено. Ничего не сгорает.',
    'Сейчас на Колесе — руны, облик воина, рамки и бусты. Скоро вернёмся с новыми крутыми призами.',
  ],
};

const STRIP_CSS = `
.norns-pause-strip{
  margin:8px 16px 0;padding:10px 12px;border-radius:14px;
  background:linear-gradient(135deg,rgba(240,200,80,.12),rgba(165,110,255,.08));
  border:1px solid rgba(240,200,80,.28);
  display:flex;gap:10px;align-items:flex-start;
}
.norns-pause-strip-icon{font-size:18px;line-height:1.2;flex-shrink:0}
.norns-pause-strip-text{font-size:12px;line-height:1.4;color:rgba(255,255,255,.78);font-weight:600}
.norns-pause-modal-backdrop{
  position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.72);
  display:flex;align-items:flex-end;justify-content:center;
  padding:16px;padding-bottom:max(env(safe-area-inset-bottom),16px);
}
.norns-pause-modal{
  width:100%;max-width:420px;border-radius:22px;padding:20px 18px 16px;
  background:linear-gradient(180deg,#1a2040,#121628);
  border:1px solid rgba(240,200,80,.3);
  box-shadow:0 20px 50px rgba(0,0,0,.55);
}
.norns-pause-modal-title{font-size:17px;font-weight:800;color:#F0C850;margin-bottom:10px}
.norns-pause-modal-body{font-size:13px;line-height:1.45;color:rgba(255,255,255,.78);margin-bottom:8px}
.norns-pause-modal-btn{
  margin-top:12px;width:100%;padding:14px;border:none;border-radius:14px;
  font-size:15px;font-weight:800;color:#1a1000;cursor:pointer;
  background:linear-gradient(135deg,#C8940A,#F0C850);
}
`;

export function NornsPauseStrip({ text = PAUSE_STRIP, style }) {
  return (
    <>
      <style>{STRIP_CSS}</style>
      <div className="norns-pause-strip" style={style} role="status">
        <span className="norns-pause-strip-icon" aria-hidden>ᚱ</span>
        <div className="norns-pause-strip-text">{text}</div>
      </div>
    </>
  );
}

export function NornsPauseModal({ open, onClose, title = PAUSE_FULL.title, body = PAUSE_FULL.body }) {
  if (!open) return null;
  const paragraphs = Array.isArray(body) ? body : [body];
  return (
    <>
      <style>{STRIP_CSS}</style>
      <div className="norns-pause-modal-backdrop" onClick={onClose} role="presentation">
        <div
          className="norns-pause-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="norns-pause-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="norns-pause-modal-title" id="norns-pause-title">{title}</div>
          {paragraphs.map((p, i) => (
            <p key={i} className="norns-pause-modal-body">{p}</p>
          ))}
          <button type="button" className="norns-pause-modal-btn" onClick={onClose}>
            Понятно
          </button>
        </div>
      </div>
    </>
  );
}

const SESSION_KEY = 'norns_pause_modal_seen_v1';

export function shouldShowPauseModal() {
  try {
    return !sessionStorage.getItem(SESSION_KEY);
  } catch {
    return true;
  }
}

export function markPauseModalSeen() {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch { /* ignore */ }
}
