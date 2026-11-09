/**
 * Негативный контроль для scan-undefined.mjs.
 *
 * Гейт обязан ЛОВИТЬ обращение к необъявленной переменной внутри компонента,
 * даже если такое имя объявлено в другом компоненте того же файла. Именно этот
 * случай (detail в TenderTabs vs detail в родителе) давал «чёрный экран» и
 * ложный PASS старой версии.
 *
 * Запуск: node tools/scan-undefined.selftest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const scanner = path.join(here, 'scan-undefined.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scanundef-'));

const BAD = `
import { useState } from 'react';

export default function Page() {
  const [detail, setDetail] = useState(null);
  return <TenderTabs d={detail} />;
}

function TenderTabs({ d, tab }) {
  const rj = detail?.rp_review?.report_json || {};
  return <div>{String(Object.keys(rj).length)}</div>;
}
`;

const GOOD = `
import { useState } from 'react';

export default function Page() {
  const [detail, setDetail] = useState(null);
  return <TenderTabs d={detail} />;
}

function TenderTabs({ d, tab }) {
  const rj = d?.rp_review?.report_json || {};
  return <div>{String(Object.keys(rj).length)}</div>;
}
`;

function run(dir) {
  try {
    const out = execFileSync(process.execPath, [scanner, dir], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status || 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

let fails = 0;

fs.writeFileSync(path.join(tmp, 'bad.jsx'), BAD);
const bad = run(tmp);
if (bad.code === 0) {
  console.log('FAIL гейт пропустил необъявленный detail');
  fails += 1;
} else {
  console.log('PASS гейт поймал необъявленный detail');
}

fs.rmSync(path.join(tmp, 'bad.jsx'));
fs.writeFileSync(path.join(tmp, 'good.jsx'), GOOD);
const good = run(tmp);
if (good.code !== 0) {
  console.log('FAIL гейт ругается на корректный код:\n' + good.out);
  fails += 1;
} else {
  console.log('PASS корректный код проходит');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\nитог: ${fails} FAIL` : '\nитог: 2 PASS, 0 FAIL');
process.exit(fails ? 1 : 0);
