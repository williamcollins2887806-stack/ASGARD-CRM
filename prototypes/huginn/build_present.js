#!/usr/bin/env node
/** Huginn present v2 — soft rail + full media boards generator */
const fs = require('fs');
const path = require('path');

const I = {
  mimir: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3.5l2.1 1.2 2.4-.2.9 2.2 2.1 1.2-1.1 2.1.6 2.3-2.3.6-1.2 2.1-2.2-.9-2.3.6-.6-2.3-2.1-1.2.2-2.4-1.2-2.1 2.1-.9L12 3.5z"/><circle cx="12" cy="12" r="2.4"/><path d="M12 9.6v4.8M9.6 12h4.8"/></svg>`,
  huginn: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4.5 8.5c1.2-2.8 4-4.5 7-4.5 4.2 0 7.5 2.6 7.5 6.2 0 2.4-1.4 4.4-3.6 5.5l1.4 3.3c.2.4-.3.8-.7.6l-3.5-1.6c-.4.05-.8.1-1.2.1-4.2 0-7.5-2.6-7.5-6.2 0-1.2.4-2.3 1.1-3.2z"/><path d="M9.2 10.2c.6-.7 1.5-1.1 2.5-1.1"/><circle cx="10.2" cy="11.2" r="0.7" fill="currentColor"/><path d="M14.8 9.4c.55.35.9.9.9 1.55"/></svg>`,
  ting: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="6" width="11" height="12" rx="2.5"/><path d="M14 10.2l5.2-2.4a1 1 0 0 1 1.4.9v6.6a1 1 0 0 1-1.4.9L14 13.8"/><circle cx="7.2" cy="12" r="1.4"/><circle cx="10.6" cy="12" r="1.4"/></svg>`,
  search: `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`,
  close: `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  plus: `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M12 5v14M5 12h14"/></svg>`,
  back: `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M15 6l-6 6 6 6"/></svg>`,
  send: `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M5 12h12M13 6l6 6-6 6"/></svg>`,
  mic: `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`,
  attach: `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M21 12.5V7a5 5 0 0 0-10 0v10a3 3 0 0 0 6 0V8"/></svg>`,
  emoji: `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1.2 1.4 2.7 2 3.5 2s2.3-.6 3.5-2"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/></svg>`,
  phone: `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.5-1.2a2 2 0 0 1 2.1-.4c.9.3 1.7.6 2.6.7A2 2 0 0 1 22 16.9z"/></svg>`,
  play: `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`,
  hangup: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M6.5 16.5c2.2 2.2 5.8 2.8 8.5.8l1.8-1.3-1.8-3.1-2 1.2c-1.5.9-3.4.6-4.7-.7s-1.6-3.2-.7-4.7l1.2-2-3.1-1.8-1.3 1.8c-2 2.7-1.4 6.3.8 8.5z"/></svg>`,
  home: `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/></svg>`,
  grid: `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
  user: `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/></svg>`,
  mute: `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M11 5L6 9H3v6h3l5 4V5zM22 9l-6 6M16 9l6 6"/></svg>`,
  cam: `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14M4 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/></svg>`,
  trash: `<svg class="ico ico-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>`,
};

function wf(n = 18) {
  return `<div class="waveform">${Array.from({ length: n }, () => '<i></i>').join('')}</div>`;
}

