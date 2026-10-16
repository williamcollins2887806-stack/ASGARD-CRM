/* ═══════════════════════════════════════════════════════════════════════════
   ASGARD FIELD — 4 ФИНАЛЬНЫХ ВАРИАЦИИ ГЛАВНОЙ, 1:1 с FieldHome.jsx
   Порядок блоков = как в боевом файле:
     1 greeting+quote · 2 chem-lab · 3 активный проект+МЛСП
     4 планируемое привлечение · 5 готовность (5 состояний) · 6 этап поездки
     7 академия · 8 смена (идёт ИЛИ начать) · 9 тариф · 10 Норны
     11 геймификация · 12 Мимир · 13 рейтинг · 14 быстрые действия (13)
   КРАСНЫЙ разделён: brand-red (статика: щит/кант/линия) vs danger (кнопка).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const ic = window.icon;

  const sb = `
    <div class="statusbar"><span class="statusbar__t">9:41</span>
      <span class="statusbar__i">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect y="7" width="3" height="5" rx="1"/><rect x="4" y="5" width="3" height="7" rx="1"/><rect x="8" y="2.5" width="3" height="9.5" rx="1"/><rect x="12" y="0" width="3" height="12" rx="1"/></svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 11.2 5.6 8.6a3.4 3.4 0 0 1 4.8 0zM3.3 6.2a6.8 6.8 0 0 1 9.4 0l-1.5 1.6a4.6 4.6 0 0 0-6.4 0zM.9 3.7a10.2 10.2 0 0 1 14.2 0L13.6 5.3a8 8 0 0 0-11.2 0z"/></svg>
        <svg width="26" height="12" viewBox="0 0 26 12" fill="none"><rect x=".6" y=".6" width="21" height="10.8" rx="3" stroke="currentColor" stroke-opacity=".5" stroke-width="1.1"/><rect x="2.2" y="2.2" width="15" height="7.6" rx="1.6" fill="currentColor"/><rect x="23" y="4" width="1.7" height="4" rx=".85" fill="currentColor" fill-opacity=".55"/></svg>
      </span></div><div class="island"></div>`;

  /* Щит ASGARD — носитель бренда (синяя левая половина + красная правая + золотая руна) */
  const shield = (s) => `
    <svg width="${s}" height="${s}" viewBox="0 0 32 34" aria-hidden="true">
      <defs><linearGradient id="shl" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#4A90D9"/><stop offset="1" stop-color="#2E64A8"/></linearGradient></defs>
      <path d="M16 1 30 6v10c0 8-6 14-14 17C8 30 2 24 2 16V6z" fill="none" stroke="var(--line-2)" stroke-width="1"/>
      <path d="M16 1 2 6v10c0 8 6 14 14 17z" fill="url(#shl)"/>
      <path d="M16 1l14 5v10c0 8-6 14-14 17z" fill="var(--brand-red)"/>
      <path d="M16 8.5 17.6 13l4.7.2-3.7 2.9 1.3 4.5L16 17.9l-3.9 2.7 1.3-4.5-3.7-2.9L14.4 13z" fill="#F0D183"/>
    </svg>`;

  function realHome() {
    return `
    <div class="app">
      <div class="body body--real">

        <!-- 1. Приветствие + цитата (+ лого-щит = бренд-место для красного) -->
        <div class="fh-greet">
          <div class="fh-greet__row">
            <div style="flex:1;min-width:0">
              <div class="fh-h1">Добрый день, Никита, <span class="fh-rankword">Хускарл</span>!</div>
              <div class="fh-date">пятница, 16 октября</div>
            </div>
            <span class="fh-logo">${shield(38)}</span>
          </div>
          <div class="fh-quote">«В бурю кормчий познаётся»</div>
        </div>

        <!-- 2. Баннер «Новая игра · Химцех» — СОЧНЫЙ, с бренд-кантом -->
        <button class="fh-promo">
          <span class="fh-promo__ico">${ic('beaker', 26)}</span>
          <span class="fh-promo__txt">
            <span class="fh-promo__k">Новая игра · Химцех</span>
            <span class="fh-promo__t">Переливай реагенты по протоколу</span>
            <span class="fh-promo__s">Ошибка = взрыв на весь экран</span>
          </span>
          <span class="fh-promo__cta">ИГРАТЬ</span>
        </button>

        <!-- 3. Активный проект + МЛСП + телефоны -->
        <div class="fh-card">
          <div class="fh-k fh-k--accent">${ic('map', 15)} Активный проект</div>
          <div class="fh-t">Монтаж металлоконструкций, склад B</div>
          <div class="fh-s">Киров · объект «Дружба»</div>
          <div class="fh-chips">
            <span class="fh-chip">${ic('phone', 12)} РП: Путков Д.</span>
            <span class="fh-chip">${ic('phone', 12)} Маст.: Егоров С.</span>
          </div>
          <div class="fh-mlsp">
            <div class="fh-mlsp__k">МЛСП · 24 дн. на платформе</div>
            <div class="fh-mlsp__s">Заезд: 22.09 · Вывоз: 20.10 · осталось 4 дн</div>
          </div>
        </div>

        <!-- 4. Планируемое привлечение -->
        <div class="fh-card fh-card--planned">
          <div class="fh-k fh-k--accent">${ic('scroll', 15)} Планируемое привлечение</div>
          <div class="fh-t">Сборка каркаса, цех №2</div>
          <div class="fh-s">РП: Смирнов А.</div>
          <div class="fh-s">${ic('clock', 12)} с 01.11.2026 по 14.11.2026</div>
          <div class="fh-planned-note">Это план, не назначение. Смена начнётся после выезда на объект.</div>
        </div>

        <!-- 5. Готовность (состояние: ready) -->
        <button class="fh-ready">
          <span class="fh-ready__ic">${ic('shield', 22)}</span>
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

        <!-- 7. Академия — только при НЕактивной смене (по боевой логике). Смена НЕ идёт. -->
        <button class="fh-academy">
          <span class="fh-academy__ic">${ic('book', 20)}</span>
          <span style="flex:1">
            <span class="fh-academy__t">Пройди Испытание до воскресенья</span>
            <span class="fh-academy__s">«Техника безопасности при высоте» · осталось 2д</span>
          </span>
          <span class="fh-chev">→</span>
        </button>

        <!-- 8. Смена: НЕ активна -> золотая CTA «Начать смену» -->
        <div class="fh-card fh-card--shift">
          <div class="fh-shift__lbl">Смена не начата</div>
          <div class="fh-shift__sub">08:00–20:00 · объект «Дружба»</div>
          <button class="fh-start">${ic('play', 16)} Начать смену</button>
        </div>

        <!-- 9. Тариф -->
        <div class="fh-card fh-card--nested">
          <div class="fh-k">Тариф</div>
          <div class="fh-t">Монтажник · 4 балла</div>
          <div class="fh-s fh-s--accent">+ Совмещение: стропальщик (+1 балл)</div>
        </div>

        <!-- 10. Норны на паузе -->
        <div class="fh-norns">
          <span class="fh-norns__ic">${ic('pause', 16)}</span>
          <span style="flex:1">Физические призы на паузе до 1 ноября</span>
        </div>

        <!-- 11. Геймификация (8 плиток) -->
        <div class="fh-section">Геймификация</div>
        <div class="fh-grid2">
          <button class="fh-tile t-violet"><span class="fh-tile__ic">${ic('gamepad', 22)}</span><span class="fh-tile__t">Игры</span><span class="fh-tile__badge">NEW</span></button>
          <button class="fh-tile t-amber"><span class="fh-tile__ic">${ic('shop', 22)}</span><span class="fh-tile__t">Магазин</span></button>
          <button class="fh-tile t-blue"><span class="fh-tile__ic">${ic('gift', 22)}</span><span class="fh-tile__t">Инвентарь</span></button>
          <button class="fh-tile t-violet"><span class="fh-tile__ic">${ic('book', 22)}</span><span class="fh-tile__t">Чертоги Мимира</span></button>
          <button class="fh-tile t-violet"><span class="fh-tile__ic">${ic('swords', 22)}</span><span class="fh-tile__t">Квесты</span></button>
          <button class="fh-tile t-teal"><span class="fh-tile__ic">${ic('flame', 22)}</span><span class="fh-tile__t">Сезон</span><span class="fh-tile__badge">NEW</span></button>
          <button class="fh-tile t-gold"><span class="fh-tile__ic">${ic('trophy', 22)}</span><span class="fh-tile__t">Рейтинг</span></button>
          <button class="fh-tile t-teal"><span class="fh-tile__ic">${ic('map', 22)}</span><span class="fh-tile__t">Подвиги</span></button>
        </div>

        <!-- 12. Мимир -->
        <div class="fh-mimir">
          <span class="fh-mimir__ic">${ic('sparkle', 22)}</span>
          <div><div class="fh-mimir__k">Мимир говорит</div>
          <div class="fh-mimir__t">Закрой смену до 20:00 — сохранишь полный балл за день</div></div>
        </div>

        <!-- 13. Мой рейтинг -->
        <button class="fh-rank">
          <span class="fh-rank__ic">${ic('trophy', 22)}</span>
          <div style="flex:1;min-width:0">
            <div class="fh-rank__k">Мой рейтинг</div>
            <div class="fh-rank__v">#12 из 248</div>
            <div class="fh-rank__s">Хускарл · 640 ኞ заработано</div>
          </div>
          <span class="fh-chev fh-chev--gold">›</span>
        </button>

        <!-- 14. Скачать приложение (щит) — бренд-носитель -->
        <a class="fh-download">
          <span class="fh-download__ic">${shield(30)}</span>
          <span style="flex:1;min-width:0">
            <span class="fh-download__t">Скачать приложение ASGARD</span>
            <span class="fh-download__s">Работай без браузера — быстрее и надёжнее</span>
          </span>
          <span class="fh-download__cta">Скачать</span>
        </a>

        <!-- 15. Быстрые действия (13: 8 базовых + профиль; мастер-набор) -->
        <div class="fh-section">Быстрые действия</div>
        <div class="fh-grid4">
          <button class="fh-qa"><span class="fh-qa__i">${ic('briefcase', 20)}</span><span class="fh-qa__l">Мои работы</span></button>
          <button class="fh-qa"><span class="fh-qa__i">${ic('clock', 20)}</span><span class="fh-qa__l">Табель</span></button>
          <button class="fh-qa"><span class="fh-qa__i">${ic('users', 20)}</span><span class="fh-qa__l">Бригада</span></button>
          <button class="fh-qa"><span class="fh-qa__i">${ic('map', 20)}</span><span class="fh-qa__l">Маршрут</span></button>
          <button class="fh-qa"><span class="fh-qa__i">${ic('truck', 20)}</span><span class="fh-qa__l">Поездки</span></button>
          <button class="fh-qa"><span class="fh-qa__i">${ic('camera', 20)}</span><span class="fh-qa__l">Фото</span></button>
          <button class="fh-qa"><span class="fh-qa__i">${ic('box', 20)}</span><span class="fh-qa__l">Паллеты</span></button>
          <button class="fh-qa"><span class="fh-qa__i">${ic('scroll', 20)}</span><span class="fh-qa__l">Наряды</span></button>
          <button class="fh-qa"><span class="fh-qa__i">${ic('file', 20)}</span><span class="fh-qa__l">Отчёт</span></button>
          <button class="fh-qa"><span class="fh-qa__i">${ic('alert', 20)}</span><span class="fh-qa__l">Инцидент</span></button>
          <button class="fh-qa"><span class="fh-qa__i">${ic('wallet', 20)}</span><span class="fh-qa__l">Подотчёт</span></button>
          <button class="fh-qa"><span class="fh-qa__i">${ic('packageCheck', 20)}</span><span class="fh-qa__l">Приёмка</span></button>
        </div>

        <!-- Брендовая линия: СИНИЙ → КРАСНЫЙ (ровно 2 стопа, как щит) -->
        <div class="fh-brandline"></div>
      </div>
    </div>`;
  }

  window.FINAL = [
    { id: 'f2', skin: 'skin-ozon', name: '2 · Ozon Clean', note: 'синий+циан · красный как бренд (щит/кант/линия)' },
    { id: 'f3', skin: 'skin-aurora', name: '3 · Aurora Glass', note: 'плавающее стекло · фиолет+бирюза · красный бренд-кант' },
    { id: 'f5', skin: 'skin-navy', name: '5 · Navy Gold', note: 'нави+золото · красный бренд-акцент' },
    { id: 'f6', skin: 'skin-frost', name: '6 · Frostlight (светлая)', note: 'белые карточки · лёд+синий · красный бренд', light: true },
  ];

  window.HOME_HTML = function (v, theme) {
    return `<div class="screen ${v.skin}" data-theme="${theme}"><div class="scene"></div>${sb}${realHome()}</div>`;
  };
})();
