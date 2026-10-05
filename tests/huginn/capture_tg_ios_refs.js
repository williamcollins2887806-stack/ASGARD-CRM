'use strict';

/**
 * Telegram iOS parity frames vs user refs (390×844).
 * Run: node tests/huginn/capture_tg_ios_refs.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/TG-IOS');
const DESK = path.join(process.env.USERPROFILE || '', 'Desktop', 'Huginn-P13-review', 'TG-IOS');
const CSS = fs.readFileSync(path.join(__dirname, '../../public/assets/css/huginn_dock.css'), 'utf8');
const ICONS_JS = fs.readFileSync(path.join(__dirname, '../../public/assets/js/huginn_icons.js'), 'utf8');
const PATTERN = fs.readFileSync(path.join(__dirname, '../../public/assets/img/hg-chat-pattern.svg'));
const PATTERN_URI = 'data:image/svg+xml;base64,' + PATTERN.toString('base64');
fs.mkdirSync(ROOT, { recursive: true });
fs.mkdirSync(DESK, { recursive: true });

function page(mode) {
  const list = [
    ['Анализ тендеров', 'Черновик: Всех приветствую 👋', '09/17', true, false, 0, '#3B82F6'],
    ['Офис АСГАРД-Сервис', 'Елена: Коллеги, доброго дня!', 'Чт', true, true, 0, '#5288C1'],
    ['Избранное', '📄 График_работ_КАО.pdf', '05/12', true, false, 0, '#0A84FF'],
    ['Никита', '📷 Фотография', 'Вт', true, false, 0, '#30D158'],
    ['Бригада 3', 'Выехали на объект', '15:01', false, false, 3, '#FF9F0A'],
    ['Анна Смирнова', 'Договор на подписи', '14:20', false, false, 8, '#BF5AF2'],
    ['Склад Север', '🎬 Отгрузка готова', '00:16', false, true, 43, '#636366'],
    ['Дежурный РП', 'Просчёт закрыт', '12:40', false, false, 2, '#64D2FF'],
    ['Клиент Восток', 'Ждём КП до пятницы', 'Пт', false, true, 12, '#FF453A'],
    ['Сергей Орлов', 'Ок, на месте', '11:05', false, false, 0, '#AF52DE']
  ];
  const listHtml = list.map(([name, prev, time, pin, mute, unread, color]) => {
    const ini = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
    const isDraft = prev.startsWith('Черновик');
    const prevHtml = isDraft
      ? `<span class="hg-draft">Черновик: </span>${prev.replace('Черновик: ', '')}`
      : prev;
    return `<button type="button" class="hg-chat-row">
      <div class="hg-chat-av" style="background:${color}">${ini}</div>
      <div class="hg-chat-name">${name}${mute ? '<span class="hg-chat-icons" id="m' + name.length + '"></span>' : ''}</div>
      <div class="hg-chat-time">${pin ? '<span class="hg-chat-icons pin"></span>' : ''}${time}</div>
      <div class="hg-chat-prev">${prevHtml}</div>
      ${unread ? `<span class="hg-badge${mute ? ' is-muted' : ''}">${unread}</span>` : '<span></span>'}
    </button>`;
  }).join('');

  const settingsGroups = [
    [['Мой профиль', 'is-red', 'contact']],
    [['Избранное', 'is-blue', 'bookmark'], ['Недавние звонки', 'is-green', 'phone'], ['Устройства', 'is-orange', 'settings']],
    [['Уведомления и звуки', 'is-red', 'bell'], ['Конфиденциальность', 'is-gray', 'lock'], ['Данные и память', 'is-cyan', 'file'], ['Чаты', 'is-blue', 'chats'], ['Оформление', 'is-purple', 'settings'], ['Язык', 'is-gray', 'globe'], ['О Хугинне', 'is-blue', 'info']]
  ];
  const settingsHtml = settingsGroups.map((g) => `<div class="hg-settings-card">${g.map(([label, tone, ico]) => `
    <button type="button" class="hg-settings-row"><span class="hg-settings-ico ${tone}" data-ico="${ico}"></span><span class="hg-settings-label">${label}</span><span class="hg-settings-chev">›</span></button>`).join('')}</div>`).join('');

  const isList = mode === 'list';
  const isSettings = mode === 'settings';
  const isThread = mode === 'thread' || mode === 'thread-kb';
  const kb = mode === 'thread-kb';

  return `<!doctype html>
<html data-theme="dark">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
html,body{margin:0;height:100%;background:#000;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}
.hg-chrome{inset:0;border-radius:0}
.hg-panel{display:flex;flex-direction:column;height:100%;background:#000}
.view{display:none;flex:1;min-height:0;flex-direction:column}
.view.is-on{display:flex}
.hg-list{flex:1;overflow:auto;background:#000}
.hg-list-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;color:#fff}
.hg-list-head .edit{color:#0A84FF;font:500 17px/1 sans-serif}
.hg-list-head h1{margin:0;font:700 17px/1.2 sans-serif}
.hg-list-head .acts{display:flex;gap:10px;color:#0A84FF}
.hg-msgs{flex:1;overflow:auto;padding:70px 12px 90px;display:flex;flex-direction:column;gap:8px;
  background-color:#0B141A;
  background-image:radial-gradient(ellipse at 50% 40%, rgba(255,255,255,0.02) 0%, transparent 70%), url('${PATTERN_URI}');
  background-size:100% 100%, 240px 240px; background-repeat:no-repeat, repeat;}
.hg-bubble{max-width:82%;padding:8px 12px;border-radius:18px;color:#fff;font:400 16px/1.35 -apple-system,sans-serif}
.hg-bubble.them{align-self:flex-start;background:rgba(36,36,38,0.92);border-bottom-left-radius:6px}
.hg-bubble.me{align-self:flex-end;background:#2B5278;border-bottom-right-radius:6px}
.hg-meta{float:right;margin:4px 0 0 8px;font:400 11px/1 sans-serif;color:rgba(255,255,255,0.55)}
.fake-kb{height:280px;background:#1C1C1E;border-top:0.5px solid rgba(84,84,88,0.55);color:#fff;display:${kb ? 'flex' : 'none'};flex-direction:column;align-items:center;justify-content:center;font:500 14px/1.3 sans-serif;gap:8px}
.msg-av{width:32px;height:32px;border-radius:50%;background:#5288C1;color:#fff;display:inline-flex;align-items:center;justify-content:center;font:600 12px/1 sans-serif;margin-right:6px;flex:0 0 auto}
.row-them{display:flex;align-items:flex-end;gap:6px;align-self:flex-start;max-width:92%}
</style>
</head>
<body>
<div class="hg-chrome${isThread ? ' is-thread' : ''}${kb ? ' is-composer-focus' : ''}" id="huginnDock">
  <section class="hg-panel">
    <div class="view${isList ? ' is-on' : ''}" id="v-list">
      <div class="hg-list-head"><span class="edit">Изм.</span><h1>Чаты</h1><span class="acts" id="acts"></span></div>
      <div class="hg-list">${listHtml}</div>
    </div>
    <div class="view${isSettings ? ' is-on' : ''}" id="v-set">
      <div class="hg-settings">
        <div class="hg-settings-profile">
          <div class="hg-settings-av" style="background:#5288C1">Н</div>
          <div class="hg-settings-name">Никита</div>
          <div class="hg-settings-sub">+7 916 061-48-09 · @elite</div>
          <button type="button" class="hg-settings-photo-btn" id="photoBtn">Изменить фотографию</button>
        </div>
        ${settingsHtml}
        <button type="button" class="hg-settings-logout">Выйти</button>
      </div>
    </div>
    <div class="view${isThread ? ' is-on' : ''}" id="v-thread">
      <div class="hg-thread" style="display:flex;flex-direction:column;height:100%;min-height:0">
        <div class="hg-thread-head">
          <button type="button" class="hg-icon-btn" id="hgBack" aria-label="Назад"></button>
          <div class="hg-thread-title">
            <strong>Офис АСГАРД-Сервис<span class="hg-mute-ico" id="muteIco"></span></strong>
            <span>21 участник</span>
          </div>
          <button type="button" class="hg-thread-av-btn"><div class="hg-thread-av" style="background:#5288C1">АС</div></button>
        </div>
        <div class="hg-pin-banner">
          <div class="hg-pin-body">
            <div class="hg-pin-label">Закреплённое сообщение</div>
            <div class="hg-pin-text">Коллеги, доброго дня! 📣 Напомню, что…</div>
          </div>
          <div class="hg-pin-ico" id="pinIco"></div>
        </div>
        <div class="hg-msgs">
          <div class="hg-bubble them">Сроки предоставления документов по объекту согласовать до пятницы. Просьба не затягивать 🙏<span class="hg-meta">16:28</span></div>
          <div class="row-them"><div class="msg-av">ЕС</div><div class="hg-bubble them">Уважаемые коллеги! просьба очень ускориться по вашим долгам 👆<span class="hg-meta">16:29</span></div></div>
        </div>
        <div class="hg-composer">
          <div class="hg-composer-row">
            <button class="hg-tool" id="att" aria-label="Прикрепить"></button>
            <div class="hg-input-wrap"><textarea placeholder="Сообщение" aria-label="Сообщение"></textarea><button class="hg-emoji-btn" id="sm" aria-label="Эмодзи"></button></div>
            <button class="hg-send is-mic" id="snd" aria-label="Голосовое"></button>
          </div>
        </div>
        <div class="fake-kb">клавиатура (iOS) · скрытый nav</div>
      </div>
    </div>
  </section>
  <nav class="hg-bottom-nav" id="nav">
    <button type="button" data-mnav="contacts"><span class="hg-nav-ico" id="n1"></span><span class="hg-nav-label">Контакты</span></button>
    <button type="button" data-mnav="calls"><span class="hg-nav-ico" id="n2"></span><span class="hg-nav-label">Звонки</span></button>
    <button type="button" data-mnav="chats" class="${isSettings ? '' : 'is-active'}"><span class="hg-nav-ico" id="n3"></span><span class="hg-nav-label">Чаты</span></button>
    <button type="button" data-mnav="settings" class="${isSettings ? 'is-active' : ''}"><span class="hg-nav-ico" id="n4"></span><span class="hg-nav-label">Настройки</span></button>
  </nav>
  <button type="button" class="hg-nav-search" id="hgNavSearch" aria-label="Поиск"></button>
</div>
<script>${ICONS_JS}</script>
<script>
const I=window.HuginnIcons.ICO;
document.getElementById('n1').innerHTML=I.contacts||I.users;
document.getElementById('n2').innerHTML=I.calls||I.phone;
document.getElementById('n3').innerHTML=I.chats+'<span class="hg-nav-badge">38</span>';
document.getElementById('n4').innerHTML=I.settings;
const sr=document.getElementById('hgNavSearch'); if(sr) sr.innerHTML=I.search;
const back=document.getElementById('hgBack');
if(back) back.innerHTML=I.back+'<span class="hg-back-badge">38</span>';
const mute=document.getElementById('muteIco'); if(mute) mute.innerHTML=I.mute||'';
const pin=document.getElementById('pinIco'); if(pin) pin.innerHTML=I.pin;
const att=document.getElementById('att'); if(att) att.innerHTML=I.attach;
const sm=document.getElementById('sm'); if(sm) sm.innerHTML=I.smile;
const snd=document.getElementById('snd'); if(snd) snd.innerHTML=I.mic;
const photo=document.getElementById('photoBtn'); if(photo) photo.innerHTML=(I.image||'')+' Изменить фотографию';
document.querySelectorAll('[data-ico]').forEach((el)=>{ el.innerHTML=I[el.getAttribute('data-ico')]||I.settings; });
document.querySelectorAll('.hg-chat-icons.pin').forEach((el)=>{ el.innerHTML=I.pin; });
document.querySelectorAll('.hg-chat-name .hg-chat-icons').forEach((el)=>{ el.innerHTML=I.mute||I['volume-x']; });
const acts=document.getElementById('acts'); if(acts) acts.innerHTML=I.plus+I.compose;
</script>
</body></html>`;
}

async function shot(p, name) {
  const buf = await p.screenshot({ type: 'png', fullPage: false });
  fs.writeFileSync(path.join(ROOT, name), buf);
  fs.writeFileSync(path.join(DESK, name), buf);
  console.log(name);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  for (const [mode, name] of [
    ['settings', 'TG-REF-settings-dark.png'],
    ['list', 'TG-REF-list-dark.png'],
    ['thread', 'TG-REF-thread-dark.png'],
    ['thread-kb', 'TG-REF-thread-kb-dark.png']
  ]) {
    const p = await ctx.newPage();
    await p.setContent(page(mode), { waitUntil: 'domcontentloaded' });
    await p.addStyleTag({ content: CSS });
    await p.waitForTimeout(120);
    await shot(p, name);
    await p.close();
  }
  await browser.close();
  console.log('TG-IOS →', ROOT, 'and', DESK);
})().catch((e) => { console.error(e); process.exit(1); });
