/**
 * ASGARD CRM — Mobile v3: Визуальный аудит #/test2
 * Сессия 16.0 — собирает реальные элементы со ВСЕХ страниц
 * для проверки единообразия на iPhone
 *
 * НЕ создаёт новые компоненты, только ПОКАЗЫВАЕТ существующие
 */
(function () {
  'use strict';

  var el = Utils.el;
  var t; // будем обновлять при рендере

  /* ── Моковые данные ── */
  var MOCK = {
    user: { id: 1, name: 'Андросов Никита', display_name: 'Андросов Никита', role: 'ADMIN', role_name: 'Администратор', email: 'nick@asgard.ru', phone: '+7 999 111-22-33' },
    tender: { id: 101, customer_name: 'Газпромнефть-МНПЗ', name: 'Чистка котлов ЦТД 65', title: 'Чистка котлов ЦТД 65', status: 'В просчёте', amount: 4300000, price: 4300000, deadline: '2026-04-15', submission_deadline: '2026-04-15', manager_name: 'Иванов А.А.', rp: 'Иванов А.А.', created_at: '2026-03-10' },
    pre_tender: { id: 102, title: 'Заявка: чистка теплообменников', customer_name: 'ЛУКОЙЛ-Нижегороднефтеоргсинтез', status: 'new', approval_status: 'pending', created_at: '2026-03-12', deadline: '2026-04-20', amount: 2800000 },
    estimate: { id: 301, name: 'Чистка ПТ NT250', approval_status: 'sent', total_price: 4230000, price: 4230000, total_cost: 1760000, cost: 1760000, author_name: 'Андросов Н.А.', created_at: '2026-03-11', sent_for_approval_at: '2026-03-12' },
    work: { id: 201, customer_name: 'ЯНПЗ', title: 'Чистка котельной', work_title: 'Котельная инв.767', object_name: 'Котельная инв.767', work_status: 'В работе', total_sum: 3520000, pm_name: 'Петров М.В.', progress: 65, created_at: '2026-02-20' },
    cash_request: { id: 401, status: 'approved', purpose: 'Командировка ЯНПЗ', description: 'Командировка ЯНПЗ', amount: '150000', work_title: 'Котельная инв.767', created_at: '2026-03-08', comment: 'Авансовый запрос' },
    expense: { id: 501, description: 'Канцтовары офис', category: 'Канцелярия', amount: '12500', user_name: 'Секретарёва О.А.', created_at: '2026-03-10' },
    task: { id: 601, title: 'Подготовить КП для ЯНПЗ', text: 'Подготовить КП для ЯНПЗ', description: 'Включить все позиции по ТЗ', status: 'in_progress', priority: 'high', deadline: '2026-03-25', files_count: 2, created_at: '2026-03-05' },
    employee: { id: 701, fio: 'Сидоров Алексей Петрович', name: 'Сидоров Алексей Петрович', position: 'Слесарь-ремонтник 5 разряд', role_tag: 'PM', rating_avg: 4.2, city: 'Москва', phone: '+7 999 333-44-55', status: 'active', is_active: true },
    permit: { id: 801, permit_type: 'Удостоверение по ОТ', type_name: 'Удостоверение по ОТ', number: 'ОТ-2026-0045', valid_from: '2025-06-01', valid_to: '2026-12-31', employee_name: 'Сидоров А.П.' },
    chat: { id: 901, name: 'Группа: ЯНПЗ проект', title: 'Группа: ЯНПЗ проект', unread_count: 3, online: true, last_message: { text: 'Документы отправлены', created_at: '2026-03-15T10:30:00Z' } },
    mail: { id: 1001, from_name: 'Кудряшов О.С.', from: 'kudryashov@asgard.ru', subject: 'Согласование КП #301', preview: 'Прошу рассмотреть и согласовать коммерческое предложение...', text: 'Прошу рассмотреть и согласовать коммерческое предложение...', date: '2026-03-14T15:00:00Z', is_read: false },
    contract: { id: 1101, title: 'Договор подряда', number: 'ДП-2026/045', contractor_name: 'ООО «ЯНПЗ»', status: 'active', amount: 4230000, date: '2026-02-15', end_date: '2026-08-31' },
    notification: { id: 1201, title: 'Просчёт согласован', message: 'Директор согласовал просчёт #301', text: 'Директор согласовал просчёт #301', created_at: '2026-03-15T09:00:00Z', is_read: false, type: 'success' },
  };


  /* ══════════════════════════════════════════════
     СЕКЦИИ
     ══════════════════════════════════════════════ */

  /* ── Утилита: заголовок секции ── */
  function sectionTitle(text) {
    return el('div', {
      style: {
        padding: '20px 20px 8px',
        fontSize: '20px', fontWeight: 800, letterSpacing: '-0.3px',
        color: 'var(--text)',
        borderTop: '4px solid var(--red)',
        marginTop: '24px',
      },
      textContent: text,
    });
  }

  function subTitle(text) {
    return el('div', {
      style: {
        padding: '12px 20px 6px',
        fontSize: '13px', fontWeight: 700, letterSpacing: '0.5px',
        textTransform: 'uppercase',
        color: 'var(--text-ter)',
      },
      textContent: text,
    });
  }

  function cardWrap() {
    return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 var(--sp-page)' } });
  }


  /* ═══════════════════════════════════════
     СЕКЦИЯ 1: Карточки из разных окон
     ═══════════════════════════════════════ */
  function section1_Cards() {
    var frag = document.createDocumentFragment();
    frag.appendChild(sectionTitle('1. Карточки — сравнение окон'));

    // ── Окно 1: Тендеры ──
    frag.appendChild(subTitle('Окно 1: Тендеры'));
    var w1 = cardWrap();

    // Карточка тендера (как в tenders.js renderCard)
    w1.appendChild(M.Card({
      title: MOCK.tender.customer_name,
      subtitle: MOCK.tender.name,
      badge: 'В просчёте', badgeColor: 'info',
      fields: [
        { label: 'Сумма', value: Number(MOCK.tender.amount).toLocaleString('ru-RU') + ' ₽' },
        { label: 'РП', value: MOCK.tender.manager_name },
        { label: 'Дедлайн', value: Utils.formatDate(MOCK.tender.deadline) },
      ],
      time: Utils.formatDate(MOCK.tender.deadline),
      onClick: function () { M.Toast({ message: 'Тестовый клик: тендер', type: 'info' }); },
    }));

    // Карточка заявки (pre_tenders.js renderCard)
    w1.appendChild(M.Card({
      title: MOCK.pre_tender.customer_name,
      subtitle: MOCK.pre_tender.title,
      badge: 'Новая', badgeColor: 'neutral',
      fields: [
        { label: 'Сумма', value: Number(MOCK.pre_tender.amount).toLocaleString('ru-RU') + ' ₽' },
        { label: 'Дедлайн', value: Utils.formatDate(MOCK.pre_tender.deadline) },
      ],
      onClick: function () { M.Toast({ message: 'Тестовый клик: заявка', type: 'info' }); },
    }));

    // Карточка просчёта (pm_calcs.js renderCard)
    var price = Number(MOCK.estimate.total_price);
    var cost = Number(MOCK.estimate.total_cost);
    var marginPct = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;
    w1.appendChild(M.Card({
      title: 'Газпромнефть-МНПЗ',
      subtitle: MOCK.estimate.name,
      badge: 'На согласовании', badgeColor: 'info',
      fields: [
        { label: 'Цена', value: price.toLocaleString('ru-RU') + ' ₽' },
        { label: 'Себест.', value: cost.toLocaleString('ru-RU') + ' ₽' },
        { label: 'Маржа', value: marginPct + '%' },
      ],
      time: Utils.formatDate(MOCK.estimate.created_at),
      onClick: function () { M.Toast({ message: 'Тестовый клик: просчёт', type: 'info' }); },
    }));
    frag.appendChild(w1);


    // ── Окно 2: Работы + Финансы ──
    frag.appendChild(subTitle('Окно 2: Работы + Финансы'));
    var w2 = cardWrap();

    // Карточка работы (pm_works.js)
    w2.appendChild(M.Card({
      title: MOCK.work.customer_name,
      subtitle: MOCK.work.work_title,
      badge: MOCK.work.work_status, badgeColor: 'info',
      fields: [
        { label: 'Сумма', value: Number(MOCK.work.total_sum).toLocaleString('ru-RU') + ' ₽' },
        { label: 'РП', value: MOCK.work.pm_name },
        { label: 'Прогресс', value: MOCK.work.progress + '%' },
      ],
      onClick: function () { M.Toast({ message: 'Тестовый клик: работа', type: 'info' }); },
    }));

    // Карточка кассы (cash.js)
    w2.appendChild(M.Card({
      title: MOCK.cash_request.purpose,
      subtitle: MOCK.cash_request.work_title,
      badge: 'Одобрено', badgeColor: 'success',
      fields: [
        { label: 'Сумма', value: Utils.formatMoney(parseFloat(MOCK.cash_request.amount)) + ' ₽' },
        { label: 'Создано', value: Utils.formatDate(MOCK.cash_request.created_at) },
      ],
      onClick: function () { M.Toast({ message: 'Тестовый клик: касса', type: 'info' }); },
    }));

    // Карточка расхода (office_expenses.js)
    w2.appendChild(M.Card({
      title: MOCK.expense.description,
      subtitle: MOCK.expense.category,
      badge: Utils.formatMoney(parseFloat(MOCK.expense.amount)) + ' ₽', badgeColor: 'danger',
      fields: [
        { label: 'Дата', value: Utils.formatDate(MOCK.expense.created_at) },
        { label: 'Автор', value: MOCK.expense.user_name },
      ],
      onClick: function () { M.Toast({ message: 'Тестовый клик: расход', type: 'info' }); },
    }));
    frag.appendChild(w2);


    // ── Окно 3: Персонал + Задачи ──
    frag.appendChild(subTitle('Окно 3: Персонал + Задачи'));
    var w3 = cardWrap();

    // Карточка задачи (tasks.js — использует SwipeCard + Badge append)
    var taskCard = M.SwipeCard({
      title: MOCK.task.title,
      subtitle: MOCK.task.description ? MOCK.task.description.slice(0, 60) : undefined,
      rightActions: [
        { label: '✓', color: 'var(--green)', onClick: function () { M.Toast({ message: 'Выполнена!', type: 'success' }); } },
      ],
    });
    var taskInner = taskCard.querySelector('.asgard-swipe-inner') || taskCard.querySelector('div');
    if (taskInner) {
      var badgeWrap = el('div', { style: { display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' } });
      badgeWrap.appendChild(M.Badge({ text: 'В работе', color: 'info' }));
      badgeWrap.appendChild(M.Badge({ text: 'Высокий', color: 'danger' }));
      badgeWrap.appendChild(M.Badge({ text: '📎 2', color: 'neutral' }));
      taskInner.appendChild(badgeWrap);
    }
    w3.appendChild(taskCard);

    // Карточка сотрудника (personnel.js — кастомная, НЕ M.Card)
    var empCard = el('div', { style: {
      display: 'flex', gap: '14px', alignItems: 'center', padding: '14px 16px',
      background: 'var(--surface)', borderRadius: '18px', border: '1px solid var(--border)', cursor: 'pointer',
    } });
    empCard.appendChild(M.Avatar({ name: MOCK.employee.fio, size: 48, status: 'online' }));
    var empInfo = el('div', { style: { flex: '1', minWidth: '0' } });
    empInfo.appendChild(el('div', { style: Object.assign({}, DS.font('md'), { color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }) }, MOCK.employee.fio));
    empInfo.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: 'var(--text-sec)' }) }, MOCK.employee.position));
    var ratingRow = el('div', { style: { display: 'flex', gap: '2px', marginTop: '4px' } });
    for (var i = 0; i < 5; i++) ratingRow.appendChild(el('span', { style: { fontSize: '12px', color: i < Math.round(MOCK.employee.rating_avg) ? 'var(--gold)' : 'var(--text-ter)' } }, i < Math.round(MOCK.employee.rating_avg) ? '★' : '☆'));
    empInfo.appendChild(ratingRow);
    empCard.appendChild(empInfo);
    empCard.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', flexShrink: 0 }) }, MOCK.employee.city));
    w3.appendChild(empCard);

    // Карточка допуска (permits.js — использует M.Card)
    w3.appendChild(M.Card({
      title: MOCK.permit.permit_type,
      subtitle: MOCK.permit.employee_name,
      badge: 'Действует', badgeColor: 'success',
      fields: [
        { label: 'С', value: Utils.formatDate(MOCK.permit.valid_from) },
        { label: 'До', value: Utils.formatDate(MOCK.permit.valid_to) },
        { label: '№', value: MOCK.permit.number },
      ],
      onClick: function () { M.Toast({ message: 'Тестовый клик: допуск', type: 'info' }); },
    }));
    frag.appendChild(w3);


    // ── Окно 4: Коммуникации + Документы ──
    frag.appendChild(subTitle('Окно 4: Коммуникации + Документы'));
    var w4 = cardWrap();

    // Карточка чата (messenger.js — кастомная строка)
    var chatRow = el('div', {
      style: {
        display: 'flex', gap: '12px', alignItems: 'center',
        padding: '12px 16px', cursor: 'pointer', background: 'var(--surface)',
        borderRadius: '18px', border: '1px solid var(--border)',
      },
    });
    chatRow.appendChild(M.Avatar({ name: MOCK.chat.name, size: 48, status: 'online' }));
    var chatInfo = el('div', { style: { flex: 1, minWidth: 0 } });
    var chatTop = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' } });
    chatTop.appendChild(el('div', { style: Object.assign({}, DS.font('md'), { color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }) }, MOCK.chat.name));
    chatTop.appendChild(el('span', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', flexShrink: 0 }) }, '10:30'));
    chatInfo.appendChild(chatTop);
    chatInfo.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: 'var(--text-sec)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }) }, MOCK.chat.last_message.text));
    chatRow.appendChild(chatInfo);
    if (MOCK.chat.unread_count > 0) {
      chatRow.appendChild(el('span', {
        style: {
          minWidth: '20px', height: '20px', borderRadius: '10px',
          background: 'var(--red)', color: '#fff', fontSize: '11px', fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px',
        },
        textContent: String(MOCK.chat.unread_count),
      }));
    }
    w4.appendChild(chatRow);

    // Карточка письма (my_mail.js — SwipeCard + кастом)
    var mailCard = M.SwipeCard({
      title: MOCK.mail.from_name,
      subtitle: MOCK.mail.subject,
      rightActions: [
        { label: 'Архив', color: 'var(--blue)', icon: '📥', onClick: function () {} },
        { label: 'Удалить', color: 'var(--red)', icon: '🗑', onClick: function () {} },
      ],
    });
    var mailInner = mailCard.querySelector('.asgard-swipe-inner');
    if (mailInner) {
      mailInner.style.borderLeft = '3px solid var(--blue)';
      var meta = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' } });
      meta.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: 'var(--text-ter)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }) }, MOCK.mail.preview.substring(0, 80)));
      meta.appendChild(el('span', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', flexShrink: 0, marginLeft: '8px' }) }, 'вчера'));
      mailInner.appendChild(meta);
    }
    w4.appendChild(mailCard);

    // Карточка договора (contracts.js — M.Card)
    w4.appendChild(M.Card({
      title: MOCK.contract.title,
      subtitle: MOCK.contract.contractor_name,
      badge: 'Действует', badgeColor: 'success',
      time: Utils.formatDate(MOCK.contract.date),
      fields: [
        { label: '№', value: MOCK.contract.number },
        { label: 'Сумма', value: Utils.formatMoney(MOCK.contract.amount) },
        { label: 'До', value: Utils.formatDate(MOCK.contract.end_date) },
      ],
      onClick: function () { M.Toast({ message: 'Тестовый клик: договор', type: 'info' }); },
    }));
    frag.appendChild(w4);


    // ── Сессия 13: Профиль + Система ──
    frag.appendChild(subTitle('Сессия 13: Профиль + Система'));
    var w5 = cardWrap();

    // Профиль — Hero-стиль (profile.js)
    var profileCard = el('div', {
      style: {
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '20px', background: 'var(--surface)', borderRadius: '18px',
        border: '1px solid var(--border)',
      },
    });
    profileCard.appendChild(M.Avatar({ name: MOCK.user.name, size: 72, status: 'online' }));
    profileCard.appendChild(el('div', { style: Object.assign({}, DS.font('lg'), { color: 'var(--text)', marginTop: '12px' }) }, MOCK.user.name));
    profileCard.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: 'var(--text-sec)', marginTop: '4px' }) }, MOCK.user.email));
    profileCard.appendChild(el('div', { style: { marginTop: '8px' } }, [M.Badge({ text: MOCK.user.role_name, color: 'danger' })]));
    w5.appendChild(profileCard);

    // Диагностика — инфо-карточка (diag.js)
    var diagCard = el('div', {
      style: {
        padding: '14px 16px', background: 'var(--surface)', borderRadius: '18px',
        border: '1px solid var(--border)',
      },
    });
    diagCard.appendChild(el('div', { style: Object.assign({}, DS.font('md'), { color: 'var(--text)', marginBottom: '8px' }) }, '🔧 Диагностика'));
    var diagFields = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    [
      { label: 'Router', value: 'Ок', color: 'success' },
      { label: 'Components (M)', value: 'Ок', color: 'success' },
      { label: 'MobileWidgets', value: '27 шт.', color: 'info' },
    ].forEach(function (r) {
      var row = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' } });
      row.appendChild(el('span', { style: Object.assign({}, DS.font('sm'), { color: 'var(--text-sec)' }) }, r.label));
      row.appendChild(M.Badge({ text: r.value, color: r.color }));
      diagFields.appendChild(row);
    });
    diagCard.appendChild(diagFields);
    w5.appendChild(diagCard);

    frag.appendChild(w5);

    // ══════════════════════════════════════════════
    // ПРОПУЩЕННЫЕ КОМПОНЕНТЫ (используются на страницах)
    // ══════════════════════════════════════════════
    frag.appendChild(subTitle('Пропущенные компоненты (используются на страницах)'));
    var wMissing = cardWrap();

    // ── 1. DetailFields (34 использования!) ──
    wMissing.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginBottom: '4px' }) }, 'DetailFields (34×)'));
    wMissing.appendChild(M.DetailFields({
      fields: [
        { label: 'Заказчик', value: 'Газпромнефть-МНПЗ' },
        { label: 'Объект', value: 'Котельная инв.767' },
        { label: 'Сумма', value: '3 520 000 ₽' },
        { label: 'РП', value: 'Андросов Н.А.' },
        { label: 'Дедлайн', value: '15.04.2026' },
        { label: 'Статус', value: M.Badge({ text: 'В работе', color: 'info' }) },
      ]
    }));

    // ── 2. TablePage (16 использований) ──
    wMissing.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '12px', marginBottom: '4px' }) }, 'TablePage (16×)'));
    wMissing.appendChild(M.TablePage({
      title: 'Тендеры в работе',
      columns: ['Название', 'Заказчик', 'Сумма'],
      rows: [
        ['Чистка котлов ЦТД 65', 'Газпромнефть', '4 300 000 ₽'],
        ['Чистка ПТ NT250', 'ЯНПЗ', '3 520 000 ₽'],
        ['АВОК корпус 3', 'ЛУКОЙЛ', '1 800 000 ₽'],
        ['Пескоструй РВС-1000', 'Башнефть', '2 150 000 ₽'],
      ]
    }));

    // ── 3. Stats (10 использований) ──
    wMissing.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '12px', marginBottom: '4px' }) }, 'Stats (10×)'));
    wMissing.appendChild(M.Stats({
      items: [
        { label: 'Тендеры', value: '24', color: 'info' },
        { label: 'Работы', value: '12', color: 'success' },
        { label: 'Маржа', value: '38%', color: 'warning' },
        { label: 'Просрочено', value: '2', color: 'danger' },
      ]
    }));

    // ── 4. FAB (9 использований) ──
    wMissing.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '12px', marginBottom: '4px' }) }, 'FAB (9×) — см. плавающую кнопку внизу'));
    // FAB добавляется отдельно — он fixed-позиционированный

    // ── 5. SearchBar (7 использований) ──
    wMissing.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '12px', marginBottom: '4px' }) }, 'SearchBar (7×)'));
    wMissing.appendChild(M.SearchBar({ placeholder: 'Поиск по тендерам...', onInput: function (v) {  } }));

    // ── 6. ProgressBar (7 использований) ──
    wMissing.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '12px', marginBottom: '4px' }) }, 'ProgressBar (7×)'));
    wMissing.appendChild(M.ProgressBar({ value: 15, label: 'Начато' }));
    wMissing.appendChild(M.ProgressBar({ value: 65, label: 'Выполнено' }));
    wMissing.appendChild(M.ProgressBar({ value: 100, label: 'Завершено' }));

    // ── 7. Timeline (4 использования) ──
    wMissing.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '12px', marginBottom: '4px' }) }, 'Timeline (4×)'));
    wMissing.appendChild(M.Timeline({
      items: [
        { title: 'Создано', subtitle: 'Андросов Н.А.', time: '10:30', color: 'neutral' },
        { title: 'На согласовании', subtitle: 'Отправлено директору', time: '11:15', color: 'info' },
        { title: 'Согласовано', subtitle: 'Кудряшов О.С.', time: '14:00', color: 'success' },
        { title: 'Оплачено', subtitle: 'Бухгалтерия', time: '16:30', color: 'success' },
      ]
    }));

    // ── 8. Section (3 использования) ──
    wMissing.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '12px', marginBottom: '4px' }) }, 'Section (3×)'));
    wMissing.appendChild(M.Section({
      title: 'Информация по объекту',
      children: [
        el('div', { style: Object.assign({}, DS.font('sm'), { color: 'var(--text-sec)', padding: '8px 0' }) }, 'Котельная инв.767, ЯНПЗ — химическая очистка теплообменника NT250LH/B'),
      ],
    }));

    // ── 9. Chip (3 использования) ──
    wMissing.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '12px', marginBottom: '4px' }) }, 'Chip (3×)'));
    var chipWrap = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
    chipWrap.appendChild(M.Chip({ text: 'Химическая очистка', removable: true }));
    chipWrap.appendChild(M.Chip({ text: 'Гидродинамическая', removable: true }));
    chipWrap.appendChild(M.Chip({ text: 'АВОК', active: true }));
    chipWrap.appendChild(M.Chip({ text: 'Пескоструй' }));
    chipWrap.appendChild(M.Chip({ text: 'Монтаж' }));
    wMissing.appendChild(chipWrap);

    // ── 10. ChatBubble (2 использования) ──
    wMissing.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '12px', marginBottom: '4px' }) }, 'ChatBubble (2×)'));
    var chatWrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    chatWrap.appendChild(M.ChatBubble({ text: 'Добрый день! КП готово?', time: '10:30', incoming: true, author: 'Иванов А.А.' }));
    chatWrap.appendChild(M.ChatBubble({ text: 'Да, отправил на почту.', time: '10:32', incoming: false }));
    chatWrap.appendChild(M.ChatBubble({ text: 'Отлично, спасибо! Жду оригиналы.', time: '10:33', incoming: true, author: 'Иванов А.А.' }));
    wMissing.appendChild(chatWrap);

    // ── 11. BigNumber (2 использования) ──
    wMissing.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '12px', marginBottom: '4px' }) }, 'BigNumber (2×)'));
    var bnWrap = el('div', { style: { display: 'flex', gap: '8px' } });
    bnWrap.appendChild(M.BigNumber({ value: '3 520 000', label: 'Выручка, ₽', color: 'success' }));
    bnWrap.appendChild(M.BigNumber({ value: '24', label: 'Активных тендеров', color: 'info' }));
    wMissing.appendChild(bnWrap);

    // ── 12. BarChart (2 использования) ──
    wMissing.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '12px', marginBottom: '4px' }) }, 'BarChart (2×)'));
    wMissing.appendChild(M.BarChart({
      data: [
        { label: 'Иванов', value: 8, max: 15 },
        { label: 'Петров', value: 12, max: 15 },
        { label: 'Сидоров', value: 5, max: 15 },
      ]
    }));

    // ── 13. MessageComposer ──
    wMissing.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '12px', marginBottom: '4px' }) }, 'MessageComposer'));
    wMissing.appendChild(M.MessageComposer({ placeholder: 'Написать сообщение...', onSend: function (txt) { M.Toast({ message: 'Отправлено: ' + txt, type: 'success' }); } }));

    // ── 14. MimirBanner ──
    wMissing.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '12px', marginBottom: '4px' }) }, 'MimirBanner'));
    wMissing.appendChild(M.MimirBanner({ text: 'Мимир проанализировал 12 тендеров и нашёл 3 перспективных.' }));

    frag.appendChild(wMissing);

    return frag;
  }


  /* ═══════════════════════════════════════
     СЕКЦИЯ 2: Pill-статусы
     ═══════════════════════════════════════ */
  function section2_Pills() {
    var frag = document.createDocumentFragment();
    frag.appendChild(sectionTitle('2. Pill-статусы — единообразие'));

    var wrap = el('div', { style: { padding: '0 var(--sp-page)', display: 'flex', flexDirection: 'column', gap: '12px' } });

    var groups = [
      { label: 'Тендеры', pills: [
        { text: 'Новый', color: 'neutral' },
        { text: 'В просчёте', color: 'info' },
        { text: 'КП отправлено', color: 'warning' },
        { text: 'Выиграли', color: 'success' },
        { text: 'Проиграли', color: 'danger' },
      ] },
      { label: 'Просчёты', pills: [
        { text: 'Черновик', color: 'neutral' },
        { text: 'На согласовании', color: 'info' },
        { text: 'Согласовано', color: 'success' },
        { text: 'На доработке', color: 'warning' },
        { text: 'Вопрос', color: 'gold' },
        { text: 'Отклонено', color: 'danger' },
      ] },
      { label: 'Оплата', pills: [
        { text: 'Ожидает оплаты', color: 'warning' },
        { text: 'Оплачено ПП', color: 'success' },
        { text: 'Наличные выданы', color: 'info' },
        { text: 'Получено', color: 'success' },
        { text: 'Отчёт приложен', color: 'info' },
      ] },
      { label: 'Задачи', pills: [
        { text: 'Новая', color: 'neutral' },
        { text: 'В работе', color: 'info' },
        { text: 'Выполнена', color: 'success' },
        { text: 'Просрочена', color: 'danger' },
      ] },
      { label: 'Допуски', pills: [
        { text: 'Действует', color: 'success' },
        { text: 'Истекает', color: 'warning' },
        { text: 'Просрочен', color: 'danger' },
      ] },
      { label: 'Заявки', pills: [
        { text: 'Новая', color: 'neutral' },
        { text: 'На рассмотрении', color: 'info' },
        { text: 'Одобрена', color: 'success' },
        { text: 'Отклонена', color: 'danger' },
      ] },
      { label: 'Касса', pills: [
        { text: 'Черновик', color: 'neutral' },
        { text: 'Одобрено', color: 'success' },
        { text: 'Выдано', color: 'info' },
        { text: 'Получено', color: 'success' },
        { text: 'Отчёт', color: 'gold' },
        { text: 'Отклонено', color: 'danger' },
      ] },
    ];

    groups.forEach(function (g) {
      var row = el('div');
      row.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', marginBottom: '6px', fontWeight: 600 }) }, g.label));
      var pillRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
      g.pills.forEach(function (p) {
        pillRow.appendChild(M.Badge({ text: p.text, color: p.color }));
      });
      row.appendChild(pillRow);
      wrap.appendChild(row);
    });

    frag.appendChild(wrap);
    return frag;
  }


  /* ═══════════════════════════════════════
     СЕКЦИЯ 3: Кнопки действий
     ═══════════════════════════════════════ */
  function section3_Buttons() {
    var frag = document.createDocumentFragment();
    frag.appendChild(sectionTitle('3. Кнопки — сравнение'));

    var wrap = el('div', { style: { padding: '0 var(--sp-page)', display: 'flex', flexDirection: 'column', gap: '12px' } });

    // Approvals.js inline-buttons (4 actions row)
    wrap.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600 }) }, 'approvals.js: 4 кнопки согласования'));
    var actRow = el('div', { style: { display: 'flex', gap: '6px' } });
    [
      { icon: '✓', color: 'var(--green)', label: 'Да' },
      { icon: '↻', color: 'var(--orange)', label: 'Доработка' },
      { icon: '?', color: 'var(--gold)', label: 'Вопрос' },
      { icon: '✕', color: 'var(--red)', label: 'Нет' },
    ].forEach(function (a) {
      var btn = el('button', {
        style: {
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
          padding: '10px 6px', borderRadius: '12px',
          background: a.color + '15', border: '1px solid ' + a.color + '40',
          color: a.color, fontSize: '18px', cursor: 'pointer', fontFamily: 'inherit',
        },
      });
      btn.appendChild(el('span', {}, a.icon));
      btn.appendChild(el('span', { style: { fontSize: '10px', fontWeight: 600 } }, a.label));
      actRow.appendChild(btn);
    });
    wrap.appendChild(actRow);

    // FullWidthBtn variants
    wrap.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '8px' }) }, 'FullWidthBtn: варианты'));
    wrap.appendChild(M.FullWidthBtn({ label: '✅ Согласовать', variant: 'primary', onClick: function () { M.Toast({ message: 'Primary!', type: 'success' }); } }));
    wrap.appendChild(M.FullWidthBtn({ label: '🔄 Доработка', variant: 'secondary', onClick: function () { M.Toast({ message: 'Secondary!', type: 'info' }); } }));
    wrap.appendChild(M.FullWidthBtn({ label: '❌ Отклонить', variant: 'danger', onClick: function () { M.Toast({ message: 'Danger!', type: 'error' }); } }));
    wrap.appendChild(M.FullWidthBtn({ label: '💳 Оплатить ПП', variant: 'primary', onClick: function () {} }));
    wrap.appendChild(M.FullWidthBtn({ label: '💵 Выдать наличные', variant: 'secondary', onClick: function () {} }));
    wrap.appendChild(M.FullWidthBtn({ label: '+ Новая задача', variant: 'primary', onClick: function () {} }));
    wrap.appendChild(M.FullWidthBtn({ label: '📈 Воронка', variant: 'secondary', onClick: function () {} }));
    wrap.appendChild(M.FullWidthBtn({ label: '🧮 Создать ТКП', variant: 'secondary', onClick: function () {} }));

    // Loading button
    wrap.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '8px' }) }, 'Кнопка с загрузкой'));
    var loadingBtn = M.FullWidthBtn({ label: 'Обработка...', variant: 'primary', loading: true });
    wrap.appendChild(loadingBtn);

    // FAB (Floating Action Button) — 9 использований
    wrap.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '12px' }) }, 'FAB (9×) — плавающая кнопка'));
    var fabDemo = el('div', { style: { position: 'relative', height: '80px', background: 'var(--bg1)', borderRadius: '12px', border: '1px solid var(--border)', overflow: 'hidden' } });
    var fab = M.FAB({ icon: '+', onClick: function () { M.Toast({ message: 'FAB нажата!', type: 'info' }); } });
    fab.style.position = 'absolute';
    fab.style.bottom = '12px';
    fab.style.right = '12px';
    fabDemo.appendChild(fab);
    wrap.appendChild(fabDemo);

    // SearchBar — 7 использований
    wrap.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '12px' }) }, 'SearchBar (7×)'));
    wrap.appendChild(M.SearchBar({ placeholder: 'Поиск по клиентам...', onInput: function (v) {  } }));

    frag.appendChild(wrap);
    return frag;
  }


  /* ═══════════════════════════════════════
     СЕКЦИЯ 4: Модалки
     ═══════════════════════════════════════ */
  function section4_Modals() {
    var frag = document.createDocumentFragment();
    frag.appendChild(sectionTitle('4. Модалки — проверка'));

    var wrap = el('div', { style: { padding: '0 var(--sp-page)', display: 'flex', flexDirection: 'column', gap: '8px' } });

    var modals = [
      { label: 'Confirm (стандарт)', fn: function () {
        M.Confirm({ title: 'Подтверждение', message: 'Вы уверены что хотите продолжить?', okText: 'Да', cancelText: 'Отмена' }).then(function (v) { M.Toast({ message: v ? 'Подтверждено' : 'Отменено', type: v ? 'success' : 'info' }); });
      } },
      { label: 'Confirm (danger)', fn: function () {
        M.Confirm({ title: 'Удалить запись?', message: 'Это действие нельзя отменить.', okText: 'Удалить', cancelText: 'Отмена', danger: true }).then(function () {});
      } },
      { label: 'BottomSheet (фильтры)', fn: function () {
        var content = el('div');
        content.appendChild(M.FilterPills({ items: [
          { label: 'Все', value: 'all', active: true },
          { label: 'Новые', value: 'new' },
          { label: 'В работе', value: 'wip' },
          { label: 'Выиграно', value: 'won' },
        ] }));
        content.appendChild(el('div', { style: { padding: '20px', textAlign: 'center', color: 'var(--text-sec)' } }, 'Содержимое фильтров'));
        M.BottomSheet({ title: 'Фильтры', content: content });
      } },
      { label: 'Модалка директора', fn: function () {
        if (typeof MobileApproval !== 'undefined') {
          MobileApproval.showDirectorActions('estimates', 1, { onAction: function () { M.Toast({ message: 'Тестовое действие', type: 'info' }); } });
        } else { M.Toast({ message: 'MobileApproval не загружен', type: 'error' }); }
      } },
      { label: 'Модалка бухгалтерии', fn: function () {
        if (typeof MobileApproval !== 'undefined') {
          MobileApproval.showBuhPayment('bonus_requests', 1, { onAction: function () { M.Toast({ message: 'Тестовое действие', type: 'info' }); } });
        } else { M.Toast({ message: 'MobileApproval не загружен', type: 'error' }); }
      } },
      { label: 'Подтверждение наличных', fn: function () {
        if (typeof MobileApproval !== 'undefined') {
          MobileApproval.showConfirmCash('cash_requests', 1, { onAction: function () {} });
        } else { M.Toast({ message: 'MobileApproval не загружен', type: 'error' }); }
      } },
      { label: 'Отчёт о расходах', fn: function () {
        if (typeof MobileApproval !== 'undefined') {
          MobileApproval.showExpenseReport('cash_requests', 1, { onAction: function () {} });
        } else { M.Toast({ message: 'MobileApproval не загружен', type: 'error' }); }
      } },
      { label: 'Возврат остатка', fn: function () {
        if (typeof MobileApproval !== 'undefined') {
          MobileApproval.showReturnCash('cash_requests', 1, { onAction: function () {} });
        } else { M.Toast({ message: 'MobileApproval не загружен', type: 'error' }); }
      } },
      { label: 'Action Sheet', fn: function () {
        M.ActionSheet({
          title: 'Действия',
          actions: [
            { icon: '📝', label: 'Редактировать', onClick: function () { M.Toast({ message: 'Редактирование', type: 'info' }); } },
            { icon: '📋', label: 'Дублировать', onClick: function () {} },
            { icon: '📤', label: 'Экспорт', onClick: function () {} },
            { icon: '🗑', label: 'Удалить', danger: true, onClick: function () {} },
          ],
        });
      } },
    ];

    modals.forEach(function (m) {
      wrap.appendChild(M.FullWidthBtn({ label: m.label, variant: 'secondary', onClick: m.fn }));
    });

    frag.appendChild(wrap);
    return frag;
  }


  /* ═══════════════════════════════════════
     СЕКЦИЯ 5: Формы
     ═══════════════════════════════════════ */
  function section5_Forms() {
    var frag = document.createDocumentFragment();
    frag.appendChild(sectionTitle('5. Формы — единообразие инпутов'));

    // Форма задачи (tasks.js)
    frag.appendChild(subTitle('tasks.js: Новая задача'));
    frag.appendChild(M.Form({
      fields: [
        { id: 'title', label: 'Заголовок', type: 'text', required: true, placeholder: 'Что сделать?' },
        { id: 'deadline', label: 'Дедлайн', type: 'date' },
        { id: 'priority', label: 'Приоритет', type: 'select', options: [
          { value: 'low', label: 'Низкий' },
          { value: 'normal', label: 'Обычный' },
          { value: 'high', label: 'Высокий' },
          { value: 'urgent', label: 'Срочный' },
        ] },
        { id: 'description', label: 'Описание', type: 'textarea', placeholder: 'Детали задачи...' },
      ],
      submitLabel: 'Создать задачу',
      onSubmit: function (data) { M.Toast({ message: 'Форма: ' + JSON.stringify(data).slice(0, 50), type: 'success' }); },
    }));

    // Форма кассы (cash.js)
    frag.appendChild(subTitle('cash.js: Заявка на аванс'));
    frag.appendChild(M.Form({
      fields: [
        { id: 'purpose', label: 'Назначение', type: 'text', required: true, placeholder: 'Командировка, закупка и т.д.' },
        { id: 'amount', label: 'Сумма, ₽', type: 'number', required: true, placeholder: '50000' },
        { id: 'comment', label: 'Комментарий', type: 'textarea', placeholder: 'Детали заявки...' },
      ],
      submitLabel: 'Далее →',
      onSubmit: function (data) { M.Toast({ message: 'Форма кассы ОК', type: 'success' }); },
    }));

    // Форма корреспонденции (correspondence.js)
    frag.appendChild(subTitle('correspondence.js: Новый документ'));
    frag.appendChild(M.Form({
      fields: [
        { id: 'title', label: 'Название', type: 'text', required: true },
        { id: 'number', label: 'Номер', type: 'text' },
        { id: 'direction', label: 'Направление', type: 'select', options: [
          { value: 'incoming', label: 'Входящий' },
          { value: 'outgoing', label: 'Исходящий' },
        ], required: true },
        { id: 'note', label: 'Примечание', type: 'textarea' },
      ],
      submitLabel: 'Создать',
      onSubmit: function () { M.Toast({ message: 'Форма корр. ОК', type: 'success' }); },
    }));

    // Форма пропуска (pass_requests.js)
    frag.appendChild(subTitle('pass_requests.js: Заявка на пропуск'));
    frag.appendChild(M.Form({
      fields: [
        { id: 'object_name', label: 'Объект', required: true },
        { id: 'pass_date_from', label: 'Дата с', type: 'date', required: true },
        { id: 'pass_date_to', label: 'Дата по', type: 'date', required: true },
        { id: 'comment', label: 'Комментарий', type: 'textarea' },
      ],
      submitLabel: 'Создать заявку',
      onSubmit: function () { M.Toast({ message: 'Форма пропуска ОК', type: 'success' }); },
    }));

    return frag;
  }


  /* ═══════════════════════════════════════
     СЕКЦИЯ 6: Виджеты дашборда (все 27)
     ═══════════════════════════════════════ */
  function section6_Widgets() {
    var frag = document.createDocumentFragment();
    frag.appendChild(sectionTitle('6. Виджеты — полная витрина (27 шт.)'));

    var wrap = el('div', { style: { padding: '0 var(--sp-page)', display: 'flex', flexDirection: 'column', gap: '10px' } });

    if (typeof MobileWidgets === 'undefined') {
      wrap.appendChild(M.Empty({ text: 'MobileWidgets не загружен', type: 'error' }));
      frag.appendChild(wrap);
      return frag;
    }

    var keys = Object.keys(MobileWidgets).sort();
    wrap.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: 'var(--text-sec)', marginBottom: '4px' }) }, 'Найдено виджетов: ' + keys.length));

    keys.forEach(function (key, i) {
      var widget = MobileWidgets[key];
      if (!widget || typeof widget.render !== 'function') return;

      var box = el('div', {
        style: {
          background: 'var(--surface)', borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.06)',
        },
      });

      // Widget label — Russian name from widget registry
      var widgetName = widget.name || key;
      box.appendChild(el('div', {
        style: {
          padding: '8px 14px', borderBottom: '1px solid var(--border)',
          fontSize: '11px', fontWeight: 600, color: 'var(--text-sec)',
          letterSpacing: '0.3px',
          background: 'var(--surface-alt)',
        },
        textContent: widgetName,
      }));

      var container = el('div', { style: { padding: '0' } });
      try {
        widget.render(container, MOCK.user);
      } catch (e) {
        container.appendChild(el('div', {
          style: Object.assign({}, DS.font('sm'), { color: 'var(--red)', padding: '12px' }),
          textContent: '❌ Ошибка: ' + (e.message || e),
        }));
      }
      box.appendChild(container);
      wrap.appendChild(box);
    });

    frag.appendChild(wrap);
    return frag;
  }


  /* ═══════════════════════════════════════
     СЕКЦИЯ 7: Навигация
     ═══════════════════════════════════════ */
  function section7_Navigation() {
    var frag = document.createDocumentFragment();
    frag.appendChild(sectionTitle('7. Навигация'));

    // Header demo
    frag.appendChild(subTitle('Header'));
    frag.appendChild(M.Header({
      title: 'Заголовок страницы',
      subtitle: 'Подзаголовок',
      back: true,
      actions: [{
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
        onClick: function () { M.Toast({ message: 'Action!', type: 'info' }); },
      }],
    }));

    // Tabs demo
    frag.appendChild(subTitle('Tabs'));
    var tabsWrap = el('div');
    tabsWrap.appendChild(M.Tabs({
      items: [
        { label: 'Все', value: 'all' },
        { label: 'Мои', value: 'mine' },
        { label: 'В работе', value: 'wip' },
        { label: 'Завершённые', value: 'done' },
      ],
      active: 'all',
      onChange: function (v) { M.Toast({ message: 'Tab: ' + v, type: 'info', duration: 1500 }); },
    }));
    frag.appendChild(tabsWrap);

    // SegmentControl
    frag.appendChild(subTitle('SegmentControl'));
    var segWrap = el('div', { style: { padding: '0 var(--sp-page)' } });
    segWrap.appendChild(M.SegmentControl({
      items: [
        { label: 'Список', value: 'list' },
        { label: 'Карточки', value: 'cards' },
        { label: 'Таблица', value: 'table' },
      ],
      active: 'list',
    }));
    frag.appendChild(segWrap);

    // FilterPills
    frag.appendChild(subTitle('FilterPills'));
    frag.appendChild(M.FilterPills({
      items: [
        { label: 'Все', value: 'all', active: true },
        { label: 'Новые', value: 'new' },
        { label: 'В работе', value: 'wip' },
        { label: 'Выиграно', value: 'won' },
        { label: 'Проиграно', value: 'lost' },
        { label: 'Архив', value: 'archive' },
      ],
    }));

    // Мини-карта всех маршрутов
    frag.appendChild(subTitle('Карта всех маршрутов'));
    var routeList = el('div', { style: { padding: '0 var(--sp-page)', display: 'flex', flexDirection: 'column', gap: '2px' } });

    if (typeof MobileMenuSections !== 'undefined') {
      MobileMenuSections.forEach(function (section) {
        routeList.appendChild(el('div', {
          style: Object.assign({}, DS.font('label'), { color: 'var(--text-ter)', padding: '10px 0 4px', borderBottom: '1px solid var(--border)' }),
          textContent: section.icon + ' ' + section.label,
        }));
        (section.items || []).forEach(function (item) {
          var row = el('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 0 10px 12px', cursor: 'pointer',
            },
          });
          row.appendChild(el('span', { style: { fontSize: '16px', width: '24px', textAlign: 'center' } }, item.icon || '•'));
          row.appendChild(el('span', { style: Object.assign({}, DS.font('sm'), { color: 'var(--text)', flex: 1 }) }, item.title));
          row.appendChild(el('span', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)' }) }, item.path));
          var goBtn = el('button', {
            style: {
              background: 'var(--surface-alt)', border: '1px solid var(--border)',
              borderRadius: '8px', padding: '4px 8px', cursor: 'pointer',
              fontSize: '12px', color: 'var(--blue)', fontWeight: 600,
            },
            textContent: '→',
            onClick: function () { Router.navigate(item.path); },
          });
          row.appendChild(goBtn);
          routeList.appendChild(row);
        });
      });
    } else {
      routeList.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: 'var(--text-ter)' }) }, 'MobileMenuSections не найден'));
    }
    frag.appendChild(routeList);

    return frag;
  }


  /* ═══════════════════════════════════════
     СЕКЦИЯ 8: Empty states
     ═══════════════════════════════════════ */
  function section8_Empty() {
    var frag = document.createDocumentFragment();
    frag.appendChild(sectionTitle('8. Пустые состояния'));

    var wrap = el('div', { style: { padding: '0 var(--sp-page)', display: 'flex', flexDirection: 'column', gap: '10px' } });

    var states = [
      { text: 'Нет тендеров', icon: '🏆', source: 'tenders.js' },
      { text: 'Нет работ, воин', icon: '🔧', source: 'pm_works.js' },
      { text: 'Заявок пока нет', icon: '💰', source: 'cash.js' },
      { text: 'Нет задач от руководства', icon: '📋', source: 'tasks.js' },
      { text: 'Нет уведомлений', icon: '🔔', source: 'alerts.js' },
      { text: 'Нет допусков', icon: '🛡', source: 'permits.js' },
      { text: 'Дружина пуста', icon: '⚔️', source: 'personnel.js' },
      { text: 'Нет чатов', icon: undefined, type: 'default', source: 'messenger.js' },
      { text: 'Ничего не найдено', icon: undefined, type: 'search', source: 'Поиск' },
      { text: 'Произошла ошибка', icon: undefined, type: 'error', source: 'Ошибка' },
    ];

    states.forEach(function (s) {
      var box = el('div', {
        style: {
          background: 'var(--surface)', borderRadius: '16px',
          border: '1px solid var(--border)', overflow: 'hidden',
        },
      });
      box.appendChild(el('div', {
        style: {
          padding: '6px 14px', borderBottom: '1px solid var(--border)',
          fontSize: '10px', fontWeight: 700, color: 'var(--text-ter)',
          textTransform: 'uppercase', letterSpacing: '0.5px',
          background: 'var(--surface-alt)',
        },
        textContent: s.source,
      }));
      box.appendChild(M.Empty({ text: s.text, icon: s.icon, type: s.type }));
      wrap.appendChild(box);
    });

    frag.appendChild(wrap);
    return frag;
  }


  /* ═══════════════════════════════════════
     СЕКЦИЯ 9: Loading / Skeleton
     ═══════════════════════════════════════ */
  function section9_Loading() {
    var frag = document.createDocumentFragment();
    frag.appendChild(sectionTitle('9. Загрузка'));

    var wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });

    wrap.appendChild(subTitle('Skeleton: card'));
    wrap.appendChild(M.Skeleton({ type: 'card', count: 3 }));

    wrap.appendChild(subTitle('Skeleton: list'));
    wrap.appendChild(M.Skeleton({ type: 'list', count: 3 }));

    wrap.appendChild(subTitle('Skeleton: hero'));
    wrap.appendChild(M.Skeleton({ type: 'hero', count: 1 }));

    wrap.appendChild(subTitle('Skeleton: stats'));
    wrap.appendChild(M.Skeleton({ type: 'stats', count: 1 }));

    wrap.appendChild(subTitle('Loading кнопка'));
    var loadWrap = el('div', { style: { padding: '0 var(--sp-page)' } });
    loadWrap.appendChild(M.FullWidthBtn({ label: 'Обработка...', variant: 'primary', loading: true }));
    wrap.appendChild(loadWrap);

    wrap.appendChild(subTitle('Pull-to-refresh'));
    var ptrWrap = el('div', { style: { padding: '0 var(--sp-page)' } });
    var ptr = M.PullToRefresh({ onRefresh: function () {} });
    ptr.setRefreshing(true);
    ptrWrap.appendChild(ptr);
    wrap.appendChild(ptrWrap);

    // ProgressBar — 7 использований
    wrap.appendChild(subTitle('ProgressBar (7×)'));
    var pbWrap = el('div', { style: { padding: '0 var(--sp-page)', display: 'flex', flexDirection: 'column', gap: '8px' } });
    pbWrap.appendChild(M.ProgressBar({ value: 15, label: 'Начато' }));
    pbWrap.appendChild(M.ProgressBar({ value: 65, label: 'Выполнено' }));
    pbWrap.appendChild(M.ProgressBar({ value: 100, label: 'Завершено' }));
    wrap.appendChild(pbWrap);

    frag.appendChild(wrap);
    return frag;
  }


  /* ═══════════════════════════════════════
     СЕКЦИЯ 10: Dark / Light toggle
     ═══════════════════════════════════════ */
  function section10_Theme() {
    var frag = document.createDocumentFragment();
    frag.appendChild(sectionTitle('10. Тема Dark / Light'));

    var wrap = el('div', { style: { padding: '12px var(--sp-page)', display: 'flex', flexDirection: 'column', gap: '12px' } });

    // Текущая тема
    var themeLabel = el('div', { style: Object.assign({}, DS.font('md'), { color: 'var(--text)' }) }, 'Текущая тема: ' + (DS.getTheme() || 'dark'));

    wrap.appendChild(themeLabel);

    // Toggle button
    var toggleBtn = M.FullWidthBtn({
      label: '🌓 Переключить тему',
      variant: 'secondary',
      onClick: function () {
        DS.toggleTheme();
        t = DS.t;
        themeLabel.textContent = 'Текущая тема: ' + (DS.getTheme() || 'dark');
      },
    });
    wrap.appendChild(toggleBtn);

    // DS theme toggle component
    wrap.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', marginTop: '8px' }) }, 'Или используйте DS.createThemeToggle():'));
    var toggleWrap = el('div', { style: { display: 'flex', justifyContent: 'center', padding: '8px' } });
    toggleWrap.appendChild(DS.createThemeToggle());
    wrap.appendChild(toggleWrap);

    // Color swatches
    wrap.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'var(--text-ter)', fontWeight: 600, marginTop: '12px' }) }, 'CSS-переменные (текущая тема):'));
    var swatchGrid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginTop: '6px' } });

    var vars = [
      '--bg', '--surface', '--surface-alt', '--border', '--text', '--text-sec',
      '--text-ter', '--red', '--blue', '--green', '--orange', '--gold',
    ];
    vars.forEach(function (v) {
      var swatch = el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px' } });
      swatch.appendChild(el('div', {
        style: {
          width: '24px', height: '24px', borderRadius: '6px',
          background: 'var(' + v + ')', border: '1px solid var(--border)',
          flexShrink: 0,
        },
      }));
      swatch.appendChild(el('span', { style: { fontSize: '10px', color: 'var(--text-sec)', wordBreak: 'break-all' } }, v));
      swatchGrid.appendChild(swatch);
    });
    wrap.appendChild(swatchGrid);

    frag.appendChild(wrap);
    return frag;
  }


  /* ══════════════════════════════════════════════
     РЕНДЕР СТРАНИЦЫ
     ══════════════════════════════════════════════ */
  async function render() {
    t = DS.t;

    var page = el('div', {
      className: 'asgard-test2-page',
      style: {
        paddingBottom: 'calc(120px + env(safe-area-inset-bottom, 0px))',
        background: 'var(--bg)',
        minHeight: '100vh',
      },
    });

    // Header
    page.appendChild(M.Header({
      title: '🔬 Визуальный аудит',
      subtitle: 'Сессия 16.0 — #test2',
      back: true,
      backHref: '/home',
      actions: [{
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
        onClick: function () { DS.toggleTheme(); t = DS.t; },
      }],
    }));

    // HeroCard
    page.appendChild(el('div', { style: { padding: '12px var(--sp-page)' } }, [
      M.HeroCard({
        label: 'ВИЗУАЛЬНЫЙ АУДИТ',
        value: '10',
        valueSuffix: ' секций',
        details: [
          { label: 'Файлов', value: '79' },
          { label: 'Маршрутов', value: '51' },
          { label: 'Виджетов', value: '27' },
        ],
      }),
    ]));

    // Quick navigation to sections
    page.appendChild(M.QuickActions({
      items: [
        { icon: '🃏', label: 'Карточки', onClick: function () { scrollToSection(1); } },
        { icon: '💊', label: 'Pill', onClick: function () { scrollToSection(2); } },
        { icon: '🔘', label: 'Кнопки', onClick: function () { scrollToSection(3); } },
        { icon: '📦', label: 'Модалки', onClick: function () { scrollToSection(4); } },
        { icon: '📝', label: 'Формы', onClick: function () { scrollToSection(5); } },
        { icon: '📊', label: 'Виджеты', onClick: function () { scrollToSection(6); } },
        { icon: '🧭', label: 'Навигация', onClick: function () { scrollToSection(7); } },
        { icon: '📭', label: 'Пусто', onClick: function () { scrollToSection(8); } },
        { icon: '⏳', label: 'Загрузка', onClick: function () { scrollToSection(9); } },
        { icon: '🌓', label: 'Тема', onClick: function () { scrollToSection(10); } },
      ],
    }));

    // Build all sections
    page.appendChild(section1_Cards());
    page.appendChild(section2_Pills());
    page.appendChild(section3_Buttons());
    page.appendChild(section4_Modals());
    page.appendChild(section5_Forms());
    page.appendChild(section6_Widgets());
    page.appendChild(section7_Navigation());
    page.appendChild(section8_Empty());
    page.appendChild(section9_Loading());
    page.appendChild(section10_Theme());

    // Footer
    page.appendChild(el('div', {
      style: {
        padding: '40px 20px', textAlign: 'center', color: 'var(--text-ter)',
        fontSize: '12px',
      },
    }, [
      el('div', {}, 'ASGARD CRM Mobile v3 — Visual Audit'),
      el('div', { style: { marginTop: '4px' } }, 'Сессия 16.0 • ' + new Date().toLocaleDateString('ru-RU')),
    ]));

    return page;
  }

  function scrollToSection(num) {
    // Find section title by number prefix
    var titles = document.querySelectorAll('.asgard-test2-page > div');
    for (var i = 0; i < titles.length; i++) {
      var text = titles[i].textContent || '';
      if (text.indexOf(num + '.') === 0) {
        titles[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
  }

  // Register route
  Router.register('/test2', { render: render });

  // Expose for debugging
  window.MobileTest2 = { render: render };
})();
