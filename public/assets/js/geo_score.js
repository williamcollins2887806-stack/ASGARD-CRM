/**
 * АСГАРД CRM — Геокодинг (Nominatim/OSM) + Скоринг клиентов
 *
 * 1. Расчёт расстояний через Nominatim (OpenStreetMap) / OSRM
 * 2. Светофор клиентов (конверсия + комбинированный скоринг)
 */
window.AsgardGeoScore = (function(){
  
  // Базовая точка — офис компании (Москва по умолчанию)
  const BASE_CITY = 'Москва';
  const BASE_COORDS = [55.7558, 37.6173];
  
  // Nominatim (OpenStreetMap) — бесплатный геокодер, без ключа
  const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
  // OSRM — бесплатный роутер на основе OSM
  const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
  
  // Кэш расстояний
  const distanceCache = new Map();
  
  // ============================================
  // NOMINATIM/OSM — РАСЧЁТ РАССТОЯНИЙ
  // ============================================

  /**
   * Геокодирование города -> координаты
   * Использует серверный прокси /api/sites/geocode (Nominatim)
   */
  async function geocodeCity(cityName) {
    if (!cityName) return null;
    
    const cacheKey = `geo_${cityName.toLowerCase()}`;
    const cached = distanceCache.get(cacheKey);
    if (cached) return cached;
    
    try {
      // Пробуем через серверный прокси (чтобы обойти CORS)
      const auth = await AsgardAuth?.getAuth?.();
      const response = await fetch('/api/geo/geocode?' + new URLSearchParams({ city: cityName }), {
        headers: auth?.token ? { 'Authorization': 'Bearer ' + auth.token } : {}
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.coords) {
          distanceCache.set(cacheKey, data.coords);
          return data.coords;
        }
      }
    } catch(e) {
      console.error('Geocode error:', e);
    }
    
    // Fallback — известные города
    const knownCities = {
      'москва': [55.7558, 37.6173],
      'санкт-петербург': [59.9343, 30.3351],
      'спб': [59.9343, 30.3351],
      'новосибирск': [55.0084, 82.9357],
      'екатеринбург': [56.8389, 60.6057],
      'казань': [55.7887, 49.1221],
      'нижний новгород': [56.2965, 43.9361],
      'челябинск': [55.1644, 61.4368],
      'самара': [53.1959, 50.1002],
      'ростов-на-дону': [47.2357, 39.7015],
      'уфа': [54.7388, 55.9721],
      'красноярск': [56.0153, 92.8932],
      'пермь': [58.0105, 56.2502],
      'воронеж': [51.6755, 39.2089],
      'волгоград': [48.7080, 44.5133],
      'краснодар': [45.0355, 38.9753],
      'мурманск': [68.9585, 33.0827],
      'архангельск': [64.5399, 40.5152],
      'южно-сахалинск': [46.9641, 142.7285],
      'владивосток': [43.1332, 131.9113],
      'хабаровск': [48.4827, 135.0838],
      'якутск': [62.0355, 129.6755],
      'норильск': [69.3535, 88.2027],
      'сургут': [61.2500, 73.4167],
      'нижневартовск': [60.9344, 76.5531],
      'тюмень': [57.1522, 65.5272],
      'омск': [54.9885, 73.3242],
      'томск': [56.4977, 84.9744],
      'иркутск': [52.2978, 104.2964],
      'чита': [52.0515, 113.4712],
      'калининград': [54.7104, 20.4522],
      'сочи': [43.5855, 39.7231],
      'астрахань': [46.3497, 48.0408],
      'саратов': [51.5336, 46.0343],
      'ярославль': [57.6261, 39.8845],
      'тула': [54.1961, 37.6182],
      'рязань': [54.6269, 39.6916],
      'владимир': [56.1366, 40.3966],
      'тверь': [56.8587, 35.9176],
      'смоленск': [54.7903, 32.0503],
      'калуга': [54.5293, 36.2754],
      'орёл': [52.9651, 36.0785],
      'курск': [51.7373, 36.1874],
      'белгород': [50.5997, 36.5986],
      'липецк': [52.6031, 39.5708],
      'тамбов': [52.7212, 41.4523],
      'пенза': [53.1959, 45.0183],
      'ульяновск': [54.3142, 48.4031],
      'оренбург': [51.7879, 55.1019],
      'магнитогорск': [53.4071, 58.9793],
      'нарьян-мар': [67.6380, 53.0069],
      'салехард': [66.5300, 66.6019],
      'ханты-мансийск': [61.0042, 69.0019],
      'приразломное': [69.25, 57.35], // Платформа Приразломная
      'варандей': [68.8231, 58.0681],
    };
    
    const key = cityName.toLowerCase().trim();
    return knownCities[key] || null;
  }
  
  /**
   * Расчёт расстояния между двумя точками (км)
   * Формула гаверсинуса
   */
  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Радиус Земли в км
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return Math.round(R * c);
  }
  
  /**
   * Расчёт расстояния до города от базы
   * @param {string} cityName - Название города
   * @param {string} fromCity - Откуда (по умолчанию Москва)
   * @returns {Promise<number|null>} - Расстояние в км
   */
  async function calculateDistance(cityName, fromCity = BASE_CITY) {
    if (!cityName) return null;
    
    const cacheKey = `dist_${fromCity}_${cityName}`.toLowerCase();
    const cached = distanceCache.get(cacheKey);
    if (cached) return cached;
    
    const fromCoords = await geocodeCity(fromCity);
    const toCoords = await geocodeCity(cityName);
    
    if (!fromCoords || !toCoords) {
      console.warn('Не удалось определить координаты:', fromCity, '->', cityName);
      return null;
    }
    
    // Расстояние по прямой × коэффициент 1.3 (дороги)
    const directDist = haversineDistance(fromCoords[0], fromCoords[1], toCoords[0], toCoords[1]);
    const roadDist = Math.round(directDist * 1.3);
    
    distanceCache.set(cacheKey, roadDist);
    return roadDist;
  }
  
  /**
   * Открыть модальное окно для расчёта расстояния
   */
  async function openDistanceCalculator(onSelect) {
    const { showModal, closeModal, $, toast } = AsgardUI;
    
    // Загружаем настройки базового города
    let baseCity = BASE_CITY;
    try {
      const settings = await AsgardDB.get('settings', 'base_city');
      if (settings?.value) baseCity = settings.value;
    } catch(e) {}
    
    const html = `
      <div class="stack" style="gap:16px">
        <div class="formrow">
          <div>
            <label>Откуда (база)</label>
            <input class="inp" id="dist_from" value="${baseCity}" placeholder="Москва"/>
          </div>
          <div>
            <label>Куда (объект)</label>
            <input class="inp" id="dist_to" placeholder="Введите город..." autofocus/>
          </div>
        </div>
        
        <div id="dist_result" style="display:none" class="card" style="padding:16px;text-align:center">
          <div class="muted">Расстояние</div>
          <div style="font-size:2em;font-weight:700" id="dist_km">—</div>
          <div class="muted">км (в одну сторону)</div>
        </div>
        
        <div class="row" style="gap:10px">
          <button class="btn" id="btn_calc_dist">📍 Рассчитать</button>
          <button class="btn primary" id="btn_use_dist" disabled>✅ Использовать</button>
        </div>
        
        <div class="help">
          Расстояние рассчитывается по прямой с коэффициентом 1.3 для автодорог.
          Для точного расчёта используйте OpenStreetMap.
        </div>
      </div>
    `;
    
    let calculatedDist = null;
    
    showModal({
      title: '📍 Расчёт расстояния',
      html,
      onMount: () => {
        $('#btn_calc_dist').addEventListener('click', async () => {
          const from = $('#dist_from').value.trim();
          const to = $('#dist_to').value.trim();
          
          if (!to) {
            toast('Ошибка', 'Введите город назначения', 'err');
            return;
          }
          
          $('#btn_calc_dist').disabled = true;
          $('#btn_calc_dist').textContent = '⏳ Расчёт...';
          
          const dist = await calculateDistance(to, from);
          
          $('#btn_calc_dist').disabled = false;
          $('#btn_calc_dist').textContent = '📍 Рассчитать';
          
          if (dist) {
            calculatedDist = dist;
            $('#dist_result').style.display = 'block';
            $('#dist_km').textContent = dist.toLocaleString('ru-RU');
            $('#btn_use_dist').disabled = false;
          } else {
            toast('Ошибка', 'Не удалось определить расстояние. Проверьте название города.', 'err');
          }
        });
        
        $('#btn_use_dist').addEventListener('click', () => {
          if (calculatedDist && onSelect) {
            onSelect(calculatedDist, $('#dist_to').value.trim());
          }
          closeModal();
        });
        
        // Enter для расчёта
        $('#dist_to').addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            $('#btn_calc_dist').click();
          }
        });
      }
    });
  }

  // ============================================
  // СКОРИНГ КЛИЕНТОВ (СВЕТОФОР)
  // ============================================
  
  /**
   * Расчёт конверсии клиента
   * @param {string} customerName - Название клиента
   * @returns {Promise<{rate: number, won: number, total: number, isNew: boolean}>}
   */
  async function getCustomerConversion(customerName) {
    if (!customerName) return { rate: 0, won: 0, total: 0, isNew: true };
    
    const tenders = await AsgardDB.all('tenders') || [];
    const nameLower = customerName.toLowerCase().trim();
    
    // Ищем тендеры этого клиента
    const customerTenders = tenders.filter(t => {
      const tName = (t.customer_name || t.customer || '').toLowerCase().trim();
      return tName === nameLower;
    });
    
    if (customerTenders.length === 0) {
      return { rate: 0, won: 0, total: 0, isNew: true };
    }
    
    // Считаем выигранные
    const wonStatuses = ['Выиграли', 'Контракт', 'В работе', 'Завершена', 'Клиент согласился'];
    const won = customerTenders.filter(t => wonStatuses.includes(t.tender_status)).length;
    const total = customerTenders.length;
    const rate = Math.round((won / total) * 100);
    
    return { rate, won, total, isNew: false };
  }
  
  /**
   * Полный скоринг клиента (комбинированный)
   * @param {string} customerName
   * @returns {Promise<{score: number, color: string, conversion: object, details: object}>}
   */
  async function getCustomerScore(customerName) {
    if (!customerName) {
      return { score: 0, color: 'gray', label: 'НД', conversion: null, details: null };
    }
    
    const conv = await getCustomerConversion(customerName);
    
    if (conv.isNew) {
      return { 
        score: 0, 
        color: 'gray', 
        label: 'НД',
        conversion: conv, 
        details: { isNew: true } 
      };
    }
    
    // Получаем дополнительные данные
    const works = await AsgardDB.all('works') || [];
    const tenders = await AsgardDB.all('tenders') || [];
    const nameLower = customerName.toLowerCase().trim();
    
    // Работы этого клиента
    const customerWorks = works.filter(w => {
      const wName = (w.customer_name || w.customer || '').toLowerCase().trim();
      return wName === nameLower;
    });
    
    // Тендеры
    const customerTenders = tenders.filter(t => {
      const tName = (t.customer_name || t.customer || '').toLowerCase().trim();
      return tName === nameLower;
    });
    
    // === Расчёт баллов ===
    
    // 1. Конверсия (40%)
    const convScore = Math.min(conv.rate, 100) * 0.4;
    
    // 2. Объём контрактов (25%) — до 100 баллов за 10+ млн
    const totalSum = customerWorks.reduce((s, w) => s + (parseFloat(w.contract_sum) || 0), 0);
    const sumScore = Math.min(totalSum / 10000000 * 100, 100) * 0.25;
    
    // 3. Частота (20%) — до 100 баллов за 10+ тендеров в год
    const now = new Date();
    const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    const recentTenders = customerTenders.filter(t => new Date(t.created_at) > yearAgo).length;
    const freqScore = Math.min(recentTenders / 10 * 100, 100) * 0.2;
    
    // 4. Свежесть (15%) — 100 баллов если работали за последний год
    const lastWork = customerWorks.sort((a, b) => 
      new Date(b.created_at) - new Date(a.created_at)
    )[0];
    const lastWorkDate = lastWork ? new Date(lastWork.created_at) : null;
    let freshScore = 0;
    if (lastWorkDate) {
      const daysSince = (now - lastWorkDate) / (1000 * 60 * 60 * 24);
      if (daysSince < 365) freshScore = 100;
      else if (daysSince < 730) freshScore = 50;
      else freshScore = 20;
    }
    freshScore *= 0.15;
    
    // Итоговый балл
    const score = Math.round(convScore + sumScore + freqScore + freshScore);
    
    // Цвет светофора
    let color, label;
    if (score >= 60) {
      color = 'green';
      label = '🟢';
    } else if (score >= 30) {
      color = 'yellow';
      label = '🟡';
    } else {
      color = 'red';
      label = '🔴';
    }
    
    return {
      score,
      color,
      label,
      conversion: conv,
      details: {
        convScore: Math.round(convScore / 0.4),
        sumScore: Math.round(sumScore / 0.25),
        freqScore: Math.round(freqScore / 0.2),
        freshScore: Math.round(freshScore / 0.15),
        totalSum,
        recentTenders,
        lastWorkDate
      }
    };
  }
  
  /**
   * Получить HTML-бейдж со светофором и процентом
   */
  function getScoreBadge(scoreData) {
    if (!scoreData || scoreData.conversion?.isNew) {
      return `<span class="badge" style="background:#6b7280;color:#fff" title="Новый клиент">НД</span>`;
    }
    
    const colors = {
      green: '#22c55e',
      yellow: '#f59e0b',
      red: '#ef4444',
      gray: '#6b7280'
    };
    
    const bgColor = colors[scoreData.color] || colors.gray;
    const conv = scoreData.conversion;
    const title = `Конверсия: ${conv.won}/${conv.total} (${conv.rate}%)\nОбщий балл: ${scoreData.score}/100`;
    
    return `<span class="badge" style="background:${bgColor};color:#fff" title="${title}">
      ${scoreData.label} ${conv.rate}%
    </span>`;
  }
  
  /**
   * Получить детальную карточку скоринга
   */
  function getScoreCard(scoreData, customerName) {
    if (!scoreData) return '';
    
    const conv = scoreData.conversion;
    const det = scoreData.details;
    
    if (conv?.isNew) {
      return `
        <div class="card" style="padding:12px;border-left:4px solid #6b7280">
          <div style="font-weight:600">⚪ ${customerName || 'Клиент'}</div>
          <div class="muted">Новый клиент — нет истории</div>
        </div>
      `;
    }
    
    const colors = { green: '#22c55e', yellow: '#f59e0b', red: '#ef4444' };
    const borderColor = colors[scoreData.color] || '#6b7280';
    
    return `
      <div class="card" style="padding:12px;border-left:4px solid ${borderColor}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-weight:600">${scoreData.label} ${customerName || 'Клиент'}</div>
          <div style="font-size:1.5em;font-weight:700">${conv.rate}%</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;font-size:0.9em">
          <div><span class="muted">Тендеров:</span> ${conv.total}</div>
          <div><span class="muted">Выиграно:</span> ${conv.won}</div>
          <div><span class="muted">Сумма:</span> ${(det?.totalSum || 0).toLocaleString('ru-RU')} ₽</div>
          <div><span class="muted">За год:</span> ${det?.recentTenders || 0} заявок</div>
        </div>
        <div style="margin-top:8px;font-size:0.85em" class="muted">
          Общий балл: ${scoreData.score}/100
        </div>
      </div>
    `;
  }

  return {
    // Nominatim/OSM
    geocodeCity,
    calculateDistance,
    openDistanceCalculator,
    haversineDistance,
    
    // Скоринг
    getCustomerConversion,
    getCustomerScore,
    getScoreBadge,
    getScoreCard,
    
    // Константы
    BASE_CITY,
    BASE_COORDS
  };
})();
