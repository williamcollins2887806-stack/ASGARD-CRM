// ASGARD CRM Service Worker
// Stage 20: PWA + Stage 22: Offline

const CACHE_NAME = 'asgard-crm-v19';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/css/app.css',
  './assets/img/logo.png',
  './assets/img/asgard_logo.png',
  './assets/img/asgard_emblem.png',
  './assets/img/watermark.svg',
  './assets/img/watermark_dark.svg'
];

// JS файлы для кэширования
const JS_ASSETS = [
  './assets/js/db.js',
  './assets/js/auth.js',
  './assets/js/ui.js',
  './assets/js/router.js',
  './assets/js/seed.js',
  './assets/js/app.js',
  './assets/js/charts.js',
  './assets/js/tenders.js',
  './assets/js/pm_calcs.js',
  './assets/js/pm_works.js',
  './assets/js/all_works.js',
  './assets/js/all_estimates.js',
  './assets/js/finances.js',
  './assets/js/approvals.js',
  './assets/js/alerts.js',
  './assets/js/birthdays.js',
  './assets/js/personnel.js',
  './assets/js/employee.js',
  './assets/js/customers.js',
  './assets/js/settings.js',
  './assets/js/backup.js',
  './assets/js/gantt.js',
  './assets/js/gantt_full.js',
  './assets/js/calc_cities.js',
  './assets/js/calc_norms.js',
  './assets/js/calc_equipment.js',
  './assets/js/calculator_v2.js',
  './assets/js/calculator.js',
  './assets/js/templates.js',
  './assets/js/docs_pack.js',
  './assets/js/kpi_works.js',
  './assets/js/kpi_money.js',
  './assets/js/sla.js',
  './assets/js/booking.js',
  './assets/js/hr_requests.js',
  './assets/js/hr_rating.js',
  './assets/js/staff_schedule.js',
  './assets/js/office_schedule.js',
  './assets/js/proc_requests.js',
  './assets/js/buh_registry.js',
  './assets/js/work_expenses.js',
  './assets/js/office_expenses.js',
  './assets/js/correspondence.js',
  './assets/js/proxies.js',
  './assets/js/travel.js',
  './assets/js/user_requests.js',
  './assets/js/dashboard.js',
  './assets/js/pm_consents.js',
  './assets/js/confirm.js',
  './assets/js/validate.js',
  './assets/js/diag.js',
  './assets/js/safe_mode.js',
  './assets/js/theme.js',
  './assets/js/build_info.js'
];

// Иконки навигации
const ICON_ASSETS = [
  './assets/icons/nav/home.svg',
  './assets/icons/nav/tenders.svg',
  './assets/icons/nav/pmcalcs.svg',
  './assets/icons/nav/pmworks.svg',
  './assets/icons/nav/allworks.svg',
  './assets/icons/nav/allestimates.svg',
  './assets/icons/nav/finances.svg',
  './assets/icons/nav/approvals.svg',
  './assets/icons/nav/alerts.svg',
  './assets/icons/nav/birthdays.svg',
  './assets/icons/nav/workers.svg',
  './assets/icons/nav/customers.svg',
  './assets/icons/nav/settings.svg',
  './assets/icons/nav/backup.svg',
  './assets/icons/nav/ganttworks.svg',
  './assets/icons/nav/ganttcalcs.svg',
  './assets/icons/nav/kpiworks.svg',
  './assets/icons/nav/kpimoney.svg',
  './assets/icons/nav/rating.svg',
  './assets/icons/nav/office.svg',
  './assets/icons/nav/buh.svg',
  './assets/icons/nav/diag.svg'
];

const ALL_ASSETS = [...STATIC_ASSETS, ...JS_ASSETS, ...ICON_ASSETS];

// Установка SW
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching assets...');
        return cache.addAll(ALL_ASSETS);
      })
      .then(() => {
        console.log('[SW] Install complete');
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[SW] Install failed:', err);
      })
  );
});

// Активация SW - очистка старых кэшей
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Activated');
        return self.clients.claim();
      })
  );
});

// Стратегия: Cache First, затем Network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Только GET запросы
  if (event.request.method !== 'GET') return;
  
  // Игнорируем внешние запросы
  if (url.origin !== location.origin) return;
  
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Возвращаем из кэша, но обновляем в фоне
          fetchAndCache(event.request);
          return cachedResponse;
        }
        
        // Нет в кэше - идём в сеть
        return fetchAndCache(event.request);
      })
      .catch(() => {
        // Офлайн и нет в кэше - возвращаем fallback для HTML
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503 });
      })
  );
});

// Загрузка и кэширование
async function fetchAndCache(request) {
  try {
    const response = await fetch(request);
    
    // Кэшируем только успешные ответы
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (err) {
    // Сеть недоступна
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

// Сообщения от клиента
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  
  if (event.data === 'getVersion') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

console.log('[SW] Service Worker loaded');
