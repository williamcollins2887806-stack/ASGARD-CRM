/**
 * ASGARD CRM — Mobile v3 Test Showcase
 * Витрина ВСЕХ компонентов + навигация + виджеты дашборда
 * Сессия 1 — 14.03.2026
 */
const TestPage = {
  render() {
    const t = DS.t;
    const page = document.createElement('div');
    page.className = 'mv3-page';
    Object.assign(page.style, { background: t.bg, paddingBottom: '120px' });

    const el = (tag, s, ch) => {
      const e = document.createElement(tag);
      if (s && typeof s === 'object' && !Array.isArray(s) && !(s instanceof HTMLElement)) Object.assign(e.style, s);
      if (typeof ch === 'string') e.textContent = ch;
      else if (ch instanceof HTMLElement) e.appendChild(ch);
      else if (Array.isArray(ch)) ch.forEach(c => { if (c instanceof HTMLElement) e.appendChild(c); });
      return e;
    };

    const sn = { n: 0 };
    function sec(title, desc) {
      sn.n++;
      const w = el('div', { padding: '24px 20px 8px' });
      w.appendChild(el('div', { ...DS.font('xs'), color: t.red, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }, 'БЛОК ' + sn.n));
      w.appendChild(el('div', { ...DS.font('xl'), color: t.text, marginBottom: desc ? '4px' : '0' }, title));
      if (desc) w.appendChild(el('div', { ...DS.font('sm'), color: t.textSec, lineHeight: '1.4' }, desc));
      return w;
    }
    function gap(h) { return el('div', { height: (h || 12) + 'px' }); }
    function pad(child) { const w = el('div', { padding: '0 20px' }); if (child instanceof HTMLElement) w.appendChild(child); return w; }

    // ═══ HEADER ═══
    const themeToggle = DS.createThemeToggle();
    page.appendChild(M.Header({ title: 'Витрина v3', subtitle: 'ASGARD MOBILE', back: false, actions: [
      { icon: '<span id="mv3-theme-slot" style="display:flex"></span>', onClick: () => {} },
      { icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>', onClick: () => DS.toggleTheme() },
    ]}));
    setTimeout(() => { const s = document.getElementById('mv3-theme-slot'); if (s) s.appendChild(themeToggle); }, 0);

    // ═══ HERO ═══
    page.appendChild(el('div', { padding: '12px 20px' }, M.HeroCard({ label: 'ASGARD CRM • MOBILE V3', value: '40', valueSuffix: ' компонентов', details: [{ label: 'Виджетов', value: '27' }, { label: 'Секций', value: '17' }, { label: 'Стандарт', value: 'Сбер/Альфа', color: '#34C759' }] })));

    // ═══ BLOCK 1: NAV ═══
    page.appendChild(sec('Навигация', 'TabBar внизу, Header, Burger-меню'));
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, 'TabBar фиксирован внизу экрана ↓')));
    page.appendChild(pad(M.FullWidthBtn({ label: '☰  Открыть бургер-меню', variant: 'secondary', onClick: openBurger })));
    page.appendChild(gap());
    page.appendChild(M.Header({ title: 'Тендеры', subtitle: 'Воронка продаж', back: true, actions: [
      { icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>', onClick: () => M.Toast({ message: 'Поиск', type: 'info' }) },
    ]}));

    // ═══ BLOCK 2: BUTTONS ═══
    page.appendChild(sec('Кнопки', 'Primary, Ghost, Danger, Success, Warning, Loading'));
    const bg = el('div', { display: 'flex', flexDirection: 'column', gap: '10px', padding: '0 20px' });
    bg.appendChild(M.FullWidthBtn({ label: 'Primary (градиент)', onClick: () => M.Toast({ message: 'Primary!', type: 'info' }) }));
    bg.appendChild(M.FullWidthBtn({ label: 'Ghost (обводка)', variant: 'secondary' }));
    bg.appendChild(M.FullWidthBtn({ label: '✕ Отклонить', variant: 'danger' }));
    const cr = el('div', { display: 'flex', gap: '8px' });
    ['success', 'warning', 'info', 'gold'].forEach(type => {
      const s = DS.status(type);
      const labels = { success: '✓ Согласовать', warning: '↻ Доработка', info: '? Вопрос', gold: '★ Премия' };
      const b = el('button', { flex: 1, padding: '10px 4px', borderRadius: '12px', border: 'none', background: s.bg, color: s.color, fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }, labels[type]);
      cr.appendChild(b);
    });
    bg.appendChild(cr);
    const lb = M.FullWidthBtn({ label: 'Обработка...', loading: true }); bg.appendChild(lb);
    const mr = el('div', { display: 'flex', gap: '8px', flexWrap: 'wrap' });
    ['Позвонить', 'Email', 'Копировать'].forEach(l => mr.appendChild(el('button', { padding: '6px 14px', borderRadius: '8px', border: '1px solid ' + t.border, background: t.surface, color: t.blue, fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }, l)));
    bg.appendChild(mr);
    page.appendChild(bg);

    // ═══ BLOCK 3: PILLS ═══
    page.appendChild(sec('Pill-статусы', 'Все статусы CRM'));
    const pg = el('div', { display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '0 20px' });
    [['Черновик','neutral'],['На согласовании','info'],['Согласовано','success'],['На доработке','warning'],['Вопрос','gold'],['Отклонено','danger'],['Ожидает оплаты','warning'],['Оплачено ПП','success'],['Наличные выданы','info'],['Новый','neutral'],['В работе','info'],['Просрочено','danger']].forEach(([x,c]) => pg.appendChild(M.Badge({ text: x, color: c })));
    page.appendChild(pg);

    // ═══ BLOCK 4: CARDS ═══
    page.appendChild(sec('Карточки', 'Тендер, работа, аванс, согласование, уведомление, сотрудник'));
    page.appendChild(el('div', { padding: '0 20px' }, M.Card({ title: 'ЯНПЗ — Очистка ПТО NT250LH', subtitle: 'Конкурс №11-178-26', badge: 'На согласовании', badgeColor: 'info', time: '25.03', fields: [{ label: 'Сумма', value: '4 230 000 ₽' }, { label: 'РП', value: 'Андросов Н.А.' }, { label: 'Маржа', value: '50%' }], onClick: () => M.Toast({ message: 'Тендер ЯНПЗ', type: 'info' }) })));
    page.appendChild(gap(8));

    const wc = M.Card({ title: 'Архбум — Цилиндр ПГ-М 1100', badge: 'В работе', badgeColor: 'info', fields: [{ label: 'Бюджет', value: '1 760 000 ₽' }] });
    const pw = el('div', { padding: '10px 0 0' }); pw.appendChild(M.ProgressBar({ value: 65, label: '65%' })); wc.appendChild(pw);
    page.appendChild(el('div', { padding: '0 20px' }, wc));
    page.appendChild(gap(8));

    page.appendChild(el('div', { padding: '0 20px' }, M.Card({ title: 'Заявка на аванс — Командировка Уфа', badge: 'Ожидает оплаты', badgeColor: 'warning', fields: [{ label: 'Сумма', value: '85 000 ₽' }, { label: 'От', value: 'Петров И.С.' }], actions: [{ label: '✓ ПП', onClick: () => M.Toast({ message: 'ПП', type: 'success' }) }, { label: '💵 Нал', onClick: () => M.Toast({ message: 'Наличные', type: 'info' }) }, { label: '↻', onClick: () => M.Toast({ message: 'Доработка', type: 'warning' }) }] })));
    page.appendChild(gap(8));

    const ac = M.Card({ title: 'Просчёт: НОВАТЭК Усть-Луга', subtitle: 'От: Андросов → Директор', badge: 'Согласование', badgeColor: 'info' });
    const ab = el('div', { display: 'flex', gap: '6px', marginTop: '12px', borderTop: '1px solid ' + t.border, paddingTop: '12px' });
    [['✓','success','Да'],['↻','warning','Доработка'],['?','gold','Вопрос'],['✕','danger','Нет']].forEach(([i,ty,l]) => { const s = DS.status(ty); const b = el('button', { flex: 1, padding: '10px 4px', borderRadius: '10px', border: '1px solid ' + s.border, background: s.bg, color: s.color, fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }, i + ' ' + l); ab.appendChild(b); });
    ac.appendChild(ab);
    page.appendChild(el('div', { padding: '0 20px' }, ac));
    page.appendChild(gap(8));

    const nw = el('div', { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 20px' });
    nw.appendChild(M.NotificationCard({ title: 'Новое согласование от Кудряшова О.С.', text: 'Просчёт ЯНПЗ требует решения', time: '5 мин', type: 'task' }));
    nw.appendChild(M.NotificationCard({ title: 'Оплата: 2 150 000 ₽', text: 'Газпромнефть — счёт №127', time: '1 ч', type: 'money', read: true }));
    page.appendChild(nw);
    page.appendChild(gap(8));

    const ec = el('div', { display: 'flex', gap: '14px', alignItems: 'center', padding: '14px 16px', background: t.surface, borderRadius: '18px', border: '1px solid ' + t.border });
    ec.appendChild(M.Avatar({ name: 'Андросов Никита', size: 48, status: 'online' }));
    const ei = el('div', { flex: '1', minWidth: '0' }); ei.appendChild(el('div', { ...DS.font('md'), color: t.text }, 'Андросов Никита')); ei.appendChild(el('div', { ...DS.font('sm'), color: t.textSec }, 'Руководитель проекта'));
    const rr = el('div', { display: 'flex', gap: '2px', marginTop: '4px' }); for (let i = 0; i < 5; i++) rr.appendChild(el('span', { fontSize: '12px', color: i < 4 ? t.gold : t.textTer }, i < 4 ? '★' : '☆')); ei.appendChild(rr);
    ec.appendChild(ei);
    page.appendChild(el('div', { padding: '0 20px' }, ec));

    // ═══ BLOCK 5: AVATARS & CHIPS ═══
    page.appendChild(sec('Avatar & Chip', 'Аватары, теги'));
    const ar = el('div', { display: 'flex', gap: '12px', padding: '0 20px', flexWrap: 'wrap', alignItems: 'center' });
    ['Кудряшов О.С.', 'Петров И.С.', 'Сидорова А.В.', 'Мимир AI'].forEach(n => ar.appendChild(M.Avatar({ name: n, size: 44, status: n.includes('Мимир') ? 'online' : undefined })));
    page.appendChild(ar); page.appendChild(gap(8));
    const chR = el('div', { display: 'flex', gap: '6px', padding: '0 20px', flexWrap: 'wrap' });
    [['Химчистка','info'],['Гидравлика','success'],['АВО','warning'],['Тендер','danger'],['Офшор','gold']].forEach(([x,c]) => chR.appendChild(M.Chip({ text: x, color: c, onRemove: () => {} })));
    page.appendChild(chR);

    // ═══ BLOCK 6: SEGMENT & TABS ═══
    page.appendChild(sec('Segment & Tabs', 'Переключатели'));
    page.appendChild(pad(M.SegmentControl({ items: [{ label: 'Все', value: 'all' }, { label: 'Мои', value: 'mine' }, { label: 'Срочные', value: 'urgent' }], active: 'all', onChange: (v) => M.Toast({ message: v, type: 'info', duration: 1500 }) })));
    page.appendChild(gap(8));
    page.appendChild(M.Tabs({ items: [{ label: 'Тендеры', value: 't' }, { label: 'Воронка', value: 'f' }, { label: 'Заявки', value: 'r' }, { label: 'Архив', value: 'a' }], active: 't' }));

    // ═══ BLOCK 7: FORMS ═══
    page.appendChild(sec('Формы', 'Input, Select, Toggle, DatePicker, StepWizard'));
    page.appendChild(M.Form({ fields: [
      { id: 'name', label: 'Наименование', value: 'Очистка NT250', required: true },
      { id: 'amount', label: 'Сумма (₽)', type: 'number', value: '4230000' },
      { id: 'rp', label: 'Ответственный', type: 'select', options: [{ value: 'a', label: 'Андросов Н.А.' }, { value: 'p', label: 'Петров И.С.' }], value: 'a' },
      { id: 'comment', label: 'Комментарий', type: 'textarea' },
      { id: 'urgent', label: 'Срочная заявка', type: 'toggle', value: true },
    ], submitLabel: 'Создать', onSubmit: (d) => M.Toast({ message: 'OK!', type: 'success' }) }));
    page.appendChild(pad(M.DatePicker({ label: 'Дедлайн', value: '2026-03-25' })));
    page.appendChild(gap());

    let ws = 0;
    const wz = el('div');
    function rw() { wz.innerHTML = ''; wz.appendChild(M.StepWizard({ steps: [{ label: 'Объект', content: el('div', { padding: '12px 0', ...DS.font('base'), color: t.textSec }, 'Шаг 1: Выберите объект') }, { label: 'Работы', content: el('div', { padding: '12px 0', ...DS.font('base'), color: t.textSec }, 'Шаг 2: Опишите работы') }, { label: 'Стоимость', content: el('div', { padding: '12px 0', ...DS.font('base'), color: t.textSec }, 'Шаг 3: Рассчитайте') }, { label: 'Подача', content: el('div', { padding: '12px 0', ...DS.font('base'), color: t.textSec }, 'Шаг 4: Отправка') }], current: ws, onChange: (s) => { ws = s >= 4 ? 0 : s; rw(); } })); }
    rw();
    page.appendChild(wz);

    // ═══ BLOCK 8: BOTTOM SHEET & MODALS ═══
    page.appendChild(sec('Bottom Sheet & Модалки', 'Фильтры, Action Sheet, Confirm'));
    const mb = el('div', { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 20px' });
    mb.appendChild(M.FullWidthBtn({ label: '⬆ Bottom Sheet (фильтры)', variant: 'secondary', onClick: openFilterSheet }));
    mb.appendChild(M.FullWidthBtn({ label: '⚡ Action Sheet (iOS)', variant: 'secondary', onClick: () => M.ActionSheet({ title: 'Действия', actions: [{ icon: '📝', label: 'Редактировать' }, { icon: '📋', label: 'Дублировать' }, { icon: '🗑', label: 'Удалить', danger: true }] }) }));
    mb.appendChild(M.FullWidthBtn({ label: '❓ Confirm', variant: 'secondary', onClick: async () => { const ok = await M.Confirm({ title: 'Отклонить?', message: 'Заявка будет отклонена', okText: 'Да', cancelText: 'Нет', danger: true }); M.Toast({ message: ok ? 'Отклонено' : 'Отмена', type: ok ? 'error' : 'info' }); } }));
    page.appendChild(mb);

    // ═══ BLOCK 9: SWIPE ═══
    page.appendChild(sec('Свайп & Списки', '← Свайпни карточку влево'));
    page.appendChild(el('div', { padding: '0 20px' }, M.SwipeCard({ title: 'НОВАТЭК — Усть-Луга', subtitle: '28 000 000 ₽ | Промывка АВО', rightActions: [{ label: '✓', color: '#34C759', onClick: () => M.Toast({ message: 'OK', type: 'success' }) }, { label: '✕', color: '#E53935', onClick: () => M.Toast({ message: 'Нет', type: 'error' }) }] })));
    page.appendChild(gap(8));
    page.appendChild(el('div', { padding: '0 20px' }, M.SwipeCard({ title: 'Газпромнефть — Котлы', subtitle: '6 340 000 ₽ | Химчистка', rightActions: [{ label: '📝', color: '#4A90D9' }, { label: '🗑', color: '#E53935' }] })));
    page.appendChild(gap());
    page.appendChild(M.Empty({ text: 'Нет активных тендеров', icon: '⚔️' }));

    // ═══ BLOCK 10: TOASTS ═══
    page.appendChild(sec('Toast-уведомления', 'Успех, ошибка, инфо'));
    const tr = el('div', { display: 'flex', gap: '8px', padding: '0 20px', flexWrap: 'wrap' });
    [['✅ Успех','success'],['❌ Ошибка','error'],['ℹ️ Инфо','info']].forEach(([l,ty]) => { const b = el('button', { padding: '10px 16px', borderRadius: '10px', border: '1px solid ' + t.border, background: t.surface, color: t.text, fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }, l); b.addEventListener('click', () => M.Toast({ message: l + ' — тест', type: ty })); tr.appendChild(b); });
    page.appendChild(tr);

    // ═══ BLOCK 11: SKELETONS ═══
    page.appendChild(sec('Скелетоны', 'Hero, Card, List, Stats'));
    page.appendChild(M.Skeleton({ type: 'hero', count: 1 })); page.appendChild(gap(8));
    page.appendChild(M.Skeleton({ type: 'stats', count: 1 })); page.appendChild(gap(8));
    page.appendChild(M.Skeleton({ type: 'card', count: 2 })); page.appendChild(gap(8));
    page.appendChild(M.Skeleton({ type: 'list', count: 3 }));

    // ═══ BLOCK 12: CHARTS ═══
    page.appendChild(sec('Графики', 'Stats, BarChart, Donut, Progress, Sparkline'));
    page.appendChild(M.Stats({ items: [{ icon: '📊', value: 47, label: 'Тендеров', color: t.blue }, { icon: '💰', value: 156, label: 'Млн ₽', color: t.green }, { icon: '🔧', value: 23, label: 'Работ', color: t.orange }, { icon: '⚠️', value: 5, label: 'Просрочено', color: t.red }] }));
    page.appendChild(gap());
    page.appendChild(M.Section({ title: 'Тендеры по месяцам', content: M.BarChart({ data: [{ label: 'Янв', value: 12, value2: 8 }, { label: 'Фев', value: 18, value2: 14 }, { label: 'Мар', value: 24, value2: 19 }, { label: 'Апр', value: 16, value2: 11 }, { label: 'Май', value: 22, value2: 17 }, { label: 'Июн', value: 28, value2: 22 }], opts: { dual: true, height: 120 } }), collapsible: true }));
    const dr = el('div', { display: 'flex', justifyContent: 'space-around', padding: '12px 20px' });
    dr.appendChild(M.DonutChart({ value: 78, label: 'Маржа' }));
    dr.appendChild(M.DonutChart({ value: 45, label: 'KPI', color: 'var(--blue)' }));
    dr.appendChild(M.DonutChart({ value: 92, label: 'Загрузка', color: 'var(--green)' }));
    page.appendChild(dr); page.appendChild(gap());
    const pW = el('div', { display: 'flex', flexDirection: 'column', gap: '10px', padding: '0 20px' });
    [['Андросов',85],['Петров',62],['Сидорова',45],['Козлов',95]].forEach(([n,v]) => { const r = el('div'); r.appendChild(el('div', { ...DS.font('sm'), color: t.text, marginBottom: '4px' }, n)); r.appendChild(M.ProgressBar({ value: v, label: v + '%' })); pW.appendChild(r); });
    page.appendChild(pW); page.appendChild(gap());
    page.appendChild(pad(M.MiniChart({ data: [12,18,14,22,19,28,24,32,27,35,30,38] })));

    // ═══ BLOCK 13: TIMELINE ═══
    page.appendChild(sec('Timeline', 'Лента событий'));
    page.appendChild(M.Timeline({ items: [
      { title: 'Заявка создана', text: 'Андросов Н.А.', time: '14:32', color: 'var(--blue)' },
      { title: 'Согласовано', text: 'Кудряшов О.С.', time: '15:10', badge: 'OK', badgeColor: 'success', color: 'var(--green)' },
      { title: 'В бухгалтерию', text: 'Ожидает оплаты', time: '15:15', color: 'var(--orange)' },
      { title: 'Оплачено', text: 'ПП №1247 — 85 000 ₽', time: '16:40', badge: 'Оплачено', badgeColor: 'success', color: 'var(--green)' },
    ] }));

    // ═══ BLOCK 14: CHAT ═══
    page.appendChild(sec('Чат (Хугинн)', 'Пузыри + поле ввода'));
    const cw = el('div', { padding: '12px 20px', background: t.bg, borderRadius: '16px', margin: '0 20px', border: '1px solid ' + t.border });
    cw.appendChild(M.ChatBubble({ text: 'По ЯНПЗ — согласование прошло!', name: 'Кудряшов О.С.', time: '14:20' }));
    cw.appendChild(M.ChatBubble({ text: 'Отлично! Подам сегодня', mine: true, time: '14:22', status: 'read' }));
    cw.appendChild(M.ChatBubble({ text: 'Ещё по Архбуму — замена прокладок на Viton', name: 'Кудряшов О.С.', time: '14:25' }));
    cw.appendChild(M.ChatBubble({ text: 'Понял, проверю 👍', mine: true, time: '14:26', status: 'sent' }));
    page.appendChild(cw);
    const cm = el('div', { margin: '0 20px', borderRadius: '0 0 16px 16px', overflow: 'hidden' });
    cm.appendChild(M.MessageComposer({ onSend: (x) => M.Toast({ message: 'Отправлено: ' + x, type: 'success' }), onAttach: () => M.Toast({ message: 'Прикрепить', type: 'info' }) }));
    page.appendChild(cm);

    // ═══ BLOCK 15: QUICK ACTIONS & MIMIR ═══
    page.appendChild(sec('Быстрые действия', 'QuickActions + MimirBanner'));
    page.appendChild(M.QuickActions({ items: [{ icon: '📋', label: 'Тендер' }, { icon: '💰', label: 'Аванс' }, { icon: '💳', label: 'Касса' }, { icon: '💬', label: 'Чат' }, { icon: '📊', label: 'KPI' }, { icon: '📷', label: 'Скан' }] }));
    page.appendChild(gap());
    page.appendChild(M.MimirBanner({ title: 'Мимир подсказывает', text: 'ЯНПЗ: дедлайн через 11 дней. Проверьте документацию.', icon: '🧠' }));

    // ═══ BLOCK 16: DASHBOARD WIDGETS ═══
    page.appendChild(sec('Виджеты дашборда', 'Мок-данные'));

    // Greeting
    const gr = el('div', { padding: '16px', margin: '0 20px', borderRadius: '16px', background: t.surface, border: '1px solid ' + t.border });
    gr.appendChild(el('div', { ...DS.font('lg'), color: t.text }, 'Добрый день, Ник! 👋'));
    gr.appendChild(el('div', { ...DS.font('sm'), color: t.textSec, marginTop: '4px' }, '14 марта 2026, пятница'));
    gr.appendChild(el('div', { ...DS.font('sm'), color: t.gold, marginTop: '8px', fontStyle: 'italic' }, '«Не бойся медленного продвижения» — викингская мудрость'));
    page.appendChild(gr); page.appendChild(gap());

    // Finance hero
    page.appendChild(el('div', { padding: '0 20px' }, M.HeroCard({ label: 'ФИНАНСЫ', value: '156 200 000', valueSuffix: ' ₽', details: [{ label: 'Расходы', value: '89.4 млн', color: '#FF9500' }, { label: 'Прибыль', value: '66.8 млн', color: '#34C759' }] })));
    page.appendChild(gap());

    // Funnel
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, 'Воронка продаж')));
    const fw = el('div', { padding: '0 20px' });
    [{ l: 'Заявки', c: 47, w: '100%', cl: t.blue }, { l: 'В работе', c: 28, w: '65%', cl: '#6366F1' }, { l: 'Подано', c: 18, w: '45%', cl: t.orange }, { l: 'Выиграно', c: 12, w: '30%', cl: t.green }, { l: 'Контракт', c: 8, w: '20%', cl: t.red }].forEach((s, i) => {
      const r = el('div', { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', ...DS.anim(i * 0.05) });
      const b = el('div', { height: '28px', borderRadius: '8px', width: s.w, background: s.cl, display: 'flex', alignItems: 'center', padding: '0 10px', minWidth: '50px' });
      b.appendChild(el('span', { fontSize: '11px', fontWeight: 700, color: '#fff' }, '' + s.c));
      r.appendChild(b); r.appendChild(el('span', { ...DS.font('xs'), color: t.textSec }, s.l));
      fw.appendChild(r);
    });
    page.appendChild(fw); page.appendChild(gap());

    // Tasks
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, 'Мои задачи')));
    const tc = el('div', { padding: '0', background: t.surface, borderRadius: '16px', border: '1px solid ' + t.border, overflow: 'hidden' });
    const tasks = [{ text: 'Отправить ТКП по ЯНПЗ', done: false }, { text: 'Проверить допуски бригады №3', done: true }, { text: 'Созвон с Рустамом (Новойл)', done: false }, { text: 'Обновить калькулятор', done: false }];
    tasks.forEach((tk, i) => {
      const r = el('div', { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', borderBottom: i < tasks.length - 1 ? '1px solid ' + t.border : 'none', cursor: 'pointer' });
      const ck = el('div', { width: '22px', height: '22px', borderRadius: '6px', flexShrink: 0, border: tk.done ? 'none' : '2px solid ' + t.border, background: tk.done ? t.green : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '13px', fontWeight: 700 }, tk.done ? '✓' : '');
      r.appendChild(ck);
      r.appendChild(el('span', { ...DS.font('base'), color: tk.done ? t.textTer : t.text, textDecoration: tk.done ? 'line-through' : 'none', flex: 1 }, tk.text));
      r.addEventListener('click', () => { tk.done = !tk.done; ck.style.background = tk.done ? t.green : 'transparent'; ck.style.border = tk.done ? 'none' : '2px solid ' + t.border; ck.textContent = tk.done ? '✓' : ''; r.children[1].style.textDecoration = tk.done ? 'line-through' : 'none'; r.children[1].style.color = tk.done ? t.textTer : t.text; try { navigator.vibrate(10); } catch(e) {} });
      tc.appendChild(r);
    });
    page.appendChild(pad(tc)); page.appendChild(gap());

    // Cash balance
    const cc = el('div', { padding: '16px', margin: '0 20px', borderRadius: '16px', background: t.surface, border: '1px solid ' + t.border });
    cc.appendChild(M.BigNumber({ value: 2450000, suffix: ' ₽', label: 'Баланс кассы', icon: '💵' }));
    page.appendChild(cc); page.appendChild(gap());

    // Overdue
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, 'Просроченные работы')));
    const ow = el('div', { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 20px' });
    ow.appendChild(M.Card({ title: 'ТОАЗ — Конденсаторы', badge: 'Просрочено 12 дн', badgeColor: 'danger', fields: [{ label: 'Бюджет', value: '2.4 млн' }] }));
    ow.appendChild(M.Card({ title: 'КАО Азот — Монтаж', badge: 'Просрочено 5 дн', badgeColor: 'danger', fields: [{ label: 'Бюджет', value: '15.5 млн' }] }));
    page.appendChild(ow); page.appendChild(gap());

    // Birthdays
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, 'Дни рождения')));
    const bw = el('div', { display: 'flex', gap: '12px', padding: '0 20px', overflowX: 'auto' }); bw.className = 'mv3-no-scrollbar';
    [{ n: 'Козлов Дмитрий', d: '16 мар' }, { n: 'Петрова Мария', d: '18 мар' }, { n: 'Сидоров Алексей', d: '22 мар' }].forEach(b => {
      const cd = el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '14px 16px', background: t.surface, borderRadius: '16px', border: '1px solid ' + t.border, minWidth: '100px', textAlign: 'center' });
      cd.appendChild(M.Avatar({ name: b.n, size: 40 })); cd.appendChild(el('div', { ...DS.font('sm'), color: t.text, fontWeight: 600 }, b.n.split(' ')[0])); cd.appendChild(el('div', { ...DS.font('xs'), color: t.textSec }, b.d)); cd.appendChild(el('div', { fontSize: '18px' }, '🎂'));
      bw.appendChild(cd);
    });
    page.appendChild(bw); page.appendChild(gap());

    // Deadlines
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, 'Ближайшие дедлайны')));
    const dw = el('div', { padding: '0 20px' });
    [{ d: '25 мар', t: 'ЯНПЗ — подача', cl: t.red }, { d: '28 мар', t: 'НОВАТЭК — корректировка', cl: t.orange }, { d: '01 апр', t: 'Архбум — начало работ', cl: t.blue }].forEach((dd, i) => {
      const r = el('div', { display: 'flex', gap: '12px', alignItems: 'center', padding: '10px 0', borderBottom: i < 2 ? '1px solid ' + t.border : 'none' });
      const db = el('div', { width: '50px', padding: '6px 4px', borderRadius: '8px', textAlign: 'center', background: dd.cl + '15', flexShrink: 0 });
      db.appendChild(el('div', { fontSize: '11px', fontWeight: 700, color: dd.cl }, dd.d));
      r.appendChild(db); r.appendChild(el('div', { ...DS.font('sm'), color: t.text, flex: 1 }, dd.t));
      dw.appendChild(r);
    });
    page.appendChild(dw);

    // ═══ BLOCK 17: DETAIL FIELDS ═══
    page.appendChild(sec('Детали объекта', 'DetailFields'));
    page.appendChild(M.DetailFields({ fields: [
      { label: 'Заказчик', value: 'ПАО ЯНПЗ' },
      { label: 'ИНН', value: '7601001010', copy: true },
      { label: 'Статус', value: 'На согласовании', type: 'badge', badgeColor: 'info' },
      { label: 'РП', value: 'Андросов Н.А.', type: 'link' },
      { label: 'Телефон', value: '+7 (495) 123-45-67', type: 'phone' },
      { label: 'Готовность', value: 65, type: 'progress' },
    ] }));

    // ═══ FOOTER ═══
    page.appendChild(gap(24));
    const ft = el('div', { textAlign: 'center', padding: '24px 20px 40px', borderTop: '1px solid ' + t.border });
    ft.appendChild(el('div', { ...DS.font('xs'), color: t.textTer }, 'ASGARD CRM • Mobile v3.0 • Session 1'));
    ft.appendChild(el('div', { ...DS.font('xs'), color: t.textTer, marginTop: '4px' }, '40 компонентов • 27 виджетов • Dark/Light'));
    page.appendChild(ft);

    return page;
  },
};

