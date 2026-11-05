#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy V450 market card pipeline: schema + services + backfill placeholders + verify."""
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


def load_pkey(path: str):
    for loader in (getattr(paramiko, "Ed25519Key", None), getattr(paramiko, "ECDSAKey", None), paramiko.RSAKey):
        if loader is None:
            continue
        try:
            return loader.from_private_key_file(path)
        except Exception:
            continue
    raise SystemExit(f"cannot load SSH key: {path}")

FILES = [
    "migrations/V450__market_card_pipeline.sql",
    "migrations/V450__market_card_pipeline_down.sql",
    "src/services/market-card-archetype.js",
    "src/services/market-card-photo.js",
    "src/services/market-ai-jobs.js",
    "src/services/market-ai-cron.js",
    "src/services/catalog-from-invoice.js",
    "src/services/warehouse-market.js",
    "src/index.js",
    "tools/backfill_market_card_keys.js",
    "tools/generate_market_card_photos.js",
    "tools/run_market_ai_jobs.js",
    "tools/verify_market_card_pipeline.js",
    "tests/reports/market-card-clusters/AGENT-TAXONOMY.json",
]


def connect():
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
            return ssh
        except Exception as e:
            print(f"ssh: attempt {attempt} failed: {e}")
            if attempt == 5:
                raise SystemExit("ssh: cannot connect")
            time.sleep(3)
    raise SystemExit("ssh: cannot connect")


def run(ssh, cmd, timeout=600):
    print(">>", cmd[:200])
    _i, o, e = ssh.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out[-4000:])
    if err.strip():
        print("ERR:", err[-2000:])
    return code, out, err


def main():
    print("=== SHELL GUARD (no shell bump; backend+migration) ===")
    shell_guard.assert_ok(deploy_gate=False)

    ssh = connect()
    sftp = ssh.open_sftp()
    try:
        for rel in FILES:
            local = ROOT / rel
            if not local.exists():
                raise SystemExit(f"missing {rel}")
            remote = f"{REMOTE}/{rel.replace(chr(92), '/')}"
            remote_dir = "/".join(remote.split("/")[:-1])
            run(ssh, f"mkdir -p {remote_dir}", timeout=30)
            print(f"scp {rel}")
            sftp.put(str(local), remote)

        # apply migration
        code, out, err = run(
            ssh,
            f"cd {REMOTE} && PGPASSWORD=123456789 psql -U asgard -d asgard_crm "
            f"-f migrations/V450__market_card_pipeline.sql",
            timeout=120,
        )
        if code != 0:
            raise SystemExit(f"migration failed: {code}")

        # backfill keys + placeholders (no AI spend)
        code, out, err = run(
            ssh,
            f"cd {REMOTE} && node tools/backfill_market_card_keys.js --apply --placeholders",
            timeout=900,
        )
        if code != 0:
            raise SystemExit(f"backfill failed: {code}")

        # verify coverage + smoke invoice with AI blocked
        code, out, err = run(
            ssh,
            f"cd {REMOTE} && node tools/verify_market_card_pipeline.js --smoke-invoice",
            timeout=180,
        )
        verify_ok = code == 0

        # restart app so cron registers
        run(ssh, "systemctl restart asgard-crm", timeout=60)
        time.sleep(3)
        run(ssh, "systemctl is-active asgard-crm", timeout=30)

        # fetch verify report
        remote_report = f"{REMOTE}/tests/reports/market-card-clusters/PIPELINE-VERIFY.json"
        local_report = ROOT / "tests/reports/market-card-clusters/PIPELINE-VERIFY.json"
        try:
            sftp.get(remote_report, str(local_report))
            print("saved", local_report)
        except Exception as e:
            print("report fetch:", e)

        summary = {
            "verify_ok": verify_ok,
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        out_path = ROOT / "tests/reports/market-card-clusters/DEPLOY-PIPELINE.json"
        out_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        if not verify_ok:
            raise SystemExit(2)
    finally:
        sftp.close()
        ssh.close()


if __name__ == "__main__":
    main()
