/**
 * ASGARD CRM — Mobile v3 Test Showcase
 * Витрина ВСЕХ компонентов + навигация + виджеты дашборда
 * Сессия 1 — 14.03.2026
 */
const TestPage = {
  render() {
    const t = DS.t;
    const page = document.createElement('div');
    page.className = 'asgard-test-page';
    Object.assign(page.style, { background: t.bg, paddingBottom: '120px' });

    // Shorthand: el(tag, styleObj, children) → wraps Utils.el
    const el = (tag, s, ch) => {
      const attrs = (s && typeof s === 'object' && !Array.isArray(s) && !(s instanceof HTMLElement)) ? { style: s } : {};
      return Utils.el(tag, attrs, ch != null ? ch : []);
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
      { icon: '<span id="asgard-theme-slot" style="display:flex"></span>', onClick: () => {} },
      { icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>', onClick: () => DS.toggleTheme() },
    ]}));
    setTimeout(() => { const s = document.getElementById('asgard-theme-slot'); if (s) s.appendChild(themeToggle); }, 0);

    // ═══ HERO ═══
    page.appendChild(el('div', { padding: '12px 20px' }, M.HeroCard({ label: 'ASGARD CRM • MOBILE V3', value: '40', valueSuffix: ' компонентов', details: [{ label: 'Блоков', value: '22' }, { label: 'Auth', value: '5 экранов' }, { label: 'Стандарт', value: 'Сбер/Альфа', color: '#34C759' }] })));

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
      { title: 'Согласовано', text: 'Кудряшов О.С.', time: '15:10', badge: 'Ок', badgeColor: 'success', color: 'var(--green)' },
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
    const bw = el('div', { display: 'flex', gap: '12px', padding: '0 20px', overflowX: 'auto' }); bw.className = 'asgard-no-scrollbar';
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

    // ═══ BLOCK 18: AUTH SCREENS ═══
    page.appendChild(sec('Экраны входа', 'Welcome, Login, PIN, Quick PIN, Register'));

    // 18.1 Welcome screen (mini)
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, '18.1 Welcome (приветствие)')));
    const welc = el('div', { background: 'var(--hero-grad)', borderRadius: '20px', padding: '32px 20px', textAlign: 'center', position: 'relative', overflow: 'hidden', margin: '0 20px' });
    // Floating runes
    const runeStr = 'ᚨᚱᚦᚹᛏᛒᛗᚠᚢᚲ';
    for (let i = 0; i < 8; i++) { const rn = el('span', { position: 'absolute', left: (Math.random()*80+10)+'%', top: (Math.random()*80+10)+'%', fontSize: (14+Math.random()*20)+'px', color: 'rgba(255,255,255,0.08)', fontWeight: 700 }, runeStr[i%runeStr.length]); welc.appendChild(rn); }
    // Shield
    const shieldSvg = el('div', { marginBottom: '12px' });
    shieldSvg.innerHTML = '<svg viewBox="0 0 60 72" width="60" height="72" fill="none"><path d="M30 3L57 15V42Q57 59 30 69Q3 59 3 42V15Z" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" fill="rgba(255,255,255,0.06)"/><text x="30" y="46" text-anchor="middle" fill="white" font-size="28" font-weight="800" font-family="system-ui">ᚨ</text></svg>';
    welc.appendChild(shieldSvg);
    welc.appendChild(el('div', { ...DS.font('hero'), color: '#fff', letterSpacing: '6px', marginBottom: '4px' }, 'ASGARD'));
    welc.appendChild(el('div', { ...DS.font('xs'), color: 'rgba(255,255,255,0.5)', letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '24px' }, 'Система управления'));
    const welcBtns = el('div', { display: 'flex', flexDirection: 'column', gap: '10px' });
    const mkWBtn = (label, primary) => { const b = el('button', { width: '100%', padding: '14px', borderRadius: '18px', border: primary ? '1px solid rgba(255,255,255,0.25)' : '1px solid rgba(255,255,255,0.12)', background: primary ? 'rgba(255,255,255,0.18)' : 'transparent', color: primary ? '#fff' : 'rgba(255,255,255,0.6)', fontSize: '15px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }, label); return b; };
    welcBtns.appendChild(mkWBtn('Войти', true));
    welcBtns.appendChild(mkWBtn('Оставить заявку', false));
    welcBtns.appendChild(mkWBtn('О системе', false));
    welc.appendChild(welcBtns);
    page.appendChild(welc);
    page.appendChild(gap());

    // 18.2 Login form
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, '18.2 Login (логин + пароль)')));
    const loginDemo = el('div', { background: 'var(--hero-grad)', borderRadius: '20px', padding: '24px 18px', margin: '0 20px', position: 'relative' });
    loginDemo.appendChild(el('div', { ...DS.font('xl'), color: '#fff', marginBottom: '4px' }, 'Вход в систему'));
    loginDemo.appendChild(el('div', { ...DS.font('sm'), color: 'rgba(255,255,255,0.65)', marginBottom: '18px' }, 'Введите данные аккаунта'));
    const loginForm = el('div', { background: 'rgba(255,255,255,0.92)', borderRadius: '20px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' });
    // Login input
    const mkInput = (lbl, type) => { const w = el('div', { position: 'relative' }); const inp = el('input', { width: '100%', padding: '20px 16px 8px', borderRadius: '12px', border: '1px solid rgba(0,0,0,0.1)', background: '#f7f7fa', fontSize: '14px', color: '#1A1A1F', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }); inp.type = type || 'text'; inp.placeholder = ' '; inp.className = 'auth-demo-input'; inp.setAttribute('autocomplete', 'off'); const lb = el('label', { position: 'absolute', left: '16px', top: '6px', fontSize: '10px', fontWeight: 500, color: '#6E6E78', pointerEvents: 'none' }, lbl); w.appendChild(inp); w.appendChild(lb); return w; };
    loginForm.appendChild(mkInput('Логин или email', 'text'));
    loginForm.appendChild(mkInput('Пароль', 'password'));
    const loginBtn = el('button', { width: '100%', padding: '14px', borderRadius: '14px', border: 'none', background: 'var(--hero-grad)', color: '#fff', fontSize: '16px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }, 'Войти');
    loginForm.appendChild(loginBtn);
    loginForm.appendChild(el('div', { textAlign: 'center', ...DS.font('sm'), color: '#6E6E78' }, 'Забыли пароль?'));
    loginDemo.appendChild(loginForm);
    page.appendChild(loginDemo);
    page.appendChild(gap());

    // 18.3 PIN screen
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, '18.3 PIN-код (быстрый вход)')));
    const pinDemo = el('div', { background: 'var(--hero-grad)', borderRadius: '20px', padding: '28px 20px', textAlign: 'center', margin: '0 20px' });
    // Avatar
    const pinAv = el('div', { width: '64px', height: '64px', borderRadius: '50%', background: 'linear-gradient(135deg, #4A90D9, #E53935)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: '22px', fontWeight: 700, color: '#fff', boxShadow: '0 4px 20px rgba(74,144,217,0.3)' }, 'НА');
    pinDemo.appendChild(pinAv);
    pinDemo.appendChild(el('div', { ...DS.font('lg'), color: '#fff', marginBottom: '4px' }, 'Андросов Никита'));
    pinDemo.appendChild(el('div', { ...DS.font('sm'), color: 'rgba(255,255,255,0.5)', marginBottom: '28px' }, 'Введите PIN-код'));
    // Dots
    const pinDots = el('div', { display: 'flex', gap: '18px', justifyContent: 'center', marginBottom: '28px' });
    let pinVal = '';
    const dots = [];
    for (let i = 0; i < 4; i++) { const d = el('div', { width: '14px', height: '14px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.25)', background: 'transparent', transition: 'all 0.25s cubic-bezier(0.34,1.56,0.64,1)' }); dots.push(d); pinDots.appendChild(d); }
    pinDemo.appendChild(pinDots);
    // Numpad
    const numpad = el('div', { display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' });
    const pinDigit = (d) => { if (pinVal.length >= 4) return; pinVal += d; dots.forEach((dot, i) => { const on = i < pinVal.length; dot.style.background = on ? '#4A90D9' : 'transparent'; dot.style.borderColor = on ? '#4A90D9' : 'rgba(255,255,255,0.25)'; dot.style.transform = on ? 'scale(1.25)' : 'scale(1)'; }); if (pinVal.length === 4) setTimeout(() => { M.Toast({ message: 'PIN введён: ' + pinVal, type: 'success' }); pinVal = ''; dots.forEach(d => { d.style.background = 'transparent'; d.style.borderColor = 'rgba(255,255,255,0.25)'; d.style.transform = 'scale(1)'; }); }, 300); };
    const pinDel = () => { if (!pinVal) return; pinVal = pinVal.slice(0,-1); dots.forEach((dot, i) => { const on = i < pinVal.length; dot.style.background = on ? '#4A90D9' : 'transparent'; dot.style.borderColor = on ? '#4A90D9' : 'rgba(255,255,255,0.25)'; dot.style.transform = on ? 'scale(1.25)' : 'scale(1)'; }); };
    [['1','2','3'],['4','5','6'],['7','8','9'],['🔐','0','⌫']].forEach(row => {
      const r = el('div', { display: 'flex', gap: '12px', justifyContent: 'center' });
      row.forEach(key => {
        const k = el('button', { width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 'none', fontFamily: 'inherit', fontSize: key === '⌫' || key === '🔐' ? '18px' : '20px', fontWeight: 600, transition: 'all 0.12s ease' });
        if (key === '🔐') { Object.assign(k.style, { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.14)' }); }
        else if (key === '⌫') { Object.assign(k.style, { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.14)' }); k.addEventListener('click', pinDel); }
        else { Object.assign(k.style, { background: 'rgba(255,255,255,0.16)', color: '#fff', border: '1px solid rgba(255,255,255,0.22)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }); k.addEventListener('click', () => pinDigit(key)); }
        k.textContent = key;
        r.appendChild(k);
      });
      numpad.appendChild(r);
    });
    pinDemo.appendChild(numpad);
    pinDemo.appendChild(el('div', { ...DS.font('sm'), color: 'rgba(74,144,217,0.9)', marginTop: '16px', cursor: 'pointer' }, 'Войти другим способом'));
    page.appendChild(pinDemo);
    page.appendChild(gap());

    // 18.4 Register (заявка на доступ)
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, '18.4 Register (заявка на доступ)')));
    const regDemo = el('div', { margin: '0 20px', borderRadius: '20px', overflow: 'hidden' });
    const regHero = el('div', { background: 'var(--hero-grad)', padding: '18px', color: '#fff', position: 'relative' });
    regHero.appendChild(el('div', { ...DS.font('label'), color: 'rgba(255,255,255,0.6)', marginBottom: '6px' }, 'ДОСТУП'));
    regHero.appendChild(el('div', { ...DS.font('lg'), color: '#fff', marginBottom: '4px' }, 'Запрос в ASGARD'));
    regHero.appendChild(el('div', { ...DS.font('sm'), color: 'rgba(255,255,255,0.65)' }, 'Оставьте данные, администратор свяжется'));
    regHero.appendChild(el('div', { position: 'absolute', right: '16px', top: '14px', fontSize: '44px', fontWeight: 800, color: 'rgba(255,255,255,0.12)' }, 'ᚨ'));
    regDemo.appendChild(regHero);
    const regForm = el('div', { padding: '16px', background: t.surface, border: '1px solid ' + t.border, display: 'flex', flexDirection: 'column', gap: '12px' });
    regForm.appendChild(el('div', { ...DS.font('md'), color: t.text }, 'Новая заявка'));
    ['Имя и фамилия', 'Телефон', 'Email', 'Компания'].forEach(lbl => { const inp = el('input', { width: '100%', padding: '14px 16px', borderRadius: '14px', border: '1px solid ' + t.border, background: t.inputBg, color: t.text, fontSize: '14px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }); inp.placeholder = lbl; regForm.appendChild(inp); });
    const roleRow = el('div', { display: 'flex', flexWrap: 'wrap', gap: '6px' });
    ['Тендеры', 'РП', 'HR', 'Бухгалтерия', 'Склад'].forEach((r, i) => { const b = el('button', { padding: '8px 12px', borderRadius: '20px', border: '1px solid ' + (i === 0 ? t.blueBorder : t.border), background: i === 0 ? t.blueBg : t.surfaceAlt, color: i === 0 ? t.blue : t.textSec, fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }, r); roleRow.appendChild(b); });
    regForm.appendChild(roleRow);
    regForm.appendChild(el('button', { width: '100%', padding: '14px', borderRadius: '14px', border: 'none', background: 'var(--hero-grad)', color: '#fff', fontSize: '15px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }, 'Отправить заявку'));
    regDemo.appendChild(regForm);
    page.appendChild(regDemo);

    // ═══ BLOCK 19: ACCOUNTING MODALS ═══
    page.appendChild(sec('Модалки бухгалтерии', 'Выбор ПП/Наличные, подтверждение, отчёт, возврат'));

    const accBtns = el('div', { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 20px' });

    // 19.1 Payment type modal
    accBtns.appendChild(M.FullWidthBtn({ label: '💳 Модалка оплаты (ПП / Наличные)', variant: 'secondary', onClick: () => {
      const cnt = document.createElement('div');
      const mkPayCard = (icon, title, desc, onClick) => { const c = el('div', { padding: '16px', borderRadius: '16px', border: '1px solid ' + t.border, background: t.surface, cursor: 'pointer', display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '10px', transition: 'transform 0.15s ease' }); c.addEventListener('touchstart', () => c.style.transform = 'scale(0.98)', { passive: true }); c.addEventListener('touchend', () => c.style.transform = '', { passive: true }); c.addEventListener('click', onClick); c.appendChild(el('div', { fontSize: '32px' }, icon)); const txt = el('div', { flex: 1 }); txt.appendChild(el('div', { ...DS.font('md'), color: t.text }, title)); txt.appendChild(el('div', { ...DS.font('sm'), color: t.textSec }, desc)); c.appendChild(txt); return c; };
      cnt.appendChild(mkPayCard('🏦', 'Платёжное поручение', 'Безналичная оплата по счёту', () => M.Toast({ message: 'Оплата ПП', type: 'success' })));
      cnt.appendChild(mkPayCard('💵', 'Наличные из кассы', 'Баланс: 2 450 000 ₽', () => M.Toast({ message: 'Выдача наличных', type: 'info' })));
      cnt.appendChild(el('div', { padding: '12px', borderRadius: '12px', background: t.surfaceAlt, textAlign: 'center', ...DS.font('sm'), color: t.textSec }, '💰 Сумма к оплате: 85 000 ₽'));
      M.BottomSheet({ title: 'Способ оплаты', content: cnt });
    }}));

    // 19.2 Cash confirmation
    accBtns.appendChild(M.FullWidthBtn({ label: '💵 Подтверждение получения наличных', variant: 'secondary', onClick: async () => {
      const ok = await M.Confirm({ title: '💵 Получение наличных', message: 'Петров И.С. подтверждает получение 85 000 ₽ из кассы?\n\nНажмите «Получено» для подтверждения.', okText: 'Получено ✓', cancelText: 'Отмена', danger: false });
      M.Toast({ message: ok ? 'Наличные выданы' : 'Отменено', type: ok ? 'success' : 'info' });
    }}));

    // 19.3 Expense report
    accBtns.appendChild(M.FullWidthBtn({ label: '📎 Отчёт о расходах', variant: 'secondary', onClick: () => {
      const cnt = document.createElement('div');
      cnt.appendChild(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '12px' }, 'Прикрепите документы и опишите расходы'));
      const fileZone = el('div', { padding: '28px', borderRadius: '16px', border: '2px dashed ' + t.border, textAlign: 'center', cursor: 'pointer', marginBottom: '14px' });
      fileZone.appendChild(el('div', { fontSize: '32px', marginBottom: '8px' }, '📎'));
      fileZone.appendChild(el('div', { ...DS.font('sm'), color: t.textSec }, 'Нажмите для загрузки чека'));
      fileZone.appendChild(el('div', { ...DS.font('xs'), color: t.textTer, marginTop: '4px' }, 'JPG, PNG, PDF до 10 МБ'));
      fileZone.addEventListener('click', () => M.Toast({ message: 'Выбор файла', type: 'info' }));
      cnt.appendChild(fileZone);
      const ta = el('textarea', { width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid ' + t.border, background: t.inputBg, color: t.text, fontSize: '14px', fontFamily: 'inherit', resize: 'vertical', minHeight: '80px', outline: 'none', boxSizing: 'border-box' }); ta.placeholder = 'Комментарий к расходам...';
      cnt.appendChild(ta);
      const sb = el('div', { display: 'flex', gap: '10px', marginTop: '14px' });
      sb.appendChild(M.FullWidthBtn({ label: 'Отправить отчёт', onClick: () => M.Toast({ message: 'Отчёт отправлен', type: 'success' }) }));
      cnt.appendChild(sb);
      M.BottomSheet({ title: 'Отчёт о расходах', content: cnt, fullscreen: true });
    }}));

    // 19.4 Return modal
    accBtns.appendChild(M.FullWidthBtn({ label: '↩ Возврат средств', variant: 'secondary', onClick: () => {
      const cnt = document.createElement('div');
      cnt.appendChild(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '14px' }, 'Введите сумму возврата неиспользованных средств'));
      const inp = el('input', { width: '100%', padding: '18px 16px', borderRadius: '14px', border: '1px solid ' + t.border, background: t.inputBg, color: t.text, fontSize: '24px', fontWeight: 700, textAlign: 'center', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }); inp.type = 'number'; inp.placeholder = '0 ₽';
      cnt.appendChild(inp);
      cnt.appendChild(el('div', { ...DS.font('xs'), color: t.textTer, textAlign: 'center', marginTop: '8px' }, 'На руках: 85 000 ₽ • Потрачено: 72 400 ₽'));
      cnt.appendChild(el('div', { marginTop: '16px' }));
      cnt.lastChild.appendChild(M.FullWidthBtn({ label: 'Вернуть в кассу', onClick: () => M.Toast({ message: 'Возврат оформлен', type: 'success' }) }));
      M.BottomSheet({ title: '↩ Возврат в кассу', content: cnt });
    }}));
    page.appendChild(accBtns);

    // ═══ BLOCK 20: MISSING FORM INPUTS ═══
    page.appendChild(sec('Формы (дополнительные)', 'Checkbox, Radio, File upload'));

    const formExtra = el('div', { display: 'flex', flexDirection: 'column', gap: '14px', padding: '0 20px' });

    // Checkboxes
    formExtra.appendChild(el('div', { ...DS.font('sm'), color: t.textSec }, 'Checkbox'));
    ['Химическая очистка', 'Гидродинамическая очистка', 'Пескоструйная обработка'].forEach((lbl, i) => {
      const row = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', cursor: 'pointer' });
      let checked = i === 0;
      const box = el('div', { width: '22px', height: '22px', borderRadius: '6px', border: checked ? 'none' : '2px solid ' + t.border, background: checked ? t.blue : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '13px', fontWeight: 700, transition: 'all 0.2s ease', flexShrink: 0 }, checked ? '✓' : '');
      row.appendChild(box);
      row.appendChild(el('div', { ...DS.font('base'), color: t.text }, lbl));
      row.addEventListener('click', () => { checked = !checked; box.style.background = checked ? t.blue : 'transparent'; box.style.border = checked ? 'none' : '2px solid ' + t.border; box.textContent = checked ? '✓' : ''; });
      formExtra.appendChild(row);
    });

    // Radio
    formExtra.appendChild(el('div', { ...DS.font('sm'), color: t.textSec, marginTop: '8px' }, 'Radio'));
    let selectedRadio = 0;
    const radios = [];
    ['До 1 млн ₽', '1–5 млн ₽', 'Более 5 млн ₽'].forEach((lbl, i) => {
      const row = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', cursor: 'pointer' });
      const circle = el('div', { width: '22px', height: '22px', borderRadius: '50%', border: '2px solid ' + (i === selectedRadio ? t.blue : t.border), display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease', flexShrink: 0 });
      const inner = el('div', { width: '10px', height: '10px', borderRadius: '50%', background: i === selectedRadio ? t.blue : 'transparent', transition: 'all 0.2s ease' });
      circle.appendChild(inner);
      row.appendChild(circle);
      row.appendChild(el('div', { ...DS.font('base'), color: t.text }, lbl));
      radios.push({ circle, inner });
      row.addEventListener('click', () => { selectedRadio = i; radios.forEach((r, j) => { r.circle.style.borderColor = j === i ? t.blue : t.border; r.inner.style.background = j === i ? t.blue : 'transparent'; }); });
      formExtra.appendChild(row);
    });

    // File upload
    formExtra.appendChild(el('div', { ...DS.font('sm'), color: t.textSec, marginTop: '8px' }, 'Загрузка файла'));
    const fileZone = el('div', { padding: '24px', borderRadius: '16px', border: '2px dashed ' + t.border, textAlign: 'center', cursor: 'pointer', background: t.surfaceAlt, transition: 'border-color 0.2s ease' });
    fileZone.appendChild(el('div', { fontSize: '28px', marginBottom: '8px' }, '📂'));
    fileZone.appendChild(el('div', { ...DS.font('sm'), color: t.textSec }, 'Нажмите или перетащите файл'));
    fileZone.appendChild(el('div', { ...DS.font('xs'), color: t.textTer, marginTop: '4px' }, 'PDF, DOC, XLS, JPG — до 25 МБ'));
    fileZone.addEventListener('click', () => M.Toast({ message: 'Выбор файла', type: 'info' }));
    formExtra.appendChild(fileZone);

    page.appendChild(formExtra);

    // ═══ BLOCK 21: MINI CALENDAR ═══
    page.appendChild(sec('Мини-календарь', 'Текущий месяц'));
    const calWrap = el('div', { padding: '16px', margin: '0 20px', borderRadius: '16px', background: t.surface, border: '1px solid ' + t.border });
    calWrap.appendChild(el('div', { ...DS.font('md'), color: t.text, textAlign: 'center', marginBottom: '12px' }, 'Март 2026'));
    const calGrid = document.createElement('div');
    calGrid.className = 'asgard-calendar-grid';
    ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(d => calGrid.appendChild(el('div', { ...DS.font('xs'), color: t.textTer, padding: '6px 0', fontWeight: 600 }, d)));
    const startDay = 6; // March 2026 starts on Sunday, offset=6
    for (let i = 0; i < startDay; i++) calGrid.appendChild(el('div'));
    for (let d = 1; d <= 31; d++) {
      const isToday = d === 14;
      const hasEvent = [14, 25, 28].includes(d);
      const cell = el('div', { padding: '6px 0', borderRadius: '10px', fontSize: '13px', fontWeight: isToday ? 700 : 400, color: isToday ? '#fff' : hasEvent ? t.blue : t.text, background: isToday ? t.red : 'transparent', cursor: 'pointer', position: 'relative', transition: 'background 0.15s ease', lineHeight: '1.6' }, '' + d);
      if (hasEvent && !isToday) { const dot = el('div', { width: '4px', height: '4px', borderRadius: '50%', background: t.blue, margin: '-2px auto 0', }); cell.appendChild(dot); }
      calGrid.appendChild(cell);
    }
    calWrap.appendChild(calGrid);
    page.appendChild(calWrap);

    // ═══ BLOCK 22: MISSING WIDGETS ═══
    page.appendChild(sec('Виджеты (остальные)', 'Сканер, телефония, почта, банк, площадки'));

    // Scanner
    const scanCard = el('div', { display: 'flex', gap: '14px', alignItems: 'center', padding: '14px 16px', background: t.surface, borderRadius: '16px', border: '1px solid ' + t.border, margin: '0 20px', cursor: 'pointer' });
    scanCard.appendChild(el('div', { width: '48px', height: '48px', borderRadius: '14px', background: t.redBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', flexShrink: 0 }, '📷'));
    const scanTxt = el('div', { flex: 1 }); scanTxt.appendChild(el('div', { ...DS.font('md'), color: t.text }, 'Сканер чеков')); scanTxt.appendChild(el('div', { ...DS.font('xs'), color: t.textSec }, 'Последний: 12 мар — 4 580 ₽'));
    scanCard.appendChild(scanTxt);
    scanCard.addEventListener('click', () => M.Toast({ message: 'Открыть камеру', type: 'info' }));
    page.appendChild(scanCard); page.appendChild(gap(8));

    // Telephony
    const telCard = el('div', { display: 'flex', gap: '14px', alignItems: 'center', padding: '14px 16px', background: t.surface, borderRadius: '16px', border: '1px solid ' + t.border, margin: '0 20px' });
    telCard.appendChild(el('div', { width: '48px', height: '48px', borderRadius: '14px', background: t.greenBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', flexShrink: 0 }, '📞'));
    const telTxt = el('div', { flex: 1 }); telTxt.appendChild(el('div', { ...DS.font('md'), color: t.text }, 'Телефония')); telTxt.appendChild(el('div', { ...DS.font('xs'), color: t.green, fontWeight: 600 }, '● Онлайн'));
    telCard.appendChild(telTxt);
    page.appendChild(telCard); page.appendChild(gap(8));

    // My mail
    const mailWrap = el('div', { display: 'flex', flexDirection: 'column', gap: '0', margin: '0 20px', borderRadius: '16px', border: '1px solid ' + t.border, overflow: 'hidden', background: t.surface });
    [{ from: 'tender@yanpz.ru', subj: 'Итоги конкурса №11-178', time: '12:30', unread: true },
     { from: 'Рустам (Новойл)', subj: 'Встреча по проекту очистки', time: '10:15', unread: true },
     { from: 'buh@asgard.ru', subj: 'Акт сверки за февраль', time: 'Вчера', unread: false }
    ].forEach((m, i) => {
      const row = el('div', { display: 'flex', gap: '10px', padding: '12px 14px', borderBottom: i < 2 ? '1px solid ' + t.border : 'none', alignItems: 'center' });
      row.appendChild(el('div', { width: '8px', height: '8px', borderRadius: '50%', background: m.unread ? t.blue : 'transparent', flexShrink: 0 }));
      const body = el('div', { flex: 1, minWidth: 0 });
      body.appendChild(el('div', { ...DS.font('sm'), fontWeight: m.unread ? 600 : 400, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, m.from));
      body.appendChild(el('div', { ...DS.font('sm'), color: t.textSec, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, m.subj));
      row.appendChild(body);
      row.appendChild(el('div', { ...DS.font('xs'), color: t.textTer, flexShrink: 0 }, m.time));
      mailWrap.appendChild(row);
    });
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, 'Моя почта')));
    page.appendChild(mailWrap); page.appendChild(gap(8));

    // Bank balance
    const bankCard = el('div', { padding: '16px', margin: '0 20px', borderRadius: '16px', background: t.surface, border: '1px solid ' + t.border });
    bankCard.appendChild(M.BigNumber({ value: 12850000, suffix: ' ₽', label: 'Расчётный счёт ООО «Асгард Сервис»', icon: '🏦' }));
    page.appendChild(bankCard); page.appendChild(gap(8));

    // Tender platforms
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, 'Тендерные площадки')));
    const tpWrap = el('div', { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 20px' });
    [{ pl: 'Закупки.гов', title: 'Хим. очистка котлов — Салаватнефтеоргсинтез', sum: '8.2 млн', days: 5 },
     { pl: 'B2B-Center', title: 'Гидропромывка АВО — Сургутнефтегаз', sum: '12.5 млн', days: 3 }
    ].forEach(tp => {
      tpWrap.appendChild(M.Card({ title: tp.title, subtitle: tp.pl, badge: tp.days + ' дн', badgeColor: tp.days <= 3 ? 'danger' : 'warning', fields: [{ label: 'НМЦК', value: tp.sum }] }));
    });
    page.appendChild(tpWrap);

    // ═══ BLOCK 23: MISSING DASHBOARD WIDGETS ═══
    page.appendChild(sec('Виджеты (продолжение)', 'Уведомления, работы, согласования, допуски, KPI, подотчётные, оборудование, ведомости, заявки AI, ТМЦ'));

    // 23.1 Notifications list
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, '🔔 Уведомления (виджет)')));
    const notifW = el('div', { display: 'flex', flexDirection: 'column', gap: '6px', padding: '0 20px' });
    notifW.appendChild(M.NotificationCard({ title: 'Новое согласование', text: 'Просчёт ЯНПЗ ожидает решения', time: '5м', type: 'task' }));
    notifW.appendChild(M.NotificationCard({ title: 'Аванс одобрен: 85 000 ₽', text: 'Командировка Уфа — Петров И.С.', time: '20м', type: 'money' }));
    notifW.appendChild(M.NotificationCard({ title: 'Дедлайн завтра', text: 'ТОАЗ — сдать акт выполненных работ', time: '1ч', type: 'warning', read: true }));
    page.appendChild(notifW); page.appendChild(gap(8));

    // 23.2 My works
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, '🔧 Мои работы')));
    const myWorksW = el('div', { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 20px' });
    [{ title: 'Архбум — Цилиндр ПГ-М 1100', badge: 'В работе', bc: 'info', pct: 65 },
     { title: 'НОВАТЭК — Промывка АВО', badge: 'Подготовка', bc: 'warning', pct: 20 },
     { title: 'МНПЗ — Котлы КТД 65/32300', badge: 'Завершено', bc: 'success', pct: 100 }
    ].forEach(w => {
      const c = M.Card({ title: w.title, badge: w.badge, badgeColor: w.bc, fields: [] });
      const p = el('div', { padding: '8px 0 0' }); p.appendChild(M.ProgressBar({ value: w.pct, label: w.pct + '%' })); c.appendChild(p);
      myWorksW.appendChild(c);
    });
    page.appendChild(myWorksW); page.appendChild(gap(8));

    // 23.3 Approvals waiting
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, '✍️ Согласования (ожидающие)')));
    const apprW = el('div', { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 20px' });
    [{ title: 'Просчёт: ЯНПЗ — ПТО', from: 'Андросов → Директор', sum: '4.23 млн' },
     { title: 'Аванс: командировка Кемерово', from: 'Козлов → Директор', sum: '120 000 ₽' },
     { title: 'Ведомость: бригада №5 март', from: 'Петров → Бухгалтерия', sum: '890 000 ₽' }
    ].forEach(a => {
      const c = M.Card({ title: a.title, subtitle: a.from, badge: 'Ожидает', badgeColor: 'warning', fields: [{ label: 'Сумма', value: a.sum }] });
      apprW.appendChild(c);
    });
    page.appendChild(apprW); page.appendChild(gap(8));

    // 23.4 Expiring permits
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, '🛡 Истекающие допуски')));
    const permW = el('div', { display: 'flex', flexDirection: 'column', gap: '6px', padding: '0 20px' });
    [{ name: 'Иванов П.А.', permit: 'Промбезопасность А', days: 5, color: t.red },
     { name: 'Козлов Д.М.', permit: 'Высотные работы', days: 12, color: t.orange },
     { name: 'Сидоров А.В.', permit: 'Сварка НАКС', days: 18, color: t.gold }
    ].forEach(p => {
      const row = el('div', { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: t.surface, borderRadius: '12px', border: '1px solid ' + t.border });
      row.appendChild(el('div', { width: '8px', height: '8px', borderRadius: '50%', background: p.color, flexShrink: 0 }));
      const info = el('div', { flex: 1, minWidth: 0 });
      info.appendChild(el('div', { ...DS.font('sm'), fontWeight: 600, color: t.text }, p.name));
      info.appendChild(el('div', { ...DS.font('xs'), color: t.textSec }, p.permit));
      row.appendChild(info);
      row.appendChild(M.Badge({ text: p.days + ' дн', color: p.days <= 7 ? 'danger' : p.days <= 14 ? 'warning' : 'gold' }));
      permW.appendChild(row);
    });
    page.appendChild(permW); page.appendChild(gap(8));

    // 23.5 KPI summary
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, '📈 KPI сводка')));
    page.appendChild(M.Stats({ items: [
      { icon: '🎯', value: 47, label: 'Тендеров подано', color: t.blue },
      { icon: '🏗', value: 23, label: 'Работ завершено', color: t.green },
      { icon: '💹', value: '42%', label: 'Средняя маржа', color: t.gold },
      { icon: '⏱', value: '3.2', label: 'Дней на просчёт', color: t.orange },
    ] }));
    page.appendChild(gap(8));

    // 23.6 My accountable funds
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, '💼 Мои подотчётные')));
    const accFunds = el('div', { padding: '16px', margin: '0 20px', borderRadius: '16px', background: t.surface, border: '1px solid ' + t.border });
    const accGrid = el('div', { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', textAlign: 'center' });
    [{ val: '85 000', lbl: 'На руках', cl: t.blue }, { val: '72 400', lbl: 'Потрачено', cl: t.orange }, { val: '2', lbl: 'Активных', cl: t.green }].forEach(a => {
      const cell = el('div');
      cell.appendChild(el('div', { ...DS.font('md'), color: a.cl, fontWeight: 700 }, a.val));
      cell.appendChild(el('div', { ...DS.font('xs'), color: t.textSec, marginTop: '2px' }, a.lbl));
      accGrid.appendChild(cell);
    });
    accFunds.appendChild(accGrid);
    page.appendChild(accFunds); page.appendChild(gap(8));

    // 23.7 Equipment alerts
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, '🛠 Оборудование • Алерты')));
    const eqW = el('div', { display: 'flex', flexDirection: 'column', gap: '6px', padding: '0 20px' });
    [{ eq: 'WOMA 150/120', alert: 'ТО через 48 моточасов', color: t.orange },
     { eq: 'Установка ГНП-40', alert: 'Замена фильтра просрочена', color: t.red },
     { eq: 'Компрессор Atlas Copco', alert: 'Сертификат истекает 20.03', color: t.gold }
    ].forEach(e => {
      const row = el('div', { display: 'flex', gap: '10px', padding: '10px 14px', background: t.surface, borderRadius: '12px', border: '1px solid ' + t.border, alignItems: 'center' });
      row.appendChild(el('div', { fontSize: '18px', flexShrink: 0 }, '⚠️'));
      const info = el('div', { flex: 1 });
      info.appendChild(el('div', { ...DS.font('sm'), fontWeight: 600, color: t.text }, e.eq));
      info.appendChild(el('div', { ...DS.font('xs'), color: e.color }, e.alert));
      row.appendChild(info);
      eqW.appendChild(row);
    });
    page.appendChild(eqW); page.appendChild(gap(8));

    // 23.8 Payroll waiting
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, '📋 Ведомости (ожидание)')));
    const payrollCard = el('div', { display: 'flex', gap: '14px', alignItems: 'center', padding: '16px', margin: '0 20px', borderRadius: '16px', background: t.surface, border: '1px solid ' + t.border });
    payrollCard.appendChild(el('div', { ...DS.font('hero'), color: t.orange }, '3'));
    const payInfo = el('div', { flex: 1 });
    payInfo.appendChild(el('div', { ...DS.font('md'), color: t.text }, 'Ведомости на согласовании'));
    payInfo.appendChild(el('div', { ...DS.font('sm'), color: t.textSec }, 'Общая сумма: 2 340 000 ₽'));
    payrollCard.appendChild(payInfo);
    page.appendChild(payrollCard); page.appendChild(gap(8));

    // 23.9 Pre-tender requests with AI color
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, '🤖 Заявки (AI-оценка)')));
    const aiReqW = el('div', { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 20px' });
    [{ title: 'Газпромнефть — очистка резервуаров', ai: 'Высокий шанс', aiColor: 'success', sum: '15 млн' },
     { title: 'Лукойл-НВН — гидропромывка', ai: 'Средний шанс', aiColor: 'warning', sum: '8 млн' },
     { title: 'ТНК — пескоструй трубопроводов', ai: 'Низкий шанс', aiColor: 'danger', sum: '3 млн' }
    ].forEach(r => {
      aiReqW.appendChild(M.Card({ title: r.title, badge: r.ai, badgeColor: r.aiColor, fields: [{ label: 'НМЦК', value: r.sum }] }));
    });
    page.appendChild(aiReqW); page.appendChild(gap(8));

    // 23.10 TMC balance
    page.appendChild(pad(el('div', { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, '📦 Стоимость ТМЦ')));
    const tmcCard = el('div', { padding: '16px', margin: '0 20px', borderRadius: '16px', background: t.surface, border: '1px solid ' + t.border });
    tmcCard.appendChild(M.BigNumber({ value: 8750000, suffix: ' ₽', label: 'ТМЦ на балансе компании', icon: '📦' }));
    const tmcRow = el('div', { display: 'flex', gap: '10px', marginTop: '10px' });
    tmcRow.appendChild(M.Badge({ text: 'Реагенты: 4.2 млн', color: 'info' }));
    tmcRow.appendChild(M.Badge({ text: 'Оборудование: 4.5 млн', color: 'gold' }));
    tmcCard.appendChild(tmcRow);
    page.appendChild(tmcCard);

    // ═══ FOOTER ═══
    page.appendChild(gap(24));
    const ft = el('div', { textAlign: 'center', padding: '24px 20px 40px', borderTop: '1px solid ' + t.border });
    ft.appendChild(el('div', { ...DS.font('xs'), color: t.textTer }, 'ASGARD CRM • Mobile v3.0'));
    ft.appendChild(el('div', { ...DS.font('xs'), color: t.textTer, marginTop: '4px' }, '40 компонентов • 23 блока • 27 виджетов • 4 auth-экрана • Dark/Light'));
    page.appendChild(ft);

    // Re-render on theme change (inline styles use DS.t values)
    const themeHandler = () => {
      const content = document.getElementById('asgard-content');
      if (!content) return;
      const pg = content.querySelector('.asgard-page');
      if (pg) {
        pg.innerHTML = '';
        const fresh = TestPage.render();
        while (fresh.firstChild) pg.appendChild(fresh.firstChild);
      }
    };
    window.addEventListener('asgard:theme', themeHandler, { once: true });

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
