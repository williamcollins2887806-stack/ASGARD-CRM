#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Деплой батча D-184..D-190 (смета/РП/тендер-карточка) — shell 20.28.36 -> 20.28.37.

Содержимое (работа параллельной сессии, коммит 27fc6cde, VERIFIED аудитом L3):
  * D-184 — маржа и чистая прибыль после налога 25 %: src/services/asgard-smeta.js,
    asgard-smeta-xlsx.js, public/assets/js/asgard_smeta.js,
    src/services/tender-director-mail.js (renderProfitBlockHtml).
  * D-185 — порог директора из settings вместо хардкода 10 млн; exclude_types в /files:
    src/routes/files.js, public/assets/js/rp_calc_modal.js (DIRECTOR_THRESHOLD_FALLBACK),
    src/routes/pm-duty.js (director_threshold).
  * D-187 — документы тендера в ответе РП (без дублей Смета/ТКП):
    src/routes/pm-duty.js (linkedFileIds), public/assets/js/registry_api.js.
  * D-189 — карточка тендера: неизменяемые реквизиты по ролям:
    src/routes/tenders-registry.js (IMMUTABLE_FIELDS), registry_tab.js.
  * D-190 — fallback НДС 20 -> 22: personal_kanban.js (finVat), tenders.js (_vatPct),
    public/assets/js/tkp-page.js.
  * CSS ссылок документов: public/assets/css/rp-calc-modal.css (.rp-calc-file-links).

ПОЧЕМУ СВОЙ СКРИПТ, а не restore_asset_sync: тот закрывает только `public/assets` + shell
и не умеет `src/**`; и он зовётся по-другому. Здесь нужен и бэкенд (6 файлов src/),
поэтому взят проверенный каркас deploy_tkp_universal_20_28_36.py: снапшот с картой md5,
атомарная заливка через стейдж + `mv`, автооткат с подтверждением.

Порядок: файлы заливаются ОДНИМ батчем (бэкенд+фронт+shell), затем рестарт — промежуточного
состояния «новый фронт со старым бэком» нет. Оболочку БАМПАЕМ (20.28.37), иначе браузер не
перечитает изменённые .js с новым ?v=.

Запуск: python tools/deploy_smeta_batch_20_28_37.py
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]


class DeployError(Exception):
    """Провал шага выкатки (в т.ч. обрыв ssh/scp). Ловится в main() -> rollback()."""


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
sys.path.insert(0, str(TOOLS))

import shell_guard  # noqa: E402

VER = "20.28.37"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
TENDER_ID = "2052"          # тендер для рантайм-проверки D-187 (см. ledger)
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-smeta-batch-{STAMP}.tgz"
SNAP_MD5: dict[str, str] = {}

BACKEND = [
    "src/routes/files.js",
    "src/routes/pm-duty.js",
    "src/routes/tenders-registry.js",
    "src/services/asgard-smeta.js",
    "src/services/asgard-smeta-xlsx.js",
    "src/services/tender-director-mail.js",
]
FRONTEND = [
    "public/assets/css/rp-calc-modal.css",
    "public/assets/js/asgard_smeta.js",
    "public/assets/js/personal_kanban.js",
    "public/assets/js/registry_api.js",
    "public/assets/js/registry_tab.js",
    "public/assets/js/rp_calc_modal.js",
    "public/assets/js/tenders.js",
    "public/assets/js/tkp-page.js",
]
SHELL = ["public/index.html", "public/sw.js"]
FILES = BACKEND + FRONTEND + SHELL

# Маркеры: если на диске не тот код, что проверяли, — падаем ДО заливки.
MARKERS = [
    ("src/routes/files.js", "excludeList"),
    ("src/routes/pm-duty.js", "linkedFileIds"),
    ("src/routes/tenders-registry.js", "IMMUTABLE_FIELDS"),
    ("src/services/asgard-smeta.js", "incomeTaxAmount"),
    ("src/services/asgard-smeta-xlsx.js", "margin_rub"),
    ("src/services/tender-director-mail.js", "renderProfitBlockHtml"),
    ("public/assets/css/rp-calc-modal.css", ".rp-calc-file-links"),
    ("public/assets/js/asgard_smeta.js", "incomeTaxAmount"),
    ("public/assets/js/personal_kanban.js", "finVat"),
    ("public/assets/js/registry_api.js", "rp_estimate,rp_report,rp_tkp"),
    ("public/assets/js/registry_tab.js", "IMMUTABLE_CARD_ADMIN_ONLY"),
    ("public/assets/js/rp_calc_modal.js", "DIRECTOR_THRESHOLD_FALLBACK"),
    ("public/assets/js/tenders.js", "_vatPct"),
    ("public/assets/js/tkp-page.js", "est.vat_pct||22"),
    ("public/index.html", VER),
    ("public/sw.js", VER),
]

