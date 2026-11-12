/**
 * Замер скорости ДО НАШЕГО сервера.
 *
 * Зачем отдельно от Speedtest: сторонние сервисы меряют до своих дата-центров,
 * и цифра не имеет отношения к нашей конференции. Здесь важна одна величина —
 * сколько реально проходит между телевизором и asgard-crm.ru.
 *
 * Приём: качаем файл с нашего домена параллельно в 4 потока. Один файл мал
 * (937 КБ), на быстром канале он кончается за доли секунды, и замер получается
 * шумным. Параллельные потоки держат канал загруженным всё окно замера.
 */
import { API_BASE } from './api';

const DL_PATH = '/assets/img/ting-brand/ting-mark-v3-1024.png';

/** Некэшируемый параметр: иначе второй поток возьмёт ответ из кеша. */
function bust(tag) {
  return '?cb=' + Date.now() + '-' + tag + '-' + Math.random().toString(36).slice(2, 8);
}

async function oneDownload(tag, stopAt) {
  const url = API_BASE + DL_PATH + bust(tag);
  let bytes = 0;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: controller ? controller.signal : undefined,
    });
    if (!res.ok) return 0;
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.length) bytes += value.length;
        if (Date.now() >= stopAt) {
          try { await reader.cancel(); } catch (_) {}
          break;
        }
      }
    } else {
      const buf = await res.arrayBuffer();
      bytes += buf.byteLength;
    }
  } catch (_) {
    /* обрыв на дедлайне — нормально */
  }
  return bytes;
}

/**
 * Замер приёма. Несколько потоков держат канал занятым всё окно.
 * @returns {{mbps:number, bytes:number, seconds:number}}
 */
export async function measureDownload(durationMs = 6000, streams = 4) {
  const started = Date.now();
  const stopAt = started + durationMs;
  const parts = await Promise.all(
    Array.from({ length: streams }, (_, i) => oneDownload('s' + i, stopAt)),
  );
  const bytes = parts.reduce((a, b) => a + b, 0);
  const sec = Math.max(0.3, (Date.now() - started) / 1000);
  return { mbps: (bytes * 8) / sec / 1e6, bytes, seconds: sec };
}

/**
 * Замер отдачи. Отправляем на публичный client-log: сервер сохраняет только
 * разрешённые поля и игнорирует неизвестное тело, но байты обязан принять.
 * Шлём пачками, пока не выйдет окно замера.
 */
export async function measureUpload(code, durationMs = 6000) {
  const url = API_BASE + '/api/thing/public/' + encodeURIComponent(code) + '/client-log';
  const chunk = new Uint8Array(256 * 1024);
  /* Не нули: часть прокси сжимает однородные данные и замер врёт в плюс.
     Маска & 0xff намеренная — это генерация байта, а не работа с флагами. */
  // eslint-disable-next-line no-bitwise
  for (let i = 0; i < chunk.length; i++) chunk[i] = (i * 37 + 11) & 0xff;

  const started = Date.now();
  let bytes = 0;
  while (Date.now() - started < durationMs) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: chunk,
      });
      bytes += chunk.length;
    } catch (_) {
      break;
    }
  }
  const sec = Math.max(0.3, (Date.now() - started) / 1000);
  return { mbps: (bytes * 8) / sec / 1e6, bytes, seconds: sec };
}

/**
 * Оценка «потянет ли зал».
 *
 * Ориентир — профиль публикации: 720p ≈ 1.7 Мбит/с (из livekit presets).
 * На приём считаем по числу собеседников плюс 30% на служебный трафик.
 * Это порог, после которого начинаются очереди кадров, а не точная формула.
 */
export function verdict({ down, up, viewers }) {
  const n = Math.max(1, viewers);
  const needDown = 1.7 * n * 1.3;
  const needUp = 1.7 * 1.3;

  let level = 'ok';
  let text = 'Канал тянет зал';

  if (!up || up < needUp) {
    level = 'bad';
    text = 'Исходящей полосы не хватает на публикацию 720p';
  } else if (!down || down < needDown * 0.5) {
    level = 'bad';
    text = 'Приём сильно слабее нужного на ' + n + ' собеседников';
  } else if (down < needDown) {
    level = 'warn';
    text = 'Приём ниже расчётного на ' + n + ' собеседников — будет мягче картинка';
  }
  return { level, text, needDown, needUp };
}
