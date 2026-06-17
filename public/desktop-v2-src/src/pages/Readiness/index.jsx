/**
 * Readiness — оба роута живут здесь:
 *   /readiness        — PM/руководители видят свои проекты в подготовке (карточки готовности)
 *   /readiness-board  — руководители видят сводку по РП (светофор + drill-down)
 *
 * App.jsx импортирует один из именованных компонентов: `Pm` или `Board`.
 *
 * Источник: vanilla `public/assets/js/readiness.js` (245 строк).
 *
 *   ✅ api.js                  — endpoints /api/work-readiness/* + /api/works + /api/users + хелперы
 *   ✅ Ring.jsx                — SVG-кольцо готовности
 *   ✅ StageDrawer.jsx         — Drawer-карточка работы с 7 этапами и override
 *   ✅ ReadinessPmPage.jsx     — страница РП
 *   ✅ ReadinessBoardPage.jsx  — страница директора
 *   ✅ readiness.css           — стили (CSS-переменные)
 */
export { default as Pm }    from './ReadinessPmPage';
export { default as Board } from './ReadinessBoardPage';
