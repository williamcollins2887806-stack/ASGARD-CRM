'use strict';

/**
 * ASGARD CRM — archiveExtractor
 * ═══════════════════════════════════════════════════════════════
 *
 * Распаковка архивов ZIP / RAR / 7Z / TAR(.gz|.bz2) с понятными ошибками для UI.
 *
 * Использование (асинхронное, не блокирует event loop):
 *   const result = await extractArchive('/tmp/x.rar', 'docs.rar', '/tmp/out/');
 *   if (!result.ok) {
 *     // result.error = { code, message, hint }
 *   } else {
 *     // result.files = [{relPath, absPath, size, type, isJunk}]
 *   }
 *
 * Зависимости: системные CLI (unrar, 7z, tar) + adm-zip (npm).
 * На сервере должны быть установлены: unrar, p7zip-full, p7zip-rar.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ARCHIVE_EXT = ['.zip', '.rar', '.7z', '.tar', '.tar.gz', '.tgz', '.tar.bz2', '.gz', '.bz2', '.jar'];
const ARCHIVE_MIME = [
  'application/zip', 'application/x-zip-compressed',
  'application/x-rar-compressed', 'application/vnd.rar',
  'application/x-7z-compressed',
  'application/x-tar', 'application/gzip', 'application/x-bzip2'
];

const JUNK_PATTERNS = [
  /^thumbs\.db$/i, /^\.ds_store$/i, /^desktop\.ini$/i,
  /^__macosx/i, /^\._/, // macOS metadata
  /\.tmp$/i, /~\$/, // Office lockfiles
];

const MAX_FILES = 500;          // максимум файлов в одном архиве
const MAX_TOTAL_SIZE = 2 * 1024 * 1024 * 1024; // 2 ГБ после распаковки (zip-бомба защита)
const MAX_DEPTH = 3;            // вложенные архивы
const EXTRACT_TIMEOUT_MS = 120000; // 2 мин на распаковку

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function isArchive(filename, mimeType) {
  if (mimeType && ARCHIVE_MIME.includes(mimeType)) return true;
  const lower = (filename || '').toLowerCase();
  return ARCHIVE_EXT.some(e => lower.endsWith(e));
}

function isJunk(filename) {
  const base = path.basename(filename || '');
  return JUNK_PATTERNS.some(rx => rx.test(base));
}

function detectArchiveType(filename) {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.zip') || lower.endsWith('.jar')) return 'zip';
  if (lower.endsWith('.rar')) return 'rar';
  if (lower.endsWith('.7z')) return '7z';
  if (lower.endsWith('.tar') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz')
      || lower.endsWith('.tar.bz2') || lower.endsWith('.gz') || lower.endsWith('.bz2')) return 'tar';
  return null;
}

function err(code, message, hint = '') {
  return { ok: false, files: [], error: { code, message, hint } };
}

function listFilesRecursive(dir, base = dir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue; // safety: не следуем за симлинками
    if (e.isDirectory()) {
      out.push(...listFilesRecursive(abs, base));
    } else if (e.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

// Async wrapper для child_process.spawn — собирает stdout/stderr, ловит таймаут.
function runCmd(cmd, args, { timeout = EXTRACT_TIMEOUT_MS, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = '', stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try { child.kill('SIGKILL'); } catch (_) {}
    }, timeout);
    child.stdout && child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr && child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + '\n' + e.message, killed, spawnErr: true });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, killed, spawnErr: false });
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Распознавание ошибок CLI-инструментов
// ──────────────────────────────────────────────────────────────────────────────

function classifyUnrarError(stderr, stdout) {
  const combined = (stderr + ' ' + stdout).toLowerCase();
  if (combined.includes('encrypted') || combined.includes('password') || combined.includes('зашифр')) {
    return err('PASSWORD_PROTECTED',
      'Архив защищён паролем',
      'Распакуйте архив локально на компьютере и загрузите файлы по отдельности');
  }
  if (combined.includes('corrupt') || combined.includes('crc failed') || combined.includes('checksum')) {
    return err('CORRUPTED',
      'Архив повреждён или контрольная сумма не совпала',
      'Попросите отправителя перепаковать архив. Если архив очень старый — попробуйте перепаковать локально в ZIP');
  }
  if (combined.includes('unknown') || combined.includes('not rar archive')) {
    return err('UNSUPPORTED_FORMAT',
      'Файл не является RAR-архивом или формат не поддерживается',
      'Убедитесь что файл — настоящий RAR. Иногда .rar — это переименованный ZIP/7Z. Попробуйте перепаковать');
  }
  return err('EXTRACT_FAILED',
    'Не удалось распаковать RAR',
    `Тех. деталь: ${(stderr || stdout || '').slice(0, 200)}`);
}

function classify7zError(stderr, stdout) {
  const combined = (stderr + ' ' + stdout).toLowerCase();
  if (combined.includes('wrong password') || combined.includes('cannot open encrypted')) {
    return err('PASSWORD_PROTECTED',
      'Архив защищён паролем',
      'Распакуйте архив локально на компьютере и загрузите файлы по отдельности');
  }
  if (combined.includes('data error') || combined.includes('crc')) {
    return err('CORRUPTED',
      'Архив повреждён',
      'Попросите отправителя перепаковать. Можно попробовать ZIP вместо 7Z');
  }
  return err('EXTRACT_FAILED',
    'Не удалось распаковать 7Z-архив',
    `Тех. деталь: ${(stderr || stdout || '').slice(0, 200)}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Основной API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Распаковать архив в targetDir. Возвращает {ok, files[], error?}
 *
 * @param {string} archivePath абсолютный путь к архиву
 * @param {string} filename оригинальное имя (для определения типа)
 * @param {string} targetDir куда распаковывать (уже должна существовать)
 * @param {object} opts { maxFiles, maxTotalSize, recursive }
 */
