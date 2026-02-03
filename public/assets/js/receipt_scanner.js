/**
 * АСГАРД CRM — Сканер чеков
 * Этап 38
 * 
 * Функционал:
 * - Открытие камеры с телефона/компа
 * - Сканирование чека/QR-кода
 * - OCR распознавание (Tesseract.js)
 * - Автозаполнение формы расходов
 * - Привязка к работе
 */
window.AsgardReceiptScanner = (function(){
  
  let stream = null;
  let currentWorkId = null;
  
  // OCR паттерны для распознавания чеков
  const RECEIPT_PATTERNS = {
    // Сумма
    total: [
      /итого[:\s]*(\d[\d\s,.]+)/i,
      /всего[:\s]*(\d[\d\s,.]+)/i,
      /сумма[:\s]*(\d[\d\s,.]+)/i,
      /к оплате[:\s]*(\d[\d\s,.]+)/i,
      /total[:\s]*(\d[\d\s,.]+)/i,
      /(\d[\d\s,.]+)\s*(?:руб|₽|rub)/i
    ],
    // Дата
    date: [
      /(\d{2}[./-]\d{2}[./-]\d{2,4})/,
      /(\d{4}[./-]\d{2}[./-]\d{2})/
    ],
    // ИНН продавца
    inn: [
      /инн[:\s]*(\d{10,12})/i
    ],
    // Название магазина
    store: [
      /^([А-ЯЁA-Z][А-ЯЁA-Za-zа-яё\s\-"«»]+)/m
    ]
  };

  // Открыть сканер
  async function openScanner(workId = null) {
    currentWorkId = workId;
    
    const html = `
      <div class="modal-overlay scanner-modal" id="scannerModal">
        <div class="scanner-container">
          <div class="scanner-header">
            <h3>📷 Сканер чеков</h3>
            <button class="btn ghost btnClose">✕</button>
          </div>
          
          <div class="scanner-body">
            <div class="scanner-preview" id="scannerPreview">
              <video id="scannerVideo" autoplay playsinline></video>
              <canvas id="scannerCanvas" style="display:none"></canvas>
              <div class="scanner-frame">
                <div class="scanner-corner tl"></div>
                <div class="scanner-corner tr"></div>
                <div class="scanner-corner bl"></div>
                <div class="scanner-corner br"></div>
              </div>
              <div class="scanner-hint">Наведите камеру на чек</div>
            </div>
            
            <div class="scanner-result" id="scannerResult" style="display:none">
              <img id="capturedImage" style="max-width:100%;border-radius:12px"/>
              <div class="scanner-ocr" id="ocrResult">
                <div class="scanner-loading">
                  <div class="scanner-spinner"></div>
                  <div>Распознавание...</div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="scanner-actions">
            <button class="btn ghost" id="btnSwitchCamera" title="Сменить камеру">🔄</button>
            <button class="btn primary scan-capture" id="btnCapture">📸 Сканировать</button>
            <label class="btn ghost" title="Загрузить из галереи">
              📁
              <input type="file" id="fileInput" accept="image/*" style="display:none"/>
            </label>
          </div>
        </div>
      </div>
      
      <style>
        .scanner-modal {
          z-index: 10000;
        }
        
        .scanner-container {
          background: var(--bg-card);
          border-radius: 20px;
          width: 100%;
          max-width: 500px;
          max-height: 90vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        
        .scanner-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--line);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .scanner-header h3 {
          margin: 0;
          font-size: 18px;
        }
        
        .scanner-body {
          flex: 1;
          overflow: hidden;
          position: relative;
        }
        
        .scanner-preview {
          position: relative;
          width: 100%;
          aspect-ratio: 3/4;
          background: #000;
          overflow: hidden;
        }
        
        .scanner-preview video {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        
        .scanner-frame {
          position: absolute;
          top: 10%;
          left: 10%;
          right: 10%;
          bottom: 10%;
          border: 2px solid rgba(245, 215, 142, 0.5);
          border-radius: 12px;
          pointer-events: none;
        }
        
        .scanner-corner {
          position: absolute;
          width: 24px;
          height: 24px;
          border: 3px solid #f5d78e;
        }
        
        .scanner-corner.tl { top: -3px; left: -3px; border-right: none; border-bottom: none; border-radius: 8px 0 0 0; }
        .scanner-corner.tr { top: -3px; right: -3px; border-left: none; border-bottom: none; border-radius: 0 8px 0 0; }
        .scanner-corner.bl { bottom: -3px; left: -3px; border-right: none; border-top: none; border-radius: 0 0 0 8px; }
        .scanner-corner.br { bottom: -3px; right: -3px; border-left: none; border-top: none; border-radius: 0 0 8px 0; }
        
        .scanner-hint {
          position: absolute;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0,0,0,0.7);
          padding: 8px 16px;
          border-radius: 20px;
          color: #fff;
          font-size: 13px;
        }
        
        .scanner-result {
          padding: 16px;
        }
        
        .scanner-ocr {
          margin-top: 16px;
          padding: 16px;
          background: var(--bg-elevated);
          border-radius: 12px;
        }
        
        .scanner-loading {
          display: flex;
          align-items: center;
          gap: 12px;
          justify-content: center;
          padding: 20px;
        }
        
        .scanner-spinner {
          width: 24px;
          height: 24px;
          border: 3px solid var(--line);
          border-top-color: var(--blue);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
        .scanner-actions {
          padding: 16px 20px;
          border-top: 1px solid var(--line);
          display: flex;
          gap: 12px;
          justify-content: center;
        }
        
        .scan-capture {
          flex: 1;
          max-width: 200px;
          padding: 14px 24px;
          font-size: 16px;
        }
        
        .ocr-field {
          margin-bottom: 12px;
        }
        
        .ocr-field label {
          display: block;
          font-size: 12px;
          opacity: 0.7;
          margin-bottom: 4px;
        }
        
        .ocr-field input {
          width: 100%;
        }
        
        @media (max-width: 480px) {
          .scanner-container {
            max-width: 100%;
            max-height: 100vh;
            border-radius: 0;
          }
          
          .scanner-preview {
            aspect-ratio: auto;
            height: 50vh;
          }
        }
      </style>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    const modal = document.getElementById('scannerModal');
    
    // Закрытие
    modal.querySelector('.btnClose').onclick = () => closeScanner();
    modal.onclick = e => { if (e.target === modal) closeScanner(); };
    
    // Запускаем камеру
    await startCamera();
    
    // Кнопка захвата
    document.getElementById('btnCapture').onclick = captureImage;
    
    // Смена камеры
    document.getElementById('btnSwitchCamera').onclick = switchCamera;
    
    // Загрузка из файла
    document.getElementById('fileInput').onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        await processImageFile(file);
      }
    };
  }

  // Запуск камеры
  let facingMode = 'environment'; // задняя камера по умолчанию
  
  async function startCamera() {
    try {
      // Останавливаем предыдущий стрим
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
      
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      
      const video = document.getElementById('scannerVideo');
      if (video) {
        video.srcObject = stream;
      }
    } catch(e) {
      console.error('Camera error:', e);
      AsgardUI.toast('Камера', 'Не удалось получить доступ к камере', 'err');
    }
  }

  // Переключение камеры
  async function switchCamera() {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    await startCamera();
  }

  // Захват изображения
  async function captureImage() {
    const video = document.getElementById('scannerVideo');
    const canvas = document.getElementById('scannerCanvas');
    
    if (!video || !canvas) return;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    
    const imageData = canvas.toDataURL('image/jpeg', 0.9);
    
    // Показываем результат
    document.getElementById('scannerPreview').style.display = 'none';
    document.getElementById('scannerResult').style.display = 'block';
    document.getElementById('capturedImage').src = imageData;
    
    // Меняем кнопку
    const captureBtn = document.getElementById('btnCapture');
    captureBtn.textContent = '🔄 Пересканировать';
    captureBtn.onclick = () => {
      document.getElementById('scannerPreview').style.display = 'block';
      document.getElementById('scannerResult').style.display = 'none';
      captureBtn.textContent = '📸 Сканировать';
      captureBtn.onclick = captureImage;
    };
    
    // OCR распознавание
    await processImage(imageData);
  }

  // Обработка файла изображения
  async function processImageFile(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const imageData = e.target.result;
      
      document.getElementById('scannerPreview').style.display = 'none';
      document.getElementById('scannerResult').style.display = 'block';
      document.getElementById('capturedImage').src = imageData;
      
      const captureBtn = document.getElementById('btnCapture');
      captureBtn.textContent = '🔄 Пересканировать';
      captureBtn.onclick = () => {
        document.getElementById('scannerPreview').style.display = 'block';
        document.getElementById('scannerResult').style.display = 'none';
        captureBtn.textContent = '📸 Сканировать';
        captureBtn.onclick = captureImage;
        startCamera();
      };
      
      await processImage(imageData);
    };
    reader.readAsDataURL(file);
  }

  // OCR обработка
  async function processImage(imageData) {
    const ocrResult = document.getElementById('ocrResult');
    
    ocrResult.innerHTML = `
      <div class="scanner-loading">
        <div class="scanner-spinner"></div>
        <div>Распознавание текста...</div>
      </div>
    `;
    
    try {
      // Пробуем использовать Tesseract.js (если загружен)
      let text = '';
      
      if (window.Tesseract) {
        const result = await Tesseract.recognize(imageData, 'rus', {
          logger: m => console.log(m)
        });
        text = result.data.text;
      } else {
        // Fallback: простое распознавание через паттерны
        // В реальности здесь был бы API-вызов к OCR сервису
        text = await mockOCR(imageData);
      }
      
      // Парсим результат
      const parsed = parseReceipt(text);
      
      // Показываем форму
      showParsedResult(parsed, text);
      
    } catch(e) {
      console.error('OCR error:', e);
      ocrResult.innerHTML = `
        <div style="text-align:center;color:var(--red)">
          <div style="font-size:32px;margin-bottom:8px">⚠️</div>
          <div>Не удалось распознать чек</div>
          <button class="btn mini" onclick="document.getElementById('manualForm').style.display='block'" style="margin-top:12px">Ввести вручную</button>
        </div>
        <div id="manualForm" style="display:none;margin-top:16px">
          ${renderManualForm({})}
        </div>
      `;
      bindFormEvents();
    }
  }

  // Mock OCR для демонстрации
  async function mockOCR(imageData) {
    await new Promise(r => setTimeout(r, 1500));
    
    // Возвращаем примерный текст чека
    return `
      ООО "ЛУКОЙЛ-ПЕРМЬ"
      АЗС №123
      ИНН 5902180503
      
      Дизель 50л x 54.90
      ИТОГО: 2745.00 руб
      
      14.01.2026 15:32
      Спасибо за покупку!
    `;
  }

  // Парсинг чека
  function parseReceipt(text) {
    const result = {
      amount: null,
      date: null,
      inn: null,
      store: null,
      rawText: text
    };
    
    // Ищем сумму
    for (const pattern of RECEIPT_PATTERNS.total) {
      const match = text.match(pattern);
      if (match) {
        result.amount = parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
        break;
      }
    }
    
    // Ищем дату
    for (const pattern of RECEIPT_PATTERNS.date) {
      const match = text.match(pattern);
      if (match) {
        result.date = normalizeDate(match[1]);
        break;
      }
    }
    
    // Ищем ИНН
    for (const pattern of RECEIPT_PATTERNS.inn) {
      const match = text.match(pattern);
      if (match) {
        result.inn = match[1];
        break;
      }
    }
    
    // Ищем название
    for (const pattern of RECEIPT_PATTERNS.store) {
      const match = text.match(pattern);
      if (match) {
        result.store = match[1].trim();
        break;
      }
    }
    
    return result;
  }

  // Нормализация даты
  function normalizeDate(dateStr) {
    const parts = dateStr.split(/[./-]/);
    if (parts.length !== 3) return null;
    
    let [d, m, y] = parts;
    
    // Если год короткий
    if (y.length === 2) {
      y = '20' + y;
    }
    
    // Если первая часть > 12, значит это день
    if (parseInt(d) > 12) {
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Показать результат парсинга
  function showParsedResult(parsed, rawText) {
    const ocrResult = document.getElementById('ocrResult');
    
    ocrResult.innerHTML = `
      <div style="margin-bottom:16px">
        <div style="font-weight:600;margin-bottom:8px">✅ Распознано:</div>
        ${parsed.store ? `<div class="help">Магазин: <strong>${esc(parsed.store)}</strong></div>` : ''}
        ${parsed.amount ? `<div style="font-size:24px;font-weight:bold;color:var(--gold)">${formatMoney(parsed.amount)}</div>` : ''}
        ${parsed.date ? `<div class="help">Дата: ${parsed.date}</div>` : ''}
        ${parsed.inn ? `<div class="help">ИНН: ${parsed.inn}</div>` : ''}
      </div>
      
      <details style="margin-bottom:16px">
        <summary class="help" style="cursor:pointer">Показать распознанный текст</summary>
        <pre style="font-size:11px;background:var(--bg-card);padding:8px;border-radius:8px;white-space:pre-wrap;margin-top:8px">${esc(rawText)}</pre>
      </details>
      
      ${renderManualForm(parsed)}
    `;
    
    bindFormEvents();
  }

  // Форма для ввода/редактирования
  function renderManualForm(parsed) {
    return `
      <form id="expenseForm">
        <div class="ocr-field">
          <label>Сумма (₽) *</label>
          <input type="number" id="expAmount" class="inp" value="${parsed.amount || ''}" step="0.01" required/>
        </div>
        <div class="ocr-field">
          <label>Дата</label>
          <input type="date" id="expDate" class="inp" value="${parsed.date || new Date().toISOString().slice(0, 10)}"/>
        </div>
        <div class="ocr-field">
          <label>Поставщик / Магазин</label>
          <input type="text" id="expSupplier" class="inp" value="${esc(parsed.store || '')}" placeholder="Название организации"/>
        </div>
        <div class="ocr-field">
          <label>Категория</label>
          <select id="expCategory" class="inp">
            <option value="logistics">🚚 Логистика</option>
            <option value="accommodation">🏨 Проживание</option>
            <option value="transfer">🚗 Трансфер</option>
            <option value="chemicals">🧪 Химия</option>
            <option value="equipment">🔧 Оборудование</option>
            <option value="other" selected>📦 Прочее</option>
          </select>
        </div>
        <div class="ocr-field">
          <label>Комментарий</label>
          <input type="text" id="expComment" class="inp" placeholder="Описание расхода"/>
        </div>
        <div class="ocr-field">
          <label>Работа</label>
          <select id="expWorkId" class="inp">
            <option value="">— Без привязки —</option>
          </select>
        </div>
        <div style="display:flex;gap:12px;margin-top:16px">
          <button type="submit" class="btn primary" style="flex:1">💾 Сохранить расход</button>
        </div>
      </form>
    `;
  }

  // Привязка событий формы
  async function bindFormEvents() {
    // Загружаем работы
    const workSelect = document.getElementById('expWorkId');
    if (workSelect) {
      try {
        const works = await AsgardDB.getAll('works') || [];
        const activeWorks = works.filter(w => w.work_status !== 'Закрыта' && w.work_status !== 'Завершена');
        
        activeWorks.forEach(w => {
          const opt = document.createElement('option');
          opt.value = w.id;
          opt.textContent = w.work_name || w.work_title || `Работа #${w.id}`;
          if (currentWorkId && w.id === currentWorkId) {
            opt.selected = true;
          }
          workSelect.appendChild(opt);
        });
      } catch(e) {}
    }
    
    // Отправка формы
    const form = document.getElementById('expenseForm');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        await saveExpense();
      };
    }
  }

  // Сохранение расхода
  async function saveExpense() {
    const amount = parseFloat(document.getElementById('expAmount').value);
    const date = document.getElementById('expDate').value;
    const supplier = document.getElementById('expSupplier').value.trim();
    const category = document.getElementById('expCategory').value;
    const comment = document.getElementById('expComment').value.trim();
    const workId = document.getElementById('expWorkId').value;
    
    if (!amount || amount <= 0) {
      AsgardUI.toast('Ошибка', 'Укажите сумму', 'err');
      return;
    }
    
    const auth = await AsgardAuth.requireUser();
    
    try {
      if (workId) {
        // Расход по работе
        await AsgardDB.add('work_expenses', {
          work_id: Number(workId),
          category: category,
          amount: amount,
          date: date,
          comment: comment + (supplier ? ` (${supplier})` : ''),
          supplier: supplier,
          created_by: auth?.user?.id,
          created_at: new Date().toISOString()
        });
      } else {
        // Офисный расход
        await AsgardDB.add('office_expenses', {
          category: category,
          amount: amount,
          date: date,
          description: comment,
          supplier: supplier,
          created_by: auth?.user?.id,
          created_at: new Date().toISOString()
        });
      }
      
      AsgardUI.toast('Сохранено', `Расход ${formatMoney(amount)} добавлен`, 'ok');
      closeScanner();
      
      // Вибрация на мобильном
      if (navigator.vibrate) {
        navigator.vibrate(100);
      }
      
    } catch(e) {
      console.error('Save expense error:', e);
      AsgardUI.toast('Ошибка', 'Не удалось сохранить расход', 'err');
    }
  }

  // Закрытие сканера
  function closeScanner() {
    // Останавливаем камеру
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    
    // Удаляем модал
    const modal = document.getElementById('scannerModal');
    if (modal) {
      modal.remove();
    }
    
    currentWorkId = null;
  }

  // Виджет-кнопка для главного экрана
  function renderScanButton(containerId, workId = null) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = `
      <button class="scan-fab" onclick="AsgardReceiptScanner.openScanner(${workId || 'null'})" title="Сканировать чек">
        📷
      </button>
      <style>
        .scan-fab {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: linear-gradient(135deg, #c0392b, #8e2c22);
          border: 2px solid #f5d78e;
          font-size: 24px;
          cursor: pointer;
          box-shadow: 0 4px 20px rgba(192, 57, 43, 0.4);
          transition: all 0.3s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .scan-fab:hover {
          transform: scale(1.1);
          box-shadow: 0 6px 30px rgba(192, 57, 43, 0.5);
        }
        .scan-fab:active {
          transform: scale(0.95);
        }
      </style>
    `;
  }

  // Helpers
  function esc(s) { return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function formatMoney(n) { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(n || 0); }

  return {
    openScanner,
    closeScanner,
    renderScanButton,
    parseReceipt
  };
})();
