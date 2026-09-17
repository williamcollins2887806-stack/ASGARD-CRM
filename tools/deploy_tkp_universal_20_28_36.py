#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Деплой: универсальная шапка таблицы стоимости полного КП (D-182).

Содержимое (17.09.2026):
  * `templates/full-kp-nika-tpl.docx` — шапка таблицы стоимости стала
    параметрической: вместо литералов «СТОИМОСТЬ РАБОТ ПО АППАРАТАМ» /
    «Оборудование» / «Инвентарный №» / «Расчётные данные по трубкам» —
    плейсхолдеры {tbl_title}, {tbl_col1..5}, {tbl_transport_label}.
  * `src/services/tkp-full-kp.js` — TABLE_LABELS_DEFAULT + resolveTableLabels():
    дефолт задаёт код, конкретное ТКП переопределяет через items.full.table_labels.
    Вилка `template_kind` убрана: один шаблон на любой предмет КП.
  * `public/assets/js/tkp-full-form.js` — vanilla-форма (она и живёт в проде):
    блок «⚙ Шапка таблицы» для переопределения подписей + проброс table_labels.
  * `public/desktop-v2-src/**` → пересобирается отдельно (свой бандл /v2/), в этот
    деплой НЕ входит: v2 в прод везётся tar+scp по отдельной процедуре.
  * Shell: 20.28.35 → 20.28.36 (иначе браузер не перечитает tkp-full-form.js?v=).

ПОРЯДОК ЗАЛИВКИ НЕ СЛУЧАЙНЫЙ (находка аудитора, 17.09):
шаблон читается `fs.readFileSync` на КАЖДЫЙ рендер. Если положить шаблон первым и
не успеть перезапустить сервис, прод печатает КП с ПУСТОЙ шапкой (старый код не знает
{tbl_*}, docxtemplater отдаёт ''). Поэтому:
  фаза 1 — код (сервис + форма + оболочка) + рестарт: новый код со старым шаблоном
            печатает корректно (tbl_* просто не используются);
  фаза 2 — шаблон + рестарт: печатается новая шапка.

На любом провале после первой заливки — авто-откат всех 5 файлов из снапшота. Это
касается и ТРАНСПОРТНЫХ сбоев (ssh/scp оборвались по таймауту): они поднимаются как
DeployError и ловятся в main(), иначе откат не срабатывал бы в самом частом сценарии
(находка аудитора 17.09, второй проход).

Файлы подставляются АТОМАРНО: tar везётся в /tmp, распаковывается в стейдж внутри
проекта (тот же fs), сверяется по md5 и только потом переезжает на место `mv` (rename).
Обрыв канала больше не может оставить на проде обрезанный шаблон — а обрезанный
full-kp-nika-tpl.docx ломал бы печать каждого полного КП (fs.readFileSync + PizZip).

ВАЖНО: фронт везём ЯВНЫМ списком, а не через `restore_asset_sync.apply_plan`:
в том же worktree работает параллельная сессия (D-179..D-181), её файлы
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


class DeployError(Exception):
    """Провал шага выкатки (в т.ч. обрыв ssh/scp). Ловится в main() → rollback()."""

    pass


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

TPL_FILE = "templates/full-kp-nika-tpl.docx"
# Фаза 1: код. Фаза 2: шаблон. См. «ПОРЯДОК ЗАЛИВКИ» в шапке файла.
CODE_FILES = [
    "src/services/tkp-full-kp.js",
    "public/assets/js/tkp-full-form.js",
    "public/index.html",
    "public/sw.js",
]
FILES = CODE_FILES + [TPL_FILE]

# Маркеры: если на диске не тот код, что мы проверяли, — падаем ДО заливки.
MARKERS = [
    ("src/services/tkp-full-kp.js", "resolveTableLabels"),
    ("src/services/tkp-full-kp.js", "TABLE_LABELS_DEFAULT"),
    ("src/services/tkp-full-kp.js", "tbl_transport_label"),
    ("public/assets/js/tkp-full-form.js", "collectTblLabels"),
    ("public/assets/js/tkp-full-form.js", "tblLabelsInputsHtml"),
    ("public/index.html", VER),
    ("public/sw.js", VER),
]

SMOKE_GREPS = [
    ("src/services/tkp-full-kp.js", "resolveTableLabels"),
    ("public/assets/js/tkp-full-form.js", "collectTblLabels"),
    ("public/index.html", VER),
]

