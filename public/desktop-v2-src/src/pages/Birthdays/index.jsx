/**
 * Страница /birthdays — дни рождения сотрудников CRM 2.0.
 *
 * Источник: vanilla `public/assets/js/birthdays.js` (~257 строк).
 *
 *   ✅ index.jsx        — табы (Офис/Рабочие) + ближайшие + сетка по месяцам
 *   ✅ api.js           — загрузка из /api/users + /api/staff/employees, утилиты дат, поздравление
 *   ✅ birthdays.css    — оформление карточек, бейджей, грид
 *
 * RBAC:
 *   • Все: видят Офис.
 *   • HR / HR_MANAGER / директора: дополнительно видят Рабочих.
 *
 * Поздравить: создаёт уведомление через POST /api/notifications.
 * Работает только для офисных (есть users.id). Для рабочих — только просмотр.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, TabsBar, EmptyState } from '@/blocks/Blocks';
import { PromptModal } from '@/modals';

import {
  loadOfficeUsers, loadWorkers, buildBirthdayData,
  isDirectorRole, MONTH_NAMES_RU, congratulate
} from './api';
import './birthdays.css';

const CAN_WORKERS_ROLES = ['HR', 'HR_MANAGER'];

export default function BirthdaysPage() {
  const { user } = useAuth();
  const modal = useModal();

  const canWorkers = !!user && (
    CAN_WORKERS_ROLES.includes(user.role) || isDirectorRole(user.role)
  );

  const initialTab = () => {
    const h = window.location.hash || '';
    const m = h.match(/[?&]tab=([^&]+)/);
    const t = m && m[1] ? m[1].toLowerCase() : 'office';
    return (t === 'workers' && canWorkers) ? 'workers' : 'office';
  };

  const [tab, setTab] = useState(initialTab);
  const [office, setOffice] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    const tasks = [
      loadOfficeUsers().then(setOffice).catch(() => setOffice([]))
    ];
    if (canWorkers) {
      tasks.push(loadWorkers().then(setWorkers).catch(() => setWorkers([])));
    }
    Promise.all(tasks).finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (user) refresh(); }, [user?.id, user?.role]);

  // Синхронизация tab с hash
  useEffect(() => {
    const url = `#/birthdays${tab === 'workers' ? '?tab=workers' : ''}`;
    if (window.location.hash !== url) {
      try { window.history.replaceState(null, '', url); } catch { /* noop */ }
    }
  }, [tab]);

  const officeData = useMemo(() => buildBirthdayData(
    office,
    'birth_date',
    (u) => u?.name || u?.login || 'Сотрудник',
    (u) => u?.role || ''
  ), [office]);

  const workersData = useMemo(() => buildBirthdayData(
    workers,
    'birth_date',
    (e) => e?.fio || e?.full_name || e?.name || `Сотрудник #${e?.id || ''}`,
    (e) => e?.role_tag || ''
  ), [workers]);

  const data = tab === 'workers' ? workersData : officeData;
  const isOffice = tab === 'office';

  const onCongratulate = (item) => {
    if (!isOffice) {
      toast.info('Поздравление в CRM — только для офисных, рабочих поздравляйте через «Персонал»');
      return;
    }
    const uid = item.raw?.id;
    if (!uid) {
      toast.error('Не нашёл пользователя для отправки уведомления');
      return;
    }
    modal.open(
      <PromptModal
        title="Поздравить с днём рождения"
        subtitle={item.name}
        icon="🎂"
        label="Текст поздравления (можно оставить шаблон)"
        placeholder={`${item.name}, поздравляем с днём рождения! 🎂`}
        initial={`${item.name}, поздравляем с днём рождения! 🎂`}
        multiline
        okText="Отправить"
        onSubmit={async (text) => {
          try {
            await congratulate(uid, item.name, text);
            toast.success('Поздравление отправлено');
          } catch (e) {
            toast.error('Не удалось отправить: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const tabs = [
    { id: 'office',  label: '👔 Офис',    count: officeData.total },
    ...(canWorkers ? [{ id: 'workers', label: '🔨 Рабочие', count: workersData.total }] : [])
  ];

  return (
    <div className="bday-page">
      <TopActionsBar
        kicker="Дни рождения"
        title={isOffice ? 'Офис · Дни рождения' : 'Рабочие · Дни рождения'}
        subtitle={`${data.total} ${pluralize(data.total, ['сотрудник', 'сотрудника', 'сотрудников'])} с указанной датой рождения`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={() => { window.location.hash = '#/alerts'; }}>🔔 Уведомления</Btn>
            {isOffice
              ? <Btn variant="ghost" onClick={() => { window.location.hash = '#/settings?tab=sla'; }}>⚙ Настройки</Btn>
              : <Btn variant="ghost" onClick={() => { window.location.hash = '#/personnel'; }}>👥 Персонал</Btn>}
          </>
        }
      />

      <TabsBar tabs={tabs} active={tab} onChange={setTab} />

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем данные…
        </div>
      ) : data.total === 0 ? (
        <EmptyState
          icon="🎂"
          title="Нет данных по датам рождения"
          hint={isOffice
            ? 'Заполните birth_date у активных пользователей в /personnel.'
            : 'Заполните birth_date у сотрудников в /personnel.'}
          action={null}
        />
      ) : (
        <>
          {/* Ближайшие */}
          <section className="bday-nearest">
            <div className="bday-nearest-head">
              <span className="ic">🎂</span>
              <h3>Ближайшие дни рождения</h3>
            </div>
            {data.nearest.length === 0 ? (
              <div className="c-t3 fs-13">
                В ближайшие дни ДР нет
              </div>
            ) : (
              <div className="bday-nearest-grid">
                {data.nearest.map((it) => (
                  <BdayCard key={`${it.id}-${it.birth_date}`} item={it} isOffice={isOffice} onCong={onCongratulate} />
                ))}
              </div>
            )}
          </section>

          {/* По месяцам */}
          <section className="bday-months">
            {Array.from(data.byMonth.keys())
              .sort((a, b) => a - b)
              .map((m) => {
                const arr = data.byMonth.get(m) || [];
                if (!arr.length) return null;
                const isNow = (new Date().getMonth() + 1) === m;
                return (
                  <div key={m} className={'bday-month ' + (isNow ? 'now' : '')}>
                    <h3 className="bday-month-title">
                      {MONTH_NAMES_RU[m - 1]}
                      <span className="cnt">{arr.length}</span>
                    </h3>
                    <div className="bday-list">
                      {arr.map((x, idx) => (
                        <div key={`${x.id}-${idx}`} className="bday-li">
                          <span className="bday-li-day">{x.d}</span>
                          <div>
                            <div className="bday-li-name">{x.name || '—'}</div>
                            {x.role && <div className="bday-li-role">{x.role}</div>}
                          </div>
                          <span className="fs-11 c-t3 font-mono">
                            {x.days === 0 ? 'сегодня' : `${x.days} дн`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
          </section>
        </>
      )}
    </div>
  );
}

function BdayCard({ item, isOffice, onCong }) {
  const today = item.days === 0;
  const soon = item.days > 0 && item.days <= 7;
  const cls = today ? 'today' : (soon ? 'soon' : '');
  const whenCls = today ? 'today' : (soon ? 'soon' : '');
  const whenTxt = today ? 'Сегодня 🎉' : `через ${item.days} дн.`;
  return (
    <div className={'bday-card ' + cls}>
      <div className="bday-card-ava">🎂</div>
      <div className="bday-card-body">
        <div className="bday-card-name">{item.name || '—'}</div>
        {item.role && <div className="bday-card-meta">{item.role}</div>}
        <span className={'bday-card-when ' + whenCls}>{whenTxt}</span>
      </div>
      {isOffice && (
        <button
          className="bday-card-cong"
          onClick={() => onCong(item)}
          title="Отправить поздравление через CRM"
        >Поздравить</button>
      )}
    </div>
  );
}

function pluralize(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
