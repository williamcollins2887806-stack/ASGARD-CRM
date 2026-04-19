/**
 * ASGARD Field — Report Page (master only)
 * Dynamic form from report template fields
 */
(() => {
'use strict';
const el = Utils.el;

const REPORT_QUOTES = [
  '\uD83D\uDCDC \u041E\u0442\u0447\u0451\u0442 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D \u2014 \u0441\u043A\u0430\u043B\u044C\u0434\u044B \u0437\u0430\u043F\u043E\u043C\u043D\u044F\u0442 \u044D\u0442\u043E\u0442 \u0434\u0435\u043D\u044C!',
  '\uD83D\uDCDC \u041A\u043E\u043C\u0430\u043D\u0434\u0438\u0440 \u043F\u043E\u043B\u0443\u0447\u0438\u043B \u0434\u043E\u043D\u0435\u0441\u0435\u043D\u0438\u0435. \u0425\u043E\u0440\u043E\u0448\u0430\u044F \u0440\u0430\u0431\u043E\u0442\u0430!',
  '\uD83D\uDCDC \u0425\u0440\u043E\u043D\u0438\u043A\u0430 \u0431\u0438\u0442\u0432\u044B \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u0430. \u0420\u041F \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0451\u043D',
];

const ReportPage = {
  render() {
    const t = DS.t;
    const page = el('div', { className: 'field-page field-report' });

    page.appendChild(F.Header({ title: '\u0414\u043D\u0435\u0432\u043D\u043E\u0439 \u043E\u0442\u0447\u0451\u0442', logo: true, back: true }));

    const content = el('div', { style: { padding: '16px 20px 100px', display: 'flex', flexDirection: 'column', gap: '16px' } });
    content.appendChild(F.Skeleton({ type: 'card', count: 3 }));
    page.appendChild(content);

    setTimeout(() => loadReport(content), 0);
    return page;
  }
};

async function loadReport(content) {
  const t = DS.t;
  const project = await API.fetch('/worker/active-project');

  if (!project || !project.project) {
    content.replaceChildren(F.Empty({ text: '\u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u043F\u0440\u043E\u0435\u043A\u0442\u0430', icon: '\uD83D\uDCDD' }));
    return;
  }

  const workId = project.project.work_id || project.project.id;
  const tmpl = await API.fetch('/reports/template/' + workId);

  content.replaceChildren();

  const template = tmpl?.template || tmpl;
  const fields = template?.fields || [];

  // Date & shift header
  const today = new Date().toISOString().split('T')[0];
  const dateCard = el('div', {
    style: { background: t.surface, borderRadius: '14px', padding: '14px 16px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease both' },
  });
  dateCard.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.75rem', fontWeight: '600', marginBottom: '4px' } },
    '\u041E\u0442\u0447\u0451\u0442 \u0437\u0430 ' + Utils.todayStr()));
  if (template?.name) {
    dateCard.appendChild(el('div', { style: { color: t.text, fontSize: '0.9375rem', fontWeight: '500' } }, template.name));
  }
  content.appendChild(dateCard);

  // Form
  const formData = {};
  const formCard = el('div', {
    style: { background: t.surface, borderRadius: '16px', padding: '16px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease 0.1s both' },
  });

  if (fields.length) {
    for (const field of fields) {
      const fieldWrap = el('div', { style: { marginBottom: '14px' } });

      // Label
      const label = el('div', { style: { color: t.textSec, fontSize: '0.75rem', fontWeight: '600', marginBottom: '6px' } },
        field.label + (field.required ? ' *' : ''));
      fieldWrap.appendChild(label);

      if (field.type === 'select' && field.options) {
        // Pill buttons
        const pills = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } });
        for (const opt of field.options) {
          const pill = el('button', {
            style: {
              padding: '8px 16px', borderRadius: '9999px',
              border: '1px solid ' + t.border, background: t.bg2,
              color: t.textSec, fontSize: '0.875rem', cursor: 'pointer',
              transition: 'all 0.15s',
            },
            onClick: () => {
              formData[field.key] = opt;
              // Update pill styles
              pills.querySelectorAll('button').forEach(b => {
                b.style.background = t.bg2;
                b.style.color = t.textSec;
                b.style.borderColor = t.border;
              });
              pill.style.background = t.gold + '20';
              pill.style.color = t.gold;
              pill.style.borderColor = t.gold;
            },
          }, opt);
          pills.appendChild(pill);
        }
        fieldWrap.appendChild(pills);

      } else if (field.type === 'number') {
        // Number input with +/- buttons
        const numRow = el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } });

        const minusBtn = el('button', {
          style: {
            width: '44px', height: '44px', borderRadius: '12px', border: '1px solid ' + t.border,
            background: t.bg2, color: t.text, fontSize: '1.25rem', fontWeight: '700', cursor: 'pointer',
          },
        }, '\u2212');

        const numInput = el('input', {
          type: 'number', value: '0', min: '0',
          style: {
            flex: '1', height: '44px', textAlign: 'center', fontSize: '1.25rem', fontWeight: '600',
            background: t.bg2, border: '1px solid ' + t.border, borderRadius: '12px',
            color: t.text, outline: 'none',
          },
        });

        const plusBtn = el('button', {
          style: {
            width: '44px', height: '44px', borderRadius: '12px', border: '1px solid ' + t.border,
            background: t.bg2, color: t.text, fontSize: '1.25rem', fontWeight: '700', cursor: 'pointer',
          },
        }, '+');

        minusBtn.addEventListener('click', () => {
          const v = Math.max(0, (parseInt(numInput.value) || 0) - 1);
          numInput.value = v;
          formData[field.key] = v;
          Utils.vibrate(20);
        });
        plusBtn.addEventListener('click', () => {
          const v = (parseInt(numInput.value) || 0) + 1;
          numInput.value = v;
          formData[field.key] = v;
          Utils.vibrate(20);
        });
        numInput.addEventListener('input', () => { formData[field.key] = parseInt(numInput.value) || 0; });

        numRow.appendChild(minusBtn);
        numRow.appendChild(numInput);
        numRow.appendChild(plusBtn);
        fieldWrap.appendChild(numRow);

      } else {
        // Text input / textarea
        const isLong = field.key === 'notes' || field.type === 'textarea';
        const input = el(isLong ? 'textarea' : 'input', {
          type: 'text',
          placeholder: field.label + '...',
          style: {
            width: '100%', padding: '12px', borderRadius: '12px',
            border: '1px solid ' + t.border, background: t.bg2,
            color: t.text, fontSize: '0.9375rem', boxSizing: 'border-box',
            minHeight: isLong ? '80px' : 'auto', resize: isLong ? 'vertical' : 'none',
            outline: 'none',
          },
        });
        input.addEventListener('input', () => { formData[field.key] = input.value; });
        input.addEventListener('focus', () => { input.style.borderColor = t.gold; });
        input.addEventListener('blur', () => { input.style.borderColor = t.border; });
        fieldWrap.appendChild(input);
      }

      formCard.appendChild(fieldWrap);
    }
  } else {
    // No template — generic notes field
    const textarea = el('textarea', {
      placeholder: '\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u043D\u044B\u0435 \u0440\u0430\u0431\u043E\u0442\u044B...',
      style: {
        width: '100%', padding: '14px', borderRadius: '12px',
        border: '1px solid ' + t.border, background: t.bg2,
        color: t.text, fontSize: '0.9375rem', minHeight: '120px',
        boxSizing: 'border-box', resize: 'vertical', outline: 'none',
      },
    });
    textarea.addEventListener('input', () => { formData.notes = textarea.value; });
    formCard.appendChild(textarea);
  }

  // Downtime
  const dtWrap = el('div', { style: { marginTop: '8px', borderTop: '1px solid ' + t.border, paddingTop: '12px' } });
  dtWrap.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.75rem', fontWeight: '600', marginBottom: '6px' } }, '\u041F\u0440\u043E\u0441\u0442\u043E\u0439 (\u043C\u0438\u043D\u0443\u0442\u044B)'));
  const dtInput = el('input', {
    type: 'number', value: '0', min: '0',
    style: {
      width: '100%', padding: '12px', borderRadius: '12px',
      border: '1px solid ' + t.border, background: t.bg2,
      color: t.text, fontSize: '0.9375rem', boxSizing: 'border-box', outline: 'none',
    },
  });
  dtWrap.appendChild(dtInput);
  const dtReason = el('input', {
    type: 'text', placeholder: '\u041F\u0440\u0438\u0447\u0438\u043D\u0430 \u043F\u0440\u043E\u0441\u0442\u043E\u044F...',
    style: {
      width: '100%', padding: '12px', borderRadius: '12px', marginTop: '8px',
      border: '1px solid ' + t.border, background: t.bg2,
      color: t.text, fontSize: '0.875rem', boxSizing: 'border-box', outline: 'none',
    },
  });
  dtWrap.appendChild(dtReason);
  formCard.appendChild(dtWrap);

  content.appendChild(formCard);

  // Error
  const errorEl = el('div', { style: { color: t.red, fontSize: '0.8125rem', minHeight: '18px', textAlign: 'center' } });
  content.appendChild(errorEl);

  // Action buttons
  const btns = el('div', {
    style: { display: 'flex', flexDirection: 'column', gap: '10px', animation: 'fieldSlideUp 0.4s ease 0.2s both' },
  });

  btns.appendChild(F.BigButton({
    label: '\u041E\u0422\u041F\u0420\u0410\u0412\u0418\u0422\u042C \u0420\u041F',
    icon: '\uD83D\uDCE4',
    variant: 'gold',
    onClick: async () => {
      // Validate required fields
      for (const field of fields) {
        if (field.required && !formData[field.key]) {
          errorEl.textContent = '\u0417\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0435 \u043F\u043E\u043B\u0435 "' + field.label + '"';
          return;
        }
      }

      const body = {
        work_id: workId,
        date: today,
        shift: 'day',
        report_data: formData,
        downtime_minutes: parseInt(dtInput.value) || 0,
        downtime_reason: dtReason.value || null,
      };

      const resp = await API.post('/reports/', body);
      if (resp && resp._ok) {
        Utils.vibrate(100);
        F.Toast({
          message: REPORT_QUOTES[Math.floor(Math.random() * REPORT_QUOTES.length)],
          type: 'success', duration: 4000,
        });
        Router.navigate('/field/home');
      } else {
        errorEl.textContent = resp?.error || '\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438';
      }
    },
  }));

  content.appendChild(btns);

  // Previous reports
  const prev = await API.fetch('/reports/?work_id=' + workId + '&limit=5');
  const reports = prev?.reports || (Array.isArray(prev) ? prev : []);

  if (reports.length) {
    const histCard = el('div', {
      style: { background: t.surface, borderRadius: '16px', padding: '14px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease 0.3s both' },
    });
    histCard.appendChild(el('div', {
      style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' },
    }, '\u041F\u0420\u0415\u0414\u042B\u0414\u0423\u0429\u0418\u0415 \u041E\u0422\u0427\u0401\u0422\u042B'));

    for (const r of reports) {
      const row = el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid ' + t.borderLight } });
      row.appendChild(el('span', { style: { color: t.text, fontSize: '0.8125rem' } }, Utils.formatDate(r.date)));
      const statusColor = r.status === 'accepted' ? t.green : r.status === 'submitted' ? t.blue : t.textSec;
      row.appendChild(F.StatusBadge({ text: r.status === 'accepted' ? '\u041F\u0440\u0438\u043D\u044F\u0442' : r.status === 'submitted' ? '\u041E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D' : '\u0427\u0435\u0440\u043D\u043E\u0432\u0438\u043A', color: statusColor }));
      histCard.appendChild(row);
    }
    content.appendChild(histCard);
  }
}

Router.register('/field/report', ReportPage);
})();
