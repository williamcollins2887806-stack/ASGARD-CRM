/**
 * ASGARD Field — Incidents Page (master only)
 * Report incidents: type, description, severity
 */
(() => {
'use strict';
const el = Utils.el;

const INCIDENT_TYPES = [
  { value: 'no_material',       label: '\u041D\u0435\u0442 \u043C\u0430\u0442\u0435\u0440\u0438\u0430\u043B\u0430',      icon: '\uD83D\uDCE6' },
  { value: 'equipment_failure', label: '\u041F\u043E\u043B\u043E\u043C\u043A\u0430 \u043E\u0431\u043E\u0440\u0443\u0434.',  icon: '\uD83D\uDD27' },
  { value: 'weather',           label: '\u041F\u043E\u0433\u043E\u0434\u0430',            icon: '\uD83C\uDF27\uFE0F' },
  { value: 'no_permit',         label: '\u041D\u0435\u0442 \u0434\u043E\u043F\u0443\u0441\u043A\u0430',        icon: '\uD83D\uDEAB' },
  { value: 'injury',            label: '\u0422\u0440\u0430\u0432\u043C\u0430',             icon: '\uD83E\uDE79' },
  { value: 'quality_issue',     label: '\u0411\u0440\u0430\u043A',               icon: '\u26A0\uFE0F' },
  { value: 'other',             label: '\u0414\u0440\u0443\u0433\u043E\u0435',             icon: '\uD83D\uDCCB' },
];

const SEVERITY_LEVELS = [
  { value: 'low',      label: '\u041D\u0438\u0437\u043A\u0438\u0439',   color: null },
  { value: 'medium',   label: '\u0421\u0440\u0435\u0434\u043D\u0438\u0439',  color: null },
  { value: 'high',     label: '\u0412\u044B\u0441\u043E\u043A\u0438\u0439',  color: null },
  { value: 'critical', label: '\u041A\u0440\u0438\u0442\u0438\u0447\u043D\u044B\u0439', color: null },
];

const IncidentsPage = {
  render() {
    const t = DS.t;
    const page = el('div', { className: 'field-page field-incidents' });

    page.appendChild(F.Header({ title: '\u0418\u043D\u0446\u0438\u0434\u0435\u043D\u0442', logo: true, back: true }));

    const content = el('div', { style: { padding: '16px 20px 100px', display: 'flex', flexDirection: 'column', gap: '16px' } });
    page.appendChild(content);

    buildIncidentForm(content, t);
    return page;
  }
};

async function buildIncidentForm(content, t) {
  const project = await API.fetch('/worker/active-project');
  const workId = project?.project?.work_id || project?.project?.id;

  if (!workId) {
    content.appendChild(F.Empty({ text: '\u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u043F\u0440\u043E\u0435\u043A\u0442\u0430', icon: '\u26A0\uFE0F' }));
    return;
  }

  const formState = { incident_type: null, severity: 'medium', description: '' };

  // Type selection
  const typeCard = el('div', {
    style: { background: t.surface, borderRadius: '16px', padding: '16px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease both' },
  });
  typeCard.appendChild(el('div', {
    style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' },
  }, '\u0422\u0418\u041F \u0418\u041D\u0426\u0418\u0414\u0415\u041D\u0422\u0410'));

  const typeGrid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' } });
  const typeBtns = [];

  for (const type of INCIDENT_TYPES) {
    const btn = el('button', {
      style: {
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
        padding: '12px 4px', borderRadius: '12px',
        border: '1px solid ' + t.border, background: t.bg2,
        color: t.textSec, cursor: 'pointer', transition: 'all 0.15s',
      },
      onClick: () => {
        formState.incident_type = type.value;
        typeBtns.forEach(b => {
          b.style.background = t.bg2;
          b.style.borderColor = t.border;
          b.style.color = t.textSec;
        });
        btn.style.background = t.red + '15';
        btn.style.borderColor = t.red;
        btn.style.color = t.red;
        Utils.vibrate(20);
      },
    });
    btn.appendChild(el('span', { style: { fontSize: '1.25rem' } }, type.icon));
    btn.appendChild(el('span', { style: { fontSize: '0.5625rem', fontWeight: '600', textAlign: 'center' } }, type.label));
    typeBtns.push(btn);
    typeGrid.appendChild(btn);
  }
  typeCard.appendChild(typeGrid);
  content.appendChild(typeCard);

  // Severity
  const sevCard = el('div', {
    style: { background: t.surface, borderRadius: '16px', padding: '16px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease 0.1s both' },
  });
  sevCard.appendChild(el('div', {
    style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' },
  }, '\u0421\u0422\u0415\u041F\u0415\u041D\u042C \u0422\u042F\u0416\u0415\u0421\u0422\u0418'));

  const sevRow = el('div', { style: { display: 'flex', gap: '8px' } });
  const sevBtns = [];
  const sevColors = { low: t.green, medium: t.orange, high: t.red, critical: '#FF1744' };

  for (const sev of SEVERITY_LEVELS) {
    const color = sevColors[sev.value];
    const isActive = sev.value === 'medium';
    const btn = el('button', {
      style: {
        flex: '1', padding: '10px 8px', borderRadius: '12px',
        border: '1px solid ' + (isActive ? color : t.border),
        background: isActive ? color + '15' : t.bg2,
        color: isActive ? color : t.textSec,
        fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.15s',
      },
      onClick: () => {
        formState.severity = sev.value;
        sevBtns.forEach(b => {
          b.style.background = t.bg2;
          b.style.borderColor = t.border;
          b.style.color = t.textSec;
        });
        btn.style.background = color + '15';
        btn.style.borderColor = color;
        btn.style.color = color;
      },
    }, sev.label);
    sevBtns.push(btn);
    sevRow.appendChild(btn);
  }
  sevCard.appendChild(sevRow);
  content.appendChild(sevCard);

  // Description
  const descCard = el('div', {
    style: { background: t.surface, borderRadius: '16px', padding: '16px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease 0.2s both' },
  });
  descCard.appendChild(el('div', {
    style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' },
  }, '\u041E\u041F\u0418\u0421\u0410\u041D\u0418\u0415 *'));

  const textarea = el('textarea', {
    placeholder: '\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0438\u043D\u0446\u0438\u0434\u0435\u043D\u0442...',
    style: {
      width: '100%', padding: '14px', borderRadius: '12px',
      border: '1px solid ' + t.border, background: t.bg2,
      color: t.text, fontSize: '0.9375rem', minHeight: '100px',
      boxSizing: 'border-box', resize: 'vertical', outline: 'none',
    },
  });
  textarea.addEventListener('input', () => { formState.description = textarea.value; });
  textarea.addEventListener('focus', () => { textarea.style.borderColor = t.gold; });
  textarea.addEventListener('blur', () => { textarea.style.borderColor = t.border; });
  descCard.appendChild(textarea);
  content.appendChild(descCard);

  // Error
  const errorEl = el('div', { style: { color: t.red, fontSize: '0.8125rem', minHeight: '18px', textAlign: 'center' } });
  content.appendChild(errorEl);

  // Submit
  content.appendChild(el('div', { style: { animation: 'fieldSlideUp 0.4s ease 0.3s both' } },
    F.BigButton({
      label: '\u041E\u0422\u041F\u0420\u0410\u0412\u0418\u0422\u042C \u0421\u0418\u0413\u041D\u0410\u041B',
      icon: '\u26A0\uFE0F',
      variant: 'red',
      onClick: async () => {
        if (!formState.incident_type) {
          errorEl.textContent = '\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u0438\u043F \u0438\u043D\u0446\u0438\u0434\u0435\u043D\u0442\u0430';
          return;
        }
        if (!formState.description.trim()) {
          errorEl.textContent = '\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0438\u043D\u0446\u0438\u0434\u0435\u043D\u0442';
          return;
        }

        const resp = await API.post('/reports/incidents', {
          work_id: workId,
          incident_type: formState.incident_type,
          description: formState.description,
          severity: formState.severity,
          started_at: new Date().toISOString(),
        });

        if (resp && resp._ok) {
          Utils.vibrate(100);
          F.Toast({ message: '\u26A0\uFE0F \u0421\u0438\u0433\u043D\u0430\u043B \u0442\u0440\u0435\u0432\u043E\u0433\u0438 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D \u043A\u043E\u043C\u0430\u043D\u0434\u0438\u0440\u0443', type: 'warning', duration: 4000 });
          Router.navigate('/field/home');
        } else {
          errorEl.textContent = resp?.error || '\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438';
        }
      },
    })
  ));

  // Previous incidents
  const prev = await API.fetch('/reports/incidents?work_id=' + workId);
  const incidents = prev?.incidents || (Array.isArray(prev) ? prev : []);

  if (incidents.length) {
    const histCard = el('div', {
      style: { background: t.surface, borderRadius: '16px', padding: '14px', border: '1px solid ' + t.border, animation: 'fieldSlideUp 0.4s ease 0.4s both' },
    });
    histCard.appendChild(el('div', {
      style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' },
    }, '\u041F\u0420\u0415\u0414\u042B\u0414\u0423\u0429\u0418\u0415 \u0418\u041D\u0426\u0418\u0414\u0415\u041D\u0422\u042B'));

    for (const inc of incidents.slice(0, 5)) {
      const typeInfo = INCIDENT_TYPES.find(t => t.value === inc.incident_type) || { icon: '\u26A0\uFE0F', label: inc.incident_type };
      const row = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid ' + t.borderLight } });
      row.appendChild(el('span', { style: { fontSize: '1rem' } }, typeInfo.icon));
      const info = el('div', { style: { flex: '1' } });
      info.appendChild(el('div', { style: { color: t.text, fontSize: '0.8125rem' } }, inc.description?.slice(0, 60) || typeInfo.label));
      info.appendChild(el('div', { style: { color: t.textTer, fontSize: '0.6875rem' } }, Utils.formatDate(inc.created_at)));
      row.appendChild(info);
      const sevColor = sevColors[inc.severity] || t.textSec;
      row.appendChild(F.StatusBadge({ text: inc.severity, color: sevColor }));
      histCard.appendChild(row);
    }
    content.appendChild(histCard);
  }
}

Router.register('/field/incidents', IncidentsPage);
})();
