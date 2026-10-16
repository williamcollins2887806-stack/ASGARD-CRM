/* ═══════════════════════════════════════════════════════════════════════════
   ASGARD FIELD — 8 РАЗНЫХ ДИЗАЙНОВ ГЛАВНОЙ (не палитры — разные раскладки!)
   Каждый вариант: своя структура, свой герой, своя подача.
   Контрасты текста на промо/CTA пересчитаны (см. EXPO в отчёте).
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

  const topbar = (t, s) => `
    <div class="topbar"><div style="flex:1;min-width:0">
      <div class="topbar__t">${t}</div>${s ? `<div class="topbar__s">${s}</div>` : ''}</div>
      <button class="iconbtn">${ic('bell', 20)}</button></div>`;

  /* ─────────────────────────────────────────────────────────────────────────
     V1 · WB BERRY — bento-витрина, магента, крупный герой-промо
     ───────────────────────────────────────────────────────────────────────── */
  function v1() {
    const t = (ico, l, s, tone, badge) => `
      <button class="tile tile--gloss ${tone}">
        <span class="tile__ico">${ic(ico, 22)}</span>
        <span style="min-width:0"><span class="tile__t" style="display:block">${l}</span>${s ? `<span class="tile__s" style="display:block">${s}</span>` : ''}</span>
        ${badge ? `<span class="badge badge--pop" style="position:absolute;top:9px;right:9px">${badge}</span>` : ''}
      </button>`;
    return `
      ${topbar('Привет, Никита', 'бригада №4 · Хускарл')}
      <div class="body">
        <div class="hero hero--wb">
          <div class="hero__lbl"><span class="dot"></span>Смена идёт · 08:00–20:00</div>
          <div class="shift-timer">03:42:18</div>
          <div class="hero__sub" style="text-align:center;margin-bottom:14px">до конца 8 ч 18 м · объект «Дружба»</div>
          <button class="btn btn--cta btn--block">${ic('square', 18)} Завершить смену</button>
        </div>
        <button class="promo promo--wb">
          <span class="promo__ico">${ic('beaker', 24)}</span>
          <span style="flex:1;min-width:0"><span class="promo__k">Новая игра</span>
          <span class="promo__t">Химцех: переливай реагенты</span>
          <span class="promo__s">Ошибка = взрыв на весь экран</span></span>
          <span class="promo__cta">Играть</span>
        </button>
        <div class="bento">
          ${t('briefcase', 'Работы', '6 объектов', 't-blue')}
          ${t('scroll', 'Наряды', '3 новых', 't-teal')}
          ${t('camera', 'Фото', null, 't-violet')}
          ${t('box', 'Паллеты', null, 't-amber')}
          ${t('packageCheck', 'Приёмка', null, 't-green')}
          ${t('wallet', 'Подотчёт', null, 't-red')}
        </div>
        <div class="section">Остальное</div>
        <div class="list">
          <button class="srow"><span class="srow__ico t-teal">${ic('users', 18)}</span><span class="srow__m"><span class="srow__t">Бригада</span><span class="srow__s">6 человек</span></span><span class="badge">${ic('check', 12)} Готов</span></button>
          <button class="srow"><span class="srow__ico t-trophy">${ic('trophy', 18)}</span><span class="srow__m"><span class="srow__t">Рейтинг #12 из 248</span><span class="srow__s">640 ᚱ заработано</span></span><span class="badge badge--pop">TOP 5%</span></button>
        </div>
      </div>`;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     V2 · OZON CLEAN — список-первый, минимум эффектов, крупные строки
     ───────────────────────────────────────────────────────────────────────── */
  function v2() {
    return `
      ${topbar('Главная', 'пятница, 16 октября')}
      <div class="body">
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div><div class="card__k" style="margin:0">Смена идёт</div>
            <div class="timer-sm tnum">03:42:18</div></div>
            <span class="ring"><svg width="56" height="56"><circle cx="28" cy="28" r="24" fill="none" stroke="var(--track)" stroke-width="6"/><circle cx="28" cy="28" r="24" fill="none" stroke="var(--cta-solid)" stroke-width="6" stroke-linecap="round" stroke-dasharray="150.8" stroke-dashoffset="46" transform="rotate(-90 28 28)"/></svg></span>
          </div>
          <button class="btn btn--cta btn--block" style="margin-top:16px">${ic('square', 18)} Завершить смену</button>
        </div>
        <div class="section">Заработано</div>
        <div class="kpis">
          <div class="kpi"><div class="kpi__lbl">К выплате</div><div class="kpi__val tnum">128 400 ₽</div></div>
          <div class="kpi"><div class="kpi__lbl">Отработано</div><div class="kpi__val tnum">142 ч</div></div>
        </div>
        <div class="section">Разделы</div>
        <div class="list">
          <button class="srow"><span class="srow__ico t-blue">${ic('briefcase', 18)}</span><span class="srow__m"><span class="srow__t">Мои работы</span><span class="srow__s">6 активных объектов</span></span>${ic('chev', 18)}</button>
          <button class="srow"><span class="srow__ico t-blue">${ic('clock', 18)}</span><span class="srow__m"><span class="srow__t">Табель</span><span class="srow__s">18 из 22 смен закрыто</span></span>${ic('chev', 18)}</button>
          <button class="srow"><span class="srow__ico t-teal">${ic('users', 18)}</span><span class="srow__m"><span class="srow__t">Бригада</span><span class="srow__s">6 человек на объекте</span></span>${ic('chev', 18)}</button>
          <button class="srow"><span class="srow__ico t-teal">${ic('map', 18)}</span><span class="srow__m"><span class="srow__t">Маршрут и этапы</span></span>${ic('chev', 18)}</button>
          <button class="srow"><span class="srow__ico t-amber">${ic('box', 18)}</span><span class="srow__m"><span class="srow__t">Сбор паллет</span></span>${ic('chev', 18)}</button>
          <button class="srow"><span class="srow__ico t-amber">${ic('truck', 18)}</span><span class="srow__m"><span class="srow__t">Поездки и направления</span></span>${ic('chev', 18)}</button>
          <button class="srow"><span class="srow__ico t-violet">${ic('camera', 18)}</span><span class="srow__m"><span class="srow__t">Фото</span></span>${ic('chev', 18)}</button>
        </div>
        <div class="section">Академия и игра</div>
        <div class="list">
          <button class="srow"><span class="srow__ico t-violet">${ic('book', 18)}</span><span class="srow__m"><span class="srow__t">Чертоги Мимира</span><span class="srow__s">2 новых урока</span></span><span class="badge badge--pop">NEW</span></button>
          <button class="srow"><span class="srow__ico t-trophy">${ic('trophy', 18)}</span><span class="srow__m"><span class="srow__t">Рейтинг #12 из 248</span></span>${ic('chev', 18)}</button>
        </div>
      </div>`;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     V3 · AURORA GLASS — плавающие стеклянные панели над сиянием
     ───────────────────────────────────────────────────────────────────────── */
  function v3() {
    return `
      <div class="topbar topbar--float">
        <div style="flex:1"><div class="topbar__t">Асгард</div><div class="topbar__s">смена идёт · объект «Дружба»</div></div>
        <span class="avatar">Н</span>
      </div>
      <div class="body">
        <div class="glass-panel glass-panel--hero">
          <div class="ring ring--lg"><svg width="120" height="120">
            <circle cx="60" cy="60" r="50" fill="none" stroke="var(--track)" stroke-width="8"/>
            <circle cx="60" cy="60" r="50" fill="none" stroke="url(#aur)" stroke-width="8" stroke-linecap="round" stroke-dasharray="314" stroke-dashoffset="96" transform="rotate(-90 60 60)"/>
            <defs><linearGradient id="aur" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#A78BFA"/><stop offset="1" stop-color="#2DD4BF"/></linearGradient></defs>
          </svg><span class="ring__in"><span class="tnum" style="font-size:30px;font-weight:850">3:42</span><span class="ring__l">смена идёт</span></span></div>
          <button class="btn btn--cta btn--block" style="margin-top:18px">${ic('square', 18)} Завершить</button>
        </div>
        <div class="glass-row">
          <div class="glass-panel glass-panel--sm"><div class="kpi__lbl">К выплате</div><div class="kpi__val tnum">128 400 ₽</div></div>
          <div class="glass-panel glass-panel--sm"><div class="kpi__lbl">Смен</div><div class="kpi__val tnum">18/22</div></div>
        </div>
        <div class="section">Модули</div>
        <div class="bento">
          <button class="tile tile--gloss tile--wide t-blue"><span class="tile__ico">${ic('briefcase', 22)}</span><span style="flex:1"><span class="tile__t" style="display:block">Мои работы</span><span class="tile__s" style="display:block">6 объектов</span></span>${ic('chev', 18)}</button>
          <button class="tile tile--gloss t-teal"><span class="tile__ico">${ic('scroll', 22)}</span><span class="tile__t">Наряды</span></button>
          <button class="tile tile--gloss t-violet"><span class="tile__ico">${ic('camera', 22)}</span><span class="tile__t">Фото</span></button>
          <button class="tile tile--gloss t-amber"><span class="tile__ico">${ic('box', 22)}</span><span class="tile__t">Паллеты</span></button>
          <button class="tile tile--gloss t-green"><span class="tile__ico">${ic('packageCheck', 22)}</span><span class="tile__t">Приёмка</span></button>
        </div>
        <div class="glass-panel glass-panel--promo">
          <span class="tile__ico t-violet">${ic('gamepad', 22)}</span>
          <span style="flex:1"><span class="promo__k2">Игры</span><span class="tile__t" style="display:block">Химцех · Рунопровод · Рулетка</span></span>
          <span class="badge badge--pop">NEW</span>
        </div>
      </div>`;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     V4 · SUNSET EDITORIAL — полноэкранный градиентный герой, контент поверх
     ───────────────────────────────────────────────────────────────────────── */
  function v5() {
    const chip = (ico, l) => `<button class="echip"><span class="echip__i">${ic(ico, 18)}</span><span class="echip__l">${l}</span></button>`;
    return `
      <div class="editorial">
        <div class="ed__big">
          <div class="statusbar statusbar--on"><span class="statusbar__t">9:41</span>
            <span class="statusbar__i"><svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect y="7" width="3" height="5" rx="1"/><rect x="4" y="5" width="3" height="7" rx="1"/><rect x="8" y="2.5" width="3" height="9.5" rx="1"/><rect x="12" y="0" width="3" height="12" rx="1"/></svg><svg width="26" height="12" viewBox="0 0 26 12" fill="none"><rect x=".6" y=".6" width="21" height="10.8" rx="3" stroke="currentColor" stroke-opacity=".6" stroke-width="1.1"/><rect x="2.2" y="2.2" width="15" height="7.6" rx="1.6" fill="currentColor"/><rect x="23" y="4" width="1.7" height="4" rx=".85" fill="currentColor" fill-opacity=".6"/></svg></span></div>
          <div class="island"></div>
          <div class="ed__kick">Смена идёт · объект «Дружба»</div>
          <div class="ed__num tnum">03:42</div>
          <div class="ed__cap">Добрый день, Никита · Хускарл</div>
          <button class="btn ed__cta">${ic('square', 18)} Завершить смену</button>
        </div>
        <div class="ed__body">
          <div class="ed__stats">
            <div><div class="ed__sl">К выплате</div><div class="ed__sv tnum">128 400 ₽</div></div>
            <div><div class="ed__sl">Смен</div><div class="ed__sv tnum">18/22</div></div>
            <div><div class="ed__sl">Рейтинг</div><div class="ed__sv tnum">#12</div></div>
          </div>
          <div class="section">Быстрый доступ</div>
          <div class="chips-scroll">
            ${chip('briefcase', 'Работы')}${chip('clock', 'Табель')}${chip('users', 'Бригада')}
            ${chip('map', 'Маршрут')}${chip('truck', 'Поездки')}${chip('camera', 'Фото')}
            ${chip('box', 'Паллеты')}${chip('scroll', 'Наряды')}
          </div>
          <button class="promo promo--sunset">
            <span class="promo__ico">${ic('beaker', 24)}</span>
            <span style="flex:1;min-width:0"><span class="promo__k">Новая игра</span>
            <span class="promo__t">Химцех: переливай реагенты</span></span>
            <span class="promo__cta">Играть</span>
          </button>
          <div class="list">
            <button class="srow"><span class="srow__ico t-violet">${ic('book', 18)}</span><span class="srow__m"><span class="srow__t">Чертоги Мимира</span><span class="srow__s">2 новых урока</span></span>${ic('chev', 18)}</button>
            <button class="srow"><span class="srow__ico t-trophy">${ic('trophy', 18)}</span><span class="srow__m"><span class="srow__t">Рейтинг и достижения</span></span>${ic('chev', 18)}</button>
            <button class="srow"><span class="srow__ico t-green">${ic('shield', 18)}</span><span class="srow__m"><span class="srow__t">Готов к смене</span></span><span class="badge">${ic('check', 12)} OK</span></button>
          </div>
        </div>
      </div>`;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     V6 · NAVY GOLD PREMIUM — центрированный стек-карточка, «дорого и строго»
     ───────────────────────────────────────────────────────────────────────── */
  function v6() {
    return `
      ${topbar('Асгард', 'смена · объект «Дружба»')}
      <div class="body">
        <div class="card card--premium">
          <span class="premium-line"></span>
          <div class="premium__kick">Смена идёт с 08:00</div>
          <div class="premium__num tnum">03:42:18</div>
          <div class="premium__cap">Отработано сегодня · перерыв 1 ч</div>
          <button class="btn btn--cta btn--block" style="margin-top:18px">${ic('square', 18)} Завершить смену</button>
        </div>
        <div class="kpis">
          <div class="kpi kpi--gold"><div class="kpi__lbl">К выплате</div><div class="kpi__val tnum">128 400 ₽</div><div class="kpi__note">за октябрь</div></div>
          <div class="kpi"><div class="kpi__lbl">Смен</div><div class="kpi__val tnum">18 / 22</div><div class="kpi__note">закрыто</div></div>
        </div>
        <div class="section">Разделы</div>
        <div class="list">
          <button class="srow srow--prem"><span class="srow__ico t-blue">${ic('briefcase', 18)}</span><span class="srow__m"><span class="srow__t">Мои работы</span><span class="srow__s">6 активных объектов</span></span>${ic('chev', 18)}</button>
          <button class="srow srow--prem"><span class="srow__ico t-teal">${ic('clock', 18)}</span><span class="srow__m"><span class="srow__t">Табель</span><span class="srow__s">18 из 22 смен</span></span>${ic('chev', 18)}</button>
          <button class="srow srow--prem"><span class="srow__ico t-violet">${ic('camera', 18)}</span><span class="srow__m"><span class="srow__t">Фото и отчёты</span></span>${ic('chev', 18)}</button>
          <button class="srow srow--prem"><span class="srow__ico t-trophy">${ic('trophy', 18)}</span><span class="srow__m"><span class="srow__t">Академия и рейтинг</span><span class="srow__s">Хускарл · 640 ᚱ</span></span><span class="badge badge--gold">VIP</span></button>
        </div>
        <div class="premium__foot">ASGARD · полевая служба</div>
      </div>`;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     V7 · FROSTLIGHT (СВЕТЛАЯ) — карточки на белом, лёд+синий, воздух
     ───────────────────────────────────────────────────────────────────────── */
  function v7() {
    const t = (ico, l, s, tone) => `
      <button class="tile tile--gloss ${tone}"><span class="tile__ico">${ic(ico, 22)}</span>
      <span style="min-width:0"><span class="tile__t" style="display:block">${l}</span>${s ? `<span class="tile__s" style="display:block">${s}</span>` : ''}</span></button>`;
    return `
      ${topbar('Добрый день, Никита', 'пятница, 16 октября')}
      <div class="body">
        <div class="card card--frost">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div><div class="card__k">Смена идёт</div>
              <div class="timer-sm timer-sm--dark tnum">03:42:18</div>
              <div class="card__s">до конца 8 ч 18 м</div></div>
            <span class="pill">объект «Дружба»</span>
          </div>
          <button class="btn btn--cta btn--block" style="margin-top:16px">${ic('square', 18)} Завершить смену</button>
        </div>
        <div class="kpis">
          <div class="kpi kpi--light"><div class="kpi__lbl">К выплате</div><div class="kpi__val tnum">128 400 ₽</div><div class="kpi__note">за октябрь</div></div>
          <div class="kpi kpi--light"><div class="kpi__lbl">Смен</div><div class="kpi__val tnum">18/22</div><div class="kpi__note">закрыто</div></div>
        </div>
        <div class="section">Разделы</div>
        <div class="bento">
          ${t('briefcase', 'Мои работы', '6 объектов', 't-blue')}
          ${t('clock', 'Табель', '18 смен', 't-blue')}
          ${t('users', 'Бригада', null, 't-teal')}
          ${t('map', 'Маршрут', null, 't-teal')}
          ${t('camera', 'Фото', null, 't-violet')}
          ${t('box', 'Паллеты', null, 't-amber')}
        </div>
        <button class="promo promo--frost">
          <span class="promo__ico">${ic('beaker', 24)}</span>
          <span style="flex:1;min-width:0"><span class="promo__k">Новая игра</span>
          <span class="promo__t">Химцех: переливай реагенты</span></span>
          <span class="promo__cta">Играть</span>
        </button>
        <div class="list">
          <button class="srow"><span class="srow__ico t-violet">${ic('book', 18)}</span><span class="srow__m"><span class="srow__t">Чертоги Мимира</span><span class="srow__s">2 новых урока</span></span><span class="badge badge--pop">NEW</span></button>
          <button class="srow"><span class="srow__ico t-trophy">${ic('trophy', 18)}</span><span class="srow__m"><span class="srow__t">Рейтинг #12 из 248</span></span>${ic('chev', 18)}</button>
        </div>
      </div>`;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     V7 · NEO MARKET — витрина-карточки с фото-плейсхолдерами и ценниками
     ───────────────────────────────────────────────────────────────────────── */
  function v8() {
    const show = (ico, l, tag, tone) => `
      <button class="show">
        <span class="show__img ${tone}">${ic(ico, 30)}</span>
        <span class="show__body"><span class="show__t">${l}</span>
        ${tag ? `<span class="badge badge--pop">${tag}</span>` : ''}</span>
      </button>`;
    return `
      ${topbar('Никита, добрый день', 'Хускарл · бригада №4')}
      <div class="body">
        <div class="hero hero--neo">
          <div><div class="hero__lbl"><span class="dot"></span>Смена идёт</div>
          <div class="shift-timer" style="text-align:left">03:42:18</div>
          <div class="hero__sub">объект «Дружба» · до конца 8 ч 18 м</div></div>
          <button class="btn btn--cta btn--block" style="margin-top:16px">${ic('square', 18)} Завершить смену</button>
        </div>
        <div class="promo promo--neo">
          <span class="promo__ico">${ic('beaker', 24)}</span>
          <span style="flex:1;min-width:0"><span class="promo__k">Хит недели</span>
          <span class="promo__t">Химцех — новая игра</span>
          <span class="promo__s">переливай реагенты по протоколу</span></span>
          <span class="promo__cta">Играть</span>
        </div>
        <div class="section">Витрина разделов</div>
        <div class="shows">
          ${show('briefcase', 'Мои работы', '6', 't-blue')}
          ${show('scroll', 'Наряды', '3', 't-teal')}
          ${show('box', 'Сбор паллет', null, 't-amber')}
          ${show('camera', 'Фото', null, 't-violet')}
          ${show('packageCheck', 'Приёмка', null, 't-green')}
          ${show('book', 'Чертоги Мимира', 'NEW', 't-violet')}
        </div>
        <div class="kpis">
          <div class="kpi"><div class="kpi__lbl">К выплате</div><div class="kpi__val tnum">128 400 ₽</div></div>
          <div class="kpi"><div class="kpi__lbl">Рейтинг</div><div class="kpi__val tnum">#12</div></div>
        </div>
      </div>`;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     V8 · LIME SPORT — дашборд-сетка 2×2 с крупными числами, энергичный
     ───────────────────────────────────────────────────────────────────────── */
  function v9() {
    const big = (v, l, tone, ico) => `
      <button class="bigstat ${tone}">
        <span class="bigstat__i">${ic(ico, 20)}</span>
        <span class="bigstat__v tnum">${v}</span>
        <span class="bigstat__l">${l}</span>
      </button>`;
    return `
      ${topbar('Мой день', 'пятница · Хускарл')}
      <div class="body">
        <div class="card">
          <div style="display:flex;align-items:center;gap:14px">
            <span class="ring"><svg width="64" height="64"><circle cx="32" cy="32" r="27" fill="none" stroke-width="7"/><circle cx="32" cy="32" r="27" fill="none" stroke-width="7" stroke-linecap="round" stroke-dasharray="169.6" stroke-dashoffset="52" transform="rotate(-90 32 32)"/></svg></span>
            <div style="flex:1"><div class="card__k" style="margin:0">Смена идёт</div>
            <div class="timer-sm tnum">03:42:18</div>
            <div class="card__s">объект «Дружба» · до конца 8 ч</div></div>
          </div>
          <button class="btn btn--cta btn--block" style="margin-top:16px">${ic('square', 18)} Завершить смену</button>
        </div>
        <div class="grid2">
          ${big('128 400 ₽', 'К выплате', 't-blue', 'money')}
          ${big('18/22', 'Смен закрыто', 't-teal', 'clock')}
          ${big('#12', 'Рейтинг', 't-amber', 'trophy')}
          ${big('640 ᚱ', 'Заработано', 't-green', 'star')}
        </div>
        <div class="section">Разделы</div>
        <div class="bento">
          <button class="tile tile--gloss t-blue"><span class="tile__ico">${ic('briefcase', 22)}</span><span class="tile__t">Работы</span></button>
          <button class="tile tile--gloss t-teal"><span class="tile__ico">${ic('scroll', 22)}</span><span class="tile__t">Наряды</span></button>
          <button class="tile tile--gloss t-violet"><span class="tile__ico">${ic('camera', 22)}</span><span class="tile__t">Фото</span></button>
          <button class="tile tile--gloss t-amber"><span class="tile__ico">${ic('box', 22)}</span><span class="tile__t">Паллеты</span></button>
          <button class="tile tile--gloss t-green"><span class="tile__ico">${ic('packageCheck', 22)}</span><span class="tile__t">Приёмка</span></button>
          <button class="tile tile--gloss t-red"><span class="tile__ico">${ic('alert', 22)}</span><span class="tile__t">Инцидент</span></button>
        </div>
        <button class="promo promo--lime">
          <span class="promo__ico">${ic('beaker', 22)}</span>
          <span style="flex:1;min-width:0"><span class="promo__k">Игра дня</span><span class="promo__t">Химцех</span></span>
          <span class="promo__cta">Играть</span>
        </button>
      </div>`;
  }

  window.VARIANTS = [
    { id: 'v1', skin: 'skin-wb', name: 'V1 · WB Berry', note: 'bento-витрина · магента · промо-хиро', fn: v1 },
    { id: 'v2', skin: 'skin-ozon', name: 'V2 · Ozon Clean', note: 'список-первый · минимум эффектов · кольцо-прогресс', fn: v2 },
    { id: 'v3', skin: 'skin-aurora', name: 'V3 · Aurora Glass', note: 'плавающие стеклянные панели над сиянием', fn: v3 },
    { id: 'v5', skin: 'skin-sunset', name: 'V4 · Sunset Editorial', note: 'полноэкранный градиентный герой + чипы', fn: v5 },
    { id: 'v6', skin: 'skin-navy', name: 'V5 · Navy Gold Premium', note: 'центрированный стек-карточка · «дорого»', fn: v6 },
    { id: 'v7', skin: 'skin-frost', name: 'V6 · Frostlight (светлая)', note: 'белые карточки · лёд+синий · воздух', fn: v7, light: true },
    { id: 'v8', skin: 'skin-neo', name: 'V7 · Neo Market', note: 'витрина-карточки с плейсхолдерами и бейджами', fn: v8 },
    { id: 'v9', skin: 'skin-lime', name: 'V8 · Lime Sport', note: 'дашборд 2×2 · крупные числа · лайм+бирюза', fn: v9 },
  ];

  window.HOME_HTML = function (v, theme) {
    return `<div class="screen ${v.skin}" data-theme="${theme}"><div class="scene"></div>${sb}<div class="app">${v.fn()}</div></div>`;
  };
})();