# Рантайм-проверка НА ПРОДЕ: сервис рендерит docx по реальному ТКП и печатает то,
# что ждём на текущей фазе. Фаза 1 (шаблон ещё старый) — шапка обязана быть непустой
# в любой из двух редакций; фаза 2 — строго новая редакция.
RUNTIME_JS = r"""
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
process.env.DB_USER = process.env.DB_USER || 'asgard';
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm';
const db = require('/var/www/asgard-crm/src/services/db');
const svc = require('/var/www/asgard-crm/src/services/tkp-full-kp.js');
const PizZip = require('/var/www/asgard-crm/node_modules/pizzip');

const MODE = process.argv[3] || 'phase2';

(async () => {
  const { rows: [tkp] } = await db.query('SELECT * FROM tkp WHERE id = $1', [Number(process.argv[2] || 0)]);
  if (!tkp) { console.log('FAIL: ТКП не найден'); process.exit(1); }
  const buf = svc.generateFullKpDocxBuffer(tkp, {});
  const xml = new PizZip(buf).file('word/document.xml').asText();
  const texts = [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join('')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\u00a0/g, ' ');

  const OLD_TITLE = 'ПО АППАРАТАМ';
  const NEW_TITLE = 'СТОИМОСТЬ РАБОТ И ЗАТРАТ';
  const NEW = [NEW_TITLE, 'Наименование', 'Ед. изм.',
               'Объём и расчётные данные', 'Кол-во', 'Сумма без НДС, руб.'];
  const OLD = [OLD_TITLE, 'Инвентарный', 'трубкам', 'Расчётные данные по трубкам'];
  const MONEY = ['8 510 000,00', '1 872 200,00', '10 382 200,00', '600 000,00', '5 191 100,00'];
  const LEAK = ['себестоимост', 'прибыл', '4 157 080', '25 000'];

  const bad = [];
  const say = (ok, label) => { console.log((ok ? 'OK   ' : 'FAIL ') + label); if (!ok) bad.push(label); };
  console.log('режим ' + MODE + '; docx ' + buf.length + ' Б, текста ' + texts.length + ' симв.');

  // Шапка непустая — общее требование обеих фаз (пустая шапка = сломанная печать).
  say(texts.includes(OLD_TITLE) || texts.includes(NEW_TITLE), 'шапка таблицы непустая');
  say(texts.includes('Сумма без НДС'), 'строка подписей колонок на месте');

  if (MODE === 'phase2') {
    console.log('--- новые маркеры шапки (должны быть) ---');
    for (const s of NEW) say(texts.includes(s), 'new: ' + s);
    console.log('--- старые маркеры (должны исчезнуть) ---');
    for (const s of OLD) say(!texts.includes(s), 'old-absent: ' + s);
  }

  console.log('--- суммы из payload ---');
  for (const s of MONEY) say(texts.includes(s), 'money: ' + s);
  console.log('--- внутренние цифры (должны отсутствовать) ---');
  for (const s of LEAK) say(!texts.includes(s), 'no-leak: ' + s);

  const left = texts.includes('{tbl_') || texts.includes('{apparatus');
  say(!left, 'нераскрытых плейсхолдеров нет');
  console.log(bad.length ? 'RUNTIME_FAIL ' + bad.join(' | ') : 'RUNTIME_OK');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.log('FATAL: ' + e.message); process.exit(1); });
"""


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
        raise DeployError(f"FAIL ({p.returncode}): {' '.join(cmd[:4])}")
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
    raise DeployError(f"SSH не прошёл за 4 попытки: {remote[:80]}")


def ssh_soft(remote: str) -> subprocess.CompletedProcess:
    """SSH без ретраев-на-ошибку: нужен код возврата удалённой команды, а не «канал отвалился»."""
    return run(["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
                "-o", "ServerAliveInterval=15", SSH_HOST, remote], check=False)


def scp_retry(local: str, remote: str) -> None:
    """scp с ретраями (тот же нестабильный канал)."""
    for attempt in range(1, 5):
        p = run(["scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
                 "-o", "ServerAliveInterval=15", local, f"{SSH_HOST}:{remote}"], check=False)
        if p.returncode == 0:
            return
        print(f"  [scp] попытка {attempt}/4 не удалась (rc={p.returncode}), повтор...")
        time.sleep(5)
    raise DeployError(f"scp не прошёл за 4 попытки: {remote}")


