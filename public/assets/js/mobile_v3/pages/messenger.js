/**
 * ASGARD CRM — Mobile v3 · Хугинн (Мессенджер)
 * v3.1 — SSE real-time, inline images, edit/delete/copy, sound, pull-to-refresh, online status
 */

/* ── Emoji Data ── */
const HUGINN_EMOJI = {
  'Часто': ['👍','❤️','😂','🔥','👀','✅','😊','😢','😡','👏','🙏','💪','🤝','🎉','❌','⭐','💯','🤔','😘','😎','🤦','🤷','👋','🫡','🚀','💡','✨','🎯'],
  'Смайлы': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','😋','😛','😜','🤪','🤗','🤭','🤔','😏','😒','🙄','😬','😌','😔','😴','🤮','🤧','🥵','🥶','🤯','🥳','😢','😭','😱','😤','😡','🤬'],
  'Жесты': ['👋','🤚','✋','🖖','👌','✌️','🤞','🤟','🤘','🤙','👍','👎','✊','👊','👏','🙌','🤝','🙏','💪','👀','❤️','🧡','💛','💚','💙','💜','🖤','💔'],
  'Работа': ['📱','💻','📊','📈','💰','💳','📧','📎','📌','📝','✅','❌','⏰','📅','📁','🔒','🔑','⚙️','🔔','🔍','📦','🚀','💡','🎯','🏆','🎉','🔥','⭐']
};
var QUICK_REACTIONS = ['👍','❤️','😂','🔥','👀','✅'];

