#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Деплой: универсальный шаблон полного КП (шапка таблицы стоимости).

Содержимое (17.09.2026):
  * `templates/full-kp-nika-tpl.docx` — шапка таблицы стоимости стала
    параметрической: вместо литералов «СТОИМОСТЬ РАБОТ ПО АППАРАТАМ» /
    «Оборудование» / «Инвентарный №» / «Расчётные данные по трубкам» —
    плейсхолдеры {tbl_title}, {tbl_col1..5}, {tbl_transport_label}.
  * `src/services/tkp-full-kp.js` — TABLE_LABELS_DEFAULT + resolveTableLabels():
    дефолтный текст шапки задаёт код, конкретное ТКП может переопределить его
    через items.full.table_labels. Вилка `template_kind` убрана: один шаблон
    на все предметы (промывка сети, чистка аппаратов, монтаж).
  * `public/assets/js/tkp-full-form.js` — vanilla-форма полного КП:
    подписи полей/кнопок под универсальную шапку + проброс table_labels.
  * Shell: 20.28.35 → 20.28.36 (нужен, чтобы браузер перечитал
    `tkp-full-form.js?v=` — файл отдаётся с ?v= оболочки).

ВАЖНО: фронт везём ЯВНЫМ списком, а не через `restore_asset_sync.apply_plan`.
В том же worktree работает параллельная сессия (D-179..D-181), её файлы
(`asgard_smeta.js`, `src/services/asgard-smeta.js`) заливать нельзя —
правило «один worktree — один агент». shell_guard вызывается явно в pre-flight.

Запуск: python tools/deploy_tkp_universal_20_28_36.py
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
import tarfile
import tempfile
import time
import zipfile
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
sys.path.insert(0, str(TOOLS))

import shell_guard  # noqa: E402

VER = "20.28.36"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
TKP_ID = "3042"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-tkp-universal-{STAMP}.tgz"

# ЯВНЫЙ список — только файлы этой задачи.
FILES = [
    "templates/full-kp-nika-tpl.docx",
    "src/services/tkp-full-kp.js",
    "public/assets/js/tkp-full-form.js",
    "public/index.html",
    "public/sw.js",
]

# Маркеры: если на диске не тот код, что мы проверяли, — падаем ДО заливки.
MARKERS = [
    ("src/services/tkp-full-kp.js", "resolveTableLabels"),
    ("src/services/tkp-full-kp.js", "TABLE_LABELS_DEFAULT"),
    ("src/services/tkp-full-kp.js", "tbl_transport_label"),
    ("public/assets/js/tkp-full-form.js", "table_labels"),
    ("public/assets/js/tkp-full-form.js", "Стоимость работ и затрат"),
    ("public/index.html", VER),
    ("public/sw.js", VER),
]

SMOKE_GREPS = [
    ("src/services/tkp-full-kp.js", "resolveTableLabels"),
    ("public/assets/js/tkp-full-form.js", "table_labels"),
    ("public/index.html", VER),
]

# Рантайм-проверка НА ПРОДЕ: сервис обязан отрендерить docx по реальному ТКП 3042
# и напечатать НОВУЮ шапку, суммы из payload и ни одной внутренней цифры.
RUNTIME_JS = r"""
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
process.env.DB_USER = process.env.DB_USER || 'asgard';
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm';
const db = require('/var/www/asgard-crm/src/services/db');
const svc = require('/var/www/asgard-crm/src/services/tkp-full-kp.js');
const PizZip = require('/var/www/asgard-crm/node_modules/pizzip');

(async () => {
  const { rows: [tkp] } = await db.query('SELECT * FROM tkp WHERE id = $1', [Number(process.argv[2] || 0)]);
  if (!tkp) { console.log('FAIL: ТКП не найден'); process.exit(1); }
  const buf = svc.generateFullKpDocxBuffer(tkp, {});
  const xml = new PizZip(buf).file('word/document.xml').asText();
  const texts = [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join('')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\u00a0/g, ' ');

  const NEW = ['Стоимость работ и затрат', 'Наименование', 'Ед. изм.',
               'Объём и расчётные данные', 'Кол-во', 'Сумма без НДС, руб.'];
  const OLD = ['ПО АППАРАТАМ', 'Инвентарный', 'трубкам', 'Расчётные данные по трубкам'];
  const MONEY = ['8 510 000,00', '1 872 200,00', '10 382 200,00', '600 000,00', '5 191 100,00'];
  const LEAK = ['себестоимост', 'прибыл', '4 157 080', '25 000'];

  const bad = [];
  console.log('docx: ' + buf.length + ' Б, текста: ' + texts.length + ' симв.');
  console.log('--- новые маркеры шапки (должны быть) ---');
  for (const s of NEW) {
    const ok = texts.includes(s);
    console.log((ok ? 'OK   ' : 'FAIL ') + s);
    if (!ok) bad.push('new:' + s);
  }
  console.log('--- старые маркеры (должны исчезнуть) ---');
  for (const s of OLD) {
    const ok = !texts.includes(s);
    console.log((ok ? 'OK   ' : 'FAIL ') + s);
    if (!ok) bad.push('old:' + s);
  }
  console.log('--- суммы из payload ---');
  for (const s of MONEY) {
    const ok = texts.includes(s);
    console.log((ok ? 'OK   ' : 'FAIL ') + s);
    if (!ok) bad.push('money:' + s);
  }
  console.log('--- внутренние цифры (должны отсутствовать) ---');
  for (const s of LEAK) {
    const ok = !texts.includes(s);
    console.log((ok ? 'ok   ' : '*** УТЕЧКА *** ') + s);
    if (!ok) bad.push('leak:' + s);
  }
  const left = texts.includes('{tbl_') || texts.includes('{apparatus');
  console.log('--- плейсхолдеры ---');
  console.log((left ? 'FAIL остались нераскрытые плейсхолдеры' : 'OK   нераскрытых плейсхолдеров нет'));
  if (left) bad.push('placeholders');
  console.log(bad.length ? 'RUNTIME_FAIL ' + bad.join(' | ') : 'RUNTIME_OK');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.log('FATAL: ' + e.message); process.exit(1); });
"""

