window.MobileWidgets = window.MobileWidgets || {};
window.MobileWidgets.permits_expiry = {
  name: 'Истекающие допуски', icon: '🛡', size: 'wide', roles: ['ADMIN','HR','HR_MANAGER','HEAD_TO','CHIEF_ENGINEER','DIRECTOR_*'],
  render: function (container, user) {
    var el = Utils.el; var t = DS.t;
    container.replaceChildren(M.Skeleton({ type: 'list', count: 3 }));
    _load();
    function _dbOrApi(table, apiPath) {
      if (typeof AsgardDB !== 'undefined') {
        return AsgardDB.getAll(table).then(function (data) {
          if (data && data.length) return data;
          return API.fetch(apiPath).then(function (d) { return Array.isArray(d) ? d : (d && d.items ? d.items : d && d.data ? d.data : []); });
        }).catch(function () {
          return API.fetch(apiPath).then(function (d) { return Array.isArray(d) ? d : (d && d.items ? d.items : d && d.data ? d.data : []); });
        });
      }
      return API.fetch(apiPath).then(function (d) { return Array.isArray(d) ? d : (d && d.items ? d.items : d && d.data ? d.data : []); });
    }
    function _load() {
      Promise.all([
        _dbOrApi('permits', '/data/permits'),
        _dbOrApi('employees', '/data/users')
      ]).then(function (res) {
        var empMap = {}; (res[1] || []).forEach(function (e) { empMap[e.id] = e.full_name || e.fio || e.name || ''; });
        var now = new Date();
        var items = (res[0] || []).filter(function (p) { return !!p.expiry_date; }).map(function (p) {
          return { name: empMap[p.employee_id] || p.employee_name || '—', type: p.permit_type || p.type || '', days: Math.round((new Date(p.expiry_date) - now) / 86400000) };
        }).filter(function (x) { return x.days <= 30; }).sort(function (a, b) { return a.days - b.days; }).slice(0, 3);
        if (!items.length) {
          var ok = el('div', { style: { textAlign: 'center', padding: '8px 0' } });
          ok.appendChild(el('div', { style: { fontSize: '28px', marginBottom: '4px' } }, '✅'));
          ok.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { color: t.green, fontWeight: '600' }) }, 'Все допуски в порядке'));
          container.replaceChildren(ok); return;
        }
        var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
        items.forEach(function (p) {
          var color = p.days <= 7 ? t.red : p.days <= 14 ? t.orange : t.gold;
          var row = el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: t.surface, borderRadius: '12px', border: '1px solid ' + t.border } });
          row.appendChild(el('div', { style: { width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: '0' } }));
          var info = el('div', { style: { flex: '1', minWidth: '0' } });
          info.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), { fontWeight: '600', color: t.text }) }, p.name));
          info.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.textSec }) }, p.type));
          row.appendChild(info);
          row.appendChild(M.Badge({ text: p.days <= 0 ? 'Истёк' : p.days + ' дн', color: p.days <= 7 ? 'danger' : p.days <= 14 ? 'warning' : 'gold' }));
          list.appendChild(row);
        });
        container.replaceChildren(list);
        container.style.cursor = 'pointer';
        container.onclick = function () { Router.navigate('/permits'); };
      }).catch(function (e) { console.error('[permits_expiry]', e); container.replaceChildren(M.Empty({ text: 'Ошибка загрузки', icon: '⚠️' })); });
    }
  }
};
