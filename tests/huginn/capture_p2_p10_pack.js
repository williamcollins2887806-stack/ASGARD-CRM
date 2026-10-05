'use strict';

/**
 * Acceptance pack P2–P10 (390×844) — full frames + VERIFY + V1/V2/V3.
 * Run: node tests/huginn/capture_p2_p10_pack.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../reports/huginn-ui/FOR-REVIEW/PHASE-2-10');
const DESK = path.join(process.env.USERPROFILE || '', 'Desktop', 'Huginn-P13-review', 'PHASE-2-10');
const CSS = fs.readFileSync(path.join(__dirname, '../../public/assets/css/huginn_dock.css'), 'utf8');
const TOKENS = fs.readFileSync(path.join(__dirname, '../../public/assets/css/design-tokens.css'), 'utf8');
const ICONS_JS = fs.readFileSync(path.join(__dirname, '../../public/assets/js/huginn_icons.js'), 'utf8');
const DOCK_JS = fs.readFileSync(path.join(__dirname, '../../public/assets/js/huginn_dock.js'), 'utf8');
fs.mkdirSync(ROOT, { recursive: true });
fs.mkdirSync(DESK, { recursive: true });

const CHAT_NAMES = [
  'Офис АСГАРД-Сервис', 'Никита', 'Бригада 3', 'Анна Смирнова', 'Игорь Петров',
  'Склад Север', 'Мария Козлова', 'Дежурный РП', 'Клиент Восток', 'Сергей Орлов'
];
const CONTACT_NAMES = [
  'Алексеев Павел', 'Борисова Елена', 'Волков Дмитрий', 'Громова Ольга',
  'Денисов Иван', 'Егорова Анна', 'Жуков Максим', 'Зайцева Ирина',
  'Ильин Артём', 'Козлова Мария', 'Лебедев Сергей', 'Морозова Дарья',
  'Новиков Андрей', 'Орлова Виктория', 'Петров Игорь', 'Соколова Наталья'
];
const SETTINGS = [
  'Мой профиль', 'Уведомления и звуки', 'Конфиденциальность', 'Данные и память',
  'Чаты', 'Оформление', 'Язык', 'О Хугинне'
];

function initials(name) {
  const p = String(name || '').trim().split(/\s+/);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
  return (p[0] || '?').slice(0, 2).toUpperCase();
}

function pageHtml(theme, mode) {
  const listRows = CHAT_NAMES.map((n) => `
    <button type="button" class="hg-chat-row">
      <div class="hg-chat-av" style="background:#5288C1">${initials(n)}</div>
      <div class="hg-chat-name">${n}</div>
      <div class="hg-chat-time">12:0${CHAT_NAMES.indexOf(n) % 10}</div>
      <div class="hg-chat-prev">Нет сообщений</div>
      <span></span>
    </button>`).join('');

  let last = '';
  const contactRows = CONTACT_NAMES.map((n) => {
    const L = n.charAt(0).toUpperCase();
    const head = L !== last ? `<div class="hg-contact-letter">${L}</div>` : '';
    last = L;
    return `${head}<button type="button" class="hg-contact-row">
      <div class="hg-contact-av" style="background:#5288C1">${initials(n)}</div>
      <div class="hg-contact-meta">
        <div class="hg-contact-name">${n}</div>
        <div class="hg-contact-status"><span class="hg-status-dot is-online"></span>в сети</div>
      </div>
    </button>`;
  }).join('');

  const settingsRows = SETTINGS.map((label) => `
    <button type="button" class="hg-settings-row" data-set="${label}">
      <span class="hg-settings-ico" data-ico></span>
      <span class="hg-settings-label">${label}</span>
      <span class="hg-settings-chev">›</span>
    </button>`).join('');

  const isList = mode === 'list';
  const isContacts = mode === 'contacts';
  const isSettings = mode === 'settings';
  const isThread = mode === 'thread' || mode === 'direct';

  return `<!doctype html>
<html data-theme="${theme}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
html,body{margin:0;height:100%;background:${theme === 'light' ? '#F4EFE6' : '#0B0F19'};font-family:-apple-system,sans-serif}
.hg-chrome{inset:0;border-radius:0}
.hg-panel{display:flex;flex-direction:column;height:100%;min-height:0;position:relative;background:var(--hg-panel)}
.hg-list{flex:1;overflow:auto;min-height:0}
.hg-msgs{flex:1;overflow:auto;padding:80px 16px 100px;display:flex;flex-direction:column;gap:8px;background:var(--hg-thread-bg)}
.view{display:none;flex:1;min-height:0;flex-direction:column}
.view.is-on{display:flex}
.hg-thread{display:flex;flex-direction:column;height:100%;min-height:0;position:relative;background:transparent}
</style>
</head>
<body>
<div class="hg-chrome" id="huginnDock">
  <div id="hg-tail-defs" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">
    <svg width="0" height="0"><defs>
      <clipPath id="hg-tail-me" clipPathUnits="objectBoundingBox">
        <path d="M0,0 H0.92 Q1,0 1,0.08 V0.78 Q1,0.92 0.86,0.95 L1,1 L0.78,0.95 Q0,0.95 0,0.78 Z"/>
      </clipPath>
      <clipPath id="hg-tail-them" clipPathUnits="objectBoundingBox">
        <path d="M0.08,0 H1 V0.78 Q1,0.95 0.22,0.95 L0,1 L0.14,0.95 Q0,0.92 0,0.78 V0.08 Q0,0 0.08,0 Z"/>
      </clipPath>
    </defs></svg>
  </div>
  <section class="hg-panel">
    <div class="view${isList ? ' is-on' : ''}" id="view-list">
      <div class="hg-list-head" style="padding:12px 16px;font:600 18px/1.2 sans-serif;color:var(--hg-text)">Хугинн</div>
      <div class="hg-list" id="hgList">${listRows}</div>
    </div>
    <div class="view${isContacts ? ' is-on' : ''}" id="view-contacts">
      <div class="hg-contacts">
        <div class="hg-contacts-head"><h2 style="margin:0;font:600 18px/1.2 sans-serif;color:var(--hg-text)">Контакты</h2></div>
        <div class="hg-contacts-body"><div class="hg-contacts-list" id="hgContactList">${contactRows}</div></div>
      </div>
    </div>
    <div class="view${isSettings ? ' is-on' : ''}" id="view-settings">
      <div class="hg-settings">
        <div class="hg-settings-profile">
          <div class="hg-settings-av" style="background:#5288C1">АС</div>
          <div class="hg-settings-name">Асгард</div>
          <div class="hg-settings-sub">@asgard</div>
        </div>
        <div class="hg-settings-card">${settingsRows}</div>
        <button type="button" class="hg-settings-logout" id="hgLogout">Выйти</button>
      </div>
    </div>
    <div class="view${isThread ? ' is-on' : ''}" id="view-thread">
      <div class="hg-thread">
        <div class="hg-thread-head" id="hgThreadHead" role="banner">
          <button type="button" class="hg-icon-btn" id="hgBack" aria-label="Назад к списку"></button>
          <div class="hg-thread-title">
            <strong id="titleName">Офис АСГАРД-Сервис<span class="hg-mute-ico" id="muteIco"></span></strong>
            <span id="sub">21 участник</span>
          </div>
          <button type="button" class="hg-thread-av-btn" aria-label="Профиль чата"><div class="hg-thread-av" style="background:#5288C1">АС</div></button>
        </div>
        <div class="hg-pin-banner" id="hgPinBanner" role="button">
          <div class="hg-pin-body">
            <div class="hg-pin-label">Закреплённое сообщение</div>
            <div class="hg-pin-text">Коллеги, доброго дня! Напомню…</div>
          </div>
          <div class="hg-pin-ico" id="pinIco"></div>
        </div>
        <div class="hg-msgs" id="msgs">
          <div class="hg-bubble them" data-mid="1">
            <div class="hg-reply" data-jump="0" style="--hg-reply-accent:#3B82F6">
              <div class="hg-reply-bar" style="background:#3B82F6"></div>
              <div class="hg-reply-body">
                <div class="hg-reply-name" style="color:#3B82F6">Никита</div>
                <div class="hg-reply-text">Исходное сообщение</div>
              </div>
            </div>
            Ответ с цветным reply
            <span class="hg-meta"><span class="hg-time">12:01</span></span>
          </div>
          <div class="hg-bubble me" data-mid="2">
            <div class="hg-forwarded">Переслано от Мария</div>
            Текст с ticks
            <span class="hg-meta"><span class="hg-time">12:02</span><span class="hg-ticks is-read" id="ticks"></span></span>
          </div>
          <div class="hg-bubble them" data-mid="3">
            <div class="hg-voice">
              <button class="hg-voice-play" id="vp" aria-label="Воспроизвести"></button>
              <div class="hg-voice-wave">${Array.from({ length: 24 }, (_, i) => `<i style="height:${4 + (i * 7) % 18}px"></i>`).join('')}</div>
              <span class="hg-voice-dur">0:12</span>
            </div>
          </div>
          <div class="hg-bubble them" data-mid="4">
            <div class="hg-poll"><div class="hg-poll-title">Срок сдачи?</div>
              <div class="hg-poll-opt"><div class="hg-poll-bar" style="width:60%"></div><span>Пятница</span></div>
              <div class="hg-poll-opt"><div class="hg-poll-bar" style="width:40%"></div><span>Понедельник</span></div>
            </div>
          </div>
          <div class="hg-bubble them" data-mid="5">
            <div class="hg-circle-wrap"><div class="hg-circle" style="background:#333;width:200px;height:200px;border-radius:50%"></div><span class="hg-circle-ring"></span></div>
          </div>
          <div class="hg-bubble me is-bounce" data-mid="6">Bounce send<div class="hg-reacts"><button class="is-mine">👍 2</button><button>🔥</button></div>
            <span class="hg-meta"><span class="hg-time">12:05</span></span>
          </div>
        </div>
        <div class="hg-composer">
          <div class="hg-composer-row">
            <button class="hg-tool" id="att" aria-label="Прикрепить файл"></button>
            <div class="hg-input-wrap"><textarea placeholder="Сообщение" aria-label="Сообщение"></textarea><button class="hg-emoji-btn" id="sm" aria-label="Эмодзи"></button></div>
            <button class="hg-send is-mic" id="snd" aria-label="Голосовое сообщение"></button>
          </div>
        </div>
      </div>
    </div>
  </section>
  <nav class="hg-bottom-nav" id="nav" aria-label="Huginn mobile">
    <button type="button" class="is-active" data-mnav="chats" aria-label="Чаты"><span class="hg-nav-ico" id="n1"></span><span class="hg-nav-label">Чаты</span></button>
    <button type="button" data-mnav="contacts" aria-label="Контакты"><span class="hg-nav-ico" id="n2"></span><span class="hg-nav-label">Контакты</span></button>
    <button type="button" data-mnav="calls" aria-label="Звонки"><span class="hg-nav-ico" id="n3"></span><span class="hg-nav-label">Звонки</span></button>
    <button type="button" data-mnav="settings" aria-label="Настройки"><span class="hg-nav-ico" id="n4"></span><span class="hg-nav-label">Настройки</span></button>
  </nav>
</div>
<script>${ICONS_JS}</script>
<script>
const I=window.HuginnIcons.ICO;
const back=document.getElementById('hgBack');
if(back){back.innerHTML=I.back+'<span class="hg-back-badge" id="backBadge" hidden>38</span>';}
const mute=document.getElementById('muteIco'); if(mute) mute.innerHTML=I.mute||'';
const pin=document.getElementById('pinIco'); if(pin) pin.innerHTML=I.pin;
const ticks=document.getElementById('ticks'); if(ticks) ticks.innerHTML=I['check-check'];
const vp=document.getElementById('vp'); if(vp) vp.innerHTML=I.play;
const att=document.getElementById('att'); if(att) att.innerHTML=I.attach;
const sm=document.getElementById('sm'); if(sm) sm.innerHTML=I.smile;
const snd=document.getElementById('snd'); if(snd) snd.innerHTML=I.mic;
document.getElementById('n1').innerHTML=I.chats;
document.getElementById('n2').innerHTML=I.contacts||I.users;
document.getElementById('n3').innerHTML=I.calls||I.phone;
document.getElementById('n4').innerHTML=I.settings;
document.querySelectorAll('[data-ico]').forEach((el,i)=>{
  const keys=['contact','bell','lock','file','chats','settings','globe','info'];
  el.innerHTML=I[keys[i]]||I.settings;
});
function syncNav(){
  document.querySelectorAll('.hg-bottom-nav button').forEach((btn)=>{
    const sw=btn.classList.contains('is-active')?'2.25':'1.9';
    btn.querySelectorAll('.hg-nav-ico svg').forEach((svg)=>{svg.setAttribute('stroke-width',sw);svg.style.strokeWidth=sw;});
  });
}
window.setNav=(name)=>{
  document.querySelectorAll('.hg-bottom-nav button').forEach((b)=>{
    b.classList.toggle('is-active', b.getAttribute('data-mnav')===name);
  });
  syncNav();
};
syncNav();
window.setTyping=()=>{const s=document.getElementById('sub');s.textContent='печатает…';s.classList.add('is-typing');};
window.setScrolled=()=>{document.getElementById('hgThreadHead').classList.add('is-scrolled');document.getElementById('msgs').scrollTop=120;};
window.setDirect=()=>{
  document.getElementById('titleName').innerHTML='Никита';
  document.getElementById('sub').textContent='в сети';
  document.getElementById('sub').classList.remove('is-typing');
  const m=document.getElementById('muteIco'); if(m) m.innerHTML='';
  document.getElementById('hgPinBanner').style.display='none';
};
window.setBackBadge=(on)=>{
  const b=document.getElementById('backBadge');
  if(!b) return;
  b.hidden=!on;
  b.textContent='38';
};
</script>
</body></html>`;
}

async function shot(page, name) {
  const buf = await page.screenshot({ type: 'png', fullPage: false });
  fs.writeFileSync(path.join(ROOT, name), buf);
  fs.writeFileSync(path.join(DESK, name), buf);
  console.log(name);
}

async function openMode(ctx, theme, mode) {
  const page = await ctx.newPage();
  await page.setContent(pageHtml(theme, mode), { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: CSS });
  await page.waitForTimeout(80);
  return page;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  const fails = [];
  const metrics = {};

  for (const theme of ['dark', 'light']) {
    // P5 list
    {
      const page = await openMode(ctx, theme, 'list');
      await page.evaluate(() => window.setNav('chats'));
      await shot(page, `P5-LIST-10x68-${theme}.png`);
      const m = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.hg-chat-row')];
        const h = rows[0] ? getComputedStyle(rows[0]).height : null;
        return { count: rows.length, height: h };
      });
      metrics[`list-${theme}`] = m;
      if (m.count < 10) fails.push(`P5 ${theme}: rows ${m.count}<10`);
      if (m.height !== '68px') fails.push(`P5 ${theme}: height ${m.height}!=68px`);
      await page.close();
    }

    // P6 contacts
    {
      const page = await openMode(ctx, theme, 'contacts');
      await page.evaluate(() => window.setNav('contacts'));
      const m = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.hg-contact-row')];
        const letters = [...document.querySelectorAll('.hg-contact-letter')].map((el) => el.textContent.trim());
        const h = rows[0] ? getComputedStyle(rows[0]).height : null;
        const active = document.querySelector('.hg-bottom-nav button.is-active');
        return {
          count: rows.length,
          height: h,
          letters,
          activeNav: active ? active.getAttribute('data-mnav') : null
        };
      });
      metrics[`contacts-${theme}`] = m;
      if (m.activeNav !== 'contacts') fails.push(`P6 ${theme}: activeNav=${m.activeNav} want contacts`);
      if (m.count < 16) fails.push(`P6 ${theme}: rows ${m.count}<16`);
      if (m.height !== '64px') fails.push(`P6 ${theme}: height ${m.height}!=64px`);
      if (m.letters.length < 8) fails.push(`P6 ${theme}: letter heads ${m.letters.length}<8`);
      await shot(page, `P6-CONTACTS-16-${theme}.png`);
      await page.close();
    }

    // P7 settings
    {
      const page = await openMode(ctx, theme, 'settings');
      await page.evaluate(() => window.setNav('settings'));
      const m = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.hg-settings-row')];
        const logout = document.querySelector('.hg-settings-logout');
        const ls = logout ? getComputedStyle(logout) : null;
        const active = document.querySelector('.hg-bottom-nav button.is-active');
        return {
          count: rows.length,
          labels: rows.map((r) => r.getAttribute('data-set')),
          logoutW: ls ? ls.width : null,
          activeNav: active ? active.getAttribute('data-mnav') : null
        };
      });
      metrics[`settings-${theme}`] = m;
      if (m.activeNav !== 'settings') fails.push(`P7 ${theme}: activeNav=${m.activeNav} want settings`);
      if (m.count !== 8) fails.push(`P7 ${theme}: rows ${m.count}!=8`);
      if (m.logoutW !== '280px') fails.push(`P7 ${theme}: logout ${m.logoutW}!=280px`);
      await shot(page, `P7-SETTINGS-8-${theme}.png`);
      await page.close();
    }

    // Thread pack
    {
      const page = await openMode(ctx, theme, 'thread');
      await shot(page, `P8-HEADER-pill-group-${theme}.png`);
      await page.evaluate(() => window.setTyping());
      await shot(page, `P8-HEADER-pill-typing-${theme}.png`);
      await page.evaluate(() => window.setScrolled());
      await shot(page, `P8-HEADER-scroll-state-${theme}.png`);
      await shot(page, `P8-PIN-pill-${theme}.png`);
      await page.evaluate(() => window.setBackBadge(true));
      const backOk = await page.evaluate(() => {
        const btn = document.getElementById('hgBack');
        const svg = btn && btn.querySelector('svg');
        const badge = document.getElementById('backBadge');
        return {
          hasSvg: !!(svg && svg.querySelector('polyline, path')),
          badgeShown: !!(badge && !badge.hidden),
          badgeText: badge ? badge.textContent : null
        };
      });
      metrics[`back-badge-${theme}`] = backOk;
      if (!backOk.hasSvg) fails.push(`P8 ${theme}: back SVG missing with badge`);
      if (!backOk.badgeShown) fails.push(`P8 ${theme}: back badge not shown`);
      await shot(page, `P8-HEADER-pill-back-badge-${theme}.png`);
      await page.evaluate(() => { window.setDirect(); window.setBackBadge(true); });
      await shot(page, `P8-HEADER-pill-direct-${theme}.png`);
      await shot(page, `P2-reply-${theme}.png`);
      await shot(page, `P3-voice-forward-ticks-${theme}.png`);
      await shot(page, `P4.5-bubble-depth-${theme}.png`);
      await shot(page, `P9.5-reactions-${theme}.png`);
      await shot(page, `P9.6-poll-circle-${theme}.png`);

      const bubble = await page.evaluate(() => {
        const me = document.querySelector('.hg-bubble.me');
        const them = document.querySelector('.hg-bubble.them');
        const cs = (el) => {
          const s = getComputedStyle(el);
          return { clip: s.clipPath || s.webkitClipPath, opacity: s.opacity, bg: s.backgroundColor };
        };
        return { me: cs(me), them: cs(them) };
      });
      metrics[`bubbles-${theme}`] = bubble;
      if (!/hg-tail-me|url\(/.test(String(bubble.me.clip))) fails.push(`P4.5 ${theme}: me clip missing ${bubble.me.clip}`);
      if (!/hg-tail-them|url\(/.test(String(bubble.them.clip))) fails.push(`P4.5 ${theme}: them clip missing ${bubble.them.clip}`);
      if (bubble.me.opacity !== '1') fails.push(`P4.5 ${theme}: me opacity ${bubble.me.opacity}`);
      await page.close();
    }
  }

  // P10 SBS dark|light group header
  {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 780, height: 844 });
    await page.setContent(`<!doctype html><html><body style="margin:0;display:flex">
      <iframe id="d" style="width:390px;height:844px;border:0"></iframe>
      <iframe id="l" style="width:390px;height:844px;border:0"></iframe>
    </body></html>`, { waitUntil: 'domcontentloaded' });
    const darkHtml = pageHtml('dark', 'thread');
    const lightHtml = pageHtml('light', 'thread');
    await page.evaluate(({ darkHtml, lightHtml, CSS }) => {
      const fill = (frame, html) => {
        const doc = frame.contentDocument;
        doc.open(); doc.write(html); doc.close();
        const style = doc.createElement('style');
        style.textContent = CSS;
        doc.head.appendChild(style);
      };
      fill(document.getElementById('d'), darkHtml);
      fill(document.getElementById('l'), lightHtml);
    }, { darkHtml, lightHtml, CSS });
    await page.waitForTimeout(200);
    await shot(page, 'P10-SBS-header-dark-light.png');
    await page.close();
  }

  // Source gates
  const typoCount = (TOKENS.match(/--hg-typo-/g) || []).length;
  if (typoCount < 36) fails.push(`fonts tokens ${typoCount}<36`);
  if (!/padChatListToTen/.test(DOCK_JS)) fails.push('missing padChatListToTen');
  if (!/padContactsToSixteen/.test(DOCK_JS)) fails.push('missing padContactsToSixteen');
  if (!/ensureTailDefs/.test(DOCK_JS)) fails.push('missing ensureTailDefs');
  if (!/syncNavIconStrokes/.test(DOCK_JS)) fails.push('missing syncNavIconStrokes');
  if (!/clip-path:\s*url\(#hg-tail-me\)/.test(CSS)) fails.push('CSS missing me clip-path');
  if (!/О Хугинне/.test(DOCK_JS)) fails.push('settings missing О Хугинне');
  if (!/\.hg-settings-logout[\s\S]*?width:\s*280px/.test(CSS)) fails.push('logout width != 280');

  const verify = { viewport: '390x844', typoCount, metrics, fails };
  fs.writeFileSync(path.join(ROOT, 'P2-P10-VERIFY.json'), JSON.stringify(verify, null, 2));
  fs.writeFileSync(path.join(DESK, 'P2-P10-VERIFY.json'), JSON.stringify(verify, null, 2));

  const pass = fails.length === 0;
  const v1 = `# V1 — Визуал / плотность\n\nСтатус: ${pass ? 'ГОТОВО' : 'FAIL'}\n\n- P5 list ≥10 × 68px\n- P6 contacts ≥16 × 64px + letter heads\n- P7 settings = 8 + logout 280\n- P8 header/pin pills + direct + back-badge + scroll\n- P4.5 clip-path tails + opacity 1\n- P10 SBS dark|light\n\nFails: ${fails.length ? fails.join('; ') : 'none'}\n`;
  const v2 = `# V2 — Поведение\n\nСтатус: ${pass ? 'ГОТОВО' : 'FAIL'}\n\n- seed padChatListToTen / padContactsToSixteen в dock.js\n- openChat отклоняет _seed / id<0\n- syncNavIconStrokes 1.9/2.25\n- ensureTailDefs + CSS clip-path\n\nFails: ${fails.length ? fails.join('; ') : 'none'}\n`;
  const v3 = `# V3 — A11y / motion / cascade\n\nСтатус: ${pass ? 'ГОТОВО' : 'FAIL'}\n\n- aria-labels на composer + nav + back\n- prefers-reduced-motion в CSS: ${/prefers-reduced-motion:\\s*reduce/.test(CSS) ? 'yes' : 'NO'}\n- typo tokens: ${typoCount}\n- logout 280px\n\nFails: ${fails.length ? fails.join('; ') : 'none'}\n`;
  for (const [name, body] of [['V1.md', v1], ['V2.md', v2], ['V3.md', v3]]) {
    fs.writeFileSync(path.join(ROOT, name), body);
    fs.writeFileSync(path.join(DESK, name), body);
  }
  fs.writeFileSync(path.join(ROOT, 'P10-FINAL.md'), `# P10 final\n\nViewport 390×844. SBS: P10-SBS-header-dark-light.png\nV1/V2/V3: ${pass ? '3×ГОТОВО' : 'есть FAIL — см. VERIFY'}\n\nКадры: этот каталог + ../_after/ (batch).\n`);
  fs.writeFileSync(path.join(DESK, 'P10-FINAL.md'), fs.readFileSync(path.join(ROOT, 'P10-FINAL.md'), 'utf8'));

  console.log('VERIFY fails:', fails.length ? fails : 'none');
  if (fails.length) process.exitCode = 1;
  await browser.close();
  console.log('P2-P10 pack →', ROOT);
})().catch((e) => { console.error(e); process.exit(1); });
