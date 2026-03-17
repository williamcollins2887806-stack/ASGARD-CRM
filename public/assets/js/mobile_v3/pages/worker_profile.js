/**
 * ASGARD CRM — Mobile v3 / Анкета-характеристика сотрудника
 * Один сотрудник = одна анкета (upsert). 4 секции, ~20 критериев.
 */

/* ── PROFILE_SCHEMA ── */
var PROFILE_SCHEMA = {
  sections: [
    {
      id: 'work', icon: '⚒️', title: 'Рабочие качества',
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
          { value: 'health_issues', label: 'Здоровье ❗', color: 'danger' }
        ]},
        { id: 'learning', label: 'Обучаемость', type: 'radio', hasComment: true, options: [
          { value: 'hard', label: 'Тяжело', color: 'danger' },
          { value: 'normal', label: 'Нормально', color: 'neutral' },
          { value: 'fast', label: 'Быстро', color: 'success' }
        ]}
      ]
    },
    {
      id: 'character', icon: '🧠', title: 'Характер и поведение',
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
          { value: 'unknown', label: '❓', color: 'neutral' }
        ]}
      ]
    },
    {
      id: 'housing', icon: '🏠', title: 'Смены и проживание',
      fields: [
        { id: 'preferred_shift', label: 'Лучше ставить в смену', type: 'radio', options: [
          { value: 'day', label: 'День', color: 'neutral' },
          { value: 'night', label: 'Ночь', color: 'neutral' },
          { value: 'any', label: 'Без разницы', color: 'neutral' }
        ]},
        { id: 'shift_reason', label: 'Почему эту смену', type: 'text' },
        { id: 'good_roommates', label: '✅ С кем ХОРОШО селить', type: 'textarea' },
        { id: 'bad_roommates', label: '🚫 С кем НЕЛЬЗЯ селить', type: 'textarea', important: true },
        { id: 'bad_shift_partners', label: '🚫 С кем НЕЛЬЗЯ в одну смену', type: 'textarea', important: true },
        { id: 'health', label: '🏥 Здоровье', type: 'textarea' },
        { id: 'family', label: '👨‍👩‍👧 Семья', type: 'textarea' },
        { id: 'religion_food', label: '🕌 Религия / питание', type: 'textarea' }
      ]
    },
    {
      id: 'summary', icon: '⭐', title: 'Итоговая оценка',
      fields: [
        { id: 'overall_score', label: 'Общая оценка', type: 'score', options: [
          { value: 1, label: 'Не брать', emoji: '🚫', color: 'danger' },
          { value: 2, label: 'Слабый', emoji: '😐', color: 'warning' },
          { value: 3, label: 'Норм', emoji: '👍', color: 'neutral' },
          { value: 4, label: 'Хороший', emoji: '💪', color: 'success' },
          { value: 5, label: 'Лучший', emoji: '🏆', color: 'gold' }
        ]},
        { id: 'recommended_role', label: 'Рекомендуемая роль', type: 'multi', options: [
          { value: 'operator', label: '⚙️ Оператор' },
          { value: 'observer', label: '👁️ Наблюдающий' },
          { value: 'hvd', label: '💧 НВД' },
          { value: 'helper', label: '🔧 Подсобный' },
          { value: 'foreman', label: '👷 Мастер' }
        ]},
        { id: 'warning', label: '⚠️ Предупреждение', type: 'textarea', important: true },
        { id: 'strength', label: '💎 Главный плюс', type: 'textarea' }
      ]
    }
  ]
};

/* ── Цвета badge ── */
var WP_COLORS = {
  danger:  { bg: 'rgba(255,68,68,0.15)',  text: '#ff4444' },
  warning: { bg: 'rgba(255,140,0,0.15)',   text: '#ff8c00' },
  neutral: { bg: 'rgba(128,128,128,0.15)', text: null },  // textSec
  success: { bg: 'rgba(81,207,102,0.15)',  text: '#51cf66' },
  gold:    { bg: 'rgba(255,215,0,0.15)',   text: '#ffd700' }
};

/* ── Score labels ── */
var SCORE_LABELS = { 1: 'Не брать 🚫', 2: 'Слабый 😐', 3: 'Норм 👍', 4: 'Хороший 💪', 5: 'Лучший 🏆' };

/* ── Role labels ── */
var ROLE_LABELS = { operator: '⚙️ Оператор', observer: '👁️ Наблюдающий', hvd: '💧 НВД', helper: '🔧 Подсобный', foreman: '👷 Мастер' };

/* ── countFilled ── */
function wpCountFilled(data) {
  var filled = 0;
  var total = 0;
  PROFILE_SCHEMA.sections.forEach(function (sec) {
    sec.fields.forEach(function (f) {
      total++;
      var val = data[f.id];
      if (f.type === 'multi') {
        if (Array.isArray(val) && val.length > 0) filled++;
      } else if (f.type === 'score') {
        if (val && val > 0) filled++;
      } else {
        if (val !== undefined && val !== null && val !== '') filled++;
      }
    });
  });
  return { filled: filled, total: total };
}

/* ══════════════════════════════════════════
   СТРАНИЦА ОДНОЙ АНКЕТЫ
   ══════════════════════════════════════════ */
