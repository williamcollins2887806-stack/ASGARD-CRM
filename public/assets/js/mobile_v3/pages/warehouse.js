/**
 * ASGARD CRM — Mobile v3 · Склад ТМЦ
 * Окно 4, Страница 5
 * Компоненты: список ТМЦ (фото, название, кол-во, склад), поиск, QR-сканер, модалка деталей
 */
const WarehousePage = {
  async render() {
    const el = Utils.el;
    const t = DS.t;
    const page = el('div', { className: 'asgard-warehouse-page' });
    let items = [];
    let warehouses = [];
    let categories = [];
    let activeWarehouse = 'all';

    page.appendChild(M.Header({
      title: 'Склад ТМЦ',
      subtitle: 'РЕСУРСЫ',
      back: true,
      backHref: '/home',
      actions: [{
        icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h3v3H7zM14 7h3v3h-3zM7 14h3v3H7zM14 14h3v3h-3z"/></svg>',
        onClick: () => openQRScanner(),
      }],
    }));

    page.appendChild(M.SearchBar({
      placeholder: 'Поиск ТМЦ...',
      sticky: true,
      onSearch: (q) => renderList(q),
    }));

    const pillsWrap = el('div');
    page.appendChild(pillsWrap);

    const listWrap = el('div', { style: { padding: '8px 0', minHeight: '200px' } });
    page.appendChild(listWrap);

    async function load() {
      listWrap.replaceChildren();
      listWrap.appendChild(M.Skeleton({ type: 'card', count: 5 }));
      try {
        const [eqResp, whResp, catResp] = await Promise.all([
          API.fetch('/equipment?limit=200'),
          API.fetch('/equipment/warehouses').catch(() => []),
          API.fetch('/equipment/categories').catch(() => []),
        ]);
        items = Array.isArray(eqResp) ? eqResp : (eqResp.data || eqResp.items || []);
        warehouses = Array.isArray(whResp) ? whResp : (whResp.data || []);
        categories = Array.isArray(catResp) ? catResp : (catResp.data || []);

        // Render warehouse filter
        pillsWrap.replaceChildren();
        const pills = [{ label: 'Все', value: 'all', active: true }];
        warehouses.forEach(w => pills.push({ label: w.name || w.title || 'Склад', value: String(w.id) }));
        pillsWrap.appendChild(M.FilterPills({
          items: pills,
          onChange: (v) => { activeWarehouse = v; renderList(''); },
        }));

        renderList('');
      } catch (_) {
        listWrap.replaceChildren();
        listWrap.appendChild(M.Empty({ text: 'Ошибка загрузки', type: 'error' }));
      }
    }

    function renderList(query) {
      listWrap.replaceChildren();
      const q = (query || '').toLowerCase();
      const filtered = items.filter(item => {
        if (activeWarehouse !== 'all' && String(item.warehouse_id) !== activeWarehouse) return false;
        if (q && !(item.name || '').toLowerCase().includes(q) && !(item.inventory_number || '').toLowerCase().includes(q)) return false;
        return true;
      });

      if (!filtered.length) {
        listWrap.appendChild(M.Empty({ text: q ? 'Ничего не найдено' : 'Склад пуст', type: q ? 'search' : 'default', icon: '📦' }));
        return;
      }

      const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 var(--sp-page)' } });
      filtered.forEach((item, i) => {
        const card = el('div', {
          style: {
            display: 'flex', gap: '12px', padding: '12px 16px',
            background: t.surface, borderRadius: 'var(--r-xl)',
            border: '1px solid ' + t.border, boxShadow: DS.t.shadow,
            cursor: 'pointer', transition: 'transform 0.15s ease',
            ...DS.anim(i * 0.03),
          },
          onClick: () => viewItemSheet(item),
        });
        card.addEventListener('touchstart', () => card.style.transform = 'scale(0.98)', { passive: true });
        card.addEventListener('touchend', () => card.style.transform = '', { passive: true });

        // Photo
        if (item.photo_url || item.image_url) {
          const img = el('img', {
            src: item.photo_url || item.image_url,
            style: { width: '56px', height: '56px', borderRadius: '12px', objectFit: 'cover', flexShrink: 0, background: t.surfaceAlt },
          });
          img.onerror = () => { img.style.display = 'none'; };
          card.appendChild(img);
        } else {
          card.appendChild(el('div', {
            style: {
              width: '56px', height: '56px', borderRadius: '12px', flexShrink: 0,
              background: t.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px',
            },
            textContent: '📦',
          }));
        }

        const info = el('div', { style: { flex: 1, minWidth: 0 } });
        info.appendChild(el('div', {
          style: { ...DS.font('md'), color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
          textContent: item.name || 'Без названия',
        }));

        const meta = el('div', { style: { display: 'flex', gap: '12px', marginTop: '4px', flexWrap: 'wrap' } });
        meta.appendChild(el('span', { style: { ...DS.font('sm'), color: t.textSec }, textContent: 'Кол-во: ' + (item.quantity != null ? item.quantity : '—') + (item.unit ? ' ' + item.unit : '') }));
        if (item.warehouse_name) meta.appendChild(el('span', { style: { ...DS.font('sm'), color: t.textTer }, textContent: item.warehouse_name }));
        info.appendChild(meta);

        if (item.category_name) {
          info.appendChild(el('div', { style: { marginTop: '4px' } }, M.Badge({ text: item.category_name, color: 'neutral' })));
        }

        card.appendChild(info);
        wrap.appendChild(card);
      });
      listWrap.appendChild(wrap);
    }

    function openQRScanner() {
      M.BottomSheet({
        title: '📷 QR-сканер',
        content: (() => {
          const wrap = el('div', { style: { textAlign: 'center' } });
          wrap.appendChild(el('div', { style: { ...DS.font('base'), color: t.textSec, marginBottom: '16px' }, textContent: 'Введите инвентарный номер или отсканируйте QR-код' }));
          wrap.appendChild(M.Form({
            fields: [{ id: 'query', label: 'Инвентарный / QR', type: 'text', required: true }],
            submitLabel: '🔍 Найти',
            onSubmit: async (data) => {
              try {
                const resp = await API.fetch('/equipment/by-qr/' + encodeURIComponent(data.query));
                if (resp && resp.id) viewItemSheet(resp);
                else M.Toast({ message: 'Не найдено', type: 'error' });
              } catch (_) { M.Toast({ message: 'Не найдено', type: 'error' }); }
            },
          }));
          return wrap;
        })(),
      });
    }

    load();
    return page;
  },
};

function viewItemSheet(item) {
  const content = Utils.el('div');
  content.appendChild(M.DetailFields({
    fields: [
      { label: 'Название', value: item.name || '—' },
      { label: 'Инв. №', value: item.inventory_number || '—' },
      { label: 'Категория', value: item.category_name || '—' },
      { label: 'Количество', value: (item.quantity != null ? item.quantity : '—') + (item.unit ? ' ' + item.unit : '') },
      { label: 'Склад', value: item.warehouse_name || '—' },
      { label: 'Статус', value: item.status || '—' },
      { label: 'Ответственный', value: item.responsible_name || '—' },
      { label: 'Стоимость', value: item.price ? Utils.formatMoney(item.price) : '—' },
      { label: 'Примечание', value: item.note || item.comment || '—' },
    ],
  }));
  M.BottomSheet({ title: '📦 ' + (item.name || 'ТМЦ'), content, fullscreen: true });
}

Router.register('/warehouse', WarehousePage);
if (typeof window !== 'undefined') window.WarehousePage = WarehousePage;
