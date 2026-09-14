#!/usr/bin/env python3
"""Archive stale/test registry rows on prod via direct SQL (no API restart needed)."""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
APPLY = "--apply" in sys.argv

COUNT_SQL = (
    "SELECT COUNT(*)::int FROM tenders t "
    "LEFT JOIN works w ON w.tender_id = t.id AND w.deleted_at IS NULL "
    "WHERE t.deleted_at IS NULL AND w.id IS NULL "
    "AND COALESCE(t.registry_status, 'рассмотрение') NOT IN ('отмена', 'выиграли', 'проиграли', 'подались') "
    "AND (t.period < '2026-01' "
    "OR (t.docs_deadline IS NOT NULL AND t.docs_deadline::date < (CURRENT_DATE - INTERVAL '62 days')) "
    "OR LOWER(COALESCE(t.customer_name, '')) LIKE '%test%' "
    "OR LOWER(COALESCE(t.tender_title, '')) LIKE '%test%' "
    "OR LOWER(COALESCE(t.customer_name, '')) LIKE '%тест%' "
    "OR LOWER(COALESCE(t.tender_title, '')) LIKE '%тест%' "
    "OR LOWER(COALESCE(t.customer_name, '')) LIKE '%post deadline%' "
    "OR LOWER(COALESCE(t.tender_title, '')) LIKE 'st-%' "
    "OR LOWER(COALESCE(t.tender_title, '')) LIKE '%auto-tender%' "
    "OR LOWER(COALESCE(t.tender_title, '')) LIKE '%<script%' "
    "OR LOWER(COALESCE(t.tender_title, '')) LIKE '%javascript:%' "
    "OR LOWER(COALESCE(t.tender_title, '')) LIKE '%<iframe%' "
    "OR LOWER(COALESCE(t.tender_title, '')) LIKE '%admin-matrix%' "
    "OR LOWER(COALESCE(t.tender_title, '')) LIKE '%conc-8 race%' "
    "OR LOWER(COALESCE(t.tender_title, '')) LIKE '%audit-3 update%' "
    "OR LOWER(COALESCE(t.tender_title, '')) LIKE '%<embed%' "
    "OR t.source_pre_tender_id IS NOT NULL "
    "OR LOWER(COALESCE(t.comment_to, '')) LIKE '%авто-tender из pre_tender%' "
    "OR LOWER(COALESCE(t.comment_to, '')) LIKE '%создано из заявки #%' "
    "OR LOWER(COALESCE(t.comment_to, '')) LIKE '%быстрый путь из заявки%' "
    "OR (LOWER(COALESCE(t.customer_name, '')) = 'новый заказчик' AND LOWER(COALESCE(t.tender_title, '')) IN ('', 'новый тендер')));"
)

UPDATE_SQL = (
    "UPDATE tenders t SET registry_status = 'отмена', "
    "tender_status = COALESCE(NULLIF(tender_status, ''), 'Не подходит'), updated_at = NOW() "
    "FROM (SELECT t2.id FROM tenders t2 "
    "LEFT JOIN works w ON w.tender_id = t2.id AND w.deleted_at IS NULL "
    "WHERE t2.deleted_at IS NULL AND w.id IS NULL "
    "AND COALESCE(t2.registry_status, 'рассмотрение') NOT IN ('отмена', 'выиграли', 'проиграли', 'подались') "
    "AND (t2.period < '2026-01' "
    "OR (t2.docs_deadline IS NOT NULL AND t2.docs_deadline::date < (CURRENT_DATE - INTERVAL '62 days')) "
    "OR LOWER(COALESCE(t2.customer_name, '')) LIKE '%test%' "
    "OR LOWER(COALESCE(t2.tender_title, '')) LIKE '%test%' "
    "OR LOWER(COALESCE(t2.customer_name, '')) LIKE '%тест%' "
    "OR LOWER(COALESCE(t2.tender_title, '')) LIKE '%тест%' "
    "OR LOWER(COALESCE(t2.customer_name, '')) LIKE '%post deadline%' "
    "OR LOWER(COALESCE(t2.tender_title, '')) LIKE 'st-%' "
    "OR LOWER(COALESCE(t2.tender_title, '')) LIKE '%auto-tender%' "
    "OR LOWER(COALESCE(t2.tender_title, '')) LIKE '%<script%' "
    "OR LOWER(COALESCE(t2.tender_title, '')) LIKE '%javascript:%' "
    "OR LOWER(COALESCE(t2.tender_title, '')) LIKE '%<iframe%' "
    "OR LOWER(COALESCE(t2.tender_title, '')) LIKE '%admin-matrix%' "
    "OR LOWER(COALESCE(t2.tender_title, '')) LIKE '%conc-8 race%' "
    "OR LOWER(COALESCE(t2.tender_title, '')) LIKE '%audit-3 update%' "
    "OR LOWER(COALESCE(t2.tender_title, '')) LIKE '%<embed%' "
    "OR t2.source_pre_tender_id IS NOT NULL "
    "OR LOWER(COALESCE(t2.comment_to, '')) LIKE '%авто-tender из pre_tender%' "
    "OR LOWER(COALESCE(t2.comment_to, '')) LIKE '%создано из заявки #%' "
    "OR LOWER(COALESCE(t2.comment_to, '')) LIKE '%быстрый путь из заявки%' "
    "OR (LOWER(COALESCE(t2.customer_name, '')) = 'новый заказчик' AND LOWER(COALESCE(t2.tender_title, '')) IN ('', 'новый тендер')))) s "
    "WHERE t.id = s.id;"
)


def run_psql(client, sql):
    remote = "/tmp/asgard_archive_stale.sql"
    sftp = client.open_sftp()
    with sftp.file(remote, "w") as f:
        f.write(sql)
    sftp.close()
    cmd = f"sudo -u postgres psql -d asgard_crm -t -A -f {remote}"
    _, o, e = client.exec_command(cmd, timeout=120)
    out = o.read().decode().strip()
    err = e.read().decode().strip()
    if err:
        print("stderr:", err[:800])
    return out


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    count = run_psql(c, COUNT_SQL)
    print("matched:", count)
    if APPLY and count and count != "0":
        updated = run_psql(c, UPDATE_SQL)
        print("updated:", updated or "ok")
        after = run_psql(c, COUNT_SQL)
        print("remaining:", after)
    elif not APPLY:
        print("dry-run only. Pass --apply to archive.")
    c.close()


if __name__ == "__main__":
    main()
