/**
 * PmTimesheet — табель моей дружины для РП.
 * Использует единый <TimesheetMobile mode="pm" /> + PmTabBar.
 *
 * Маршрут: /pm/timesheet и /my-timesheet (см. App.jsx).
 */
import TimesheetMobile from '@/pages/timesheet/TimesheetMobile';
import PmTabBar from '@/components/pm/PmTabBar';

export default function PmTimesheet() {
  return (
    <div style={{ minHeight: '100vh', paddingBottom: 'calc(var(--tabbar-total) + 16px)' }}>
      <TimesheetMobile mode="pm" />
      <PmTabBar />
    </div>
  );
}
