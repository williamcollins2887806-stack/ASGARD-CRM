#!/usr/bin/env python3
import io
import sys
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"

SQL = """
SELECT t.id,
       LEFT(COALESCE(t.customer_name,''), 50) AS customer,
       LEFT(COALESCE(t.tender_title,''), 40) AS title,
       t.registry_status,
       t.source_pre_tender_id,
       LEFT(COALESCE(t.comment_to,''), 40) AS comment
FROM tenders t
WHERE t.deleted_at IS NULL
  AND COALESCE(t.registry_status, 'рассмотрение') = 'рассмотрение'
ORDER BY t.id DESC
LIMIT 40;
"""

EXCLUSION_SQL = """
SELECT COUNT(*)::int AS visible_after_filter
FROM tenders t
LEFT JOIN users cb ON cb.id = t.created_by
WHERE t.deleted_at IS NULL
  AND COALESCE(t.registry_status, 'рассмотрение') = 'рассмотрение'
  AND t.source_pre_tender_id IS NULL
  AND LOWER(COALESCE(t.tender_title, '')) NOT LIKE 'st-%'
  AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE 'st-%'
  AND LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%auto-tender%'
  AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%auto-tender%'
  AND LOWER(COALESCE(t.comment_to, '')) NOT LIKE '%авто-tender из pre_tender%'
  AND LOWER(COALESCE(t.comment_to, '')) NOT LIKE '%создано из заявки #%'
  AND LOWER(COALESCE(t.comment_to, '')) NOT LIKE '%быстрый путь из заявки%'
  AND LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%<script%'
  AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%<script%'
  AND LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%javascript:%'
  AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%javascript:%'
  AND LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%<iframe%'
  AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%<iframe%'
  AND LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%<embed%'
  AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%<embed%'
  AND LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%admin-matrix%'
  AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%admin-matrix%'
  AND LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%conc-8 race%'
  AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%conc-8 race%'
  AND LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%audit-3 update%'
  AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%audit-3 update%'
  AND NOT (LOWER(COALESCE(t.customer_name, '')) = 'новый заказчик'
       AND LOWER(COALESCE(t.tender_title, '')) IN ('', 'новый тендер'))
  AND LOWER(COALESCE(cb.name, '')) NOT LIKE 'test %';
"""

T767_SQL = """
SELECT t.id, t.customer_name, t.tender_title, t.registry_status, t.source_pre_tender_id, t.comment_to
FROM tenders t WHERE t.id IN (767, 1863, 853, 855);
"""


def run(client, sql):
    remote = "/tmp/asgard_query.sql"
    sftp = client.open_sftp()
    with sftp.file(remote, "w") as f:
        f.write(sql)
    sftp.close()
    _, o, e = client.exec_command(f"sudo -u postgres psql -d asgard_crm -f {remote}", timeout=60)
    return o.read().decode(), e.read().decode()


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    print("=== All рассмотрение (last 40) ===")
    out, err = run(c, SQL)
    print(out)
    if err:
        print(err[:400])
    print("=== Visible in PM duty after exclusion filter ===")
    out2, _ = run(c, EXCLUSION_SQL)
    print(out2)
    print("=== Specific tenders ===")
    out3, _ = run(c, T767_SQL)
    print(out3)
    c.close()


if __name__ == "__main__":
    main()
