/**
 * ASGARD CRM — Mobile Widget: Приветствие
 */
window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.welcome = {
  name: 'Приветствие', icon: '👋', size: 'normal', roles: ['*'],
  render: function (container, user) {
    var el = Utils.el;
    var t = DS.t;
    var hour = new Date().getHours();
    var greeting = hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
    var firstName = ((user.name || user.login || '').split(' ')[0]) || 'Воин';
    var quotes = [
      '«Не бойся медленного продвижения — бойся остановки»',
      '«Лучше быть волком один день, чем овцой всю жизнь»',
      '«Дела говорят громче рун»',
      '«В бурю кормчий познаётся»',
      '«Сильный духом побеждает сильного телом»',
      '«Каждый день — поход за славой»',
      '«Кто рано встаёт, тому Один даёт»',
      '«Мудрый путник далеко не заходит в одиночку»'
    ];
    var quote = quotes[Math.floor(Math.random() * quotes.length)];
    var dateStr = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    var wrap = el('div');
    wrap.appendChild(el('div', { style: Object.assign({}, DS.font('lg'), { color: t.text }) }, greeting + ', ' + firstName + '! 👋'));
    wrap.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.textSec, marginTop: '4px' }) }, dateStr));
    wrap.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.gold, marginTop: '8px', fontStyle: 'italic' }) }, quote));
    container.replaceChildren(wrap);
  }
};
