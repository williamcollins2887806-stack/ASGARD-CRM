#!/usr/bin/env python3
"""Smoke checks after RP workflow deploy."""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)

    def psql(sql):
        cmd = f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A -c \"{sql}\""
        _, o, e = c.exec_command(cmd, timeout=60)
        return (o.read().decode("utf-8", errors="replace") + e.read().decode("utf-8", errors="replace")).strip()

    print("=== Tender 1914 (Vnukovo) ===")
    print(psql("SELECT id, registry_status, calculator_user_id, calculator_kind FROM tenders WHERE id=1914"))
    print(psql(
        "SELECT analysis_finalized_at IS NOT NULL AS analysis_done, is_final, calculator_user_id "
        "FROM tender_rp_reviews WHERE tender_id=1914"
    ))

    print("\n=== Remaining stuck tenders (should be 0) ===")
    print(psql(
        "SELECT COUNT(*) FROM tenders t JOIN tender_rp_reviews rev ON rev.tender_id=t.id "
        "WHERE t.deleted_at IS NULL AND COALESCE(t.registry_status,'рассмотрение')='рассмотрение' "
        "AND rev.analysis_finalized_at IS NOT NULL AND (rev.is_final IS NULL OR rev.is_final=false) "
        "AND t.calculator_user_id IS NOT NULL "
        "AND t.calculator_user_id = rev.analysis_finalized_by_user_id"
    ))

    print("\n=== Analysis-ready without calculator (TO can assign) ===")
    print(psql(
        "SELECT COUNT(*) FROM tenders t JOIN tender_rp_reviews rev ON rev.tender_id=t.id "
        "WHERE t.deleted_at IS NULL AND COALESCE(t.registry_status,'рассмотрение')='рассмотрение' "
        "AND rev.analysis_finalized_at IS NOT NULL AND (rev.is_final IS NULL OR rev.is_final=false) "
        "AND t.calculator_user_id IS NULL"
    ))

    print("\n=== API ===")
    _, o, _ = c.exec_command("curl -s http://localhost:3000/api/version", timeout=30)
    print(o.read().decode().strip())

    c.close()


if __name__ == "__main__":
    main()