def upload(rel_files: list[str], label: str) -> None:
    """Заливка явного списка — в два шага, чтобы прод не увидел обрезанный файл.

    1) tar + scp в /tmp (канал может оборваться — прод ещё не тронут);
    2) распаковка в стейдж ВНУТРИ проекта (тот же fs) + md5-сверка со локальным деревом;
    3) переключение `mv` (атомарный rename в пределах одного fs) + контрольная md5-сверка.

    Ни на одном шаге целевой файл не переписывается «на живую»: самое плохое, что
    может остаться от обрыва, — каталог .deploy-stage-* и tar в /tmp.
    """
    print(f"\n--- upload {label}: {len(rel_files)} файл(ов) ---")
    remote_tar = f"/tmp/asgard-tkp-{label}-{STAMP}.tgz"
    stage = f"{PROJECT}/.deploy-stage-{label}-{STAMP}"
    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "tkp-universal.tgz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in rel_files:
                tar.add(ROOT / rel, arcname=rel)
        scp_retry(str(tar_path), remote_tar)

    ssh(f"rm -rf {stage} && mkdir -p {stage} && tar xzf {remote_tar} -C {stage} "
        f"&& rm -f {remote_tar} && echo EXTRACT_OK")
    # Сверяем СТЕЙДЖ: целевые файлы на проде ещё не тронуты, откат не нужен.
    for rel in rel_files:
        local = md5_file(ROOT / rel)
        res = ssh(f"md5sum {stage}/{rel}")
        staged = (res.stdout or "").split()[0] if res.stdout.strip() else "?"
        if staged != local:
            ssh_soft(f"rm -rf {stage}")
            rollback(f"стейдж не совпал с локальным деревом: {rel} (local={local} stage={staged})")
    # Переключение: по одному rename — файл либо старый целиком, либо новый целиком.
    ssh(" && ".join([f"mv -f {stage}/{rel} {PROJECT}/{rel}" for rel in rel_files])
        + f" && rm -rf {stage} && echo SWITCH_OK")
    for rel in rel_files:
        local = md5_file(ROOT / rel)
        res = ssh(f"md5sum {PROJECT}/{rel}")
        remote = (res.stdout or "").split()[0] if res.stdout.strip() else "?"
        ok = remote == local
        print(f"  {'OK  ' if ok else 'FAIL'} {rel}  local={local} prod={remote}")
        if not ok:
            rollback(f"md5 не совпал: {rel} (local={local} prod={remote})")


def rollback(reason: str) -> None:
    """Возврат всех 5 файлов из pre-deploy снапшота. Прод не оставляем в смешанном состоянии."""
    print("\n" + "!" * 78)
    print(f"! ОТКАТ: {reason}")
    print("!" * 78)
    res = ssh_soft(f"tar -C {PROJECT} -xzf {SNAP} && systemctl restart asgard-crm && sleep 4 "
                   f"&& systemctl is-active asgard-crm && echo ROLLBACK_DONE")
    print((res.stdout or "").strip()[-1500:])
    if "ROLLBACK_DONE" not in (res.stdout or ""):
        print("!!! ОТКАТ НЕ ПОДТВЕРЖДЁН — нужен ручной разбор: снапшот " + SNAP)
    raise SystemExit(f"ДЕПЛОЙ ПРЕРВАН И ОТКАЧЕН: {reason}")


def runtime_check(mode: str) -> None:
    """Не unit-тест, а фактический рендер docx на проде."""
    res = ssh_soft(f"mkdir -p /root/tkp-tmp && cd {PROJECT} && DB_PASSWORD=123456789 DB_USER=asgard "
                   f"DB_NAME=asgard_crm node /root/tkp-tmp/_tkp_docx_check.js {TKP_ID} {mode}")
    out = res.stdout or ""
    print(out)
    if "RUNTIME_OK" not in out:
        rollback(f"рантайм-проверка ({mode}) не прошла: см. вывод выше")


def restart() -> None:
    print("\n--- restart ---")
    ssh("systemctl restart asgard-crm && sleep 5 && systemctl is-active asgard-crm")


