/* ═══ Экраны прототипа. Только классы app.css, ноль инлайн-стилей.
   home-full — ТОЧНАЯ структура реальной главной страницы рабочего
   (public/mobile-app/src/pages/field/FieldHome.jsx), только перекрашена
   в новую систему. Порядок блоков = как в коде. ═══ */
(function () {
  const ic = window.icon;

  /* Шапка экрана с «назад» / без. */
  const bar = (title, sub, right, back) => `
    <header class="topbar">
      ${back !== false ? `<button class="iconbtn" aria-label="Назад">${ic('back', 20)}</button>` : ''}
      <div style="flex:1;min-width:0">
        <div class="topbar__t">${title}</div>
        ${sub ? `<div class="topbar__s">${sub}</div>` : ''}
      </div>
      ${right || ''}
    </header>`;

  /* ── ГЛАВНАЯ (полная, как в реальном приложении) ─────────────────────────── */
  function homeFull() {
    const action = (ico, label) => `
      <button class="qa"><span class="qa__i">${ic(ico, 20)}</span><span class="qa__l">${label}</span></button>`;
    const gameTile = (ico, label, tone, badge) => `
      <button class="tile tile--wide ${tone}">
        <span class="tile__ico">${ic(ico, 24)}</span>
        <span style="flex:1;min-width:0"><span class="tile__t" style="display:block">${label}</span></span>
        ${badge ? `<span class="badge badge--gold">${badge}</span>` : ''}
        <span class="row__chev">${ic('chev', 20)}</span>
      </button>`;
    return `
    <div class="app">
      ${bar('Главная', null, `<button class="iconbtn">${ic('bell', 20)}</button>`, false)}
      <div class="body">

        <!-- 1. Приветствие + цитата -->
        <div class="greet">
          <div class="greet__t">Добрый день, Никита, Хускарл!</div>
          <div class="greet__d">пятница, 16 октября</div>
          <div class="greet__q">«В бурю кормчий познаётся»</div>
        </div>

        <!-- 2. Баннер «Новая игра» -->
        <button class="promo">
          <span class="promo__ico">${ic('beaker', 26)}</span>
          <span style="flex:1;min-width:0">
            <span class="promo__k">Новая игра · Химцех</span>
            <span class="promo__t">Переливай реагенты по протоколу</span>
            <span class="promo__s">Ошибка = взрыв на весь экран</span>
          </span>
          <span class="btn btn--gold btn--sm">Играть</span>
        </button>

        <!-- 3. Активный проект -->
        <div class="card">
          <div class="card__k">${ic('map', 15)} Активный проект</div>
          <div class="card__t">Монтаж металлоконструкций, склад B</div>
          <div class="card__s">Киров · объект «Дружба»</div>
          <div class="chiprow">
            <span class="pillchip">${ic('phone', 12)} РП: Путков Д.</span>
            <span class="pillchip">${ic('phone', 12)} Маст.: Егоров С.</span>
          </div>
          <div class="mlsp">
            <div class="mlsp__k">МЛСП · 24 дня на платформе</div>
            <div class="mlsp__s">Заезд: 22.09 · Вывоз: 20.10 · осталось 4 дн</div>
          </div>
        </div>

        <!-- 4. Готовность -->
        <button class="card card--row card--ok">
          <span class="card__ico">${ic('shield', 20)}</span>
          <span style="flex:1;min-width:0"><span class="card__t">Готов к смене</span><span class="card__s">Статус подтверждён сегодня</span></span>
          <span class="pillchip">Изменить</span>
        </button>

        <!-- 5. Академия — напоминание -->
        <button class="card card--row card--warn">
          <span class="card__ico">${ic('book', 20)}</span>
          <span style="flex:1;min-width:0"><span class="card__t">Пройди Испытание до воскресенья</span><span class="card__s">«Техника безопасности при высоте» · осталось 2 дн</span></span>
          <span class="row__chev">${ic('chev', 18)}</span>
        </button>

        <!-- 6. Смена -->
        <div class="card">
          <div style="text-align:center;margin-bottom:14px">
            <div class="card__k" style="justify-content:center">Смена идёт</div>
            <div class="shift-timer tnum">03:42:18</div>
          </div>
          <button class="btn btn--danger btn--block">${ic('square', 18)} Завершить смену</button>
        </div>

        <!-- 7. Тариф -->
        <div class="card card--nested">
          <div class="card__k">Тариф</div>
          <div class="card__t">Монтажник · 4 балла</div>
          <div class="card__s">+ Совмещение: стропальщик (+1 балл)</div>
        </div>

        <!-- 8. Геймификация -->
        <div class="section section--accent">Геймификация</div>
        <div class="bento">
          ${gameTile('gamepad', 'Игры', 'tile--hero tile--violet', 'NEW')}
          ${gameTile('shop', 'Магазин', 'tile--warn')}
          ${gameTile('gift', 'Инвентарь', 'tile--blue')}
          ${gameTile('book', 'Чертоги Мимира', 'tile--violet')}
          ${gameTile('swords', 'Квесты', 'tile--violet')}
          ${gameTile('trophy', 'Рейтинг', 'tile--gold')}
        </div>

        <!-- 9. Мимир -->
        <div class="banner banner--info">
          <span style="color:var(--info)">${ic('sparkle', 20)}</span>
          <div><div class="banner__t">Мимир говорит</div><div class="banner__s">Закрой смену до 20:00 — сохранишь полный балл за день</div></div>
        </div>

        <!-- 10. Мой рейтинг -->
        <button class="card card--row card--gold">
          <span class="card__ico" style="background:var(--tint-gold);color:var(--gold)">${ic('trophy', 20)}</span>
          <span style="flex:1;min-width:0"><span class="card__t">Мой рейтинг: #12 из 248</span><span class="card__s">Хускарл · 640 ᚱ заработано</span></span>
          <span class="row__chev" style="color:var(--gold)">${ic('chev', 18)}</span>
        </button>

        <!-- 11. Быстрые действия -->
        <div class="section">Быстрые действия</div>
        <div class="qa-grid">
          ${action('briefcase', 'Мои работы')}
          ${action('clock', 'Табель')}
          ${action('users', 'Бригада')}
          ${action('map', 'Маршрут')}
          ${action('truck', 'Поездки')}
          ${action('camera', 'Фото')}
          ${action('box', 'Сбор паллет')}
          ${action('scroll', 'Наряды')}
        </div>

        <div class="brandline"></div>
      </div>
    </div>`;
  }

  /* ── Компактный хаб (тёмная + светлая витрина) ───────────────────────────── */
  function home() {
    const wide = (ico, t, s, tone) => `
      <button class="tile tile--wide ${tone || ''}">
        <span class="tile__ico">${ic(ico, 24)}</span>
        <span style="flex:1;min-width:0"><span class="tile__t" style="display:block">${t}</span>${s ? `<span class="tile__s" style="display:block">${s}</span>` : ''}</span>
        <span class="row__chev">${ic('chev', 20)}</span>
      </button>`;
    const tile = (ico, t, tone) => `
      <button class="tile ${tone || ''}"><span class="tile__ico">${ic(ico, 22)}</span><span class="tile__t">${t}</span></button>`;
    return `
    <div class="app">
      ${bar('Смена', 'Объект «Дружба» · бригада №4', `<button class="iconbtn">${ic('bell', 20)}</button>`, false)}
      <div class="body">
        <div class="hero">
          <div class="hero__lbl"><span class="pulse-dot"></span>Смена идёт · 08:00–20:00</div>
          <div class="hero__val tnum">3:42</div>
          <div class="hero__sub">Отработано сегодня · перерыв 1 ч · до конца 8 ч 18 м</div>
        </div>
        <button class="btn btn--primary btn--block">${ic('clock', 20)} Отметить выход</button>
        <div class="kpis">
          <div class="kpi kpi--blue"><div class="kpi__ico">${ic('money', 20)}</div><div class="kpi__lbl">К выплате</div><div class="kpi__val tnum">128 400 ₽</div><div class="kpi__note">за октябрь</div></div>
          <div class="kpi kpi--violet"><div class="kpi__ico">${ic('clock', 20)}</div><div class="kpi__lbl">Смен</div><div class="kpi__val tnum">18 / 22</div><div class="kpi__note">закрыто</div></div>
        </div>
        <div class="bento">
          ${wide('briefcase', 'Мои работы', '6 активных объектов', 'tile--hero tile--blue')}
          ${wide('scroll', 'Наряды', '3 новых', 'tile--blue')}
          ${tile('camera', 'Фото', 'tile--teal')}
          ${tile('box', 'Сбор паллет', 'tile--warn')}
          ${tile('packageCheck', 'Приёмка', 'tile--ok')}
          ${tile('wallet', 'Подотчёт', 'tile--red')}
        </div>
      </div>
    </div>`;
  }

  function money() {
    const row = (t, s, v, cls) => `
      <div class="row" style="cursor:default">
        <span class="row__main"><span class="row__t">${t}</span><span class="row__s">${s}</span></span>
        <span class="row__val ${cls || ''}">${v}</span>
      </div>`;
    return `
    <div class="app">
      ${bar('Мои деньги', 'Начисления и выплаты', `<button class="iconbtn">${ic('more', 20)}</button>`)}
      <div class="body">
        <div class="hero"><div class="hero__lbl">К выплате за октябрь</div><div class="hero__val tnum">88 200 ₽</div><div class="hero__sub">Выплата 5 ноября · способ: на карту</div></div>
        <div class="kpis">
          <div class="kpi kpi--ok"><div class="kpi__ico">${ic('money', 20)}</div><div class="kpi__lbl">Выплачено</div><div class="kpi__val tnum">40 200 ₽</div><div class="kpi__note">аванс 20 окт</div></div>
          <div class="kpi kpi--warn"><div class="kpi__ico">${ic('clock', 20)}</div><div class="kpi__lbl">В работе</div><div class="kpi__val tnum">18 см.</div><div class="kpi__note">закрыто</div></div>
        </div>
        <div class="chips">
          <button class="chip" aria-pressed="true">Октябрь</button><button class="chip">Сентябрь</button><button class="chip">Август</button>
        </div>
        <div class="card">
          <div class="card__h"><div class="card__t">Из чего складывается</div></div>
          <div class="list" style="box-shadow:none;border-radius:var(--r-ctl)">
            ${row('Сдельно', '18 смен · 6 объектов', '96 200 ₽')}
            ${row('Премия', 'за качество, сентябрь', '12 000 ₽')}
            ${row('Аванс', 'выдан 20 октября', '−20 000 ₽', 'muted')}
          </div>
          <div class="between" style="padding-top:14px;margin-top:6px;border-top:1px solid var(--line)">
            <span class="row__t">Итого к выплате</span><span class="row__val tnum">88 200 ₽</span>
          </div>
        </div>
      </div>
    </div>`;
  }

  function profile() {
    return `
    <div class="app">
      ${bar('Профиль', null, `<button class="iconbtn">${ic('more', 20)}</button>`)}
      <div class="body">
        <div class="card" style="display:flex;align-items:center;gap:14px">
          <div class="row__ico" style="width:56px;height:56px;background:var(--tint-gold);color:var(--gold)">${ic('userCircle', 30)}</div>
          <div style="flex:1;min-width:0"><div class="card__t">Андросов Никита</div><div class="card__s">Монтажник · бригада №4</div></div>
          <span class="badge badge--gold">${ic('trophy', 12)} Хускарл</span>
        </div>
        <div class="card" style="position:relative;overflow:hidden">
          <span class="hero__accent--gold"></span>
          <div class="card__h" style="margin-bottom:14px"><div class="card__t">Ранг и прогресс</div><span class="badge badge--gold">VIP</span></div>
          <div class="between" style="margin-bottom:10px"><span class="card__s">Хускарл → Ярл</span><span class="card__s tnum">640 / 900 XP</span></div>
          <div class="progress"><div class="progress__f" style="width:71%;background:var(--grad-gold)"></div></div>
        </div>
        <div class="list">
          <button class="row"><span class="row__ico">${ic('receipt', 18)}</span><span class="row__main"><span class="row__t">Реквизиты и выплаты</span><span class="row__s">Карта •••• 4417</span></span><span class="row__chev">${ic('chev', 18)}</span></button>
          <button class="row"><span class="row__ico">${ic('shield', 18)}</span><span class="row__main"><span class="row__t">Допуски</span><span class="row__s">3 активных</span></span><span class="row__chev">${ic('chev', 18)}</span></button>
        </div>
        <div class="brandline"></div>
      </div>
    </div>`;
  }

  window.SCREENS = {
    'home-full': { title: 'Главная (полная)', render: homeFull, full: true },
    home: { title: 'Хаб', render: home },
    money: { title: 'Мои деньги', render: money },
    profile: { title: 'Профиль', render: profile },
  };
})();