/* ── Sound helper (Web Audio, no external files) ── */
var _huginnAudioCtx = null;
function _huginnPlayNotifSound() {
  try {
    if (!_huginnAudioCtx) _huginnAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    var ctx = _huginnAudioCtx;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(1100, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

function _huginnPlaySendSound() {
  try {
    if (!_huginnAudioCtx) _huginnAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    var ctx = _huginnAudioCtx;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {}
}

/* ── Helpers ── */
function _huginnTime(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

function _huginnDateLabel(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var diff = (today - msgDay) / 86400000;
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  var months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return d.getDate() + ' ' + months[d.getMonth()];
}

function _huginnSameDay(d1, d2) {
  if (!d1 || !d2) return false;
  var a = new Date(d1), b = new Date(d2);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function _huginnIsGrouped(prev, curr) {
  if (!prev || !curr) return false;
  if (prev.user_id !== curr.user_id) return false;
  if (!_huginnSameDay(prev.created_at, curr.created_at)) return false;
  return Math.abs(new Date(curr.created_at) - new Date(prev.created_at)) < 120000;
}

function _huginnGroupPos(prev, curr, next) {
  var gPrev = _huginnIsGrouped(prev, curr);
  var gNext = _huginnIsGrouped(curr, next);
  if (gPrev && gNext) return 'mid';
  if (gPrev && !gNext) return 'last';
  if (!gPrev && gNext) return 'first';
  return 'single';
}

function _huginnParseText(text) {
  var frag = document.createDocumentFragment();
  // Split by markdown patterns and URLs
  var re = /(https?:\/\/[^\s<>"']+)|(\*\*(.+?)\*\*)|(__(.+?)__)|(_(.+?)_)|(~~(.+?)~~)|(`(.+?)`)/g;
  var last = 0;
  var match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));
    if (match[1]) { // URL
      var a = document.createElement('a');
      a.href = match[1];
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = match[1];
      frag.appendChild(a);
    } else if (match[2]) { // **bold**
      var b = document.createElement('strong');
      b.textContent = match[3];
      frag.appendChild(b);
    } else if (match[4]) { // __bold__
      var b2 = document.createElement('strong');
      b2.textContent = match[5];
      frag.appendChild(b2);
    } else if (match[6]) { // _italic_
      var em = document.createElement('em');
      em.textContent = match[7];
      frag.appendChild(em);
    } else if (match[8]) { // ~~strike~~
      var del = document.createElement('del');
      del.textContent = match[9];
      frag.appendChild(del);
    } else if (match[10]) { // `code`
      var code = document.createElement('code');
      code.textContent = match[11];
      frag.appendChild(code);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

function _huginnOnlineLabel(lastLogin) {
  if (!lastLogin) return '';
  var diff = Date.now() - new Date(lastLogin).getTime();
  if (diff < 300000) return 'в сети';
  if (diff < 3600000) return 'был(а) ' + Math.floor(diff / 60000) + ' мин назад';
  if (diff < 86400000) return 'был(а) ' + Math.floor(diff / 3600000) + ' ч назад';
  return '';
}

function _huginnCopyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(function(){});
  } else {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/* ── Media support detection ── */
var _huginnHasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
var _huginnHasVideo = _huginnHasMedia;

/* ── Tel: calls ── */
function _huginnInitiateCall(targetUserId, targetUserName) {
  API.fetch('/users/' + targetUserId).then(function(resp) {
    var u = resp.user || resp;
    var phone = u.phone || u.mobile || u.tel;
    if (!phone) {
      M.Toast({ message: 'Номер не указан в профиле', type: 'warning' });
      return;
    }
    var clean = phone.replace(/[^\d+]/g, '');
    M.ActionSheet({
      title: 'Позвонить ' + targetUserName,
      actions: [
        { icon: '📞', label: phone, onClick: function() { window.open('tel:' + clean); } },
        { icon: '💬', label: 'SMS', onClick: function() { window.open('sms:' + clean); } },
      ],
    });
  }).catch(function() { M.Toast({ message: 'Ошибка загрузки контакта', type: 'error' }); });
}

/* ── Voice Player (real waveform + speed 1×/1.5×/2×) ── */
function _huginnVoicePlayer(fileUrl, duration, waveform) {
  var el = Utils.el;
  var wrap = el('div', { className: 'huginn-voice' });
  var playing = false;
  var audio = new Audio(fileUrl + (fileUrl.indexOf('?') >= 0 ? '&' : '?') + 'token=' + API.getToken());
  var speeds = [1, 1.5, 2];
  var speedIdx = 0;
  var playBtn = el('div', {
    className: 'huginn-voice__play', textContent: '\u25B6',
    onClick: function() {
      if (playing) { audio.pause(); playBtn.textContent = '\u25B6'; }
      else { audio.play(); playBtn.textContent = '\u23F8'; }
      playing = !playing;
    },
  });
  wrap.appendChild(playBtn);
  var waveWrap = el('div', { className: 'huginn-voice__wave' });
  var barCount = 32;
  var amps = [];
  if (waveform && Array.isArray(waveform) && waveform.length) {
    for (var i = 0; i < barCount; i++) {
      var si = Math.floor(i / barCount * waveform.length);
      amps.push(Math.max(3, Math.min(17, Math.round(waveform[si] / 255 * 17))));
    }
  } else {
    var seed = (duration || 10) * 7;
    for (var i = 0; i < barCount; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      amps.push(3 + Math.floor(seed % 15));
    }
  }
  var bars = [];
  for (var i = 0; i < barCount; i++) {
    var bar = el('div', { className: 'huginn-voice__bar' });
    bar.style.height = amps[i] + 'px';
    waveWrap.appendChild(bar);
    bars.push(bar);
  }
  wrap.appendChild(waveWrap);
  var infoCol = el('div', { className: 'huginn-voice__info' });
  var durText = duration ? Math.floor(duration / 60) + ':' + String(duration % 60).padStart(2, '0') : '0:00';
  var durEl = el('div', { className: 'huginn-voice__dur', textContent: durText });
  infoCol.appendChild(durEl);
  var speedBtn = el('div', {
    className: 'huginn-voice__speed', textContent: '1\u00D7',
    onClick: function(e) {
      e.stopPropagation();
      speedIdx = (speedIdx + 1) % speeds.length;
      audio.playbackRate = speeds[speedIdx];
      speedBtn.textContent = speeds[speedIdx] + '\u00D7';
    },
  });
  infoCol.appendChild(speedBtn);
  wrap.appendChild(infoCol);
  audio.addEventListener('ended', function() {
    playing = false; playBtn.textContent = '\u25B6';
    bars.forEach(function(b) { b.classList.remove('huginn-voice__bar--active'); });
    durEl.textContent = durText;
  });
  audio.addEventListener('timeupdate', function() {
    if (audio.duration) {
      var pct = audio.currentTime / audio.duration;
      var active = Math.floor(pct * bars.length);
      bars.forEach(function(b, j) { b.classList.toggle('huginn-voice__bar--active', j < active); });
      var rem = Math.ceil(audio.duration - audio.currentTime);
      durEl.textContent = Math.floor(rem / 60) + ':' + String(rem % 60).padStart(2, '0');
    }
  });
  return wrap;
}

/* ── Video Circle (min(200px,55vw), poster frame) ── */
function _huginnVideoCircle(fileUrl, duration) {
  var el = Utils.el;
  var wrap = el('div', { className: 'huginn-vidcircle' });
  var video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = fileUrl + (fileUrl.indexOf('?') >= 0 ? '&' : '?') + 'token=' + API.getToken();
  wrap.appendChild(video);
  video.addEventListener('loadeddata', function() {
    try {
      var c = document.createElement('canvas');
      c.width = video.videoWidth || 200; c.height = video.videoHeight || 200;
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      video.poster = c.toDataURL('image/jpeg', 0.7);
    } catch (e) {}
  });
  var overlay = el('div', { className: 'huginn-vidcircle__overlay' });
  overlay.innerHTML = '<svg width="36" height="36" viewBox="0 0 24 24" fill="rgba(255,255,255,0.9)"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  wrap.appendChild(overlay);
  if (duration) {
    wrap.appendChild(el('div', { className: 'huginn-vidcircle__dur', textContent: Math.floor(duration / 60) + ':' + String(duration % 60).padStart(2, '0') }));
  }
  var playing = false;
  wrap.addEventListener('click', function() {
    if (playing) { video.pause(); overlay.style.opacity = '1'; }
    else { video.play(); overlay.style.opacity = '0'; }
    playing = !playing;
  });
  video.addEventListener('ended', function() { playing = false; overlay.style.opacity = '1'; });
  return wrap;
}

/* ── File type icon helper ── */
function _huginnFileIcon(fname) {
  var ext = (fname || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return { cls: 'huginn-file-icon--pdf', icon: '\uD83D\uDCC4' };
  if (['doc','docx','rtf','odt','txt'].indexOf(ext) >= 0) return { cls: 'huginn-file-icon--doc', icon: '\uD83D\uDCC3' };
  if (['xls','xlsx','csv','ods'].indexOf(ext) >= 0) return { cls: 'huginn-file-icon--xls', icon: '\uD83D\uDCCA' };
  return { cls: 'huginn-file-icon--other', icon: '\uD83D\uDCCE' };
}

/* ── File size formatter ── */
function _huginnFileSize(bytes) {
  if (!bytes || bytes < 1) return '';
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' КБ';
  return (bytes / 1048576).toFixed(1) + ' МБ';
}

/* ── Authenticated file download ── */
function _huginnDownloadFile(url, filename) {
  fetch(url, { headers: { 'Authorization': 'Bearer ' + API.getToken() } })
    .then(function(r) { return r.blob(); })
    .then(function(blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || 'file';
      a.click();
      setTimeout(function() { URL.revokeObjectURL(a.href); }, 5000);
    })
    .catch(function() { M.Toast({ message: 'Ошибка скачивания', type: 'error' }); });
}

/* ═══════════════════════════════════════════
   CHAT LIST
   ═══════════════════════════════════════════ */
const MessengerPage = {
  async render(params) {
    const el = Utils.el;
    const t = DS.t;
    if (params && params.id) return renderChat(params.id);

    const page = el('div', { className: 'huginn-list-page page-container' });

    page.appendChild(M.Header({
      title: 'Хугинн',
      subtitle: 'МЕССЕНДЖЕР',
      back: false,
      actions: [
        {
          icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
          onClick: () => composeDirectChat(),
        },
        {
          icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
          onClick: () => createGroupSheet(),
        },
      ],
    }));

    page.appendChild(M.SearchBar({
      placeholder: 'Поиск чатов...',
      sticky: true,
      onSearch: (q) => renderList(q),
    }));

    // Stories removed in HUGINN S1

    const listWrap = el('div', { style: { padding: '4px 0', minHeight: '200px', position: 'relative' } });
    page.appendChild(listWrap);

    var chats = [];

    // ── Pull-to-refresh ──
    var _pullStartY = 0, _pulling = false;
    var pullIndicator = el('div', {
      className: 'huginn-pull-indicator',
      style: { textAlign: 'center', padding: '0', height: '0', overflow: 'hidden', transition: 'height 0.2s ease', color: t.textSec || '#999', ...DS.font('xs') },
      textContent: 'Обновить',
    });
    listWrap.parentNode.insertBefore(pullIndicator, listWrap);

    listWrap.addEventListener('touchstart', function(e) {
      if (listWrap.scrollTop <= 0) { _pullStartY = e.touches[0].clientY; _pulling = true; }
    }, { passive: true });
    listWrap.addEventListener('touchmove', function(e) {
      if (!_pulling) return;
      var dy = e.touches[0].clientY - _pullStartY;
      if (dy > 0 && dy < 120) {
        pullIndicator.style.height = Math.min(dy * 0.5, 40) + 'px';
        pullIndicator.style.padding = '8px 0';
      }
    }, { passive: true });
    listWrap.addEventListener('touchend', function() {
      if (!_pulling) return;
      _pulling = false;
      var h = parseInt(pullIndicator.style.height) || 0;
      pullIndicator.style.height = '0';
      pullIndicator.style.padding = '0';
      if (h >= 30) loadChats();
    }, { passive: true });

    async function loadChats() {
      listWrap.replaceChildren();
      listWrap.appendChild(M.Skeleton({ type: 'list', count: 6 }));
      try {
        var resp = await API.fetch('/chat-groups');
        chats = Array.isArray(resp) ? resp : API.extractRows(resp);
        renderList('');
      } catch (e) {
        listWrap.replaceChildren();
        listWrap.appendChild(M.ErrorBanner({ onRetry: loadChats }));
      }
    }

    var _currentUserId = (Store.get('user') || {}).id;

    function _chatPreview(chat) {
      var mt = chat.last_message_type || 'text';
      var txt = chat.last_message_text || '';
      if (mt === 'voice') return '\uD83C\uDFA4 Голосовое';
      if (mt === 'video') return '\uD83C\uDFA5 Видеосообщение';
      if (txt.length > 60) txt = txt.substring(0, 60) + '…';
      if (!txt) return '';
      // In groups, prefix with sender first name
      if (chat.is_group && chat.last_message_sender) {
        var first = chat.last_message_sender.split(' ')[0];
        if (chat.last_message_user_id === _currentUserId) first = 'Вы';
        return first + ': ' + txt;
      }
      return txt;
    }

    function renderList(query) {
      listWrap.replaceChildren();
      var q = (query || '').toLowerCase();
      var filtered = chats.filter(function(c) {
        var name = (c.name || c.direct_user_name || '').toLowerCase();
        return !q || name.includes(q);
      });

      if (!filtered.length && !q) {
        listWrap.appendChild(M.Empty({ text: 'Нет чатов', icon: '\uD83D\uDCAC' }));
        return;
      }
      if (!filtered.length) {
        listWrap.appendChild(M.Empty({ text: 'Ничего не найдено' }));
        return;
      }

      var list = el('div', { style: { display: 'flex', flexDirection: 'column' } });

      // Mimir bot — always first (if no search query)
      if (!q) {
        var mimirRow = el('div', {
          className: 'huginn-chat-row',
          onClick: function() { Router.navigate('/mimir'); },
        });
        var mimirAva = el('div', {
          style: {
            width: '54px', height: '54px', borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(135deg, var(--hg-accent, #6ab2f2), var(--hg-destructive, #ec3942))',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px',
          },
          textContent: '\u26A1',
        });
        mimirRow.appendChild(mimirAva);
        var mimirInfo = el('div', { className: 'huginn-chat-row__info' });
        mimirInfo.appendChild(el('div', { className: 'huginn-chat-row__name', textContent: '\u041C\u0438\u043C\u0438\u0440' }));
        mimirInfo.appendChild(el('div', { className: 'huginn-chat-row__preview', textContent: 'AI-\u043F\u043E\u043C\u043E\u0449\u043D\u0438\u043A ASGARD' }));
        mimirRow.appendChild(mimirInfo);
        list.appendChild(mimirRow);
      }

      filtered.forEach(function(chat) {
        var unread = chat.unread_count || 0;
        var isMuted = chat.muted_until && new Date(chat.muted_until) > new Date();
        var name = chat.is_group === false ? (chat.direct_user_name || chat.name || 'Чат') : (chat.name || 'Чат');

        var isOnline = false;
        if (chat.is_group === false && chat.direct_user_last_login) {
          isOnline = (Date.now() - new Date(chat.direct_user_last_login).getTime()) < 300000;
        }

        var row = el('div', {
          className: 'huginn-chat-row',
          onClick: function() { Router.navigate('/messenger/' + chat.id); },
        });

        var avatarOpts = { name: name, size: 54 };
        if (isOnline) avatarOpts.status = 'online';
        row.appendChild(M.Avatar(avatarOpts));

        var info = el('div', { className: 'huginn-chat-row__info' });
        info.appendChild(el('div', { className: 'huginn-chat-row__name', textContent: name }));

        var draft = (typeof window !== 'undefined' && window._huginnDrafts && window._huginnDrafts[chat.id]) || '';
        var previewEl = el('div', { className: 'huginn-chat-row__preview' });
        if (draft) {
          var draftLabel = el('span', { textContent: 'Черновик: ', style: { color: '#ff453a' } });
          previewEl.appendChild(draftLabel);
          previewEl.appendChild(document.createTextNode(draft.length > 40 ? draft.substring(0, 40) + '...' : draft));
        } else {
          var preview = _chatPreview(chat);
          previewEl.textContent = preview || (chat.is_group ? (chat.member_count || 0) + Utils.plural(chat.member_count || 0, ' участник', ' участника', ' участников') : '');
        }
        info.appendChild(previewEl);
        row.appendChild(info);

        var rightCol = el('div', { className: 'huginn-chat-row__right' });
        var timeText = chat.last_message_at ? Utils.relativeTime(chat.last_message_at) : '';
        rightCol.appendChild(el('span', { className: 'huginn-chat-row__time', textContent: timeText }));

        if (unread > 0) {
          rightCol.appendChild(el('span', {
            className: 'huginn-unread-badge' + (isMuted ? ' huginn-unread-badge--muted' : ''),
            textContent: unread > 99 ? '99+' : String(unread),
          }));
        } else if (isMuted) {
          rightCol.appendChild(el('span', {
            style: { fontSize: '14px', opacity: 0.5 },
            textContent: '\uD83D\uDD07',
          }));
        }
        row.appendChild(rightCol);

        // Swipe actions on chat row
        (function(chatRow, chatItem) {
          var _rsX = 0, _rsDX = 0, _rsLocked = false;
          chatRow.addEventListener('touchstart', function(e) { _rsX = e.touches[0].clientX; _rsDX = 0; _rsLocked = false; }, { passive: true });
          chatRow.addEventListener('touchmove', function(e) {
            var dx = e.touches[0].clientX - _rsX;
            var dy = e.touches[0].clientY - (e.touches[0]._startY || e.touches[0].clientY);
            if (!_rsLocked && Math.abs(dx) > 15) _rsLocked = true;
            if (!_rsLocked) return;
            _rsDX = dx;
            var clamped = Math.max(-140, Math.min(140, dx));
            chatRow.style.transform = 'translateX(' + clamped + 'px)';
            chatRow.style.transition = 'none';
          }, { passive: true });
          chatRow.addEventListener('touchend', function() {
            if (_rsDX < -70) {
              // Swipe left → show read + delete
              chatRow.style.transform = 'translateX(-140px)';
              chatRow.style.transition = 'transform .2s ease';
              if (!chatRow.querySelector('.huginn-swipe-actions--left')) {
                var actions = el('div', { className: 'huginn-swipe-actions huginn-swipe-actions--left' });
                var readBtn = el('div', { className: 'huginn-swipe-action huginn-swipe-action--read', innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12l5 5L20 3"/></svg><span>Прочитано</span>' });
                readBtn.addEventListener('click', function(ev) {
                  ev.stopPropagation();
                  API.fetch('/chat-groups/' + chatItem.id + '/read', { method: 'POST', body: { last_message_id: 999999999 } }).catch(function(){});
                  chatRow.style.transform = ''; actions.remove();
                });
                var delBtn = el('div', { className: 'huginn-swipe-action huginn-swipe-action--delete', innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg><span>Удалить</span>' });
                delBtn.addEventListener('click', function(ev) {
                  ev.stopPropagation();
                  M.Toast({ message: 'Удаление чата пока недоступно', type: 'info' });
                  chatRow.style.transform = ''; actions.remove();
                });
                actions.appendChild(readBtn);
                actions.appendChild(delBtn);
                chatRow.parentNode.insertBefore(actions, chatRow.nextSibling);
              }
            } else {
              chatRow.style.transition = 'transform .25s cubic-bezier(0.34,1.56,0.64,1)';
              chatRow.style.transform = '';
              var existing = chatRow.parentNode.querySelector('.huginn-swipe-actions');
              if (existing) existing.remove();
            }
          }, { passive: true });
        })(row, chat);

        list.appendChild(row);
      });
      listWrap.appendChild(list);
    }

    loadChats();
    return page;
  },
};

/* ═══════════════════════════════════════════
   CHAT SCREEN
   ═══════════════════════════════════════════ */
async function renderChat(chatId) {
  var el = Utils.el;
  var t = DS.t;
  var userId = (Store.get('user') || {}).id;
  var page = el('div', {
    className: 'huginn-chat-page',
    style: { background: t.bg },
  });

  // State
  var messages = [];
  var lastMsgId = 0;
  var oldestMsgId = Infinity;
  var hasOlder = true;
  var loadingOlder = false;
  var replyTo = null;
  var editingMsg = null;
  var emojiOpen = false;
  var emptyStateEl = null;
  var _lastTypingSent = 0;
  var _sseConnected = (typeof SSEManager !== 'undefined') ? SSEManager.isConnected() : false;

  // Load chat info
  var chatInfo = {};
  var chatMembers = [];
  try {
    var resp = await API.fetch('/chat-groups/' + chatId);
    chatInfo = resp.chat || resp || {};
    chatMembers = resp.members || [];
  } catch (_) {}

  // Online status for direct chat
  var directMember = null;
  if (!chatInfo.is_group && chatMembers.length) {
    directMember = chatMembers.find(function(m) { return m.user_id !== userId; });
  }

  var mc = chatMembers.length;
  var myRole = (chatMembers.find(function(m) { return m.user_id === userId; }) || {}).role || 'member';
  var isAdmin = (myRole === 'owner' || myRole === 'admin');
  var _pinnedMsgs = [];
  var _pinnedIds = [];
  var _pinnedIdx = 0;
  var _typingUser = null;
  var _typingTimer = null;

  // ── Custom Huginn Header (56px, frosted glass, avatar+online dot) ──
  var headerEl = el('div', { className: 'huginn-header' });

  var headerBack = el('div', {
    className: 'huginn-header-back',
    innerHTML: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>',
    onClick: function() { Router.navigate('/messenger'); },
  });
  headerEl.appendChild(headerBack);

  var headerAvatarWrap = el('div', { className: 'huginn-header-avatar-wrap' });
  headerAvatarWrap.appendChild(M.Avatar({ name: chatInfo.name || '?', size: 40 }));
  var onlineDot = el('div', { className: 'huginn-online-dot huginn-header-online-dot' });
  onlineDot.style.display = 'none';
  headerAvatarWrap.appendChild(onlineDot);
  headerEl.appendChild(headerAvatarWrap);

  var headerInfo = el('div', { className: 'huginn-header-info' });
  var headerTitle = el('div', { className: 'huginn-header-title', textContent: chatInfo.name || 'Чат' });
  var headerSub = el('div', { className: 'huginn-header-subtitle' });
  headerInfo.appendChild(headerTitle);
  headerInfo.appendChild(headerSub);
  headerEl.appendChild(headerInfo);

  var headerActions = el('div', { className: 'huginn-header-actions' });
  headerActions.appendChild(el('div', {
    className: 'huginn-header-action',
    innerHTML: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    onClick: function() { toggleSearchBar(); },
  }));
  headerActions.appendChild(el('div', {
    className: 'huginn-header-action',
    innerHTML: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
    onClick: function() { chatActionsSheet(chatId); },
  }));
  headerEl.appendChild(headerActions);
  page.appendChild(headerEl);

  // ── Search bar ──
  var _searchOpen = false;
  var _searchResults = [];
  var _searchIdx = -1;
  var searchBar = el('div', { className: 'huginn-search-bar' });
  var searchInput = el('input', { placeholder: 'Поиск сообщений...' });
  var searchNav = el('div', { className: 'huginn-search-nav' });
  var searchCounter = el('span', { textContent: '' });
  var searchUp = el('div', { className: 'huginn-search-nav__btn', innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>' });
  var searchDown = el('div', { className: 'huginn-search-nav__btn', innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' });
  var searchClose = el('div', { className: 'huginn-search-close', textContent: '✕' });
  searchNav.appendChild(searchCounter);
  searchNav.appendChild(searchUp);
  searchNav.appendChild(searchDown);
  searchBar.appendChild(searchInput);
  searchBar.appendChild(searchNav);
  searchBar.appendChild(searchClose);
  page.appendChild(searchBar);

  var _searchDebounce = null;
  searchInput.addEventListener('input', function() {
    clearTimeout(_searchDebounce);
    var q = searchInput.value.trim();
    if (q.length < 2) { _searchResults = []; _searchIdx = -1; searchCounter.textContent = ''; return; }
    _searchDebounce = setTimeout(function() {
      // Search in loaded messages
      var results = [];
      var qLower = q.toLowerCase();
      messages.forEach(function(m) {
        if (m.message && m.message.toLowerCase().indexOf(qLower) >= 0) results.push(m.id);
      });
      _searchResults = results;
      _searchIdx = results.length ? 0 : -1;
      searchCounter.textContent = results.length ? '1/' + results.length : '0';
      if (_searchIdx >= 0) scrollToSearchResult();
    }, 300);
  });

  searchUp.addEventListener('click', function() {
    if (!_searchResults.length) return;
    _searchIdx = (_searchIdx - 1 + _searchResults.length) % _searchResults.length;
    searchCounter.textContent = (_searchIdx + 1) + '/' + _searchResults.length;
    scrollToSearchResult();
  });
  searchDown.addEventListener('click', function() {
    if (!_searchResults.length) return;
    _searchIdx = (_searchIdx + 1) % _searchResults.length;
    searchCounter.textContent = (_searchIdx + 1) + '/' + _searchResults.length;
    scrollToSearchResult();
  });
  searchClose.addEventListener('click', function() { toggleSearchBar(); });

  function scrollToSearchResult() {
    if (_searchIdx < 0 || !_searchResults.length) return;
    var msgId = _searchResults[_searchIdx];
    var msgEl = messagesWrap.querySelector('[data-msg-id="' + msgId + '"]');
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgEl.classList.remove('huginn-highlight');
      void msgEl.offsetWidth;
      msgEl.classList.add('huginn-highlight');
    }
  }

  function toggleSearchBar() {
    _searchOpen = !_searchOpen;
    if (_searchOpen) {
      searchBar.classList.add('huginn-search-bar--visible');
      setTimeout(function() { searchInput.focus(); }, 300);
    } else {
      searchBar.classList.remove('huginn-search-bar--visible');
      searchInput.value = '';
      _searchResults = [];
      _searchIdx = -1;
      searchCounter.textContent = '';
    }
  }

  // ── Pinned bar ──
  var pinnedBar = el('div', { className: 'huginn-pinned-bar', style: { display: 'none' } });
  var pinnedIcon = el('div', { className: 'huginn-pinned-bar__icon', innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>' });
  var pinnedText = el('div', { className: 'huginn-pinned-bar__text' });
  var pinnedCounter = el('div', { className: 'huginn-pinned-bar__counter' });
  pinnedBar.appendChild(pinnedIcon);
  pinnedBar.appendChild(pinnedText);
  pinnedBar.appendChild(pinnedCounter);
  page.appendChild(pinnedBar);

  pinnedBar.addEventListener('click', function() {
    if (!_pinnedMsgs.length) return;
    _pinnedIdx = (_pinnedIdx + 1) % _pinnedMsgs.length;
    updatePinnedBar();
    var msgEl = messagesWrap.querySelector('[data-msg-id="' + _pinnedMsgs[_pinnedIdx].message_id + '"]');
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgEl.classList.remove('huginn-highlight');
      void msgEl.offsetWidth;
      msgEl.classList.add('huginn-highlight');
    }
  });

  function updatePinnedBar() {
    if (!_pinnedMsgs.length) { pinnedBar.style.display = 'none'; return; }
    pinnedBar.style.display = '';
    var pin = _pinnedMsgs[_pinnedIdx] || _pinnedMsgs[0];
    var text = pin.message || '';
    pinnedText.textContent = text.length > 60 ? text.substring(0, 60) + '...' : text;
    pinnedCounter.textContent = _pinnedMsgs.length > 1 ? (_pinnedIdx + 1) + '/' + _pinnedMsgs.length : '';
  }

  function loadPinnedMessages() {
    API.fetch('/chat-groups/' + chatId + '/pins').then(function(resp) {
      _pinnedMsgs = resp.pins || [];
      _pinnedIds = _pinnedMsgs.map(function(p) { return p.message_id; });
      _pinnedIdx = 0;
      updatePinnedBar();
    }).catch(function() {});
  }
  loadPinnedMessages();

  function updateHeaderSubtitle() {
    headerSub.innerHTML = '';
    headerSub.style.color = '';
    if (_typingUser) {
      headerSub.style.color = 'var(--hg-accent)';
      headerSub.appendChild(document.createTextNode(_typingUser + ' печатает'));
      var dots = el('span', { className: 'huginn-typing-dots' });
      dots.appendChild(el('span'));
      dots.appendChild(el('span'));
      dots.appendChild(el('span'));
      headerSub.appendChild(dots);
      return;
    }
    if (directMember) {
      var isOnline = directMember.online;
      if (isOnline) {
        headerSub.textContent = 'онлайн';
        headerSub.style.color = 'var(--hg-online)';
        onlineDot.style.display = '';
      } else {
        headerSub.textContent = _huginnOnlineLabel(directMember.last_login_at);
        onlineDot.style.display = 'none';
      }
    } else if (mc > 0) {
      headerSub.textContent = mc + Utils.plural(mc, ' участник', ' участника', ' участников');
    }
  }

  // Check if direct member is online (within 2 min of last_login_at)
  if (directMember) {
    var lastAt = directMember.last_login_at ? new Date(directMember.last_login_at).getTime() : 0;
    directMember.online = (Date.now() - lastAt) < 120000;
  }
  updateHeaderSubtitle();

  // Messages area
  var messagesWrap = el('div', { className: 'huginn-messages' });
  page.appendChild(messagesWrap);

  // SVG defs for bubble tail clip-paths
  if (!document.getElementById('huginn-tail-defs')) {
    var _svgDefs = document.createElement('div');
    _svgDefs.id = 'huginn-tail-defs';
    _svgDefs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    _svgDefs.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"><defs><clipPath id="huginn-tail-in"><path d="M10,0 A10,10 0,0,1 0,10 L16,10 L16,0 Z"/></clipPath><clipPath id="huginn-tail-out"><path d="M6,0 A10,10 0,0,0 16,10 L0,10 L0,0 Z"/></clipPath></defs></svg>';
    document.body.appendChild(_svgDefs);
  }

  // Scroll-to-bottom FAB with badge
  var _unreadBelow = 0;
  var scrollFab = el('div', {
    className: 'huginn-scroll-fab',
    innerHTML: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>',
    onClick: function() {
      messagesWrap.scrollTo({ top: messagesWrap.scrollHeight, behavior: 'smooth' });
      _unreadBelow = 0;
      updateFabBadge();
    },
  });
  var scrollFabBadge = el('div', { className: 'huginn-scroll-fab-badge' });
  scrollFab.appendChild(scrollFabBadge);
  page.appendChild(scrollFab);

  function updateFabBadge() {
    if (_unreadBelow > 0) {
      scrollFabBadge.textContent = '+' + _unreadBelow;
      scrollFabBadge.classList.add('huginn-scroll-fab-badge--visible');
    } else {
      scrollFabBadge.classList.remove('huginn-scroll-fab-badge--visible');
    }
  }

  messagesWrap.addEventListener('scroll', function() {
    var gap = messagesWrap.scrollHeight - messagesWrap.scrollTop - messagesWrap.clientHeight;
    var shouldShow = gap > messagesWrap.clientHeight;
    if (shouldShow && !scrollFab.classList.contains('huginn-scroll-fab--visible')) {
      scrollFab.classList.remove('huginn-scroll-fab--hiding');
      scrollFab.classList.add('huginn-scroll-fab--visible');
    } else if (!shouldShow && scrollFab.classList.contains('huginn-scroll-fab--visible')) {
      scrollFab.classList.add('huginn-scroll-fab--hiding');
      setTimeout(function() { scrollFab.classList.remove('huginn-scroll-fab--visible', 'huginn-scroll-fab--hiding'); _unreadBelow = 0; updateFabBadge(); }, 150);
    }
    if (messagesWrap.scrollTop < 60 && hasOlder && !loadingOlder) loadOlderMessages();
  }, { passive: true });

  // Reply/Edit bar
  var replyBar = el('div', { className: 'huginn-reply-bar' });
  var replyContent = el('div', { className: 'huginn-reply-content' });
  var replyName = el('div', { className: 'huginn-reply-name' });
  var replyTextEl = el('div', { className: 'huginn-reply-text' });
  replyContent.appendChild(replyName);
  replyContent.appendChild(replyTextEl);
  replyBar.appendChild(replyContent);
  replyBar.appendChild(el('div', {
    className: 'huginn-reply-close',
    innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    onClick: function() { setReply(null); cancelEdit(); },
  }));

  // Emoji panel
  var emojiPanel = el('div', { className: 'huginn-emoji-panel' });
  var emojiTabs = el('div', { className: 'huginn-emoji-tabs' });
  var emojiGrid = el('div', { className: 'huginn-emoji-grid' });
  var tabNames = Object.keys(HUGINN_EMOJI);
  var activeTab = 0;

  function renderEmojiTab(idx) {
    activeTab = idx;
    emojiGrid.replaceChildren();
    HUGINN_EMOJI[tabNames[idx]].forEach(function(em) {
      emojiGrid.appendChild(el('div', {
        className: 'huginn-emoji-item',
        textContent: em,
        onClick: function() { textarea.value += em; textarea.focus(); autoResize(); },
      }));
    });
    Array.from(emojiTabs.children).forEach(function(tab, i) {
      tab.className = i === idx ? 'huginn-emoji-tab huginn-emoji-tab--active' : 'huginn-emoji-tab';
    });
  }

  tabNames.forEach(function(name, i) {
    emojiTabs.appendChild(el('div', {
      className: i === 0 ? 'huginn-emoji-tab huginn-emoji-tab--active' : 'huginn-emoji-tab',
      textContent: name,
      onClick: function() { renderEmojiTab(i); },
    }));
  });
  emojiPanel.appendChild(emojiTabs);
  emojiPanel.appendChild(emojiGrid);

  // Composer: 📎 | textarea | 😊 | [🎬] | mic↔send morph
  var composerWrap = el('div', { className: 'huginn-composer' });

  composerWrap.appendChild(el('div', {
    className: 'huginn-btn',
    innerHTML: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>',
    onClick: function() { attachFile(); },
  }));

  var textarea = el('textarea', {
    className: 'huginn-textarea',
    placeholder: 'Сообщение...',
    rows: 1,
  });

  function autoResize() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }

  textarea.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  composerWrap.appendChild(textarea);

  var emojiBtn = el('div', {
    className: 'huginn-btn',
    innerHTML: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    onClick: function() { toggleEmoji(); },
  });
  composerWrap.appendChild(emojiBtn);

  var sendBtn = el('div', {
    className: 'huginn-send-btn',
    innerHTML: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    onClick: function() { sendMessage(); },
  });

  // ── Recording state ──
  var micBtn = null;
  var videoRecBtn = null;
  var _recorder = null;
  var _recChunks = [];
  var _recStream = null;
  var _recStartTime = 0;
  var _recTimerInterval = null;
  var _recType = null;
  var _recLocked = false;
  var _recTouchX = 0;
  var _recTouchY = 0;
  var _recAnalyser = null;
  var _recAudioCtx = null;
  var _recWaveform = [];
  var _recWaveInterval = null;

  // Recording bar (inline in composer, hidden by default)
  var recBar = el('div', { className: 'huginn-rec-bar' });
  var recDot = el('div', { className: 'huginn-rec-dot' });
  var recTimer = el('div', { className: 'huginn-rec-timer', textContent: '0:00' });
  var recWave = el('div', { className: 'huginn-rec-wave' });
  var recWaveBars = [];
  for (var _rb = 0; _rb < 24; _rb++) {
    var _bar = el('div', { className: 'huginn-rec-wave-bar' });
    _bar.style.height = '4px';
    recWave.appendChild(_bar);
    recWaveBars.push(_bar);
  }
  var recHint = el('div', { className: 'huginn-rec-hint', textContent: '\u2190 Сдвиньте для отмены' });
  var recStop = el('div', { className: 'huginn-rec-stop' });
  recStop.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  recStop.style.display = 'none';
  recStop.addEventListener('click', function() { _endRec(false); });
  var recPreview = el('div', { className: 'huginn-rec-preview' });
  recPreview.style.display = 'none';
  recBar.appendChild(recDot);
  recBar.appendChild(recTimer);
  recBar.appendChild(recWave);
  recBar.appendChild(recPreview);
  recBar.appendChild(recHint);
  recBar.appendChild(recStop);

  // Composer elements to hide during recording
  var _composerEls = [];

  if (_huginnHasMedia) {
    micBtn = el('div', {
      className: 'huginn-btn',
      innerHTML: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="9" y="1" width="6" height="11" rx="3"/><path d="M19 10v1a7 7 0 01-14 0v-1"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
    });
  }

  if (_huginnHasVideo) {
    videoRecBtn = el('div', {
      className: 'huginn-btn',
      innerHTML: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
    });
  }

  // Composer right: mic ↔ send morph
  var composerRight = null;
  if (micBtn) {
    composerRight = el('div', { className: 'huginn-composer-right' });
    composerRight.appendChild(micBtn);
    composerRight.appendChild(sendBtn);
  }

  function updateComposerButtons() {
    var hasText = textarea.value.trim().length > 0;
    if (composerRight) {
      composerRight.classList.toggle('huginn-composer-right--has-text', hasText);
    } else {
      sendBtn.style.display = hasText ? 'flex' : 'none';
    }
    if (videoRecBtn) videoRecBtn.style.display = hasText ? 'none' : 'flex';
  }

  textarea.addEventListener('input', function() { autoResize(); sendTypingSignal(); updateComposerButtons(); });

  if (videoRecBtn) composerWrap.appendChild(videoRecBtn);
  if (composerRight) composerWrap.appendChild(composerRight);
  else composerWrap.appendChild(sendBtn);
  composerWrap.appendChild(recBar);
  updateComposerButtons();

  // Press-and-hold recording handlers
  function _beginRec(type) {
    if (_recType) return;
    _recType = type;
    _recLocked = false;
    _recWaveform = [];
    if (navigator.vibrate) navigator.vibrate(10);
    var constraints = type === 'video'
      ? { video: { facingMode: 'user', width: 480, height: 480 }, audio: true }
      : { audio: true };
    navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
      _recStream = stream;
      _recChunks = [];
      var mimeType;
      if (type === 'video') {
        mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm';
      } else {
        mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      }
      _recorder = new MediaRecorder(stream, { mimeType: mimeType });
      _recorder.ondataavailable = function(e) { if (e.data.size > 0) _recChunks.push(e.data); };
      _recorder.onstop = function() { _finishRec(); };
      _recorder.start();
      _recStartTime = Date.now();
      // AnalyserNode for real waveform (voice only)
      if (type === 'voice') {
        try {
          _recAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
          var src = _recAudioCtx.createMediaStreamSource(stream);
          _recAnalyser = _recAudioCtx.createAnalyser();
          _recAnalyser.fftSize = 256;
          src.connect(_recAnalyser);
          var freqData = new Uint8Array(_recAnalyser.frequencyBinCount);
          _recWaveInterval = setInterval(function() {
            _recAnalyser.getByteFrequencyData(freqData);
            var sum = 0;
            for (var i = 0; i < freqData.length; i++) sum += freqData[i];
            var amp = Math.round(sum / freqData.length);
            _recWaveform.push(amp);
            // Animate recording wave bars
            var idx = _recWaveform.length % recWaveBars.length;
            recWaveBars[idx].style.height = Math.max(3, Math.min(17, Math.round(amp / 255 * 17))) + 'px';
          }, 100);
        } catch (e) {}
      }
      // Video preview in rec bar
      if (type === 'video') {
        recPreview.style.display = '';
        recPreview.innerHTML = '';
        var prev = document.createElement('video');
        prev.srcObject = stream;
        prev.muted = true;
        prev.playsInline = true;
        prev.autoplay = true;
        recPreview.appendChild(prev);
        recWave.style.display = 'none';
      } else {
        recPreview.style.display = 'none';
        recWave.style.display = '';
      }
      // Show rec bar, hide composer elements
      _composerEls = Array.from(composerWrap.children).filter(function(c) { return c !== recBar; });
      _composerEls.forEach(function(c) { c.style.display = 'none'; });
      recBar.classList.add('huginn-rec-bar--active');
      recHint.style.display = '';
      recStop.style.display = 'none';
      // Timer
      _recTimerInterval = setInterval(function() {
        var sec = Math.floor((Date.now() - _recStartTime) / 1000);
        recTimer.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
        if (sec >= 60 && type === 'video') _endRec(false);
        if (sec >= 300) _endRec(false);
      }, 500);
    }).catch(function() {
      _recType = null;
      M.Toast({ message: type === 'video' ? 'Нет доступа к камере' : 'Нет доступа к микрофону', type: 'error' });
    });
  }

  function _endRec(cancelled) {
    if (!_recType) return;
    clearInterval(_recTimerInterval);
    clearInterval(_recWaveInterval);
    if (cancelled) {
      if (_recorder && _recorder.state !== 'inactive') { _recorder.ondataavailable = null; _recorder.onstop = null; _recorder.stop(); }
      _cleanupRec();
      return;
    }
    if (_recorder && _recorder.state !== 'inactive') _recorder.stop();
  }

  function _finishRec() {
    var type = _recType;
    var waveform = _recWaveform.slice();
    _cleanupRec();
    if (!_recChunks.length) return;
    var blob = new Blob(_recChunks, { type: type === 'video' ? 'video/webm' : 'audio/webm' });
    var duration = Math.round((Date.now() - _recStartTime) / 1000);
    uploadAndSendMedia(blob, type, duration, type === 'video' ? 'video.webm' : 'voice.webm', waveform);
  }

  function _cleanupRec() {
    _recType = null;
    _recLocked = false;
    if (_recStream) { _recStream.getTracks().forEach(function(tr) { tr.stop(); }); _recStream = null; }
    if (_recAudioCtx) { try { _recAudioCtx.close(); } catch(e) {} _recAudioCtx = null; }
    _recAnalyser = null;
    recBar.classList.remove('huginn-rec-bar--active');
    recPreview.style.display = 'none';
    recPreview.innerHTML = '';
    recWave.style.display = '';
    recWaveBars.forEach(function(b) { b.style.height = '4px'; });
    // Restore composer elements
    _composerEls.forEach(function(c) { c.style.display = ''; });
    updateComposerButtons();
  }

  // Touch handlers for mic button
  if (micBtn) {
    var _micHoldTimer = null;
    micBtn.addEventListener('touchstart', function(e) {
      _recTouchX = e.touches[0].clientX;
      _recTouchY = e.touches[0].clientY;
      _micHoldTimer = setTimeout(function() { _micHoldTimer = null; }, 300);
      _beginRec('voice');
    }, { passive: true });
    micBtn.addEventListener('touchmove', function(e) {
      if (!_recType) return;
      var dx = e.touches[0].clientX - _recTouchX;
      var dy = e.touches[0].clientY - _recTouchY;
      if (dx < -80) {
        recHint.textContent = 'Отмена...';
        recHint.classList.add('huginn-rec-cancel');
      } else if (dy < -60 && !_recLocked) {
        _recLocked = true;
        recHint.style.display = 'none';
        recStop.style.display = '';
        if (navigator.vibrate) navigator.vibrate([5, 5]);
      } else {
        recHint.textContent = '\u2190 Сдвиньте для отмены';
        recHint.classList.remove('huginn-rec-cancel');
      }
    }, { passive: true });
    micBtn.addEventListener('touchend', function(e) {
      if (!_recType) return;
      if (_recLocked) return; // locked mode — wait for stop button
      var dx = (e.changedTouches[0] || {}).clientX - _recTouchX;
      _endRec(dx < -80);
    }, { passive: true });
    // Desktop fallback: click to toggle locked recording
    micBtn.addEventListener('click', function() {
      if (_recType) { _endRec(false); return; }
      _beginRec('voice');
      _recLocked = true;
      setTimeout(function() { if (_recType) { recHint.style.display = 'none'; recStop.style.display = ''; } }, 500);
    });
  }

  // Touch handlers for video button
  if (videoRecBtn) {
    videoRecBtn.addEventListener('touchstart', function(e) {
      _recTouchX = e.touches[0].clientX;
      _recTouchY = e.touches[0].clientY;
      _beginRec('video');
    }, { passive: true });
    videoRecBtn.addEventListener('touchmove', function(e) {
      if (!_recType) return;
      var dx = e.touches[0].clientX - _recTouchX;
      var dy = e.touches[0].clientY - _recTouchY;
      if (dx < -80) {
        recHint.textContent = 'Отмена...';
        recHint.classList.add('huginn-rec-cancel');
      } else if (dy < -60 && !_recLocked) {
        _recLocked = true;
        recHint.style.display = 'none';
        recStop.style.display = '';
        if (navigator.vibrate) navigator.vibrate([5, 5]);
      } else {
        recHint.textContent = '\u2190 Сдвиньте для отмены';
        recHint.classList.remove('huginn-rec-cancel');
      }
    }, { passive: true });
    videoRecBtn.addEventListener('touchend', function(e) {
      if (!_recType) return;
      if (_recLocked) return;
      var dx = (e.changedTouches[0] || {}).clientX - _recTouchX;
      _endRec(dx < -80);
    }, { passive: true });
    videoRecBtn.addEventListener('click', function() {
      if (_recType) { _endRec(false); return; }
      _beginRec('video');
      _recLocked = true;
      setTimeout(function() { if (_recType) { recHint.style.display = 'none'; recStop.style.display = ''; } }, 500);
    });
  }

  function uploadAndSendMedia(blob, type, duration, filename, waveform) {
    M.Toast({ message: type === 'voice' ? 'Отправка голосового...' : 'Отправка видео...', type: 'info' });
    var fd = new FormData();
    fd.append('file', blob, filename);
    fetch('/api/files/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + API.getToken() },
      body: fd,
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (!data.success && !data.download_url) throw new Error('Ошибка загрузки');
      var fileUrl = data.download_url || data.file_url || data.url;
      var body = { text: type === 'voice' ? '\uD83C\uDFA4 Голосовое сообщение' : '\uD83C\uDFA5 Видеосообщение', message_type: type, file_url: fileUrl, file_duration: duration };
      if (waveform && waveform.length) body.waveform = waveform;
      return API.fetch('/chat-groups/' + chatId + '/messages', { method: 'POST', body: body });
    }).then(function(resp) {
      var msg = resp.message || resp;
      if (msg && msg.id) {
        msg.user_name = msg.user_name || (Store.get('user') || {}).name || '';
        msg.user_id = msg.user_id || userId;
        if (emptyStateEl && emptyStateEl.parentNode) { emptyStateEl.remove(); emptyStateEl = null; }
        messages.push(msg);
        if (msg.id > lastMsgId) lastMsgId = msg.id;
        rerenderMessages();
        messagesWrap.scrollTo({ top: messagesWrap.scrollHeight, behavior: 'smooth' });
      }
    }).catch(function() { M.Toast({ message: 'Ошибка отправки', type: 'error' }); });
  }

  page.appendChild(replyBar);
  page.appendChild(emojiPanel);
  page.appendChild(composerWrap);

  // ── Functions ──
  function setReply(msg) {
    replyTo = msg;
    if (msg) {
      editingMsg = null;
      replyBar.classList.add('huginn-reply-bar--visible');
      replyName.textContent = msg.user_name || 'Сообщение';
      replyTextEl.textContent = msg.message || '';
      textarea.focus();
    } else {
      if (!editingMsg) replyBar.classList.remove('huginn-reply-bar--visible');
    }
  }

  function startEdit(msg) {
    editingMsg = msg;
    replyTo = null;
    replyBar.classList.add('huginn-reply-bar--visible');
    replyName.textContent = 'Редактирование';
    replyTextEl.textContent = msg.message || '';
    textarea.value = msg.message || '';
    textarea.focus();
    autoResize();
  }

  function cancelEdit() {
    if (editingMsg) {
      editingMsg = null;
      textarea.value = '';
      autoResize();
      replyBar.classList.remove('huginn-reply-bar--visible');
    }
  }

  function toggleEmoji() {
    emojiOpen = !emojiOpen;
    emojiPanel.classList.toggle('huginn-emoji-panel--visible', emojiOpen);
    if (emojiOpen && emojiGrid.children.length === 0) renderEmojiTab(0);
  }

  function sendTypingSignal() {
    var now = Date.now();
    if (now - _lastTypingSent < 2000) return;
    _lastTypingSent = now;
    API.fetch('/chat-groups/' + chatId + '/typing', { method: 'POST' }).catch(function(){});
  }

  async function sendMessage() {
    var text = textarea.value.trim();
    if (!text) return;
    if (navigator.vibrate) navigator.vibrate(10);
    _huginnPlaySendSound();

    // Edit mode
    if (editingMsg) {
      var editId = editingMsg.id;
      textarea.value = '';
      autoResize();
      cancelEdit();
      replyBar.classList.remove('huginn-reply-bar--visible');
      try {
        await API.fetch('/chat-groups/' + chatId + '/messages/' + editId, { method: 'PUT', body: { text: text } });
        var found = messages.find(function(m) { return m.id === editId; });
        if (found) { found.message = text; found.edited_at = new Date().toISOString(); patchMessage(found.id, { message: text, edited_at: found.edited_at, created_at: found.created_at }); }
      } catch (_) { M.Toast({ message: 'Ошибка редактирования', type: 'error' }); }
      return;
    }

    var body = { text: text };
    var savedReply = replyTo;
    if (savedReply) body.reply_to_id = savedReply.id;

    textarea.value = '';
    autoResize();
    setReply(null);
    if (emojiOpen) toggleEmoji();
    updateComposerButtons();

    // Optimistic send: instant DOM with pending state ⏳ → ✓ or ❌
    var tempId = 'tmp_' + Date.now();
    var tempMsg = {
      id: tempId, user_id: userId, user_name: (Store.get('user') || {}).name || '',
      message: text, message_type: 'text', created_at: new Date().toISOString(), _pending: true,
    };
    if (savedReply) { tempMsg.reply_to = savedReply.id; tempMsg.reply_text = savedReply.message; tempMsg.reply_user_name = savedReply.user_name; }
    if (emptyStateEl && emptyStateEl.parentNode) { emptyStateEl.remove(); emptyStateEl = null; }
    messages.push(tempMsg);
    rerenderMessages();
    messagesWrap.scrollTo({ top: messagesWrap.scrollHeight, behavior: 'smooth' });

    try {
      var resp = await API.fetch('/chat-groups/' + chatId + '/messages', { method: 'POST', body: body });
      var msg = resp.message || resp;
      if (msg && msg.id) {
        var idx = messages.findIndex(function(m) { return m.id === tempId; });
        if (idx >= 0) {
          msg.user_name = msg.user_name || tempMsg.user_name;
          msg.user_id = msg.user_id || userId;
          if (savedReply) { msg.reply_to = savedReply.id; msg.reply_text = savedReply.message; msg.reply_user_name = savedReply.user_name; }
          messages[idx] = msg;
          if (msg.id > lastMsgId) lastMsgId = msg.id;
          var wrapEl = messagesWrap.querySelector('[data-msg-id="' + tempId + '"]');
          if (wrapEl) { wrapEl.dataset.msgId = String(msg.id); wrapEl.classList.remove('huginn-msg-wrap--pending'); }
        }
      }
    } catch (_) {
      var failWrap = messagesWrap.querySelector('[data-msg-id="' + tempId + '"]');
      if (failWrap) {
        failWrap.classList.remove('huginn-msg-wrap--pending');
        failWrap.classList.add('huginn-msg-wrap--failed');
        var retryBtn = el('div', { className: 'huginn-retry-btn', textContent: 'Повторить \u21BB' });
        retryBtn.addEventListener('click', function() {
          var fi = messages.findIndex(function(m) { return m.id === tempId; });
          if (fi >= 0) messages.splice(fi, 1);
          failWrap.remove();
          textarea.value = text;
          autoResize();
          updateComposerButtons();
          sendMessage();
        });
        failWrap.appendChild(retryBtn);
      }
    }
  }

  function attachFile() {
    var input = el('input', { type: 'file', accept: '*/*' });
    input.onchange = function() {
      if (!input.files[0]) return;
      var file = input.files[0];
      if (file.size > 50 * 1024 * 1024) { M.Toast({ message: 'Макс. 50 МБ', type: 'error' }); return; }
      var fd = new FormData();
      fd.append('file', file);

      // Upload progress bar
      var progressWrap = el('div', { className: 'huginn-upload-progress' });
      var barOuter = el('div', { className: 'huginn-upload-bar' });
      var barFill = el('div', { className: 'huginn-upload-bar__fill' });
      barOuter.appendChild(barFill);
      progressWrap.appendChild(el('span', { textContent: file.name }));
      progressWrap.appendChild(barOuter);
      var cancelBtn = el('div', { className: 'huginn-upload-cancel', textContent: '✕' });
      progressWrap.appendChild(cancelBtn);
      var composerEl = document.querySelector('.huginn-composer');
      if (composerEl) composerEl.parentNode.insertBefore(progressWrap, composerEl);

      var xhr = new XMLHttpRequest();
      var cancelled = false;
      cancelBtn.addEventListener('click', function() { cancelled = true; xhr.abort(); progressWrap.remove(); });
      xhr.upload.addEventListener('progress', function(e) {
        if (e.lengthComputable) barFill.style.width = Math.round(e.loaded / e.total * 100) + '%';
      });
      xhr.addEventListener('load', function() {
        progressWrap.remove();
        if (xhr.status >= 200 && xhr.status < 300) {
          M.Toast({ message: 'Файл отправлен', type: 'success' });
          if (!_sseConnected) pollNewMessages();
        } else { M.Toast({ message: 'Ошибка загрузки', type: 'error' }); }
      });
      xhr.addEventListener('error', function() { if (!cancelled) { progressWrap.remove(); M.Toast({ message: 'Ошибка загрузки', type: 'error' }); } });
      xhr.open('POST', '/api/chat-groups/' + chatId + '/upload-file');
      xhr.setRequestHeader('Authorization', 'Bearer ' + API.getToken());
      xhr.send(fd);
    };
    input.click();
  }

  async function deleteMessage(msg) {
    var confirmed = await new Promise(function(resolve) {
      M.Confirm ? M.Confirm({ title: 'Удалить сообщение?', text: 'Сообщение будет удалено для всех', onConfirm: function() { resolve(true); }, onCancel: function() { resolve(false); } }) : resolve(confirm('Удалить сообщение?'));
    });
    if (!confirmed) return;
    try {
      await API.fetch('/chat-groups/' + chatId + '/messages/' + msg.id, { method: 'DELETE' });
      var found = messages.find(function(m) { return m.id === msg.id; });
      if (found) { found.deleted_at = new Date().toISOString(); patchMessage(found.id, { deleted_at: found.deleted_at }); }
    } catch (_) { M.Toast({ message: 'Ошибка удаления', type: 'error' }); }
  }

  // ── Message rendering ──
  function createBubble(msg, prev, next) {
    var mine = msg.user_id === userId;
    var isDeleted = !!msg.deleted_at;
    var isGroup = chatInfo && chatInfo.is_group;
    var pos = _huginnGroupPos(prev, msg, next);
    var grouped = (pos === 'mid' || pos === 'last');
    var showAvatar = !mine && isGroup && (pos === 'single' || pos === 'last');
    var showName = !mine && isGroup && (pos === 'single' || pos === 'first');
    var showTail = (pos === 'single' || pos === 'last');
    var isMedia = (msg.message_type === 'video' && msg.file_url);

    var wrapCls = 'huginn-msg-wrap';
    if (mine) wrapCls += ' huginn-msg-wrap--mine';
    if (msg._pending) wrapCls += ' huginn-msg-wrap--pending';
    wrapCls += grouped ? ' huginn-msg-wrap--grouped' : ' huginn-msg-wrap--spaced';
    var wrap = el('div', { className: wrapCls });
    wrap.dataset.msgId = msg.id;

    if (!mine && isGroup) {
      if (showAvatar) {
        var avatarCol = el('div', { className: 'huginn-avatar-col' });
        avatarCol.appendChild(M.Avatar({ name: msg.user_name || '?', size: 34 }));
        wrap.appendChild(avatarCol);
      } else {
        wrap.appendChild(el('div', { className: 'huginn-avatar-spacer' }));
      }
    }

    var bubDir = mine ? 'out' : 'in';
    var bubCls = 'huginn-bubble huginn-bubble--' + bubDir + ' huginn-bubble--' + pos;
    if (isDeleted) bubCls += ' huginn-bubble--deleted';
    if (isMedia) bubCls += ' huginn-bubble--media';
    var bubble = el('div', { className: bubCls });

    if (isDeleted) {
      bubble.appendChild(el('div', { className: 'huginn-deleted-msg', textContent: 'Сообщение удалено' }));
      wrap.appendChild(bubble);
      return wrap;
    }

    if (showTail) {
      bubble.appendChild(el('div', { className: 'huginn-tail huginn-tail--' + bubDir }));
    }

    if (showName) {
      var peerIdx = (msg.user_id || 0) % 8;
      var nameEl = el('div', { className: 'huginn-sender-name', textContent: msg.user_name || '' });
      nameEl.style.color = 'var(--hg-peer-' + peerIdx + ')';
      bubble.appendChild(nameEl);
    }

    if (msg.reply_to && msg.reply_text) {
      var rp = el('div', { className: 'huginn-bubble-reply' });
      rp.appendChild(el('div', { className: 'huginn-bubble-reply__name', textContent: msg.reply_user_name || '' }));
      rp.appendChild(el('div', { className: 'huginn-bubble-reply__text', textContent: msg.reply_text }));
      bubble.appendChild(rp);
    }

    if (msg.message_type === 'voice' && msg.file_url) {
      bubble.appendChild(_huginnVoicePlayer(msg.file_url, msg.file_duration, msg.waveform));
    } else if (isMedia) {
      bubble.appendChild(_huginnVideoCircle(msg.file_url, msg.file_duration));
    } else if (msg.message) {
      var textSpan = el('span', { className: 'huginn-msg-text' });
      textSpan.appendChild(_huginnParseText(msg.message));
      bubble.appendChild(textSpan);
    }

    if (msg.attachments && msg.attachments.length) {
      msg.attachments.forEach(function(att) {
        var fname = (att.file_path || att.file_name || '').split('/').pop();
        var mime = (att.mime_type || '').toLowerCase();
        var fileUrl = '/api/chat-groups/' + chatId + '/files/' + encodeURIComponent(fname);

        if (mime.indexOf('image/') === 0) {
          var imgMsg = el('div', { className: 'huginn-img-msg huginn-img-msg--loading' });
          // blur placeholder
          if (att.thumb_blur) {
            var blurEl = el('img', { className: 'huginn-img-msg__blur' });
            blurEl.src = att.thumb_blur;
            imgMsg.appendChild(blurEl);
          }
          var img = el('img');
          img.alt = att.file_name || 'Изображение';
          img.dataset.src = fileUrl + '?token=' + API.getToken();
          img.onload = function() { imgMsg.classList.remove('huginn-img-msg--loading'); };
          img.onerror = function() { imgMsg.style.display = 'none'; };
          imgMsg.appendChild(img);
          // timestamp overlay inside image
          var imgTime = el('span', { className: 'huginn-img-msg__time', textContent: _huginnTime(msg.created_at) });
          if (mine) {
            var ck = el('span', { className: 'huginn-check huginn-check--' + (msg.is_read ? 'read' : 'sent') });
            ck.innerHTML = msg.is_read
              ? '<svg width="16" height="10" viewBox="0 0 16 10" fill="none"><path d="M1 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
              : '<svg width="12" height="10" viewBox="0 0 12 10" fill="none"><path d="M1 5l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            imgTime.appendChild(ck);
          }
          imgMsg.appendChild(imgTime);
          imgMsg.addEventListener('click', function() { showImagePreview(fileUrl, att.file_name); });
          // IntersectionObserver lazy load
          if (window.IntersectionObserver) {
            var obs = new IntersectionObserver(function(entries, observer) {
              if (entries[0].isIntersecting) {
                img.src = img.dataset.src;
                observer.disconnect();
              }
            }, { rootMargin: '200px' });
            obs.observe(imgMsg);
          } else {
            img.src = img.dataset.src;
          }
          bubble.appendChild(imgMsg);
        } else if (mime.indexOf('video/') === 0) {
          bubble.appendChild(_huginnVideoCircle(fileUrl + '?token=' + API.getToken(), att.duration));
        } else {
          var fi = _huginnFileIcon(fname);
          var fileMsg = el('div', { className: 'huginn-file-msg' });
          var iconEl = el('div', { className: 'huginn-file-icon ' + fi.cls, textContent: fi.icon });
          fileMsg.appendChild(iconEl);
          var infoWrap = el('div', { style: 'flex:1;min-width:0' });
          infoWrap.appendChild(el('div', { className: 'huginn-file-name', textContent: att.file_name || fname }));
          var sizeText = att.file_size ? _huginnFileSize(att.file_size) : '';
          if (sizeText) infoWrap.appendChild(el('div', { className: 'huginn-file-size', textContent: sizeText }));
          fileMsg.appendChild(infoWrap);
          fileMsg.addEventListener('click', function() { _huginnDownloadFile(fileUrl, att.file_name || fname); });
          bubble.appendChild(fileMsg);
        }
      });
    }

    if (!isMedia) {
      bubble.appendChild(el('span', { className: 'huginn-time-spacer' }));
    }

    var metaEl = el('div', { className: 'huginn-meta-float' });
    var timeText = _huginnTime(msg.created_at) + (msg.edited_at ? ' ред.' : '');
    metaEl.appendChild(el('span', { className: 'huginn-time huginn-time--' + bubDir, textContent: timeText }));
    if (mine) {
      var checkEl = el('span', { className: 'huginn-check huginn-check--' + (msg.is_read ? 'read' : 'sent') });
      checkEl.innerHTML = msg.is_read
        ? '<svg width="16" height="10" viewBox="0 0 16 10" fill="none"><path d="M1 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg width="12" height="10" viewBox="0 0 12 10" fill="none"><path d="M1 5l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      metaEl.appendChild(checkEl);
    }
    bubble.appendChild(metaEl);

    if (msg.reactions && Object.keys(msg.reactions).length) {
      renderReactionsInto(bubble, msg.id, msg.reactions);
    }

    wrap.appendChild(bubble);

    // Swipe-to-reply (full: arrow, resistance, spring-back, deltaY guard)
    var _swStartX = 0, _swStartY = 0, _swDX = 0, _swLocked = false, _swTriggered = false;
    var swipeArrow = el('div', { className: 'huginn-swipe-arrow', innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="14 15 9 20 4 15"/><path d="M20 4h-7a4 4 0 00-4 4v12"/></svg>' });
    wrap.style.position = 'relative';
    wrap.appendChild(swipeArrow);

    wrap.addEventListener('touchstart', function(e) {
      _swStartX = e.touches[0].clientX; _swStartY = e.touches[0].clientY;
      _swDX = 0; _swLocked = false; _swTriggered = false;
    }, { passive: true });
    wrap.addEventListener('touchmove', function(e) {
      var dx = e.touches[0].clientX - _swStartX;
      var dy = e.touches[0].clientY - _swStartY;
      // Lock direction: if vertical dominates, abort swipe
      if (!_swLocked && Math.abs(dy) > Math.abs(dx) * 1.5) { _swDX = 0; return; }
      if (dx > 5) _swLocked = true;
      if (!_swLocked) return;
      _swDX = dx;
      // Resistance 0.6:1
      var visual = Math.min(dx * 0.6, 80);
      wrap.style.transform = 'translateX(' + visual + 'px)';
      wrap.style.transition = 'none';
      // Arrow appears at 30px, full at 40px
      if (visual > 30) { swipeArrow.classList.add('huginn-swipe-arrow--active'); }
      else { swipeArrow.classList.remove('huginn-swipe-arrow--active'); }
      // Haptic at threshold
      if (visual >= 40 && !_swTriggered) { _swTriggered = true; if (navigator.vibrate) navigator.vibrate([5, 5]); }
    }, { passive: true });
    wrap.addEventListener('touchend', function() {
      // Spring-back
      wrap.style.transition = 'transform .3s cubic-bezier(0.34,1.56,0.64,1)';
      wrap.style.transform = '';
      swipeArrow.classList.remove('huginn-swipe-arrow--active');
      if (_swDX * 0.6 >= 40) {
        setReply({ id: msg.id, message: msg.message, user_name: msg.user_name });
        // Focus textarea
        if (textarea) setTimeout(function() { textarea.focus(); }, 100);
      }
    }, { passive: true });

    // Long press 250ms → Context menu with blur
    var _lpTimer = null, _lpStartX = 0, _lpStartY = 0, _lpCancelled = false;
    wrap.addEventListener('touchstart', function(e) {
      _lpStartX = e.touches[0].clientX; _lpStartY = e.touches[0].clientY; _lpCancelled = false;
      _lpTimer = setTimeout(function() {
        if (_lpCancelled) return;
        if (navigator.vibrate) navigator.vibrate(15);
        showContextMenu(msg, mine, _lpStartX, _lpStartY);
      }, 250);
    }, { passive: true });
    wrap.addEventListener('touchmove', function(e) {
      var dx = e.touches[0].clientX - _lpStartX, dy = e.touches[0].clientY - _lpStartY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) { _lpCancelled = true; clearTimeout(_lpTimer); }
    }, { passive: true });
    wrap.addEventListener('touchend', function() { clearTimeout(_lpTimer); }, { passive: true });

    return wrap;
  }

  function showContextMenu(msg, mine, touchX, touchY) {
    var overlay = el('div', { className: 'huginn-ctx-overlay' });

    // Preview of the message
    var menu = el('div', { className: 'huginn-ctx-menu' });
    if (msg.message) {
      var preview = el('div', { className: 'huginn-ctx-bubble-preview' });
      var previewText = msg.message.length > 120 ? msg.message.substring(0, 120) + '...' : msg.message;
      preview.textContent = previewText;
      menu.appendChild(preview);
      menu.appendChild(el('div', { className: 'huginn-ctx-sep' }));
    }

    var items = [
      { icon: '↩️', label: 'Ответить', action: function() { setReply({ id: msg.id, message: msg.message, user_name: msg.user_name }); } },
      { icon: '😀', label: 'Реакция', action: function() { showReactionPopup(msg, document.querySelector('[data-msg-id="' + msg.id + '"]')); } },
    ];
    if (msg.message) {
      items.push({ icon: '📋', label: 'Копировать', action: function() { _huginnCopyText(msg.message); M.Toast({ message: 'Скопировано', type: 'info' }); } });
    }
    // Pin (available to all)
    var isPinned = _pinnedIds && _pinnedIds.indexOf(msg.id) >= 0;
    items.push({
      icon: '📌', label: isPinned ? 'Открепить' : 'Закрепить',
      action: function() {
        var method = isPinned ? 'DELETE' : 'POST';
        API.fetch('/chat-groups/' + chatId + '/pin/' + msg.id, { method: method }).then(function() {
          M.Toast({ message: isPinned ? 'Откреплено' : 'Закреплено', type: 'info' });
          loadPinnedMessages();
        }).catch(function() { M.Toast({ message: 'Ошибка', type: 'error' }); });
      }
    });
    if (mine) {
      items.push({ sep: true });
      items.push({ icon: '✏️', label: 'Редактировать', action: function() { startEdit(msg); } });
      items.push({ icon: '🗑️', label: 'Удалить', danger: true, action: function() { deleteMessage(msg); } });
    } else if (isAdmin) {
      items.push({ sep: true });
      items.push({ icon: '🗑️', label: 'Удалить', danger: true, action: function() { deleteMessage(msg); } });
    }

    items.forEach(function(it) {
      if (it.sep) { menu.appendChild(el('div', { className: 'huginn-ctx-sep' })); return; }
      var item = el('div', { className: 'huginn-ctx-item' + (it.danger ? ' huginn-ctx-item--danger' : '') });
      item.appendChild(el('span', { textContent: it.icon }));
      item.appendChild(el('span', { textContent: it.label }));
      item.addEventListener('click', function() { overlay.remove(); it.action(); });
      menu.appendChild(item);
    });

    // Position menu
    var vw = window.innerWidth, vh = window.innerHeight;
    var menuX = Math.min(touchX, vw - 220);
    var menuY = Math.min(touchY, vh - items.length * 44 - 60);
    if (menuX < 8) menuX = 8;
    if (menuY < 60) menuY = 60;
    menu.style.left = menuX + 'px';
    menu.style.top = menuY + 'px';

    overlay.appendChild(menu);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  function showImagePreview(url, title) {
    var content = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', maxHeight: '80vh' } });
    var img = el('img', {
      style: { maxWidth: '100%', maxHeight: '70vh', borderRadius: '8px', objectFit: 'contain' },
    });
    img.src = url + '?token=' + API.getToken();
    img.alt = title || '';
    content.appendChild(img);
    M.BottomSheet({ title: title || 'Изображение', content: content });
  }

  function showVideoPreview(url, title) {
    var content = el('div', { style: { padding: '8px' } });
    var video = el('video', {
      style: { width: '100%', maxHeight: '70vh', borderRadius: '8px' },
    });
    video.controls = true;
    video.autoplay = true;
    video.src = url + '?token=' + API.getToken();
    content.appendChild(video);
    M.BottomSheet({ title: title || 'Видео', content: content });
  }

  function showReactionPopup(msg, targetEl) {
    var existing = document.querySelector('.huginn-reaction-popup');
    if (existing) existing.remove();
    var existingOv = document.querySelector('.huginn-reaction-overlay');
    if (existingOv) existingOv.remove();

    var rect = targetEl ? targetEl.getBoundingClientRect() : { top: 200 };
    var popupTop = Math.max(8, Math.min(rect.top - 50, window.innerHeight - 60));
    var popup = el('div', { className: 'huginn-reaction-popup' });
    popup.style.top = popupTop + 'px';

    var overlay = el('div', { className: 'huginn-reaction-overlay' });
    overlay.addEventListener('click', function() { popup.remove(); overlay.remove(); });

    QUICK_REACTIONS.forEach(function(em) {
      var btn = el('div', { textContent: em });
      btn.addEventListener('click', function() {
        if (navigator.vibrate) navigator.vibrate(3);
        toggleReaction(msg.id, em);
        popup.remove(); overlay.remove();
      });
      popup.appendChild(btn);
    });

    document.body.appendChild(overlay);
    document.body.appendChild(popup);
  }

  async function toggleReaction(msgId, emoji) {
    try {
      var resp = await API.fetch('/chat-groups/' + chatId + '/messages/' + msgId + '/reaction', { method: 'POST', body: { emoji: emoji } });
      var msg = messages.find(function(m) { return m.id === msgId; });
      if (msg && resp.reactions) { msg.reactions = resp.reactions; patchMessage(msgId, { reactions: resp.reactions }); }
    } catch (_) {}
  }

  function appendDateSeparator(dateStr) {
    messagesWrap.appendChild(el('div', { className: 'huginn-date-pill', textContent: _huginnDateLabel(dateStr) }));
  }

  function appendMessage(msg, prev, next) {
    if (!prev || !_huginnSameDay(prev.created_at, msg.created_at)) appendDateSeparator(msg.created_at);
    messagesWrap.appendChild(createBubble(msg, prev, next));
  }

  function rerenderMessages() {
    messagesWrap.replaceChildren();
    messages.forEach(function(msg, i) {
      var prev = i > 0 ? messages[i - 1] : null;
      var next = i < messages.length - 1 ? messages[i + 1] : null;
      appendMessage(msg, prev, next);
    });
  }

  function renderReactionsInto(bubble, msgId, reactions) {
    if (!reactions || !Object.keys(reactions).length) return;
    var reactRow = el('div', { className: 'huginn-reactions-row' });
    for (var emoji in reactions) {
      var users = reactions[emoji];
      var isMine = Array.isArray(users) && users.includes(userId);
      (function(em, us, im) {
        var pillCls = 'huginn-reaction-pill' + (im ? ' huginn-reaction-pill--mine' : '');
        var rb = el('div', {
          className: pillCls,
          onClick: function(e) { e.stopPropagation(); toggleReaction(msgId, em); },
        });
        rb.appendChild(el('span', { textContent: em }));
        if (us.length > 1) rb.appendChild(el('span', { className: 'huginn-reaction-pill__count', textContent: String(us.length) }));
        reactRow.appendChild(rb);
      })(emoji, users, isMine);
    }
    bubble.appendChild(reactRow);
  }

  function patchMessage(msgId, updates) {
    var wrap = messagesWrap.querySelector('[data-msg-id="' + msgId + '"]');
    if (!wrap) return;
    if (updates.deleted_at) {
      wrap.style.maxHeight = wrap.offsetHeight + 'px';
      void wrap.offsetWidth; // force reflow
      wrap.classList.add('huginn-msg-wrap--collapsing');
      setTimeout(function() { wrap.remove(); }, 280);
      return;
    }
    if (updates.message !== undefined) {
      var textEl = wrap.querySelector('.huginn-msg-text');
      if (textEl) { textEl.textContent = ''; textEl.appendChild(_huginnParseText(updates.message)); }
      if (updates.edited_at) {
        var timeEl = wrap.querySelector('.huginn-time');
        if (timeEl) timeEl.textContent = _huginnTime(updates.created_at || updates.edited_at) + ' ред.';
      }
    }
    if (updates.reactions !== undefined) {
      var bubble = wrap.querySelector('.huginn-bubble');
      if (!bubble) return;
      var existingRow = bubble.querySelector('.huginn-reactions-row');
      if (existingRow) existingRow.remove();
      renderReactionsInto(bubble, msgId, updates.reactions);
    }
  }

  // ── Load initial messages (cache-first) ──
  var _cachedData = (typeof window !== 'undefined' && window._huginnMsgCache && window._huginnMsgCache[chatId]) || null;
  if (_cachedData && _cachedData.messages && _cachedData.messages.length) {
    // Instant render from cache
    messages = _cachedData.messages;
    lastMsgId = _cachedData.lastMsgId || Math.max.apply(null, messages.map(function(m) { return m.id; }));
    oldestMsgId = Math.min.apply(null, messages.map(function(m) { return m.id; }));
    hasOlder = true;
    rerenderMessages();
    setTimeout(function() { messagesWrap.scrollTop = _cachedData.scrollPos || messagesWrap.scrollHeight; }, 50);
    // Background fetch for newer messages
    API.fetch('/chat-groups/' + chatId + '/messages?limit=50&after_id=' + lastMsgId).then(function(resp) {
      var newMsgs = API.extractRows(resp);
      if (newMsgs.length) {
        newMsgs.forEach(function(msg) {
          if (!messages.find(function(m) { return m.id === msg.id; })) messages.push(msg);
        });
        lastMsgId = Math.max(lastMsgId, Math.max.apply(null, newMsgs.map(function(m) { return m.id; })));
        rerenderMessages();
      }
    }).catch(function() {});
  } else {
    // Normal load
    try {
      messagesWrap.appendChild(M.Skeleton({ type: 'list', count: 4 }));
      var initResp = await API.fetch('/chat-groups/' + chatId + '/messages?limit=50');
      var list = API.extractRows(initResp);
      messagesWrap.replaceChildren();

      if (!list.length) {
        emptyStateEl = M.Empty({ text: 'Начните диалог' });
        messagesWrap.appendChild(emptyStateEl);
      } else {
        messages = list;
        lastMsgId = Math.max.apply(null, list.map(function(m) { return m.id; }));
        oldestMsgId = Math.min.apply(null, list.map(function(m) { return m.id; }));
        hasOlder = list.length >= 50;
        rerenderMessages();
        setTimeout(function() { messagesWrap.scrollTop = messagesWrap.scrollHeight; }, 50);
      }
    } catch (loadErr) {
      console.error('[Huginn] messages load error:', loadErr);
      messagesWrap.replaceChildren();
      messagesWrap.appendChild(M.ErrorBanner({ text: 'Не удалось загрузить сообщения', onRetry: function() { Router.navigate('/messenger/' + chatId, { replace: true }); } }));
    }
  }

  // ── Load older messages ──
  async function loadOlderMessages() {
    if (loadingOlder || !hasOlder) return;
    loadingOlder = true;
    var prevScrollHeight = messagesWrap.scrollHeight;
    try {
      var resp = await API.fetch('/chat-groups/' + chatId + '/messages?limit=30&before_id=' + oldestMsgId);
      var older = API.extractRows(resp);
      if (older.length < 30) hasOlder = false;
      if (older.length) {
        oldestMsgId = Math.min.apply(null, older.map(function(m) { return m.id; }));
        messages = older.concat(messages);
        rerenderMessages();
        requestAnimationFrame(function() { messagesWrap.scrollTop = messagesWrap.scrollHeight - prevScrollHeight; });
      }
    } catch (_) {}
    loadingOlder = false;
  }

  // ── SSE via SSEManager (singleton — НЕ переподключается при навигации) ──
  if (typeof SSEManager !== 'undefined') SSEManager.connect();
  var _sseUnsubs = [];

  function _sseOn(evt, fn) { _sseUnsubs.push(SSEManager.on(evt, fn)); }

  _sseOn('chat:new_message', function(data) {
    if (String(data.chat_id) !== String(chatId)) return;
    var msg = data.message;
    if (!msg || !msg.id) return;
    if (messages.find(function(m) { return m.id === msg.id; })) return;
    var pendingIdx = (msg.user_id === userId) ? messages.findIndex(function(m) { return m._pending && m.message === msg.message; }) : -1;
    if (pendingIdx >= 0) {
      messages[pendingIdx] = msg;
      if (msg.id > lastMsgId) lastMsgId = msg.id;
      var pw = messagesWrap.querySelector('.huginn-msg-wrap--pending');
      if (pw) { pw.dataset.msgId = String(msg.id); pw.classList.remove('huginn-msg-wrap--pending'); }
      return;
    }
    if (emptyStateEl && emptyStateEl.parentNode) { emptyStateEl.remove(); emptyStateEl = null; }
    var wasAtBottom = messagesWrap.scrollHeight - messagesWrap.scrollTop - messagesWrap.clientHeight < 100;
    messages.push(msg);
    if (msg.id > lastMsgId) lastMsgId = msg.id;
    rerenderMessages();
    if (wasAtBottom) { messagesWrap.scrollTo({ top: messagesWrap.scrollHeight, behavior: 'smooth' }); markRead(); }
    else if (msg.user_id !== userId) { _unreadBelow++; updateFabBadge(); }
    if (msg.user_id !== userId) _huginnPlayNotifSound();
  });

  _sseOn('chat:typing', function(data) {
    if (String(data.chat_id) !== String(chatId) || data.user_id === userId) return;
    _typingUser = data.user_name || 'Кто-то';
    updateHeaderSubtitle();
    clearTimeout(_typingTimer);
    _typingTimer = setTimeout(function() { _typingUser = null; updateHeaderSubtitle(); }, 5000);
  });

  _sseOn('presence', function(data) {
    if (directMember && data.user_id === directMember.user_id) {
      directMember.online = data.online;
      if (data.last_seen) directMember.last_login_at = data.last_seen;
      updateHeaderSubtitle();
    }
  });

  _sseOn('chat:message_edited', function(data) {
    if (String(data.chat_id) !== String(chatId)) return;
    var found = messages.find(function(m) { return m.id === data.message_id; });
    if (found) { found.message = data.text; found.edited_at = data.edited_at; patchMessage(found.id, { message: data.text, edited_at: data.edited_at, created_at: found.created_at }); }
  });

  _sseOn('chat:message_deleted', function(data) {
    if (String(data.chat_id) !== String(chatId)) return;
    var found = messages.find(function(m) { return m.id === data.message_id; });
    if (found) { found.deleted_at = new Date().toISOString(); patchMessage(found.id, { deleted_at: found.deleted_at }); }
  });

  _sseOn('chat:reaction', function(data) {
    if (String(data.chat_id) !== String(chatId)) return;
    var found = messages.find(function(m) { return m.id === data.message_id; });
    if (found) { found.reactions = data.reactions; patchMessage(found.id, { reactions: data.reactions }); }
  });

  _sseOn('pin', function(data) { if (String(data.chat_id) === String(chatId)) loadPinnedMessages(); });
  _sseOn('unpin', function(data) { if (String(data.chat_id) === String(chatId)) loadPinnedMessages(); });

  _sseOn('chat:read', function(data) {
    if (String(data.chat_id) !== String(chatId)) return;
    if (data.user_id === userId) return;
    // Update check marks: all messages up to data.message_id become read
    messages.forEach(function(m) {
      if (m.user_id === userId && m.id <= data.message_id && !m.is_read) {
        m.is_read = true;
        var bubble = messagesWrap.querySelector('[data-msg-id="' + m.id + '"] .huginn-check');
        if (bubble) {
          bubble.className = 'huginn-check huginn-check--read';
          bubble.innerHTML = '<svg width="16" height="10" viewBox="0 0 16 10" fill="none"><path d="M1 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        }
      }
    });
  });

  // Connection state indicator
  var _connUnsub = SSEManager.onConnection(function(connected) {
    _sseConnected = connected;
    if (!connected) {
      headerSub.textContent = 'Подключение...';
      headerSub.style.color = 'var(--hg-hint)';
    } else {
      updateHeaderSubtitle();
      // Fetch missed messages
      pollNewMessages();
    }
  });

  // ── Read receipts ──
  var _readTimer = null;
  function markRead() {
    clearTimeout(_readTimer);
    _readTimer = setTimeout(function() {
      if (!lastMsgId) return;
      API.fetch('/chat-groups/' + chatId + '/read', { method: 'POST', body: { last_message_id: lastMsgId } }).catch(function() {});
    }, 1000);
  }
  // Mark read on open
  markRead();
  // Mark read on scroll to bottom
  messagesWrap.addEventListener('scroll', function() {
    if (messagesWrap.scrollHeight - messagesWrap.scrollTop - messagesWrap.clientHeight < 100) markRead();
  }, { passive: true });

  // ── Fallback polling (only if SSE is down) ──
  async function pollNewMessages() {
    if (!page.isConnected) return;
    try {
      var resp = await API.fetch('/chat-groups/' + chatId + '/messages?limit=50&after_id=' + lastMsgId);
      var newMsgs = API.extractRows(resp);
      if (newMsgs.length) {
        var wasAtBottom = messagesWrap.scrollHeight - messagesWrap.scrollTop - messagesWrap.clientHeight < 100;
        if (emptyStateEl && emptyStateEl.parentNode) { emptyStateEl.remove(); emptyStateEl = null; }
        newMsgs.forEach(function(msg) {
          if (messages.find(function(m) { return m.id === msg.id; })) return;
          messages.push(msg);
        });
        rerenderMessages();
        lastMsgId = Math.max(lastMsgId, Math.max.apply(null, newMsgs.map(function(m) { return m.id; })));
        if (wasAtBottom) messagesWrap.scrollTo({ top: messagesWrap.scrollHeight, behavior: 'smooth' });
      }
    } catch (_) {}
  }

  // Fallback poll every 15 sec (only when SSE disconnected)
  var _pollFallback = setInterval(function() {
    if (!SSEManager.isConnected()) pollNewMessages();
  }, 15000);

  // ── Draft cache ──
  var _draftCache = (typeof window !== 'undefined' && window._huginnDrafts) || {};
  if (typeof window !== 'undefined') window._huginnDrafts = _draftCache;
  // Restore draft
  if (_draftCache[chatId] && textarea) textarea.value = _draftCache[chatId];

  // Tab-bar: hide when in chat
  if (typeof Layout !== 'undefined' && Layout.hideTabBar) Layout.hideTabBar();

  // Lifecycle: cleanup через Router.onLeave
  if (typeof Router !== 'undefined' && Router.onLeave) {
    Router.onLeave(function() {
      clearInterval(_pollFallback);
      // Save draft
      if (textarea && textarea.value.trim()) _draftCache[chatId] = textarea.value;
      else delete _draftCache[chatId];
      // Save messages cache
      if (typeof window !== 'undefined') {
        if (!window._huginnMsgCache) window._huginnMsgCache = {};
        window._huginnMsgCache[chatId] = { messages: messages.slice(-100), scrollPos: messagesWrap.scrollTop, lastMsgId: lastMsgId };
      }
      // Unsubscribe SSE listeners (but do NOT close the connection)
      _sseUnsubs.forEach(function(unsub) { unsub(); });
      _connUnsub();
      if (typeof Layout !== 'undefined' && Layout.showTabBar) Layout.showTabBar();
    });
  }

  return page;
}

/* ═══════════════════════════════════════════
   ACTION SHEETS
   ═══════════════════════════════════════════ */
function chatActionsSheet(chatId) {
  var myId = (Store.get('user') || {}).id;
  API.fetch('/chat-groups/' + chatId).then(function(resp) {
    var chat = resp.chat || resp || {};
    var members = resp.members || [];
    var me = members.find(function(m) { return m.user_id === myId; });
    var isMuted = me && me.muted_until && new Date(me.muted_until) > new Date();
    var amAdmin = me && (me.role === 'owner' || me.role === 'admin');

    var actions = [
      isMuted
        ? { icon: '🔔', label: 'Включить уведомления', onClick: function() {
            API.fetch('/chat-groups/' + chatId + '/mute', { method: 'PUT', body: { until: null } })
              .then(function() { M.Toast({ message: 'Уведомления включены', type: 'success' }); })
              .catch(function() { M.Toast({ message: 'Ошибка', type: 'error' }); });
          }}
        : { icon: '🔇', label: 'Выключить уведомления', onClick: function() { muteOptionsSheet(chatId); } },
      { icon: '👥', label: 'Участники (' + members.length + ')', onClick: function() { showMembersSheet(chatId, members, amAdmin); } },
      { icon: '📎', label: 'Файлы', onClick: function() { showFilesSheet(chatId); } },
    ];
    if (chat.is_group && amAdmin) {
      actions.push({ icon: '⚙️', label: 'Настройки группы', onClick: function() { showGroupSettings(chatId, chat); } });
    }

    M.ActionSheet({ title: chat.name || 'Действия', actions: actions });
  }).catch(function() {
    M.ActionSheet({
      title: 'Действия',
      actions: [
        { icon: '🔇', label: 'Выключить уведомления', onClick: function() { muteOptionsSheet(chatId); } },
        { icon: '👥', label: 'Участники', onClick: function() { showMembersSheet(chatId, [], false); } },
        { icon: '📎', label: 'Файлы', onClick: function() { showFilesSheet(chatId); } },
      ],
    });
  });
}

/* ── Members BottomSheet ── */
function showMembersSheet(chatId, members, amAdmin) {
  var el = Utils.el;
  var content = el('div');

  // Add member button (admin only)
  if (amAdmin) {
    var addBtn = el('div', { className: 'huginn-member-row', style: { color: 'var(--hg-accent)' } });
    addBtn.appendChild(el('div', { style: { width: '42px', height: '42px', borderRadius: '50%', background: 'rgba(106,178,242,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: '0' }, textContent: '+' }));
    var addInfo = el('div', { className: 'huginn-member-info' });
    addInfo.appendChild(el('div', { className: 'huginn-member-name', style: { color: 'var(--hg-accent)' }, textContent: 'Добавить участника' }));
    addBtn.appendChild(addInfo);
    addBtn.addEventListener('click', function() { addMemberSheet(chatId); });
    content.appendChild(addBtn);
  }

  members.forEach(function(m) {
    var row = el('div', { className: 'huginn-member-row' });
    var avatarWrap = el('div', { className: 'huginn-member-avatar' });
    avatarWrap.appendChild(M.Avatar({ name: m.name || '', size: 42 }));
    // Online dot
    var isOnline = m.last_login_at && (Date.now() - new Date(m.last_login_at).getTime() < 300000);
    if (isOnline) avatarWrap.appendChild(el('div', { className: 'huginn-member-online' }));
    row.appendChild(avatarWrap);

    var info = el('div', { className: 'huginn-member-info' });
    var nameRow = el('div', { className: 'huginn-member-name' });
    nameRow.appendChild(el('span', { textContent: m.name || '' }));
    if (m.role === 'owner') nameRow.appendChild(el('span', { className: 'huginn-member-role-badge', textContent: '👑' }));
    else if (m.role === 'admin') nameRow.appendChild(el('span', { className: 'huginn-member-role-badge', textContent: '⭐' }));
    info.appendChild(nameRow);

    var statusText = isOnline ? 'онлайн' : (m.last_login_at ? _huginnOnlineLabel(m.last_login_at) : '');
    var status = el('div', { className: 'huginn-member-status', textContent: statusText });
    if (isOnline) status.style.color = 'var(--hg-online, #34C759)';
    info.appendChild(status);
    row.appendChild(info);

    // Admin actions
    if (amAdmin && m.user_id !== (Store.get('user') || {}).id) {
      row.addEventListener('click', function() {
        var actions = [];
        if (m.role !== 'admin' && m.role !== 'owner') {
          actions.push({ icon: '⭐', label: 'Назначить админом', onClick: function() {
            API.fetch('/chat-groups/' + chatId + '/members/' + m.user_id + '/role', { method: 'PUT', body: { role: 'admin' } })
              .then(function() { M.Toast({ message: 'Роль обновлена', type: 'success' }); })
              .catch(function() { M.Toast({ message: 'Ошибка', type: 'error' }); });
          }});
        } else if (m.role === 'admin') {
          actions.push({ icon: '👤', label: 'Снять админа', onClick: function() {
            API.fetch('/chat-groups/' + chatId + '/members/' + m.user_id + '/role', { method: 'PUT', body: { role: 'member' } })
              .then(function() { M.Toast({ message: 'Роль обновлена', type: 'success' }); })
              .catch(function() { M.Toast({ message: 'Ошибка', type: 'error' }); });
          }});
        }
        actions.push({ icon: '🗑️', label: 'Удалить из чата', onClick: function() {
          API.fetch('/chat-groups/' + chatId + '/members/' + m.user_id, { method: 'DELETE' })
            .then(function() { M.Toast({ message: 'Удалён', type: 'success' }); })
            .catch(function() { M.Toast({ message: 'Ошибка', type: 'error' }); });
        }});
        if (actions.length) M.ActionSheet({ title: m.name, actions: actions });
      });
    }

    content.appendChild(row);
  });

  M.BottomSheet({ title: 'Участники (' + members.length + ')', content: content });
}

/* ── Add member to group ── */
function addMemberSheet(chatId) {
  var el = Utils.el;
  var content = el('div');
  var searchInput = el('input', {
    className: 'huginn-group-field',
    placeholder: 'Поиск по имени...',
  });
  content.appendChild(searchInput);
  var results = el('div', { style: { maxHeight: '300px', overflowY: 'auto' } });
  content.appendChild(results);

  var _timer = null;
  searchInput.addEventListener('input', function() {
    clearTimeout(_timer);
    var q = searchInput.value.trim();
    if (q.length < 2) { results.replaceChildren(); return; }
    _timer = setTimeout(function() {
      API.fetch('/users?search=' + encodeURIComponent(q) + '&is_active=true&limit=20').then(function(resp) {
        results.replaceChildren();
        (resp.users || []).forEach(function(u) {
          var row = el('div', { className: 'huginn-member-row' });
          row.appendChild(M.Avatar({ name: u.name || u.login, size: 36 }));
          var info = el('div', { className: 'huginn-member-info' });
          info.appendChild(el('div', { className: 'huginn-member-name', textContent: u.name || u.login }));
          info.appendChild(el('div', { className: 'huginn-member-status', textContent: u.role || '' }));
          row.appendChild(info);
          row.addEventListener('click', function() {
            API.fetch('/chat-groups/' + chatId + '/members', { method: 'POST', body: { user_id: u.id } })
              .then(function() { M.Toast({ message: (u.name || u.login) + ' добавлен', type: 'success' }); })
              .catch(function() { M.Toast({ message: 'Ошибка добавления', type: 'error' }); });
          });
          results.appendChild(row);
        });
      }).catch(function() {});
    }, 300);
  });

  M.BottomSheet({ title: 'Добавить участника', content: content });
  setTimeout(function() { searchInput.focus(); }, 300);
}

/* ── Files BottomSheet ── */
function showFilesSheet(chatId) {
  var el = Utils.el;
  var content = el('div');

  // Tabs
  var tabs = el('div', { className: 'huginn-files-tabs' });
  var tabMedia = el('div', { className: 'huginn-files-tab huginn-files-tab--active', textContent: 'Медиа' });
  var tabFiles = el('div', { className: 'huginn-files-tab', textContent: 'Файлы' });
  var tabLinks = el('div', { className: 'huginn-files-tab', textContent: 'Ссылки' });
  tabs.appendChild(tabMedia);
  tabs.appendChild(tabFiles);
  tabs.appendChild(tabLinks);
  content.appendChild(tabs);

  var body = el('div', { style: { maxHeight: '60vh', overflowY: 'auto' } });
  content.appendChild(body);

  var allFiles = [];

  function renderTab(tab) {
    [tabMedia, tabFiles, tabLinks].forEach(function(t) { t.classList.remove('huginn-files-tab--active'); });
    tab.classList.add('huginn-files-tab--active');
    body.replaceChildren();

    if (tab === tabMedia) {
      var grid = el('div', { className: 'huginn-media-grid' });
      var mediaFiles = allFiles.filter(function(f) { return (f.mime_type || '').match(/^(image|video)\//); });
      if (!mediaFiles.length) { body.appendChild(el('div', { style: { padding: '32px', textAlign: 'center', color: 'var(--hg-hint)', fontSize: '14px' }, textContent: 'Нет медиа' })); return; }
      mediaFiles.forEach(function(f) {
        var item = el('div', { className: 'huginn-media-grid__item' });
        var fname = (f.file_path || f.file_name || '').split('/').pop();
        var url = '/api/chat-groups/' + chatId + '/files/' + encodeURIComponent(fname) + '?token=' + API.getToken();
        if ((f.mime_type || '').indexOf('image/') === 0) {
          var img = el('img');
          img.loading = 'lazy';
          img.src = url;
          item.appendChild(img);
          item.addEventListener('click', function() {
            var full = el('div', { style: { padding: '8px', display: 'flex', justifyContent: 'center' } });
            var fullImg = el('img', { style: { maxWidth: '100%', maxHeight: '70vh', borderRadius: '8px' } });
            fullImg.src = url;
            full.appendChild(fullImg);
            M.BottomSheet({ title: f.file_name, content: full });
          });
        } else {
          item.style.background = '#1a1a2e';
          item.appendChild(el('div', { className: 'huginn-media-grid__play', innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(255,255,255,0.8)"><polygon points="5 3 19 12 5 21 5 3"/></svg>' }));
          item.addEventListener('click', function() {
            var full = el('div', { style: { padding: '8px' } });
            var vid = el('video', { style: { width: '100%', maxHeight: '70vh', borderRadius: '8px' } });
            vid.controls = true; vid.autoplay = true; vid.src = url;
            full.appendChild(vid);
            M.BottomSheet({ title: f.file_name, content: full });
          });
        }
        grid.appendChild(item);
      });
      body.appendChild(grid);
    } else if (tab === tabFiles) {
      var docs = allFiles.filter(function(f) { return !(f.mime_type || '').match(/^(image|video)\//); });
      if (!docs.length) { body.appendChild(el('div', { style: { padding: '32px', textAlign: 'center', color: 'var(--hg-hint)', fontSize: '14px' }, textContent: 'Нет файлов' })); return; }
      docs.forEach(function(f) {
        var row = el('div', { className: 'huginn-file-list-row' });
        var fi = _huginnFileIcon(f.file_name);
        row.appendChild(el('div', { className: 'huginn-file-icon ' + fi.cls, textContent: fi.icon }));
        var meta = el('div', { className: 'huginn-file-list-meta' });
        meta.appendChild(el('div', { className: 'huginn-file-list-name', textContent: f.file_name }));
        var sub = _huginnFileSize(f.file_size);
        if (f.user_name) sub += (sub ? ' · ' : '') + f.user_name;
        meta.appendChild(el('div', { className: 'huginn-file-list-sub', textContent: sub }));
        row.appendChild(meta);
        row.addEventListener('click', function() {
          var fname = (f.file_path || f.file_name || '').split('/').pop();
          _huginnDownloadFile('/api/chat-groups/' + chatId + '/files/' + encodeURIComponent(fname), f.file_name);
        });
        body.appendChild(row);
      });
    } else {
      // Links — extract from messages (we don't have a dedicated link store)
      body.appendChild(el('div', { style: { padding: '32px', textAlign: 'center', color: 'var(--hg-hint)', fontSize: '14px' }, textContent: 'Ссылки из сообщений пока недоступны' }));
    }
  }

  tabMedia.addEventListener('click', function() { renderTab(tabMedia); });
  tabFiles.addEventListener('click', function() { renderTab(tabFiles); });
  tabLinks.addEventListener('click', function() { renderTab(tabLinks); });

  // Load files
  API.fetch('/chat-groups/' + chatId + '/files-list').then(function(resp) {
    allFiles = resp.files || [];
    renderTab(tabMedia);
  }).catch(function() {
    body.appendChild(el('div', { style: { padding: '32px', textAlign: 'center', color: 'var(--hg-hint)', fontSize: '14px' }, textContent: 'Ошибка загрузки' }));
  });

  M.BottomSheet({ title: 'Файлы чата', content: content });
}

/* ── Group Settings ── */
function showGroupSettings(chatId, chat) {
  var el = Utils.el;
  var content = el('div', { style: { padding: '8px 0' } });

  var nameInput = el('input', { className: 'huginn-group-field', value: chat.name || '', placeholder: 'Название группы' });
  content.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--hg-hint)', marginBottom: '4px' }, textContent: 'Название' }));
  content.appendChild(nameInput);

  var descInput = el('textarea', { className: 'huginn-group-field', style: { minHeight: '60px', resize: 'vertical' }, placeholder: 'Описание (необязательно)' });
  descInput.value = chat.description || '';
  content.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--hg-hint)', marginBottom: '4px' }, textContent: 'Описание' }));
  content.appendChild(descInput);

  var saveBtn = el('button', { className: 'huginn-group-save', textContent: 'Сохранить' });
  saveBtn.addEventListener('click', function() {
    var name = nameInput.value.trim();
    if (!name) { M.Toast({ message: 'Введите название', type: 'warning' }); return; }
    API.fetch('/chat-groups/' + chatId, {
      method: 'PUT',
      body: { name: name, description: descInput.value.trim() || null },
    }).then(function() {
      M.Toast({ message: 'Настройки сохранены', type: 'success' });
    }).catch(function() { M.Toast({ message: 'Ошибка', type: 'error' }); });
  });
  content.appendChild(saveBtn);

  M.BottomSheet({ title: 'Настройки группы', content: content });
}

function muteOptionsSheet(chatId) {
  M.ActionSheet({
    title: 'Выключить уведомления',
    actions: [
      { icon: '\u23F1', label: 'На 1 час', onClick: function() { muteChatFor(chatId, 3600000); } },
      { icon: '\u23F0', label: 'На 8 часов', onClick: function() { muteChatFor(chatId, 28800000); } },
      { icon: '\uD83D\uDD07', label: 'Навсегда', onClick: function() { muteChatFor(chatId, 365 * 86400000); } },
    ],
  });
}

function muteChatFor(chatId, ms) {
  API.fetch('/chat-groups/' + chatId + '/mute', {
    method: 'PUT',
    body: { until: new Date(Date.now() + ms).toISOString() },
  }).then(function() {
    M.Toast({ message: 'Уведомления выключены', type: 'info' });
  }).catch(function() { M.Toast({ message: 'Ошибка', type: 'error' }); });
}

/* ── Compose Direct Chat (user search → create direct) ── */
function composeDirectChat() {
  var el = Utils.el;
  var content = el('div');
  var searchInput = el('input', {
    style: { width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid var(--hg-sep, rgba(255,255,255,0.06))', background: 'var(--hg-input-field, rgba(35,46,60,0.5))', color: 'var(--hg-text, #f5f5f5)', fontSize: '15px', outline: 'none', boxSizing: 'border-box', marginBottom: '12px' },
    placeholder: 'Поиск по имени...',
  });
  content.appendChild(searchInput);
  var results = el('div', { style: { maxHeight: '300px', overflowY: 'auto' } });
  content.appendChild(results);

  var _searchTimer = null;
  searchInput.addEventListener('input', function() {
    clearTimeout(_searchTimer);
    var q = searchInput.value.trim();
    if (q.length < 2) { results.replaceChildren(); return; }
    _searchTimer = setTimeout(function() {
      API.fetch('/users?search=' + encodeURIComponent(q) + '&is_active=true&limit=20').then(function(resp) {
        var users = resp.users || [];
        results.replaceChildren();
        var myId = (Store.get('user') || {}).id;
        users.forEach(function(u) {
          if (u.id === myId) return;
          var row = el('div', {
            className: 'huginn-chat-row',
            onClick: function() {
              API.fetch('/chat-groups/direct', { method: 'POST', body: { user_id: u.id } }).then(function(resp) {
                var chatId = (resp.chat || resp).id;
                Router.navigate('/messenger/' + chatId);
              }).catch(function() { M.Toast({ message: 'Ошибка создания чата', type: 'error' }); });
            },
          });
          row.appendChild(M.Avatar({ name: u.name || u.login, size: 40 }));
          var info = el('div', { className: 'huginn-chat-row__info' });
          info.appendChild(el('div', { className: 'huginn-chat-row__name', textContent: u.name || u.login }));
          info.appendChild(el('div', { className: 'huginn-chat-row__preview', textContent: u.role || '' }));
          row.appendChild(info);
          results.appendChild(row);
        });
        if (!users.length || (users.length === 1 && users[0].id === myId)) {
          results.appendChild(el('div', { style: { padding: '16px', textAlign: 'center', color: 'var(--hg-hint)', fontSize: '14px' }, textContent: 'Никого не найдено' }));
        }
      }).catch(function() {});
    }, 300);
  });

  M.BottomSheet({ title: 'Новый личный чат', content: content });
  setTimeout(function() { searchInput.focus(); }, 300);
}

/* ── Create Group Chat (2-step: name → select members) ── */
function createGroupSheet() {
  var el = Utils.el;
  var content = el('div');
  var selectedMembers = [];

  // Step 1: Name
  content.appendChild(M.Form({
    fields: [
      { id: 'name', label: 'Название группы', type: 'text', required: true, placeholder: 'Рабочий чат...' },
    ],
    submitLabel: 'Далее →',
    onSubmit: function(data) {
      if (!data.name || !data.name.trim()) return;
      showMemberSelection(data.name.trim());
    },
  }));
  M.BottomSheet({ title: 'Новая группа', content: content });

  function showMemberSelection(groupName) {
    var content2 = el('div');
    var searchInput = el('input', {
      style: { width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid var(--hg-sep, rgba(255,255,255,0.06))', background: 'var(--hg-input-field, rgba(35,46,60,0.5))', color: 'var(--hg-text, #f5f5f5)', fontSize: '15px', outline: 'none', boxSizing: 'border-box', marginBottom: '8px' },
      placeholder: 'Поиск участников...',
    });
    content2.appendChild(searchInput);

    var selectedChips = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px', minHeight: '0' } });
    content2.appendChild(selectedChips);

    var results = el('div', { style: { maxHeight: '250px', overflowY: 'auto' } });
    content2.appendChild(results);

    var createBtn = el('button', {
      style: { width: '100%', padding: '12px', borderRadius: '12px', background: 'var(--hg-accent, #6ab2f2)', color: '#fff', fontSize: '15px', fontWeight: 600, border: 'none', cursor: 'pointer', marginTop: '12px' },
      textContent: 'Создать группу',
      onClick: function() {
        if (!selectedMembers.length) { M.Toast({ message: 'Добавьте участников', type: 'warning' }); return; }
        API.fetch('/chat-groups', {
          method: 'POST',
          body: { name: groupName, type: 'group', members: selectedMembers.map(function(u) { return u.id; }) },
        }).then(function(resp) {
          var chatId = (resp.chat || resp).id;
          M.Toast({ message: 'Группа создана', type: 'success' });
          Router.navigate('/messenger/' + (chatId || ''));
        }).catch(function() { M.Toast({ message: 'Ошибка создания', type: 'error' }); });
      },
    });
    content2.appendChild(createBtn);

    function updateChips() {
      selectedChips.replaceChildren();
      selectedMembers.forEach(function(u) {
        var chip = el('div', {
          style: { display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '16px', background: 'var(--hg-react-bg, rgba(59,130,246,0.12))', fontSize: '13px', color: 'var(--hg-text)' },
        });
        chip.appendChild(el('span', { textContent: (u.name || u.login).split(' ')[0] }));
        chip.appendChild(el('span', {
          style: { cursor: 'pointer', marginLeft: '2px', opacity: 0.6 },
          textContent: '\u2715',
          onClick: function() { selectedMembers = selectedMembers.filter(function(m) { return m.id !== u.id; }); updateChips(); renderUserList(''); },
        }));
        selectedChips.appendChild(chip);
      });
    }

    function renderUserList(q) {
      if (!q || q.length < 2) {
        results.replaceChildren();
        results.appendChild(el('div', { style: { padding: '16px', textAlign: 'center', color: 'var(--hg-hint)', fontSize: '13px' }, textContent: 'Введите имя для поиска' }));
        return;
      }
      API.fetch('/users?search=' + encodeURIComponent(q) + '&is_active=true&limit=30').then(function(resp) {
        var users = resp.users || [];
        results.replaceChildren();
        var myId = (Store.get('user') || {}).id;
        users.forEach(function(u) {
          if (u.id === myId) return;
          var isSelected = selectedMembers.some(function(m) { return m.id === u.id; });
          var row = el('div', {
            className: 'huginn-chat-row',
            style: { opacity: isSelected ? 0.5 : 1 },
            onClick: function() {
              if (isSelected) {
                selectedMembers = selectedMembers.filter(function(m) { return m.id !== u.id; });
              } else {
                selectedMembers.push(u);
              }
              updateChips();
              renderUserList(searchInput.value.trim());
            },
          });
          row.appendChild(M.Avatar({ name: u.name || u.login, size: 36 }));
          var info = el('div', { className: 'huginn-chat-row__info' });
          info.appendChild(el('div', { className: 'huginn-chat-row__name', style: { fontSize: '14px' }, textContent: u.name || u.login }));
          info.appendChild(el('div', { className: 'huginn-chat-row__preview', textContent: u.role || '' }));
          row.appendChild(info);
          if (isSelected) {
            row.appendChild(el('span', { style: { color: 'var(--hg-accent)', fontSize: '18px' }, textContent: '\u2713' }));
          }
          results.appendChild(row);
        });
      }).catch(function() {});
    }

    var _sTimer = null;
    searchInput.addEventListener('input', function() {
      clearTimeout(_sTimer);
      _sTimer = setTimeout(function() { renderUserList(searchInput.value.trim()); }, 300);
    });

    renderUserList('');
    M.BottomSheet({ title: 'Участники: ' + groupName, content: content2 });
    setTimeout(function() { searchInput.focus(); }, 300);
  }
}

/* ═══════════════════════════════════════════
   ROUTER
   ═══════════════════════════════════════════ */
Router.register('/messenger', MessengerPage);
Router.register('/messenger/:id', { render: function(p) { return renderChat(p.id); } });
if (typeof window !== 'undefined') window.MessengerPage = MessengerPage;
