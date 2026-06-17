/**
 * Полная анкета-карточка сотрудника (deep-link #/employee?id=).
 *
 * ПОРТ ИЗ vanilla:
 *   • `public/assets/js/employee.js` (~755 строк) — таймлайн истории работ,
 *     AI-характеристика Мимира, экстренные контакты, доп.поля, документы,
 *     допуски-чекбоксы, ссылка на папку, лента комментариев.
 *   • `public/assets/js/worker_profile_desktop.js` (~878 строк) — hero+аватар+печать.
 *
 * Состоит из:
 *   • Hero: ФИО, должность, статус, дата приёма, аватар, кнопка «Печать»
 *   • KPI: статус, рейтинг, СЗ-остаток, официальный
 *   • Текущее назначение (work + РП)
 *   • Форма смены статуса готовности (HR/ADMIN/директора)
 *   • Свёртки <details>:
 *       📊 История работ          → EmployeeWorkHistory
 *       🧙 AI-характеристика      → EmployeeAiChar
 *       🆔 Экстренные / Образ. /Мед. /Одежда → EmployeeExtraFields
 *       📄 Документы (фото/ВУ/код подр.) + ссылка на папку → EmployeeDocs
 *       ✅ Допуски                → EmployeePermits (+ модалка добавления)
 *       💬 Лента комментариев     → EmployeeNotes
 *       🔒 PII (HR/ADMIN/директора) — read-only вид
 *       🏢 Официальное трудоустройство — read-only
 *       ⭐ Оценки (последние 10)
 *
 * Действия в подвале:
 *   📅 График | ★ Оценить | ✎ Редактировать | 🖨 Печать | Закрыть
 *
 * НИКАКОГО редиректа в vanilla #/employee. `onOpenLegacy` УДАЛЁН.
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, SelectInput, DatePicker, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  STATUS_MAP, REASONS, SE_YEAR_LIMIT,
  loadEmployee, loadReadinessLog, setReadinessStatus,
  fmtDate, fmtMoney, fmtRating, canEdit, canSeePII,
} from './api';
import { EditEmployeeModal } from './EditEmployeeModal';
import { ReviewModal } from './ReviewModal';
import { EmployeeWorkHistory } from './EmployeeWorkHistory';
import { EmployeeAiChar } from './EmployeeAiChar';
import { EmployeeExtraFields } from './EmployeeExtraFields';
import { EmployeeDocs } from './EmployeeDocs';
import { EmployeePermits } from './EmployeePermits';
import { EmployeeNotes } from './EmployeeNotes';
// Анкета-характеристика (порт vanilla worker_profile_desktop.js → btnProfile)
import { WorkerProfileModal } from './WorkerProfileModal';

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:personnel:changed'));
}

const STATUS_CHANGE_OPTIONS = [
  { value: 'ready',     label: '✓ Готов' },
  { value: 'not_ready', label: '⏸ Не готов' },
  { value: 'archive',   label: '📦 Архив' },
];

export function EmployeeDetailModal({ employeeId }) {
  const { user } = useAuth();
  const modal = useModal();
  const { close } = modal;

  const [data, setData] = useState(null);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusForm, setStatusForm] = useState({
    show: false,
    status: '',
    readiness_date: new Date().toISOString().slice(0, 10),
    reason: '',
    comment: '',
  });
  const [savingStatus, setSavingStatus] = useState(false);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      loadEmployee(employeeId),
      loadReadinessLog(employeeId).catch(() => []),
    ])
      .then(([d, l]) => {
        setData(d);
        setLog(l);
      })
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [employeeId]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:personnel:changed', onChanged);
    return () => window.removeEventListener('asgard:personnel:changed', onChanged);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  if (loading) {
    return (
      <MCard className="modal-wide">
        <MHead icon="⚔" title="Сотрудник" subtitle={`#${employeeId}`} onClose={close} />
        <MBody>
          <div className="prs-detail-loading">⏳ Загружаем…</div>
        </MBody>
      </MCard>
    );
  }

  const emp = data?.employee;
  if (!emp) {
    return (
      <MCard className="modal-wide">
        <MHead icon="⚔" title="Сотрудник не найден" subtitle={`#${employeeId}`} accent="warn" onClose={close} />
        <MBody>
          <p className="c-t2">Запись с таким id не найдена.</p>
        </MBody>
        <MFoot>
          <Btn onClick={close}>Закрыть</Btn>
        </MFoot>
      </MCard>
    );
  }

  const reviews = data?.reviews || [];
  const statusCode = emp.effective_status || emp.readiness_status || 'unknown';
  const stMeta = STATUS_MAP[statusCode];
  const seTrans = Number(emp.se_transferred_year || 0);
  const seRemaining = Math.max(0, SE_YEAR_LIMIT - seTrans);
  const loc = emp.on_site_info || emp.approved_info || null;

  const userCanEdit = user && canEdit(user.role);
  const userCanSeePII = user && canSeePII(user.role);
  const userCanReview = user && (user.role === 'PM' || user.role === 'HEAD_PM' || user.role === 'ADMIN' || /^DIRECTOR/.test(user.role || ''));

  const onEdit = () => {
    if (!userCanEdit) {
      toast.warn('Нет прав на редактирование');
      return;
    }
    modal.open(<EditEmployeeModal employee={emp} onSaved={() => refresh()} />, { size: 'wide' });
  };
  const onReview = () => {
    modal.open(<ReviewModal employee={emp} onSaved={() => refresh()} />);
  };
  const onOpenSchedule = () => {
    close();
    window.location.hash = `#/workers-schedule?employee_id=${employeeId}`;
  };
  // Кнопка «📋 Анкета» — vanilla employee.js:146 (btnProfile → WorkerProfileDesktop.show).
  const onOpenProfile = () => {
    modal.open(<WorkerProfileModal employeeId={employeeId} employeeName={emp.fio} />, { size: 'wide' });
  };
  const onPrint = () => {
    // Печатаем модалку. Класс emp-print-mode перетряхивает CSS под печать.
    document.body.classList.add('emp-print-mode');
    window.print();
    setTimeout(() => document.body.classList.remove('emp-print-mode'), 500);
  };

  const beginStatusChange = (code) => {
    setStatusForm({
      show: true,
      status: code,
      readiness_date: new Date().toISOString().slice(0, 10),
      reason: '',
      comment: '',
    });
  };
  const saveStatus = async () => {
    const { status, readiness_date, reason, comment } = statusForm;
    if (status === 'ready' && !readiness_date) {
      toast.warn('Укажите дату готовности');
      return;
    }
    if (status === 'not_ready' && !reason) {
      toast.warn('Укажите причину');
      return;
    }
    setSavingStatus(true);
    try {
      await setReadinessStatus(emp.id, {
        status,
        readiness_date: status === 'ready' ? readiness_date : null,
        reason: status === 'not_ready' ? reason : null,
        comment: comment.trim() || null,
      });
      toast.success(`Статус: ${STATUS_MAP[status]?.label || status}`);
      emitChanged();
      setStatusForm({ ...statusForm, show: false });
      refresh();
    } catch (e) {
      toast.error('Не удалось сменить статус: ' + (e?.message || e));
    } finally {
      setSavingStatus(false);
    }
  };

  const avatarSrc = `/api/staff/employees/${emp.id}/photo`;
  const avatarInitial = (emp.fio || '?').trim().charAt(0).toUpperCase();
  const onAvatarError = (e) => {
    // Если фото нет — спрятать <img> и оставить плейсхолдер.
    e.currentTarget.style.display = 'none';
  };

  return (
    <MCard className="modal-wide emp-modal">
      <MHead
        icon="⚔"
        title={emp.fio || '—'}
        subtitle={[emp.role_tag || emp.position, emp.grade ? `Разряд ${emp.grade}` : '', emp.phone].filter(Boolean).join(' · ')}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="prs-detail-stack">
          {/* HERO с аватаром */}
          <div className="emp-hero">
            <div className="emp-hero-avatar">
              <img
                src={avatarSrc}
                alt={emp.fio || ''}
                onError={onAvatarError}
              />
              <div className="emp-hero-avatar-fallback">{avatarInitial}</div>
            </div>
            <div className="emp-hero-info">
              <div className="emp-hero-name">{emp.fio || '—'}</div>
              <div className="emp-hero-sub">
                {[emp.role_tag || emp.position, emp.grade ? `Разряд ${emp.grade}` : '', emp.city].filter(Boolean).join(' · ')}
              </div>
              <div className="emp-hero-meta">
                {emp.hire_date && <span>📅 в команде с {fmtDate(emp.hire_date)}</span>}
                {emp.phone && <span>📞 {emp.phone}</span>}
                {emp.email && <span>📧 {emp.email}</span>}
              </div>
            </div>
            <div className="emp-hero-actions">
              {/* Анкета-характеристика — vanilla employee.js:146 (btnProfile) */}
              <Btn variant="ghost" size="sm" onClick={onOpenProfile} title="Анкета-характеристика (Мимир)">📋 Анкета</Btn>
              <Btn variant="ghost" size="sm" onClick={onPrint} title="Печать анкеты">🖨 Печать</Btn>
            </div>
          </div>

          {/* KPI */}
          <div className="prs-detail-kpis">
            <StatusCard stMeta={stMeta} date={emp.readiness_date} />
            <RatingCard rating={emp.rating_avg} count={reviews.length} />
            {emp.is_self_employed && (
              <KpiCard label="СЗ остаток года" value={fmtMoney(seRemaining)} tone="info" />
            )}
            {emp.is_officially_employed && (
              <KpiCard label="Трудоустроен" value="Да" tone="ok" />
            )}
          </div>

          {/* Текущее назначение */}
          {loc && (
            <Section label="Текущее назначение">
              <div className="prs-detail-card">
                <div className="prs-detail-loc-title">🏗 {loc.work_title || '—'}</div>
                {loc.pm_name && <div className="prs-detail-loc-pm">РП: {loc.pm_name}</div>}
              </div>
            </Section>
          )}

          {/* Смена статуса */}
          {userCanEdit && (
            <Section label="Смена статуса готовности">
              {!statusForm.show ? (
                <div className="row gap-8 u-wrap">
                  {STATUS_CHANGE_OPTIONS.map((opt) => (
                    <Btn key={opt.value} variant="ghost" onClick={() => beginStatusChange(opt.value)}>
                      {opt.label}
                    </Btn>
                  ))}
                </div>
              ) : (
                <div className="prs-detail-status-form">
                  <div className="prs-detail-status-form-info">
                    Сменить на: <b>{STATUS_MAP[statusForm.status]?.label || statusForm.status}</b>
                  </div>
                  {statusForm.status === 'ready' && (
                    <Field label="Дата готовности" required>
                      <DatePicker
                        value={statusForm.readiness_date}
                        onChange={(v) => setStatusForm((f) => ({ ...f, readiness_date: v || '' }))}
                      />
                    </Field>
                  )}
                  {statusForm.status === 'not_ready' && (
                    <Field label="Причина" required>
                      <SelectInput
                        value={statusForm.reason}
                        onChange={(v) => setStatusForm((f) => ({ ...f, reason: v }))}
                        options={REASONS.map((r) => ({ value: r.key, label: r.label }))}
                      />
                    </Field>
                  )}
                  <Field label="Комментарий">
                    <TextareaInput
                      value={statusForm.comment}
                      onChange={(v) => setStatusForm((f) => ({ ...f, comment: v }))}
                      placeholder="Необязательно"
                      minRows={2}
                      maxRows={4}
                    />
                  </Field>
                  <div className="row-end gap-8">
                    <Btn variant="ghost" onClick={() => setStatusForm({ ...statusForm, show: false })}>Отмена</Btn>
                    <Btn variant="primary" disabled={savingStatus} onClick={saveStatus}>
                      {savingStatus ? 'Сохраняем…' : '✓ Применить'}
                    </Btn>
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* СЗ-блок */}
          {emp.is_self_employed && (
            <Section label="Самозанятый — годовой лимит">
              <SeBigBar transferred={seTrans} limit={SE_YEAR_LIMIT} />
              {log.length > 0 && (
                <div className="mt-10">
                  <div className="prs-detail-se-log-head">Последние операции</div>
                  {log.slice(0, 5).map((op) => (
                    <div key={op.id} className="prs-detail-se-log-row">
                      {fmtDate(op.created_at)} —
                      {' '}<b>{STATUS_MAP[op.new_status]?.label || op.new_status}</b>
                      {op.reason && <span className="c-t3"> · {REASONS.find((r) => r.key === op.reason)?.label || op.reason}</span>}
                      {op.changed_by_name && <span className="c-t3"> · {op.changed_by_name}</span>}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* Свёртки */}
          <DetailsBlock title="📊 История работ" defaultOpen>
            <EmployeeWorkHistory employeeId={emp.id} />
          </DetailsBlock>

          <DetailsBlock title="🧙 Характеристика от Мимира">
            <EmployeeAiChar employeeId={emp.id} />
          </DetailsBlock>

          <DetailsBlock title="🆔 Контакты, образование, медицина, одежда">
            <EmployeeExtraFields employee={emp} canEdit={userCanEdit} onSaved={refresh} />
          </DetailsBlock>

          <DetailsBlock title="📄 Документы (военный билет, ВУ, код подразделения, папка)">
            <EmployeeDocs employee={emp} canEdit={userCanEdit} onSaved={refresh} />
          </DetailsBlock>

          <DetailsBlock title="✅ Допуски и разрешения">
            <EmployeePermits employeeId={emp.id} canEdit={userCanEdit} />
          </DetailsBlock>

          <DetailsBlock title="💬 Лента комментариев">
            <EmployeeNotes employee={emp} canEdit={userCanEdit} onSaved={refresh} />
          </DetailsBlock>

          {/* Официальное трудоустройство */}
          {emp.is_officially_employed && (
            <Section label="🏢 Официальное трудоустройство">
              <KV label="Оклад" value={fmtMoney(emp.salary)} />
              <KV label="Дата найма" value={fmtDate(emp.hire_date || emp.employment_date)} />
              <KV label="Тип договора" value={emp.contract_type || '—'} />
            </Section>
          )}

          {/* PII */}
          {userCanSeePII && (
            <Section label="🔒 ПII (HR/ADMIN/директора)" warn>
              <KV label="ИНН" value={emp.inn} />
              <KV label="СНИЛС" value={emp.snils} />
              <KV
                label="Паспорт"
                value={(emp.passport_series || emp.pass_series) && (emp.passport_number || emp.pass_number)
                  ? `${emp.passport_series || emp.pass_series} ${emp.passport_number || emp.pass_number}`
                  : null}
              />
              <KV label="Выдан" value={emp.passport_issued} />
              <KV label="Дата выдачи" value={fmtDate(emp.passport_date)} />
              <KV label="Адрес регистрации" value={emp.registration_address} />
              <KV label="Банк" value={emp.bank_name} />
              <KV label="БИК" value={emp.bik} />
              <KV label="Счёт" value={emp.account_number} />
              <KV label="Карта" value={emp.card_number} />
            </Section>
          )}

          {/* Оценки */}
          <Section label={`⭐ Оценки (${reviews.length})`}>
            {reviews.length === 0 ? (
              <div className="prs-detail-empty-reviews">Оценок пока нет.</div>
            ) : (
              <div className="prs-detail-reviews-list">
                {reviews.map((r) => (
                  <ReviewItem key={r.id} review={r} />
                ))}
              </div>
            )}
          </Section>

          {userCanSeePII && emp.comment && <Section label="🔒 Комментарий HR">{emp.comment}</Section>}
        </div>
      </MBody>
      <MFoot align="spread">
        <div className="row gap-6">
          <Btn variant="ghost" onClick={onOpenSchedule}>📅 График</Btn>
          <Btn variant="ghost" onClick={onOpenProfile}>📋 Анкета</Btn>
          <Btn variant="ghost" onClick={onPrint}>🖨 Печать</Btn>
        </div>
        <div className="row gap-6">
          <Btn onClick={close}>Закрыть</Btn>
          {userCanReview && <Btn onClick={onReview}>★ Оценить</Btn>}
          {userCanEdit && <Btn variant="primary" onClick={onEdit}>✎ Редактировать</Btn>}
        </div>
      </MFoot>
    </MCard>
  );
}

/* ─── Subcomponents ──────────────────────────────────────────────────────── */

function Section({ label, warn, children }) {
  return (
    <div>
      <div className={'prs-detail-section-label' + (warn ? ' prs-detail-section-label--warn' : '')}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function DetailsBlock({ title, defaultOpen = false, children }) {
  return (
    <details className="emp-details" open={defaultOpen}>
      <summary className="emp-details-summary">{title}</summary>
      <div className="emp-details-body">{children}</div>
    </details>
  );
}

function KV({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="prs-detail-kv">
      <div className="prs-detail-kv-key">{label}</div>
      <div className="prs-detail-kv-val">{value}</div>
    </div>
  );
}

function StatusCard({ stMeta, date }) {
  if (!stMeta) return null;
  return (
    <div className="prs-detail-card">
      <div className="prs-detail-card-eyebrow">Статус</div>
      <div className="prs-detail-card-val" style={{ color: toneColor(stMeta.tone) }}>
        {stMeta.icon} {stMeta.label}
      </div>
      {date && <div className="prs-detail-card-sub">с {fmtDate(date)}</div>}
    </div>
  );
}

function RatingCard({ rating, count }) {
  const txt = fmtRating(rating);
  const n = Number(rating);
  const color = txt === null ? 'var(--t-3)'
    : n >= 8 ? 'var(--ok)'
    : n >= 6 ? 'var(--gold)'
    : n < 4 ? 'var(--err)' : 'var(--t-1)';
  return (
    <div className="prs-detail-card">
      <div className="prs-detail-card-eyebrow">Рейтинг</div>
      <div className="prs-detail-card-val" style={{ color }}>{txt ?? '—'}</div>
      <div className="prs-detail-card-sub">{count} оценок</div>
    </div>
  );
}

function KpiCard({ label, value, tone }) {
  return (
    <div className="prs-detail-card">
      <div className="prs-detail-card-eyebrow">{label}</div>
      <div className="prs-detail-card-val prs-detail-card-val--sm" style={{ color: toneColor(tone) }}>{value}</div>
    </div>
  );
}

function SeBigBar({ transferred, limit }) {
  const pct = limit > 0 ? Math.min(100, Math.round((transferred / limit) * 100)) : 0;
  const color = pct >= 90 ? 'var(--err)' : pct >= 70 ? 'var(--amber)' : 'var(--ok)';
  return (
    <div>
      <div className="prs-detail-se-bar-head">
        <span>Перечислено: {fmtMoney(transferred)}</span>
        <span>Лимит: {fmtMoney(limit)}</span>
      </div>
      <div className="prs-detail-se-bar">
        <div className="prs-detail-se-bar-fill" style={{ width: pct + '%', background: color }} />
      </div>
      <div className="prs-detail-se-bar-pct" style={{ color }}>{pct}% использовано</div>
    </div>
  );
}

function ReviewItem({ review }) {
  const n = Number(review.score_1_10 ?? review.rating ?? 0);
  const color = n >= 8 ? 'var(--ok)' : n >= 6 ? 'var(--gold)' : n < 4 ? 'var(--err)' : 'var(--t-1)';
  return (
    <div className="prs-detail-review">
      <div className="prs-detail-review-head">
        <span className="prs-detail-review-score" style={{ color }}>{n}/10</span>
        <span className="prs-detail-review-date">{fmtDate(review.created_at)}</span>
      </div>
      {review.comment && <div className="prs-detail-review-comment">{review.comment}</div>}
    </div>
  );
}

function toneColor(tone) {
  switch (tone) {
    case 'ok': return 'var(--ok)';
    case 'info': return 'var(--info)';
    case 'gold': return 'var(--gold)';
    case 'warn': return 'var(--amber)';
    case 'mute': return 'var(--t-3)';
    default: return 'var(--t-1)';
  }
}
