'use strict';

const path = require('path');
const fs = require('fs');

const TT_NOISE = /TT:\s*undefined function/i;

function resolveFontDir() {
  const winFonts = process.env.WINDIR
    ? path.join(process.env.WINDIR, 'Fonts')
    : 'C:\\Windows\\Fonts';
  const dirs = [
    path.join(process.cwd(), 'public', 'assets', 'fonts'),
    path.join(__dirname, '..', '..', 'public', 'assets', 'fonts'),
    '/usr/share/fonts/truetype/dejavu',
    winFonts
  ];
  for (const dir of dirs) {
    if (fs.existsSync(path.join(dir, 'DejaVuSans.ttf'))) return { dir, regular: 'DejaVuSans.ttf', bold: 'DejaVuSans-Bold.ttf' };
    if (fs.existsSync(path.join(dir, 'arial.ttf'))) return { dir, regular: 'arial.ttf', bold: 'arialbd.ttf' };
    if (fs.existsSync(path.join(dir, 'Arial.ttf'))) return { dir, regular: 'Arial.ttf', bold: 'Arialbd.ttf' };
  }
  return null;
}

/**
 * Регистрация DejaVuSans для pdfkit + подавление шумных предупреждений fontkit
 * («TT: undefined function: 32» — не влияет на рендер, засоряет journalctl).
 *
 * @returns {{ regular: string, bold: string, ok: boolean }}
 */
function registerDejaVuFonts(doc, { regularName = 'Regular', boldName = 'Bold' } = {}) {
  const found = resolveFontDir();
  let regularPath;
  let boldPath;

  if (found) {
    regularPath = path.join(found.dir, found.regular);
    boldPath = path.join(found.dir, found.bold);
    if (!fs.existsSync(regularPath)) regularPath = null;
    if (!fs.existsSync(boldPath)) boldPath = null;
  }

  const origWarn = console.warn;
  console.warn = (...args) => {
    const msg = args.map(String).join(' ');
    if (TT_NOISE.test(msg)) return;
    origWarn.apply(console, args);
  };

  try {
    if (regularPath) doc.registerFont(regularName, regularPath);
    if (boldPath) doc.registerFont(boldName, boldPath);
  } finally {
    console.warn = origWarn;
  }

  const ok = !!regularPath;
  return {
    ok,
    regular: ok ? regularName : 'Helvetica',
    bold: boldPath ? boldName : (ok ? regularName : 'Helvetica-Bold'),
  };
}

module.exports = { registerDejaVuFonts, resolveFontDir };
