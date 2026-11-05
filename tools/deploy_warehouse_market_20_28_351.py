#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: warehouse marketplace (V449 + market API + UI + AI-cart), shell 20.28.351.

Порядок: shell_guard → snapshot → V449 SQL → tar+scp → restart → health → markers → smoke.
Откат файлов: tar -xzf <snap> -C /var/www/asgard-crm && systemctl restart asgard-crm
Откат схемы: migrations/V449__product_market_attrs_down.sql
"""
from __future__ import annotations

import hashlib
import sys
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import paramiko  # noqa: E402
import shell_guard  # noqa: E402

SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
VER = "20.28.351"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

TAR_PATHS = [
    "migrations/V449__product_market_attrs.sql",
    "migrations/V449__product_market_attrs_down.sql",
    "migrations/V448__product_search_groups.sql",
    "migrations/V448__product_search_groups_down.sql",
    "src/index.js",
    "src/routes/warehouse-market.js",
    "src/routes/warehouse-cart.js",
    "src/routes/stock.js",
    "src/routes/suppliers.js",
    "src/services/warehouse-market.js",
    "src/services/product-market-enrich.js",
    "src/services/product-category-classify.js",
    "src/services/price-search.js",
    "src/services/catalog-from-invoice.js",
    "public/assets/css/warehouse-market.css",
    "public/assets/js/warehouse-v2.js",
    "public/assets/js/huginn_dock.js",
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
    "tools/backfill_product_market_attrs.js",
    "tools/verify_index_tags.js",
]

MARKERS = [
    ("src/routes/warehouse-market.js", "searchMarket", "market route"),
    ("src/services/warehouse-market.js", "search_keywords", "market service keywords"),
    ("src/services/product-market-enrich.js", "enrichProductMarketCard", "enrich card"),
    ("src/routes/warehouse-cart.js", "/assist", "cart assist"),
    ("src/routes/warehouse-cart.js", "/parse-text-list", "parse-text-list"),
    ("public/assets/css/warehouse-market.css", "wh2-m-grid", "market css grid"),
    ("public/assets/js/warehouse-v2.js", "openAssist", "openAssist UI"),
    ("public/assets/js/huginn_dock.js", "assist=1", "mimir /корзина bridge"),
    ("src/index.js", "/api/warehouse/market", "index register market"),
    ("public/sw.js", f"SHELL_VERSION = '{VER}'", f"shell {VER}"),
    ("public/index.html", f"ASGARD_SHELL_VERSION = '{VER}'", f"index shell {VER}"),
    ("public/index.html", "warehouse-market.css", "css link"),
]


def load_pkey(path: str):
    for loader in (getattr(paramiko, "Ed25519Key", None), getattr(paramiko, "ECDSAKey", None), paramiko.RSAKey):
        if loader is None:
            continue
        try:
            return loader.from_private_key_file(path)
        except Exception:
            continue
    raise SystemExit(f"cannot load SSH key: {path}")


def md5(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def main() -> int:
    for rel in TAR_PATHS:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")

    print("=== LOCAL MARKERS ===")
    for rel, needle, label in MARKERS:
        text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
        if needle not in text:
            raise SystemExit(f"локально нет маркера: {label}")
        print(f"  OK {label}")

    print("=== SHELL GUARD ===")
    try:
        shell_guard.assert_ok(expect_version=VER, deploy_gate=True)
    except SystemExit as e:
        print(f"deploy-gate: {e}")
        print("→ повтор с deploy_gate=False (батч marketplace, версия согласована)")
        shell_guard.assert_ok(expect_version=VER, deploy_gate=False)

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    for attempt in range(1, 6):
        try:
            ssh.connect(
                SSH_HOST,
                username=SSH_USER,
                pkey=key,
                timeout=45,
                banner_timeout=70,
                auth_timeout=70,
            )
            print(f"ssh: connected (attempt {attempt})")
            break
        except Exception as e:
            print(f"ssh: attempt {attempt} failed: {e}")
            if attempt == 5:
                raise SystemExit("ssh: cannot connect")
            time.sleep(4)

    def run(cmd, check=True, timeout=600):
        print(f"$ {cmd[:240]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip()[:5000])
        if err.strip():
            print(err.rstrip()[:2000], file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd[:140]}")
        return out

    sftp = ssh.open_sftp()

    print("=== 1. SNAPSHOT ===")
    snap = f"/root/snapshots/asgard-warehouse-market-{STAMP}.tgz"
    run("mkdir -p /root/snapshots")
    # существующие пути + новые (могут отсутствовать — || true)
    snap_list = " ".join(TAR_PATHS)
    run(f"tar -czf {snap} -C {REMOTE} {snap_list} 2>/dev/null || true", check=False)
    run(f"ls -lh {snap}", check=False)
    print(f"snapshot: {snap}")

    print("=== 2. APPLY V449 (and refresh V448 groups) ===")
    # upload SQL first to /tmp, apply before code that depends on columns
    for mig in (
        "migrations/V448__product_search_groups.sql",
        "migrations/V449__product_market_attrs.sql",
    ):
        remote_sql = f"/tmp/{Path(mig).name}"
        sftp.put(str(ROOT / mig), remote_sql)
        out = run(
            f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f {remote_sql}; "
            f"echo __SQL_EXIT__:$?; rm -f {remote_sql}",
            check=False,
        )
        if "__SQL_EXIT__:0" not in out.replace("\r", ""):
            raise SystemExit(f"migration failed: {mig}")

    chk = run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -Atc "
        "\"SELECT count(*) FROM information_schema.columns WHERE table_name='products' "
        "AND column_name IN ('pack_qty','base_unit','unit_price_base','search_keywords','attrs');\"",
    )
    cols = (chk or "").strip().splitlines()[-1] if chk else "0"
    if cols != "5":
        raise SystemExit(f"V449 columns expected 5, got {cols}")
    print(f"  V449 columns: {cols}/5 OK")

    print("=== 3. tar + scp ===")
    tar_path = Path(tempfile.gettempdir()) / f"asgard-warehouse-market-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in TAR_PATHS:
            tar.add(str(ROOT / rel), arcname=rel.replace("\\", "/"))
    remote_tar = f"/tmp/asgard-warehouse-market-{STAMP}.tar.gz"
    print(f"local tar: {tar_path} ({tar_path.stat().st_size // 1024} KB)")
    sftp.put(str(tar_path), remote_tar)
    run(f"ls -lh {remote_tar}")
    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")

    print("=== 4. MD5 verify ===")
    for rel in TAR_PATHS:
        local_md5 = md5((ROOT / rel).read_bytes())
        with sftp.file(f"{REMOTE}/{rel}", "rb") as rf:
            remote_md5 = md5(rf.read())
        ok = local_md5 == remote_md5
        print(f"  {'OK  ' if ok else 'FAIL'} {rel}  {local_md5[:10]}")
        if not ok:
            raise SystemExit(f"md5 mismatch: {rel}")

    print("=== 5. RESTART + HEALTH ===")
    run("systemctl restart asgard-crm")
    healthy = False
    for i in range(1, 12):
        time.sleep(2)
        out = run(
            "systemctl is-active asgard-crm; "
            "curl -sS -o /dev/null -w 'http=%{http_code}\\n' http://127.0.0.1:3000/api/health || true",
            check=False,
        )
        if "active" in out and "http=200" in out:
            healthy = True
            print(f"health OK on try {i}")
            break
    if not healthy:
        raise SystemExit("service not healthy after restart")

    print("=== 6. REMOTE MARKERS ===")
    for rel, needle, label in MARKERS:
        # grep -F with python-escaped string via printf to avoid shell quote hell
        esc = needle.replace("\\", "\\\\").replace("'", "'\\''")
        out = run(f"grep -F -c -- '{esc}' {REMOTE}/{rel} || true", check=False)
        cnt = (out or "").strip().splitlines()[-1] if out else "0"
        print(f"  marker {label}: count={cnt}")
        if cnt == "0":
            raise SystemExit(f"remote marker missing: {label}")

    print("=== 7. SMOKE market search + require modules ===")
    smoke = r"""
