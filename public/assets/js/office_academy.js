/**
 * Office Academy — Desktop CRM страница (тонкая обёртка над /api/office-academy/*)
 * Mobile-версия живёт в /m/office-academy (React).
 *
 * Поддерживает:
 *   - Список уроков с прогрессом (passed/attempts/score)
 *   - Открытие урока с блоками контента
 *   - Прохождение квиза с проверкой
 *   - Лидерборд по отделу
 */
window.AsgardOfficeAcademyPage = (function () {
  const { $, esc, toast, showModal, closeModal, formatDate } = AsgardUI;

  const TRACK_LABELS = {
    pm: 'Управление проектами',
    hr: 'Кадры',
    finance: 'Финансы',
    procurement: 'Закупки',
    management: 'Менеджмент',
    all: 'Общие знания'
  };

  async function api(method, path, body) {
    const token = localStorage.getItem('asgard_token');
    const opts = {
      method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch('/api/office-academy' + path, opts);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
    return data;
  }

  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }

    const body = `
      <style>
        .oa-stats { display:flex; gap:14px; flex-wrap:wrap; margin:14px 0 22px; }
        .oa-stat { background:var(--bg2); border:1px solid var(--brd); border-radius:12px; padding:14px 18px; flex:1; min-width:160px; }
        .oa-stat-v { font-size:24px; font-weight:700; color:var(--gold,#c8a84e); }
        .oa-stat-l { font-size:12px; color:var(--t3); margin-top:4px; text-transform:uppercase; letter-spacing:.05em; }

        .oa-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:16px; }
        .oa-card {
          background:var(--bg2); border:1px solid var(--brd); border-radius:14px; overflow:hidden;
          cursor:pointer; transition:transform .15s, border-color .15s, box-shadow .15s;
          display:flex; flex-direction:column;
        }
        .oa-card:hover { transform:translateY(-3px); border-color:rgba(200,168,78,.4); box-shadow:0 8px 24px rgba(0,0,0,.3); }
        .oa-cover { padding:24px 18px; display:flex; align-items:center; gap:14px; color:#fff; min-height:96px; }
        .oa-cover-icon { font-size:40px; line-height:1; }
        .oa-cover-title { font-size:14px; font-weight:700; line-height:1.3; }
        .oa-cover-saga { font-size:11px; opacity:.7; margin-top:3px; }
        .oa-body { padding:14px 18px; flex:1; display:flex; flex-direction:column; gap:8px; }
        .oa-meta { display:flex; gap:10px; flex-wrap:wrap; font-size:11px; color:var(--t3); }
        .oa-pill { padding:3px 8px; border-radius:99px; background:var(--bg3); font-weight:600; font-size:10px; }
        .oa-pill.ok { background:rgba(46,204,113,.15); color:#2ecc71; }
        .oa-pill.warn { background:rgba(241,196,15,.15); color:#f1c40f; }
        .oa-pill.must { background:rgba(231,76,60,.15); color:#e74c3c; }
        .oa-pill.track { background:rgba(91,141,239,.15); color:#5b8def; }
        .oa-progress { display:flex; align-items:center; gap:6px; font-size:12px; margin-top:auto; }

        /* Lesson modal */
        .oa-lesson-block { margin-bottom:18px; padding:14px 16px; border-radius:10px; background:var(--bg3); }
        .oa-lesson-block h3 { margin:0 0 8px; color:var(--gold,#c8a84e); font-size:14px; }
        .oa-lesson-block .oa-text { font-size:13px; line-height:1.6; white-space:pre-wrap; }
        .oa-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:18px; flex-wrap:wrap; }

        /* Quiz */
        .oa-q { background:var(--bg3); border:1px solid var(--brd); border-radius:10px; padding:14px 16px; margin-bottom:12px; }
        .oa-q-text { font-weight:600; margin-bottom:10px; font-size:13px; }
        .oa-q-opt { display:flex; align-items:flex-start; gap:8px; padding:8px 10px; border-radius:8px; cursor:pointer; transition:background .12s; }
        .oa-q-opt:hover { background:var(--bg2); }
        .oa-q-opt input { margin-top:3px; }
        .oa-q-opt.correct { background:rgba(46,204,113,.12); }
        .oa-q-opt.wrong { background:rgba(231,76,60,.12); }
      </style>

      <div class="panel">
        <div class="help">
          <b>🏛️ Академия Асгарда</b> — корпоративное обучение. Изучай уроки по своей роли, проходи квизы.
          За правильные ответы — баллы и место в лидерборде отдела.
        </div>
        <hr class="hr"/>
        <div id="oa_stats" class="oa-stats">
          <div class="oa-stat"><div class="oa-stat-v" id="s_total">—</div><div class="oa-stat-l">Уроков доступно</div></div>
          <div class="oa-stat"><div class="oa-stat-v" id="s_passed">—</div><div class="oa-stat-l">Пройдено</div></div>
          <div class="oa-stat"><div class="oa-stat-v" id="s_mandatory">—</div><div class="oa-stat-l">Обязательные не сданы</div></div>
          <div class="oa-stat"><button class="btn ghost" id="btnLeaderboard" style="width:100%">🏆 Лидерборд</button></div>
        </div>
        <div id="oa_grid" class="oa-grid">
          <div class="help">Загружаю...</div>
        </div>
      </div>
    `;
    await layout(body, { title: title || 'Академия Асгарда' });

    // Load lessons
    try {
      const data = await api('GET', '/lessons');
      const lessons = data.lessons || [];
      $('#s_total').textContent = data.total || 0;
      $('#s_passed').textContent = data.passed || 0;
      $('#s_mandatory').textContent = data.mandatory_pending || 0;
      renderGrid(lessons);
    } catch (e) {
      $('#oa_grid').innerHTML = `<div class="help" style="color:var(--err-t)">Ошибка загрузки: ${esc(e.message)}</div>`;
    }

    $('#btnLeaderboard').addEventListener('click', openLeaderboard);

    function renderGrid(lessons) {
      const grid = $('#oa_grid');
      if (!lessons.length) {
        grid.innerHTML = '<div class="help">Уроков для вашей роли пока нет. Подождите следующую месячную поставку.</div>';
        return;
      }
      grid.innerHTML = lessons.map(L => {
        const passed = !!L.passed;
        const attempted = L.attempts > 0;
        const trackLbl = TRACK_LABELS[L.track] || L.track;
        return `
          <div class="oa-card" data-id="${L.id}">
            <div class="oa-cover" style="background:${esc(L.cover_color || '#1e2840')}">
              <div class="oa-cover-icon">${esc(L.cover_icon || '🏛️')}</div>
              <div>
                <div class="oa-cover-title">${esc(L.title || '')}</div>
                ${L.saga ? `<div class="oa-cover-saga">${esc(L.saga)}</div>` : ''}
              </div>
            </div>
            <div class="oa-body">
              <div class="oa-meta">
                <span class="oa-pill track">${esc(trackLbl)}</span>
                ${L.is_mandatory ? '<span class="oa-pill must">Обязательно</span>' : ''}
                ${L.estimated_minutes ? `<span class="oa-pill">⏱ ${L.estimated_minutes} мин</span>` : ''}
              </div>
              <div class="oa-progress">
                ${passed ? `<span class="oa-pill ok">✓ Пройдено · ${L.score || 0}%</span>` :
                  attempted ? `<span class="oa-pill warn">Попыток: ${L.attempts}</span>` :
                  '<span class="oa-pill">Не начато</span>'}
              </div>
            </div>
          </div>
        `;
      }).join('');
      grid.querySelectorAll('.oa-card').forEach(card => {
        card.addEventListener('click', () => openLesson(Number(card.dataset.id)));
      });
    }
  }

  async function openLesson(lessonId) {
    let data;
    try {
      data = await api('GET', '/lessons/' + lessonId);
    } catch (e) {
      toast('Ошибка', 'Не удалось открыть урок: ' + e.message, 'err');
      return;
    }
    const lesson = data.lesson || data;
    const blocks = Array.isArray(lesson.blocks) ? lesson.blocks : (typeof lesson.blocks === 'string' ? JSON.parse(lesson.blocks || '[]') : []);
    const quizExists = (data.quiz_questions || []).length > 0;
    const passed = !!lesson.passed;

    const html = `
      <div class="help" style="margin-bottom:14px">
        ${lesson.saga ? `<b>${esc(lesson.saga)}</b> · ` : ''}
        ${lesson.estimated_minutes ? `⏱ ${lesson.estimated_minutes} мин` : ''}
      </div>
      <div id="oa_blocks">
        ${blocks.map(b => renderBlock(b)).join('') || '<div class="help">Контент урока пока не подготовлен</div>'}
      </div>
      <div class="oa-actions">
        <button class="btn ghost" id="btnLessonClose">Закрыть</button>
        ${quizExists ? `<button class="btn" id="btnQuiz" style="background:#c8a84e;color:#1a1000;font-weight:700">${passed ? '🔁 Пройти снова' : '🎯 Пройти квиз'}</button>` : ''}
        ${!quizExists && !lesson.read_completed_at ? `<button class="btn" id="btnComplete" style="background:#27ae60;color:#fff">✓ Прочитал</button>` : ''}
      </div>
    `;
    showModal({ title: lesson.title || 'Урок', icon: lesson.cover_icon || '🏛️', html, wide: true });

    document.getElementById('btnLessonClose').onclick = () => closeModal();

    // Mark read started
    api('POST', '/lessons/' + lessonId + '/start').catch(() => {});

    const btnQ = document.getElementById('btnQuiz');
    if (btnQ) btnQ.onclick = () => { closeModal(); openQuiz(lessonId, data.quiz_questions || []); };

    const btnC = document.getElementById('btnComplete');
    if (btnC) btnC.onclick = async () => {
      try { await api('POST', '/lessons/' + lessonId + '/complete'); toast('Готово', 'Урок отмечен прочитанным', 'ok'); closeModal(); render({ layout: window.AsgardLayout && AsgardLayout.layout, title:'Академия Асгарда' }); }
      catch (e) { toast('Ошибка', e.message, 'err'); }
    };
  }

  function renderBlock(b) {
    if (!b) return '';
    if (typeof b === 'string') return `<div class="oa-lesson-block"><div class="oa-text">${esc(b)}</div></div>`;
    const t = b.title ? `<h3>${esc(b.title)}</h3>` : '';
    if (b.type === 'image' && b.url) {
      return `<div class="oa-lesson-block">${t}<img src="${esc(b.url)}" style="max-width:100%;border-radius:8px"/></div>`;
    }
    if (b.type === 'list' && Array.isArray(b.items)) {
      return `<div class="oa-lesson-block">${t}<ul style="margin:0;padding-left:20px">${b.items.map(x => `<li style="margin:4px 0;font-size:13px">${esc(x)}</li>`).join('')}</ul></div>`;
    }
    if (b.type === 'quote' || b.type === 'tip') {
      return `<div class="oa-lesson-block" style="border-left:3px solid var(--gold,#c8a84e)">${t}<div class="oa-text"><i>${esc(b.text || '')}</i></div></div>`;
    }
    // default text
    return `<div class="oa-lesson-block">${t}<div class="oa-text">${esc(b.text || b.content || '')}</div></div>`;
  }

  async function openQuiz(lessonId, questions) {
    if (!questions.length) { toast('Квиз', 'Вопросов нет', 'warn'); return; }
    const html = questions.map((q, i) => {
      const opts = Array.isArray(q.options) ? q.options : (typeof q.options === 'string' ? JSON.parse(q.options || '[]') : []);
      return `
        <div class="oa-q" data-qid="${q.id}">
          <div class="oa-q-text">${i+1}. ${esc(q.question_text || '')}</div>
          ${opts.map((opt, oi) => `
            <label class="oa-q-opt" data-oi="${oi}">
              <input type="radio" name="q_${q.id}" value="${oi}"/>
              <span>${esc(opt.text || opt.label || opt)}</span>
            </label>
          `).join('')}
        </div>
      `;
    }).join('');

    showModal({
      title: 'Квиз',
      icon: '🎯',
      html: html + `
        <div class="oa-actions">
          <button class="btn ghost" id="btnQuizCancel">Отмена</button>
          <button class="btn" id="btnQuizSubmit" style="background:#c8a84e;color:#1a1000;font-weight:700">Отправить ответы</button>
        </div>
      `,
      wide: true
    });

    document.getElementById('btnQuizCancel').onclick = () => closeModal();
    document.getElementById('btnQuizSubmit').onclick = async () => {
      const answers = {};
      questions.forEach(q => {
        const sel = document.querySelector(`input[name="q_${q.id}"]:checked`);
        answers[q.id] = sel ? Number(sel.value) : -1;
      });
      try {
        const r = await api('POST', '/lessons/' + lessonId + '/quiz', { answers });
        toast('Квиз', `Результат: ${r.score || 0}% · ${r.passed ? 'Сдано' : 'Не сдано — попробуйте ещё раз'}`, r.passed ? 'ok' : 'warn', 6000);
        closeModal();
      } catch (e) {
        toast('Квиз', e.message, 'err');
      }
    };
  }

  async function openLeaderboard() {
    let data;
    try { data = await api('GET', '/leaderboard'); }
    catch (e) { toast('Лидерборд', e.message, 'err'); return; }
    const items = data.leaderboard || data.items || [];
    const html = items.length ? `
      <table class="asg" style="width:100%">
        <thead><tr><th>#</th><th>Сотрудник</th><th>Пройдено</th><th>Средний балл</th></tr></thead>
        <tbody>
          ${items.map((row, i) => `
            <tr>
              <td>${i+1}</td>
              <td>${esc(row.name || '—')}</td>
              <td>${row.lessons_passed || 0}</td>
              <td>${row.avg_score ? Math.round(row.avg_score) + '%' : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<div class="help">Лидерборд пока пуст — пройдите хотя бы один урок</div>';
    showModal({ title: '🏆 Лидерборд отдела', html, wide: false });
  }

  return { render };
})();
