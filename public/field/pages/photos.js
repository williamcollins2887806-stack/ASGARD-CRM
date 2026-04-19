/**
 * ASGARD Field — Photos Page
 * Photo grid with upload capability
 */
(() => {
'use strict';
const el = Utils.el;

const PHOTO_QUOTES = [
  '\uD83D\uDCF7 \u0420\u0443\u043D\u044B \u0437\u0430\u0444\u0438\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u044B! \u041B\u0435\u0442\u043E\u043F\u0438\u0441\u044C \u043F\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0430',
  '\uD83D\uDCF7 \u0417\u0430\u043F\u0435\u0447\u0430\u0442\u043B\u0435\u043D\u043E! \u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043D\u0435 \u0437\u0430\u0431\u0443\u0434\u0435\u0442',
  '\uD83D\uDCF7 \u0424\u043E\u0442\u043E \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E \u0432 \u0445\u0440\u043E\u043D\u0438\u043A\u0438 \u0410\u0441\u0433\u0430\u0440\u0434\u0430',
];

const PhotosPage = {
  render() {
    const t = DS.t;
    const page = el('div', { className: 'field-page field-photos' });

    page.appendChild(F.Header({
      title: '\u0424\u043E\u0442\u043E\u043E\u0442\u0447\u0451\u0442\u044B',
      logo: true,
      back: true,
      rightAction: buildUploadBtn(t),
    }));

    const content = el('div', { style: { padding: '16px 20px 100px', display: 'flex', flexDirection: 'column', gap: '16px' } });
    content.appendChild(F.Skeleton({ type: 'card', count: 3 }));
    page.appendChild(content);

    setTimeout(() => loadPhotos(content), 0);
    return page;
  }
};

function buildUploadBtn(t) {
  const btn = el('button', {
    style: {
      padding: '6px 14px', borderRadius: '10px', border: 'none',
      background: t.goldGrad, color: '#FFF', fontSize: '0.8125rem', fontWeight: '600', cursor: 'pointer',
    },
    onClick: () => showUploadSheet(),
  }, '+ \u0424\u043E\u0442\u043E');
  return btn;
}

async function loadPhotos(content) {
  const t = DS.t;
  const project = await API.fetch('/worker/active-project');
  const workId = project?.project?.work_id || project?.project?.id;

  if (!workId) {
    content.replaceChildren(F.Empty({ text: '\u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u043F\u0440\u043E\u0435\u043A\u0442\u0430', icon: '\uD83D\uDCF7' }));
    return;
  }

  const data = await API.fetch('/photos/?work_id=' + workId);

  content.replaceChildren();

  const photos = data?.photos || (Array.isArray(data) ? data : []);

  if (!photos.length) {
    content.appendChild(F.Empty({
      text: '\u041F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0444\u043E\u0442\u043E.\n\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB+ \u0424\u043E\u0442\u043E\xBB \u0447\u0442\u043E\u0431\u044B \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C',
      icon: '\uD83D\uDCF7',
    }));
    return;
  }

  // Group by date
  const byDate = {};
  for (const p of photos) {
    const d = p.created_at ? p.created_at.split('T')[0] : 'unknown';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(p);
  }

  const dates = Object.keys(byDate).sort().reverse();
  let delay = 0;

  for (const date of dates) {
    delay += 0.06;
    content.appendChild(el('div', {
      style: { color: t.textTer, fontSize: '0.75rem', fontWeight: '600', marginTop: '4px', animation: 'fieldSlideUp 0.4s ease ' + delay + 's both' },
    }, Utils.formatDateFull ? Utils.formatDateFull(date) : Utils.formatDate(date)));

    const grid = el('div', {
      style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', borderRadius: '12px', overflow: 'hidden', animation: 'fieldSlideUp 0.4s ease ' + (delay + 0.03) + 's both' },
    });

    for (const photo of byDate[date]) {
      const url = photo.url || ('/uploads/field/' + (photo.work_id || '') + '/' + photo.filename);
      const thumb = el('div', {
        style: {
          aspectRatio: '1', background: t.bg2,
          backgroundImage: 'url(' + url + ')',
          backgroundSize: 'cover', backgroundPosition: 'center',
          cursor: 'pointer', position: 'relative',
        },
        onClick: () => showFullPhoto(photo, url),
      });

      if (photo.photo_type && photo.photo_type !== 'work') {
        const badge = el('div', {
          style: {
            position: 'absolute', bottom: '4px', left: '4px',
            padding: '2px 6px', borderRadius: '4px', background: 'rgba(0,0,0,0.6)',
            color: '#FFF', fontSize: '0.5rem', fontWeight: '600',
          },
        }, photo.photo_type);
        thumb.appendChild(badge);
      }

      grid.appendChild(thumb);
    }
    content.appendChild(grid);
  }
}

function showFullPhoto(photo, url) {
  const t = DS.t;
  const overlay = el('div', {
    style: {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.95)',
      zIndex: '500', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      animation: 'fieldFadeIn 0.2s ease',
    },
    onClick: () => overlay.remove(),
  });

  const img = el('img', {
    src: url,
    style: { maxWidth: '95vw', maxHeight: '80vh', borderRadius: '8px', objectFit: 'contain' },
  });
  overlay.appendChild(img);

  if (photo.caption) {
    overlay.appendChild(el('div', {
      style: { color: '#FFF', fontSize: '0.875rem', marginTop: '12px', textAlign: 'center', padding: '0 20px' },
    }, photo.caption));
  }

  overlay.appendChild(el('div', {
    style: { color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem', marginTop: '6px' },
  }, Utils.formatDate(photo.created_at) + ' ' + Utils.formatTime(photo.created_at)));

  document.body.appendChild(overlay);
}

function showUploadSheet() {
  const t = DS.t;
  const form = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });

  // Photo type
  const typeRow = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
  let selectedType = 'work';
  const types = [
    { v: 'work', l: '\u0420\u0430\u0431\u043E\u0442\u0430' },
    { v: 'before', l: '\u0414\u043E' },
    { v: 'after', l: '\u041F\u043E\u0441\u043B\u0435' },
    { v: 'incident', l: '\u0418\u043D\u0446\u0438\u0434\u0435\u043D\u0442' },
  ];
  const tBtns = [];
  for (const tp of types) {
    const btn = el('button', {
      style: {
        padding: '8px 14px', borderRadius: '9999px',
        border: '1px solid ' + (tp.v === 'work' ? t.gold : t.border),
        background: tp.v === 'work' ? t.gold + '20' : t.bg2,
        color: tp.v === 'work' ? t.gold : t.textSec,
        fontSize: '0.8125rem', fontWeight: '600', cursor: 'pointer',
      },
      onClick: () => {
        selectedType = tp.v;
        tBtns.forEach(b => { b.style.background = t.bg2; b.style.color = t.textSec; b.style.borderColor = t.border; });
        btn.style.background = t.gold + '20';
        btn.style.color = t.gold;
        btn.style.borderColor = t.gold;
      },
    }, tp.l);
    tBtns.push(btn);
    typeRow.appendChild(btn);
  }
  form.appendChild(typeRow);

  // File input
  const fileInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' } });
  form.appendChild(fileInput);

  const preview = el('div', {
    style: {
      width: '100%', height: '200px', borderRadius: '14px', border: '2px dashed ' + t.border,
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      background: t.bg2, overflow: 'hidden',
    },
    onClick: () => fileInput.click(),
  });
  preview.appendChild(el('div', { style: { textAlign: 'center', color: t.textSec } },
    el('div', { style: { fontSize: '2rem', marginBottom: '8px' } }, '\uD83D\uDCF7'),
    el('div', { style: { fontSize: '0.875rem' } }, '\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u0434\u043B\u044F \u0432\u044B\u0431\u043E\u0440\u0430 \u0444\u043E\u0442\u043E'),
  ));

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) {
      const url = URL.createObjectURL(fileInput.files[0]);
      preview.style.border = 'none';
      preview.replaceChildren(el('img', {
        src: url,
        style: { width: '100%', height: '100%', objectFit: 'cover' },
      }));
    }
  });
  form.appendChild(preview);

  // Caption
  const caption = el('input', {
    type: 'text', placeholder: '\u041F\u043E\u0434\u043F\u0438\u0441\u044C (\u043D\u0435\u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E)',
    style: {
      width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid ' + t.border,
      background: t.bg2, color: t.text, fontSize: '0.875rem', boxSizing: 'border-box', outline: 'none',
    },
  });
  form.appendChild(caption);

  const errorEl = el('div', { style: { color: t.red, fontSize: '0.8125rem', minHeight: '16px' } });
  form.appendChild(errorEl);

  // Upload button
  form.appendChild(F.BigButton({
    label: '\u0417\u0410\u0413\u0420\u0423\u0417\u0418\u0422\u042C',
    icon: '\uD83D\uDCE4',
    variant: 'gold',
    onClick: async () => {
      if (!fileInput.files[0]) {
        errorEl.textContent = '\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0444\u043E\u0442\u043E';
        return;
      }

      const project = await API.fetch('/worker/active-project');
      const workId = project?.project?.work_id || project?.project?.id;
      if (!workId) {
        errorEl.textContent = '\u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u043F\u0440\u043E\u0435\u043A\u0442\u0430';
        return;
      }

      const fd = new FormData();
      fd.append('file', fileInput.files[0]);
      fd.append('work_id', workId);
      fd.append('photo_type', selectedType);
      if (caption.value) fd.append('caption', caption.value);

      const resp = await API.upload('/photos/upload', fd);
      if (resp && !resp.error) {
        sheet.remove();
        F.Toast({
          message: PHOTO_QUOTES[Math.floor(Math.random() * PHOTO_QUOTES.length)],
          type: 'success',
        });
        Router.navigate('/field/photos');
      } else {
        errorEl.textContent = resp?.error || '\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438';
      }
    },
  }));

  const sheet = F.BottomSheet({ title: '\uD83D\uDCF7 \u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0444\u043E\u0442\u043E', content: form });
}

Router.register('/field/photos', PhotosPage);
})();