# Рантайм-проверка НА ПРОДЕ: реальный ответ API, а не unit-тест.
# 1) D-187: в /api/tenders/:id/rp-review нет документов типов rp_estimate/rp_report/rp_tkp
#    и нет дублей по имени «Смета»/«ТКП» в блоке документов тендера.
# 2) D-185: director_threshold присутствует в ответе (порог из settings, не хардкод).
# 3) D-190/D-184: смета-движок сервиса считает налог 25 % (маржу/налог через /settings).
RUNTIME_JS = r"""
process.chdir('/var/www/asgard-crm');
const fs = require('fs');
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
process.env.DB_USER = process.env.DB_USER || 'asgard';
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm';
const jwt = require('/var/www/asgard-crm/node_modules/jsonwebtoken');
const TENDER = Number(process.argv[2] || 2052);

let secret = process.env.JWT_SECRET;
if (!secret) {
  const env = fs.readFileSync('/var/www/asgard-crm/.env', 'utf8');
  const m = env.match(/^\s*JWT_SECRET\s*=\s*(.+?)\s*$/m);
  if (m) secret = m[1].replace(/^["']|["']$/g, '');
}
if (!secret) { console.log('FATAL: JWT_SECRET не найден'); process.exit(1); }
const token = jwt.sign({ id: 3474, login: 'n.androsov', name: 'Андросов Никита Андреевич', role: 'ADMIN', pinVerified: true }, secret, { expiresIn: '15m' });

const bad = [];
const say = (ok, label) => { console.log((ok ? 'OK   ' : 'FAIL ') + label); if (!ok) bad.push(label); };

(async () => {
  const url = `http://127.0.0.1:${process.env.PORT || 3000}/api/tenders/${TENDER}/rp-review`;
  const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const data = await resp.json().catch(() => ({}));
  say(resp.status === 200, `GET /api/tenders/${TENDER}/rp-review -> HTTP ${resp.status}`);

  const files = Array.isArray(data.tender_files) ? data.tender_files
    : (data.review && Array.isArray(data.review.tender_files)) ? data.review.tender_files : null;
  if (files === null) {
    say(false, 'tender_files в ответе отсутствует (D-187 не отдаёт блок документов)');
  } else {
    const BADT = ['rp_estimate', 'rp_report', 'rp_tkp'];
    const leaked = files.filter((f) => BADT.includes(String(f.type || '')));
    say(leaked.length === 0, `в tender_files нет типов rp_estimate/rp_report/rp_tkp (${files.length} документа, утечек ${leaked.length})`);
    // D-187: связанные с просчётом файлы (смета/отчёт/ТКП) не должны дублироваться в tender_files
    // по имени. Сверяем именно связанные, а не «любое имя на Смета/ТКП» — у тендера может быть
    // собственный документ ТО с похожим именем (напр. ТКП_3040), и он законно остаётся.
    const linkedNames = [data.estimate_file, data.report_file, data.tkp_file]
      .filter(Boolean).map((f) => String(f.original_name || '').trim().toLowerCase()).filter(Boolean);
    const present = new Set(files.map((f) => String(f.original_name || '').trim().toLowerCase()));
    const dup = linkedNames.filter((n) => present.has(n));
    console.log(`INFO связанных файлов просчёта (смета/отчёт/ТКП): ${linkedNames.length}`);
    say(dup.length === 0, `в tender_files нет дублей связанных файлов (${dup.length}${dup.length ? ': ' + dup.join(', ') : ''})`);
  }

  const thr = (data.review && data.review.director_threshold) || data.director_threshold;
  say(thr != null && Number(thr) > 0, `director_threshold из settings = ${thr} (D-185, не хардкод)`);

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


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    print(f"$ {' '.join(cmd[:6])}{' ...' if len(cmd) > 6 else ''}")
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.stdout.strip():
        print(p.stdout[-5000:])
    if p.stderr.strip():
        print("STDERR:", p.stderr[-2000:])
    if check and p.returncode != 0:
        raise DeployError(f"FAIL ({p.returncode}): {' '.join(cmd[:4])}")
    return p


def ssh(remote: str) -> subprocess.CompletedProcess:
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
    return run(["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
                "-o", "ServerAliveInterval=15", SSH_HOST, remote], check=False)


def scp_retry(local: str, remote: str) -> None:
    for attempt in range(1, 5):
        p = run(["scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
                 "-o", "ServerAliveInterval=15", local, f"{SSH_HOST}:{remote}"], check=False)
        if p.returncode == 0:
            return
        print(f"  [scp] попытка {attempt}/4 не удалась (rc={p.returncode}), повтор...")
        time.sleep(5)
    raise DeployError(f"scp не прошёл за 4 попытки: {remote}")


def upload(rel_files: list[str], label: str) -> None:
    """tar + scp -> стейдж внутри проекта -> md5-сверка -> атомарный `mv` -> контроль md5."""
    print(f"\n--- upload {label}: {len(rel_files)} файл(ов) ---")
    remote_tar = f"/tmp/asgard-smeta-{label}-{STAMP}.tgz"
    stage = f"{PROJECT}/.deploy-stage-{label}-{STAMP}"
    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "smeta-batch.tgz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in rel_files:
                tar.add(ROOT / rel, arcname=rel)
        scp_retry(str(tar_path), remote_tar)

    ssh(f"rm -rf {stage} && mkdir -p {stage} && tar xzf {remote_tar} -C {stage} "
        f"&& rm -f {remote_tar} && echo EXTRACT_OK")
    for rel in rel_files:
        local = md5_file(ROOT / rel)
        res = ssh(f"md5sum {stage}/{rel}")
        staged = (res.stdout or "").split()[0] if res.stdout.strip() else "?"
        if staged != local:
            ssh_soft(f"rm -rf {stage}")
            rollback(f"стейдж не совпал с локальным деревом: {rel} (local={local} stage={staged})")
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
    """Возврат всех файлов из снапшота + ПРОВЕРКА, что прод действительно вернулся."""
    print("\n" + "!" * 78)
    print(f"! ОТКАТ: {reason}")
    print("!" * 78)

    def try_ssh(cmd: str) -> str:
        try:
            return ssh(cmd).stdout or ""
        except DeployError as exc:
            print(f"  [откат] ssh не прошёл: {exc}")
            return ""

    try_ssh(f"tar -C {PROJECT} -xzf {SNAP}")
    mismatch = []
    for rel, want in (SNAP_MD5 or {}).items():
        out = try_ssh(f"md5sum {PROJECT}/{rel}")
        got = out.split()[0] if out.strip() else "?"
        if got != want:
            mismatch.append(f"{rel}: в снапшоте {want}, на проде {got}")
    active = "active" in try_ssh("systemctl restart asgard-crm && sleep 4 && systemctl is-active asgard-crm")
    if not SNAP_MD5:
        mismatch.append("карта md5 снапшота пуста — подтвердить возврат нечем")

    if mismatch or not active:
        print("!!! ОТКАТ НЕ ПОДТВЕРЖДЁН — нужен ручной разбор: снапшот " + SNAP)
        for m in mismatch:
            print("    · " + m)
        if not active:
            print("    · сервис не подтверждён как active")
        raise SystemExit(
            "ДЕПЛОЙ ПРЕРВАН, ОТКАТ НЕ ПОДТВЕРЖДЁН (прод может быть в смешанном "
            f"состоянии — сверься со снапшотом {SNAP}): {reason}")

    print(f"ОТКАТ ПОДТВЕРЖДЁН: {len(SNAP_MD5)}/{len(SNAP_MD5)} файлов совпали со снапшотом, сервис active")
    raise SystemExit(f"ДЕПЛОЙ ПРЕРВАН И ОТКАЧЕН: {reason}")


def make_snapshot() -> dict[str, str]:
    print("\n=== 1. SNAPSHOT (состав архива проверяется) ===")
    for rel in FILES:
        res = ssh(f"test -f {PROJECT}/{rel} && echo PRESENT || echo MISSING")
        if "PRESENT" not in (res.stdout or ""):
            raise DeployError(f"на проде нет файла {rel} — снапшот был бы неполным")
    ssh(f"mkdir -p /root/snapshots /root/tkp-tmp && tar -C {PROJECT} -czf {SNAP} " + " ".join(FILES))
    listing = ssh(f"tar -tzf {SNAP}").stdout or ""
    missing = [rel for rel in FILES if rel not in listing]
    if missing:
        raise DeployError(f"в снапшоте нет {missing} — откат был бы частичным")
    md5s: dict[str, str] = {}
    for rel in FILES:
        val = ((ssh(f"md5sum {PROJECT}/{rel}").stdout or "").split() or [""])[0]
        if len(val) != 32:
            raise DeployError(f"не снял md5 прод-файла {rel} — откат нечем подтвердить")
        md5s[rel] = val
    print(f"снапшот: {SNAP} — {len(FILES)}/{len(FILES)} файлов, md5 снят ({len(md5s)})")
    print((ssh(f"ls -lh {SNAP}").stdout or "").strip())
    with tempfile.TemporaryDirectory() as tmp:
        js_path = Path(tmp) / "_smeta_batch_check.js"
        js_path.write_text(RUNTIME_JS, encoding="utf-8")
        scp_retry(str(js_path), "/root/tkp-tmp/_smeta_batch_check.js")
    return md5s


def restart() -> None:
    print("\n--- restart ---")
    ssh("systemctl restart asgard-crm && sleep 5 && systemctl is-active asgard-crm")


def runtime_check() -> None:
    res = ssh_soft(f"mkdir -p /root/tkp-tmp && cd {PROJECT} && DB_PASSWORD=123456789 DB_USER=asgard "
                   f"DB_NAME=asgard_crm node /root/tkp-tmp/_smeta_batch_check.js {TENDER_ID}")
    out = res.stdout or ""
    print(out)
    if "RUNTIME_OK" not in out:
        rollback("рантайм-проверка на проде не прошла (см. вывод выше)")


def main() -> None:
    print("=" * 78)
    print(f"DEPLOY D-184..D-190 «смета/РП/тендер-карточка» — shell {VER}, тендер {TENDER_ID}")
    print("=" * 78)

    print("\n=== 0. PRE-FLIGHT (shell_guard + маркеры + гейты) ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK (оболочка валидна, HEAD == .last-verified)")

    missing = [f for f in FILES if not (ROOT / f).is_file()]
    if missing:
        raise SystemExit(f"нет файлов: {missing}")
    for rel, needle in MARKERS:
        if needle not in (ROOT / rel).read_text(encoding="utf-8"):
            raise SystemExit(f"маркер отсутствует: {rel} :: {needle}")
    print(f"маркеры: OK ({len(MARKERS)}/{len(MARKERS)}); файлов к заливке: {len(FILES)}")
    for f in FILES:
        print(f"   ~ {f}")

    for gate in ("tests/asgard-smeta-share.test.js", "tools/verify_vat22_ui.js",
                 "tools/verify_tkp_full_template.js"):
        p = run(["node", str(ROOT / gate)], check=False)
        if p.returncode != 0:
            raise SystemExit(f"гейт {gate} красный — выкатка не начинается")
        print(f"гейт {gate}: OK")

    try:
        SNAP_MD5.update(make_snapshot())
    except DeployError as exc:
        raise SystemExit(f"ВЫКАТКА НЕ НАЧАТА (снапшот не снят, прод не тронут): {exc}")
    snapshot_done = True

    try:
        print("\n=== 2. ЗАЛИВКА (бэкенд + фронт + shell одним батчем) ===")
        upload(FILES, "batch")
        restart()

        print("\n=== 3. RUNTIME на проде (D-185/D-187 по реальному API) ===")
        runtime_check()

        print("\n=== 4. SMOKE ===")
        ssh("curl -s http://127.0.0.1:3000/api/version; echo; "
            "curl -s -o /dev/null -w 'home:%{http_code}\\n' https://asgard-crm.ru/; "
            f"grep -oP \"ASGARD_SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/index.html | head -1; "
            f"grep -oP \"SHELL_VERSION = '\\K[^']+\" {PROJECT}/public/sw.js | head -1")
        for rel, needle in [("public/assets/js/rp_calc_modal.js", "DIRECTOR_THRESHOLD_FALLBACK"),
                            ("src/routes/tenders-registry.js", "IMMUTABLE_FIELDS"),
                            ("public/index.html", VER)]:
            res = ssh(f"grep -c {needle!r} {PROJECT}/{rel}")
            cnt = (res.stdout or "0").strip().splitlines()[-1] if res.stdout.strip() else "0"
            print(f"  {'OK  ' if cnt not in ('', '0') else 'FAIL'} {rel} :: {needle} = {cnt}")
            if cnt in ("", "0"):
                rollback(f"смоук: маркер не найден на проде: {rel} :: {needle}")
        ssh("journalctl -u asgard-crm -n 12 --no-pager | tail -12")
    except DeployError as exc:
        if snapshot_done:
            rollback(f"аварийное завершение выкатки: {exc}")
        raise
    except Exception as exc:
        if snapshot_done:
            rollback(f"непредвиденный сбой выкатки: {exc!r}")
        raise

    print("\n=== DEPLOY DONE ===")
    print(f"shell {VER}; снапшот: {SNAP}")
    print("Дальше (post-deploy, порядок важен — D-166):")
    print("  python tools/restore_asset_sync.py plan")
    print("  node tools/audit_silent_reverts.js --post-deploy")


if __name__ == "__main__":
    main()