EXPECT_RUNTIME = "RUNTIME_OK"


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    print(f"$ {' '.join(cmd[:6])}{' ...' if len(cmd) > 6 else ''}")
    p = subprocess.run(cmd, cwd=str(cwd) if cwd else None, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if p.stdout.strip():
        print(p.stdout[-6000:])
    if p.stderr.strip():
        print("STDERR:", p.stderr[-2000:])
    if check and p.returncode != 0:
        raise SystemExit(f"FAIL ({p.returncode}): {' '.join(cmd[:4])}")
    return p


def ssh(remote: str) -> subprocess.CompletedProcess:
    """SSH с ретраями: канал до прода рвётся нестабильно (banner exchange timeout)."""
    for attempt in range(1, 5):
        p = run(["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
                 "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", SSH_HOST, remote],
                check=False)
        if p.returncode == 0:
            return p
        print(f"  [ssh] попытка {attempt}/4 не удалась (rc={p.returncode}), повтор...")
        time.sleep(5)
    raise SystemExit(f"SSH не прошёл за 4 попытки: {remote[:80]}")


def scp_retry(local: str, remote: str) -> None:
    """scp с ретраями (тот же нестабильный канал)."""
    for attempt in range(1, 5):
        p = run(["scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
                 "-o", "ServerAliveInterval=15", local, f"{SSH_HOST}:{remote}"], check=False)
        if p.returncode == 0:
            return
        print(f"  [scp] попытка {attempt}/4 не удалась (rc={p.returncode}), повтор...")
        time.sleep(5)
    raise SystemExit(f"scp не прошёл за 4 попытки: {remote}")


def check_template_placeholders() -> None:
    """Шаблон — бинарник; проверяем, что в его XML действительно плейсхолдеры."""
    tpl = ROOT / "templates" / "full-kp-nika-tpl.docx"
    with zipfile.ZipFile(tpl) as z:
        xml = z.read("word/document.xml").decode("utf-8", "replace")
    need = ["{tbl_title}", "{tbl_col1}", "{tbl_col2}", "{tbl_col3}", "{tbl_col4}", "{tbl_col5}",
            "{tbl_transport_label}"]
    missing = [n for n in need if n not in xml]
    if missing:
        raise SystemExit(f"в шаблоне нет плейсхолдеров: {missing}")
    old = [s for s in ("ПО АППАРАТАМ", "Инвентарный", "трубкам") if s in xml]
    if old:
        raise SystemExit(f"в шаблоне остались старые литералы шапки: {old}")
    print(f"шаблон: плейсхолдеры {len(need)}/{len(need)} на месте, старых литералов нет")


def main() -> None:
    print("=" * 78)
    print(f"DEPLOY «универсальная шапка полного КП» — shell {VER}, ТКП {TKP_ID}")
    print("=" * 78)

    # ── 0. pre-flight ──────────────────────────────────────────────────────
    print("\n=== 0. PRE-FLIGHT (shell_guard) ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK (оболочка валидна, HEAD == .last-verified)")

    missing = [f for f in FILES if not (ROOT / f).is_file()]
    if missing:
        raise SystemExit(f"нет файлов: {missing}")
    for rel, needle in MARKERS:
        text = (ROOT / rel).read_text(encoding="utf-8")
        if needle not in text:
            raise SystemExit(f"маркер отсутствует: {rel} :: {needle}")
    check_template_placeholders()
    print(f"маркеры: OK ({len(MARKERS)}/{len(MARKERS)}); файлов к заливке: {len(FILES)}")
    for f in FILES:
        print(f"   ~ {f}")

    # ── 1. снапшот на проде ────────────────────────────────────────────────
    print("\n=== 1. SNAPSHOT ===")
    ssh(f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP} "
        f"templates/full-kp-nika-tpl.docx src/services/tkp-full-kp.js "
        f"public/assets/js/tkp-full-form.js public/index.html public/sw.js "
        f"2>/dev/null; ls -lh {SNAP}")

    # ── 2. заливка ЯВНОГО списка: tar + scp + распаковка + md5-сверка ──────
    print("\n=== 2. UPLOAD (tar+scp, явный список) ===")
    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "tkp-universal.tgz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in FILES:
                tar.add(ROOT / rel, arcname=rel)
        print(f"tar: {len(FILES)} файлов, {tar_path.stat().st_size} Б")
        remote_tar = f"/tmp/asgard-tkp-universal-{STAMP}.tgz"
        scp_retry(str(tar_path), remote_tar)
    ssh(f"cd {PROJECT} && tar xzf {remote_tar} && rm -f {remote_tar} && echo EXTRACT_OK")

    print("\n--- md5 local vs prod ---")
    for rel in FILES:
        local = md5_file(ROOT / rel)
        res = ssh(f"md5sum {PROJECT}/{rel}")
        remote = (res.stdout or "").split()[0] if res.stdout.strip() else "?"
        ok = remote == local
        print(f"  {'OK  ' if ok else 'FAIL'} {rel}  local={local} prod={remote}")
        if not ok:
            raise SystemExit(f"md5 не совпал: {rel}")

    # ── 3. рантайм-проверка рендера КП НА ПРОДЕ ───────────────────────────
    print(f"\n=== 3. RUNTIME DOCX CHECK на проде (ТКП {TKP_ID}) ===")
    with tempfile.TemporaryDirectory() as tmp:
        js_path = Path(tmp) / "_tkp_docx_check.js"
        js_path.write_text(RUNTIME_JS, encoding="utf-8")
        scp_retry(str(js_path), "/tmp/_tkp_docx_check.js")
    res = ssh(f"mkdir -p /root/tkp-tmp && cd {PROJECT} && DB_PASSWORD=123456789 DB_USER=asgard "
              f"DB_NAME=asgard_crm node /tmp/_tkp_docx_check.js {TKP_ID}; rm -f /tmp/_tkp_docx_check.js")
    out = (res.stdout or "")
    if EXPECT_RUNTIME not in out:
        raise SystemExit(f"РАНТАЙМ НЕ СОШЁЛСЯ (нет {EXPECT_RUNTIME})")
    print("  OK  — прод-рендер печатает новую шапку, суммы и не течёт")

    # ── 4. сквозная проверка клиентским путём (HTTP API → docx) ───────────
    print("\n=== 4. E2E через API (то, что получит клиент) ===")
    probe = ROOT / "tools" / "tkp_full_docx_probe.js"
    if not probe.is_file():
        raise SystemExit(f"нет зонда: {probe}")
    ssh("mkdir -p /root/tkp-tmp")
    scp_retry(str(probe), "/root/tkp-tmp/tkp_full_docx_probe.js")
    res = run(["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
               SSH_HOST,
               f"cd /root/tkp-tmp && TKP_AUTHOR_LOGIN=n.androsov node tkp_full_docx_probe.js {TKP_ID}"],
              check=False)
    out = res.stdout or ""
    print(out)
    # PROBE_OK/PROBE_FAIL печатает сам зонд (в т.ч. на утечки и старые литералы шапки)
    if "PROBE_OK" not in out:
        raise SystemExit("E2E: клиентский docx не прошёл зонд (см. вывод выше)")

    # ── 5. рестарт + смоук ─────────────────────────────────────────────────
    print("\n=== 5. RESTART ===")
    ssh("systemctl restart asgard-crm && sleep 5 && systemctl is-active asgard-crm")

    print("\n=== 6. SMOKE ===")
    ssh("curl -s http://127.0.0.1:3000/api/version; echo; "
        "curl -s -o /dev/null -w 'home:%{http_code}\\n' https://asgard-crm.ru/; "
        f"grep -oP \"ASGARD_SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/index.html | head -1; "
        f"grep -oP \"SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/sw.js | head -1")

    print("--- маркеры в прод-файлах ---")
    for rel, needle in SMOKE_GREPS:
        res = ssh(f"grep -c {needle!r} {PROJECT}/{rel}")
        cnt = (res.stdout or "0").strip().splitlines()[-1] if res.stdout.strip() else "0"
        print(f"  {'OK  ' if cnt not in ('', '0') else 'FAIL'} {rel} :: {needle} = {cnt}")
        if cnt in ("", "0"):
            raise SystemExit(f"смоук: маркер не найден на проде: {rel} :: {needle}")

    ssh("journalctl -u asgard-crm -n 20 --no-pager | tail -20")

    print("\n=== DEPLOY DONE ===")
    print(f"shell {VER}; снапшот: {SNAP}")
    print("Дальше (post-deploy, порядок важен — D-166):")
    print("  python tools/restore_asset_sync.py plan")
    print("  node tools/audit_silent_reverts.js --post-deploy")


if __name__ == "__main__":
    main()
