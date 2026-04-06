/**
 * АСГАРД CRM — Отчёты по выплатам рабочим
 * Страница #/reports/payroll для директора / бухгалтера
 */
window.AsgardPaymentsReportPage = (function(){
  const { $, $$, esc, toast } = AsgardUI;
  function money(x) { return AsgardUI.money(x) + ' \u20BD'; }
  function fmtDate(d){ if(!d) return '\u2014'; return new Date(d).toLocaleDateString('ru-RU'); }

  const TYPE_LABELS = {
    per_diem: '\uD83C\uDF19 \u0421\u0443\u0442\u043E\u0447\u043D\u044B\u0435', salary: '\uD83D\uDCB0 \u0417\u041F', advance: '\uD83D\uDCB8 \u0410\u0432\u0430\u043D\u0441',
    bonus: '\uD83C\uDF81 \u041F\u0440\u0435\u043C\u0438\u044F', penalty: '\u26A0\uFE0F \u0423\u0434\u0435\u0440\u0436\u0430\u043D\u0438\u0435'
  };
  const STATUS_LABELS = {
    pending: '\uD83D\uDFE1 \u041E\u0436\u0438\u0434\u0430\u0435\u0442', paid: '\uD83D\uDFE2 \u0412\u044B\u043F\u043B\u0430\u0447\u0435\u043D\u043E',
    confirmed: '\u2705 \u041F\u043E\u0434\u0442\u0432.', cancelled: '\u26AB \u041E\u0442\u043C\u0435\u043D\u0435\u043D\u043E'
  };
  const MONTH_NAMES = ['\u042F\u043D\u0432','\u0424\u0435\u0432','\u041C\u0430\u0440','\u0410\u043F\u0440','\u041C\u0430\u0439','\u0418\u044E\u043D','\u0418\u044E\u043B','\u0410\u0432\u0433','\u0421\u0435\u043D','\u041E\u043A\u0442','\u041D\u043E\u044F','\u0414\u0435\u043A'];

  async function api(path){
    const auth = await AsgardAuth.getAuth();
    if(!auth?.token) throw new Error('\u041D\u0435\u0442 \u0442\u043E\u043A\u0435\u043D\u0430');
    const res = await fetch('/api/worker-payments' + path, {
      headers: { 'Authorization': 'Bearer ' + auth.token }
    });
    if(res.headers.get('content-type')?.includes('spreadsheet')){
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'payroll_export.xlsx';
      a.click();
      return { downloaded: true };
    }
    if(!res.ok){
      const err = await res.json().catch(()=>({error:'\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430'}));
      throw new Error(err.error || '\u041E\u0448\u0438\u0431\u043A\u0430');
    }
    return res.json();
  }

  const CSS = `
<style>
.wpr-page{font-size:13px}
.wpr-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px}
.wpr-filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.wpr-filters select,.wpr-filters input{padding:6px 10px;border-radius:6px;border:1px solid var(--brd,rgba(255,255,255,.1));background:var(--bg-2,#1a1a2e);color:var(--text);font-size:13px}
.wpr-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px}
.wpr-kpi .k{background:rgba(13,20,40,.5);border-radius:8px;padding:14px;text-align:center}
.wpr-kpi .k .t{font-size:10px;color:rgba(184,196,231,.75);font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.wpr-kpi .k .v{font-size:22px;font-weight:900;margin-top:4px;color:rgba(242,208,138,.95)}
.wpr-kpi .k .v.blue{color:rgba(96,165,250,.9)}
.wpr-kpi .k .v.red{color:rgba(239,68,68,.85)}
.wpr-tabs{display:flex;gap:4px;background:rgba(13,20,40,.6);padding:4px;border-radius:6px;margin-bottom:16px}
.wpr-tab{padding:7px 14px;border-radius:6px;border:none;background:transparent;color:var(--muted);font-weight:700;cursor:pointer;font-size:12px;transition:all .2s}
.wpr-tab:hover{color:var(--text)}
.wpr-tab.active{background:linear-gradient(135deg,rgba(59,130,246,.3),rgba(34,197,94,.2));color:var(--text)}
.wpr-tbl{width:100%;border-collapse:collapse;font-size:12px}
.wpr-tbl th{text-align:left;padding:8px 6px;border-bottom:2px solid var(--brd,rgba(255,255,255,.08));font-size:10px;text-transform:uppercase;color:var(--muted);font-weight:700}
.wpr-tbl td{padding:7px 6px;border-bottom:1px solid var(--brd,rgba(255,255,255,.04))}
.wpr-tbl tr:hover td{background:rgba(255,255,255,.02)}
.wpr-tbl .num{text-align:right;font-variant-numeric:tabular-nums}
.wpr-tbl .bold{font-weight:700}
.wpr-tbl .gold{color:var(--gold,#D4A843)}
.wpr-btn{padding:7px 14px;border-radius:6px;border:none;cursor:pointer;font-weight:700;font-size:12px;transition:all .2s}
.wpr-btn.gold{background:linear-gradient(135deg,#D4A843,#c49a2a);color:#000}
.wpr-btn.ghost{background:transparent;border:1px solid var(--brd,rgba(255,255,255,.1));color:var(--text)}
.wpr-btn.ghost:hover{background:rgba(255,255,255,.05)}
</style>`;

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash='#/login'; return; }

    const now = new Date();
    let selMonth = now.getMonth() + 1;
    let selYear = now.getFullYear();
    let currentTab = 'payroll';
    let payrollData = null;
    let laborData = null;
    let debtsData = null;

    async function load(){
      try {
        payrollData = await api(`/reports/payroll/${selYear}/${selMonth}`);
      } catch(e) { payrollData = null; }
      try {
        laborData = await api(`/reports/labor-costs/${selYear}/${selMonth}`);
      } catch(e) { laborData = null; }
      try {
        debtsData = await api('/reports/debts');
      } catch(e) { debtsData = null; }
    }

    function renderContent(){
      const rows = payrollData?.rows || [];
      const tot = payrollData?.totals || {};
      const lRows = laborData?.rows || [];
      const dRows = debtsData?.rows || [];

      // Month selector options
      let monthOpts = '';
      for(let m=1; m<=12; m++){
        monthOpts += `<option value="${m}" ${m===selMonth?'selected':''}>${MONTH_NAMES[m-1]}</option>`;
      }

      let yearOpts = '';
      for(let y=2024; y<=2027; y++){
        yearOpts += `<option value="${y}" ${y===selYear?'selected':''}>${y}</option>`;
      }

      // Tabs
      const tabs = [
        { key: 'payroll', label: '\u0422\u0430\u0431\u0435\u043B\u044C' },
        { key: 'labor', label: '\u0424\u041E\u0422 \u043F\u043E \u043E\u0431\u044A\u0435\u043A\u0442\u0430\u043C' },
        { key: 'debts', label: '\u0417\u0430\u0434\u043E\u043B\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u0438' },
      ];

      let tabsHtml = tabs.map(t =>
        `<button class="wpr-tab ${t.key===currentTab?'active':''}" data-tab="${t.key}">${t.label}</button>`
      ).join('');

      let bodyHtml = '';
      if(currentTab === 'payroll'){
        bodyHtml = renderPayrollTab(rows, tot);
      } else if(currentTab === 'labor'){
        bodyHtml = renderLaborTab(lRows);
      } else {
        bodyHtml = renderDebtsTab(dRows);
      }

      return `${CSS}
        <div class="wpr-page">
          <div class="wpr-header">
            <div class="wpr-filters">
              <select id="wprMonth">${monthOpts}</select>
              <select id="wprYear">${yearOpts}</select>
              <button class="wpr-btn ghost" id="wprExcel">\u{1F4CA} Excel</button>
            </div>
          </div>
          <div class="wpr-kpi">
            <div class="k"><div class="t">\u0424\u041E\u0422</div><div class="v">${money(tot.fot||0)}</div></div>
            <div class="k"><div class="t">\u041D\u0430\u043B\u043E\u0433\u0438 55%</div><div class="v red">${money(tot.tax||0)}</div></div>
            <div class="k"><div class="t">\u041F\u043E\u043B\u043D\u044B\u0439 \u0424\u041E\u0422</div><div class="v blue">${money((tot.fot||0)+(tot.tax||0))}</div></div>
            <div class="k"><div class="t">\u0421\u0443\u0442\u043E\u0447\u043D\u044B\u0435</div><div class="v">${money(tot.per_diem||0)}</div></div>
          </div>
          <div class="wpr-tabs">${tabsHtml}</div>
          <div id="wprBody">${bodyHtml}</div>
        </div>`;
    }

    function renderPayrollTab(rows, tot){
      if(!rows.length) return '<div style="text-align:center;padding:32px;color:var(--muted)">\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445 \u0437\u0430 \u0443\u043A\u0430\u0437\u0430\u043D\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434</div>';
      let html = `<table class="wpr-tbl">
        <thead><tr>
          <th>\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A</th><th>\u041E\u0431\u044A\u0435\u043A\u0442</th><th class="num">\u0411\u0430\u043B\u043B\u044B</th>
          <th class="num">\u0417\u041F</th><th class="num">\u0421\u0443\u0442\u043E\u0447\u043D\u044B\u0435</th>
          <th class="num">\u0410\u0432\u0430\u043D\u0441\u044B</th><th class="num">\u041F\u0440\u0435\u043C\u0438\u0438</th>
          <th class="num">\u0423\u0434\u0435\u0440\u0436.</th><th class="num bold gold">\u0418\u0442\u043E\u0433\u043E</th>
          <th>\u0421\u0442\u0430\u0442\u0443\u0441</th>
        </tr></thead><tbody>`;
      for(const r of rows){
        const net = (parseFloat(r.salary)||0) + (parseFloat(r.bonus)||0)
          - (parseFloat(r.penalty)||0) + (parseFloat(r.per_diem)||0) - (parseFloat(r.advance)||0);
        html += `<tr>
          <td>${esc(r.employee_name)}</td>
          <td>${esc(r.work_title||'\u2014')}</td>
          <td class="num">${r.points||0}</td>
          <td class="num">${money(r.salary)}</td>
          <td class="num">${money(r.per_diem)}</td>
          <td class="num">${money(r.advance)}</td>
          <td class="num">${money(r.bonus)}</td>
          <td class="num">${money(r.penalty)}</td>
          <td class="num bold gold">${money(net)}</td>
          <td>${STATUS_LABELS[r.payment_status]||r.payment_status||'\u2014'}</td>
        </tr>`;
      }
      // Totals row
      const netTotal = (tot.salary||0)+(tot.bonus||0)-(tot.penalty||0)+(tot.per_diem||0)-(tot.advance||0);
      html += `<tr style="font-weight:700;border-top:2px solid var(--brd)">
        <td colspan="3">\u0418\u0422\u041E\u0413\u041E</td>
        <td class="num">${money(tot.salary||0)}</td>
        <td class="num">${money(tot.per_diem||0)}</td>
        <td class="num">${money(tot.advance||0)}</td>
        <td class="num">${money(tot.bonus||0)}</td>
        <td class="num">${money(tot.penalty||0)}</td>
        <td class="num bold gold">${money(netTotal)}</td>
        <td></td>
      </tr>`;
      html += '</tbody></table>';
      return html;
    }

    function renderLaborTab(rows){
      if(!rows.length) return '<div style="text-align:center;padding:32px;color:var(--muted)">\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445</div>';
      let html = `<table class="wpr-tbl">
        <thead><tr>
          <th>\u041E\u0431\u044A\u0435\u043A\u0442</th><th class="num">\u0420\u0430\u0431\u043E\u0447\u0438\u0445</th>
          <th class="num">\u0424\u041E\u0422</th><th class="num">\u041D\u0430\u043B\u043E\u0433\u0438</th>
          <th class="num">\u0421\u0443\u0442\u043E\u0447\u043D\u044B\u0435</th><th class="num bold gold">\u041F\u043E\u043B\u043D\u0430\u044F \u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C</th>
        </tr></thead><tbody>`;
      let totFot=0, totTax=0, totPd=0, totFull=0, totWorkers=0;
      for(const r of rows){
        html += `<tr>
          <td>${esc(r.work_title||'\u0411\u0435\u0437 \u043E\u0431\u044A\u0435\u043A\u0442\u0430')}</td>
          <td class="num">${r.worker_count}</td>
          <td class="num">${money(r.fot)}</td>
          <td class="num">${money(r.tax)}</td>
          <td class="num">${money(r.per_diem)}</td>
          <td class="num bold gold">${money(r.full_cost)}</td>
        </tr>`;
        totFot += r.fot||0; totTax += r.tax||0; totPd += parseFloat(r.per_diem)||0; totFull += r.full_cost||0; totWorkers += parseInt(r.worker_count)||0;
      }
      html += `<tr style="font-weight:700;border-top:2px solid var(--brd)">
        <td>\u0418\u0422\u041E\u0413\u041E</td>
        <td class="num">${totWorkers}</td>
        <td class="num">${money(totFot)}</td>
        <td class="num">${money(totTax)}</td>
        <td class="num">${money(totPd)}</td>
        <td class="num bold gold">${money(totFull)}</td>
      </tr>`;
      html += '</tbody></table>';
      return html;
    }

    function renderDebtsTab(rows){
      if(!rows.length) return '<div style="text-align:center;padding:32px;color:var(--muted)">\u041D\u0435\u0442 \u0437\u0430\u0434\u043E\u043B\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u0435\u0439</div>';
      let html = `<table class="wpr-tbl">
        <thead><tr>
          <th>\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A</th><th class="num">\u0417\u0430\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043E</th>
          <th class="num">\u0423\u0434\u0435\u0440\u0436\u0430\u043D\u043E</th><th class="num">\u0412\u044B\u043F\u043B\u0430\u0447\u0435\u043D\u043E</th>
          <th class="num bold gold">\u0414\u043E\u043B\u0433</th>
        </tr></thead><tbody>`;
      for(const r of rows){
        html += `<tr>
          <td>${esc(r.employee_name)}</td>
          <td class="num">${money(r.earned)}</td>
          <td class="num">${money(r.deductions)}</td>
          <td class="num">${money(r.paid)}</td>
          <td class="num bold gold">${money(r.debt)}</td>
        </tr>`;
      }
      html += '</tbody></table>';
      return html;
    }

    function mount(){
      // Month/year change
      const mSel = document.getElementById('wprMonth');
      const ySel = document.getElementById('wprYear');
      if(mSel) mSel.onchange = async () => { selMonth = parseInt(mSel.value); await load(); refresh(); };
      if(ySel) ySel.onchange = async () => { selYear = parseInt(ySel.value); await load(); refresh(); };

      // Tab clicks
      document.querySelectorAll('.wpr-tab').forEach(btn => {
        btn.onclick = () => {
          currentTab = btn.dataset.tab;
          refresh();
        };
      });

      // Excel
      const exBtn = document.getElementById('wprExcel');
      if(exBtn) exBtn.onclick = async () => {
        try {
          await api(`/reports/payroll/${selYear}/${selMonth}/export`);
        } catch(e) {
          toast('\u041E\u0448\u0438\u0431\u043A\u0430', e.message, 'error');
        }
      };
    }

    function refresh(){
      const lDiv = document.getElementById('layout');
      if(lDiv) lDiv.innerHTML = renderContent();
      mount();
    }

    // Initial load
    await layout('', {title: title || '\u041E\u0442\u0447\u0451\u0442\u044B \u043F\u043E \u0432\u044B\u043F\u043B\u0430\u0442\u0430\u043C'});
    await load();
    const lDiv = document.getElementById('layout');
    if(lDiv) lDiv.innerHTML = renderContent();
    mount();
  }

  return { render };
})();
