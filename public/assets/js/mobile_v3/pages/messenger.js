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
    osc.frequency.linearRampToValueAtTime(1100, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) { /* ignore audio errors */ }
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
  return Math.abs(new Date(curr.created_at) - new Date(prev.created_at)) < 120000;
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

/* ── Voice/Video player helpers ── */
function _huginnVoicePlayer(fileUrl, duration) {
  var el = Utils.el;
  var t = DS.t;
  var wrap = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: '180px', padding: '4px 0' } });
  var playing = false;
  var audio = new Audio(fileUrl + (fileUrl.indexOf('?') >= 0 ? '&' : '?') + 'token=' + API.getToken());
  var playBtn = el('div', {
    style: {
      width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
    },
    textContent: '\u25B6',
    onClick: function() {
      if (playing) { audio.pause(); playBtn.textContent = '\u25B6'; }
      else { audio.play(); playBtn.textContent = '\u23F8'; }
      playing = !playing;
    },
  });
  audio.addEventListener('ended', function() { playing = false; playBtn.textContent = '\u25B6'; progressFill.style.width = '0%'; });
  wrap.appendChild(playBtn);
  var waveWrap = el('div', { style: { flex: 1, display: 'flex', alignItems: 'center', gap: '1px', height: '28px' } });
  for (var i = 0; i < 24; i++) {
    var h = 6 + Math.floor(Math.random() * 18);
    waveWrap.appendChild(el('div', { style: { width: '3px', height: h + 'px', borderRadius: '2px', background: 'rgba(255,255,255,0.35)', transition: 'height 0.2s' } }));
  }
  wrap.appendChild(waveWrap);
  var durText = duration ? Math.floor(duration / 60) + ':' + String(duration % 60).padStart(2, '0') : '';
  wrap.appendChild(el('div', { style: { fontSize: '11px', color: 'rgba(255,255,255,0.6)', flexShrink: 0 }, textContent: durText }));
  var progressFill = el('div');
  audio.addEventListener('timeupdate', function() {
    if (audio.duration) {
      var pct = (audio.currentTime / audio.duration) * 100;
      var bars = waveWrap.children;
      var active = Math.floor(pct / 100 * bars.length);
      for (var j = 0; j < bars.length; j++) {
        bars[j].style.background = j < active ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)';
      }
    }
  });
  return wrap;
}

