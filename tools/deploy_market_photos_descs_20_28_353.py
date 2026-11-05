#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy description/photo services + generate all AI photos + backfill descriptions."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import paramiko  # noqa: E402
import shell_guard  # noqa: E402

SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"

FILES = [
    "src/services/market-card-description.js",
    "src/services/market-ai-cron.js",
    "src/services/market-card-photo.js",
    "src/services/market-ai-jobs.js",
    "src/services/warehouse-market.js",
    "tools/generate_market_card_photos.js",
    "tools/backfill_market_descriptions.js",
    "public/assets/js/warehouse-v2.js",
    "public/assets/css/warehouse-market.css",
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


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print("=== START photos+descs deploy ===", flush=True)
    try:
        print("=== SHELL GUARD ===", flush=True)
        shell_guard.assert_ok(deploy_gate=False)
    except Exception as e:
        print("shell_guard warn:", e, flush=True)

    key = load_pkey(SSH_KEY)
    print("ssh key loaded", flush=True)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)
    sftp = ssh.open_sftp()
    for rel in FILES:
        local = ROOT / rel
        if not local.exists():
            print("skip missing", rel)
            continue
        remote = f"{REMOTE}/{rel}"
        ssh.exec_command(f"mkdir -p {remote.rsplit('/', 1)[0]}")
        sftp.put(str(local), remote)
        print("scp", rel)
    sftp.close()

    def run(cmd, timeout=7200):
        print(">>", cmd[:200])
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        print(out[-3500:])
        if err.strip():
            print("ERR", err[-1500:])
        print("exit", code)
        return code, out

    # clear block if any
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
        "\"UPDATE settings SET value_json='null'::jsonb, updated_at=NOW() WHERE key='market_ai_blocked_until'; "
        "UPDATE market_ai_jobs SET status='pending', next_run_at=NOW() WHERE status='blocked';\"",
        60,
    )

    # photos: all placeholders → AI (budget ~800 ₽)
    code_p, out_p = run(
        f"cd {REMOTE} && node tools/generate_market_card_photos.js --apply --max-cost 900 --max-photos 500 --limit 200",
        7200,
    )

    # descriptions: stock first, then rest (concurrency 2)
    code_d, out_d = run(
        f"cd {REMOTE} && node tools/backfill_market_descriptions.js --apply --stock-first --limit 2500 --concurrency 2",
        14400,
    )

    _i, o, e = ssh.exec_command(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A -c "
        "\"SELECT json_build_object("
        "'ai_heroes',(SELECT COUNT(*) FROM market_card_archetypes WHERE photo_source='ai'),"
        "'placeholder',(SELECT COUNT(*) FROM market_card_archetypes WHERE photo_source='placeholder'),"
        "'p_desc',(SELECT COUNT(*) FROM products WHERE deleted_at IS NULL AND attrs->>'description_ai' IS NOT NULL AND btrim(attrs->>'description_ai')<>''),"
        "'p_total',(SELECT COUNT(*) FROM products WHERE deleted_at IS NULL),"
        "'e_desc',(SELECT COUNT(*) FROM equipment WHERE deleted_at IS NULL AND attrs->>'description_ai' IS NOT NULL AND btrim(attrs->>'description_ai')<>''),"
        "'e_total',(SELECT COUNT(*) FROM equipment WHERE deleted_at IS NULL)"
        ");\"",
        timeout=60,
    )
    counts = o.read().decode("utf-8", "replace").strip()
    print("COUNTS", counts)

    run("systemctl restart asgard-crm", 60)

    report = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "photos_exit": code_p,
        "desc_exit": code_d,
        "counts": json.loads(counts) if counts.startswith("{") else counts,
        "ok": code_p == 0 and code_d == 0,
    }
    out_path = ROOT / "tests/reports/market-card-clusters/PHOTOS-DESCS-RUN.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    # fetch remote reports if any
    sftp = ssh.open_sftp()
    for name in ("GENERATE-PHOTOS-REPORT.json", "DESC-BACKFILL.json"):
        try:
            sftp.get(
                f"{REMOTE}/tests/reports/market-card-clusters/{name}",
                str(ROOT / "tests/reports/market-card-clusters" / name),
            )
            print("got", name)
        except Exception as ex:
            print("no", name, ex)
    sftp.close()
    ssh.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["ok"] else 2)


if __name__ == "__main__":
    main()
