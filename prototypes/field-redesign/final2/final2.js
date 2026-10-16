/* ═══════════════════════════════════════════════════════════════════════════
   ФИНАЛ 2 варианта: V1 Ozon Clean (тёмная) · V4 Frostlight (светлая)
   1:1 структура боевой главной FieldHome.jsx + КАСТОМНЫЙ объёмный щит ASGARD.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const ic = window.icon;
  /* Плитка-иконка. tone: '' (нейтраль) | 'accent' (действие) | 'value' (заработано) | 'danger' | 'status' */
  const i3d = (name, size, tone, box) =>
    `<span class="i3d${tone ? ' i3d--' + tone : ''}" style="width:${box}px;height:${box}px">${ic(name, size)}</span>`;

  const sb = `
    <div class="statusbar"><span class="statusbar__t">9:41</span>
      <span class="statusbar__i">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect y="7" width="3" height="5" rx="1"/><rect x="4" y="5" width="3" height="7" rx="1"/><rect x="8" y="2.5" width="3" height="9.5" rx="1"/><rect x="12" y="0" width="3" height="12" rx="1"/></svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 11.2 5.6 8.6a3.4 3.4 0 0 1 4.8 0zM3.3 6.2a6.8 6.8 0 0 1 9.4 0l-1.5 1.6a4.6 4.6 0 0 0-6.4 0zM.9 3.7a10.2 10.2 0 0 1 14.2 0L13.6 5.3a8 8 0 0 0-11.2 0z"/></svg>
        <svg width="26" height="12" viewBox="0 0 26 12" fill="none"><rect x=".6" y=".6" width="21" height="10.8" rx="3" stroke="currentColor" stroke-opacity=".5" stroke-width="1.1"/><rect x="2.2" y="2.2" width="15" height="7.6" rx="1.6" fill="currentColor"/><rect x="23" y="4" width="1.7" height="4" rx=".85" fill="currentColor" fill-opacity=".55"/></svg>
      </span></div><div class="island"></div>`;

  /* ── Кастомный объёмный щит ASGARD (не простой патч: фацеты, бевел, руна) ── */
  let _sid = 0;
  const shield = (s) => {
    const u = 'sh' + (_sid++);
    return `
    <svg class="shield" width="${s}" height="${s * 1.1}" viewBox="0 0 40 44" aria-hidden="true">
      <defs>
        <linearGradient id="${u}b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#7FB6FF"/><stop offset=".5" stop-color="#2F7BFF"/><stop offset="1" stop-color="#1447AE"/></linearGradient>
        <linearGradient id="${u}r" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#FF8593"/><stop offset=".5" stop-color="#E5484D"/><stop offset="1" stop-color="#971B2E"/></linearGradient>
        <linearGradient id="${u}g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#FFF3C4"/><stop offset=".48" stop-color="#F0C24A"/><stop offset="1" stop-color="#A9780F"/></linearGradient>
        <linearGradient id="${u}v" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".42" stop-color="#fff" stop-opacity="0"/></linearGradient>
        <clipPath id="${u}c"><path d="M20 1.6 37.4 7v12.1C37.4 28.7 29.9 35.9 20 39.5 10.1 35.9 2.6 28.7 2.6 19.1V7z"/></clipPath>
      </defs>
      <!-- корпус -->
      <path d="M20 1.6 37.4 7v12.1C37.4 28.7 29.9 35.9 20 39.5 10.1 35.9 2.6 28.7 2.6 19.1V7z" fill="#08101E"/>
      <g clip-path="url(#${u}c)">
        <rect x="2.6" y="1.6" width="18.2" height="39" fill="url(#${u}b)"/>
        <rect x="20.4" y="1.6" width="17.4" height="39" fill="url(#${u}r)"/>
        <path d="M20 1.6v38.2" stroke="#F0C24A" stroke-opacity=".55" stroke-width=".8"/>
        <rect x="2.6" y="1.6" width="35.2" height="15" fill="url(#${u}v)"/>
        <path d="M2.6 24c4 8 10 12.6 17.4 15.5 7.4-2.9 13.4-7.5 17.4-15.5v-2.9c-4.6 8.6-10.6 12.7-17.4 15-6.8-2.3-12.8-6.4-17.4-15z" fill="#000" fill-opacity=".22"/>
        <path d="M20 1.6 37.4 7v12.1C37.4 28.7 29.9 35.9 20 39.5 10.1 35.9 2.6 28.7 2.6 19.1V7z" fill="none" stroke="url(#${u}g)" stroke-width="1.7"/>
        <path d="M20 4.6 34.6 9.3v9.6c0 6.8-5.9 12.6-14.6 15.6z" fill="#fff" fill-opacity=".06"/>
      </g>
      <!-- руна ASGARD (золото с объёмом) -->
      <g>
        <path d="M20 11.4 22 17.9l6.8.3-5.4 4.2 1.9 6.6-5.3-3.9-5.3 3.9 1.9-6.6-5.4-4.2 6.8-.3z"
          fill="url(#${u}g)" stroke="#6E4E0A" stroke-width=".6"/>
        <path d="M20 11.4 22 17.9l6.8.3-5.4 4.2 1.9 6.6-5.3-3.9z" fill="#fff" fill-opacity=".28"/>
      </g>
    </svg>`;
  };

  const orbs = `<span class="orb orb--a"></span><span class="orb orb--b"></span><span class="orb orb--c"></span>`;

  const shieldSm = (s) => shield(s);

  function home({ live }) {
    return `
    <div class="app"><div class="body">

      <!-- 1. Приветствие + кастомный щит-лого -->
      <div class="fh-greet">
        <div class="fh-greet__row" style="display:flex;align-items:center;gap:12px">
          <div style="flex:1;min-width:0">
            <div class="fh-h1">Добрый день, Никита, <span class="fh-rankword">Хускарл</span>!</div>
            <div class="fh-date">пятница, 16 октября</div>
          </div>
          <span class="fh-logo">${shield(40)}</span>
        </div>
        <div class="fh-quote">«В бурю кормчий познаётся»</div>
      </div>

      <!-- 2. Промо «Химцех» с бегущим бликом + × закрыть -->
      <button class="fh-promo">
        <span class="fh-promo__sheen"></span>
        <span class="fh-promo__ico">${ic('beaker', 26)}</span>
        <span class="fh-promo__txt">
          <span class="fh-promo__k">Новая игра · Химцех</span>
          <span class="fh-promo__t">Переливай реагенты по протоколу</span>
          <span class="fh-promo__s">Ошибка = взрыв на весь экран. Учись на реальных правилах смены</span>
        </span>
        <span class="fh-promo__cta">ИГРАТЬ</span>
        <span class="fh-promo__x">×</span>
      </button>

      <!-- 3. Активный проект + МЛСП -->
      <div class="card">
        <div class="fh-k fh-k--accent">${ic('map', 15)} Активный проект</div>
        <div class="fh-t">Монтаж металлоконструкций, склад B</div>
        <div class="fh-s">Киров · объект «Дружба»</div>
        <div class="fh-chips">
          <span class="fh-chip">${ic('phone', 12)} РП: Путков Д.</span>
          <span class="fh-chip">${ic('phone', 12)} Маст.: Егоров С.</span>
        </div>
        <div class="fh-norns" style="margin-top:12px">
          <span class="i3d i3d--value" style="width:30px;height:30px">${ic('pause', 16)}</span>
          <span style="flex:1"><b style="color:var(--gold)">МЛСП</b> · 24 дн. на платформе · осталось 4 дн</span>
        </div>
      </div>

      <!-- 4. Планируемое привлечение -->
      <div class="card card--nested">
        <div class="fh-k fh-k--accent">${ic('scroll', 15)} Планируемое привлечение</div>
        <div class="fh-t">Сборка каркаса, цех №2</div>
        <div class="fh-s">РП: Смирнов А.</div>
        <div class="fh-s">${ic('clock', 12)} с 01.11.2026 по 14.11.2026</div>
        <div class="fh-planned-note">Это план, не назначение. Смена начнётся после выезда на объект.</div>
      </div>

      <!-- 5. Готовность (зелёный — только статус) -->
      <button class="fh-ready">
        ${i3d('shield', 22, 'status', 44)}
        <span style="flex:1;min-width:0">
          <span class="fh-ready__t">Готов к походу</span>
          <span class="fh-ready__s">Жду нового объекта</span>
        </span>
        <span class="fh-ready__btn">Изменить</span>
      </button>

      <!-- 6. Этап поездки -->
      <button class="fh-stage">
        <div class="fh-stage__t">${ic('truck', 15)} Дорога</div>
        <div class="fh-stage__s">2-й день</div>
        <div class="fh-stage__m">Подробнее →</div>
      </button>

      <!-- 7. Академия (обязательная задача = синий) -->
      <button class="fh-academy">
        ${i3d('book', 20, 'accent', 40)}
        <span style="flex:1">
          <span class="fh-academy__t">Пройди Испытание до воскресенья</span>
          <span class="fh-academy__s">«Техника безопасности при высоте» · осталось 2д</span>
        </span>
        <span class="fh-chev">→</span>
      </button>

      <!-- 8. Смена -->
      <div class="card card--shift">
        ${live ? `
          <div class="fh-shift__lbl fh-live"><span class="fh-live__dot"></span> Смена идёт</div>
          <div class="fh-shift__timer">03:42:18</div>
          <button class="key key--danger" style="width:100%;min-height:50px;font-size:15px">${ic('square', 16)} Завершить смену</button>
        ` : `
          <div class="fh-shift__lbl">Смена не начата</div>
          <div class="fh-shift__sub">08:00–20:00 · объект «Дружба»</div>
          <button class="key key--cta" style="width:100%;min-height:50px;font-size:15px">${ic('play', 16)} Начать смену</button>
        `}
      </div>

      <!-- 9. Тариф -->
      <div class="card card--nested">
        <div class="fh-k">Тариф</div>
        <div class="fh-t">Монтажник · 4 балла</div>
        <div class="fh-s fh-s--accent">+ Совмещение: стропальщик (+1 балл)</div>
      </div>

      <!-- 10. Геймификация: нейтральные плитки + числовой чип прогресса (без новых hue) -->
      <div class="fh-section">Геймификация</div>
      <div class="fh-grid2">
        <button class="fh-tile">${i3d('gamepad', 22, '', 42)}<span class="fh-tile__t tile-t">Игры</span><span class="fh-tile__xp">3 игры</span><span class="fh-tile__badge">NEW</span></button>
        <button class="fh-tile">${i3d('shop', 22, '', 42)}<span class="fh-tile__t tile-t">Магазин</span><span class="fh-tile__xp">640 ᚱ</span></button>
        <button class="fh-tile">${i3d('gift', 22, '', 42)}<span class="fh-tile__t tile-t">Инвентарь</span><span class="fh-tile__xp">12</span></button>
        <button class="fh-tile">${i3d('book', 22, '', 42)}<span class="fh-tile__t tile-t">Чертоги Мимира</span><span class="fh-tile__xp">4 / 9</span></button>
        <button class="fh-tile">${i3d('swords', 22, '', 42)}<span class="fh-tile__t tile-t">Квесты</span><span class="fh-tile__xp">2 / 5</span></button>
        <button class="fh-tile fh-tile--season">${i3d('flame', 22, '', 42)}<span class="fh-tile__t">Сезон</span><span class="fh-tile__xp">18 дн</span><span class="fh-tile__badge">NEW</span></button>
        <button class="fh-tile">${i3d('trophy', 22, '', 42)}<span class="fh-tile__t tile-t">Рейтинг</span><span class="fh-tile__xp">#12</span></button>
        <button class="fh-tile">${i3d('map', 22, '', 42)}<span class="fh-tile__t tile-t">Подвиги</span><span class="fh-tile__xp">7 / 20</span></button>
      </div>

      <!-- 11. Мимир (совет системы = синий) -->
      <div class="fh-mimir">
        ${i3d('sparkle', 22, 'accent', 44)}
        <div><div class="fh-mimir__k">Мимир говорит</div>
        <div class="fh-mimir__t">Закрой смену до 20:00 — сохранишь полный балл за день</div></div>
      </div>

      <!-- 12. Мой рейтинг + прогресс XP (золото — единственная крупная золотая поверхность) -->
      <button class="fh-rank">
        ${i3d('trophy', 22, 'value', 46)}
        <div style="flex:1;min-width:0">
          <div class="fh-rank__k">Мой рейтинг</div>
          <div class="fh-rank__v">#12 из 248</div>
          <div class="fh-rank__bar"><i style="width:62%"></i></div>
          <div class="fh-rank__s" style="margin-top:6px">Хускарл · 640 ᚱ заработано</div>
        </div>
        <span class="fh-chev" style="color:var(--gold)">›</span>
      </button>

      <!-- 13. Скачать приложение (щит) -->
      <a class="fh-download">
        <span class="fh-download__ic">${shield(30)}</span>
        <span style="flex:1;min-width:0">
          <span class="fh-download__t">Скачать приложение ASGARD</span>
          <span class="fh-download__s">Работай без браузера — быстрее и надёжнее</span>
        </span>
        <span class="fh-download__cta">Скачать</span>
      </a>

      <!-- 14. Быстрые действия: 10 нейтральных + золото (деньги) + красный (риск) -->
      <div class="fh-section">Быстрые действия</div>
      <div class="fh-grid4">
        <button class="fh-qa">${i3d('briefcase', 20, '', 38)}<span class="fh-qa__l">Мои работы</span></button>
        <button class="fh-qa">${i3d('clock', 20, '', 38)}<span class="fh-qa__l">Табель</span></button>
        <button class="fh-qa">${i3d('users', 20, '', 38)}<span class="fh-qa__l">Бригада</span></button>
        <button class="fh-qa">${i3d('map', 20, '', 38)}<span class="fh-qa__l">Маршрут</span></button>
        <button class="fh-qa">${i3d('truck', 20, '', 38)}<span class="fh-qa__l">Поездки</span></button>
        <button class="fh-qa">${i3d('camera', 20, '', 38)}<span class="fh-qa__l">Фото</span></button>
        <button class="fh-qa">${i3d('box', 20, '', 38)}<span class="fh-qa__l">Паллеты</span></button>
        <button class="fh-qa">${i3d('scroll', 20, '', 38)}<span class="fh-qa__l">Наряды</span></button>
        <button class="fh-qa">${i3d('file', 20, '', 38)}<span class="fh-qa__l">Отчёт</span></button>
        <button class="fh-qa">${i3d('alert', 20, 'danger', 38)}<span class="fh-qa__l">Инцидент</span></button>
        <button class="fh-qa">${i3d('wallet', 20, 'value', 38)}<span class="fh-qa__l">Подотчёт</span></button>
        <button class="fh-qa">${i3d('packageCheck', 20, '', 38)}<span class="fh-qa__l">Приёмка</span></button>
        <button class="fh-qa">${i3d('userCircle', 20, '', 38)}<span class="fh-qa__l">Профиль</span></button>
      </div>

      <!-- Брендовая линия синий→красный -->
      <div class="fh-brandline"></div>
    </div></div>`;
  }

  window.FINAL2 = [
    { id: 'f2', skin: 'skin-ozon', name: '1 · Ozon Clean', note: 'тёмная · electric blue + циан · объёмные 3D-иконки и кнопки-клавиши · brand-red в щите, канте и линии', live: true },
    { id: 'f6', skin: 'skin-frost', name: '4 · Frostlight', note: 'светлая · белое стекло + лёд/синий · те же объёмные 3D-иконки · brand-red', live: false, light: true },
  ];

  window.HOME_HTML2 = function (v) {
    return `<div class="screen ${v.skin}"><div class="scene">${orbs}</div>${sb}${home(v)}</div>`;
  };
})();