function _huginnVideoCircle(fileUrl, duration) {
  var el = Utils.el;
  var t = DS.t;
  var wrap = el('div', { style: { position: 'relative', width: '180px', height: '180px', borderRadius: '50%', overflow: 'hidden', cursor: 'pointer', border: '2px solid var(--hero-grad, #c62828)', flexShrink: 0 } });
  var video = document.createElement('video');
  video.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = fileUrl + (fileUrl.indexOf('?') >= 0 ? '&' : '?') + 'token=' + API.getToken();
  wrap.appendChild(video);
  var overlay = el('div', { style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)', borderRadius: '50%' } });
  overlay.innerHTML = '<svg width="36" height="36" viewBox="0 0 24 24" fill="rgba(255,255,255,0.9)"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  wrap.appendChild(overlay);
  if (duration) {
    var badge = el('div', { style: { position: 'absolute', bottom: '8px', right: '8px', background: 'rgba(0,0,0,0.6)', borderRadius: '10px', padding: '2px 6px', fontSize: '11px', color: '#fff' }, textContent: Math.floor(duration / 60) + ':' + String(duration % 60).padStart(2, '0') });
    wrap.appendChild(badge);
  }
  var playing = false;
  wrap.addEventListener('click', function() {
    if (playing) { video.pause(); overlay.style.display = 'flex'; }
    else { video.play(); overlay.style.display = 'none'; }
    playing = !playing;
  });
  video.addEventListener('ended', function() { playing = false; overlay.style.display = 'flex'; });
  return wrap;
}

/* ═══════════════════════════════════════════
   CHAT LIST
   ═══════════════════════════════════════════ */
const MessengerPage = {
  async render(params) {
    const el = Utils.el;
    const t = DS.t;
    if (params && params.id) return renderChat(params.id);

    const page = el('div', { className: 'asgard-huginn-list page-container' });

    page.appendChild(M.Header({
      title: 'Хугинн',
      subtitle: 'МЕССЕНДЖЕР',
      back: false,
      actions: [{
        icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
        onClick: () => createChatSheet(),
      }],
    }));

    page.appendChild(M.SearchBar({
      placeholder: 'Поиск чатов...',
      sticky: true,
      onSearch: (q) => renderList(q),
    }));

    // ── Stories strip ──
    var storiesWrap = el('div', {
      style: {
        display: 'flex', gap: '12px', padding: '12px var(--sp-page,16px)',
        overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch', flexShrink: 0,
      },
      className: 'asgard-no-scrollbar',
    });
    page.appendChild(storiesWrap);

    function loadStories() {
      var currentUser = Store.get('user') || {};
      // "Вы" — первый элемент
      var myStory = el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'pointer', flexShrink: 0, scrollSnapAlign: 'start' } });
      var myAvaWrap = el('div', { style: { position: 'relative' } });
      myAvaWrap.appendChild(M.Avatar({ name: currentUser.name || 'Вы', size: 56, src: currentUser.avatar_url || null }));
      var addBadge = el('div', { style: { position: 'absolute', bottom: '-2px', right: '-2px', width: '20px', height: '20px', borderRadius: '50%', background: 'var(--hero-grad)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', color: '#fff', border: '2px solid ' + t.bg, fontWeight: 700 }, textContent: '+' });
      myAvaWrap.appendChild(addBadge);
      myStory.appendChild(myAvaWrap);
      myStory.appendChild(el('div', { style: { ...DS.font('xs'), color: t.textSec, textAlign: 'center' }, textContent: 'Вы' }));
      myStory.addEventListener('click', function() { createStorySheet(); });
      storiesWrap.appendChild(myStory);

      API.fetch('/stories').then(function(resp) {
        var stories = resp.stories || [];
        // Group by user
        var byUser = {};
        stories.forEach(function(s) {
          if (!byUser[s.user_id]) byUser[s.user_id] = { name: s.user_name, avatar: s.avatar_url, items: [] };
          byUser[s.user_id].items.push(s);
        });
        Object.keys(byUser).forEach(function(uid) {
          var u = byUser[uid];
          var storyEl = el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'pointer', flexShrink: 0, scrollSnapAlign: 'start' } });
          var avaOuter = el('div', { style: { padding: '2px', borderRadius: '50%', background: 'linear-gradient(135deg, #ffd60a, #c62828)' } });
          avaOuter.appendChild(M.Avatar({ name: u.name || '?', size: 52, src: u.avatar || null }));
          storyEl.appendChild(avaOuter);
          var nameShort = (u.name || '').split(' ')[0] || '?';
          storyEl.appendChild(el('div', { style: { ...DS.font('xs'), color: t.textSec, textAlign: 'center', maxWidth: '64px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, textContent: nameShort }));
          storyEl.addEventListener('click', function() { viewStory(u, 0); });
          storiesWrap.appendChild(storyEl);
        });
      }).catch(function() {}); // Тихий fail — stories не критичны
    }

    function createStorySheet() {
      var content = Utils.el('div');
      var imgUrl = null;
      content.appendChild(M.Form({
        fields: [
          { id: 'content', label: 'Текст статуса', type: 'textarea', placeholder: 'Что нового?', required: true },
        ],
        submitLabel: 'Опубликовать',
        onSubmit: function(data) {
          API.fetch('/stories', { method: 'POST', body: { content: data.content, image_url: imgUrl } }).then(function() {
            M.Toast({ message: 'Сторис опубликована', type: 'success' });
            loadStories();
          }).catch(function() { M.Toast({ message: 'Ошибка', type: 'error' }); });
        },
      }));
      var photoBtn = el('div', { style: { padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: t.accent || '#ff4444' } });
      photoBtn.appendChild(el('span', { textContent: '📷' }));
      photoBtn.appendChild(el('span', { style: { ...DS.font('sm') }, textContent: 'Добавить фото' }));
      photoBtn.addEventListener('click', function() {
        var inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = function() {
          if (!inp.files[0]) return;
          var fd = new FormData(); fd.append('file', inp.files[0]);
          fetch('/api/files/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + API.getToken() }, body: fd })
            .then(function(r) { return r.json(); }).then(function(d) {
              if (d.download_url) { imgUrl = d.download_url; photoBtn.querySelector('span:last-child').textContent = 'Фото добавлено ✓'; }
            }).catch(function() { M.Toast({ message: 'Ошибка загрузки фото', type: 'error' }); });
        };
        inp.click();
      });
      content.appendChild(photoBtn);
      M.BottomSheet({ title: 'Новая сторис', content: content });
    }

    function viewStory(userData, startIdx) {
      var overlay = el('div', { style: {
        position: 'fixed', top: 0, left: 0, width: '100vw', height: 'calc(var(--vh, 1vh) * 100)',
        background: '#000', zIndex: 1000, display: 'flex', flexDirection: 'column',
      } });
      var idx = startIdx || 0;
      var items = userData.items || [];

      function showItem(i) {
        overlay.replaceChildren();
        if (i >= items.length) { overlay.remove(); return; }
        var story = items[i];

        // Progress bar
        var progressWrap = el('div', { style: { display: 'flex', gap: '3px', padding: '8px 16px' } });
        items.forEach(function(_, pi) {
          progressWrap.appendChild(el('div', { style: { flex: 1, height: '2px', borderRadius: '1px', background: pi <= i ? '#fff' : 'rgba(255,255,255,0.3)' } }));
        });
        overlay.appendChild(progressWrap);

        // Header
        var hdr = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 16px' } });
        hdr.appendChild(M.Avatar({ name: userData.name || '?', size: 32, src: userData.avatar || null }));
        hdr.appendChild(el('div', { style: { color: '#fff', fontWeight: 600, fontSize: '14px' }, textContent: userData.name || '?' }));
        var ago = story.created_at ? Utils.relativeTime(story.created_at) : '';
        hdr.appendChild(el('div', { style: { color: 'rgba(255,255,255,0.5)', fontSize: '12px', marginLeft: '8px' }, textContent: ago }));
        var closeBtn = el('div', { style: { marginLeft: 'auto', color: '#fff', fontSize: '24px', cursor: 'pointer', padding: '4px' }, textContent: '✕' });
        closeBtn.addEventListener('click', function() { clearTimeout(autoTimer); overlay.remove(); });
        hdr.appendChild(closeBtn);
        overlay.appendChild(hdr);

        // Content
        var contentArea = el('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' } });
        if (story.image_url) {
          var img = el('img', { style: { maxWidth: '100%', maxHeight: '70vh', borderRadius: '12px', objectFit: 'contain' } });
          img.src = story.image_url + (story.image_url.indexOf('?') >= 0 ? '&' : '?') + 'token=' + API.getToken();
          contentArea.appendChild(img);
        }
        if (story.content) {
          contentArea.appendChild(el('div', { style: { color: '#fff', fontSize: '18px', textAlign: 'center', lineHeight: '1.6', maxWidth: '300px', wordBreak: 'break-word' }, textContent: story.content }));
        }
        overlay.appendChild(contentArea);

        // Tap zones
        overlay.addEventListener('click', function(e) {
          var x = e.clientX;
          clearTimeout(autoTimer);
          if (x < window.innerWidth * 0.3) { showItem(Math.max(0, i - 1)); }
          else { showItem(i + 1); }
        });

        // Auto-advance 5 sec
        var autoTimer = setTimeout(function() { showItem(i + 1); }, 5000);
      }

      showItem(0);
      document.body.appendChild(overlay);
    }

    loadStories();

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

    function renderList(query) {
      listWrap.replaceChildren();
      var q = (query || '').toLowerCase();
      var filtered = chats.filter(function(c) {
        var name = (c.name || c.direct_user_name || '').toLowerCase();
        return !q || name.includes(q);
      });

      if (!filtered.length) {
        listWrap.appendChild(M.Empty({ text: q ? 'Ничего не найдено' : 'Нет чатов' }));
        return;
      }

      var list = el('div', { style: { display: 'flex', flexDirection: 'column' } });
      filtered.forEach(function(chat, i) {
        var unread = chat.unread_count || 0;
        var name = chat.is_group === false ? (chat.direct_user_name || chat.name || 'Чат') : (chat.name || 'Чат');

        // Online status for direct chats
        var isOnline = false;
        if (chat.is_group === false && chat.direct_user_last_login) {
          isOnline = (Date.now() - new Date(chat.direct_user_last_login).getTime()) < 300000;
        }

        var row = el('div', {
          style: {
            display: 'flex', gap: '12px', alignItems: 'center',
            padding: '12px var(--sp-page,16px)', cursor: 'pointer',
            transition: 'background 0.15s ease',
            ...DS.anim(i * 0.02),
          },
          onClick: function() { Router.navigate('/messenger/' + chat.id); },
        });
        row.addEventListener('touchstart', function() { row.style.background = t.surfaceAlt || 'rgba(255,255,255,0.05)'; }, { passive: true });
        row.addEventListener('touchend', function() { row.style.background = ''; }, { passive: true });

        var avatarOpts = { name: name, size: 52 };
        if (isOnline) avatarOpts.status = 'online';
        row.appendChild(M.Avatar(avatarOpts));

        var info = el('div', { style: { flex: 1, minWidth: 0 } });

        var topRow = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' } });
        topRow.appendChild(el('div', {
          style: { ...DS.font('md'), color: t.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
          textContent: name,
        }));
        var timeText = chat.last_message_at ? Utils.relativeTime(chat.last_message_at) : '';
        topRow.appendChild(el('span', {
          style: { ...DS.font('xs'), color: unread > 0 ? (t.accent || '#ff4444') : (t.textTer || '#666'), flexShrink: 0, marginLeft: '8px' },
          textContent: timeText,
        }));
        info.appendChild(topRow);

        var bottomRow = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } });
        var preview = chat.is_group ? (chat.member_count || 0) + ' участн.' : '';
        bottomRow.appendChild(el('div', {
          style: { ...DS.font('sm'), color: t.textSec || '#999', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 },
          textContent: preview,
        }));
        if (unread > 0) {
          bottomRow.appendChild(el('span', {
            style: {
              minWidth: '22px', height: '22px', borderRadius: '11px',
              background: t.accent || '#ff4444', color: '#fff', fontSize: '11px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', flexShrink: 0, marginLeft: '8px',
            },
            textContent: unread > 99 ? '99+' : String(unread),
          }));
        }
        info.appendChild(bottomRow);
        row.appendChild(info);
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
    className: 'asgard-huginn-chat asgard-slide-right',
    style: { display: 'flex', flexDirection: 'column', height: 'calc(var(--vh, 1vh) * 100)', background: t.bg, position: 'relative' },
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
  var _sseConnected = false;
  var _es = null;

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
  var headerSubtitle = '';
  if (directMember) {
    headerSubtitle = _huginnOnlineLabel(directMember.last_login_at) || '';
  } else if (mc > 0) {
    headerSubtitle = mc + Utils.plural(mc, ' участник', ' участника', ' участников');
  }

  page.appendChild(M.Header({
    title: chatInfo.name || 'Чат',
    subtitle: headerSubtitle,
    back: true,
    backHref: '/messenger',
    actions: [
      directMember ? {
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>',
        onClick: function() { _huginnInitiateCall(directMember.user_id, directMember.user_name || chatInfo.name); },
      } : null,
      {
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
        onClick: function() { chatActionsSheet(chatId); },
      }
    ].filter(Boolean),
  }));

  // Typing indicator bar
  var typingBar = el('div', {
    style: {
      height: '0', overflow: 'hidden', padding: '0 var(--sp-page,16px)',
      transition: 'height 0.2s ease, padding 0.2s ease',
      ...DS.font('xs'), color: t.accent || '#ff4444',
    },
  });
  page.appendChild(typingBar);

  // Messages area
  var messagesWrap = el('div', {
    style: {
      flex: 1, overflowY: 'auto', padding: '8px var(--sp-page,16px) 8px',
      display: 'flex', flexDirection: 'column',
      WebkitOverflowScrolling: 'touch',
    },
  });
  page.appendChild(messagesWrap);

  // Scroll-to-bottom FAB
  var scrollFab = el('div', {
    style: {
      position: 'absolute', right: '16px', bottom: '80px',
      width: '40px', height: '40px', borderRadius: '20px',
      background: t.surface || '#222', border: '1px solid ' + (t.border || '#333'),
      display: 'none', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', zIndex: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    },
    innerHTML: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="' + (t.text || '#fff') + '" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>',
    onClick: function() { messagesWrap.scrollTo({ top: messagesWrap.scrollHeight, behavior: 'smooth' }); },
  });
  page.appendChild(scrollFab);

  messagesWrap.addEventListener('scroll', function() {
    var gap = messagesWrap.scrollHeight - messagesWrap.scrollTop - messagesWrap.clientHeight;
    scrollFab.style.display = gap > 150 ? 'flex' : 'none';
    if (messagesWrap.scrollTop < 60 && hasOlder && !loadingOlder) loadOlderMessages();
  }, { passive: true });

  // Reply/Edit bar
  var replyBar = el('div', {
    style: {
      display: 'none', padding: '8px 16px', background: t.surface || '#1a1a1a',
      borderTop: '1px solid ' + (t.border || '#333'), alignItems: 'center', gap: '8px',
    },
  });
  var replyContent = el('div', { style: { flex: 1, minWidth: 0, borderLeft: '2px solid ' + (t.accent || '#ff4444'), paddingLeft: '8px' } });
  var replyName = el('div', { style: { ...DS.font('xs'), color: t.accent || '#ff4444', fontWeight: 600, marginBottom: '2px' } });
  var replyTextEl = el('div', { style: { ...DS.font('sm'), color: t.textSec || '#999', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } });
  replyContent.appendChild(replyName);
  replyContent.appendChild(replyTextEl);
  replyBar.appendChild(replyContent);
  replyBar.appendChild(el('div', {
    style: { width: '28px', height: '28px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
    innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + (t.textSec || '#999') + '" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    onClick: function() { setReply(null); cancelEdit(); },
  }));

  // Emoji panel
  var emojiPanel = el('div', {
    style: {
      display: 'none', height: '250px', background: t.surface || '#1a1a1a',
      borderTop: '1px solid ' + (t.border || '#333'), flexDirection: 'column', overflow: 'hidden',
    },
  });
  var emojiTabs = el('div', { style: { display: 'flex', borderBottom: '1px solid ' + (t.border || '#333') } });
  var emojiGrid = el('div', { style: { flex: 1, overflowY: 'auto', padding: '8px', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', alignContent: 'start' } });
  var tabNames = Object.keys(HUGINN_EMOJI);
  var activeTab = 0;

  function renderEmojiTab(idx) {
    activeTab = idx;
    emojiGrid.replaceChildren();
    HUGINN_EMOJI[tabNames[idx]].forEach(function(em) {
      emojiGrid.appendChild(el('div', {
        style: { fontSize: '24px', textAlign: 'center', padding: '6px', cursor: 'pointer', borderRadius: '8px' },
        textContent: em,
        onClick: function() { textarea.value += em; textarea.focus(); autoResize(); },
      }));
    });
    Array.from(emojiTabs.children).forEach(function(tab, i) {
      tab.style.borderBottom = i === idx ? '2px solid ' + (t.accent || '#ff4444') : '2px solid transparent';
      tab.style.color = i === idx ? (t.accent || '#ff4444') : (t.textSec || '#999');
    });
  }

  tabNames.forEach(function(name, i) {
    emojiTabs.appendChild(el('div', {
      style: { flex: 1, textAlign: 'center', padding: '8px 4px', cursor: 'pointer', ...DS.font('xs'), fontWeight: 600 },
      textContent: name,
      onClick: function() { renderEmojiTab(i); },
    }));
  });
  emojiPanel.appendChild(emojiTabs);
  emojiPanel.appendChild(emojiGrid);

  // Composer
  var composerWrap = el('div', {
    className: 'asgard-huginn-composer',
    style: {
      display: 'flex', alignItems: 'flex-end', gap: '8px',
      padding: '8px var(--sp-page,16px)',
      paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))',
      background: t.bg, borderTop: '1px solid ' + (t.border || '#333'),
    },
  });

  var emojiBtn = el('div', {
    className: 'asgard-huginn-btn',
    style: { width: '40px', height: '40px', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
    innerHTML: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="' + (t.textSec || '#999') + '" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    onClick: function() { toggleEmoji(); },
  });
  composerWrap.appendChild(emojiBtn);

  var textarea = el('textarea', {
    className: 'asgard-huginn-textarea',
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

  composerWrap.appendChild(el('div', {
    className: 'asgard-huginn-btn',
    style: { width: '40px', height: '40px', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
    innerHTML: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="' + (t.textSec || '#999') + '" stroke-width="1.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>',
    onClick: function() { attachFile(); },
  }));

  var sendBtn = el('div', {
    className: 'asgard-huginn-send-btn',
    style: {
      width: '40px', height: '40px', borderRadius: '20px',
      background: t.accent || '#ff4444', display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', flexShrink: 0,
    },
    innerHTML: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    onClick: function() { sendMessage(); },
  });

  // Mic button (voice recording)
  var micBtn = null;
  var videoRecBtn = null;
  var _recorder = null;
  var _recChunks = [];
  var _recStream = null;
  var _recStartTime = 0;
  var _recTimerInterval = null;
  var _recOverlay = null;

  if (_huginnHasMedia) {
    micBtn = el('div', {
      className: 'asgard-huginn-btn',
      style: { width: '40px', height: '40px', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
      innerHTML: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="' + (t.textSec || '#999') + '" stroke-width="1.5"><rect x="9" y="1" width="6" height="11" rx="3"/><path d="M19 10v1a7 7 0 01-14 0v-1"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
      onClick: function() { startVoiceRecording(); },
    });
  }

  if (_huginnHasVideo) {
    videoRecBtn = el('div', {
      className: 'asgard-huginn-btn',
      style: { width: '40px', height: '40px', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
      innerHTML: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="' + (t.textSec || '#999') + '" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
      onClick: function() { startVideoRecording(); },
    });
  }

  function updateComposerButtons() {
    var hasText = textarea.value.trim().length > 0;
    sendBtn.style.display = hasText ? 'flex' : 'none';
    if (micBtn) micBtn.style.display = hasText ? 'none' : 'flex';
    if (videoRecBtn) videoRecBtn.style.display = hasText ? 'none' : 'flex';
  }

  textarea.addEventListener('input', function() { autoResize(); sendTypingSignal(); updateComposerButtons(); });

  if (micBtn) composerWrap.appendChild(micBtn);
  if (videoRecBtn) composerWrap.appendChild(videoRecBtn);
  composerWrap.appendChild(sendBtn);
  updateComposerButtons();

  function startVoiceRecording() {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
      _recStream = stream;
      _recChunks = [];
      var mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      _recorder = new MediaRecorder(stream, { mimeType: mimeType });
      _recorder.ondataavailable = function(e) { if (e.data.size > 0) _recChunks.push(e.data); };
      _recorder.onstop = function() { finishVoiceRecording(); };
      _recorder.start();
      _recStartTime = Date.now();
      showRecordingOverlay('voice');
    }).catch(function() { M.Toast({ message: 'Нет доступа к микрофону', type: 'error' }); });
  }

  function startVideoRecording() {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 480, height: 480 }, audio: true }).then(function(stream) {
      _recStream = stream;
      _recChunks = [];
      var mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm';
      _recorder = new MediaRecorder(stream, { mimeType: mimeType });
      _recorder.ondataavailable = function(e) { if (e.data.size > 0) _recChunks.push(e.data); };
      _recorder.onstop = function() { finishVideoRecording(); };
      _recorder.start();
      _recStartTime = Date.now();
      showRecordingOverlay('video', stream);
    }).catch(function() { M.Toast({ message: 'Нет доступа к камере', type: 'error' }); });
  }

  function showRecordingOverlay(type, stream) {
    _recOverlay = el('div', { style: {
      position: 'fixed', top: 0, left: 0, width: '100vw', height: 'calc(var(--vh, 1vh) * 100)',
      background: 'rgba(0,0,0,0.85)', zIndex: 1000,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px',
    } });
    if (type === 'video' && stream) {
      var preview = document.createElement('video');
      preview.srcObject = stream;
      preview.muted = true;
      preview.playsInline = true;
      preview.autoplay = true;
      preview.style.cssText = 'width:200px;height:200px;object-fit:cover;border-radius:50%;border:3px solid #c62828;';
      _recOverlay.appendChild(preview);
    } else {
      var micIcon = el('div', { style: { width: '80px', height: '80px', borderRadius: '50%', background: '#c62828', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', animation: 'asgard-pulse 1.5s infinite' }, textContent: '🎤' });
      _recOverlay.appendChild(micIcon);
    }
    var timerEl = el('div', { style: { color: '#fff', fontSize: '24px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }, textContent: '0:00' });
    _recOverlay.appendChild(timerEl);
    _recTimerInterval = setInterval(function() {
      var sec = Math.floor((Date.now() - _recStartTime) / 1000);
      timerEl.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
      if (sec >= 60 && type === 'video') stopRecording();
      if (sec >= 300) stopRecording();
    }, 500);
    var stopBtn = el('div', { style: {
      width: '64px', height: '64px', borderRadius: '50%', background: '#c62828',
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      border: '4px solid rgba(255,255,255,0.3)',
    } });
    stopBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
    stopBtn.addEventListener('click', function() { stopRecording(); });
    _recOverlay.appendChild(stopBtn);
    var cancelBtn = el('div', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '14px', cursor: 'pointer', marginTop: '8px' }, textContent: 'Отмена' });
    cancelBtn.addEventListener('click', function() { cancelRecording(); });
    _recOverlay.appendChild(cancelBtn);
    document.body.appendChild(_recOverlay);
  }

  function stopRecording() {
    if (_recorder && _recorder.state !== 'inactive') _recorder.stop();
    clearInterval(_recTimerInterval);
  }

  function cancelRecording() {
    if (_recorder && _recorder.state !== 'inactive') { _recorder.ondataavailable = null; _recorder.onstop = null; _recorder.stop(); }
    clearInterval(_recTimerInterval);
    if (_recStream) { _recStream.getTracks().forEach(function(tr) { tr.stop(); }); _recStream = null; }
    if (_recOverlay) { _recOverlay.remove(); _recOverlay = null; }
  }

  function finishVoiceRecording() {
    if (_recOverlay) { _recOverlay.remove(); _recOverlay = null; }
    if (_recStream) { _recStream.getTracks().forEach(function(tr) { tr.stop(); }); _recStream = null; }
    if (!_recChunks.length) return;
    var blob = new Blob(_recChunks, { type: 'audio/webm' });
    var duration = Math.round((Date.now() - _recStartTime) / 1000);
    uploadAndSendMedia(blob, 'voice', duration, 'voice.webm');
  }

  function finishVideoRecording() {
    if (_recOverlay) { _recOverlay.remove(); _recOverlay = null; }
    if (_recStream) { _recStream.getTracks().forEach(function(tr) { tr.stop(); }); _recStream = null; }
    if (!_recChunks.length) return;
    var blob = new Blob(_recChunks, { type: 'video/webm' });
    var duration = Math.round((Date.now() - _recStartTime) / 1000);
    uploadAndSendMedia(blob, 'video', duration, 'video.webm');
  }

  function uploadAndSendMedia(blob, type, duration, filename) {
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
      return API.fetch('/chat-groups/' + chatId + '/messages', {
        method: 'POST',
        body: { text: type === 'voice' ? '🎤 Голосовое сообщение' : '🎬 Видеосообщение', message_type: type, file_url: fileUrl, file_duration: duration },
      });
    }).then(function(resp) {
      var msg = resp.message || resp;
      if (msg && msg.id) {
        msg.user_name = msg.user_name || (Store.get('user') || {}).name || '';
        msg.user_id = msg.user_id || userId;
        if (emptyStateEl && emptyStateEl.parentNode) { emptyStateEl.remove(); emptyStateEl = null; }
        messages.push(msg);
        if (msg.id > lastMsgId) lastMsgId = msg.id;
        appendMessage(msg, messages.length > 1 ? messages[messages.length - 2] : null);
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
      replyBar.style.display = 'flex';
      replyName.textContent = msg.user_name || 'Сообщение';
      replyTextEl.textContent = msg.message || '';
      textarea.focus();
    } else {
      if (!editingMsg) replyBar.style.display = 'none';
    }
  }

  function startEdit(msg) {
    editingMsg = msg;
    replyTo = null;
    replyBar.style.display = 'flex';
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
      replyBar.style.display = 'none';
    }
  }

  function toggleEmoji() {
    emojiOpen = !emojiOpen;
    emojiPanel.style.display = emojiOpen ? 'flex' : 'none';
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

    // Edit mode
    if (editingMsg) {
      var editId = editingMsg.id;
      textarea.value = '';
      autoResize();
      cancelEdit();
      replyBar.style.display = 'none';
      try {
        await API.fetch('/chat-groups/' + chatId + '/messages/' + editId, { method: 'PUT', body: { text: text } });
        var found = messages.find(function(m) { return m.id === editId; });
        if (found) { found.message = text; found.edited_at = new Date().toISOString(); rerenderMessages(); }
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

    try {
      var resp = await API.fetch('/chat-groups/' + chatId + '/messages', { method: 'POST', body: body });
      var msg = resp.message || resp;
      if (msg && msg.id) {
        msg.user_name = msg.user_name || (Store.get('user') || {}).name || '';
        msg.user_id = msg.user_id || userId;
        if (savedReply) {
          msg.reply_to = savedReply.id;
          msg.reply_text = savedReply.message;
          msg.reply_user_name = savedReply.user_name;
        }
        if (emptyStateEl && emptyStateEl.parentNode) { emptyStateEl.remove(); emptyStateEl = null; }
        messages.push(msg);
        if (msg.id > lastMsgId) lastMsgId = msg.id;
        appendMessage(msg, messages.length > 1 ? messages[messages.length - 2] : null);
        messagesWrap.scrollTo({ top: messagesWrap.scrollHeight, behavior: 'smooth' });
      }
    } catch (_) {
      M.Toast({ message: 'Ошибка отправки', type: 'error' });
    }
  }

  function attachFile() {
    var input = el('input', { type: 'file', accept: '*/*' });
    input.onchange = async function() {
      if (!input.files[0]) return;
      var fd = new FormData();
      fd.append('file', input.files[0]);
      try {
        var resp = await fetch('/api/chat-groups/' + chatId + '/upload-file', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + API.getToken() },
          body: fd,
        });
        if (resp.ok) { M.Toast({ message: 'Файл отправлен', type: 'success' }); if (!_sseConnected) pollNewMessages(); }
        else M.Toast({ message: 'Ошибка загрузки', type: 'error' });
      } catch (_) { M.Toast({ message: 'Ошибка загрузки', type: 'error' }); }
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
      if (found) { found.deleted_at = new Date().toISOString(); rerenderMessages(); }
    } catch (_) { M.Toast({ message: 'Ошибка удаления', type: 'error' }); }
  }

  // ── Message rendering ──
  function createBubble(msg, prev) {
    var mine = msg.user_id === userId;
    var grouped = _huginnIsGrouped(prev, msg);
    var isDeleted = !!msg.deleted_at;

    var wrap = el('div', {
      style: {
        display: 'flex', flexDirection: mine ? 'row-reverse' : 'row',
        alignItems: 'flex-end', gap: '8px',
        marginTop: grouped ? '1px' : '8px',
        animation: 'asgard-msg-in 0.2s ease-out',
      },
    });
    wrap.dataset.msgId = msg.id;

    if (!mine && !grouped) {
      wrap.appendChild(M.Avatar({ name: msg.user_name || '?', size: 28 }));
    } else if (!mine && grouped) {
      wrap.appendChild(el('div', { style: { width: '28px', flexShrink: 0 } }));
    }

    var bubble = el('div', {
      style: {
        maxWidth: '75%', padding: '8px 12px',
        background: isDeleted ? 'transparent' : (mine ? (t.accent || '#ff4444') : (t.surface || '#1e1e1e')),
        borderRadius: mine
          ? (grouped ? '18px 4px 18px 18px' : '18px 18px 4px 18px')
          : (grouped ? '4px 18px 18px 18px' : '18px 18px 18px 4px'),
        position: 'relative', wordBreak: 'break-word',
        border: isDeleted ? '1px dashed ' + (t.border || '#333') : 'none',
      },
    });

    // Deleted message
    if (isDeleted) {
      bubble.appendChild(el('div', {
        className: 'huginn-deleted-msg',
        style: { ...DS.font('sm'), color: t.textTer || '#666', fontStyle: 'italic', opacity: 0.6 },
        textContent: 'Сообщение удалено',
      }));
      wrap.appendChild(bubble);
      return wrap;
    }

    if (!mine && !grouped && chatInfo.is_group) {
      bubble.appendChild(el('div', {
        style: { ...DS.font('xs'), color: t.accent || '#ff4444', fontWeight: 600, marginBottom: '2px' },
        textContent: msg.user_name || '',
      }));
    }

    if (msg.reply_to && msg.reply_text) {
      var rp = el('div', { style: { borderLeft: '2px solid ' + (mine ? 'rgba(255,255,255,0.5)' : (t.accent || '#ff4444')), paddingLeft: '8px', marginBottom: '4px', opacity: 0.8 } });
      rp.appendChild(el('div', { style: { ...DS.font('xs'), fontWeight: 600, color: mine ? 'rgba(255,255,255,0.9)' : (t.accent || '#ff4444') }, textContent: msg.reply_user_name || '' }));
      rp.appendChild(el('div', { style: { ...DS.font('xs'), color: mine ? 'rgba(255,255,255,0.7)' : (t.textSec || '#999'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }, textContent: msg.reply_text }));
      bubble.appendChild(rp);
    }

    // Voice message
    if (msg.message_type === 'voice' && msg.file_url) {
      bubble.appendChild(_huginnVoicePlayer(msg.file_url, msg.file_duration));
    }
    // Video circle
    else if (msg.message_type === 'video' && msg.file_url) {
      bubble.style.padding = '4px';
      bubble.style.background = 'transparent';
      bubble.style.border = 'none';
      bubble.appendChild(_huginnVideoCircle(msg.file_url, msg.file_duration));
    }
    // Regular text
    else if (msg.message) {
      bubble.appendChild(el('div', {
        style: { ...DS.font('sm'), color: mine ? '#fff' : (t.text || '#fff'), lineHeight: '1.4' },
        textContent: msg.message,
      }));
    }

    // Attachments with inline image/video preview
    if (msg.attachments && msg.attachments.length) {
      msg.attachments.forEach(function(att) {
        var fname = (att.file_path || att.file_name || '').split('/').pop();
        var mime = (att.mime_type || '').toLowerCase();
        var fileUrl = '/api/chat-groups/' + chatId + '/files/' + encodeURIComponent(fname);

        if (mime.indexOf('image/') === 0) {
          // Inline image preview
          var imgWrap = el('div', {
            style: { marginTop: '6px', cursor: 'pointer', borderRadius: '12px', overflow: 'hidden', maxWidth: '240px', maxHeight: '300px', background: 'rgba(0,0,0,0.1)' },
            onClick: function() { showImagePreview(fileUrl, att.file_name); },
          });
          var img = el('img', {
            style: { width: '100%', height: 'auto', display: 'block', borderRadius: '12px', maxHeight: '300px', objectFit: 'cover' },
          });
          img.loading = 'lazy';
          img.src = fileUrl + '?token=' + API.getToken();
          img.alt = att.file_name || 'Изображение';
          img.onerror = function() { imgWrap.style.display = 'none'; };
          imgWrap.appendChild(img);
          bubble.appendChild(imgWrap);
        } else if (mime.indexOf('video/') === 0) {
          // Video placeholder
          var vidWrap = el('div', {
            style: {
              marginTop: '6px', cursor: 'pointer', borderRadius: '12px', overflow: 'hidden',
              maxWidth: '240px', height: '140px', background: 'rgba(0,0,0,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            },
            onClick: function() { showVideoPreview(fileUrl, att.file_name); },
          });
          vidWrap.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="rgba(255,255,255,0.8)"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
          bubble.appendChild(vidWrap);
          bubble.appendChild(el('div', {
            style: { ...DS.font('xs'), color: mine ? 'rgba(255,255,255,0.7)' : (t.textSec || '#999'), marginTop: '2px' },
            textContent: att.file_name || 'Видео',
          }));
        } else {
          // Default download link
          var attEl = el('div', {
            style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', cursor: 'pointer', opacity: 0.85 },
            onClick: function() { window.open(fileUrl); },
          });
          attEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>';
          attEl.appendChild(el('span', { style: { ...DS.font('xs'), textDecoration: 'underline' }, textContent: att.file_name || 'Файл' }));
          bubble.appendChild(attEl);
        }
      });
    }

    var meta = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: mine ? 'flex-end' : 'flex-start', gap: '4px', marginTop: '2px' } });
    meta.appendChild(el('span', {
      style: { ...DS.font('xs'), fontSize: '10px', color: mine ? 'rgba(255,255,255,0.6)' : (t.textTer || '#666') },
      textContent: _huginnTime(msg.created_at) + (msg.edited_at ? ' (ред.)' : ''),
    }));
    if (mine) {
      var checkColor = msg.is_read ? '#4fc3f7' : 'rgba(255,255,255,0.5)';
      var checkSvg = msg.is_read
        ? '<svg width="16" height="10" viewBox="0 0 16 10" fill="none"><path d="M1 5l3 3 5-7" stroke="' + checkColor + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 5l3 3 5-7" stroke="' + checkColor + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg width="12" height="10" viewBox="0 0 12 10" fill="none"><path d="M1 5l3 3 7-7" stroke="' + checkColor + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      var checkEl = el('span');
      checkEl.innerHTML = checkSvg;
      meta.appendChild(checkEl);
    }
    bubble.appendChild(meta);

    if (msg.reactions && Object.keys(msg.reactions).length) {
      var reactRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' } });
      for (var emoji in msg.reactions) {
        var users = msg.reactions[emoji];
        var isMine = Array.isArray(users) && users.includes(userId);
        (function(em, us, im) {
          var rb = el('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: '3px',
              padding: '2px 6px', borderRadius: '10px', cursor: 'pointer',
              background: im ? 'rgba(255,68,68,0.2)' : 'rgba(255,255,255,0.08)',
              border: im ? '1px solid rgba(255,68,68,0.4)' : '1px solid transparent', fontSize: '14px',
            },
            onClick: function(e) { e.stopPropagation(); toggleReaction(msg.id, em); },
          });
          rb.appendChild(el('span', { textContent: em }));
          if (us.length > 1) rb.appendChild(el('span', { style: { fontSize: '11px', color: t.textSec || '#999' }, textContent: String(us.length) }));
          reactRow.appendChild(rb);
        })(emoji, users, isMine);
      }
      bubble.appendChild(reactRow);
    }

    wrap.appendChild(bubble);

    // Swipe-to-reply
    var touchStartX = 0, touchDeltaX = 0;
    wrap.addEventListener('touchstart', function(e) { touchStartX = e.touches[0].clientX; touchDeltaX = 0; }, { passive: true });
    wrap.addEventListener('touchmove', function(e) {
      touchDeltaX = e.touches[0].clientX - touchStartX;
      if (touchDeltaX > 0 && touchDeltaX < 80) { wrap.style.transform = 'translateX(' + touchDeltaX + 'px)'; wrap.style.transition = 'none'; }
    }, { passive: true });
    wrap.addEventListener('touchend', function() {
      wrap.style.transition = 'transform 0.2s ease'; wrap.style.transform = '';
      if (touchDeltaX > 50) { if (navigator.vibrate) navigator.vibrate(5); setReply({ id: msg.id, message: msg.message, user_name: msg.user_name }); }
    }, { passive: true });

    // Long press → ActionSheet (edit/delete/copy/react)
    var longPressTimer = null;
    wrap.addEventListener('touchstart', function() {
      longPressTimer = setTimeout(function() { if (navigator.vibrate) navigator.vibrate(15); showMessageActions(msg, mine); }, 500);
    }, { passive: true });
    wrap.addEventListener('touchmove', function() { clearTimeout(longPressTimer); }, { passive: true });
    wrap.addEventListener('touchend', function() { clearTimeout(longPressTimer); }, { passive: true });

    return wrap;
  }

  function showMessageActions(msg, mine) {
    var actions = [];

    // Reply always available
    actions.push({
      icon: '↩️', label: 'Ответить',
      onClick: function() { setReply({ id: msg.id, message: msg.message, user_name: msg.user_name }); }
    });

    if (mine) {
      actions.push({
        icon: '✏️', label: 'Редактировать',
        onClick: function() { startEdit(msg); }
      });
      actions.push({
        icon: '🗑️', label: 'Удалить',
        onClick: function() { deleteMessage(msg); }
      });
    } else {
      // Show reaction picker for others' messages
      actions.push({
        icon: '😀', label: 'Реакция',
        onClick: function() { showReactionPopup(msg, document.querySelector('[data-msg-id="' + msg.id + '"]')); }
      });
    }

    // Copy always available
    if (msg.message) {
      actions.push({
        icon: '📋', label: 'Копировать',
        onClick: function() { _huginnCopyText(msg.message); M.Toast({ message: 'Скопировано', type: 'info' }); }
      });
    }

    M.ActionSheet({ title: 'Сообщение', actions: actions });
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
    var popup = el('div', {
      className: 'huginn-reaction-popup',
      style: {
        position: 'fixed', top: Math.max(8, rect.top - 50) + 'px',
        left: '50%', transform: 'translateX(-50%)',
        background: t.surface || '#222', borderRadius: '24px',
        padding: '6px 8px', display: 'flex', gap: '4px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)', zIndex: 100,
        animation: 'asgard-react-pop 0.2s ease-out',
      },
    });

    var overlay = el('div', {
      className: 'huginn-reaction-overlay',
      style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 },
      onClick: function() { popup.remove(); overlay.remove(); },
    });

    QUICK_REACTIONS.forEach(function(em) {
      popup.appendChild(el('div', {
        style: { fontSize: '24px', padding: '4px 6px', cursor: 'pointer', borderRadius: '8px' },
        textContent: em,
        onClick: function() { toggleReaction(msg.id, em); popup.remove(); overlay.remove(); },
      }));
    });

    document.body.appendChild(overlay);
    document.body.appendChild(popup);
  }

  async function toggleReaction(msgId, emoji) {
    try {
      var resp = await API.fetch('/chat-groups/' + chatId + '/messages/' + msgId + '/reaction', { method: 'POST', body: { emoji: emoji } });
      var msg = messages.find(function(m) { return m.id === msgId; });
      if (msg && resp.reactions) { msg.reactions = resp.reactions; rerenderMessages(); }
    } catch (_) {}
  }

  function appendDateSeparator(dateStr) {
    var sep = el('div', { style: { textAlign: 'center', padding: '12px 0 8px', ...DS.font('xs'), color: t.textTer || '#666' } });
    sep.appendChild(el('span', {
      style: { background: t.surface || '#1a1a1a', padding: '4px 12px', borderRadius: '10px' },
      textContent: _huginnDateLabel(dateStr),
    }));
    messagesWrap.appendChild(sep);
  }

  function appendMessage(msg, prev) {
    if (!prev || !_huginnSameDay(prev.created_at, msg.created_at)) appendDateSeparator(msg.created_at);
    messagesWrap.appendChild(createBubble(msg, prev));
  }

  function rerenderMessages() {
    messagesWrap.replaceChildren();
    messages.forEach(function(msg, i) { appendMessage(msg, i > 0 ? messages[i - 1] : null); });
  }

  // ── Load initial messages ──
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
  } catch (_) {
    messagesWrap.replaceChildren();
    messagesWrap.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate('/messenger/' + chatId, { replace: true }); } }));
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

  // ── SSE Real-time ──
  function connectSSE() {
    try {
      var token = API.getToken();
      if (!token) return;
      _es = new EventSource('/api/sse/stream?token=' + token);

      _es.addEventListener('chat:new_message', function(e) {
        try {
          var data = JSON.parse(e.data);
          if (String(data.chat_id) !== String(chatId)) return;
          var msg = data.message;
          if (!msg || !msg.id) return;
          if (messages.find(function(m) { return m.id === msg.id; })) return;
          if (emptyStateEl && emptyStateEl.parentNode) { emptyStateEl.remove(); emptyStateEl = null; }
          var wasAtBottom = messagesWrap.scrollHeight - messagesWrap.scrollTop - messagesWrap.clientHeight < 100;
          messages.push(msg);
          if (msg.id > lastMsgId) lastMsgId = msg.id;
          appendMessage(msg, messages.length > 1 ? messages[messages.length - 2] : null);
          if (wasAtBottom) messagesWrap.scrollTo({ top: messagesWrap.scrollHeight, behavior: 'smooth' });
          // Sound notification for messages from others
          _huginnPlayNotifSound();
        } catch (err) {}
      });

      _es.addEventListener('chat:typing', function(e) {
        try {
          var data = JSON.parse(e.data);
          if (String(data.chat_id) !== String(chatId)) return;
          if (data.user_id === userId) return;
          var name = data.user_name || 'Кто-то';
          typingBar.textContent = name + ' печатает...';
          typingBar.style.height = '24px';
          typingBar.style.padding = '4px var(--sp-page,16px)';
          clearTimeout(typingBar._hideTimer);
          typingBar._hideTimer = setTimeout(function() {
            typingBar.style.height = '0';
            typingBar.style.padding = '0 var(--sp-page,16px)';
          }, 4000);
        } catch (err) {}
      });

      _es.addEventListener('chat:message_edited', function(e) {
        try {
          var data = JSON.parse(e.data);
          if (String(data.chat_id) !== String(chatId)) return;
          var found = messages.find(function(m) { return m.id === data.message_id; });
          if (found) { found.message = data.text; found.edited_at = data.edited_at; rerenderMessages(); }
        } catch (err) {}
      });

      _es.addEventListener('chat:message_deleted', function(e) {
        try {
          var data = JSON.parse(e.data);
          if (String(data.chat_id) !== String(chatId)) return;
          var found = messages.find(function(m) { return m.id === data.message_id; });
          if (found) { found.deleted_at = new Date().toISOString(); rerenderMessages(); }
        } catch (err) {}
      });

      _es.addEventListener('chat:reaction', function(e) {
        try {
          var data = JSON.parse(e.data);
          if (String(data.chat_id) !== String(chatId)) return;
          var found = messages.find(function(m) { return m.id === data.message_id; });
          if (found) { found.reactions = data.reactions; rerenderMessages(); }
        } catch (err) {}
      });

      _es.onopen = function() { _sseConnected = true; };
      _es.onerror = function() { _sseConnected = false; };
    } catch (err) {
      _sseConnected = false;
    }
  }

  connectSSE();

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
          appendMessage(msg, messages.length > 1 ? messages[messages.length - 2] : null);
        });
        lastMsgId = Math.max(lastMsgId, Math.max.apply(null, newMsgs.map(function(m) { return m.id; })));
        if (wasAtBottom) messagesWrap.scrollTo({ top: messagesWrap.scrollHeight, behavior: 'smooth' });
      }
    } catch (_) {}
  }

  // Fallback poll every 15 sec (only when SSE disconnected)
  var _pollFallback = setInterval(function() {
    if (!_sseConnected) pollNewMessages();
  }, 15000);

  // Lifecycle: cleanup через Router.onLeave (вместо setInterval polling)
  if (typeof Router !== 'undefined' && Router.onLeave) {
    Router.onLeave(function() {
      clearInterval(_pollFallback);
      if (_es) { _es.close(); _es = null; }
    });
  }

  return page;
}

