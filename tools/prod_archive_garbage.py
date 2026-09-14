#!/usr/bin/env python3
"""Archive test/garbage рассмотрение rows (including those with works)."""
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
APPLY = "--apply" in sys.argv

GARBAGE_WHERE = """
t.deleted_at IS NULL
AND COALESCE(t.registry_status, 'рассмотрение') = 'рассмотрение'
AND (
  t.source_pre_tender_id IS NOT NULL
  OR LOWER(COALESCE(t.tender_title, '')) LIKE 'st-%'
  OR LOWER(COALESCE(t.customer_name, '')) LIKE 'st-%'
  OR LOWER(COALESCE(t.tender_title, '')) LIKE '%auto-tender%'
  OR LOWER(COALESCE(t.customer_name, '')) LIKE '%auto-tender%'
  OR LOWER(COALESCE(t.comment_to, '')) LIKE '%авто-tender из pre_tender%'
  OR LOWER(COALESCE(t.comment_to, '')) LIKE '%создано из заявки #%'
  OR LOWER(COALESCE(t.comment_to, '')) LIKE '%быстрый путь из заявки%'
  OR LOWER(COALESCE(t.tender_title, '')) LIKE '%<script%'
  OR LOWER(COALESCE(t.customer_name, '')) LIKE '%<script%'
  OR LOWER(COALESCE(t.tender_title, '')) LIKE '%javascript:%'
  OR LOWER(COALESCE(t.customer_name, '')) LIKE '%javascript:%'
  OR LOWER(COALESCE(t.tender_title, '')) LIKE '%<iframe%'
  OR LOWER(COALESCE(t.customer_name, '')) LIKE '%<iframe%'
  OR LOWER(COALESCE(t.tender_title, '')) LIKE '%<embed%'
  OR LOWER(COALESCE(t.customer_name, '')) LIKE '%<embed%'
  OR LOWER(COALESCE(t.tender_title, '')) LIKE '%admin-matrix%'
  OR LOWER(COALESCE(t.customer_name, '')) LIKE '%admin-matrix%'
  OR LOWER(COALESCE(t.tender_title, '')) LIKE '%conc-8 race%'
  OR LOWER(COALESCE(t.customer_name, '')) LIKE '%conc-8 race%'
  OR LOWER(COALESCE(t.tender_title, '')) LIKE '%audit-3 update%'
  OR LOWER(COALESCE(t.customer_name, '')) LIKE '%audit-3 update%'
  OR LOWER(COALESCE(t.tender_title, '')) LIKE '%&#60;script%'
  OR LOWER(COALESCE(t.customer_name, '')) LIKE '%&#60;script%'
  OR LOWER(COALESCE(t.customer_name, '')) = 'ооо "валидация"'
  OR LOWER(COALESCE(t.customer_name, '')) LIKE '%кавычки & <теги>%'
  OR (LOWER(COALESCE(t.customer_name, '')) = 'новый заказчик'
      AND LOWER(COALESCE(t.tender_title, '')) IN ('', 'новый тендер'))
)
"""

COUNT_SQL = f"SELECT COUNT(*)::int FROM tenders t WHERE {GARBAGE_WHERE};"
LIST_SQL = (
    "SELECT t.id, LEFT(COALESCE(t.customer_name,''),40), LEFT(COALESCE(t.tender_title,''),30) "
    f"FROM tenders t WHERE {GARBAGE_WHERE} ORDER BY t.id;"
)
UPDATE_SQL = (
    "UPDATE tenders t SET registry_status = 'отмена', "
    "tender_status = COALESCE(NULLIF(tender_status, ''), 'Не подходит'), updated_at = NOW() "
    f"WHERE {GARBAGE_WHERE.replace('t.', 't.')};"
)


def run_psql(client, sql):
    remote = "/tmp/asgard_archive_garbage.sql"
    sftp = client.open_sftp()
    with sftp.file(remote, "w") as f:
        f.write(sql)
    sftp.close()
    _, o, e = client.exec_command(f"sudo -u postgres psql -d asgard_crm -f {remote}", timeout=120)
    return o.read().decode().strip(), e.read().decode().strip()


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    count, _ = run_psql(c, COUNT_SQL)
    print("garbage рассмотрение matched:", count)
    out, _ = run_psql(c, LIST_SQL)
    if out:
        print(out)
    if APPLY and count and count != "0":
        updated, err = run_psql(c, UPDATE_SQL)
        print("updated:", updated or "ok")
        if err:
            print(err[:400])
        after, _ = run_psql(c, COUNT_SQL)
        print("remaining:", after)
    elif not APPLY:
        print("dry-run. Pass --apply to archive.")
    c.close()


if __name__ == "__main__":
    main()
