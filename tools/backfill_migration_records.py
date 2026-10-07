#!/usr/bin/env python3
"""Backfill migrations table for schema already applied on prod (no DDL)."""
import sys
from pathlib import Path

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"

# name -> SQL that must return at least one row if schema is present
CHECKS = [
    (
        "V278__registry_loss_fields",
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='tenders' AND column_name='loss_winner_price' LIMIT 1",
    ),
    (
        "V279__rp_review_analysis_phase",
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='tender_rp_reviews' AND column_name='analysis_finalized_at' LIMIT 1",
    ),
    (
        "V280__rp_review_report_file",
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='tender_rp_reviews' AND column_name='report_file_id' LIMIT 1",
    ),
    (
        "V281__registry_review_notify_seen",
        "SELECT to_regclass('public.tender_registry_review_seen')",
    ),
    (
        "V283__registry_no_and_review_thread",
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='tenders' AND column_name='registry_no' LIMIT 1",
    ),
    (
        "V285__reminder_contact_fields",
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='personal_kanban_card_reminders' AND column_name='contact_phone' LIMIT 1",
    ),
    (
        "V287__works_one_main_per_tender",
        "SELECT 1 FROM pg_indexes "
        "WHERE tablename='works' AND indexname='idx_works_one_main_per_tender' LIMIT 1",
    ),
    # Data-only migrations: marker = "the data fix is already in place".
    # chr(8212) = em dash, avoids Cyrillic in the shell-quoted psql command (D-142b).
    (
        "V368__direct_chat_peer_name",
        "SELECT CASE WHEN count(*)=0 THEN 1 ELSE 0 END FROM chats "
        "WHERE type='direct' AND COALESCE(is_group,false)=false "
        "AND position(chr(8212) in name) > 0",
    ),
    (
        "V369__direct_bot_chat_peer_name",
        "SELECT CASE WHEN count(*)=0 THEN 1 ELSE 0 END FROM chats c "
        "WHERE c.type='direct' AND COALESCE(c.is_group,false)=false "
        "AND EXISTS (SELECT 1 FROM chat_group_members m JOIN users u ON u.id=m.user_id "
        "WHERE m.chat_id=c.id AND u.role='BOT') "
        "AND c.name IS DISTINCT FROM (SELECT u2.name FROM chat_group_members m2 "
        "JOIN users u2 ON u2.id=m2.user_id WHERE m2.chat_id=c.id AND u2.role='BOT' LIMIT 1)",
    ),
]


def main():
    if not KEY.exists():
        print(f"ERROR: SSH key not found: {KEY}", file=sys.stderr)
        sys.exit(1)

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)

    def psql(sql):
        cmd = f'PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A -c "{sql}"'
        _, o, e = c.exec_command(cmd, timeout=60)
        return (o.read() + e.read()).decode("utf-8", "replace").strip()

    print("=== Backfill migration records (schema check first) ===\n")
    inserted = 0
    skipped = 0

    for name, check_sql in CHECKS:
        existing = psql(f"SELECT 1 FROM migrations WHERE name='{name}' LIMIT 1")
        if existing == "1":
            print(f"[skip] {name}: already recorded")
            skipped += 1
            continue

        marker = psql(check_sql)
        if not marker or marker.startswith("ERROR"):
            print(f"[warn] {name}: schema marker missing — NOT inserting")
            print(f"       check result: {marker[:120]}")
            skipped += 1
            continue

        result = psql(
            f"INSERT INTO migrations (name) VALUES ('{name}') "
            f"ON CONFLICT (name) DO NOTHING RETURNING name"
        )
        if name in result:
            print(f"[ok]   {name}: inserted")
            inserted += 1
        else:
            print(f"[skip] {name}: already exists or conflict")
            skipped += 1

    print(f"\n=== Done: inserted={inserted}, skipped={skipped} ===")
    print("\nMigrations V270+:")
    print(psql("SELECT name FROM migrations WHERE name >= 'V270' ORDER BY name"))
    c.close()


if __name__ == "__main__":
    main()