/* ═══════════════════════════════════════════
   ACTION SHEETS
   ═══════════════════════════════════════════ */
function chatActionsSheet(chatId) {
  M.ActionSheet({
    title: 'Действия',
    actions: [
      { icon: '🔇', label: 'Выключить уведомления', onClick: function() { API.fetch('/chat-groups/' + chatId + '/mute', { method: 'PUT', body: { until: new Date(Date.now() + 365*86400000).toISOString() } }).then(function() { M.Toast({ message: 'Уведомления выключены', type: 'info' }); }).catch(function() { M.Toast({ message: 'Ошибка', type: 'error' }); }); } },
      { icon: '👥', label: 'Участники', onClick: function() { Router.navigate('/messenger/' + chatId + '?tab=members'); } },
      { icon: '📎', label: 'Файлы', onClick: function() { Router.navigate('/messenger/' + chatId + '?tab=files'); } },
    ],
  });
}

function createChatSheet() {
  var content = Utils.el('div');
  content.appendChild(M.Form({
    fields: [
      { id: 'name', label: 'Название чата', type: 'text', required: true },
    ],
    submitLabel: 'Создать',
    onSubmit: async function(data) {
      try {
        await API.fetch('/chat-groups', { method: 'POST', body: { name: data.name, type: 'group' } });
        M.Toast({ message: 'Чат создан', type: 'success' });
        Router.navigate('/messenger');
      } catch (_) {
        M.Toast({ message: 'Ошибка создания', type: 'error' });
      }
    },
  }));
  M.BottomSheet({ title: 'Новый чат', content: content });
}

/* ═══════════════════════════════════════════
   ROUTER
   ═══════════════════════════════════════════ */
Router.register('/messenger', MessengerPage);
Router.register('/messenger/:id', { render: function(p) { return renderChat(p.id); } });
if (typeof window !== 'undefined') window.MessengerPage = MessengerPage;
