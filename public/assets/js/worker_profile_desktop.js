/**
 * ASGARD CRM — Desktop Worker Profile (Анкета-характеристика)
 * Модалка 720px, 2 колонки, view/edit/print
 * v2 — точечный DOM update, fade transitions, dirty flag, skeleton
 */
window.WorkerProfileDesktop = (function () {
  'use strict';
  const { esc, showModal, hideModal, toast } = AsgardUI;

  /* ── PROFILE_SCHEMA (дубль из мобилки) ── */
  const PROFILE_SCHEMA = {
    sections: [
      {
        id: 'work', icon: '\u2692\uFE0F', title: 'Рабочие качества',
        fields: [
          { id: 'experience', label: 'Опыт мех. чистки', type: 'radio', hasComment: true, options: [
            { value: 'none', label: 'Нет опыта', color: 'neutral' },
            { value: 'junior', label: '1-2 объекта', color: 'warning' },
            { value: 'experienced', label: 'Опытный', color: 'success' },
            { value: 'expert', label: 'Эксперт', color: 'gold' }
          ]},
          { id: 'speed', label: 'Скорость работы', type: 'radio', hasComment: true, options: [
            { value: 'slow', label: 'Медленный', color: 'danger' },
            { value: 'medium', label: 'Средний', color: 'warning' },
            { value: 'fast', label: 'Быстрый', color: 'success' },
            { value: 'rushing', label: 'Гонит', color: 'danger' }
          ]},
          { id: 'quality', label: 'Качество работы', type: 'radio', hasComment: true, options: [
            { value: 'poor', label: 'Халтурит', color: 'danger' },
            { value: 'normal', label: 'Нормально', color: 'neutral' },
            { value: 'careful', label: 'Аккуратный', color: 'success' },
            { value: 'perfectionist', label: 'Перфекционист', color: 'gold' }
          ]},
          { id: 'independence', label: 'Самостоятельность', type: 'radio', hasComment: true, options: [
            { value: 'needs_control', label: 'Нужен контроль', color: 'danger' },
            { value: 'independent', label: 'Справляется сам', color: 'success' },
            { value: 'can_lead', label: 'Доверить бригаду', color: 'gold' }
          ]},
          { id: 'discipline', label: 'Дисциплина', type: 'radio', hasComment: true, options: [
            { value: 'problematic', label: 'Проблемный', color: 'danger' },
            { value: 'sometimes', label: 'Бывает', color: 'warning' },
            { value: 'normal', label: 'Нормальный', color: 'neutral' },
            { value: 'exemplary', label: 'Образцовый', color: 'success' }
          ]},
          { id: 'endurance', label: 'Физ. выносливость', type: 'radio', hasComment: true, options: [
            { value: 'weak', label: 'Слабый', color: 'danger' },
            { value: 'medium', label: 'Средний', color: 'warning' },
            { value: 'strong', label: 'Выносливый', color: 'success' },
            { value: 'health_issues', label: 'Здоровье \u2757', color: 'danger' }
          ]},
          { id: 'learning', label: 'Обучаемость', type: 'radio', hasComment: true, options: [
            { value: 'hard', label: 'Тяжело', color: 'danger' },
            { value: 'normal', label: 'Нормально', color: 'neutral' },
            { value: 'fast', label: 'Быстро', color: 'success' }
          ]}
        ]
      },
      {
        id: 'character', icon: '\uD83E\uDDE0', title: 'Характер и поведение',
        fields: [
          { id: 'alcohol', label: 'Алкоголь', type: 'radio', important: true, hasComment: true, options: [
            { value: 'none', label: 'Не пьёт', color: 'success' },
            { value: 'moderate', label: 'В меру', color: 'neutral' },
            { value: 'prone', label: 'Склонен', color: 'warning' },
            { value: 'problem', label: 'Проблема', color: 'danger' }
          ]},
          { id: 'conflict', label: 'Конфликтность', type: 'radio', hasComment: true, options: [
            { value: 'peaceful', label: 'Миролюбивый', color: 'success' },
            { value: 'sometimes', label: 'Бывает', color: 'warning' },
            { value: 'conflicting', label: 'Конфликтный', color: 'danger' },
            { value: 'provocateur', label: 'Провокатор', color: 'danger' }
          ]},
          { id: 'team', label: 'В коллективе', type: 'radio', hasComment: true, options: [
            { value: 'quiet', label: 'Одиночка', color: 'neutral' },
            { value: 'social', label: 'Общительный', color: 'success' },
            { value: 'leader', label: 'Лидер', color: 'gold' },
            { value: 'toxic', label: 'Токсичный', color: 'danger' }
          ]},
          { id: 'reliability', label: 'Ответственность', type: 'radio', hasComment: true, options: [
            { value: 'unreliable', label: 'Ненадёжный', color: 'danger' },
            { value: 'normal', label: 'Нормальный', color: 'neutral' },
            { value: 'reliable', label: 'Надёжный', color: 'success' },
            { value: 'rock', label: 'Скала', color: 'gold' }
          ]},
          { id: 'smoking', label: 'Курение', type: 'radio', hasComment: true, options: [
            { value: 'no', label: 'Не курит', color: 'success' },
            { value: 'yes', label: 'Курит', color: 'neutral' },
            { value: 'heavy', label: 'Много', color: 'warning' }
          ]},
          { id: 'hygiene', label: 'Чистоплотность', type: 'radio', hasComment: true, options: [
            { value: 'dirty', label: 'Грязнуля', color: 'danger' },
            { value: 'normal', label: 'Нормально', color: 'neutral' },
            { value: 'clean', label: 'Чистюля', color: 'success' }
          ]},
          { id: 'snoring', label: 'Храп', type: 'radio', hasComment: true, options: [
            { value: 'no', label: 'Нет', color: 'success' },
            { value: 'light', label: 'Немного', color: 'neutral' },
            { value: 'heavy', label: 'Сильно', color: 'danger' },
            { value: 'unknown', label: '\u2753', color: 'neutral' }
          ]}
        ]
      },
      {
        id: 'housing', icon: '\uD83C\uDFE0', title: 'Смены и проживание',
        fields: [
          { id: 'preferred_shift', label: 'Лучше ставить в смену', type: 'radio', options: [
            { value: 'day', label: 'День', color: 'neutral' },
            { value: 'night', label: 'Ночь', color: 'neutral' },
            { value: 'any', label: 'Без разницы', color: 'neutral' }
          ]},
          { id: 'shift_reason', label: 'Почему эту смену', type: 'text' },
          { id: 'good_roommates', label: '\u2705 С кем ХОРОШО селить', type: 'textarea' },
          { id: 'bad_roommates', label: '\uD83D\uDEAB С кем НЕЛЬЗЯ селить', type: 'textarea', important: true },
          { id: 'bad_shift_partners', label: '\uD83D\uDEAB С кем НЕЛЬЗЯ в одну смену', type: 'textarea', important: true },
          { id: 'health', label: '\uD83C\uDFE5 Здоровье', type: 'textarea' },
          { id: 'family', label: '\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67 Семья', type: 'textarea' },
          { id: 'religion_food', label: '\uD83D\uDD4C Религия / питание', type: 'textarea' }
        ]
      },
      {
        id: 'summary', icon: '\u2B50', title: 'Итоговая оценка',
        fields: [
          { id: 'overall_score', label: 'Общая оценка', type: 'score', options: [
            { value: 1, label: 'Не брать', emoji: '\uD83D\uDEAB', color: 'danger' },
            { value: 2, label: 'Слабый', emoji: '\uD83D\uDE10', color: 'warning' },
            { value: 3, label: 'Норм', emoji: '\uD83D\uDC4D', color: 'neutral' },
            { value: 4, label: 'Хороший', emoji: '\uD83D\uDCAA', color: 'success' },
            { value: 5, label: 'Лучший', emoji: '\uD83C\uDFC6', color: 'gold' }
          ]},
          { id: 'recommended_role', label: 'Рекомендуемая роль', type: 'multi', options: [
            { value: 'operator', label: '\u2699\uFE0F Оператор' },
            { value: 'observer', label: '\uD83D\uDC41\uFE0F Наблюдающий' },
            { value: 'hvd', label: '\uD83D\uDCA7 НВД' },
            { value: 'helper', label: '\uD83D\uDD27 Подсобный' },
            { value: 'foreman', label: '\uD83D\uDC77 Мастер' }
          ]},
          { id: 'warning', label: '\u26A0\uFE0F Предупреждение', type: 'textarea', important: true },
          { id: 'strength', label: '\uD83D\uDC8E Главный плюс', type: 'textarea' }
        ]
      }
    ]
  };

  const WP_COLORS = {
    danger:  { bg: 'rgba(255,68,68,0.15)',  text: '#ff4444' },
    warning: { bg: 'rgba(255,140,0,0.15)',   text: '#ff8c00' },
    neutral: { bg: 'rgba(128,128,128,0.15)', text: null },
    success: { bg: 'rgba(81,207,102,0.15)',  text: '#51cf66' },
    gold:    { bg: 'rgba(255,215,0,0.15)',   text: '#ffd700' }
  };

  const SCORE_LABELS_TEXT = { 1: 'Не брать', 2: 'Слабый', 3: 'Норм', 4: 'Хороший', 5: 'Лучший' };
  const ROLE_LABELS = { operator: '\u2699\uFE0F Оператор', observer: '\uD83D\uDC41\uFE0F Наблюдающий', hvd: '\uD83D\uDCA7 НВД', helper: '\uD83D\uDD27 Подсобный', foreman: '\uD83D\uDC77 Мастер' };

  /* ── helpers ── */
  function getToken() { return localStorage.getItem('asgard_token') || ''; }

  function authHeaders(json) {
    const h = { 'Authorization': 'Bearer ' + getToken() };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async function apiFetch(path) {
    const r = await fetch('/api' + path, { headers: authHeaders() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function apiPut(path, body) {
    const r = await fetch('/api' + path, {
      method: 'PUT',
      headers: authHeaders(true),
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  function countFilled(data) {
    let filled = 0, total = 0;
    PROFILE_SCHEMA.sections.forEach(sec => {
      sec.fields.forEach(f => {
        total++;
        const val = data[f.id];
        if (f.type === 'multi') { if (Array.isArray(val) && val.length > 0) filled++; }
        else if (f.type === 'score') { if (val && val > 0) filled++; }
        else { if (val !== undefined && val !== null && val !== '') filled++; }
      });
    });
    return { filled, total };
  }

  function getScoreColor(s) {
    if (s >= 5) return '#ffd700';
    if (s >= 4) return '#51cf66';
    if (s >= 3) return '#94a3b8';
    if (s >= 2) return '#ff8c00';
    return '#ff4444';
  }

  function badgeHtml(label, colorKey) {
    const c = WP_COLORS[colorKey] || WP_COLORS.neutral;
    const textCol = c.text || 'var(--t2)';
    return `<span class="wp-desktop-badge" style="background:${c.bg};color:${textCol}">${esc(label)}</span>`;
  }

  /* SVG ring gauge — proper createElementNS */
  function createRingGauge(score, size, strokeW) {
    const ns = 'http://www.w3.org/2000/svg';
    const r = (size - strokeW) / 2;
    const circ = 2 * Math.PI * r;
    const fill = score > 0 ? score / 5 : 0;
    const offset = circ * (1 - fill);
    const col = getScoreColor(score);
    const lbl = SCORE_LABELS_TEXT[score] || '\u2014';

    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    if (score > 0) svg.style.filter = 'drop-shadow(0 0 6px ' + col + ')';

    const bgCirc = document.createElementNS(ns, 'circle');
    bgCirc.setAttribute('cx', size / 2);
    bgCirc.setAttribute('cy', size / 2);
    bgCirc.setAttribute('r', r);
    bgCirc.setAttribute('fill', 'none');
    bgCirc.setAttribute('stroke', 'rgba(255,255,255,0.1)');
    bgCirc.setAttribute('stroke-width', strokeW);
    svg.appendChild(bgCirc);

    const fgCirc = document.createElementNS(ns, 'circle');
    fgCirc.setAttribute('cx', size / 2);
    fgCirc.setAttribute('cy', size / 2);
    fgCirc.setAttribute('r', r);
    fgCirc.setAttribute('fill', 'none');
    fgCirc.setAttribute('stroke', col);
    fgCirc.setAttribute('stroke-width', strokeW);
    fgCirc.setAttribute('stroke-linecap', 'round');
    fgCirc.setAttribute('stroke-dasharray', circ);
    fgCirc.setAttribute('stroke-dashoffset', offset);
    fgCirc.setAttribute('transform', 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')');
    fgCirc.style.transition = 'stroke-dashoffset 0.6s ease';
    svg.appendChild(fgCirc);

    const txt1 = document.createElementNS(ns, 'text');
    txt1.setAttribute('x', size / 2);
    txt1.setAttribute('y', size / 2 - 4);
    txt1.setAttribute('text-anchor', 'middle');
    txt1.setAttribute('fill', col);
    txt1.setAttribute('font-size', '18');
    txt1.setAttribute('font-weight', '800');
    txt1.textContent = score || '\u2014';
    svg.appendChild(txt1);

    const txt2 = document.createElementNS(ns, 'text');
    txt2.setAttribute('x', size / 2);
    txt2.setAttribute('y', size / 2 + 12);
    txt2.setAttribute('text-anchor', 'middle');
    txt2.setAttribute('fill', 'rgba(255,255,255,0.6)');
    txt2.setAttribute('font-size', '9');
    txt2.textContent = lbl;
    svg.appendChild(txt2);

    return svg;
  }

  /* Rune SVG instead of unicode */
  function runeSvg() {
    return `<svg class="wp-desktop-hero-rune" width="72" height="90" viewBox="0 0 72 90" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M36 5L36 85M36 5L56 30M36 5L16 30M36 45L56 30M36 45L16 30" stroke="rgba(255,255,255,0.06)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  /* Section layout: work+housing → left, character+summary → right */
  const LEFT_SECTIONS = ['work', 'housing'];
  const RIGHT_SECTIONS = ['character', 'summary'];

  /* Skeleton HTML */
  function skeletonHtml() {
    let rows = '';
    for (let i = 0; i < 8; i++) {
      const w = 40 + Math.random() * 40;
      rows += `<div class="wp-desktop-skel-row"><div class="wp-desktop-skel-label"></div><div class="wp-desktop-skel-value" style="width:${w}%"></div></div>`;
    }
    return `<div class="wp-desktop-skeleton">
      <div class="wp-desktop-skel-hero"></div>
      <div class="wp-desktop-grid" style="padding:24px">
        <div class="wp-desktop-col">${rows}</div>
        <div class="wp-desktop-col">${rows}</div>
      </div>
    </div>`;
  }

  /* fade transition helper */
  function fadeTransition(root, renderFn) {
    root.style.transition = 'opacity 0.2s ease';
    root.style.opacity = '0';
    setTimeout(() => {
      renderFn();
      root.style.opacity = '1';
    }, 200);
  }

  /* Check if editData differs from original */
  function isDirty(editData, originalJson) {
    return JSON.stringify(editData) !== originalJson;
  }

  /* ══════════════════════════════════════════════════════════
     OPEN — главная функция
     ══════════════════════════════════════════════════════════ */
  async function open(userId) {
    if (!userId) { toast('Ошибка', 'Нет userId', 'err'); return; }

    let profile = null;
    let userData = null;
    let editMode = false;
    let editData = {};
    let originalJson = '{}';
    let photoUrl = null;
    let photoFile = null;
    let currentProject = '';

    /* Show modal with skeleton immediately */
    showModal({
      title: 'Анкета-характеристика',
      html: '<div id="wpDesktopRoot" class="wp-desktop-root">' + skeletonHtml() + '</div>',
      onMount: function (ctx) {
        ctx.modal.classList.add('wp-desktop-modal-size');
        loadData();
      }
    });

    async function loadData() {
      try {
        const resp = await apiFetch('/worker-profiles/' + userId);
        profile = resp.profile;
        userData = resp.user || (profile ? { id: profile.user_id, name: profile.user_name, avatar_url: profile.user_avatar, role: profile.user_role } : null);
        photoUrl = profile ? profile.photo_url : null;

        /* Try to get current project from employee assignments */
        try {
          if (window.AsgardDB) {
            const assigns = await AsgardDB.byIndex('employee_assignments', 'employee_id', userId);
            if (assigns && assigns.length) {
              const today = new Date().toISOString().slice(0, 10);
              const current = assigns.find(a => !a.date_to || a.date_to.slice(0, 10) >= today);
              if (current && current.work_id) {
                const work = await AsgardDB.get('works', current.work_id);
                if (work) {
                  const tender = work.tender_id ? await AsgardDB.get('tenders', work.tender_id) : null;
                  currentProject = work.customer_name || (tender && tender.customer_name) || '';
                }
              }
            }
          }
        } catch (_) { /* non-critical */ }

        const root = document.getElementById('wpDesktopRoot');
        if (root) fadeTransition(root, () => renderView());
      } catch (e) {
        toast('Ошибка', 'Не удалось загрузить анкету: ' + e.message, 'err');
        hideModal();
      }
    }

    /* ── VIEW ── */
    function renderView() {
      editMode = false;
      const root = document.getElementById('wpDesktopRoot');
      if (!root) return;

      if (!profile) {
        root.innerHTML = renderEmptyState();
        bindEmptyEvents();
        return;
      }

      const data = (typeof profile.data === 'string' ? JSON.parse(profile.data) : profile.data) || {};
      const { filled, total } = countFilled(data);
      const pct = total > 0 ? Math.round(filled / total * 100) : 0;
      const score = profile.overall_score || data.overall_score || 0;
      const name = userData ? (userData.name || '') : '';
      const role = userData ? (userData.role || '') : '';
      const avatarUrl = photoUrl || (profile && profile.photo_url) || (userData && userData.avatar_url);
      const roles = Array.isArray(data.recommended_role) ? data.recommended_role : [];
      const updatedAt = profile.updated_at ? new Date(profile.updated_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      const author = profile.updated_by_name || profile.created_by_name || '';

      let html = '';

      /* HERO */
      html += `<div class="wp-desktop-hero">
        ${runeSvg()}
        <div class="wp-desktop-hero-actions">
          <button class="wp-desktop-icon-btn" id="wpEditBtn" title="Редактировать">\u270F\uFE0F</button>
          <button class="wp-desktop-icon-btn" id="wpPrintBtn" title="Печать">\uD83D\uDDA8\uFE0F</button>
        </div>
        <div class="wp-desktop-hero-row">
          ${avatarUrl
            ? `<div class="wp-desktop-avatar" style="background-image:url(${esc(avatarUrl)})"></div>`
            : `<div class="wp-desktop-avatar wp-desktop-avatar-placeholder">${esc(name.charAt(0) || '?')}</div>`}
          <div class="wp-desktop-hero-info">
            <div class="wp-desktop-hero-name">${esc(name)}</div>
            <div class="wp-desktop-hero-role">${esc(role)}${roles.length ? ' &middot; ' + roles.map(r => esc(ROLE_LABELS[r] || r)).join(', ') : ''}</div>
          </div>
          <div class="wp-desktop-hero-gauge" id="wpGaugeWrap">
            <div class="wp-desktop-hero-progress">
              <span>Заполнено ${filled}/${total}</span>
              <div class="wp-desktop-progress-bar"><div class="wp-desktop-progress-fill" style="width:${pct}%"></div></div>
            </div>
          </div>
        </div>
        <div class="wp-desktop-hero-meta">
          ${currentProject ? esc(currentProject) + ' &middot; ' : ''}${updatedAt ? esc(updatedAt) : ''}${author ? ' &middot; ' + esc(author) : ''}
        </div>
      </div>`;

      /* BODY — 2 columns */
      html += '<div class="wp-desktop-grid">';
      html += '<div class="wp-desktop-col">';
      PROFILE_SCHEMA.sections.filter(s => LEFT_SECTIONS.includes(s.id)).forEach(sec => {
        html += renderSectionView(sec, data);
      });
      html += '</div><div class="wp-desktop-col">';
      PROFILE_SCHEMA.sections.filter(s => RIGHT_SECTIONS.includes(s.id)).forEach(sec => {
        html += renderSectionView(sec, data);
      });
      html += '</div></div>';

      /* Footer buttons */
      html += `<div class="wp-desktop-footer">
        <button class="btn" id="wpEditBtn2">\u270F\uFE0F Редактировать</button>
        <button class="btn ghost" id="wpPrintBtn2">\uD83D\uDDA8\uFE0F Печать</button>
      </div>`;

      root.innerHTML = html;

      /* Insert SVG ring gauge via DOM (not innerHTML) */
      const gaugeWrap = document.getElementById('wpGaugeWrap');
      if (gaugeWrap) gaugeWrap.prepend(createRingGauge(score, 72, 5));

      bindViewEvents();
    }

    function renderSectionView(sec, data) {
      let h = `<div class="wp-desktop-section">
        <div class="wp-desktop-section-title">${sec.icon} ${esc(sec.title)}</div>`;

      sec.fields.forEach(f => {
        const val = data[f.id];
        const comment = data[f.id + '_comment'] || '';
        const isImportant = f.important;
        const cls = isImportant ? ' wp-desktop-important' : '';

        h += `<div class="wp-desktop-field-row${cls}">`;
        h += `<div class="wp-desktop-field-label">${esc(f.label)}</div>`;

        if (f.type === 'radio') {
          const opt = (f.options || []).find(o => o.value === val);
          h += opt ? `<div class="wp-desktop-field-value">${badgeHtml(opt.label, opt.color)}</div>` : '<div class="wp-desktop-field-value wp-desktop-empty">Не указано</div>';
        } else if (f.type === 'score') {
          if (val && val > 0) {
            const opt = (f.options || []).find(o => o.value === val);
            h += `<div class="wp-desktop-field-value">${badgeHtml((opt ? opt.emoji + ' ' + opt.label : val), opt ? opt.color : 'neutral')}</div>`;
          } else {
            h += '<div class="wp-desktop-field-value wp-desktop-empty">Не указано</div>';
          }
        } else if (f.type === 'multi') {
          if (Array.isArray(val) && val.length > 0) {
            h += '<div class="wp-desktop-field-value">' + val.map(v => {
              const opt = (f.options || []).find(o => o.value === v);
              return `<span class="wp-desktop-badge" style="background:rgba(81,207,102,0.15);color:#51cf66">${esc(opt ? opt.label : v)}</span>`;
            }).join(' ') + '</div>';
          } else {
            h += '<div class="wp-desktop-field-value wp-desktop-empty">Не указано</div>';
          }
        } else if (f.type === 'textarea' || f.type === 'text') {
          h += val ? `<div class="wp-desktop-field-value"><div class="wp-desktop-text-block">${esc(val)}</div></div>` : '<div class="wp-desktop-field-value wp-desktop-empty">Не указано</div>';
        }

        if (comment) {
          h += `<div class="wp-desktop-comment">\uD83D\uDCAC ${esc(comment)}</div>`;
        }
        h += '</div>';
      });

      h += '</div>';
      return h;
    }

    function renderEmptyState() {
      const name = userData ? (userData.name || 'Сотрудник') : 'Сотрудник';
      return `<div class="wp-desktop-empty-state">
        <div style="font-size:64px;opacity:0.3;margin-bottom:16px">\uD83D\uDCCB</div>
        <div style="font-size:16px;color:var(--t2);margin-bottom:8px">Анкета не заполнена</div>
        <div style="font-size:13px;color:var(--t3);margin-bottom:24px">Заполните анкету для ${esc(name)}</div>
        <button class="btn" id="wpFillBtn">\uD83D\uDCDD Заполнить</button>
      </div>`;
    }

    function bindEmptyEvents() {
      const btn = document.getElementById('wpFillBtn');
      if (btn) btn.onclick = () => startEdit();
    }

    function bindViewEvents() {
      const e1 = document.getElementById('wpEditBtn');
      const e2 = document.getElementById('wpEditBtn2');
      const p1 = document.getElementById('wpPrintBtn');
      const p2 = document.getElementById('wpPrintBtn2');
      if (e1) e1.onclick = () => { const root = document.getElementById('wpDesktopRoot'); if (root) fadeTransition(root, () => { startEdit(); }); };
      if (e2) e2.onclick = () => { const root = document.getElementById('wpDesktopRoot'); if (root) fadeTransition(root, () => { startEdit(); }); };
      if (p1) p1.onclick = () => printProfile();
      if (p2) p2.onclick = () => printProfile();
    }

    /* ── EDIT ── */
    function startEdit() {
      editMode = true;
      const data = profile ? (typeof profile.data === 'string' ? JSON.parse(profile.data) : profile.data) || {} : {};
      editData = JSON.parse(JSON.stringify(data));
      originalJson = JSON.stringify(editData);
      photoFile = null;
      renderEdit();
    }

    function renderEdit() {
      const root = document.getElementById('wpDesktopRoot');
      if (!root) return;

      const name = userData ? (userData.name || '') : '';
      const avatarUrl = photoUrl || (profile && profile.photo_url) || (userData && userData.avatar_url);

      let html = '';

      /* HERO (edit) */
      html += `<div class="wp-desktop-hero wp-desktop-hero-edit">
        ${runeSvg()}
        <div class="wp-desktop-hero-row">
          <div class="wp-desktop-avatar-wrap" id="wpAvatarWrap" title="Сменить фото" style="cursor:pointer">
            ${avatarUrl
              ? `<div class="wp-desktop-avatar" id="wpAvatarImg" style="background-image:url(${esc(avatarUrl)})"></div>`
              : `<div class="wp-desktop-avatar wp-desktop-avatar-placeholder" id="wpAvatarImg">${esc(name.charAt(0) || '?')}</div>`}
            <div class="wp-desktop-avatar-overlay">\uD83D\uDCF7</div>
            <input type="file" id="wpPhotoInput" accept="image/*" style="display:none"/>
          </div>
          <div class="wp-desktop-hero-info">
            <div class="wp-desktop-hero-name">${esc(name)}</div>
            <div class="wp-desktop-hero-role" style="opacity:0.6">Режим редактирования</div>
          </div>
        </div>
      </div>`;

      /* BODY — 2 columns edit */
      html += '<div class="wp-desktop-grid">';
      html += '<div class="wp-desktop-col">';
      PROFILE_SCHEMA.sections.filter(s => LEFT_SECTIONS.includes(s.id)).forEach(sec => {
        html += renderSectionEdit(sec);
      });
      html += '</div><div class="wp-desktop-col">';
      PROFILE_SCHEMA.sections.filter(s => RIGHT_SECTIONS.includes(s.id)).forEach(sec => {
        html += renderSectionEdit(sec);
      });
      html += '</div></div>';

      /* Footer */
      html += `<div class="wp-desktop-footer">
        <button class="btn" id="wpSaveBtn">\u2713 Сохранить</button>
        <button class="btn ghost" id="wpCancelBtn">Отмена</button>
      </div>`;

      root.innerHTML = html;
      bindEditEvents();
    }

    function renderSectionEdit(sec) {
      let h = `<div class="wp-desktop-section">
        <div class="wp-desktop-section-title">${sec.icon} ${esc(sec.title)}</div>`;

      sec.fields.forEach(f => {
        const val = editData[f.id];
        const comment = editData[f.id + '_comment'] || '';
        const isImportant = f.important;
        const cls = isImportant ? ' wp-desktop-important' : '';

        h += `<div class="wp-desktop-field-row wp-desktop-field-editable${cls}" data-fid="${esc(f.id)}">`;
        h += `<div class="wp-desktop-field-label">${esc(f.label)}</div>`;

        if (f.type === 'radio') {
          h += '<div class="wp-desktop-pills">';
          (f.options || []).forEach(opt => {
            const sel = val === opt.value;
            const c = WP_COLORS[opt.color] || WP_COLORS.neutral;
            const textCol = c.text || 'var(--t2)';
            const selStyle = sel ? 'background:' + c.bg + ';color:' + textCol + ';box-shadow:0 0 8px ' + (c.text || 'rgba(128,128,128,0.3)') : '';
            h += `<button class="wp-desktop-pill${sel ? ' selected' : ''}" data-field="${esc(f.id)}" data-value="${esc(opt.value)}" data-color-bg="${c.bg}" data-color-text="${textCol}" data-color-glow="${c.text || 'rgba(128,128,128,0.3)'}"
              style="${selStyle}">${esc(opt.label)}</button>`;
          });
          h += '</div>';
        } else if (f.type === 'score') {
          h += '<div class="wp-desktop-scores">';
          (f.options || []).forEach(opt => {
            const sel = val === opt.value;
            const c = WP_COLORS[opt.color] || WP_COLORS.neutral;
            const textCol = c.text || 'var(--t2)';
            const selStyle = sel ? 'background:' + c.bg + ';color:' + textCol + ';box-shadow:0 0 12px ' + (c.text || 'rgba(128,128,128,0.3)') : '';
            h += `<button class="wp-desktop-score-circle${sel ? ' selected' : ''}" data-field="${esc(f.id)}" data-value="${opt.value}" data-color-bg="${c.bg}" data-color-text="${textCol}" data-color-glow="${c.text || 'rgba(128,128,128,0.3)'}"
              style="${selStyle}" title="${esc(opt.label)}">${opt.emoji || opt.value}</button>`;
          });
          h += '</div>';
        } else if (f.type === 'multi') {
          h += '<div class="wp-desktop-pills wp-desktop-pills-multi">';
          (f.options || []).forEach(opt => {
            const sel = Array.isArray(val) && val.includes(opt.value);
            const selStyle = sel ? 'background:rgba(81,207,102,0.15);color:#51cf66;box-shadow:0 0 8px rgba(81,207,102,0.3)' : '';
            h += `<button class="wp-desktop-pill${sel ? ' selected' : ''}" data-field="${esc(f.id)}" data-value="${esc(opt.value)}" data-multi="1"
              style="${selStyle}">${esc(opt.label)}</button>`;
          });
          h += '</div>';
        } else if (f.type === 'textarea') {
          h += `<textarea class="wp-desktop-textarea" data-field="${esc(f.id)}" rows="3" placeholder="...">${esc(val || '')}</textarea>`;
        } else if (f.type === 'text') {
          h += `<input class="wp-desktop-input" data-field="${esc(f.id)}" value="${esc(val || '')}" placeholder="..."/>`;
        }

        /* Comment — always visible if has value, otherwise shown on hover/focus */
        if (f.hasComment) {
          const hasVal = !!comment;
          h += `<div class="wp-desktop-comment-edit${hasVal ? ' wp-desktop-comment-visible' : ''}">
            <input class="wp-desktop-comment-input" data-comment="${esc(f.id)}" value="${esc(comment)}" placeholder="\uD83D\uDCAC Комментарий..."/>
          </div>`;
        }

        h += '</div>';
      });

      h += '</div>';
      return h;
    }

    function bindEditEvents() {
      const root = document.getElementById('wpDesktopRoot');
      if (!root) return;

      /* ── Pills: точечное обновление DOM ── */
      root.addEventListener('click', (e) => {
        /* Radio pill */
        const pill = e.target.closest('.wp-desktop-pill:not([data-multi])');
        if (pill) {
          const fid = pill.dataset.field;
          const val = pill.dataset.value;
          const isDeselect = editData[fid] === val;
          editData[fid] = isDeselect ? undefined : val;

          /* Update all pills in this group */
          const group = pill.closest('.wp-desktop-pills');
          if (group) {
            group.querySelectorAll('.wp-desktop-pill').forEach(p => {
              const isSel = editData[fid] === p.dataset.value;
              p.classList.toggle('selected', isSel);
              if (isSel) {
                p.style.background = p.dataset.colorBg;
                p.style.color = p.dataset.colorText;
                p.style.boxShadow = '0 0 8px ' + p.dataset.colorGlow;
              } else {
                p.style.background = '';
                p.style.color = '';
                p.style.boxShadow = '';
              }
            });
          }
          return;
        }

        /* Multi pill */
        const mpill = e.target.closest('.wp-desktop-pill[data-multi]');
        if (mpill) {
          const fid = mpill.dataset.field;
          const val = mpill.dataset.value;
          if (!Array.isArray(editData[fid])) editData[fid] = [];
          const idx = editData[fid].indexOf(val);
          if (idx >= 0) editData[fid].splice(idx, 1);
          else editData[fid].push(val);
          const isSel = editData[fid].includes(val);
          mpill.classList.toggle('selected', isSel);
          if (isSel) {
            mpill.style.background = 'rgba(81,207,102,0.15)';
            mpill.style.color = '#51cf66';
            mpill.style.boxShadow = '0 0 8px rgba(81,207,102,0.3)';
          } else {
            mpill.style.background = '';
            mpill.style.color = '';
            mpill.style.boxShadow = '';
          }
          return;
        }

        /* Score circle */
        const sc = e.target.closest('.wp-desktop-score-circle');
        if (sc) {
          const fid = sc.dataset.field;
          const val = parseInt(sc.dataset.value, 10);
          const isDeselect = editData[fid] === val;
          editData[fid] = isDeselect ? undefined : val;

          const group = sc.closest('.wp-desktop-scores');
          if (group) {
            group.querySelectorAll('.wp-desktop-score-circle').forEach(s => {
              const isSel = editData[fid] === parseInt(s.dataset.value, 10);
              s.classList.toggle('selected', isSel);
              if (isSel) {
                s.style.background = s.dataset.colorBg;
                s.style.color = s.dataset.colorText;
                s.style.boxShadow = '0 0 12px ' + s.dataset.colorGlow;
              } else {
                s.style.background = '';
                s.style.color = '';
                s.style.boxShadow = '';
              }
            });
          }
          return;
        }
      });

      /* Textarea / text — oninput stores value, no re-render */
      root.querySelectorAll('.wp-desktop-textarea, .wp-desktop-input').forEach(el => {
        el.addEventListener('input', () => { editData[el.dataset.field] = el.value; });
      });

      /* Comment inputs — oninput, toggle visibility class */
      root.querySelectorAll('.wp-desktop-comment-input').forEach(el => {
        el.addEventListener('input', () => {
          editData[el.dataset.comment + '_comment'] = el.value;
          const wrap = el.closest('.wp-desktop-comment-edit');
          if (wrap) wrap.classList.toggle('wp-desktop-comment-visible', !!el.value);
        });
        /* Keep comment visible while focused */
        el.addEventListener('focus', () => {
          const wrap = el.closest('.wp-desktop-comment-edit');
          if (wrap) wrap.classList.add('wp-desktop-comment-focused');
        });
        el.addEventListener('blur', () => {
          const wrap = el.closest('.wp-desktop-comment-edit');
          if (wrap) {
            wrap.classList.remove('wp-desktop-comment-focused');
            /* If empty after blur and parent not hovered, will hide via CSS */
          }
        });
      });

      /* Photo */
      const avatarWrap = document.getElementById('wpAvatarWrap');
      const photoInput = document.getElementById('wpPhotoInput');
      if (avatarWrap && photoInput) {
        avatarWrap.onclick = (e) => { e.stopPropagation(); photoInput.click(); };
        photoInput.onchange = () => {
          const file = photoInput.files[0];
          if (!file) return;
          photoFile = file;
          const url = URL.createObjectURL(file);
          const img = document.getElementById('wpAvatarImg');
          if (img) {
            img.style.backgroundImage = 'url(' + url + ')';
            img.textContent = '';
            img.classList.remove('wp-desktop-avatar-placeholder');
          }
        };
      }

      /* Save */
      const saveBtn = document.getElementById('wpSaveBtn');
      if (saveBtn) saveBtn.onclick = () => saveProfile();

      /* Cancel with dirty check */
      const cancelBtn = document.getElementById('wpCancelBtn');
      if (cancelBtn) cancelBtn.onclick = () => {
        if (isDirty(editData, originalJson) || photoFile) {
          if (!confirm('Есть несохранённые изменения. Отменить редактирование?')) return;
        }
        const root = document.getElementById('wpDesktopRoot');
        if (root) fadeTransition(root, () => renderView());
      };
    }

    /* ── SAVE ── */
    async function saveProfile() {
      const saveBtn = document.getElementById('wpSaveBtn');
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Сохранение...'; }

      try {
        /* Upload photo if changed */
        let newPhotoUrl = photoUrl;
        if (photoFile) {
          const fd = new FormData();
          fd.append('file', photoFile);
          const r = await fetch('/api/files/upload', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + getToken() },
            body: fd
          });
          if (r.ok) {
            const j = await r.json();
            newPhotoUrl = j.url || j.file_url || j.path || newPhotoUrl;
          }
        }

        const { filled, total } = countFilled(editData);
        const body = {
          data: editData,
          filled_count: filled,
          total_count: total,
          overall_score: editData.overall_score || null,
          photo_url: newPhotoUrl
        };

        const resp = await apiPut('/worker-profiles/' + userId, body);
        profile = resp.profile;
        photoUrl = newPhotoUrl;
        toast('Сохранено', 'Анкета обновлена');
        const root = document.getElementById('wpDesktopRoot');
        if (root) fadeTransition(root, () => renderView());
      } catch (e) {
        toast('Ошибка', 'Не удалось сохранить: ' + e.message, 'err');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '\u2713 Сохранить'; }
      }
    }

    /* ── PRINT ── */
    function printProfile() {
      const root = document.getElementById('wpDesktopRoot');
      if (!root) return;
      document.body.classList.add('wp-desktop-print-active');
      window.print();
      setTimeout(() => document.body.classList.remove('wp-desktop-print-active'), 500);
    }
  }

  return { open };
})();
