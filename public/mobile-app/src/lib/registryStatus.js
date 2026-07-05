/** Registry status constants — sync with backend tender-registry-helpers */

export const REGISTRY_STATUSES = [
  'рассмотрение',
  'готовим',
  'подались',
  'проиграли',
  'отмена',
  'выиграли',
];

export const REGISTRY_STATUS_LABELS = {
  рассмотрение: 'Рассмотрение',
  готовим: 'Готовим',
  подались: 'Подались',
  проиграли: 'Проиграли',
  отмена: 'Отмена',
  выиграли: 'Выиграли',
};

export const REGISTRY_STATUS_COLORS = {
  рассмотрение: 'var(--text-tertiary)',
  готовим: 'var(--blue)',
  подались: 'var(--gold)',
  проиграли: 'var(--red-soft)',
  отмена: 'var(--text-tertiary)',
  выиграли: 'var(--green)',
};

export const SOURCE_META = {
  platform:      { ic: '📡',  label: 'С площадки',   fg: 'var(--blue)',  bg: 'rgba(74,144,217,0.13)' },
  tenderguru:    { ic: '📡',  label: 'TenderGuru',   fg: 'var(--blue)',  bg: 'rgba(74,144,217,0.13)' },
  email_invite:  { ic: '📧✨', label: 'AI-письмо',    fg: 'var(--gold)',  bg: 'rgba(200,168,78,0.13)' },
  email_request: { ic: '📧',  label: 'Письмо',       fg: 'var(--blue)',  bg: 'rgba(74,144,217,0.10)' },
  phone:         { ic: '📞',  label: 'Звонок',       fg: 'var(--green)', bg: 'rgba(48,209,88,0.11)' },
  pm_manual:     { ic: '👤',  label: 'От РП',        fg: 'var(--gold)',  bg: 'rgba(200,168,78,0.10)' },
  to_manual:     { ic: '🛡',  label: 'От ТО',        fg: 'var(--blue)',  bg: 'rgba(74,144,217,0.13)' },
  manual:        { ic: '✍️',  label: 'Вручную',      fg: 'var(--text-tertiary)', bg: 'rgba(142,142,147,0.10)' },
};

export const TO_ROLES = ['TO', 'HEAD_TO', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export function isToRole(role) {
  return TO_ROLES.includes(role);
}

export function computeRegistryKpi(rows = []) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const month30 = todayMs - 30 * 86400000;
  let inboxToday = 0;
  let inWork = 0;
  let burn = 0;
  let addendum = 0;
  let wonMonth = 0;
  let lostMonth = 0;

  const ACTIVE_STATUSES = new Set([
    'Новый', 'На анализе', 'Отправлено на просчёт', 'Согласование ТКП',
    'ТКП согласовано', 'Готово к отправке КП', 'КП отправлено', 'Дозапрос',
  ]);

  for (const t of rows) {
    const created = t.created_at && new Date(t.created_at).getTime();
    const wonMs = t.won_at ? new Date(t.won_at).getTime() : created;
    const lostMs = t.lost_at ? new Date(t.lost_at).getTime() : created;

    if (Number.isFinite(created) && created >= todayMs) inboxToday++;
    if (t.registry_status === 'подались' && t.tender_status !== 'Не подходит') inWork++;
    if (t.tender_status === 'Дозапрос') addendum++;
    if (t.registry_status === 'выиграли' && Number.isFinite(wonMs) && wonMs >= month30) wonMonth++;
    if (Number.isFinite(lostMs) && lostMs >= month30 && t.registry_status === 'проиграли') lostMonth++;

    const activeRegistry = !['отмена', 'проиграли', 'выиграли'].includes(t.registry_status);
    const dlRaw = t.docs_deadline || t.deadline_at || t.deadline;
    if (activeRegistry && dlRaw) {
      const dl = new Date(dlRaw).getTime();
      if (Number.isFinite(dl)) {
        const days = Math.round((dl - todayMs) / 86400000);
        if (days >= 0 && days <= 3) burn++;
      }
    } else if (ACTIVE_STATUSES.has(t.tender_status) && dlRaw) {
      const dl = new Date(dlRaw).getTime();
      if (Number.isFinite(dl)) {
        const days = Math.round((dl - todayMs) / 86400000);
        if (days >= 0 && days <= 3) burn++;
      }
    }
  }

  const total = wonMonth + lostMonth;
  const win_pct = total > 0 ? Math.round((wonMonth / total) * 100) : null;
  return { inbox_today: inboxToday, in_work: inWork, burn, addendum, won_month: wonMonth, win_pct };
}