function crmSmeta() {
  return `
    <aside class="crm-sidenav">
      <div class="crm-brand" title="ASGARD"><span>AS</span></div>
      <div class="crm-nav-ico is-on" title="Главная">${I.home}</div>
      <div class="crm-nav-ico" title="Разделы">${I.grid}</div>
      <div class="crm-nav-ico" title="Профиль">${I.user}</div>
    </aside>
    <div class="crm-main">
      <div class="crm-topbar">
        <div>
          <h3>Смета · Северная башня</h3>
          <div class="meta">Просчёт #2041 · без НДС</div>
        </div>
        <div class="crm-top-actions">
          <button class="btn btn-ghost" type="button">Экспорт</button>
          <button class="btn btn-blue" type="button">Сохранить</button>
        </div>
      </div>
      <div class="crm-content">
        <div class="crm-card">
          <h4>Итого работ</h4>
          <p class="crm-sum">4 200 000 ₽</p>
          <p>Оборудование отдельно · chrome справа всегда с вами.</p>
        </div>
        <table class="crm-table">
          <thead><tr><th>Раздел</th><th>Сумма</th><th>Статус</th></tr></thead>
          <tbody>
            <tr><td><strong>Работы</strong></td><td>3,1 млн</td><td><span class="chip gold">просчёт</span></td></tr>
            <tr><td><strong>G · оборудование</strong></td><td>1,1 млн</td><td><span class="chip ok">1:1</span></td></tr>
            <tr><td><strong>Согласование</strong></td><td>—</td><td><span class="chip blue">директор</span></td></tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

function rail(active) {
  const item = (key, label, icon, badge) => `
    <button class="asg-rail-btn${active === key ? ' is-on' : ''}" type="button" title="${label}">
      <span class="asg-rail-ico">${icon}${badge || ''}</span>
      <span class="asg-rail-label">${label}</span>
    </button>`;
  return `
    <aside class="asg-rail">
      ${item('mimir', 'Мимир', I.mimir)}
      ${item('huginn', 'Хугинн', I.huginn, '<span class="badge">3</span>')}
      ${item('ting', 'Тинг', I.ting)}
      <div class="asg-rail-spacer"></div>
    </aside>`;
}

function composer({ picker = false, recording = false } = {}) {
  if (recording) {
    return `
      <div class="voice-rec-bar">
        <button class="asg-icon-btn danger" type="button" title="Отменить">${I.trash}</button>
        <div class="voice-rec-wave">${wf(24)}<span class="rec-timer">0:12</span></div>
        <button class="send-disc" type="button" title="Отправить">${I.send}</button>
      </div>`;
  }
  const pickerHtml = picker ? `
    <div class="emoji-picker sticker-tray">
      <button type="button" class="emoji-cell tray-raven" title="Хугинн"></button>
      <button type="button" class="emoji-cell tray-mimir" title="Мимир"></button>
      <button type="button" class="emoji-cell tray-ting" title="Тинг"></button>
      <button type="button" class="emoji-cell tray-ok" title="Ок"></button>
      <button type="button" class="emoji-cell tray-gold" title="Gold"></button>
      <button type="button" class="emoji-cell tray-shield" title="Щит"></button>
      <button type="button" class="emoji-cell tray-note" title="Заметка"></button>
      <button type="button" class="emoji-cell tray-bolt" title="Срочно"></button>
    </div>` : '';
  return `
    <div class="composer">
      <button class="asg-icon-btn" type="button" title="Вложение">${I.attach}</button>
      <button class="asg-icon-btn emoji-btn${picker ? ' is-on' : ''}" type="button" title="Смайлики">${I.emoji}</button>
      <input class="hg-field" placeholder="Сообщение" />
      <button class="mic-ring" type="button" title="Голос">${I.mic}</button>
      <button class="send-disc" type="button" title="Отправить">${I.send}</button>
    </div>${pickerHtml}`;
}

function panelHuginnList() {
  return `
    <div class="asg-panel-head">
      <div class="brand-row"><h3>Хугинн</h3><span>Вороний Вестник</span></div>
      <button class="asg-icon-btn gold" type="button" title="Новый чат">${I.plus}</button>
      <button class="asg-icon-btn" type="button" title="Свернуть">${I.close}</button>
    </div>
    <div class="asg-panel-body">
      <div class="hg-search"><div class="hg-search-wrap">${I.search}<input class="hg-field" placeholder="Поиск" /></div></div>
      <div class="hg-tabs">
        <button class="is-on" type="button">Все</button>
        <button type="button">Личные</button>
        <button type="button">Новые</button>
        <button type="button">Клиенты</button>
      </div>
      <div class="hg-status-label">Статусы команды</div>
      <div class="hg-stories">
        <div class="hg-story"><div class="hg-story-ring"><div class="avatar gold">РП</div></div><span>Дежурный</span></div>
        <div class="hg-story"><div class="hg-story-ring"><div class="avatar">ОБ</div></div><span>На объекте</span></div>
        <div class="hg-story"><div class="hg-story-ring"><div class="avatar gold">ОВ</div></div><span>Клиент</span></div>
        <div class="hg-story"><div class="hg-story-ring is-seen"><div class="avatar red">ОФ</div></div><span>Офис</span></div>
      </div>
      <div class="hg-list">
        <div class="hg-item is-active">
          <div class="avatar gold">ОВ<div class="dot"></div></div>
          <div><div class="name">Ольга Васильева <span class="chip client">клиент</span></div><div class="preview">Ждём КП до пятницы…</div></div>
          <div class="meta"><div class="time">12:04</div><span class="badge">2</span></div>
        </div>
        <div class="hg-item">
          <div class="avatar-stack"><div class="avatar sm">РП</div><div class="avatar sm gold">ДК</div></div>
          <div><div class="name">РП · Северная башня <span class="chip">группа</span></div><div class="preview">Дмитрий: голосовое готово</div></div>
          <div class="meta"><div class="time">11:40</div><span class="badge">1</span></div>
        </div>
        <div class="hg-item">
          <div class="avatar gold">МИ</div>
          <div><div class="name">Мимир</div><div class="preview">Смета пересчитана · без НДС</div></div>
          <div class="meta"><div class="time">пн</div></div>
        </div>
      </div>
    </div>`;
}

function panelMimir() {
  return `
    <div class="asg-panel-head">
      <div class="brand-row"><h3>Мимир</h3><span>AI · сметы и регламенты</span></div>
      <button class="asg-icon-btn" type="button">${I.close}</button>
    </div>
    <div class="asg-panel-body">
      <div class="mimir-hero">
        <div class="rune">ᛗ</div>
        <h4>Спрашивайте по смете</h4>
        <p>Отвечает в контексте CRM · без ухода со страницы</p>
      </div>
      <div class="hg-stream">
        <div class="msg in"><div class="avatar gold sm">МИ</div><div class="bubble">Готов помочь по просчёту #2041.<span class="time">сейчас</span></div></div>
        <div class="msg out"><div class="bubble">Сравни блок G с прошлой версией<span class="time">12:02</span></div></div>
        <div class="msg in"><div class="avatar gold sm">МИ</div><div class="bubble">Оборудование +180 тыс · наценка не применяется (1:1).<span class="time">сейчас</span></div></div>
      </div>
      ${composer()}
    </div>`;
}

function threadHead(opts = {}) {
  if (opts.group) {
    return `
      <div class="hg-thread-head">
        <button class="asg-icon-btn" type="button">${I.back}</button>
        <div class="avatar-stack lg"><div class="avatar sm gold">РП</div><div class="avatar sm">ДК</div><div class="avatar sm red">ОВ</div></div>
        <div class="info"><strong>РП · Северная башня</strong><span>6 участников · группа</span></div>
        <div class="hg-actions"><button class="asg-icon-btn" type="button" title="Тинг">${I.ting}</button></div>
      </div>`;
  }
  return `
    <div class="hg-thread-head">
      <button class="asg-icon-btn" type="button">${I.back}</button>
      <div class="avatar gold sm">ОВ<div class="dot"></div></div>
      <div class="info"><strong>Ольга Васильева</strong><span>в сети · клиент</span></div>
      <div class="hg-actions"><button class="asg-icon-btn" type="button" title="Аудио">${I.phone}</button></div>
    </div>`;
}

function panelThread(mode = 'cards') {
  let stream = '';
  if (mode === 'group') {
    stream = `
      <div class="hg-day">Сегодня</div>
      <div class="msg in"><div class="avatar sm">ДК</div><div class="bubble"><b class="sender">Дмитрий</b>Смету без НДС можно слать клиенту<span class="time">11:50</span></div></div>
      <div class="msg in"><div class="avatar sm gold">РП</div><div class="bubble"><b class="sender">Дежурный РП</b>Закрепил просчёт #2041 в группе<span class="time">11:55</span></div></div>
      <div class="msg out"><div class="bubble">Ок, созвон в Тинг в 14:30<span class="time">12:01</span></div></div>`;
  } else if (mode === 'voice-play') {
    stream = `
      <div class="hg-day">Сегодня</div>
      <div class="msg in">
        <div class="avatar sm">ДК</div>
        <div class="bubble voice-card">
          <div class="voice"><button class="voice-play" type="button">${I.play}</button>${wf()}<span class="time">0:18</span></div>
          <div class="transcript">
            <b>РАСШИФРОВКА · SpeechKit</b>
            «Ольге можно отправить смету без НДС. Блок G согласован, оборудование один к одному. Ждём директора.»
          </div>
        </div>
      </div>
      <div class="msg out"><div class="bubble">Принял, отправлю КП до 15:00<span class="time">12:05</span></div></div>`;
  } else if (mode === 'voice-rec') {
    stream = `
      <div class="hg-day">Сегодня</div>
      <div class="msg in"><div class="avatar sm gold">ОВ</div><div class="bubble">Можно голосом уточнить сроки?<span class="time">12:10</span></div></div>`;
  } else if (mode === 'photo') {
    stream = `
      <div class="hg-day">Сегодня</div>
      <div class="msg out">
        <div class="bubble media-bubble">
          <div class="photo-msg photo-site"><span class="photo-cap">Объект · Северная башня</span></div>
          <span class="time">12:08</span>
        </div>
      </div>
      <div class="msg in"><div class="avatar sm gold">ОВ</div><div class="bubble">Спасибо, видно прогресс<span class="time">12:09</span></div></div>`;
  } else if (mode === 'video') {
    stream = `
      <div class="hg-day">Сегодня</div>
      <div class="msg out">
        <div class="bubble media-bubble">
          <div class="video-msg">
            <div class="video-thumb"><button class="play-disc" type="button">${I.play}</button><span class="dur">0:42</span></div>
          </div>
          <span class="time">12:11</span>
        </div>
      </div>`;
  } else if (mode === 'circle') {
    stream = `
      <div class="hg-day">Сегодня</div>
      <div class="msg out">
        <div class="circle-note">
          <div class="circle-ring"><div class="circle-face circle-face-live"><span class="circle-live-label">Вы</span></div></div>
          <span class="circle-timer">0:08</span>
        </div>
      </div>
      <div class="msg in"><div class="avatar sm gold">ОВ</div><div class="bubble">Посмотрела кружок — ок<span class="time">12:12</span></div></div>`;
  } else if (mode === 'stickers') {
    stream = `
      <div class="hg-day">Сегодня</div>
      <div class="msg out">${stickerPack()}</div>
      <div class="msg in"><div class="avatar sm gold">ОВ</div><div class="bubble">Ха, поняла<span class="time">12:14</span></div></div>`;
  } else {
    stream = `
      <div class="hg-day">Сегодня</div>
      <div class="msg in"><div class="avatar sm gold">ОВ</div><div class="bubble">Когда будет готово КП?<span class="time">11:58</span></div></div>
      <div class="msg out">
        <div class="card-msg">
          <div class="top"><div class="avatar gold">#</div><div><strong>Просчёт #2041</strong><span>4 200 000 ₽ без НДС</span></div></div>
          <div class="body">Северная башня · оборудование G</div>
          <div class="actions"><button class="btn btn-blue" type="button">Открыть в CRM</button><button class="btn btn-ghost" type="button">В Мимир</button></div>
        </div>
      </div>
      <div class="msg out">
        <div class="card-msg">
          <div class="top"><div class="ting-ico">${I.ting}</div><div><strong>Тинг · Северная башня</strong><span>код 482 913</span></div></div>
          <div class="body">Войти из панели Тинг — CRM не закрывается</div>
          <div class="actions"><button class="btn btn-primary" type="button">Присоединиться</button></div>
        </div>
      </div>`;
  }

  const head = mode === 'group' ? threadHead({ group: true }) : threadHead();
  const comp = mode === 'voice-rec'
    ? composer({ recording: true })
    : composer({ picker: mode === 'stickers' });

  return `
    <div class="asg-panel-body">
      <div class="hg-thread">
        ${head}
        <div class="hg-stream">${stream}</div>
        ${comp}
      </div>
    </div>`;
}

function panelTing() {
  return `
    <div class="asg-panel-head">
      <div class="brand-row"><h3>Тинг</h3><span>Видео · AI-протокол</span></div>
      <button class="asg-icon-btn" type="button">${I.close}</button>
    </div>
    <div class="asg-panel-body">
      <div class="ting-hub">
        <div class="ting-hero">
          <div class="big">${I.ting}</div>
          <h4>Новая комната</h4>
          <p>Из CRM · без ухода со страницы</p>
          <button class="btn btn-primary" type="button">Создать Тинг</button>
        </div>
        <div class="ting-quick">
          <button class="btn btn-ghost" type="button">Подключиться</button>
          <button class="btn btn-ghost" type="button">Запланировать</button>
        </div>
        <div class="sec-label">Сегодня</div>
        <div class="ting-row">
          <div class="avatar gold">ОВ</div>
          <div class="info"><strong>Ольга Васильева</strong><span class="missed">Пропущенный · видео</span></div>
          <span class="time">12:10</span>
        </div>
      </div>
      <div class="ting-join-overlay">
        <div class="ting-join-card">
          <div class="ting-preview"><div class="avatar lg gold">НА</div><span>Превью камеры</span></div>
          <h4>Подключение</h4>
          <p>Северная башня · 2 в сети</p>
          <div class="ting-join-controls">
            <button class="asg-icon-btn is-on" type="button" title="Микрофон">${I.mic}</button>
            <button class="asg-icon-btn is-on" type="button" title="Камера">${I.cam}</button>
          </div>
          <div class="ting-actions">
            <button class="btn btn-ghost" type="button">Отмена</button>
            <button class="btn btn-primary" type="button">Войти</button>
          </div>
        </div>
      </div>
    </div>`;
}

function panelStoryPost() {
  return `
    <div class="asg-panel-head">
      <div class="brand-row"><h3>Статус команды</h3><span>выкладка</span></div>
      <button class="asg-icon-btn" type="button">${I.close}</button>
    </div>
    <div class="asg-panel-body story-post">
      <div class="story-preview">
        <div class="story-preview-frame">
          <div class="avatar lg gold">РП</div>
          <p>Дежурный РП · смена до 20:00 · Северная башня</p>
        </div>
      </div>
      <div class="story-audience">
        <span class="sec-label">Кто видит</span>
        <div class="seg">
          <button class="is-on" type="button">Команда</button>
          <button type="button">Офис</button>
          <button type="button">Все</button>
        </div>
      </div>
      <div class="story-post-actions">
        <button class="btn btn-ghost" type="button">Снять ещё</button>
        <button class="btn btn-primary" type="button">Опубликовать</button>
      </div>
    </div>`;
}

function chrome({ panelOpen, panel, activeRail }) {
  let panelInner = '';
  if (panel === 'huginn') panelInner = panelHuginnList();
  else if (panel === 'mimir') panelInner = panelMimir();
  else if (panel === 'ting') panelInner = panelTing();
  else if (panel === 'story-post') panelInner = panelStoryPost();
  else if (panel && panel.startsWith('thread')) {
    const mode = panel === 'thread' ? 'cards' : panel.replace('thread-', '');
    panelInner = panelThread(mode);
  }

  return `
  <div class="crm-shell">
    ${crmSmeta()}
    <div class="asg-chrome">
      <aside class="asg-panel${panelOpen ? ' is-open' : ''}">${panelOpen ? panelInner : ''}</aside>
      ${rail(activeRail)}
    </div>
  </div>`;
}

function mac(inner) {
  return `<div class="macbook"><div class="macbook-screen">${inner}</div><div class="macbook-chin"></div></div>`;
}

function phone(inner, label) {
  return `<div class="phone-wrap"><div class="iphone"><div class="iphone-screen">${inner}</div></div><div class="phone-label">${label}</div></div>`;
}

function phoneChats() {
  return `
  <div class="phone-app">
    <div class="m-head"><h2>Чаты</h2><button class="asg-icon-btn gold" type="button">${I.plus}</button></div>
    <div class="hg-search"><div class="hg-search-wrap">${I.search}<input class="hg-field" placeholder="Поиск" /></div></div>
    <div class="m-chips">
      <button class="is-on" type="button">Все</button>
      <button type="button">Клиенты</button>
      <button type="button">CRM</button>
    </div>
    <div class="m-pin"><div class="avatar gold sm">#</div><div><strong>Просчёт #2041 закреплён</strong><span>4,2 млн · открыть в CRM</span></div></div>
    <div class="hg-stories">
      <div class="hg-story"><div class="hg-story-ring"><div class="avatar gold">РП</div></div><span>Дежурный</span></div>
      <div class="hg-story"><div class="hg-story-ring"><div class="avatar">ОБ</div></div><span>Объект</span></div>
      <div class="hg-story"><div class="hg-story-ring"><div class="avatar gold">ОВ</div></div><span>Клиент</span></div>
    </div>
    <div class="m-list">
      <div class="hg-item"><div class="avatar gold">ОВ<div class="dot"></div></div><div><div class="name">Ольга Васильева</div><div class="preview">печатает…</div></div><div class="meta"><div class="time">12:04</div><span class="badge">2</span></div></div>
      <div class="hg-item"><div class="avatar-stack"><div class="avatar sm">РП</div><div class="avatar sm gold">ДК</div></div><div><div class="name">РП · группа</div><div class="preview">голосовое</div></div><div class="meta"><div class="time">11:40</div></div></div>
    </div>
    <nav class="m-tabbar">
      <button class="m-tab is-on" type="button">${I.huginn}<span>Чаты</span></button>
      <button class="m-tab" type="button">${I.ting}<span>Звонки</span></button>
      <button class="m-tab" type="button">${I.user}<span>Контакты</span></button>
      <button class="m-tab" type="button">${I.mimir}<span>Профиль</span></button>
    </nav>
  </div>`;
}

function phoneThread() {
  return `
  <div class="phone-app">
    ${threadHead()}
    <div class="m-stream">
      <div class="hg-day">Сегодня</div>
      <div class="msg in"><div class="bubble">Когда КП?<span class="time">11:58</span></div></div>
      <div class="msg out"><div class="bubble">До 15:00 · созвон в Тинг?<span class="time">12:01</span></div></div>
      <div class="msg out"><div class="card-msg"><div class="top"><div class="avatar gold">#</div><div><strong>Просчёт #2041</strong><span>4,2 млн</span></div></div><div class="actions"><button class="btn btn-blue" type="button">Открыть</button></div></div></div>
    </div>
    <div class="m-composer">
      <button class="asg-icon-btn" type="button">${I.attach}</button>
      <button class="asg-icon-btn" type="button">${I.emoji}</button>
      <input class="hg-field" placeholder="Сообщение" />
      <button class="mic-ring" type="button">${I.mic}</button>
      <button class="send-disc" type="button">${I.send}</button>
    </div>
  </div>`;
}

function phoneCalls() {
  return `
  <div class="phone-app">
    <div class="m-head"><h2>Звонки</h2></div>
    <div class="ting-hub">
      <div class="ting-hero">
        <div class="big">${I.ting}</div>
        <h4>Новый Тинг</h4>
        <p>Видео · AI-протокол</p>
        <button class="btn btn-primary" type="button">Создать</button>
      </div>
      <div class="sec-label">Сегодня</div>
      <div class="ting-row"><div class="avatar gold">ОВ</div><div class="info"><strong>Ольга</strong><span class="missed">Пропущенный</span></div></div>
    </div>
    <nav class="m-tabbar">
      <button class="m-tab" type="button">${I.huginn}<span>Чаты</span></button>
      <button class="m-tab is-on" type="button">${I.ting}<span>Звонки</span></button>
      <button class="m-tab" type="button">${I.user}<span>Контакты</span></button>
      <button class="m-tab" type="button">${I.mimir}<span>Профиль</span></button>
    </nav>
  </div>`;
}

function phoneIncall() {
  return `
  <div class="phone-app incall-host">
    <div class="incall">
      <div class="incall-top"><span class="title">Тинг · Северная башня</span><span class="chip ok">12:04</span></div>
      <div class="grid-tiles">
        <div class="tile is-speaking"><div class="avatar">ОВ</div><div class="name">Ольга · говорит</div></div>
        <div class="tile"><div class="avatar gold">Я</div><div class="name">Вы</div></div>
        <div class="tile"><div class="mute">${I.mute}</div><div class="avatar">ДК</div><div class="name">Дмитрий</div></div>
        <div class="tile"><div class="avatar red">РП</div><div class="name">РП</div></div>
      </div>
      <div class="incall-dock">
        <button class="asg-icon-btn" type="button">${I.mic}</button>
        <button class="asg-icon-btn" type="button">${I.cam}</button>
        <button class="asg-icon-btn" type="button">${I.grid}</button>
        <button class="asg-icon-btn danger" type="button">${I.hangup}</button>
      </div>
    </div>
  </div>`;
}

function phonePhoto() {
  return `
  <div class="phone-app">
    ${threadHead()}
    <div class="m-stream">
      <div class="msg out"><div class="bubble media-bubble"><div class="photo-msg photo-site"><span class="photo-cap">Объект</span></div><span class="time">12:08</span></div></div>
    </div>
    <div class="m-composer">
      <button class="asg-icon-btn" type="button">${I.attach}</button>
      <input class="hg-field" placeholder="Подпись" />
      <button class="send-disc" type="button">${I.send}</button>
    </div>
  </div>`;
}

function phoneVoice() {
  return `
  <div class="phone-app">
    ${threadHead()}
    <div class="m-stream">
      <div class="msg in"><div class="bubble">Можно голосом уточнить сроки?<span class="time">12:10</span></div></div>
    </div>
    <div class="voice-rec-bar">
      <button class="asg-icon-btn danger" type="button" title="Отменить">${I.trash}</button>
      <div class="voice-rec-wave">${wf(18)}<span class="rec-timer">0:12</span></div>
      <button class="send-disc" type="button" title="Отправить">${I.send}</button>
    </div>
  </div>`;
}

function phoneCircle() {
  return `
  <div class="phone-app">
    ${threadHead()}
    <div class="m-stream circle-center">
      <div class="circle-note lg">
        <div class="circle-ring"><div class="circle-face circle-face-live"><span class="circle-live-label">Вы</span></div></div>
        <span class="circle-timer">0:08</span>
      </div>
    </div>
  </div>`;
}

function stickerPack() {
  return `
    <div class="sticker sticker-raven" title="Хугинн">
      <svg viewBox="0 0 64 64" class="sticker-svg"><ellipse cx="32" cy="36" rx="18" ry="14" fill="currentColor" opacity=".15"/><path d="M18 34c4-14 14-20 22-18 6 2 10 8 10 14 0 8-6 14-14 16-3 4-8 6-12 4 2-3 2-6 1-8-6-2-10-6-7-8z" fill="currentColor"/><circle cx="36" cy="28" r="2.2" fill="var(--on-gold)"/></svg>
    </div>`;
}

function phoneStickers() {
  return `
  <div class="phone-app">
    ${threadHead()}
    <div class="m-stream">
      <div class="msg out">${stickerPack()}</div>
    </div>
    <div class="emoji-picker phone-picker sticker-tray">
      <button type="button" class="emoji-cell tray-raven" title="Хугинн"></button>
      <button type="button" class="emoji-cell tray-mimir" title="Мимир"></button>
      <button type="button" class="emoji-cell tray-ting" title="Тинг"></button>
      <button type="button" class="emoji-cell tray-ok" title="Ок"></button>
      <button type="button" class="emoji-cell tray-gold" title="Gold"></button>
      <button type="button" class="emoji-cell tray-shield" title="Щит"></button>
    </div>
    <div class="m-composer">
      <button class="asg-icon-btn emoji-btn is-on" type="button">${I.emoji}</button>
      <input class="hg-field" placeholder="Сообщение" />
      <button class="send-disc" type="button">${I.send}</button>
    </div>
  </div>`;
}

function phoneStatus() {
  return `
  <div class="phone-app">
    <div class="stories-viewer">
      <div class="stories-progress"><i class="is-on"></i><i></i><i></i></div>
      <div class="stories-body">
        <div>
          <div class="avatar lg gold">РП</div>
          <p>Дежурный РП · Северная башня. Статус смены в Хугинне для всей команды.</p>
        </div>
      </div>
    </div>
  </div>`;
}

function phoneInvite() {
  return `
  <div class="phone-app">
    <div class="m-head"><button class="asg-icon-btn" type="button">${I.back}</button><h2>Контакты</h2></div>
    <div class="invite-box">
      <h4>Пригласить клиента</h4>
      <div class="sub">Телефон или почта · только по приглашению</div>
      <div class="seg"><button class="is-on" type="button">Телефон</button><button type="button">Почта</button></div>
      <div class="label">Номер</div>
      <input class="hg-field" value="+7 912 555-18-40" />
      <div class="label">Имя</div>
      <input class="hg-field" value="Ольга Васильева" />
      <button class="btn btn-primary" type="button">Отправить приглашение</button>
    </div>
  </div>`;
}

function phoneProfile() {
  return `
  <div class="phone-app">
    <div class="profile-hero">
      <div class="avatar lg gold">НА</div>
      <h3>Никита · ASGARD</h3>
      <p>Хугинн · Вороний Вестник</p>
      <span class="chip gold">сотрудник</span>
    </div>
    <div class="profile-row"><strong>Уведомления</strong><span>включены</span></div>
    <div class="profile-row"><strong>Тема</strong><span>как в CRM</span></div>
    <div class="profile-row"><strong>Тинг</strong><span>AI-протокол</span></div>
    <nav class="m-tabbar">
      <button class="m-tab" type="button">${I.huginn}<span>Чаты</span></button>
      <button class="m-tab" type="button">${I.ting}<span>Звонки</span></button>
      <button class="m-tab" type="button">${I.user}<span>Контакты</span></button>
      <button class="m-tab is-on" type="button">${I.mimir}<span>Профиль</span></button>
    </nav>
  </div>`;
}

function phoneStoryPost() {
  return `
  <div class="phone-app story-post">
    <div class="m-head"><button class="asg-icon-btn" type="button">${I.close}</button><h2>Статус</h2></div>
    <div class="story-preview">
      <div class="story-preview-frame">
        <div class="avatar lg gold">РП</div>
        <p>Дежурный · до 20:00</p>
      </div>
    </div>
    <div class="story-post-actions">
      <button class="btn btn-primary" type="button">Опубликовать</button>
    </div>
  </div>`;
}

const BOARDS = [
  { id: 'b-rail', theme: 'light', title: 'CRM · лёгкий rail', desc: 'Мимир · Хугинн · Тинг с подписями. Панель закрыта.', html: mac(chrome({ panelOpen: false, activeRail: 'huginn' })) },
  { id: 'b-huginn', theme: 'light', title: 'Хугинн открыт', desc: 'Статусы команды · чаты · compose в шапке. Без FAB.', html: mac(chrome({ panelOpen: true, panel: 'huginn', activeRail: 'huginn' })) },
  { id: 'b-mimir', theme: 'light', title: 'Мимир рядом со сметой', desc: 'Тот же soft chrome · AI-панель. CRM не уходит.', html: mac(chrome({ panelOpen: true, panel: 'mimir', activeRail: 'mimir' })) },
  { id: 'b-group', theme: 'light', title: 'Групповой чат', desc: 'РП · Северная башня · 6 участников · аватар-стек.', html: mac(chrome({ panelOpen: true, panel: 'thread-group', activeRail: 'huginn' })) },
  { id: 'b-thread', theme: 'light', title: 'Диалог · карточки CRM', desc: 'Просчёт и Тинг-invite · composer attach/emoji/mic/send.', html: mac(chrome({ panelOpen: true, panel: 'thread', activeRail: 'huginn' })) },
  { id: 'b-voice-play', theme: 'light', title: 'Голос · расшифровка', desc: 'Waveform + полная карточка SpeechKit.', html: mac(chrome({ panelOpen: true, panel: 'thread-voice-play', activeRail: 'huginn' })) },
  { id: 'b-voice-rec', theme: 'light', title: 'Запись голоса', desc: 'Живой waveform · timer · cancel / send.', html: mac(chrome({ panelOpen: true, panel: 'thread-voice-rec', activeRail: 'huginn' })) },
  { id: 'b-photo', theme: 'light', title: 'Фото в чате', desc: 'Превью объекта · подпись · soft bubble.', html: mac(chrome({ panelOpen: true, panel: 'thread-photo', activeRail: 'huginn' })) },
  { id: 'b-video', theme: 'light', title: 'Видео-сообщение', desc: 'Thumbnail · play-disc · длительность.', html: mac(chrome({ panelOpen: true, panel: 'thread-video', activeRail: 'huginn' })) },
  { id: 'b-circle', theme: 'light', title: 'Кружок', desc: 'Round video note · progress ring · timer.', html: mac(chrome({ panelOpen: true, panel: 'thread-circle', activeRail: 'huginn' })) },
  { id: 'b-stickers', theme: 'light', title: 'Стикеры и смайлы', desc: 'Стикер ᚺ · emoji picker у composer.', html: mac(chrome({ panelOpen: true, panel: 'thread-stickers', activeRail: 'huginn' })) },
  { id: 'b-ting', theme: 'light', title: 'Тинг из chrome', desc: 'Хаб + join · mic/cam/войти проработаны.', html: mac(chrome({ panelOpen: true, panel: 'ting', activeRail: 'ting' })) },
  { id: 'b-story-post', theme: 'light', title: 'Выкладка статуса', desc: 'Превью · аудитория · Опубликовать.', html: mac(chrome({ panelOpen: true, panel: 'story-post', activeRail: 'huginn' })) },
  {
    id: 'b-phones-l', theme: 'light', title: 'iPhone · светлая',
    desc: 'Чаты · диалог · звонки · in-call — реальные пропорции.',
    html: `<div class="phone-row">${phone(phoneChats(), 'Чаты')}${phone(phoneThread(), 'Диалог')}${phone(phoneCalls(), 'Звонки')}${phone(phoneIncall(), 'In-call')}</div>`,
  },
  {
    id: 'b-phones-media', theme: 'light', title: 'iPhone · медиа',
    desc: 'Фото · голос+transcript · кружок · стикеры.',
    html: `<div class="phone-row">${phone(phonePhoto(), 'Фото')}${phone(phoneVoice(), 'Голос')}${phone(phoneCircle(), 'Кружок')}${phone(phoneStickers(), 'Стикеры')}</div>`,
  },
  {
    id: 'b-phones-d', theme: 'dark', title: 'iPhone · тёмная',
    desc: 'Сводка · invite · профиль · выкладка статуса.',
    html: `<div class="phone-row">${phone(phoneStatus(), 'Сводка')}${phone(phoneInvite(), 'Приглашение')}${phone(phoneProfile(), 'Профиль')}${phone(phoneStoryPost(), 'Выкладка')}</div>`,
  },
  {
    id: 'b-hero', theme: 'light', title: 'Хугинн · презентация',
    desc: 'Смета в CRM + лёгкий правый chrome. Телефоны вторичны.',
    html: `<div class="hero-board hero-board-light">
      <div>
        <h2>Хугинн · Вороний Вестник</h2>
        <p class="tag">Мимир · Хугинн · Тинг — лёгкий rail справа на каждом экране CRM.</p>
      </div>
      <div class="hero-devices hero-devices-thesis">
        ${mac(chrome({ panelOpen: true, panel: 'huginn', activeRail: 'huginn' }))}
        <div class="hero-phones-side">${phone(phoneChats(), 'Mobile')}</div>
      </div>
    </div>`,
  },
];

const dots = BOARDS.map((b, i) => `<button type="button" data-board="${b.id}"${i === 0 ? ' class="is-on"' : ''} aria-label="${b.title}"></button>`).join('');
const boardsHtml = BOARDS.map((b, i) => `<section class="board${i === 0 ? ' is-on' : ''}" data-board="${b.id}" data-theme="${b.theme}">${b.html}</section>`).join('\n');

const html = `<!DOCTYPE html>
<html lang="ru" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Хугинн — презентация chrome · ASGARD CRM</title>
  <link rel="stylesheet" href="ds.css" />
  <link rel="stylesheet" href="present.css" />
</head>
<body class="present-host">
  <header class="present-top">
    <div class="present-brand">
      <div class="mark">ᚺ</div>
      <div>
        <h1>Хугинн · ASGARD CRM</h1>
        <p>Правый chrome · soft DS v2.5</p>
      </div>
    </div>
    <div class="present-caption">
      <h2 id="capTitle">${BOARDS[0].title}</h2>
      <p id="capDesc">${BOARDS[0].desc}</p>
    </div>
    <button type="button" class="present-theme" id="btnTheme">Тема</button>
  </header>
  <main class="present-stage" id="stage">
${boardsHtml}
  </main>
  <nav class="present-dots" id="dots">${dots}</nav>
  <script src="app.js"></script>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html, 'utf8');
console.log('Wrote index.html boards=', BOARDS.length);
console.log('inline style count', (html.match(/style="/g) || []).length);

// export board ids for shot script sync check
fs.writeFileSync(
  path.join(__dirname, '_boards.json'),
  JSON.stringify(BOARDS.map((b) => ({ id: b.id, theme: b.theme, title: b.title, desc: b.desc })), null, 2),
  'utf8'
);