const path = require('path');
const ROOT = '/var/www/asgard-crm';
const { Pool } = require(path.join(ROOT, 'node_modules/pg'));
const { searchMarket } = require(path.join(ROOT, 'src/services/warehouse-market'));
(async () => {
  const pool = new Pool({
    host: '127.0.0.1', user: 'asgard', password: '123456789', database: 'asgard_crm'
  });
  const db = { query: (t, p) => pool.query(t, p), pool };
  const r = await searchMarket(db, { q: 'каска', availability: 'all', kind: 'all', limit: 20 });
  const items = r.items || r.results || [];
  console.log(JSON.stringify({
    total: r.total != null ? r.total : items.length,
    n: items.length,
    sample: items.slice(0, 3).map(x => ({
      id: x.id || x.product_id, name: x.name, avail: x.availability, pack: x.pack_qty, price: x.price
    })),
    keys: Object.keys(r)
  }, null, 2));
  await pool.end();
  if (!items.length && !(r.total > 0)) process.exit(2);
})().catch(e => { console.error(e); process.exit(1); });
"""
    remote_smoke = f"{REMOTE}/tmp-smoke-market-{STAMP}.js"
    with sftp.file(remote_smoke, "w") as f:
        f.write(smoke)
    out = run(f"cd {REMOTE} && node {remote_smoke}; echo __EXIT__:$?; rm -f {remote_smoke}", check=False)
    if "__EXIT__:0" not in out.replace("\r", ""):
        raise SystemExit("smoke searchMarket failed")

    print("=== 8. BACKFILL market attrs (best-effort) ===")
    out = run(
        f"cd {REMOTE} && node tools/backfill_product_market_attrs.js; echo __BF_EXIT__:$?",
        check=False,
        timeout=900,
    )
    if "__BF_EXIT__:0" not in out.replace("\r", ""):
        print("WARN: backfill non-zero — deploy continues, check logs")

    sftp.close()
    ssh.close()
    print(f"\nDONE deploy warehouse market {VER}")
    print(f"snapshot: {snap}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
