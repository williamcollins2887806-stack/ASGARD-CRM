/**
 * ASGARD CRM — Mobile v3 / Настройки CRM
 * Сессия 13 (Окно A) — 15.03.2026
 * Только ADMIN: основные параметры, справочники, SLA, роли
 */
var SettingsPage = {
  render: function () {
    var t = DS.t;
    var el = Utils.el;
    var user = Store.get('user') || {};

    var page = el('div', { style: { background: t.bg, paddingBottom: '100px' } });

    page.appendChild(M.Header({
      title: 'Настройки',
      subtitle: 'СИСТЕМА',
      back: true,
      backHref: '/home',
    }));

    // ── Role check ──
    if (user.role !== 'ADMIN') {
      page.appendChild(M.Empty({ text: 'Доступ только для администратора', icon: '🔒' }));
      return page;
    }

    // ── Loading skeleton ──
    var contentWrap = el('div');
    contentWrap.replaceChildren(M.Skeleton({ type: 'card', count: 4 }));
    page.appendChild(contentWrap);

    // ── Load settings ──
    setTimeout(function () {
      Promise.all([
        API.fetch('/settings').catch(function () { return {}; }),
        API.fetch('/settings/refs/all').catch(function () { return {}; }),
      ]).then(function (results) {
        var settings = results[0] || {};
        var refs = results[1] || {};
        contentWrap.replaceChildren();
        renderSettings(contentWrap, settings, refs);
      }).catch(function () {
        contentWrap.replaceChildren();
        contentWrap.appendChild(M.Empty({ text: 'Ошибка загрузки настроек', icon: '⚠️' }));
      });
    }, 0);

    function renderSettings(container, settings, refs) {
      var sections = [
        {
          title: 'Основные параметры',
          icon: '⚙️',
          key: 'main',
          fields: [
            { id: 'vat_pct', label: 'НДС (%)', type: 'number', value: String(settings.vat_pct != null ? settings.vat_pct : 22) },
            { id: 'currency', label: 'Валюта', value: settings.currency || 'RUB' },
            { id: 'company_name', label: 'Название компании', value: settings.company_name || 'ООО «Асгард Сервис»' },
            { id: 'docs_folder_hint', label: 'Папка документов', value: settings.docs_folder_hint || '' },
            { id: 'require_docs_on_handoff', label: 'Документы при передаче', type: 'toggle', value: settings.require_docs_on_handoff !== false },
          ],
        },
        {
          title: 'SLA / Сроки',
          icon: '⏱',
          key: 'sla',
          fields: [
            { id: 'docs_deadline_notice_days', label: 'Уведомление о дедлайне (дн)', type: 'number', value: String(settings.docs_deadline_notice_days || 5) },
            { id: 'pm_calc_due_workdays', label: 'Просчёт РП (раб. дн)', type: 'number', value: String(settings.pm_calc_due_workdays || 3) },
            { id: 'director_approval_due_workdays', label: 'Согласование директора (раб. дн)', type: 'number', value: String(settings.director_approval_due_workdays || 2) },
            { id: 'pm_rework_due_workdays', label: 'Доработка РП (раб. дн)', type: 'number', value: String(settings.pm_rework_due_workdays || 1) },
            { id: 'direct_request_deadline_days', label: 'Прямая заявка (дн)', type: 'number', value: String(settings.direct_request_deadline_days || 5) },
            { id: 'tkp_followup_first_delay_days', label: 'Повторное ТКП (дн)', type: 'number', value: String(settings.tkp_followup_first_delay_days || 3) },
          ],
        },
        {
          title: 'Калькулятор расчётов',
          icon: '🧮',
          key: 'calc',
          fields: [
            { id: 'min_profit_per_person_day', label: 'Мин. прибыль (₽/чел-день)', type: 'number', value: String(settings.min_profit_per_person_day || 20000) },
            { id: 'norm_profit_per_person_day', label: 'Норм. прибыль (₽/чел-день)', type: 'number', value: String(settings.norm_profit_per_person_day || 25000) },
            { id: 'overhead_pct', label: 'Накладные (%)', type: 'number', value: String(settings.overhead_pct || 10) },
            { id: 'fot_tax_pct', label: 'Налоги на ФОТ (%)', type: 'number', value: String(settings.fot_tax_pct || 50) },
            { id: 'profit_tax_pct', label: 'Налог на прибыль (%)', type: 'number', value: String(settings.profit_tax_pct || 20) },
          ],
        },
        {
          title: 'Графики работ',
          icon: '📅',
          key: 'schedules',
          fields: [
            { id: 'office_strict_own', label: 'Строгий офисный график', type: 'toggle', value: settings.office_strict_own !== false },
            { id: 'block_on_conflict', label: 'Блокировка при конфликтах', type: 'toggle', value: settings.block_on_conflict !== false },
          ],
        },
        {
          title: 'Роли и права',
          icon: '🛡',
          key: 'roles',
          viewOnly: true,
        },
      ];

      sections.forEach(function (sec, si) {
        var expanded = { v: si === 0 };
        var sectionWrap = el('div', {
          style: {
            margin: '8px 20px 0',
            borderRadius: '16px',
            overflow: 'hidden',
            border: '1px solid ' + t.border,
            background: t.surface,
            ...DS.anim(si * 0.05),
          },
        });

        // Header (tap to expand)
        var header = el('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px',
            cursor: 'pointer',
          },
        });
        var headerLeft = el('div', {
          style: { display: 'flex', alignItems: 'center', gap: '10px' },
        });
        headerLeft.appendChild(el('span', { style: { fontSize: '18px' } }, sec.icon));
        headerLeft.appendChild(el('div', { style: { ...DS.font('md'), color: t.text } }, sec.title));
        header.appendChild(headerLeft);

        var chevron = el('span', {
          style: {
            fontSize: '14px',
            color: t.textTer,
            transition: 'transform 0.3s ease',
            transform: expanded.v ? 'rotate(180deg)' : 'rotate(0deg)',
          },
          textContent: '▼',
        });
        header.appendChild(chevron);

        var body = el('div', {
          style: {
            maxHeight: expanded.v ? '1200px' : '0',
            overflow: 'hidden',
            transition: 'max-height 0.4s ease',
            borderTop: expanded.v ? '1px solid ' + t.border : 'none',
          },
        });

        header.addEventListener('click', function () {
          expanded.v = !expanded.v;
          chevron.style.transform = expanded.v ? 'rotate(180deg)' : 'rotate(0deg)';
          body.style.maxHeight = expanded.v ? '1200px' : '0';
          body.style.borderTop = expanded.v ? '1px solid ' + t.border : 'none';
        });

        sectionWrap.appendChild(header);

        // Body content
        if (sec.viewOnly) {
          var roles = ['ADMIN', 'DIRECTOR', 'DIRECTOR_COMMERCIAL', 'DIRECTOR_TECH', 'PM', 'ACCOUNTANT', 'OFFICE_MANAGER', 'HR', 'LOGIST', 'FOREMAN', 'WORKER', 'PROCUREMENT', 'LAWYER', 'ENGINEER'];
          var rolesWrap = el('div', { style: { padding: '12px 16px' } });
          roles.forEach(function (role) {
            var row = el('div', {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 0',
                borderBottom: '1px solid ' + t.border,
              },
            });
            var color = role === 'ADMIN' ? 'danger' : role.startsWith('DIRECTOR') ? 'gold' : 'info';
            row.appendChild(M.Badge({ text: role, color: color }));
            rolesWrap.appendChild(row);
          });
          body.appendChild(rolesWrap);
        } else if (sec.fields) {
          var formContent = el('div', { style: { padding: '12px 0' } });
          formContent.appendChild(M.Form({
            fields: sec.fields,
            submitLabel: 'Сохранить',
            onSubmit: function (data) {
              saveSectionSettings(sec.key, data);
            },
          }));
          body.appendChild(formContent);
        }

        sectionWrap.appendChild(body);
        container.appendChild(sectionWrap);
      });

      // ── Справочники (статусы) ──
      var refSection = el('div', {
        style: {
          margin: '8px 20px 0',
          borderRadius: '16px',
          overflow: 'hidden',
          border: '1px solid ' + t.border,
          background: t.surface,
          ...DS.anim(sections.length * 0.05),
        },
      });
      var refExpanded = { v: false };
      var refHeader = el('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px',
          cursor: 'pointer',
        },
      });
      var refLeft = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } });
      refLeft.appendChild(el('span', { style: { fontSize: '18px' } }, '📚'));
      refLeft.appendChild(el('div', { style: { ...DS.font('md'), color: t.text } }, 'Справочники'));
      refHeader.appendChild(refLeft);
      var refChevron = el('span', {
        style: { fontSize: '14px', color: t.textTer, transition: 'transform 0.3s ease' },
        textContent: '▼',
      });
      refHeader.appendChild(refChevron);
      var refBody = el('div', {
        style: { maxHeight: '0', overflow: 'hidden', transition: 'max-height 0.4s ease' },
      });

      refHeader.addEventListener('click', function () {
        refExpanded.v = !refExpanded.v;
        refChevron.style.transform = refExpanded.v ? 'rotate(180deg)' : 'rotate(0deg)';
        refBody.style.maxHeight = refExpanded.v ? '2000px' : '0';
        refBody.style.borderTop = refExpanded.v ? '1px solid ' + t.border : 'none';
      });

      var refContent = el('div', { style: { padding: '12px 16px' } });
      var refGroups = [
        { title: 'Статусы тендеров', items: refs.tender_statuses || ['Новый', 'В работе', 'Подано', 'Выиграно', 'Проиграно', 'Отменён'] },
        { title: 'Категории расходов', items: refs.expense_categories || ['ФОТ', 'Командировка', 'Материалы', 'Оборудование', 'Логистика', 'Офис'] },
        { title: 'Типы документов', items: refs.doc_types || ['Договор', 'Счёт', 'Акт', 'ТКП', 'Справка', 'Допуск'] },
      ];
      refGroups.forEach(function (g) {
        refContent.appendChild(el('div', {
          style: { ...DS.font('sm'), color: t.textSec, fontWeight: 600, marginBottom: '6px', marginTop: '12px' },
          textContent: g.title,
        }));
        var pillWrap = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
        (g.items || []).forEach(function (item) {
          pillWrap.appendChild(M.Badge({ text: typeof item === 'string' ? item : item.name || item.label || '', color: 'neutral' }));
        });
        refContent.appendChild(pillWrap);
      });
      refBody.appendChild(refContent);
      refSection.appendChild(refHeader);
      refSection.appendChild(refBody);
      container.appendChild(refSection);
    }

    function saveSectionSettings(key, data) {
      API.fetch('/settings/' + key, {
        method: 'PUT',
        body: data,
      }).then(function () {
        M.Toast({ message: 'Настройки сохранены', type: 'success' });
      }).catch(function () {
        M.Toast({ message: 'Ошибка сохранения', type: 'error' });
      });
    }

    return page;
  },
};

Router.register('/settings', SettingsPage);