// ═══ BURGER MENU ═══
function openBurger() {
  M.BurgerMenu({
    user: { name: 'Андросов Никита', role: 'Руководитель проекта' },
    groups: [
      { title: 'ГЛАВНАЯ', items: [{ icon: '🏠', label: 'Зал Ярла' }, { icon: '📊', label: 'Дашборд' }, { icon: '📅', label: 'Календарь' }, { icon: '🎂', label: 'Дни рождения' }, { icon: '✅', label: 'Мои задачи', badge: '4' }] },
      { title: 'ТЕНДЕРЫ', items: [{ icon: '📋', label: 'Заявки', badge: '12' }, { icon: '📈', label: 'Воронка' }, { icon: '🏆', label: 'Тендеры' }, { icon: '🏢', label: 'Контрагенты' }] },
      { title: 'РАБОТЫ', items: [{ icon: '🧮', label: 'Просчёты' }, { icon: '📱', label: 'Калькулятор' }, { icon: '✍️', label: 'Согласования', badge: '3' }, { icon: '💎', label: 'Премии' }, { icon: '🔧', label: 'Мои работы' }, { icon: '🏗', label: 'Все работы' }, { icon: '📊', label: 'Канбан' }] },
      { title: 'ФИНАНСЫ', items: [{ icon: '💰', label: 'Финансы' }, { icon: '📄', label: 'Счета' }, { icon: '📑', label: 'Акты' }, { icon: '🏦', label: 'Касса' }, { icon: '📊', label: 'Очередь оплаты' }, { icon: '📋', label: 'Ведомости' }, { icon: '👤', label: 'Самозанятые' }] },
      { title: 'РЕСУРСЫ', items: [{ icon: '📝', label: 'ТКП' }, { icon: '🪪', label: 'Пропуски' }, { icon: '📦', label: 'Склад' }, { icon: '🛠', label: 'Оборудование' }, { icon: '📑', label: 'Договоры' }, { icon: '🔏', label: 'Печати' }] },
      { title: 'ПЕРСОНАЛ', items: [{ icon: '⚔️', label: 'Дружина' }, { icon: '📋', label: 'Заявки HR' }, { icon: '🛡', label: 'Допуски' }, { icon: '📅', label: 'Графики' }, { icon: '⭐', label: 'Рейтинг' }] },
      { title: 'КОММУНИКАЦИИ', items: [{ icon: '💬', label: 'Хугинн', badge: '7' }, { icon: '📹', label: 'Совещания' }, { icon: '🔔', label: 'Уведомления', badge: '15' }, { icon: '✈️', label: 'Telegram' }, { icon: '📧', label: 'Почта' }] },
      { title: 'АНАЛИТИКА', items: [{ icon: '📊', label: 'Аналитика' }, { icon: '📈', label: 'KPI ТО' }, { icon: '📈', label: 'KPI РП' }, { icon: '🗺', label: 'Карта' }] },
      { title: 'СИСТЕМА', items: [{ icon: '⚙️', label: 'Настройки' }, { icon: '💾', label: 'Бэкап' }, { icon: '🔄', label: 'Синхронизация' }, { icon: '🔍', label: 'Диагностика' }] },
    ],
    onNavigate: (h) => M.Toast({ message: h || 'Навигация', type: 'info' }),
  });
}