def check_template_placeholders() -> None:
    """Шаблон — бинарник; проверяем, что в его XML действительно плейсхолдеры."""
    tpl = ROOT / TPL_FILE
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
    print(f"DEPLOY D-182 «универсальная шапка полного КП» — shell {VER}, ТКП {TKP_ID}")
    print("=" * 78)

    # ── 0. pre-flight ──────────────────────────────────────────────────────
    print("\n=== 0. PRE-FLIGHT (shell_guard + маркеры + шаблон + гейты) ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK (оболочка валидна, HEAD == .last-verified)")

    missing = [f for f in FILES if not (ROOT / f).is_file()]
    if missing:
        raise SystemExit(f"нет файлов: {missing}")
    for rel, needle in MARKERS:
        if needle not in (ROOT / rel).read_text(encoding="utf-8"):
            raise SystemExit(f"маркер отсутствует: {rel} :: {needle}")
    check_template_placeholders()
    print(f"маркеры: OK ({len(MARKERS)}/{len(MARKERS)}); файлов к заливке: {len(FILES)}")
    for f in FILES:
        print(f"   ~ {f}")
    # Версионированные гейты батча: локальные, поэтому падаем ДО любой заливки.
    for gate in ("tools/verify_tkp_full_template.js", "tools/verify_tkp_full_form.js"):
        p = run(["node", gate], check=False)
        if p.returncode != 0:
            raise SystemExit(f"гейт {gate} красный — выкатка не начинается")
        print(f"гейт {gate}: OK")

    # ── 1. снапшот + чек-инструмент на прод ────────────────────────────────
    print("\n=== 1. SNAPSHOT ===")
    ssh(f"mkdir -p /root/snapshots /root/tkp-tmp && tar -C {PROJECT} -czf {SNAP} "
        + " ".join(FILES) + f" 2>/dev/null; ls -lh {SNAP}")
    snapshot_done = True
    with tempfile.TemporaryDirectory() as tmp:
        js_path = Path(tmp) / "_tkp_docx_check.js"
        js_path.write_text(RUNTIME_JS, encoding="utf-8")
        scp_retry(str(js_path), "/root/tkp-tmp/_tkp_docx_check.js")

    # ── 2..5. заливка ─────────────────────────────────────────────────────
    # Любой провал (включая обрыв ssh/scp) после снапшота = откат прод-файлов.
    # rollback() поднимает SystemExit — его этот except не перехватывает.
    try:
        # ── 2. ФАЗА 1: код + рестарт (шаблон ещё старый — печать не ломается) ──
        print("\n=== 2. ФАЗА 1: код (сервис + форма + оболочка) ===")
        upload(CODE_FILES, "code")
        restart()
        print(f"\n=== 2б. RUNTIME на проде (phase1: шапка непустая, суммы, без утечек) ===")
        runtime_check("phase1")

        # ── 3. ФАЗА 2: шаблон + рестарт ────────────────────────────────────────
        print("\n=== 3. ФАЗА 2: шаблон ===")
        upload([TPL_FILE], "tpl")
        restart()
        print(f"\n=== 3б. RUNTIME на проде (phase2: строго новая шапка) ===")
        runtime_check("phase2")

        # ── 4. сквозная проверка клиентским путём (HTTP API → docx) ───────────
        print("\n=== 4. E2E через API (то, что получит клиент) ===")
        probe = ROOT / "tools" / "tkp_full_docx_probe.js"
        if not probe.is_file():
            rollback(f"нет зонда {probe}")
        scp_retry(str(probe), "/root/tkp-tmp/tkp_full_docx_probe.js")
        res = ssh_soft("cd /root/tkp-tmp && TKP_AUTHOR_LOGIN=n.androsov "
                       f"node tkp_full_docx_probe.js {TKP_ID}")
        out = res.stdout or ""
        print(out)
        if "PROBE_OK" not in out:
            rollback("клиентский docx не прошёл зонд (см. вывод выше)")

        # ── 5. смоук ───────────────────────────────────────────────────────────
        print("\n=== 5. SMOKE ===")
        ssh("curl -s http://127.0.0.1:3000/api/version; echo; "
            "curl -s -o /dev/null -w 'home:%{http_code}\\n' https://asgard-crm.ru/; "
            f"grep -oP \"ASGARD_SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/index.html | head -1; "
            f"grep -oP \"SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/sw.js | head -1")
        for rel, needle in SMOKE_GREPS:
            res = ssh(f"grep -c {needle!r} {PROJECT}/{rel}")
            cnt = (res.stdout or "0").strip().splitlines()[-1] if res.stdout.strip() else "0"
            print(f"  {'OK  ' if cnt not in ('', '0') else 'FAIL'} {rel} :: {needle} = {cnt}")
            if cnt in ("", "0"):
                rollback(f"смоук: маркер не найден на проде: {rel} :: {needle}")
        ssh("journalctl -u asgard-crm -n 20 --no-pager | tail -20")
    except DeployError as exc:
        if snapshot_done:
            rollback(f"аварийное завершение выкатки: {exc}")
        raise

    print("\n=== DEPLOY DONE ===")
    print(f"shell {VER}; снапшот: {SNAP}")
    print("Дальше (post-deploy, порядок важен — D-166):")
    print("  python tools/restore_asset_sync.py plan")
    print("  node tools/audit_silent_reverts.js --post-deploy")


if __name__ == "__main__":
    main()