async function extractArchive(archivePath, filename, targetDir, opts = {}) {
  const type = detectArchiveType(filename);
  if (!type) {
    return err('NOT_ARCHIVE',
      'Это не архив',
      'Загрузите файл напрямую как документ (кнопка «📎 Файл»)');
  }

  // Проверить размер архива (читаем stat)
  let archiveSize = 0;
  try { archiveSize = fs.statSync(archivePath).size; } catch (_) {}
  if (archiveSize === 0) {
    return err('EMPTY_FILE', 'Файл пустой', 'Проверьте что архив скачался полностью');
  }

  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch (e) {
    return err('IO_ERROR', 'Не удалось создать папку для распаковки', `Свяжитесь с админом: ${e.message}`);
  }

  // Запуск распаковки
  let result;
  if (type === 'zip') {
    try {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(archivePath);

      // Проверка на защищённый паролем ZIP (adm-zip не умеет с паролем —
      // entries будут видны, но extractAllTo упадёт). Лучше проверить заранее.
      const entries = zip.getEntries();
      const encrypted = entries.find(e => e.header && e.header.encrypted);
      if (encrypted) {
        return err('PASSWORD_PROTECTED',
          'ZIP-архив защищён паролем',
          'Распакуйте локально и загрузите файлы по отдельности');
      }
      zip.extractAllTo(targetDir, /* overwrite */ true);
    } catch (e) {
      const msg = String(e.message || '').toLowerCase();
      if (msg.includes('invalid') || msg.includes('not a zip')) {
        return err('UNSUPPORTED_FORMAT',
          'Файл не является ZIP-архивом',
          'Возможно файл повреждён. Попросите отправителя перепаковать');
      }
      if (msg.includes('encrypt') || msg.includes('password')) {
        return err('PASSWORD_PROTECTED',
          'ZIP защищён паролем',
          'Распакуйте локально и загрузите файлы по отдельности');
      }
      return err('EXTRACT_FAILED', 'Не удалось распаковать ZIP',
        `Тех. деталь: ${e.message.slice(0, 200)}`);
    }
  } else if (type === 'rar') {
    result = await runCmd('unrar', ['x', '-o+', '-y', '-p-', archivePath, targetDir + path.sep]);
    if (result.spawnErr || result.code === 127 || (result.stderr || '').includes('not found')) {
      return err('NO_TOOL',
        'На сервере не установлен unrar',
        'Свяжитесь с админом: apt install unrar p7zip-rar');
    }
    if (result.killed) {
      return err('TIMEOUT', 'Распаковка заняла больше 2 минут',
        'Архив слишком большой или повреждён');
    }
    if (result.code !== 0) {
      return classifyUnrarError(result.stderr || '', result.stdout || '');
    }
  } else if (type === '7z') {
    // -p- = пустой пароль (чтобы 7z не зависал в ожидании ввода)
    result = await runCmd('7z', ['x', '-y', '-p-', `-o${targetDir}`, archivePath]);
    if (result.spawnErr || result.code === 127) {
      return err('NO_TOOL',
        'На сервере не установлен 7z',
        'Свяжитесь с админом: apt install p7zip-full p7zip-rar');
    }
    if (result.killed) {
      return err('TIMEOUT', 'Распаковка заняла больше 2 минут',
        'Архив слишком большой или повреждён');
    }
    if (result.code !== 0) {
      return classify7zError(result.stderr || '', result.stdout || '');
    }
  } else if (type === 'tar') {
    result = await runCmd('tar', ['xf', archivePath, '-C', targetDir]);
    if (result.spawnErr) {
      return err('NO_TOOL', 'tar недоступен', 'Свяжитесь с админом');
    }
    if (result.killed) {
      return err('TIMEOUT', 'Распаковка слишком долгая', 'Файл слишком большой');
    }
    if (result.code !== 0) {
      return err('EXTRACT_FAILED', 'Не удалось распаковать TAR-архив',
        `Тех. деталь: ${(result.stderr || '').slice(0, 200)}`);
    }
  }

  // Собираем извлечённые файлы
  const absFiles = listFilesRecursive(targetDir);
  if (absFiles.length === 0) {
    return err('EMPTY', 'Архив пустой — нет файлов внутри',
      'Проверьте что архив правильно собран');
  }
  if (absFiles.length > (opts.maxFiles || MAX_FILES)) {
    return err('TOO_MANY',
      `В архиве ${absFiles.length} файлов — это превышает лимит ${opts.maxFiles || MAX_FILES}`,
      'Разделите архив на несколько частей или загрузите файлы по отдельности');
  }

  // Проверка суммарного размера (защита от zip-бомб)
  let totalSize = 0;
  const items = [];
  for (const abs of absFiles) {
    let size = 0;
    try { size = fs.statSync(abs).size; } catch (_) {}
    totalSize += size;
    if (totalSize > (opts.maxTotalSize || MAX_TOTAL_SIZE)) {
      return err('BOMB',
        'Распакованный размер превышает 2 ГБ — подозрение на zip-бомбу',
        'Архив очень большой. Проверьте содержимое локально');
    }
    const relPath = path.relative(targetDir, abs).replace(/\\/g, '/');
    items.push({
      relPath,
      absPath: abs,
      size,
      type: detectFileType(relPath),
      isJunk: isJunk(path.basename(relPath))
    });
  }

  return { ok: true, files: items, totalSize, archiveType: type };
}

function detectFileType(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (/\.(doc|docx|rtf|odt)$/i.test(lower)) return 'doc';
  if (/\.(xls|xlsx|ods|csv)$/i.test(lower)) return 'xls';
  if (/\.(ppt|pptx|odp)$/i.test(lower)) return 'ppt';
  if (/\.(jpe?g|png|gif|bmp|webp|tiff?)$/i.test(lower)) return 'image';
  if (/\.(dwg|dxf)$/i.test(lower)) return 'drawing';
  if (/\.(txt|md|log)$/i.test(lower)) return 'text';
  if (/\.(zip|rar|7z|tar|gz|bz2)$/i.test(lower)) return 'archive';
  return 'other';
}

module.exports = {
  isArchive,
  isJunk,
  detectArchiveType,
  detectFileType,
  extractArchive,
  // константы для UI/валидации
  MAX_FILES,
  MAX_TOTAL_SIZE,
  ARCHIVE_EXT
};
