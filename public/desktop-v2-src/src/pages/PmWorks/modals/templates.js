/**
 * templates.js — React-helper для генерации HTML-документов комплекта.
 *
 * Порт vanilla `public/assets/js/templates.js` (window.AsgardTemplates).
 *   • buildClientRequest({tender, estimate, extraText})  → HTML «Запрос клиенту»
 *   • buildTKP({tender, estimate, extraText})            → HTML «ТКП»
 *   • buildCoverLetter({tender, estimate, subject, bodyText}) → HTML «Сопроводительное»
 *   • downloadRequest / downloadTKP / downloadCover      → сборка HTML + blob-скачивание
 *
 * Отличия от vanilla:
 *   • Настройки берутся через REST: GET /api/settings/docs и /api/settings/app
 *     (с graceful-fallback на {} если 404).
 *   • Логотип — статический /assets/img/asgard_logo.png. Кэширование в памяти модуля
 *     (грузим один раз за сессию). Если fetch не удался — рендерим без логотипа.
 *   • Цвета внутри HTML-документа — это печатный шаблон (PDF/печать заказчиком),
 *     токены темы тут не применимы: документ всегда «бумажный» с фирменной палитрой.
 *     ВНЕ HTML (в JSX-модалке) хардкод-цветов нет.
 */
import { api } from '@/api/client';

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Кэш настроек/логотипа за сессию модалки. */
let _logoDataUrl = null;
let _docsSettings = null;
let _companyProfile = null;

async function getDocsSettings() {
  if (_docsSettings) return _docsSettings;
  try {
    const d = await api('/api/settings/docs', { silent: true });
    _docsSettings = (d && (d.value || d)) || {};
  } catch {
    _docsSettings = {};
  }
  return _docsSettings;
}

async function getCompanyProfile() {
  if (_companyProfile) return _companyProfile;
  try {
    const d = await api('/api/settings/app', { silent: true });
    const app = (d && (d.value || d)) || {};
    _companyProfile = app.company_profile || {};
  } catch {
    _companyProfile = {};
  }
  return _companyProfile;
}

async function loadLogoDataUrl() {
  if (_logoDataUrl) return _logoDataUrl;
  try {
    const resp = await fetch('/assets/img/asgard_logo.png');
    if (!resp.ok) throw new Error('logo fetch ' + resp.status);
    const blob = await resp.blob();
    _logoDataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
  } catch {
    _logoDataUrl = '';
  }
  return _logoDataUrl;
}

function wrapLetter({ title, subtitle, bodyHtml, footerHtml, logoDataUrl, company }) {
  // Печатный документ — фиксированная палитра (это не UI-страница).
  const css = `
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; color:#0D1117; margin:0; background:#fff;}
    .page{padding:34px 42px;}
    .top{display:flex; gap:18px; align-items:center; border-bottom:2px solid #0D1117; padding-bottom:12px; margin-bottom:18px;}
    .logo{width:92px; height:auto;}
    .h1{font-size:18px; font-weight:800; letter-spacing:.3px;}
    .h2{font-size:12px; color:#334155; margin-top:4px;}
    .box{border:1px solid #cbd5e1; padding:14px 16px; border-radius:6px;}
    .p{font-size:13px; line-height:1.5; margin:10px 0;}
    .muted{color:#475569; font-size:12px;}
    .sig{margin-top:18px; display:flex; justify-content:space-between; gap:20px; align-items:flex-end;}
    .line{border-bottom:1px solid #0D1117; width:240px; height:18px;}
    .stamp{font-size:11px; color:#475569;}
    .rune{margin:16px 0; border-top:1px dashed #94a3b8;}
  `;
  const c = company || {};
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(title || 'Документ')}</title><style>${css}</style></head>
<body><div class="page">
  <div class="top">
    ${logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="ASGARD"/>` : ''}
    <div>
      <div class="h1">${esc(c.company_name || 'ООО «АСГАРД-Сервис»')} • CRM</div>
      <div class="h2">${esc(subtitle || 'Внутренний документ')}</div>
    </div>
  </div>
  <div class="box">
    <div class="h1">${esc(title || 'Документ')}</div>
    <div class="muted">${esc(new Date().toLocaleDateString('ru-RU'))}</div>
    <div class="rune"></div>
    ${bodyHtml || ''}
    <div class="rune"></div>
    ${footerHtml || ''}
    <div class="sig">
      <div>
        <div class="muted">Подпись</div>
        <div class="line"></div>
      </div>
      <div class="stamp">Директор: ${esc(c.director_fio || '')}</div>
    </div>
  </div>
</div></body></html>`;
}

/**
 * Запрос клиенту (паритет vanilla buildClientRequest, templates.js:85).
 */
export async function buildClientRequest({ tender, estimate, extraText = '' } = {}) {
  const ds = await getDocsSettings();
  const company = await getCompanyProfile();
  const logo = await loadLogoDataUrl();
  const body = `
    <div class="p"><b>Кому:</b> ${esc(tender?.customer_name || '')}</div>
    <div class="p"><b>Тема:</b> Запрос уточнений по закупке / объекту работ</div>
    <div class="p">Просим предоставить уточняющие данные и/или документы, необходимые для корректного расчёта и подготовки предложения.</div>
    <div class="p"><b>Закупка / ссылка:</b> ${tender?.purchase_url ? `<span>${esc(tender.purchase_url)}</span>` : `<span class="muted">не указано</span>`}</div>
    <div class="p"><b>Плановые сроки работ:</b> ${esc(tender?.work_start_plan || '—')} — ${esc(tender?.work_end_plan || '—')}</div>
    <div class="p">${esc(extraText || ds.request_extra || '')}</div>
    <div class="p" style="margin-top:14px"><b>Контакты:</b> ${esc(ds.contacts || '')}</div>
  `;
  const footer = `<div class="muted">Примечание: документ сформирован сборкой CRM. Ссылки/вложения прикладываются отдельно.</div>`;
  return wrapLetter({
    title: 'Запрос клиенту',
    subtitle: 'Видим цель. Берём след. Ведём до победы.',
    bodyHtml: body,
    footerHtml: footer,
    logoDataUrl: logo,
    company
  });
}

