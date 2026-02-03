// Stage 17: Доверенности — 7 шаблонов с генерацией DOC
// Формы + скачивание готового документа

window.AsgardProxiesPage = (function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;

  // 7 типов доверенностей
  const PROXY_TYPES = [
    { 
      key: 'general', 
      label: 'Генеральная доверенность', 
      icon: '📜',
      description: 'На представление интересов организации',
      fields: ['fio', 'passport', 'address', 'valid_until', 'powers_general']
    },
    { 
      key: 'bank', 
      label: 'Банковская доверенность', 
      icon: '🏦',
      description: 'На операции с расчётным счётом',
      fields: ['fio', 'passport', 'address', 'bank_name', 'account_number', 'valid_until']
    },
    { 
      key: 'tax', 
      label: 'Доверенность в ФНС', 
      icon: '🏛️',
      description: 'На представление интересов в налоговой',
      fields: ['fio', 'passport', 'address', 'tax_office', 'valid_until']
    },
    { 
      key: 'court', 
      label: 'Судебная доверенность', 
      icon: '⚖️',
      description: 'На представление в суде',
      fields: ['fio', 'passport', 'address', 'court_name', 'case_number', 'valid_until']
    },
    { 
      key: 'receive_goods', 
      label: 'На получение ТМЦ', 
      icon: '📦',
      description: 'На получение товарно-материальных ценностей',
      fields: ['fio', 'passport', 'position', 'supplier', 'goods_list', 'valid_until']
    },
    { 
      key: 'vehicle', 
      label: 'На управление ТС', 
      icon: '🚗',
      description: 'На право управления транспортным средством',
      fields: ['fio', 'passport', 'license', 'vehicle_brand', 'vehicle_number', 'vin', 'valid_until']
    },
    { 
      key: 'signing', 
      label: 'На подписание документов', 
      icon: '✍️',
      description: 'На право подписи договоров и актов',
      fields: ['fio', 'passport', 'position', 'doc_types', 'valid_until']
    }
  ];

  // Описания полей
  const FIELD_LABELS = {
    fio: 'ФИО доверенного лица',
    passport: 'Паспортные данные',
    address: 'Адрес регистрации',
    position: 'Должность',
    valid_until: 'Срок действия до',
    powers_general: 'Перечень полномочий',
    bank_name: 'Наименование банка',
    account_number: 'Номер счёта',
    tax_office: 'Наименование ИФНС',
    court_name: 'Наименование суда',
    case_number: 'Номер дела (если есть)',
    supplier: 'Поставщик',
    goods_list: 'Перечень ТМЦ',
    license: 'Водительское удостоверение',
    vehicle_brand: 'Марка ТС',
    vehicle_number: 'Гос. номер',
    vin: 'VIN номер',
    doc_types: 'Виды документов для подписи'
  };

  // Плейсхолдеры
  const FIELD_PLACEHOLDERS = {
    fio: 'Иванов Иван Иванович',
    passport: 'Серия 0000 № 000000, выдан...',
    address: 'г. Москва, ул. ...',
    position: 'Менеджер',
    valid_until: '',
    powers_general: 'Представлять интересы, подписывать документы...',
    bank_name: 'ПАО Сбербанк',
    account_number: '40702810...',
    tax_office: 'ИФНС России № 46 по г. Москве',
    court_name: 'Арбитражный суд г. Москвы',
    case_number: 'А40-12345/2026',
    supplier: 'ООО "Поставщик"',
    goods_list: 'Оборудование, материалы...',
    license: 'Серия 00 00 № 000000',
    vehicle_brand: 'Toyota Camry',
    vehicle_number: 'А000АА777',
    vin: 'JTDKN3DU5A0000000',
    doc_types: 'Договоры, акты, счета-фактуры'
  };

  function isoNow(){ return new Date().toISOString(); }
  function today(){ return new Date().toISOString().slice(0,10); }
  
  // Дата через год
  function yearFromNow(){
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0,10);
  }

  function formatDate(isoDate){
    if(!isoDate) return '_______________';
    const d = new Date(isoDate);
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    return `«${d.getDate()}» ${months[d.getMonth()]} ${d.getFullYear()} г.`;
  }

  // Генерация номера доверенности
  function generateProxyNumber(){
    const year = new Date().getFullYear();
    const num = String(Math.floor(Math.random() * 900) + 100);
    return `${num}/${year}`;
  }

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash = "#/login"; return; }
    const user = auth.user;

    // Проверка роли
    const allowedRoles = ["ADMIN", "OFFICE_MANAGER", "DIRECTOR_COMM", "DIRECTOR_GEN", "DIRECTOR_DEV", "DIRECTOR"];
    if(!allowedRoles.includes(user.role)){
      toast("Доступ", "Раздел доступен офис-менеджеру и директорам", "err");
      location.hash = "#/home";
      return;
    }

    function renderPage(){
      const body = `
        <style>
          .proxy-header { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:24px; }
          
          .proxy-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:16px; }
          
          .proxy-card {
            position:relative;
            background: linear-gradient(135deg, rgba(13,20,40,.6) 0%, rgba(13,20,40,.4) 100%);
            border: 1px solid rgba(148,163,184,.15);
            border-radius:18px;
            padding:24px;
            cursor:pointer;
            transition: all .3s ease;
            overflow:hidden;
          }
          
          .proxy-card::before {
            content:'';
            position:absolute;
            top:0; left:0; right:0;
            height:4px;
            background: linear-gradient(90deg, var(--gold), var(--red));
            opacity:.5;
            transition: opacity .3s ease;
          }
          
          .proxy-card:hover {
            transform: translateY(-4px);
            border-color: rgba(242,208,138,.35);
            box-shadow: 0 16px 50px rgba(0,0,0,.35);
          }
          
          .proxy-card:hover::before {
            opacity:1;
          }
          
          .proxy-icon {
            font-size:48px;
            margin-bottom:16px;
            display:block;
          }
          
          .proxy-title {
            font-size:18px;
            font-weight:800;
            color:var(--text);
            margin-bottom:8px;
          }
          
          .proxy-desc {
            font-size:13px;
            color:var(--muted);
            line-height:1.5;
          }
          
          .proxy-action {
            display:inline-flex;
            align-items:center;
            gap:6px;
            margin-top:16px;
            padding:8px 14px;
            background: rgba(242,208,138,.15);
            border-radius:10px;
            font-size:12px;
            font-weight:700;
            color:var(--gold);
          }
          
          /* Modal form styles */
          .proxy-form { display:grid; gap:16px; }
          .proxy-form-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
          .proxy-form-row.full { grid-template-columns:1fr; }
          .proxy-field { display:flex; flex-direction:column; gap:4px; }
          .proxy-field label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:1px; font-weight:700; }
          .proxy-field input, .proxy-field textarea, .proxy-field select {
            padding:12px 14px;
            border-radius:10px;
            border:1px solid rgba(148,163,184,.2);
            background:rgba(13,20,40,.6);
            color:var(--text);
            font-size:14px;
          }
          .proxy-field textarea { min-height:80px; resize:vertical; }
          .proxy-field input:focus, .proxy-field textarea:focus {
            border-color:rgba(242,208,138,.5);
            outline:none;
            box-shadow: 0 0 0 3px rgba(242,208,138,.1);
          }
          
          .proxy-preview {
            background: rgba(255,255,255,.03);
            border:1px solid rgba(148,163,184,.15);
            border-radius:12px;
            padding:16px;
            margin-top:16px;
            font-size:13px;
            line-height:1.6;
            max-height:300px;
            overflow:auto;
          }
          
          .proxy-preview h4 { margin:0 0 12px; color:var(--gold); text-align:center; }
          .proxy-preview p { margin:8px 0; }
          .proxy-preview .center { text-align:center; }
          .proxy-preview .bold { font-weight:700; }
          
          .rune-sep {
            text-align:center;
            margin:24px 0;
            font-size:14px;
            letter-spacing:10px;
            color:rgba(242,208,138,.25);
          }
        </style>

        <div class="panel">
          <div class="proxy-header">
            <div>
              <h2 class="page-title" style="margin:0">Доверенности</h2>
              <div class="help" style="margin-top:8px">Выберите шаблон и заполните форму для генерации документа</div>
            </div>
          </div>

          <div class="proxy-grid">
            ${PROXY_TYPES.map(type => `
              <div class="proxy-card" data-type="${type.key}">
                <span class="proxy-icon">${type.icon}</span>
                <div class="proxy-title">${type.label}</div>
                <div class="proxy-desc">${type.description}</div>
                <div class="proxy-action">✨ Создать доверенность</div>
              </div>
            `).join('')}
          </div>
          
          <div class="rune-sep">ᚦ ᚱ ᚢ ᛋ ᛏ</div>
          
          <div class="help" style="text-align:center; color:var(--muted)">
            После заполнения формы вы сможете скачать готовый документ в формате .doc
          </div>
        </div>
      `;

      layout(body, { title: title || "Доверенности" }).then(bindEvents);
    }

    function bindEvents(){
      $$('.proxy-card').forEach(card => {
        card.addEventListener('click', () => {
          const typeKey = card.dataset.type;
          const type = PROXY_TYPES.find(t => t.key === typeKey);
          if(type) openProxyForm(type);
        });
      });
    }

    function openProxyForm(type){
      const fieldsHtml = type.fields.map(fieldKey => {
        const label = FIELD_LABELS[fieldKey] || fieldKey;
        const placeholder = FIELD_PLACEHOLDERS[fieldKey] || '';
        const isTextarea = ['powers_general', 'goods_list', 'doc_types'].includes(fieldKey);
        const isDate = fieldKey === 'valid_until';
        
        if(isDate){
          return `
            <div class="proxy-field">
              <label>${label}</label>
              <input type="date" id="pf_${fieldKey}" value="${yearFromNow()}"/>
            </div>
          `;
        }
        
        if(isTextarea){
          return `
            <div class="proxy-field" style="grid-column:1/-1">
              <label>${label}</label>
              <textarea id="pf_${fieldKey}" placeholder="${esc(placeholder)}"></textarea>
            </div>
          `;
        }
        
        return `
          <div class="proxy-field">
            <label>${label}</label>
            <input id="pf_${fieldKey}" placeholder="${esc(placeholder)}"/>
          </div>
        `;
      }).join('');

      const html = `
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px">
          <span style="font-size:36px">${type.icon}</span>
          <div>
            <div style="font-weight:800; font-size:18px">${type.label}</div>
            <div style="color:var(--muted); font-size:13px">${type.description}</div>
          </div>
        </div>
        
        <div class="proxy-form">
          <div class="proxy-form-row full">
            <div class="proxy-field">
              <label>Номер доверенности</label>
              <input id="pf_number" value="${generateProxyNumber()}" readonly style="background:rgba(242,208,138,.1)"/>
            </div>
          </div>
          <div class="proxy-form-row full">
            <div class="proxy-field">
              <label>Дата выдачи</label>
              <input type="date" id="pf_issue_date" value="${today()}"/>
            </div>
          </div>
          <div class="proxy-form-row">
            ${fieldsHtml}
          </div>
        </div>
        
        <hr class="hr"/>
        
        <div style="display:flex; gap:12px; flex-wrap:wrap">
          <button class="btn" id="btnPreviewProxy">👁 Предпросмотр</button>
          <button class="btn" id="btnDownloadProxy" style="background:linear-gradient(135deg, rgba(34,197,94,.3), rgba(34,197,94,.15))">📥 Скачать .doc</button>
        </div>
        
        <div id="proxyPreviewArea"></div>
      `;

      showModal('Создание доверенности', html);

      $('#btnPreviewProxy')?.addEventListener('click', () => {
        const data = collectFormData(type);
        const preview = generatePreviewHtml(type, data);
        $('#proxyPreviewArea').innerHTML = `<div class="proxy-preview">${preview}</div>`;
      });

      $('#btnDownloadProxy')?.addEventListener('click', () => {
        const data = collectFormData(type);
        downloadProxyDoc(type, data);
      });
    }

    function collectFormData(type){
      const data = {
        number: $('#pf_number')?.value || '',
        issue_date: $('#pf_issue_date')?.value || today()
      };
      
      type.fields.forEach(fieldKey => {
        data[fieldKey] = $(`#pf_${fieldKey}`)?.value || '';
      });
      
      return data;
    }

    function generatePreviewHtml(type, data){
      const companyName = 'ООО «АСГАРД-СЕРВИС»';
      const directorName = 'Генеральный директор';
      
      let powersText = '';
      switch(type.key){
        case 'general':
          powersText = data.powers_general || 'представлять интересы организации во всех учреждениях и организациях';
          break;
        case 'bank':
          powersText = `совершать банковские операции по расчётному счёту № ${data.account_number || '___'} в ${data.bank_name || '___'}`;
          break;
        case 'tax':
          powersText = `представлять интересы организации в ${data.tax_office || 'налоговых органах'}`;
          break;
        case 'court':
          powersText = `представлять интересы в ${data.court_name || 'суде'}${data.case_number ? ` по делу № ${data.case_number}` : ''}`;
          break;
        case 'receive_goods':
          powersText = `получить от ${data.supplier || '___'} товарно-материальные ценности: ${data.goods_list || '___'}`;
          break;
        case 'vehicle':
          powersText = `управлять транспортным средством ${data.vehicle_brand || '___'}, гос. номер ${data.vehicle_number || '___'}, VIN ${data.vin || '___'}`;
          break;
        case 'signing':
          powersText = `подписывать от имени организации следующие документы: ${data.doc_types || '___'}`;
          break;
      }

      return `
        <h4>ДОВЕРЕННОСТЬ № ${data.number || '___'}</h4>
        <p class="center">${formatDate(data.issue_date)}</p>
        <p class="center">г. Москва</p>
        <br/>
        <p><span class="bold">${companyName}</span>, ИНН 0000000000, ОГРН 0000000000000, в лице ${directorName}, действующего на основании Устава, настоящей доверенностью уполномочивает:</p>
        <br/>
        <p class="bold">${data.fio || '_______________'}</p>
        <p>паспорт: ${data.passport || '_______________'}</p>
        ${data.address ? `<p>адрес: ${data.address}</p>` : ''}
        ${data.position ? `<p>должность: ${data.position}</p>` : ''}
        ${data.license ? `<p>в/у: ${data.license}</p>` : ''}
        <br/>
        <p>${powersText}.</p>
        <br/>
        <p>Доверенность выдана сроком до ${formatDate(data.valid_until)} без права передоверия.</p>
        <br/>
        <p>Подпись доверенного лица _______________ удостоверяю.</p>
        <br/>
        <p>${directorName} _______________ / _______________</p>
        <p style="margin-top:24px; font-size:11px; color:var(--muted)">М.П.</p>
      `;
    }

    function downloadProxyDoc(type, data){
      const content = generateDocContent(type, data);
      
      // Создаём HTML документ в формате, который Word понимает
      const htmlDoc = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head>
          <meta charset="utf-8">
          <title>Доверенность ${data.number}</title>
          <style>
            body { font-family: 'Times New Roman', Times, serif; font-size: 14pt; line-height: 1.5; margin: 2cm; }
            h1 { text-align: center; font-size: 16pt; margin-bottom: 20pt; }
            .center { text-align: center; }
            .bold { font-weight: bold; }
            .indent { text-indent: 1.25cm; }
            p { margin: 6pt 0; }
            .signature { margin-top: 40pt; }
          </style>
        </head>
        <body>
          ${content}
        </body>
        </html>
      `;
      
      const blob = new Blob(['\ufeff', htmlDoc], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Доверенность_${type.label.replace(/\s+/g, '_')}_${data.number.replace('/', '-')}.doc`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast('Доверенность', 'Документ скачан');
    }

    function generateDocContent(type, data){
      const companyName = 'ООО «АСГАРД-СЕРВИС»';
      const companyInn = '0000000000';
      const companyOgrn = '0000000000000';
      const companyAddress = 'г. Москва, ул. Примерная, д. 1';
      const directorName = 'Генеральный директор';
      const directorFio = 'Ярлов Я.Я.';

      let powersText = '';
      switch(type.key){
        case 'general':
          powersText = data.powers_general || 'представлять интересы организации во всех учреждениях и организациях, подписывать документы, получать корреспонденцию';
          break;
        case 'bank':
          powersText = `совершать все необходимые банковские операции по расчётному счёту № ${data.account_number || '_____________'} в ${data.bank_name || '_____________'}, включая: получение выписок, сдачу и получение наличных денежных средств, оформление платёжных поручений`;
          break;
        case 'tax':
          powersText = `представлять интересы ${companyName} в ${data.tax_office || 'налоговых органах Российской Федерации'}, подавать и получать документы, расписываться, совершать иные действия, связанные с выполнением данного поручения`;
          break;
        case 'court':
          powersText = `представлять интересы ${companyName} в ${data.court_name || 'судах Российской Федерации'}${data.case_number ? ` по делу № ${data.case_number}` : ''}, со всеми правами, предоставленными законом истцу, ответчику, третьему лицу, включая право на подписание искового заявления, предъявление его в суд, передачу спора на рассмотрение третейского суда, предъявление встречного иска, полный или частичный отказ от исковых требований, уменьшение их размера, признание иска, изменение предмета или основания иска, заключение мирового соглашения`;
          break;
        case 'receive_goods':
          powersText = `получить от ${data.supplier || '_____________'} товарно-материальные ценности согласно следующему перечню: ${data.goods_list || '_____________'}`;
          break;
        case 'vehicle':
          powersText = `управлять принадлежащим ${companyName} транспортным средством: ${data.vehicle_brand || '_____________'}, государственный регистрационный номер ${data.vehicle_number || '_____________'}, VIN ${data.vin || '_____________'}, с правом выезда за пределы Российской Федерации, прохождения технического осмотра, получения документов, страхования, представления интересов в ГИБДД`;
          break;
        case 'signing':
          powersText = `подписывать от имени ${companyName} следующие документы: ${data.doc_types || 'договоры, акты выполненных работ, счета-фактуры, товарные накладные'}`;
          break;
      }

      return `
        <h1>ДОВЕРЕННОСТЬ № ${data.number || '______'}</h1>
        <p class="center">${formatDate(data.issue_date)}</p>
        <p class="center">г. Москва</p>
        <br/>
        <p class="indent"><span class="bold">${companyName}</span>, ИНН ${companyInn}, ОГРН ${companyOgrn}, юридический адрес: ${companyAddress}, в лице ${directorName} ${directorFio}, действующего на основании Устава, настоящей доверенностью уполномочивает:</p>
        <br/>
        <p class="bold center">${data.fio || '_________________________________'}</p>
        <p>паспорт: ${data.passport || '_________________________________'},</p>
        ${data.address ? `<p>зарегистрированного по адресу: ${data.address},</p>` : ''}
        ${data.position ? `<p>занимающего должность: ${data.position},</p>` : ''}
        ${data.license ? `<p>водительское удостоверение: ${data.license},</p>` : ''}
        <br/>
        <p class="indent">${powersText}.</p>
        <br/>
        <p class="indent">Доверенность выдана сроком до ${formatDate(data.valid_until)} без права передоверия.</p>
        <br/>
        <p class="indent">Подпись доверенного лица ${data.fio ? data.fio.split(' ')[0] : '_____________'} _______________ удостоверяю.</p>
        <br/>
        <p class="signature">${directorName}</p>
        <p>_________________ / ${directorFio}</p>
        <br/>
        <p style="margin-top:40pt;">М.П.</p>
      `;
    }

    renderPage();
  }

  return { render, PROXY_TYPES };
})();