// ═══ FILTER SHEET ═══
function openFilterSheet() {
  const t = DS.t;
  const c = document.createElement('div');
  c.appendChild(M.SearchBar({ placeholder: 'Поиск...' }));
  const st = document.createElement('div'); Object.assign(st.style, { ...DS.font('sm'), color: t.textSec, marginBottom: '8px', marginTop: '12px' }); st.textContent = 'Статус'; c.appendChild(st);
  c.appendChild(M.FilterPills({ items: [{ label: 'Все', value: 'all', active: true }, { label: 'Новые', value: 'new' }, { label: 'В работе', value: 'wip' }, { label: 'Подано', value: 'sub' }, { label: 'Выиграно', value: 'won' }] }));
  const dt = document.createElement('div'); Object.assign(dt.style, { ...DS.font('sm'), color: t.textSec, marginBottom: '8px', marginTop: '16px' }); dt.textContent = 'Период'; c.appendChild(dt);
  const dr = document.createElement('div'); dr.style.display = 'flex'; dr.style.gap = '10px';
  dr.appendChild(M.DatePicker({ label: 'От', value: '2026-01-01' })); dr.appendChild(M.DatePicker({ label: 'До', value: '2026-03-31' })); c.appendChild(dr);
  const bt = document.createElement('div'); bt.style.display = 'flex'; bt.style.gap = '10px'; bt.style.marginTop = '20px';
  bt.appendChild(M.FullWidthBtn({ label: 'Сбросить', variant: 'secondary' })); bt.appendChild(M.FullWidthBtn({ label: 'Применить', onClick: () => M.Toast({ message: 'Применено', type: 'success' }) }));
  c.appendChild(bt);
  M.BottomSheet({ title: 'Фильтры', content: c });
}

if (typeof Router !== 'undefined') Router.register('/test', TestPage);
if (typeof window !== 'undefined') window.TestPage = TestPage;
