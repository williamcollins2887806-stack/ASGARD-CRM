/**
 * ASGARD CRM — Mimir: модалка выбора способа расчёта (Сессия 3)
 * ═══════════════════════════════════════════════════════════════════════════
 * Единая точка входа для кнопки «⚡ Просчитать». Фича-флагов НЕТ — Conductor
 * доступен всем сразу. По клику открывается модалка с двумя вариантами:
 *   🧙 Быстрый расчёт  → старый поток (window.openMimirAutoEstimate)
 *   🎼 Полный (Conductor) → /conductor-estimate.html?work_id=N&start=1
 *
 * Используется из pm_calcs.js / pm_works.js / tenders.js. Подключается в
 * index.html до этих модулей. Экспортирует window.openEstimateMethodPicker.
 * ═══════════════════════════════════════════════════════════════════════════
 */
(function () {
  'use strict';

  function quickFlow(workId, tenderId) {
    if (typeof window.openMimirAutoEstimate === 'function') {
      if (workId) window.openMimirAutoEstimate(workId);
      else window.openMimirAutoEstimate(null, tenderId);
    } else {
      // Фолбэк на отдельную страницу старого авто-просчёта.
      const qp = workId ? `work_id=${workId}` : `tender_id=${tenderId}`;
      window.location.href = `/auto-estimate.html?${qp}&start=1`;
    }
  }

  function conductorFlow(workId, tenderId) {
    const qp = workId ? `work_id=${workId}` : `tender_id=${tenderId}`;
    window.location.href = `/conductor-estimate.html?${qp}&start=1`;
  }

  /**
   * Открыть модалку выбора способа расчёта.
   * @param {number|null} workId
   * @param {number|null} [tenderId]
   */
  function openEstimateMethodPicker(workId, tenderId) {
    workId = workId || null;
    tenderId = tenderId || null;

    if (!window.AsgardUI || typeof window.AsgardUI.showModal !== 'function') {
      // UI-модуль не загружен — сразу старый поток (не блокируем пользователя).
      quickFlow(workId, tenderId);
      return;
    }

    window.AsgardUI.showModal({
      title: 'Выбор способа расчёта сметы',
      icon: '🧮',
      wide: true,
      html: `
        <div class="mc-pick-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:8px 4px">
          <button type="button" class="mc-pick-card" id="mcPickQuick">
            <div style="font-size:36px;margin-bottom:8px">🧙</div>
            <div style="font-weight:700;font-size:16px">Быстрый расчёт</div>
            <div style="font-size:12px;opacity:.7;margin-top:6px">Один AI-агент. 1–3 минуты.</div>
            <div style="font-size:11px;opacity:.7;margin-top:10px">Для простых работ до ~1 млн ₽: типовые услуги, стандартные ТО, короткий состав работ.</div>
            <div style="margin-top:12px;font-size:11px;color:#2ea043">✓ ≈ 5–15 ₽</div>
          </button>
          <button type="button" class="mc-pick-card mc-pick-card--featured" id="mcPickConductor">
            <div style="font-size:36px;margin-bottom:8px">🎼</div>
            <div style="font-weight:700;font-size:16px">Полный просчёт (Conductor)</div>
            <div style="font-size:12px;opacity:.7;margin-top:6px">Бригада агентов-специалистов. 10–60 минут.</div>
            <div style="font-size:11px;opacity:.7;margin-top:10px">Для крупных контрактов и сложных работ. Анализ ТЗ, закупки, логистика, нормативы, риски, адвокат дьявола, директорский отчёт.</div>
            <div style="margin-top:12px;font-size:11px;color:#2ea043">✓ ≈ 100–800 ₽</div>
          </button>
        </div>
        <div style="text-align:center;font-size:11px;opacity:.6;margin-top:12px">
          Не уверены? Начните с быстрого — полный можно запустить позже.
        </div>`,
      onMount: (root) => {
        const scope = root && root.querySelector ? root : document;
        const q = scope.querySelector('#mcPickQuick');
        const c = scope.querySelector('#mcPickConductor');
        if (q) q.addEventListener('click', () => { window.AsgardUI.hideModal(); quickFlow(workId, tenderId); });
        if (c) c.addEventListener('click', () => { window.AsgardUI.hideModal(); conductorFlow(workId, tenderId); });
      }
    });

    // Подстраховка, если onMount не вызывается в текущей версии showModal.
    setTimeout(() => {
      const q = document.getElementById('mcPickQuick');
      const c = document.getElementById('mcPickConductor');
      if (q && !q._mcBound) { q._mcBound = true; q.addEventListener('click', () => { window.AsgardUI.hideModal(); quickFlow(workId, tenderId); }); }
      if (c && !c._mcBound) { c._mcBound = true; c.addEventListener('click', () => { window.AsgardUI.hideModal(); conductorFlow(workId, tenderId); }); }
    }, 30);
  }

  window.openEstimateMethodPicker = openEstimateMethodPicker;
})();
