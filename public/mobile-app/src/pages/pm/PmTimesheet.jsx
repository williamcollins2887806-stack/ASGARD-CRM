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
    <div className="scroll-container" style={{ minHeight: '100dvh', maxHeight: '100dvh', overflowY: 'auto', paddingBottom: 'calc(max(0px, var(--tabbar-total) + var(--tabbar-lift, 0px)) + 16px)' }}>
      <TimesheetMobile mode="pm" />
      <PmTabBar />
    </div>
  );
}
