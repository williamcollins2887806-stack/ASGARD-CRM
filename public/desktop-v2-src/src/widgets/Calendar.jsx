export default function Calendar() {
  const d = new Date();
  return (
    <div className="cal-w">
      <div className="month">
        {d.toLocaleString('ru-RU', { month: 'long', year: 'numeric' })}
      </div>
      <div className="day">{d.getDate()}</div>
      <div className="wd">{d.toLocaleString('ru-RU', { weekday: 'long' })}</div>
      <a className="widget-link" href="/#/calendar">Календарь →</a>
    </div>
  );
}