var WorkerProfilePage = {
  render: function (params) {
    var el = Utils.el;
    var t = DS.t;
    var userId = params && params.id ? parseInt(params.id, 10) : null;
    if (!userId) return el('div', {}, 'Нет userId');

    var page = el('div', { style: { background: t.bg, minHeight: '100vh', paddingBottom: '80px' } });
    page.appendChild(M.Skeleton({ type: 'card', count: 3 }));

    var profile = null;
    var userData = null;
    var editMode = false;
    var editData = {};
    var originalJson = '';
    var originalPhotoUrl = null;
    var photoUrl = null;
    var photoFile = null; // pending upload
    var blobUrls = []; // track for revokeObjectURL

    API.fetch('/worker-profiles/' + userId).then(function (resp) {
      profile = resp.profile;
      userData = resp.user || (profile ? { id: profile.user_id, name: profile.user_name, avatar_url: profile.user_avatar, role: profile.user_role } : null);
      photoUrl = profile ? profile.photo_url : null;
      page.replaceChildren();
      renderView();
    }).catch(function (err) {
      page.replaceChildren();
      page.appendChild(M.Header({ title: 'Анкета', back: true }));
      page.appendChild(M.Empty({ text: 'Ошибка загрузки', icon: '❌' }));
    });

    /* ── HEADER ── */
    function renderBackHeader(rightEl) {
      var hdr = el('div', { style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', position: 'sticky', top: '0', zIndex: '10', background: t.bg
      } });
      var backBtn = el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', padding: '4px' } });
      backBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="' + t.text + '" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>';
      backBtn.appendChild(el('span', { style: Object.assign({}, DS.font('md'), { color: t.text }) }, 'Назад'));
      backBtn.addEventListener('click', function () { history.back(); });
      hdr.appendChild(backBtn);
      if (rightEl) hdr.appendChild(rightEl);
      return hdr;
    }

    /* ── fade transition ── */
    function fadeTransition(renderFn) {
      page.style.transition = 'opacity 0.2s ease';
      page.style.opacity = '0';
      setTimeout(function () {
        /* cleanup blob URLs */
        blobUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
        blobUrls = [];
        renderFn();
        page.style.opacity = '1';
      }, 200);
    }

    /* ── VIEW MODE ── */
    function renderView() {
      page.replaceChildren();

      if (!profile) {
        /* пустое состояние */
        page.appendChild(renderBackHeader());
        var empty = el('div', { style: { textAlign: 'center', padding: '80px 24px', animation: 'asgard-fade-in 0.4s ease' } });
        empty.appendChild(el('div', { style: { fontSize: '64px', opacity: '0.3', marginBottom: '16px' } }, '📋'));
        empty.appendChild(el('div', { style: Object.assign({}, DS.font('md'), { color: t.textSec, marginBottom: '8px' }) }, 'Анкета не заполнена'));
        empty.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.textTer, marginBottom: '24px' }) }, 'Заполните перед выездом на объект'));
        var fillBtn = el('div', { style: {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: '14px 32px', borderRadius: '14px', cursor: 'pointer',
          background: 'var(--hero-grad, linear-gradient(135deg, #1e3a5f, #0d1428))',
          color: '#fff', fontWeight: '600', fontSize: '15px'
        } }, '📝 Заполнить');
        fillBtn.addEventListener('click', function () { startEdit(); });
        empty.appendChild(fillBtn);
        page.appendChild(empty);
        return;
      }

      var data = (typeof profile.data === 'string' ? JSON.parse(profile.data) : profile.data) || {};

      /* Hero */
      page.appendChild(renderHero(data));

      /* Аккордеон */
      var accordion = el('div', { style: { padding: '12px 16px' } });
      PROFILE_SCHEMA.sections.forEach(function (sec, si) {
        accordion.appendChild(renderSection(sec, data, si === 0));
      });
      page.appendChild(accordion);

      /* Кнопка редактирования (fixed) */
      var fixedBar = el('div', { style: {
        position: 'fixed', bottom: '0', left: '0', right: '0',
        padding: '12px 16px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        background: t.bg, borderTop: '1px solid ' + t.border, zIndex: '50'
      } });
      var editBtn = el('div', { style: {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '52px', borderRadius: '14px', cursor: 'pointer',
        background: 'var(--hero-grad, linear-gradient(135deg, #1e3a5f, #0d1428))',
        color: '#fff', fontWeight: '600', fontSize: '15px'
      } }, '✏️ Редактировать анкету');
      editBtn.addEventListener('click', function () { startEdit(); });
      fixedBar.appendChild(editBtn);
      page.appendChild(fixedBar);
    }

    /* ── HERO CARD ── */
    function renderHero(data) {
      var hero = el('div', { className: 'asgard-wp-hero', style: {
        background: 'var(--hero-grad, linear-gradient(135deg, #1e3a5f, #0d1428))',
        borderRadius: '0 0 24px 24px', padding: '20px 20px 16px', position: 'relative', overflow: 'hidden'
      } });

      /* Руна watermark */
      var rune = el('div', { style: {
        position: 'absolute', right: '16px', top: '16px', fontSize: '72px', opacity: '0.05', color: '#fff',
        fontFamily: 'serif', pointerEvents: 'none'
      } }, 'ᚨ');
      hero.appendChild(rune);

      /* Строка 1: аватар + ФИО */
      var row1 = el('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px', position: 'relative', zIndex: '1' } });
      var avatarUrl = photoUrl || (profile && profile.photo_url) || (userData && userData.avatar_url);
      var avatarName = userData ? userData.name : '';
      var heroAvaSize = avatarUrl ? 80 : 56;
      if (avatarUrl) {
        var ava = el('div', { style: {
          width: heroAvaSize + 'px', height: heroAvaSize + 'px', borderRadius: '50%', flexShrink: '0',
          backgroundImage: 'url(' + avatarUrl + ')', backgroundSize: 'cover', backgroundPosition: 'center',
          border: '2px solid rgba(255,255,255,0.3)'
        } });
        row1.appendChild(ava);
      } else {
        row1.appendChild(M.Avatar({ name: avatarName || '?', size: heroAvaSize }));
      }
      var nameBlock = el('div', { style: { flex: '1' } });
      nameBlock.appendChild(el('div', { style: Object.assign({}, DS.font('lg'), { color: '#fff', fontWeight: '800' }) }, avatarName || 'Сотрудник'));
      nameBlock.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: 'rgba(255,255,255,0.6)' }) }, userData ? (userData.role || '') : ''));
      row1.appendChild(nameBlock);
      hero.appendChild(row1);

      /* Строка 2: Score ring + progress */
      var row2 = el('div', { style: { display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '12px', position: 'relative', zIndex: '1' } });

      var score = profile.overall_score || data.overall_score || 0;
      var scoreColor = getScoreColor(score);

      /* SVG Ring */
      var ringWrap = el('div', { style: { textAlign: 'center', flexShrink: '0' } });
      var svgSize = 72;
      var radius = 30;
      var circumference = 2 * Math.PI * radius;
      var fill = score > 0 ? (score / 5) : 0;
      var dashOffset = circumference * (1 - fill);

      var svgNS = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('width', svgSize);
      svg.setAttribute('height', svgSize);
      svg.style.filter = score > 0 ? 'drop-shadow(0 0 6px ' + scoreColor + ')' : 'none';

      var bgCircle = document.createElementNS(svgNS, 'circle');
      bgCircle.setAttribute('cx', svgSize / 2);
      bgCircle.setAttribute('cy', svgSize / 2);
      bgCircle.setAttribute('r', radius);
      bgCircle.setAttribute('fill', 'none');
      bgCircle.setAttribute('stroke', 'rgba(255,255,255,0.15)');
      bgCircle.setAttribute('stroke-width', '5');
      svg.appendChild(bgCircle);

      if (score > 0) {
        var fgCircle = document.createElementNS(svgNS, 'circle');
        fgCircle.setAttribute('cx', svgSize / 2);
        fgCircle.setAttribute('cy', svgSize / 2);
        fgCircle.setAttribute('r', radius);
        fgCircle.setAttribute('fill', 'none');
        fgCircle.setAttribute('stroke', scoreColor);
        fgCircle.setAttribute('stroke-width', '5');
        fgCircle.setAttribute('stroke-linecap', 'round');
        fgCircle.setAttribute('stroke-dasharray', circumference);
        fgCircle.setAttribute('stroke-dashoffset', circumference);
        fgCircle.setAttribute('transform', 'rotate(-90 ' + svgSize / 2 + ' ' + svgSize / 2 + ')');
        svg.appendChild(fgCircle);

        /* анимация */
        setTimeout(function () {
          fgCircle.style.transition = 'stroke-dashoffset 0.8s ease';
          fgCircle.setAttribute('stroke-dashoffset', dashOffset);
        }, 100);

        var txt = document.createElementNS(svgNS, 'text');
        txt.setAttribute('x', svgSize / 2);
        txt.setAttribute('y', svgSize / 2 + 10);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('fill', '#fff');
        txt.setAttribute('font-size', '28');
        txt.setAttribute('font-weight', '900');
        txt.textContent = score;
        svg.appendChild(txt);
      }

      ringWrap.appendChild(svg);
      if (score > 0) {
        ringWrap.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'rgba(255,255,255,0.8)', marginTop: '2px' }) }, SCORE_LABELS[score] || ''));
      }
      row2.appendChild(ringWrap);

      /* Progress + roles */
      var rightBlock = el('div', { style: { flex: '1' } });
      var counts = wpCountFilled(data);
      var pct = counts.total > 0 ? Math.round(counts.filled / counts.total * 100) : 0;

      rightBlock.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'rgba(255,255,255,0.7)', marginBottom: '6px' }) }, 'Заполнено'));

      var progBar = el('div', { style: { height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.15)', marginBottom: '4px' } });
      var progFill = el('div', { style: {
        height: '100%', borderRadius: '3px', width: pct + '%',
        background: '#51cf66', transition: 'width 0.5s ease'
      } });
      progBar.appendChild(progFill);
      rightBlock.appendChild(progBar);

      var progText = pct === 100 ? '✅ Полностью' : counts.filled + ' из ' + counts.total + ' (' + pct + '%)';
      rightBlock.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'rgba(255,255,255,0.7)', marginBottom: '8px' }) }, progText));

      /* Роли pills */
      var roles = data.recommended_role;
      if (Array.isArray(roles) && roles.length) {
        var pillsRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } });
        roles.forEach(function (r) {
          pillsRow.appendChild(el('div', { style: {
            padding: '2px 8px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.3)',
            color: '#fff', fontSize: '11px'
          } }, ROLE_LABELS[r] || r));
        });
        rightBlock.appendChild(pillsRow);
      }

      row2.appendChild(rightBlock);
      hero.appendChild(row2);

      /* Строка 3: автор */
      var authorText = '';
      if (profile.updated_by_name) authorText = 'Заполнил: ' + profile.updated_by_name;
      else if (profile.created_by_name) authorText = 'Заполнил: ' + profile.created_by_name;
      if (profile.updated_at) {
        var d = new Date(profile.updated_at);
        authorText += ' | ' + d.toLocaleDateString('ru-RU');
      }
      if (authorText) {
        hero.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: 'rgba(255,255,255,0.4)', position: 'relative', zIndex: '1' }) }, authorText));
      }

      return hero;
    }

    /* ── АККОРДЕОН СЕКЦИЯ ── */
    function renderSection(sec, data, openByDefault) {
      var wrapper = el('div', { className: 'asgard-wp-section', style: { marginBottom: '8px' } });

      /* header */
      var header = el('div', { className: 'asgard-wp-section-header', style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 0', cursor: 'pointer', borderBottom: '1px solid ' + t.border
      } });

      var left = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
      left.appendChild(el('span', { style: { fontSize: '18px' } }, sec.icon));
      left.appendChild(el('span', { style: Object.assign({}, DS.font('md'), { fontWeight: '600', color: t.text }) }, sec.title));
      header.appendChild(left);

      var right = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
      /* count */
      var filledInSec = 0;
      sec.fields.forEach(function (f) {
        var v = data[f.id];
        if (f.type === 'multi') { if (Array.isArray(v) && v.length) filledInSec++; }
        else if (f.type === 'score') { if (v > 0) filledInSec++; }
        else if (v !== undefined && v !== null && v !== '') filledInSec++;
      });
      right.appendChild(el('span', { style: Object.assign({}, DS.font('xs'), { color: t.textSec }) }, filledInSec + '/' + sec.fields.length));

      var chevron = el('span', { className: 'asgard-wp-chevron', style: {
        display: 'inline-block', transition: 'transform 0.3s ease',
        transform: openByDefault ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: '12px', color: t.textSec
      } }, '▶');
      right.appendChild(chevron);
      header.appendChild(right);

      /* body */
      var body = el('div', { className: 'asgard-wp-section-body', style: {
        overflow: 'hidden', transition: 'max-height 0.3s ease',
        maxHeight: openByDefault ? '2000px' : '0px'
      } });

      var bodyInner = el('div', { style: { padding: '8px 0' } });

      sec.fields.forEach(function (f) {
        bodyInner.appendChild(renderViewField(f, data));
      });

      body.appendChild(bodyInner);
      wrapper.appendChild(header);
      wrapper.appendChild(body);

      /* toggle + touch feedback */
      var isOpen = !!openByDefault;
      header.addEventListener('click', function () {
        isOpen = !isOpen;
        chevron.style.transform = isOpen ? 'rotate(90deg)' : 'rotate(0deg)';
        body.style.maxHeight = isOpen ? '2000px' : '0px';
      });
      header.addEventListener('touchstart', function () { header.style.background = t.surfaceAlt; }, { passive: true });
      header.addEventListener('touchend', function () { header.style.background = 'transparent'; }, { passive: true });

      return wrapper;
    }

    /* ── VIEW FIELD ── */
    function renderViewField(field, data) {
      var row = el('div', { style: { padding: '8px 0' } });

      if (field.type === 'radio') {
        var line = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } });
        var labelWrap = el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } });
        if (field.important) {
          labelWrap.appendChild(el('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: '#ff4444', flexShrink: '0' } }));
        }
        labelWrap.appendChild(el('span', { style: Object.assign({}, DS.font('sm'), { color: t.text }) }, field.label));
        line.appendChild(labelWrap);

        var val = data[field.id];
        var opt = val ? field.options.find(function (o) { return o.value === val; }) : null;
        if (opt) {
          var c = WP_COLORS[opt.color] || WP_COLORS.neutral;
          var badge = el('span', { style: {
            padding: '3px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: '600',
            background: c.bg, color: c.text || t.textSec
          } }, opt.label);
          line.appendChild(badge);

          /* subtle red bg if important + danger */
          if (field.important && opt.color === 'danger') {
            row.style.background = 'rgba(255,68,68,0.04)';
            row.style.borderRadius = '8px';
            row.style.padding = '8px';
          }
        } else {
          line.appendChild(el('span', { style: {
            padding: '3px 10px', borderRadius: '8px', fontSize: '12px',
            background: 'rgba(128,128,128,0.1)', color: t.textTer
          } }, '—'));
        }
        row.appendChild(line);

        /* comment */
        var comment = data[field.id + '_comment'];
        if (comment) {
          row.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.textTer, paddingLeft: '12px', marginTop: '4px' }) }, '● ' + comment));
        }
      } else if (field.type === 'text' || field.type === 'textarea') {
        var val = data[field.id];
        var lbl = el('div', { style: Object.assign({}, DS.font('sm'), { fontWeight: '600', color: t.text, marginBottom: '4px' }) });
        if (field.important) {
          var dot = el('span', { style: { display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#ff4444', marginRight: '6px', verticalAlign: 'middle' } });
          lbl.appendChild(dot);
        }
        lbl.appendChild(document.createTextNode(field.label));
        row.appendChild(lbl);

        if (val) {
          var block = el('div', { style: {
            background: t.surfaceAlt, borderRadius: '10px', padding: '8px 12px',
            borderLeft: field.important ? '3px solid #ff4444' : 'none'
          } });
          block.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.text, whiteSpace: 'pre-wrap' }) }, val));
          row.appendChild(block);
        } else {
          row.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.textTer, fontStyle: 'italic' }) }, 'Не указано'));
        }
      } else if (field.type === 'score') {
        var val = data[field.id];
        if (val > 0) {
          var scoreOpt = field.options ? field.options.find(function (o) { return o.value === val; }) : null;
          var sc = scoreOpt ? (WP_COLORS[scoreOpt.color] || WP_COLORS.neutral) : WP_COLORS.neutral;
          var scoreLine = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } });
          scoreLine.appendChild(el('span', { style: Object.assign({}, DS.font('sm'), { color: t.text }) }, field.label));
          scoreLine.appendChild(el('span', { style: {
            padding: '3px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: '700',
            background: sc.bg, color: sc.text || t.textSec
          } }, val + '/5 — ' + (SCORE_LABELS[val] || '')));
          row.appendChild(scoreLine);
        } else {
          row.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.textTer, fontStyle: 'italic' }) }, 'Оценка не выставлена'));
        }
      } else if (field.type === 'multi') {
        var lbl = el('div', { style: Object.assign({}, DS.font('sm'), { fontWeight: '600', color: t.text, marginBottom: '6px' }) }, field.label);
        row.appendChild(lbl);
        var vals = data[field.id];
        if (Array.isArray(vals) && vals.length) {
          var chips = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
          vals.forEach(function (v) {
            var opt = field.options.find(function (o) { return o.value === v; });
            chips.appendChild(el('span', { style: {
              padding: '4px 10px', borderRadius: '10px', fontSize: '12px',
              background: t.accent + '22', color: t.accent, fontWeight: '500'
            } }, opt ? opt.label : v));
          });
          row.appendChild(chips);
        } else {
          row.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.textTer, fontStyle: 'italic' }) }, 'Не указано'));
        }
      }

      return row;
    }

    /* ══════════════════════════════════════════
       EDIT MODE
       ══════════════════════════════════════════ */
    function startEdit() {
      editMode = true;
      var rawData = profile ? (typeof profile.data === 'string' ? JSON.parse(profile.data) : profile.data) : {};
      editData = JSON.parse(JSON.stringify(rawData || {}));
      photoUrl = profile ? profile.photo_url : null;
      photoFile = null;
      originalJson = JSON.stringify(editData);
      originalPhotoUrl = photoUrl;
      fadeTransition(renderEdit);
    }

    function renderEdit() {
      page.replaceChildren();
      page.style.paddingBottom = '80px';

      /* header */
      var cancelBtn = el('div', { style: Object.assign({}, DS.font('md'), { color: t.textSec, cursor: 'pointer', padding: '4px 8px' }) }, '✕ Отмена');
      cancelBtn.addEventListener('click', function () { cancelEdit(); });
      page.appendChild(renderBackHeader(cancelBtn));

      /* Фото аватар */
      page.appendChild(renderPhotoEditor());

      /* Все секции раскрыты */
      var body = el('div', { style: { padding: '8px 16px' } });
      PROFILE_SCHEMA.sections.forEach(function (sec) {
        body.appendChild(renderEditSection(sec));
      });
      page.appendChild(body);

      /* Кнопка сохранить (fixed) */
      var fixedBar = el('div', { style: {
        position: 'fixed', bottom: '0', left: '0', right: '0',
        padding: '12px 16px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        background: t.bg, borderTop: '1px solid ' + t.border, zIndex: '50'
      } });
      var saveBtn = el('div', { style: {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '52px', borderRadius: '14px', cursor: 'pointer',
        background: 'var(--hero-grad, linear-gradient(135deg, #1e3a5f, #0d1428))',
        color: '#fff', fontWeight: '600', fontSize: '15px'
      } }, '✓ Сохранить анкету');
      var saving = false;
      saveBtn.addEventListener('click', function () {
        if (saving) return;
        saving = true;
        saveBtn.style.opacity = '0.5';
        doSave().finally(function () { saving = false; saveBtn.style.opacity = '1'; });
      });
      fixedBar.appendChild(saveBtn);
      page.appendChild(fixedBar);
    }

    /* ── PHOTO EDITOR ── */
    function renderPhotoEditor() {
      var wrap = el('div', { style: { display: 'flex', justifyContent: 'center', padding: '16px 0 8px', position: 'relative' } });
      var container = el('div', { style: { position: 'relative', width: '100px', height: '100px' } });

      var currentUrl = photoFile ? (function () { var u = URL.createObjectURL(photoFile); blobUrls.push(u); return u; })() : photoUrl;
      var avaEl;
      if (currentUrl) {
        avaEl = el('div', { style: {
          width: '100px', height: '100px', borderRadius: '50%',
          backgroundImage: 'url(' + currentUrl + ')', backgroundSize: 'cover', backgroundPosition: 'center',
          border: '3px solid ' + t.border
        } });
      } else {
        var initials = (userData && userData.name) ? userData.name.split(' ').map(function (w) { return w[0]; }).join('').substring(0, 2).toUpperCase() : '?';
        avaEl = el('div', { style: {
          width: '100px', height: '100px', borderRadius: '50%',
          background: t.surfaceAlt, border: '3px solid ' + t.border,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '32px', fontWeight: '700', color: t.textSec
        } }, initials);
      }
      container.appendChild(avaEl);

      /* Badge 📷 */
      var badge = el('div', { style: {
        position: 'absolute', bottom: '0', right: '0',
        width: '28px', height: '28px', borderRadius: '50%',
        background: 'var(--hero-grad, linear-gradient(135deg, #1e3a5f, #0d1428))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '2px solid ' + t.bg, cursor: 'pointer', fontSize: '14px'
      } }, '📷');

      var fileInput = el('input', { type: 'file', accept: 'image/*', capture: 'user', style: { display: 'none' } });
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) {
          photoFile = fileInput.files[0];
          /* preview — revoke old blob if any */
          var previewUrl = URL.createObjectURL(photoFile);
          blobUrls.push(previewUrl);
          avaEl.style.backgroundImage = 'url(' + previewUrl + ')';
          avaEl.style.backgroundSize = 'cover';
          avaEl.style.backgroundPosition = 'center';
          avaEl.textContent = '';
          avaEl.style.display = 'block';
          avaEl.style.fontSize = '0';
        }
      });
      badge.addEventListener('click', function () { fileInput.click(); });
      container.appendChild(badge);
      container.appendChild(fileInput);
      wrap.appendChild(container);
      return wrap;
    }

    /* ── EDIT SECTION ── */
    function renderEditSection(sec) {
      var wrapper = el('div', { style: { marginBottom: '16px' } });
      var header = el('div', { style: {
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '12px 0', borderBottom: '1px solid ' + t.border
      } });
      header.appendChild(el('span', { style: { fontSize: '18px' } }, sec.icon));
      header.appendChild(el('span', { style: Object.assign({}, DS.font('md'), { fontWeight: '600', color: t.text }) }, sec.title));
      wrapper.appendChild(header);

      sec.fields.forEach(function (f) {
        wrapper.appendChild(renderEditField(f));
      });

      return wrapper;
    }

    /* ── EDIT FIELD ── */
    function renderEditField(field) {
      var wrap = el('div', { style: { padding: '10px 0' } });

      /* label */
      var labelEl = el('div', { style: Object.assign({}, DS.font('sm'), { color: t.text, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }) });
      if (field.important) {
        labelEl.appendChild(el('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: '#ff4444', flexShrink: '0' } }));
      }
      labelEl.appendChild(document.createTextNode(field.label));
      wrap.appendChild(labelEl);

      if (field.type === 'radio') {
        wrap.appendChild(renderRadioPills(field));
        if (field.hasComment) {
          wrap.appendChild(renderCommentInput(field));
        }
      } else if (field.type === 'score') {
        wrap.appendChild(renderScoreCircles(field));
      } else if (field.type === 'multi') {
        wrap.appendChild(renderMultiChips(field));
      } else if (field.type === 'text') {
        wrap.appendChild(renderTextInput(field));
      } else if (field.type === 'textarea') {
        wrap.appendChild(renderTextareaInput(field));
      }

      return wrap;
    }

    /* ── RADIO PILLS ── */
    function renderRadioPills(field) {
      var pillsWrap = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });

      field.options.forEach(function (opt) {
        var selected = editData[field.id] === opt.value;
        var pill = el('div', { className: 'asgard-wp-pill', style: {
          padding: '8px 16px', borderRadius: '20px', fontSize: '13px', cursor: 'pointer',
          border: '1px solid ' + t.border, transition: 'all 0.15s ease', userSelect: 'none'
        } }, opt.label);

        applyPillStyle(pill, opt.color, selected);

        pill.addEventListener('click', function () {
          /* toggle */
          if (editData[field.id] === opt.value) {
            delete editData[field.id];
          } else {
            editData[field.id] = opt.value;
          }
          if (navigator.vibrate) navigator.vibrate(10);
          /* re-render pills */
          var newPills = renderRadioPills(field);
          pillsWrap.parentNode.replaceChild(newPills, pillsWrap);
        });

        pill.addEventListener('touchstart', function () {
          pill.style.transform = 'scale(0.95)';
        }, { passive: true });
        pill.addEventListener('touchend', function () {
          pill.style.transform = 'scale(1)';
        }, { passive: true });

        pillsWrap.appendChild(pill);
      });

      return pillsWrap;
    }

    function applyPillStyle(pill, color, selected) {
      var c = WP_COLORS[color] || WP_COLORS.neutral;
      if (selected) {
        if (color === 'gold') {
          pill.style.background = 'linear-gradient(135deg, #ffd700, #ffaa00)';
          pill.style.color = '#000';
        } else {
          pill.style.background = c.text || '#888';
          pill.style.color = '#fff';
        }
        pill.style.borderColor = 'transparent';
      } else {
        pill.style.background = 'transparent';
        pill.style.color = t.textSec;
        pill.style.borderColor = t.border;
      }
    }

    /* ── COMMENT INPUT (textarea, expandable) ── */
    function renderCommentInput(field) {
      var wrap = el('div', { className: 'asgard-wp-comment', style: { marginTop: '6px' } });
      var val = editData[field.id + '_comment'] || '';
      var ta = el('textarea', { placeholder: '💬 Комментарий...', rows: '1', style: {
        height: '32px', padding: '6px 12px', fontSize: '13px',
        border: '1px solid ' + t.border, borderRadius: '10px',
        background: t.surfaceAlt, color: t.text, width: '100%', outline: 'none',
        transition: 'height 0.2s ease', resize: 'none', overflow: 'hidden',
        lineHeight: '20px', boxSizing: 'border-box'
      } });
      ta.value = val;
      ta.addEventListener('focus', function () {
        ta.style.height = '52px';
        ta.rows = 2;
      });
      ta.addEventListener('blur', function () {
        if (!ta.value) { ta.style.height = '32px'; ta.rows = 1; }
      });
      ta.addEventListener('input', function () {
        editData[field.id + '_comment'] = ta.value;
      });
      wrap.appendChild(ta);
      return wrap;
    }

    /* ── SCORE CIRCLES ── */
    function renderScoreCircles(field) {
      var wrap = el('div', { style: { display: 'flex', justifyContent: 'space-around', padding: '8px 0' } });

      field.options.forEach(function (opt) {
        var selected = editData[field.id] === opt.value;
        var c = WP_COLORS[opt.color] || WP_COLORS.neutral;
        var scoreColor = c.text || '#888';

        var item = el('div', { style: { textAlign: 'center', cursor: 'pointer' } });

        /* emoji */
        item.appendChild(el('div', { style: { fontSize: '20px', marginBottom: '4px' } }, opt.emoji));

        /* circle */
        var circle = el('div', { className: 'asgard-wp-score', style: {
          width: '56px', height: '56px', borderRadius: '50%',
          border: '2px solid ' + (selected ? scoreColor : t.border),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto', transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
          background: selected ? scoreColor : 'transparent',
          transform: selected ? 'scale(1.15)' : 'scale(1)',
          boxShadow: selected ? '0 0 20px ' + scoreColor + '60' : 'none'
        } });
        circle.appendChild(el('span', { style: { fontSize: '24px', fontWeight: '900', color: selected ? '#fff' : t.textSec } }, String(opt.value)));
        item.appendChild(circle);

        /* label */
        item.appendChild(el('div', { style: { fontSize: '11px', color: t.textSec, marginTop: '4px' } }, opt.label));

        item.addEventListener('click', function () {
          if (editData[field.id] === opt.value) {
            delete editData[field.id];
          } else {
            editData[field.id] = opt.value;
          }
          if (navigator.vibrate) navigator.vibrate(15);
          /* re-render */
          var newWrap = renderScoreCircles(field);
          wrap.parentNode.replaceChild(newWrap, wrap);
        });

        wrap.appendChild(item);
      });

      return wrap;
    }

    /* ── MULTI CHIPS ── */
    function renderMultiChips(field) {
      var wrap = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
      if (!editData[field.id]) editData[field.id] = [];
      var selected = editData[field.id];

      field.options.forEach(function (opt) {
        var isSelected = selected.indexOf(opt.value) !== -1;
        var chip = el('div', { style: {
          padding: '8px 16px', borderRadius: '20px', fontSize: '13px', cursor: 'pointer',
          border: '1px solid ' + (isSelected ? 'transparent' : t.border),
          background: isSelected ? (t.accent + '22') : 'transparent',
          color: isSelected ? t.accent : t.textSec,
          fontWeight: isSelected ? '600' : '400',
          transition: 'all 0.15s ease', userSelect: 'none'
        } }, opt.label);

        chip.addEventListener('click', function () {
          var idx = selected.indexOf(opt.value);
          if (idx === -1) { selected.push(opt.value); }
          else { selected.splice(idx, 1); }
          if (navigator.vibrate) navigator.vibrate(10);
          var newWrap = renderMultiChips(field);
          wrap.parentNode.replaceChild(newWrap, wrap);
        });

        wrap.appendChild(chip);
      });

      return wrap;
    }

    /* ── TEXT INPUT ── */
    function renderTextInput(field) {
      var val = editData[field.id] || '';
      var input = el('input', { type: 'text', value: val, placeholder: field.label, style: {
        height: '44px', padding: '8px 12px', fontSize: '14px',
        border: '1px solid ' + t.border, borderRadius: '12px',
        background: t.surfaceAlt, color: t.text, width: '100%', outline: 'none'
      } });
      input.addEventListener('input', function () { editData[field.id] = input.value; });
      input.addEventListener('focus', function () { input.style.borderColor = t.accent; });
      input.addEventListener('blur', function () { input.style.borderColor = t.border; });
      return input;
    }

    /* ── TEXTAREA INPUT ── */
    function renderTextareaInput(field) {
      var val = editData[field.id] || '';
      var ta = el('textarea', { placeholder: field.label, style: {
        minHeight: '60px', maxHeight: '120px', padding: '12px', fontSize: '14px',
        border: '1px solid ' + t.border, borderRadius: '12px',
        background: t.surfaceAlt, color: t.text, width: '100%', outline: 'none',
        resize: 'none', overflow: 'auto',
        borderLeft: field.important ? '3px solid #ff4444' : '1px solid ' + t.border
      } });
      ta.value = val;

      /* auto-grow */
      function autoGrow() {
        ta.style.height = 'auto';
        var h = Math.min(Math.max(ta.scrollHeight, 60), 120);
        ta.style.height = h + 'px';
      }
      ta.addEventListener('input', function () {
        editData[field.id] = ta.value;
        autoGrow();
      });
      ta.addEventListener('focus', function () {
        ta.style.borderColor = t.accent;
        ta.style.boxShadow = '0 0 0 3px ' + t.accent + '22';
      });
      ta.addEventListener('blur', function () {
        ta.style.borderColor = field.important ? '#ff4444' : t.border;
        ta.style.boxShadow = 'none';
      });
      setTimeout(autoGrow, 0);
      return ta;
    }

    /* ── SAVE ── */
    function doSave() {
      var counts = wpCountFilled(editData);

      /* Upload photo first if needed */
      var photoPromise;
      if (photoFile) {
        var fd = new FormData();
        fd.append('file', photoFile);
        photoPromise = fetch('/api/files/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '') },
          body: fd
        }).then(function (r) { return r.json(); }).then(function (res) {
          if (res.download_url) photoUrl = res.download_url;
        }).catch(function () { M.Toast({ message: '⚠️ Фото не загрузилось', type: 'warning' }); });
      } else {
        photoPromise = Promise.resolve();
      }

      return photoPromise.then(function () {
        return API.fetch('/worker-profiles/' + userId, {
          method: 'PUT',
          body: {
            data: editData,
            filled_count: counts.filled,
            total_count: counts.total,
            overall_score: editData.overall_score || null,
            photo_url: photoUrl || null
          }
        });
      }).then(function (resp) {
        profile = resp.profile;
        editMode = false;
        photoFile = null;
        M.Toast({ message: '✅ Анкета сохранена', type: 'success' });
        fadeTransition(renderView);
      }).catch(function (err) {
        M.Toast({ message: 'Ошибка сохранения', type: 'error' });
      });
    }

    /* ── CANCEL ── */
    function cancelEdit() {
      var currentJson = JSON.stringify(editData);
      var isDirty = currentJson !== originalJson || photoFile !== null;
      if (isDirty) {
        M.Confirm({ title: 'Отменить?', message: 'Несохранённые изменения будут потеряны', okText: 'Да', cancelText: 'Нет', danger: true }).then(function (ok) {
          if (ok) { editMode = false; fadeTransition(renderView); }
        });
      } else {
        editMode = false;
        fadeTransition(renderView);
      }
    }

    /* ── HELPERS ── */
    function getScoreColor(score) {
      var map = { 1: '#ff4444', 2: '#ff8c00', 3: '#888', 4: '#51cf66', 5: '#ffd700' };
      return map[score] || '#888';
    }

    return page;
  }
};

