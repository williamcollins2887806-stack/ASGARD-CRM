#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Деплой D-178 — налог 55% с ФОТ + пайковые (смета РП).

Содержимое (17.09.2026):
  * D-178 — база налога 55% = ФОТ + строка C1 (пайковые); проживание не облагается.
    Раньше налог считался только от блока A, что занижало себестоимость
    ровно на `пайковые × 0.55`.
  * В `totals` добавлен `fot_tax_base` (трассировка).
  * Excel-выгрузка: формула налога синхронна бэкенду — `(ФОТ + C1) * fot_tax`.
  * Правка только в VANILLA-контуре (v2 НЕ трогаем — решение РП).
    Shell: 20.28.33 → 20.28.34.

Порядок (по .cursor/rules/protect-prod-shell.mdc):
  1) shell_guard.assert_ok(--expect-version --deploy-gate);
  2) снапшот затронутых файлов на проде;
  3) бэкенд: tar + scp + распаковка + md5-сверка;
  4) фронт: restore_asset_sync (build_plan → apply_plan), он сам зовёт shell_guard;
  5) рестарт systemctl (НЕ pm2) + смоук (маркеры кода, версия оболочки, journalctl).

Запуск: python tools/deploy_smeta_taxfix_20_28_34.py
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
sys.path.insert(0, str(TOOLS))

import shell_guard  # noqa: E402

VER = "20.28.34"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-smeta-taxfix-{STAMP}.tgz"

# Бэкенд. Фронт (public/**) везёт restore_asset_sync — он же следит за дельтами и мусором.
BACKEND = [
    "src/services/asgard-smeta.js",
    "src/services/asgard-smeta-xlsx.js",
]

# Маркеры: если код на диске не тот, что мы проверяли, — падаем ДО заливки.
MARKERS = [
    ("src/services/asgard-smeta.js", "fot_tax_base"),
    ("src/services/asgard-smeta.js", "perDiem"),
    ("src/services/asgard-smeta.js", "fotTaxBase"),
    ("src/services/asgard-smeta-xlsx.js", "c1Row"),
    ("public/index.html", VER),
    ("public/sw.js", VER),
    ("public/assets/js/asgard_smeta.js", "fot_tax_base"),
]

# Смоук на проде: маркер -> сколько раз обязан найтись.
SMOKE_GREPS = [
    ("src/services/asgard-smeta.js", "fot_tax_base"),
    ("src/services/asgard-smeta.js", "fotTaxBase"),
    ("src/services/asgard-smeta-xlsx.js", "c1Row"),
    ("public/assets/js/asgard_smeta.js", "fot_tax_base"),
]


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


def ssh(remote: str, timeout: int = 300) -> subprocess.CompletedProcess:
    """SSH с ретраями: канал до прода рвётся нестабильно (banner exchange timeout)."""
    for attempt in range(1, 5):
        p = run(["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
                 "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", SSH_HOST, remote],
                check=False)
        if p.returncode == 0:
            return p
        print(f"  [ssh] попытка {attempt}/4 не удалась (rc={p.returncode}), повтор...")
        time.sleep(4)
    raise SystemExit(f"SSH не прошёл за 4 попытки: {remote[:80]}")


def scp_retry(local: str, remote: str) -> None:
    """scp с ретраями (тот же нестабильный канал)."""
    for attempt in range(1, 5):
        p = run(["scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=25",
                 "-o", "ServerAliveInterval=15", local, f"{SSH_HOST}:{remote}"], check=False)
        if p.returncode == 0:
            return
        print(f"  [scp] попытка {attempt}/4 не удалась (rc={p.returncode}), повтор...")
        time.sleep(4)
    raise SystemExit(f"scp не прошёл за 4 попытки: {remote}")


def main() -> None:
    print("=" * 78)
    print(f"DEPLOY D-178 «налог 55% с ФОТ + пайковые» (смета РП) — shell {VER}")
    print("=" * 78)

    # ── 0. pre-flight ──────────────────────────────────────────────────────
    print("\n=== 0. PRE-FLIGHT (shell_guard) ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK")

    missing = [f for f in BACKEND if not (ROOT / f).is_file()]
    if missing:
        raise SystemExit(f"нет файлов: {missing}")
    for rel, needle in MARKERS:
        text = (ROOT / rel).read_text(encoding="utf-8")
        if needle not in text:
            raise SystemExit(f"маркер отсутствует: {rel} :: {needle}")
    print(f"маркеры: OK ({len(MARKERS)}/{len(MARKERS)}), файлов бэкенда: {len(BACKEND)}")

    # ── 1. снапшот на проде ────────────────────────────────────────────────
    print("\n=== 1. SNAPSHOT ===")
    snap_list = " ".join(BACKEND + ["public/assets/js", "public/index.html", "public/sw.js"])
    ssh(f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP} {snap_list} 2>/dev/null; ls -lh {SNAP}")

    # ── 2. бэкенд: tar + scp + распаковка + md5-сверка ─────────────────────
    print("\n=== 2. BACKEND (tar+scp) ===")
    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "smeta-taxfix.tgz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in BACKEND:
                tar.add(ROOT / rel, arcname=rel)
        print(f"tar: {len(BACKEND)} файлов, {tar_path.stat().st_size} Б")
        remote_tar = f"/tmp/asgard-smeta-taxfix-{STAMP}.tgz"
        scp_retry(str(tar_path), remote_tar)
        ssh(f"cd {PROJECT} && tar xzf {remote_tar} && rm -f {remote_tar} && echo EXTRACT_OK")

    print("\n--- md5 local vs prod ---")
    for rel in BACKEND:
        local = md5_file(ROOT / rel)
        res = ssh(f"md5sum {PROJECT}/{rel}")
        remote = (res.stdout or "").split()[0] if res.stdout.strip() else "?"
        ok = remote == local
        print(f"  {'OK  ' if ok else 'FAIL'} {rel}  local={local} prod={remote}")
        if not ok:
            raise SystemExit(f"md5 не совпал: {rel}")

    # ── 3. фронт: restore_asset_sync (внутри сам зовёт shell_guard) ────────
    print("\n=== 3. FRONT (restore_asset_sync: plan -> apply) ===")
    import json

    import restore_asset_sync as ras  # noqa: E402

    plan = ras.build_plan()
    os.makedirs(ras.REPORT_DIR, exist_ok=True)
    with open(ras.REPORT_JSON, "w", encoding="utf-8") as fh:
        json.dump(plan, fh, ensure_ascii=False, indent=2)
    ras.print_plan(plan)
    t = plan["totals"]
    if t["differ_prod_newer"] or t["index_reference_problems"]:
        raise SystemExit("plan красный: differ_prod_newer=%d index_reference_problems=%d"
                         % (t["differ_prod_newer"], t["index_reference_problems"]))
    ras.apply_plan(plan)

    # ── 4. рестарт + смоук ─────────────────────────────────────────────────
    print("\n=== 4. RESTART ===")
    ssh("systemctl restart asgard-crm && sleep 5 && systemctl is-active asgard-crm")

    print("\n=== 5. SMOKE ===")
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

    ssh("journalctl -u asgard-crm -n 25 --no-pager | tail -25")

    print("\n=== DEPLOY DONE ===")
    print(f"shell {VER}; снапшот: {SNAP}")
    print("Дальше (post-deploy, порядок важен — D-166):")
    print("  python tools/restore_asset_sync.py plan")
    print("  node tools/audit_silent_reverts.js --post-deploy")


if __name__ == "__main__":
    main()
