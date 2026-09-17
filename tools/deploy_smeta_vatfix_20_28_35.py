#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Деплой D-181 — НДС считается в целых копейках (смета РП).

Содержимое (17.09.2026):
  * D-181 — `Math.round(priceNoVat * p.vat * 100) / 100` давал ошибку в 1 копейку
    на полугранице из-за float (9 785 921,25 × 0,22 = 2 152 902,6750, но произведение
    уходило на 1 ULP ниже половины → .67 вместо .68). Теперь НДС считается в целых
    копейках, ставка — в базисных пунктах (22 % → 2200).
  * Регресс-кейс Киров Тайр: допуск ужесточён с 1,5 ₽ до 0,005 ₽ (иначе копейку не видно),
    проверка наценки на оборудование сделана поведенческой (маржа ≠ cost × 0.5).
  * Правка только в VANILLA-контуре (v2 НЕ трогаем — решение РП).
    Shell: 20.28.34 → 20.28.35.

ВАЖНО: фронт везём ЯВНЫМ списком, а не через `restore_asset_sync.apply_plan`.
Причина: в том же worktree работает параллельная сессия, и её правка
`public/assets/js/tkp-full-form.js` попадает в авто-очередь sync. Чужой файл
заливать нельзя (правило «один worktree — один агент»). shell_guard вызывается
явно в pre-flight — как и делает restore_asset_sync внутри себя.

Запуск: python tools/deploy_smeta_vatfix_20_28_35.py
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

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
sys.path.insert(0, str(TOOLS))

import shell_guard  # noqa: E402

VER = "20.28.35"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
PROJECT = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-smeta-vatfix-{STAMP}.tgz"

# ЯВНЫЙ список — только файлы этой задачи. Никакого авто-подхвата чужого мусора.
FILES = [
    "src/services/asgard-smeta.js",
    "public/assets/js/asgard_smeta.js",
    "public/index.html",
    "public/sw.js",
]

# Маркеры: если на диске не тот код, что мы проверяли, — падаем ДО заливки.
MARKERS = [
    ("src/services/asgard-smeta.js", "vatBasisPoints"),
    ("src/services/asgard-smeta.js", "priceKop"),
    ("src/services/asgard-smeta.js", "fotTaxBase"),
    ("public/assets/js/asgard_smeta.js", "vatBasisPoints"),
    ("public/index.html", VER),
    ("public/sw.js", VER),
]

SMOKE_GREPS = [
    ("src/services/asgard-smeta.js", "vatBasisPoints"),
    ("public/assets/js/asgard_smeta.js", "vatBasisPoints"),
]

# Рантайм-проверка НА ПРОДЕ: движок обязан дать НДС .68 и цену с НДС .93.
RUNTIME_JS = r"""
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
process.env.DB_USER = process.env.DB_USER || 'asgard';
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm';
const s = require('/var/www/asgard-crm/src/services/asgard-smeta.js');
const est = { template: 'asgard_v1', params: { markup: 1.5, material_markup: 1, fot_tax: 0.55, overhead: 0.10, contingency: 0.05, vat: 0.22 } };
let e = s.recalcAsgardSmeta(est);
e.rows.forEach((r) => { if (r.kind === 'line') { r.qty = 0; r.price = 0; r.override = true; } });
const set = (id, p) => Object.assign(e.rows.find((r) => r.id === id), p, { override: true });
set('a1', { qty: 18, price: 20000 }); set('a2', { qty: 24, price: 20000 });
set('a3', { qty: 120, price: 15000 }); set('a6', { qty: 52, price: 3000 });
set('b1', { qty: 13, price: 15000 }); set('b4', { qty: 1, price: 100000 });
set('b5', { qty: 1, price: 150000 }); set('c1', { qty: 234, price: 1000 });
set('c2', { qty: 182, price: 1000 }); set('d1', { qty: 1, price: 50000 });
set('d2', { qty: 13, price: 20000 }); set('g1', { qty: 2, price: 35000, sharePct: 0.30 });
const t = s.recalcAsgardSmeta(e).totals;
console.log('COST=' + t.cost + ' VAT=' + t.vat_amount + ' WITH=' + t.price_with_vat + ' NOVAT=' + t.price_no_vat);
"""

EXPECT_RUNTIME = "COST=6530947.5 VAT=2152902.68 WITH=11938823.93 NOVAT=9785921.25"


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
    print(f"DEPLOY D-181 «НДС в целых копейках» (смета РП) — shell {VER}")
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
    print(f"маркеры: OK ({len(MARKERS)}/{len(MARKERS)}); файлов к заливке: {len(FILES)}")
    for f in FILES:
        print(f"   ~ {f}")

    # ── 1. снапшот на проде ────────────────────────────────────────────────
    print("\n=== 1. SNAPSHOT ===")
    ssh(f"mkdir -p /root/snapshots && tar -C {PROJECT} -czf {SNAP} "
        f"src/services/asgard-smeta.js public/assets/js/asgard_smeta.js public/index.html public/sw.js "
        f"2>/dev/null; ls -lh {SNAP}")

    # ── 2. заливка ЯВНОГО списка: tar + scp + распаковка + md5-сверка ──────
    print("\n=== 2. UPLOAD (tar+scp, явный список) ===")
    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "smeta-vatfix.tgz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in FILES:
                tar.add(ROOT / rel, arcname=rel)
        print(f"tar: {len(FILES)} файлов, {tar_path.stat().st_size} Б")
        remote_tar = f"/tmp/asgard-smeta-vatfix-{STAMP}.tgz"
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

    # ── 3. рантайм-проверка НДС НА ПРОДЕ (не unit-тест) ───────────────────
    print("\n=== 3. RUNTIME VAT CHECK на проде ===")
    with tempfile.TemporaryDirectory() as tmp:
        js_path = Path(tmp) / "_vat_check.js"
        js_path.write_text(RUNTIME_JS, encoding="utf-8")
        scp_retry(str(js_path), "/tmp/_vat_check.js")
    res = ssh(f"cd {PROJECT} && DB_PASSWORD=123456789 DB_USER=asgard DB_NAME=asgard_crm "
              f"node /tmp/_vat_check.js; rm -f /tmp/_vat_check.js")
    out = (res.stdout or "").strip()
    print(f"  прод-движок: {out}")
    if EXPECT_RUNTIME not in out:
        raise SystemExit(f"РАНТАЙМ НЕ СОШЁЛСЯ:\n  ожидалось: {EXPECT_RUNTIME}\n  получено:  {out}")
    print("  OK  — НДС считается в копейках (.68 / .93)")

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

    ssh("journalctl -u asgard-crm -n 20 --no-pager | tail -20")

    print("\n=== DEPLOY DONE ===")
    print(f"shell {VER}; снапшот: {SNAP}")
    print("Дальше (post-deploy, порядок важен — D-166):")
    print("  python tools/restore_asset_sync.py plan")
    print("  node tools/audit_silent_reverts.js --post-deploy")


if __name__ == "__main__":
    main()
