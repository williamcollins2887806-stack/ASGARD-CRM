/**
 * ASGARD CRM — Mobile v2 Test Page
 * Рендерит все 26 компонентов на #/test
 */

const TestPage = {
  render() {
    console.log('[TEST] rendering components — TestPage.render() called');
    const el = (tag, attrs = {}, children) => {
      const element = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'className') element.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(element.style, v);
        else if (k === 'innerHTML') element.innerHTML = v;
        else if (k === 'textContent') element.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') {
          element.addEventListener(k.slice(2).toLowerCase(), v);
        }
        else element.setAttribute(k, v);
      }
      if (children != null) {
        if (typeof children === 'string') element.textContent = children;
        else if (children instanceof HTMLElement) element.appendChild(children);
        else if (Array.isArray(children)) {
          children.forEach(c => {
            if (c instanceof HTMLElement) element.appendChild(c);
            else if (typeof c === 'string') element.appendChild(document.createTextNode(c));
          });
        }
      }
      return element;
    };

    const page = el('div', { className: 'test-page' });

    // ─── HEADER (1) with theme toggle ───
    page.appendChild(sectionTitle('1. Header'));
    const themeToggle = DS.createThemeToggle();
    page.appendChild(M.Header({
      title: 'Витрина компонентов',
      subtitle: 'ASGARD MOBILE V2',
      back: false,
      actions: [
        {
          icon: '<span style="display:flex" id="header-theme-slot"></span>',
          onClick: () => {},
        },
        {
          icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
          onClick: () => M.Toast({ message: 'Настройки (тест)', type: 'info' }),
        },
      ],
    }));
    // Insert theme toggle into header
    setTimeout(() => {
      const slot = document.getElementById('header-theme-slot');
      if (slot) slot.appendChild(themeToggle);
    }, 0);

    // ─── HERO CARD (2) ───
    page.appendChild(sectionTitle('2. HeroCard'));
    const heroWrap = el('div', { style: { padding: '0 20px' } });
    heroWrap.appendChild(M.HeroCard({
      label: 'Общий баланс',
      value: '12 450 000',
      valuePrefix: '',
      valueSuffix: ' ₽',
      details: [
        { label: 'Доходы', value: '+3.2 млн ₽', color: '#4ADE80' },
        { label: 'Расходы', value: '-1.8 млн ₽', color: '#FF6B6B' },
        { label: 'Объекты', value: '24' },
      ],
    }));
    page.appendChild(heroWrap);

    // ─── CARDS (3) + BADGE (4) ───
    page.appendChild(sectionTitle('3. Card + 4. Badge'));
    const cardsWrap = el('div', {
      style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 20px' },
    });

    cardsWrap.appendChild(M.Card({
      title: 'ТЦ Галерея — Реконструкция',
      subtitle: 'Этап 3: Монтаж',
      badge: 'В работе',
      badgeColor: 'info',
      fields: [
        { label: 'Бюджет', value: '4 250 000 ₽' },
        { label: 'Срок', value: '15 мар 2026' },
      ],
      href: '/test',
      animDelay: 0.05,
    }));

    cardsWrap.appendChild(M.Card({
      title: 'БЦ Северный — Проект ОВиК',
      badge: 'Завершён',
      badgeColor: 'success',
      fields: [
        { label: 'Бюджет', value: '1 890 000 ₽' },
        { label: 'Оценка', value: '4.9 / 5.0' },
      ],
      time: '2 дн назад',
      animDelay: 0.1,
    }));

    cardsWrap.appendChild(M.Card({
      title: 'Жилой комплекс «Рассвет»',
      badge: 'Просрочен',
      badgeColor: 'danger',
      fields: [
        { label: 'Дедлайн', value: '01 мар 2026' },
      ],
      swipeActions: [
        { label: 'Архив', color: 'var(--orange)', onClick: () => M.Toast({ message: 'Архивировано', type: 'info' }) },
        { label: 'Удалить', color: 'var(--red)', onClick: () => M.Toast({ message: 'Удалено', type: 'error' }) },
      ],
      animDelay: 0.15,
    }));
    page.appendChild(cardsWrap);

    // ─── BADGES SHOWCASE (4) ───
    page.appendChild(sectionTitle('4. Badge (все варианты)'));
    const badgeRow = el('div', {
      style: { display: 'flex', flexWrap: 'wrap', gap: '8px 6px', padding: '0 20px', rowGap: '10px' },
    });
    ['success', 'danger', 'warning', 'info', 'gold', 'neutral'].forEach(color => {
      badgeRow.appendChild(M.Badge({ text: color, color, variant: 'solid' }));
      badgeRow.appendChild(M.Badge({ text: color, color, variant: 'outline' }));
    });
    page.appendChild(badgeRow);

    // ─── FILTER PILLS (5) ───
    page.appendChild(sectionTitle('5. FilterPills'));
    page.appendChild(M.FilterPills({
      items: [
        { label: 'Все', value: 'all', active: true },
        { label: 'В работе', value: 'active' },
        { label: 'Завершённые', value: 'done' },
        { label: 'На согласовании', value: 'pending' },
        { label: 'Отклонённые', value: 'rejected' },
        { label: 'Архив', value: 'archive' },
      ],
      onChange: (v) => M.Toast({ message: 'Фильтр: ' + v, type: 'info', duration: 1500 }),
    }));

    // ─── STATS (6) ───
    page.appendChild(sectionTitle('6. Stats'));
    page.appendChild(M.Stats({
      items: [
        { icon: '📊', label: 'Объекты', value: 24, color: 'var(--blue)' },
        { icon: '💰', label: 'Выручка', value: '12.4М', color: 'var(--green)' },
        { icon: '📋', label: 'Задачи', value: 156, color: 'var(--orange)' },
        { icon: '👥', label: 'Сотрудники', value: 87, color: 'var(--red)' },
      ],
    }));

    // ─── SECTION (7) ───
    page.appendChild(sectionTitle('7. Section (collapsible)'));
    const sectionContent = el('div', { style: { padding: '0 20px' } });
    sectionContent.appendChild(el('p', {
      style: {
        color: 'var(--text-sec)', fontSize: '14px', margin: 0, lineHeight: 1.5,
        display: '-webkit-box', WebkitLineClamp: '3', WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      },
      textContent: 'Это содержимое секции, которое можно скрыть и развернуть. Нажмите на заголовок, чтобы свернуть. Асгард — обитель богов в скандинавской мифологии, мир, расположенный на верхнем уровне мирового древа Иггдрасиль.',
    }));
    page.appendChild(M.Section({
      title: 'Скрываемая секция',
      content: sectionContent,
      collapsible: true,
      action: { label: 'Подробнее', onClick: () => M.Toast({ message: 'Action!', type: 'info' }) },
    }));

    // ─── LIST (8) + EMPTY (9) ───
    page.appendChild(sectionTitle('8. List'));
    page.appendChild(M.List({
      items: ['Один', 'Ватсон', 'Локи', 'Фрейя', 'Тор'],
      renderItem: (item, i) => M.Card({
        title: item,
        subtitle: `Элемент списка #${i + 1}`,
        href: '/test',
        animDelay: i * 0.04,
      }),
    }));

    page.appendChild(sectionTitle('9. Empty'));
    const emptyWrap = el('div', { style: { padding: '0 20px' } });
    emptyWrap.appendChild(M.Empty({ text: 'Здесь пока пусто, воин', icon: '⚔️' }));
    page.appendChild(emptyWrap);

    // ─── SKELETON (10) ───
    page.appendChild(sectionTitle('10. Skeleton'));
    page.appendChild(M.Skeleton({ type: 'hero', count: 1 }));

    const skelRow = el('div', { style: { marginTop: '12px' } });
    skelRow.appendChild(M.Skeleton({ type: 'stats', count: 1 }));
    page.appendChild(skelRow);

    const skelList = el('div', { style: { marginTop: '12px' } });
    skelList.appendChild(M.Skeleton({ type: 'list', count: 3 }));
    page.appendChild(skelList);

    const skelCards = el('div', { style: { marginTop: '12px' } });
    skelCards.appendChild(M.Skeleton({ type: 'card', count: 2 }));
    page.appendChild(skelCards);

    // ─── TOAST (11) ───
    page.appendChild(sectionTitle('11. Toast'));
    const toastRow = el('div', {
      style: { display: 'flex', gap: '8px', padding: '0 20px', flexWrap: 'wrap' },
    });
    [
      { label: '✓ Success', type: 'success', msg: 'Операция выполнена успешно!' },
      { label: '✕ Error', type: 'error', msg: 'Произошла ошибка при сохранении' },
      { label: 'ℹ Info', type: 'info', msg: 'Новое уведомление от системы' },
    ].forEach(t => {
      const btnVariant = t.type === 'success' ? 'primary' : t.type === 'error' ? 'danger' : 'secondary';
      toastRow.appendChild(M.FullWidthBtn({
        label: t.label,
        variant: btnVariant,
        onClick: () => M.Toast({ message: t.msg, type: t.type }),
      }));
    });
    page.appendChild(toastRow);

    // ─── BOTTOM SHEET (12) ───
    page.appendChild(sectionTitle('12. BottomSheet'));
    const sheetBtnWrap = el('div', { style: { padding: '0 20px' } });
    sheetBtnWrap.appendChild(M.FullWidthBtn({
      label: '📋 Открыть BottomSheet',
      variant: 'primary',
      onClick: () => {
        const content = el('div');
        content.appendChild(el('p', {
          style: { color: 'var(--text-sec)', fontSize: '14px', margin: '0 0 16px', lineHeight: 1.6 },
          textContent: 'Это содержимое BottomSheet. Потяните drag-handle вниз или нажмите ✕ для закрытия. Поддерживается жест swipe-down.',
        }));
        content.appendChild(M.DetailFields({
          fields: [
            { label: 'Заказчик', value: 'ООО «Асгард»' },
            { label: 'Телефон', value: '+7 (999) 123-45-67', type: 'phone' },
            { label: 'Email', value: 'info@asgard.ru', type: 'email' },
            { label: 'Статус', value: 'Активен', type: 'badge', badgeColor: 'success' },
          ],
        }));
        M.BottomSheet({ title: 'Детали объекта', content, fullscreen: false });
      },
    }));
    page.appendChild(sheetBtnWrap);

    // ─── CONFIRM (13) ───
    page.appendChild(sectionTitle('13. Confirm'));
    const confirmBtnWrap = el('div', {
      style: { display: 'flex', gap: '8px', padding: '0 20px' },
    });
    confirmBtnWrap.appendChild(M.FullWidthBtn({
      label: 'Confirm (обычный)',
      variant: 'secondary',
      onClick: async () => {
        const ok = await M.Confirm({
          title: 'Подтверждение',
          message: 'Вы уверены, что хотите продолжить?',
        });
        M.Toast({ message: ok ? 'Подтверждено!' : 'Отменено', type: ok ? 'success' : 'info' });
      },
    }));
    confirmBtnWrap.appendChild(M.FullWidthBtn({
      label: 'Confirm (danger)',
      variant: 'danger',
      onClick: async () => {
        const ok = await M.Confirm({
          title: 'Удалить объект?',
          message: 'Это действие нельзя отменить. Все данные будут потеряны.',
          okText: 'Удалить',
          danger: true,
        });
        M.Toast({ message: ok ? 'Удалено!' : 'Отменено', type: ok ? 'error' : 'info' });
      },
    }));
    page.appendChild(confirmBtnWrap);

    // ─── FAB (14) — не добавляем в поток, покажем кнопку-демо ───
    page.appendChild(sectionTitle('14. FAB'));
    const fabNote = el('div', {
      style: { padding: '0 20px', ...DS.font('base'), color: 'var(--text-sec)', lineHeight: 1.5 },
      textContent: 'FAB (Мимир) отображается в tab bar по центру — пульсирующая круглая кнопка с градиентом. Также можно добавить FAB внизу-справа:',
    });
    page.appendChild(fabNote);
    // Temporary FAB demo
    let demoFab = null;
    const fabToggle = el('div', { style: { padding: '8px 20px' } });
    fabToggle.appendChild(M.FullWidthBtn({
      label: 'Показать / Скрыть FAB',
      variant: 'secondary',
      onClick: () => {
        if (demoFab && demoFab.parentNode) {
          demoFab.remove();
          demoFab = null;
        } else {
          demoFab = M.FAB({
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 5v14m-7-7h14"/></svg>',
            onClick: () => M.Toast({ message: 'FAB нажат!', type: 'success' }),
            gradient: true,
            pulse: true,
          });
          page.appendChild(demoFab);
        }
      },
    }));
    page.appendChild(fabToggle);

    // ─── BAR CHART (16) ───
    page.appendChild(sectionTitle('16. BarChart'));
    const chartWrap = el('div', { style: { padding: '0 0px' } });
    chartWrap.appendChild(el('div', {
      style: { ...DS.font('md'), color: 'var(--text)', padding: '0 20px 8px' },
      textContent: 'Выручка по месяцам',
    }));
    chartWrap.appendChild(M.BarChart({
      data: [
        { label: 'Янв', value: 1200000 },
        { label: 'Фев', value: 1800000 },
        { label: 'Мар', value: 950000 },
        { label: 'Апр', value: 2200000 },
        { label: 'Май', value: 1650000 },
        { label: 'Июн', value: 2800000 },
        { label: 'Июл', value: 3100000 },
        { label: 'Авг', value: 2400000 },
      ],
      opts: { height: 140 },
    }));
    page.appendChild(chartWrap);

    // Dual bar chart
    page.appendChild(sectionTitle('16b. BarChart (dual)'));
    const dualWrap = el('div', { style: { padding: '0 0px' } });
    dualWrap.appendChild(el('div', {
      style: { ...DS.font('md'), color: 'var(--text)', padding: '0 20px 8px' },
      textContent: 'Доходы vs Расходы',
    }));
    dualWrap.appendChild(M.BarChart({
      data: [
        { label: 'Янв', value: 1200, value2: 800 },
        { label: 'Фев', value: 1800, value2: 1200 },
        { label: 'Мар', value: 950, value2: 1400 },
        { label: 'Апр', value: 2200, value2: 900 },
        { label: 'Май', value: 1650, value2: 1100 },
        { label: 'Июн', value: 2800, value2: 1500 },
      ],
      opts: { height: 130, dual: true },
    }));
    page.appendChild(dualWrap);

    // ─── MINI CHART (17) ───
    page.appendChild(sectionTitle('17. MiniChart (sparkline)'));
    const miniWrap = el('div', {
      style: { padding: '0 20px', background: 'var(--surface)', borderRadius: 'var(--r-lg)', margin: '0 20px', padding: '14px' },
    });
    const miniRow = el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } });
    miniRow.appendChild(el('span', {
      style: { ...DS.font('sm'), color: 'var(--text-sec)', flexShrink: 0 },
      textContent: 'Тренд выручки',
    }));
    const miniChartWrap = el('div', { style: { flex: 1 } });
    miniChartWrap.appendChild(M.MiniChart({
      data: [12, 18, 9, 22, 16, 28, 31, 24, 27, 33, 29, 35],
      opts: { color: 'var(--green)', height: 44 },
    }));
    miniRow.appendChild(miniChartWrap);
    miniWrap.appendChild(miniRow);

    const miniRow2 = el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px' } });
    miniRow2.appendChild(el('span', {
      style: { ...DS.font('sm'), color: 'var(--text-sec)', flexShrink: 0 },
      textContent: 'Тренд расходов',
    }));
    const miniChartWrap2 = el('div', { style: { flex: 1 } });
    miniChartWrap2.appendChild(M.MiniChart({
      data: [8, 12, 14, 9, 18, 22, 15, 20, 25, 19, 28, 30],
      opts: { color: 'var(--red)', height: 44 },
    }));
    miniRow2.appendChild(miniChartWrap2);
    miniWrap.appendChild(miniRow2);
    page.appendChild(miniWrap);

    // ─── BIG NUMBER (18) ───
    page.appendChild(sectionTitle('18. BigNumber'));
    const bigNumWrap = el('div', {
      style: {
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', padding: '0 20px',
      },
    });
    bigNumWrap.appendChild(wrapInSurface(M.BigNumber({
      value: 12450000,
      label: 'Общая выручка',
      suffix: ' ₽',
      color: 'var(--green)',
      trend: { value: '+12.4%', up: true },
    })));
    bigNumWrap.appendChild(wrapInSurface(M.BigNumber({
      value: 156,
      label: 'Активных задач',
      icon: '📋',
      trend: { value: '-3.2%', up: false },
    })));
    page.appendChild(bigNumWrap);

    // ─── FORM (19) ───
    page.appendChild(sectionTitle('19. Form'));
    page.appendChild(M.Form({
      fields: [
        { type: 'text', id: 'name', label: 'ФИО', placeholder: 'Введите имя', required: true, section: 'Основные данные' },
        { type: 'email', id: 'email', label: 'Email', placeholder: 'user@asgard.ru' },
        { type: 'tel', id: 'phone', label: 'Телефон', placeholder: '+7 (___) ___-__-__' },
        { type: 'select', id: 'role', label: 'Роль', options: [
          { value: 'PM', label: 'Проект-менеджер' },
          { value: 'ENGINEER', label: 'Инженер' },
          { value: 'ADMIN', label: 'Администратор' },
        ], section: 'Должность' },
        { type: 'number', id: 'salary', label: 'Оклад', placeholder: '100 000' },
        { type: 'textarea', id: 'notes', label: 'Примечание', placeholder: 'Комментарии...', section: 'Дополнительно' },
        { type: 'toggle', id: 'active', label: 'Активен', value: true },
      ],
      onSubmit: (data) => {
        console.log('[Test] Form submitted:', data);
        M.Toast({ message: 'Форма отправлена! См. console', type: 'success' });
      },
      submitLabel: 'Сохранить сотрудника',
    }));

    // ─── FULL WIDTH BUTTONS (20) ───
    page.appendChild(sectionTitle('20. FullWidthBtn'));
    const btnsWrap = el('div', {
      style: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '0 20px' },
    });
    btnsWrap.appendChild(M.FullWidthBtn({ label: 'Primary (градиент)', variant: 'primary', onClick: () => {} }));
    btnsWrap.appendChild(M.FullWidthBtn({ label: 'Secondary', variant: 'secondary', onClick: () => {} }));
    btnsWrap.appendChild(M.FullWidthBtn({ label: 'Danger', variant: 'danger', onClick: () => {} }));
    btnsWrap.appendChild(M.FullWidthBtn({ label: 'Ghost', variant: 'ghost', onClick: () => {} }));

    const loadingBtn = M.FullWidthBtn({ label: 'Loading demo', variant: 'primary', onClick: () => {
      loadingBtn.setLoading(true);
      setTimeout(() => {
        loadingBtn.setLoading(false);
        M.Toast({ message: 'Загрузка завершена', type: 'success' });
      }, 2000);
    }});
    btnsWrap.appendChild(loadingBtn);
    btnsWrap.style.marginBottom = '16px';
    page.appendChild(btnsWrap);

    // ─── DETAIL FIELDS (21) ───
    page.appendChild(sectionTitle('21. DetailFields'));
    page.appendChild(M.DetailFields({
      fields: [
        { label: 'Заказчик', value: 'ООО «Асгард Групп»' },
        { label: 'ИНН', value: '7701234567', copy: true },
        { label: 'Телефон', value: '+7 (495) 123-45-67', type: 'phone' },
        { label: 'Email', value: 'info@asgard-group.ru', type: 'email' },
        { label: 'Статус', value: 'Активен', type: 'badge', badgeColor: 'success' },
        { label: 'Прогресс', value: 73, type: 'progress', max: 100 },
        { label: 'Проект', value: 'ТЦ Галерея', type: 'link', href: '/test' },
        { label: 'Адрес', value: 'г. Москва, ул. Тверская, д. 1' },
      ],
    }));

    // ─── PROGRESS BAR (22) ───
    page.appendChild(sectionTitle('22. ProgressBar'));
    const progressWrap = el('div', {
      style: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '0 20px' },
    });
    [
      { value: 25, label: '25%', title: 'Этап 1: Проектирование' },
      { value: 60, label: '60%', title: 'Этап 2: Монтаж' },
      { value: 85, label: '85%', title: 'Этап 3: Пуско-наладка', color: 'var(--green)' },
      { value: 100, label: '100%', title: 'Этап 4: Сдача' },
    ].forEach(p => {
      const row = el('div');
      row.appendChild(el('div', {
        style: { ...DS.font('sm'), color: 'var(--text-sec)', marginBottom: '4px' },
        textContent: p.title,
      }));
      row.appendChild(M.ProgressBar(p));
      progressWrap.appendChild(row);
    });
    page.appendChild(progressWrap);

    // ─── TABS (23) ───
    page.appendChild(sectionTitle('23. Tabs'));
    const tabContent = el('div', {
      style: { padding: '16px 20px', color: 'var(--text-sec)', fontSize: '14px' },
      textContent: 'Содержимое вкладки «Обзор»',
    });
    page.appendChild(M.Tabs({
      items: [
        { label: 'Обзор', value: 'overview' },
        { label: 'Финансы', value: 'finance' },
        { label: 'Задачи', value: 'tasks' },
        { label: 'Документы', value: 'docs' },
        { label: 'История', value: 'history' },
      ],
      active: 'overview',
      onChange: (v) => {
        const labels = { overview: 'Обзор', finance: 'Финансы', tasks: 'Задачи', docs: 'Документы', history: 'История' };
        tabContent.textContent = `Содержимое вкладки «${labels[v] || v}»`;
      },
    }));
    page.appendChild(tabContent);

    // ─── QUICK ACTIONS (24) ───
    page.appendChild(sectionTitle('24. QuickActions'));
    page.appendChild(M.QuickActions({
      items: [
        { icon: '➕', label: 'Новый объект', onClick: () => M.Toast({ message: 'Создать объект', type: 'info' }) },
        { icon: '📋', label: 'Задача', onClick: () => M.Toast({ message: 'Создать задачу', type: 'info' }) },
        { icon: '💰', label: 'Счёт', onClick: () => M.Toast({ message: 'Выставить счёт', type: 'info' }) },
        { icon: '👤', label: 'Сотрудник', onClick: () => M.Toast({ message: 'Добавить сотрудника', type: 'info' }) },
        { icon: '📊', label: 'Отчёт', onClick: () => M.Toast({ message: 'Сформировать отчёт', type: 'info' }) },
        { icon: '📞', label: 'Звонок', onClick: () => M.Toast({ message: 'Набрать номер', type: 'info' }) },
      ],
    }));

    // ─── MIMIR BANNER (25) ───
    page.appendChild(sectionTitle('25. MimirBanner'));
    page.appendChild(M.MimirBanner({
      title: 'Мимир подсказывает',
      text: 'По объекту «ТЦ Галерея» есть 3 просроченные задачи. Рекомендую связаться с подрядчиком и перенести дедлайн по монтажу до конца недели.',
    }));

    const mimirWrap = el('div', { style: { marginTop: '12px' } });
    mimirWrap.appendChild(M.MimirBanner({
      title: 'Финансовый анализ',
      text: 'За последний месяц расходы выросли на 18%. Основная причина — закупка ТМЦ на объекте «БЦ Северный».',
      icon: '📈',
    }));
    page.appendChild(mimirWrap);

    // ─── SEARCH BAR (26) ───
    page.appendChild(sectionTitle('26. SearchBar'));
    const searchWrap = el('div');
    searchWrap.appendChild(M.SearchBar({
      placeholder: 'Поиск по объектам, задачам, сотрудникам...',
      onSearch: (q) => {
        searchResult.textContent = q ? `Результат поиска: «${q}»` : 'Введите запрос для поиска';
      },
    }));
    const searchResult = el('div', {
      style: { padding: '8px 20px', color: 'var(--text-ter)', fontSize: '13px' },
      textContent: 'Введите запрос для поиска',
    });
    searchWrap.appendChild(searchResult);
    page.appendChild(searchWrap);

    // ─── TABLE PAGE (15) — в виде мини-демо ───
    page.appendChild(sectionTitle('15. TablePage (мини-демо)'));
    const tpNote = el('div', {
      style: { padding: '0 20px', ...DS.font('sm'), color: 'var(--text-sec)', marginBottom: '8px' },
      textContent: 'TablePage — это полноценная страница. Нажмите кнопку ниже для перехода на демо TablePage:',
    });
    page.appendChild(tpNote);
    const tpBtnWrap = el('div', { style: { padding: '0 20px' } });
    tpBtnWrap.appendChild(M.FullWidthBtn({
      label: 'Открыть TablePage Demo',
      variant: 'primary',
      onClick: () => Router.navigate('/test-table'),
    }));
    page.appendChild(tpBtnWrap);

    // ─── PULL-TO-REFRESH NOTE ───
    page.appendChild(sectionTitle('Pull-to-Refresh'));
    const ptrNote = el('div', {
      style: { padding: '0 20px', ...DS.font('sm'), color: 'var(--text-sec)', marginBottom: '40px' },
      textContent: 'Потяните страницу вниз от самого верха для pull-to-refresh. При срабатывании появится спиннер и событие asgard:refresh. Проверьте на реальном устройстве.',
    });
    page.appendChild(ptrNote);

    // ─── Footer ───
    const footer = el('div', {
      style: {
        textAlign: 'center', padding: '24px 20px 40px',
        color: 'var(--text-ter)', fontSize: '12px',
      },
    });
    footer.appendChild(el('div', { textContent: 'ASGARD CRM — Mobile v2.0' }));
    footer.appendChild(el('div', { textContent: '26 компонентов • Тест-страница', style: { marginTop: '4px' } }));
    page.appendChild(footer);

    return page;

    // ─── Helpers ───
    function sectionTitle(text) {
      return el('div', {
        style: {
          ...DS.font('label'),
          color: 'var(--text-ter)',
          padding: '20px 20px 8px',
        },
        textContent: text,
      });
    }

    function wrapInSurface(child) {
      const w = el('div', {
        style: {
          background: 'var(--surface)', borderRadius: 'var(--r-lg)',
          padding: '14px', border: '1px solid var(--border)',
        },
      });
      w.appendChild(child);
      return w;
    }
  },
};

