/**
 * АСГАРД CRM — QR-коды
 * Этап 41
 * 
 * Функционал:
 * - Генерация QR для быстрого доступа к сущностям
 * - Сканирование QR для перехода
 * - Печать QR для документов
 */
window.AsgardQR = (function(){
  
  // Генерация QR-кода (используем QRCode.js или API)
  function generateQR(text, size = 200) {
    // Используем Google Charts API для простоты
    // В продакшене лучше использовать локальную библиотеку QRCode.js
    return `https://chart.googleapis.com/chart?cht=qr&chs=${size}x${size}&chl=${encodeURIComponent(text)}&choe=UTF-8`;
  }

  // Генерация URL для сущности
  function getEntityUrl(type, id) {
    const baseUrl = window.location.origin + window.location.pathname;
    
    switch (type) {
      case 'tender':
        return `${baseUrl}#/tenders?open=${id}`;
      case 'work':
        return `${baseUrl}#/pm-works?open=${id}`;
      case 'employee':
        return `${baseUrl}#/personnel?open=${id}`;
      case 'customer':
        return `${baseUrl}#/customers?open=${id}`;
      case 'contract':
        return `${baseUrl}#/contracts?open=${id}`;
      default:
        return `${baseUrl}#/${type}/${id}`;
    }
  }

  // Показать QR-код в модальном окне
  function showQR(type, id, title = '') {
    const url = getEntityUrl(type, id);
    const qrUrl = generateQR(url, 250);
    
    const html = `
      <div class="modal-overlay" id="qrModal">
        <div class="modal-content" style="max-width:350px;text-align:center">
          <div class="modal-header">
            <h3>📱 QR-код</h3>
            <button class="btn ghost btnClose">✕</button>
          </div>
          <div class="modal-body" style="padding:24px">
            <img src="${qrUrl}" alt="QR Code" style="width:250px;height:250px;border-radius:12px;background:#fff;padding:10px"/>
            <div style="margin-top:16px;font-weight:600">${esc(title || `${type} #${id}`)}</div>
            <div class="help" style="margin-top:8px;word-break:break-all;font-size:11px">${esc(url)}</div>
          </div>
          <div class="modal-footer" style="display:flex;gap:12px;justify-content:center;padding:16px">
            <button class="btn ghost" id="btnCopyUrl">📋 Копировать ссылку</button>
            <button class="btn primary" id="btnPrintQR">🖨️ Печать</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    const modal = document.getElementById('qrModal');
    
    // Закрытие
    modal.querySelector('.btnClose').onclick = () => modal.remove();
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    
    // Копировать ссылку
    document.getElementById('btnCopyUrl').onclick = () => {
      navigator.clipboard.writeText(url).then(() => {
        AsgardUI.toast('Скопировано', 'Ссылка скопирована в буфер', 'ok');
      });
    };
    
    // Печать
    document.getElementById('btnPrintQR').onclick = () => {
      printQR(qrUrl, title || `${type} #${id}`, url);
    };
  }

  // Печать QR-кода
  function printQR(qrUrl, title, url) {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>QR-код — ${title}</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 40px; }
          img { width: 300px; height: 300px; }
          h2 { margin: 20px 0 10px; }
          .url { font-size: 12px; color: #666; word-break: break-all; max-width: 400px; margin: 0 auto; }
          .logo { font-size: 24px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="logo">⚔️ АСГАРД CRM</div>
        <img src="${qrUrl}" alt="QR Code"/>
        <h2>${esc(title)}</h2>
        <p class="url">${esc(url)}</p>
        <script>window.onload = () => { window.print(); }</script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }

  // Добавить кнопку QR к элементу
  function addQRButton(containerId, type, id, title = '') {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.insertAdjacentHTML('beforeend', `
      <button class="btn mini ghost qr-btn" onclick="AsgardQR.showQR('${type}', '${id}', '${esc(title)}')" title="QR-код">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 11h8V3H3v8zm2-6h4v4H5V5zm8-2v8h8V3h-8zm6 6h-4V5h4v4zm-6 4h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm4 0h2v2h-2zm2 2h2v2h-2zm0-4h2v2h-2zm2-2h2v2h-2zM3 21h8v-8H3v8zm2-6h4v4H5v-4z"/>
        </svg>
      </button>
    `);
  }

  // Сканер QR-кодов
  async function openQRScanner() {
    const html = `
      <div class="modal-overlay" id="qrScannerModal">
        <div class="modal-content" style="max-width:400px">
          <div class="modal-header">
            <h3>📷 Сканер QR</h3>
            <button class="btn ghost btnClose">✕</button>
          </div>
          <div class="modal-body" style="padding:0">
            <video id="qrScannerVideo" style="width:100%;aspect-ratio:1;object-fit:cover;background:#000" autoplay playsinline></video>
            <div style="padding:16px;text-align:center" class="help">Наведите камеру на QR-код</div>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    const modal = document.getElementById('qrScannerModal');
    const video = document.getElementById('qrScannerVideo');
    
    let stream = null;
    let scanning = true;
    
    // Закрытие
    const closeScanner = () => {
      scanning = false;
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
      modal.remove();
    };
    
    modal.querySelector('.btnClose').onclick = closeScanner;
    modal.onclick = e => { if (e.target === modal) closeScanner(); };
    
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      video.srcObject = stream;
      
      // Простой сканер через Canvas и анализ
      // В продакшене использовать jsQR или ZXing
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      const scanFrame = async () => {
        if (!scanning) return;
        
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          
          // Здесь должен быть вызов jsQR или подобной библиотеки
          // const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          // const code = jsQR(imageData.data, imageData.width, imageData.height);
          // if (code) { handleQRResult(code.data); closeScanner(); return; }
        }
        
        requestAnimationFrame(scanFrame);
      };
      
      scanFrame();
      
    } catch(e) {
      console.error('QR Scanner error:', e);
      AsgardUI.toast('Ошибка', 'Не удалось получить доступ к камере', 'err');
      closeScanner();
    }
  }

  // Обработка результата сканирования
  function handleQRResult(url) {
    try {
      // Проверяем, что это наш URL
      if (url.includes(window.location.host) || url.includes('#/')) {
        // Извлекаем hash
        const hashMatch = url.match(/#\/[^\s]+/);
        if (hashMatch) {
          window.location.hash = hashMatch[0];
          AsgardUI.toast('QR', 'Переход выполнен', 'ok');
          return;
        }
      }
      
      // Внешняя ссылка
      if (confirm(`Открыть ссылку?\n${url}`)) {
        window.open(url, '_blank');
      }
    } catch(e) {
      console.error('QR handle error:', e);
    }
  }

  // Batch генерация QR для списка сущностей (для печати)
  async function generateBatchQR(type, items) {
    const printWindow = window.open('', '_blank');
    
    const qrItems = items.map(item => ({
      id: item.id,
      title: item.title || item.name || `#${item.id}`,
      url: getEntityUrl(type, item.id),
      qr: generateQR(getEntityUrl(type, item.id), 150)
    }));
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>QR-коды — ${type}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
          .item { text-align: center; border: 1px solid #ddd; padding: 15px; border-radius: 8px; }
          .item img { width: 150px; height: 150px; }
          .item h4 { margin: 10px 0 5px; font-size: 14px; }
          .item .url { font-size: 10px; color: #666; word-break: break-all; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        <h1>⚔️ АСГАРД CRM — QR-коды</h1>
        <button onclick="window.print()" class="no-print" style="padding:10px 20px;margin-bottom:20px;cursor:pointer">🖨️ Печать</button>
        <div class="grid">
          ${qrItems.map(item => `
            <div class="item">
              <img src="${item.qr}" alt="QR"/>
              <h4>${esc(item.title)}</h4>
              <div class="url">${esc(item.url)}</div>
            </div>
          `).join('')}
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
  }

  // Helper
  function esc(s) { return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;'); }

  return {
    generateQR,
    getEntityUrl,
    showQR,
    printQR,
    addQRButton,
    openQRScanner,
    handleQRResult,
    generateBatchQR
  };
})();