/* ══════════════════════════════════════════
   СПИСОК АНКЕТ
   ══════════════════════════════════════════ */
var WorkerProfilesPage = {
  render: function () {
    var el = Utils.el;
    var t = DS.t;
    var allProfiles = [];
    var filterValue = 'all';

    var page = el('div', { style: { background: t.bg, minHeight: '100vh', paddingBottom: '100px' } });
    page.appendChild(M.Header({ title: 'Анкеты рабочих', subtitle: 'ХАРАКТЕРИСТИКИ', back: true, backHref: '/more' }));

    /* Search */
    var searchWrap = el('div', { style: { padding: '0 16px 8px' } });
    var searchInput = el('input', { type: 'search', placeholder: '🔍 Поиск по имени...', style: {
      height: '44px', padding: '8px 16px', fontSize: '14px', width: '100%',
      border: '1px solid ' + t.border, borderRadius: '12px',
      background: t.surfaceAlt, color: t.text, outline: 'none'
    } });
    searchInput.addEventListener('input', function () { renderList(); });
    searchWrap.appendChild(searchInput);
    page.appendChild(searchWrap);

    /* Filter pills */
    var filters = [
      { label: 'Все', value: 'all' },
      { label: '⭐ 5', value: '5' },
      { label: '⭐ 4', value: '4' },
      { label: '⭐ 3', value: '3' },
      { label: '⭐ 1-2', value: '1-2' }
    ];
    var filterWrap = el('div', { style: { display: 'flex', gap: '6px', padding: '0 16px 12px', overflowX: 'auto' } });
    filterWrap.className = 'asgard-no-scrollbar';
    filters.forEach(function (f) {
      var pill = el('div', { style: {
        padding: '6px 14px', borderRadius: '16px', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap',
        border: '1px solid ' + t.border, color: t.textSec, transition: 'all 0.15s', flexShrink: '0'
      } }, f.label);
      pill._filterVal = f.value;
      pill.addEventListener('click', function () {
        filterValue = f.value;
        updateFilterPills();
        renderList();
      });
      filterWrap.appendChild(pill);
    });
    page.appendChild(filterWrap);

    function updateFilterPills() {
      var pills = filterWrap.children;
      for (var i = 0; i < pills.length; i++) {
        var p = pills[i];
        var active = p._filterVal === filterValue;
        p.style.background = active ? t.accent : 'transparent';
        p.style.color = active ? '#fff' : t.textSec;
        p.style.borderColor = active ? t.accent : t.border;
      }
    }
    updateFilterPills();

    /* List container */
    var listEl = el('div', { style: { padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '8px' } });
    listEl.appendChild(M.Skeleton({ type: 'card', count: 5 }));
    page.appendChild(listEl);

    /* Load */
    API.fetch('/worker-profiles').then(function (resp) {
      allProfiles = resp.rows || [];
      renderList();
    }).catch(function () {
      listEl.replaceChildren();
      listEl.appendChild(M.Empty({ text: 'Ошибка загрузки', icon: '❌' }));
    });

    function renderList() {
      listEl.replaceChildren();
      var query = (searchInput.value || '').toLowerCase();
      var filtered = allProfiles.filter(function (p) {
        if (query && (p.user_name || '').toLowerCase().indexOf(query) === -1) return false;
        if (filterValue === 'all') return true;
        if (filterValue === '1-2') return p.overall_score >= 1 && p.overall_score <= 2;
        return p.overall_score === parseInt(filterValue, 10);
      });

      if (!filtered.length) {
        listEl.appendChild(M.Empty({ text: 'Нет анкет', icon: '📋' }));
        return;
      }

      filtered.forEach(function (p, idx) {
        var card = el('div', { style: {
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '12px 14px', background: t.surface, borderRadius: '14px',
          border: '1px solid ' + t.border, cursor: 'pointer',
          animation: 'asgard-fade-in 0.3s ease ' + (Math.min(idx * 0.04, 0.6)) + 's both'
        } });

        /* Avatar 44px */
        var avatarUrl = p.photo_url || p.user_avatar;
        if (avatarUrl) {
          card.appendChild(el('div', { style: {
            width: '44px', height: '44px', borderRadius: '50%', flexShrink: '0',
            backgroundImage: 'url(' + avatarUrl + ')', backgroundSize: 'cover', backgroundPosition: 'center'
          } }));
        } else {
          card.appendChild(M.Avatar({ name: p.user_name || '?', size: 44 }));
        }

        /* Info */
        var info = el('div', { style: { flex: '1', minWidth: '0' } });
        info.appendChild(el('div', { style: Object.assign({}, DS.font('md'), { fontWeight: '600', color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }) }, p.user_name || '—'));

        /* roles */
        var data = typeof p.data === 'string' ? JSON.parse(p.data) : (p.data || {});
        var roles = data.recommended_role;
        if (Array.isArray(roles) && roles.length) {
          info.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.textSec }) }, roles.map(function (r) { return ROLE_LABELS[r] || r; }).join(', ')));
        }

        /* date */
        if (p.updated_at) {
          info.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.textTer }) }, new Date(p.updated_at).toLocaleDateString('ru-RU')));
        }
        card.appendChild(info);

        /* Score badge + mini progress */
        var rightCol = el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: '0' } });
        if (p.overall_score > 0) {
          var sc = p.overall_score;
          var scColor = { 1: '#ff4444', 2: '#ff8c00', 3: '#888', 4: '#51cf66', 5: '#ffd700' }[sc] || '#888';
          rightCol.appendChild(el('div', { style: {
            padding: '4px 10px', borderRadius: '8px', fontWeight: '700', fontSize: '14px',
            background: scColor + '22', color: scColor
          } }, String(sc)));
        }

        /* mini progress bar */
        if (p.filled_count > 0 && p.total_count > 0) {
          var pct = Math.round(p.filled_count / p.total_count * 100);
          var miniBar = el('div', { style: { width: '40px', height: '4px', borderRadius: '2px', background: t.border } });
          miniBar.appendChild(el('div', { style: { width: pct + '%', height: '100%', borderRadius: '2px', background: '#51cf66' } }));
          rightCol.appendChild(miniBar);
        }

        card.appendChild(rightCol);

        card.addEventListener('click', function () {
          Router.navigate('/worker-profile/' + p.user_id);
        });
        listEl.appendChild(card);
      });
    }

    return page;
  }
};

/* ── Register routes ── */
if (typeof Router !== 'undefined') {
  Router.register('/worker-profile/:id', WorkerProfilePage);
  Router.register('/worker-profiles', WorkerProfilesPage);
}
if (typeof window !== 'undefined') {
  window.WorkerProfilePage = WorkerProfilePage;
  window.WorkerProfilesPage = WorkerProfilesPage;
}
