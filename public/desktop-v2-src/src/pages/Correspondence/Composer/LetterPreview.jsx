/**
 * LetterPreview.jsx — статичное превью бланка письма (то, как PDF будет
 * выглядеть). Не редактируется, только просмотр.
 *
 * Визуальный референс: Desktop/asgard_official_letter_mockup.html (последний
 * согласованный мокап). Берём ГНШ-структуру, цвета — токенные --letterhead-*.
 *
 * ⚠️ КРИТИЧНО ([[feedback-letter-executor]]): «Исп.» — author/current user из
 * useAuth, НЕ хардкод. Никакого fallback вида 'Андросов Никита Андреевич'.
 */

function fmtDate(d) {
  if (!d) return '—';
  try {
    const dt = typeof d === 'string' ? new Date(d) : d;
    if (!Number.isFinite(dt.getTime())) return '—';
    return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch { return '—'; }
}

// Чистое HTML-rendering из TipTap json: если есть `html`, используем его;
// иначе фолбэк на body_html.
function renderBody(html) {
  return { __html: String(html || '<p style="color:var(--t-3)">Текст письма не введён</p>') };
}

export function LetterPreview({
  draft,
  number,                 // null пока draft, '<АС-2026-06-125>' после finalize
  date,
  signingStatus,          // draft|finalized|sent
  executorName,           // КРИТИЧНО: из useAuth(), не хардкод
  executorPhoneEmail,     // КРИТИЧНО: из useAuth()
  signerName = 'Кудряшов О.С.',           // из settings.company_profile, fallback
  signerPosition = 'Генеральный директор'
}) {
  const sigOn   = draft.signature_on !== false;
  const stampOn = draft.stamp_on     !== false;

  return (
    <div
      className="letter-preview"
      style={{
        background: 'var(--letterhead-bg, #FBF8EF)',
        color: 'var(--letterhead-ink, #1C1914)',
        padding: '48px 56px',
        borderRadius: 'var(--r-sm)',
        boxShadow: 'var(--shadow-lg)',
        fontFamily: 'var(--ff-serif, PT Serif, Georgia, serif)',
        fontSize: 13,
        lineHeight: 1.55,
        minHeight: 600,
        maxWidth: 820,
        margin: '0 auto'
      }}
    >
      {/* ── Шапка с логотипом + реквизитами ────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr',
        gap: 18,
        paddingBottom: 14,
        borderBottom: '2px solid var(--letterhead-rule, #C8A34A)'
      }}>
        <div style={{
          width: 80, height: 80,
          background: 'var(--letterhead-rule, #C8A34A)',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--letterhead-bg, #FBF8EF)',
          fontWeight: 700,
          fontFamily: 'var(--ff-head, Cinzel, serif)',
          fontSize: 16,
          letterSpacing: 1
        }}>
          АСГАРД
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--letterhead-ink-2, #4A4236)' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--letterhead-ink, #1C1914)' }}>
            ООО «Асгард-Сервис»
          </div>
          <div>ОГРН 1157746388128 · ИНН 7733230989</div>
          <div>105082, г. Москва, ул. Большая Почтовая, д. 55/59, стр. 1, пом. 37</div>
          <div>Тел.: +7 (499) 322-30-62 · info@asgard-service.com · asgard-service.com</div>
        </div>
      </div>

      {/* ── Исх.№ / Дата (слева) и адресат (справа) ────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 24,
        marginTop: 20,
        fontSize: 12.5
      }}>
        <div>
          <div>
            {signingStatus === 'draft'
              ? <span style={{ color: 'var(--err-t, #C8293B)' }}>Исх. № <i>(будет присвоен при финализации)</i></span>
              : <span>Исх. № <b>{number || '—'}</b></span>
            }
          </div>
          <div>от {fmtDate(date)}</div>
          {draft.header_subline ? (
            <div style={{ marginTop: 6, fontStyle: 'italic', color: 'var(--letterhead-ink-2, #4A4236)' }}>
              {draft.header_subline}
            </div>
          ) : null}
          {(draft.procedure_number || draft.lot_number) ? (
            <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--letterhead-ink-2, #4A4236)' }}>
              {draft.procedure_number ? <div>№ процедуры: {draft.procedure_number}</div> : null}
              {draft.lot_number       ? <div>№ лота: {draft.lot_number}</div> : null}
              {draft.lot_title        ? <div style={{ fontStyle: 'italic' }}>{draft.lot_title}</div> : null}
            </div>
          ) : null}
        </div>
        <div style={{ textAlign: 'right' }}>
          {draft.counterparty ? <div style={{ fontWeight: 700 }}>{draft.counterparty}</div> : null}
          {draft.contact_person ? <div style={{ marginTop: 4 }}>{draft.contact_person}</div> : null}
        </div>
      </div>

      {/* ── Заголовок документа (centered) ──────────────────────────── */}
      {(draft.doc_title || draft.doc_sub) ? (
        <div style={{ marginTop: 32, textAlign: 'center' }}>
          {draft.doc_title ? (
            <div style={{
              fontWeight: 700,
              fontSize: 15,
              letterSpacing: 0.4,
              textTransform: 'uppercase'
            }}>
              {draft.doc_title}
            </div>
          ) : null}
          {draft.doc_sub ? (
            <div style={{
              fontStyle: 'italic',
              marginTop: 4,
              fontSize: 12.5,
              color: 'var(--letterhead-ink-2, #4A4236)'
            }}>
              {draft.doc_sub}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Тема ─────────────────────────────────────────────────────── */}
      {draft.subject ? (
        <div style={{
          marginTop: 18,
          fontWeight: 600,
          fontSize: 13,
          textAlign: 'center'
        }}>
          {draft.subject}
        </div>
      ) : null}

      {/* ── Тело письма (TipTap HTML) ──────────────────────────────── */}
      <div
        style={{ marginTop: 22, fontSize: 13, lineHeight: 1.65 }}
        dangerouslySetInnerHTML={renderBody(draft.body_html)}
      />

      {/* ── Подпись + Печать ─────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 24,
        marginTop: 48,
        alignItems: 'flex-end'
      }}>
        <div>
          <div style={{ fontSize: 12.5 }}>{signerPosition}</div>
          <div style={{
            marginTop: 28,
            borderTop: '1px solid var(--letterhead-ink-2, #4A4236)',
            paddingTop: 4,
            display: 'inline-block',
            minWidth: 240,
            position: 'relative'
          }}>
            <span style={{ fontWeight: 600 }}>{signerName}</span>
            {sigOn && (
              <img
                src="/assets/img/signature.png"
                alt=""
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                style={{
                  position: 'absolute',
                  left: 30, top: -32,
                  height: 56, opacity: 0.85,
                  pointerEvents: 'none'
                }}
              />
            )}
          </div>
        </div>
        {stampOn ? (
          <img
            src="/assets/img/stamp.png"
            alt="stamp"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
            style={{ width: 110, height: 110, opacity: 0.7 }}
          />
        ) : null}
      </div>

      {/* ── Исполнитель (Исп.) ───────────────────────────────────────── */}
      {/* ⚠️ КРИТИЧНО: executorName приходит из useAuth().user, никаких хардкодов. */}
      <div style={{
        marginTop: 36,
        paddingTop: 8,
        borderTop: '1px dotted var(--letterhead-ink-2, #4A4236)',
        fontSize: 10.5,
        color: 'var(--letterhead-ink-2, #4A4236)'
      }}>
        Исп.: {executorName || '—'}
        {executorPhoneEmail ? <span style={{ marginLeft: 12 }}>{executorPhoneEmail}</span> : null}
      </div>
    </div>
  );
}
