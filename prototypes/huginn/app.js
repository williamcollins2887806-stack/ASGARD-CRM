(function () {
  let META = {};
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '_boards.json', false);
    xhr.send(null);
    if (xhr.status === 200) {
      JSON.parse(xhr.responseText).forEach((b) => {
        META[b.id] = { title: b.title, desc: b.desc };
      });
    }
  } catch (_) { /* fallback below */ }

  if (!Object.keys(META).length) {
    META = {
      'b-rail': { title: 'CRM · лёгкий rail', desc: 'Мимир · Хугинн · Тинг с подписями.' },
      'b-huginn': { title: 'Хугинн открыт', desc: 'Статусы команды · чаты · compose в шапке.' },
      'b-mimir': { title: 'Мимир рядом со сметой', desc: 'AI-панель · CRM не уходит.' },
      'b-group': { title: 'Групповой чат', desc: 'РП · Северная башня · 6 участников.' },
      'b-thread': { title: 'Диалог · карточки CRM', desc: 'Просчёт и Тинг · composer.' },
      'b-voice-play': { title: 'Голос · расшифровка', desc: 'SpeechKit transcript.' },
      'b-voice-rec': { title: 'Запись голоса', desc: 'Waveform · cancel / send.' },
      'b-photo': { title: 'Фото в чате', desc: 'Превью объекта.' },
      'b-video': { title: 'Видео-сообщение', desc: 'Thumbnail · play · длительность.' },
      'b-circle': { title: 'Кружок', desc: 'Round video note.' },
      'b-stickers': { title: 'Стикеры и смайлы', desc: 'Стикер ᚺ · emoji picker.' },
      'b-ting': { title: 'Тинг из chrome', desc: 'Хаб + join overlay.' },
      'b-story-post': { title: 'Выкладка статуса', desc: 'Превью · Опубликовать.' },
      'b-phones-l': { title: 'iPhone · светлая', desc: 'Чаты · диалог · звонки · in-call.' },
      'b-phones-media': { title: 'iPhone · медиа', desc: 'Фото · голос · кружок · стикеры.' },
      'b-phones-d': { title: 'iPhone · тёмная', desc: 'Сводка · invite · профиль · выкладка.' },
      'b-hero': { title: 'Хугинн · презентация', desc: 'Смета + лёгкий правый chrome.' },
    };
  }

  const boards = [...document.querySelectorAll('.board')];
  const dots = [...document.querySelectorAll('.present-dots button')];
  const title = document.getElementById('capTitle');
  const desc = document.getElementById('capDesc');

  function show(id) {
    const board = boards.find((b) => b.getAttribute('data-board') === id) || boards[0];
    const bid = board.getAttribute('data-board');
    const theme = board.getAttribute('data-theme') || 'dark';
    boards.forEach((b) => b.classList.toggle('is-on', b === board));
    dots.forEach((d) => d.classList.toggle('is-on', d.getAttribute('data-board') === bid));
    document.documentElement.setAttribute('data-theme', theme);
    const m = META[bid] || {};
    if (title) title.textContent = m.title || '';
    if (desc) desc.textContent = m.desc || '';
    location.hash = bid;
  }

  dots.forEach((d) => d.addEventListener('click', () => show(d.getAttribute('data-board'))));
  document.getElementById('btnTheme')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', cur === 'light' ? 'dark' : 'light');
  });

  document.addEventListener('keydown', (e) => {
    const ids = boards.map((b) => b.getAttribute('data-board'));
    const cur = boards.findIndex((b) => b.classList.contains('is-on'));
    if (e.key === 'ArrowRight') show(ids[Math.min(ids.length - 1, cur + 1)]);
    if (e.key === 'ArrowLeft') show(ids[Math.max(0, cur - 1)]);
  });

  window.showBoard = show;
  const initial = (location.hash || '#b-rail').slice(1);
  show(META[initial] ? initial : 'b-rail');
})();