/* ──────── TablePage Demo (отдельная страница) ──────── */
const TestTablePage = {
  render() {
    const demoItems = [];
    const statuses = ['В работе', 'Завершён', 'На согласовании', 'Отклонён', 'Новый'];
    const colors = ['info', 'success', 'warning', 'danger', 'gold'];
    const names = [
      'ТЦ Галерея', 'БЦ Северный', 'ЖК Рассвет', 'Склад Южный', 'Офис «Альфа»',
      'Магазин «Рунный двор»', 'Производство «Мьёльнир»', 'Центр «Вальхалла»',
      'Штаб «Один»', 'Порт «Бифрёст»', 'Башня «Хеймдалль»', 'Ресторан «Фрейя»',
      'Парк «Иггдрасиль»', 'Арена «Тор»', 'Мастерская «Двалин»',
    ];

    for (let i = 0; i < 30; i++) {
      const si = i % statuses.length;
      demoItems.push({
        id: i + 1,
        name: names[i % names.length],
        status: statuses[si],
        statusColor: colors[si],
        budget: Math.round(Math.random() * 5000000 + 500000),
        date: new Date(2026, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1),
      });
    }

    return M.TablePage({
      title: 'Объекты',
      subtitle: 'ПОРТФЕЛЬ ПРОЕКТОВ',
      items: demoItems,
      search: true,
      back: true,
      backHref: '/test',
      filter: {
        pills: [
          { label: 'Все', value: 'all', active: true },
          { label: 'В работе', value: 'В работе' },
          { label: 'Завершён', value: 'Завершён' },
          { label: 'На согласовании', value: 'На согласовании' },
        ],
        filterFn: (item, filter) => filter === 'all' || item.status === filter,
      },
      stats: [
        { icon: '🏗️', label: 'Всего', value: 30 },
        { icon: '✅', label: 'Завершены', value: 6, color: 'var(--green)' },
        { icon: '🔄', label: 'В работе', value: 6, color: 'var(--blue)' },
        { icon: '⏳', label: 'Ожидание', value: 6, color: 'var(--orange)' },
      ],
      chart: {
        title: 'Бюджет по месяцам',
        type: 'bar',
        data: [
          { label: 'Янв', value: 2100000 },
          { label: 'Фев', value: 3400000 },
          { label: 'Мар', value: 1900000 },
          { label: 'Апр', value: 4200000 },
          { label: 'Май', value: 2800000 },
          { label: 'Июн', value: 3600000 },
        ],
      },
      renderItem: (item, i) => M.Card({
        title: item.name,
        subtitle: `Объект #${item.id}`,
        badge: item.status,
        badgeColor: item.statusColor,
        fields: [
          { label: 'Бюджет', value: Utils.formatMoney(item.budget, { short: true }) },
          { label: 'Дата', value: Utils.formatDate(item.date, 'short') },
        ],
        href: '/test',
        animDelay: Math.min(i * 0.03, 0.3),
        swipeActions: [
          { label: 'Архив', color: 'var(--orange)', onClick: () => M.Toast({ message: item.name + ' → Архив', type: 'info' }) },
        ],
      }),
      onRefresh: () => {
        return new Promise(resolve => {
          setTimeout(() => {
            M.Toast({ message: 'Данные обновлены!', type: 'success' });
            resolve(demoItems);
          }, 1200);
        });
      },
    });
  },
};

// Global exports
if (typeof window !== 'undefined') {
  window.TestPage = TestPage;
  window.TestTablePage = TestTablePage;
}
