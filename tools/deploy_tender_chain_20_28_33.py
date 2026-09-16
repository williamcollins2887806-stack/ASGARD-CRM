#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Деплой цепочки «анализ -> просчёт -> директор» + сметы РП.

Содержимое (16.09.2026):
  * D-172 — осиротевший просчёт виден дежурному РП и закрепляется за ним (ensureCalcOwner);
  * D-173 — канон `work_price` = цена БЕЗ НДС (+ src/services/work-price.js, зеркало на фронте);
  * D-174 — смета РП: перечень (F), закупка с долей (G), аренда (H), даты работ, 1:1 на оборудование.
  Shell: 20.28.32 -> 20.28.33.

Порядок (по .cursor/rules/protect-prod-shell.mdc):
  1) shell_guard.assert_ok(--expect-version --deploy-gate) — оболочка валидна, HEAD == .last-verified;
  2) снапшот затронутых файлов на проде (/root/snapshots/...);
  3) бэкенд: tar + scp + распаковка, затем md5-сверка каждого файла на проде с локальным;
  4) фронт: restore_asset_sync (build_plan -> apply_plan), он сам зовёт shell_guard перед scp;
  5) рестарт systemctl (НЕ pm2) + смоук (/api/version, маркеры кода, journalctl).

Запуск: python tools/deploy_tender_chain_20_28_33.py
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
sys.path.insert(0, str(TOOLS))

import shell_guard  # noqa: E402  (pre-flight обязателен — правило D-167)

VER = "20.28.33"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-tender-chain-{STAMP}.tgz"

# Бэкенд. Фронт (public/**) везёт restore_asset_sync — он же следит за дельтами и мусором.
BACKEND = [
    "src/services/work-price.js",
    "src/services/asgard-smeta.js",
    "src/services/asgard-smeta-xlsx.js",
    "src/services/rp-review-drafts.js",
    "src/services/rp-review-notify.js",
    "src/services/tender-director-mail.js",
    "src/routes/pm-duty.js",
    "src/routes/rp-review-collab.js",
]

# Маркеры: если код на диске не тот, что мы проверяли, — падаем ДО заливки.
MARKERS = [
    ("src/services/work-price.js", "resolveWorkPrice"),
    ("src/services/work-price.js", "VAT_DEFAULT_PCT"),
    ("src/routes/pm-duty.js", "ensureCalcOwner"),
    ("src/routes/pm-duty.js", "duty_orphan"),
    ("src/routes/rp-review-collab.js", "work_price_ex_vat"),
    ("src/services/asgard-smeta.js", "mergeSkeletonRows"),
    ("src/services/asgard-smeta.js", "equipment_purchase"),
    ("src/services/asgard-smeta.js", "work_end_plan_calc"),
    ("src/services/tender-director-mail.js", "Доля, %"),
    ("src/services/asgard-smeta-xlsx.js", "Доля, %"),
    ("public/index.html", VER),
    ("public/sw.js", VER),
    ("public/assets/js/asgard_smeta.js", "mergeSkeletonRows"),
    ("public/assets/js/money_fmt.js", "resolveWorkPrice"),
    ("public/assets/js/rp_calc_modal.js", "sharePct"),
    ("public/assets/js/rp_review_modal.js", "reviewWorkPrice"),
]

# Смоук на проде: маркер -> сколько раз обязан найтись.
SMOKE_GREPS = [
    ("src/services/work-price.js", "resolveWorkPrice"),
    ("src/routes/pm-duty.js", "ensureCalcOwner"),
    ("src/routes/rp-review-collab.js", "work_price_ex_vat"),
    ("public/assets/js/asgard_smeta.js", "mergeSkeletonRows"),
    ("public/assets/js/money_fmt.js", "resolveWorkPrice"),
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
    return run(["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=20",
                SSH_HOST, remote])


def main() -> None:
    print("=" * 78)
    print(f"DEPLOY цепочка «анализ->просчёт->директор» + смета РП — shell {VER}")
    print("=" * 78)

    # ── 0. pre-flight: оболочка + deploy-gate + маркеры ─────────────────────
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
    snap_list = " ".join(BACKEND + ["public/assets/js", "public/assets/css", "public/index.html",
                                    "public/sw.js"])
    ssh(f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP} {snap_list} 2>/dev/null; ls -lh {SNAP}")

    # ── 2. бэкенд: tar + scp + распаковка + md5-сверка ─────────────────────
    print("\n=== 2. BACKEND (tar+scp) ===")
    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "backend-src.tgz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in BACKEND:
                tar.add(ROOT / rel, arcname=rel)
        print(f"tar: {len(BACKEND)} файлов, {tar_path.stat().st_size} Б")
        remote_tar = f"/tmp/asgard-tender-chain-{STAMP}.tgz"
        run(["scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", str(tar_path),
             f"{SSH_HOST}:{remote_tar}"])
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