/**
 * ТКП (паритет vanilla buildTKP, templates.js:102).
 */
export async function buildTKP({ tender, estimate, extraText = '' } = {}) {
  const ds = await getDocsSettings();
  const company = await getCompanyProfile();
  const logo = await loadLogoDataUrl();
  const price = estimate?.price_tkp ?? tender?.tender_price ?? '';
  const vat = Number(ds.vat_pct ?? 22);
  const n = Number(price || 0);
  const withVat = (Number.isFinite(n) && n > 0) ? Math.round(n * (1 + vat / 100)) : '';
  const body = `
    <div class="p"><b>Заказчик:</b> ${esc(tender?.customer_name || '')}</div>
    <div class="p"><b>Работа:</b> ${esc(tender?.tender_title || '')}</div>
    <div class="p"><b>Период:</b> ${esc(tender?.work_start_plan || '—')} — ${esc(tender?.work_end_plan || '—')}</div>
    <div class="p"><b>Цена (без НДС):</b> ${esc(price || '—')}</div>
    <div class="p"><b>НДС, %:</b> ${esc(vat)}</div>
    <div class="p"><b>Цена (с НДС):</b> ${esc(withVat || '—')}</div>
    <div class="p"><b>Условия оплаты:</b> ${esc(estimate?.payment_terms || ds.payment_terms || '')}</div>
    <div class="p">${esc(extraText || ds.tkp_extra || '')}</div>
    <div class="p" style="margin-top:14px"><b>Контакты:</b> ${esc(ds.contacts || '')}</div>
  `;
  const footer = `<div class="muted">Примечание: финальная ведомость работ/смета прикладывается отдельно.</div>`;
  return wrapLetter({
    title: 'Технико-коммерческое предложение (ТКП)',
    subtitle: 'Счёт точен. Решение крепко. Ошибки не проходят.',
    bodyHtml: body,
    footerHtml: footer,
    logoDataUrl: logo,
    company
  });
}

/**
 * Сопроводительное письмо (паритет vanilla buildCoverLetter, templates.js:125).
 */
export async function buildCoverLetter({ tender, estimate, subject = '', bodyText = '' } = {}) {
  const ds = await getDocsSettings();
  const company = await getCompanyProfile();
  const logo = await loadLogoDataUrl();
  const subj = subject || ds.cover_subject || 'Сопроводительное письмо';
  const body = `
    <div class="p"><b>Кому:</b> ${esc(tender?.customer_name || '')}</div>
    <div class="p"><b>Тема:</b> ${esc(subj)}</div>
    <div class="p">${esc(bodyText || ds.cover_body || 'Направляем документы/материалы по обращению. Готовы оперативно ответить на вопросы и уточнения.')}</div>
    <div class="p"><b>Работа / закупка:</b> ${esc(tender?.tender_title || '—')}</div>
    <div class="p"><b>Ссылка на площадку:</b> ${tender?.purchase_url ? `<span>${esc(tender.purchase_url)}</span>` : `<span class="muted">не указано</span>`}</div>
    <div class="p" style="margin-top:14px"><b>Контакты:</b> ${esc(ds.contacts || '')}</div>
  `;
  const footer = `<div class="muted">Примечание: вложения прикладываются отдельными файлами/ссылками.</div>`;
  return wrapLetter({
    title: 'Сопроводительное письмо',
    subtitle: 'Слово Ярла — закон. Счёт должен быть чист.',
    bodyHtml: body,
    footerHtml: footer,
    logoDataUrl: logo,
    company
  });
}

/** Скачать blob с произвольным контентом. */
export function downloadBlob(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export async function downloadRequest(tender, estimate) {
  const html = await buildClientRequest({ tender, estimate });
  const name = `ASGARD_Request_${(tender?.id || '')}_${new Date().toISOString().slice(0, 10)}.html`;
  downloadBlob(name, 'text/html;charset=utf-8', html);
}

export async function downloadTKP(tender, estimate) {
  const html = await buildTKP({ tender, estimate });
  const name = `ASGARD_TKP_${(tender?.id || '')}_v${estimate?.version_no || 1}_${new Date().toISOString().slice(0, 10)}.html`;
  downloadBlob(name, 'text/html;charset=utf-8', html);
}

export async function downloadCover(tender, estimate) {
  const html = await buildCoverLetter({ tender, estimate });
  const name = `ASGARD_Cover_${(tender?.id || '')}_${new Date().toISOString().slice(0, 10)}.html`;
  downloadBlob(name, 'text/html;charset=utf-8', html);
}

/** Сбросить кэш (для тестов). */
export function _resetTemplatesCache() {
  _logoDataUrl = null;
  _docsSettings = null;
  _companyProfile = null;
}
