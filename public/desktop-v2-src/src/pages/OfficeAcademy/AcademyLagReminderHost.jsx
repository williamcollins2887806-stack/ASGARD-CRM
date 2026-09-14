/**
 * Еженедельная модалка: «ФИО, вы отстаёте» по обязательным урокам Академии.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { loadReminder, TRACK_LABELS } from '@/pages/OfficeAcademy/api';
import '@/pages/OfficeAcademy/office-academy.css';

function isoWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function storageKey(userId) {
  return `oa_lag_remind_${userId}_${isoWeekKey()}`;
}

function LagModal({ data, onClose, onGo }) {
  const lessons = data.lessons || [];
  return (
    <MCard>
      <MHead
        icon="📜"
        title={`${data.fio || 'Коллега'}, вы отстаёте`}
        subtitle={`Обязательных уроков не сдано: ${data.mandatory_pending || lessons.length}`}
        accent="warn"
        onClose={onClose}
      />
      <MBody>
        <p className="fs-14 c-t2" style={{ margin: 0, lineHeight: 1.6 }}>
          В Залах Асгарда ждут обязательные свитки. Пройдите их на этой неделе — так вы не накопите долг
          и быстрее откроете новые ранги.
        </p>
        <div className="oa-lag-list">
          {lessons.slice(0, 6).map((l) => (
            <div key={l.id} className="oa-lag-item">
              <span className="oa-lag-item-icon">{l.cover_icon || '🏛️'}</span>
              <div>
                <div className="oa-lag-item-title">{l.title}</div>
                <div className="oa-lag-item-meta">
                  {[TRACK_LABELS[l.track] || l.track, l.estimated_minutes ? `⏱ ${l.estimated_minutes} мин` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            </div>
          ))}
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={onClose}>Позже</Btn>
        <Btn variant="primary" onClick={onGo}>Пройти сейчас</Btn>
      </MFoot>
    </MCard>
  );
}

export default function AcademyLagReminderHost() {
  const { user } = useAuth();
  const { open, close } = useModal();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!user?.id || checked) return;
    const key = storageKey(user.id);
    if (localStorage.getItem(key)) {
      setChecked(true);
      return;
    }

    let cancelled = false;
    const t = setTimeout(() => {
      loadReminder()
        .then((d) => {
          if (cancelled || !d?.show) {
            localStorage.setItem(key, '1');
            return;
          }
          const tryOpen = (attempts = 0) => {
            if (cancelled) return;
            if (document.querySelector('.modal-stack-root .m-card') && attempts < 20) {
              setTimeout(() => tryOpen(attempts + 1), 1600);
              return;
            }
            localStorage.setItem(key, '1');
            if (document.querySelector('.modal-stack-root .m-card')) return;
            open(
              <LagModal
                data={d}
                onClose={() => close()}
                onGo={() => {
                  close();
                  navigate('/office-academy');
                }}
              />,
              { size: 'md' }
            );
            setChecked(true);
          };
          tryOpen();
        })
        .catch(() => { /* ignore */ })
        .finally(() => setChecked(true));
    }, 1800);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [user?.id, checked, open, close, navigate]);

  return null;
}
