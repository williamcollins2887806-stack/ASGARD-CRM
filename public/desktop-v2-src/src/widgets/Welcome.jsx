import { useMemo } from 'react';

// Те же фразы что в оригинале (custom_dashboard.js renderWelcome)
const GREETINGS = {
  morning: [
    'Вель комен, {n}! Солнце встаёт — и твоя слава.',
    'Хайль, {n}! Утро несёт новые битвы.',
    'Слава Одину, {n} здесь! Да будет день богатым.',
    'Восход приветствует тебя, {n}! К делам!'
  ],
  day: [
    'Хайль, воин {n}! Путь до Вальгаллы идёт через дела.',
    'Тор благословляет, {n}! Продолжай свой поход.',
    'Дружина сильна, {n} на посту! За работу.',
    '{n}, день в разгаре — время крепить славу!'
  ],
  evening: [
    'Вечер, {n}! Время считать добычу дня.',
    'Хайль, {n}! Сумерки близки, но дела не ждут.',
    '{n}, закат зовёт — заверши начатое.',
    'Валькирии поют, {n}. Заканчивай достойно.'
  ],
  night: [
    'Поздний час, {n}! Истинные воины не спят.',
    'Ночь тиха, {n}. Время для мудрых решений.',
    '{n} бодрствует! Один тоже не дремлет.',
    'Звёзды смотрят, {n}. Работай во славу!'
  ]
};

const SAGAS = [
  'План — щит. Факт — сталь.',
  'Срок не ждёт. Действие решает.',
  'Казна любит порядок — держи цифры честными.',
  'Клятва дана — доведи дело до конца.',
  'Время — клинок. Береги его.',
  'Сильнейший — тот, кто держит слово.',
  'Честь дороже золота. Но золото тоже считай.'
];

export default function Welcome({ user }) {
  const { greeting, saga, dateStr } = useMemo(() => {
    const hour = new Date().getHours();
    const full = user?.name || user?.login || 'воин';
    const first = String(full).split(' ')[0];
    const patr = user?.patronymic || '';
    const name = patr ? first + ' ' + patr : full;

    let pool;
    if (hour >= 6 && hour < 12) pool = GREETINGS.morning;
    else if (hour >= 12 && hour < 18) pool = GREETINGS.day;
    else if (hour >= 18 && hour < 22) pool = GREETINGS.evening;
    else pool = GREETINGS.night;
    const g = pool[Math.floor(Math.random() * pool.length)].replace('{n}', name);
    const s = SAGAS[Math.floor(Math.random() * SAGAS.length)];
    const ds = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    return { greeting: g, saga: s, dateStr: ds };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <div className="welcome-w">
      <div className="rune">ᛟ</div>
      <div className="greet">{greeting}</div>
      <div className="role-row">
        <span>{user?.role}</span>
        <span>·</span>
        <span>{dateStr}</span>
      </div>
      <div className="saga">
        <div className="saga-lab">ᚱ Сага дня</div>
        <div className="saga-txt">{saga}</div>
      </div>
      <div className="runes-bottom">ᛟ ᚱ ᚢ ᚷ ᛏ</div>
    </div>
  );
}
