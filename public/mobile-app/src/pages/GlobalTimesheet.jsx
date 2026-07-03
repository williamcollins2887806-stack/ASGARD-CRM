/**
 * GlobalTimesheet — общий табель (директор/админ/бух/HR).
 * Использует единый <TimesheetMobile mode="global" />.
 *
 * Маршрут /global-timesheet → редирект на /timesheet (см. App.jsx).
 */
import TimesheetMobile from '@/pages/timesheet/TimesheetMobile';

export default function GlobalTimesheet() {
  return <TimesheetMobile mode="global" />;
}
