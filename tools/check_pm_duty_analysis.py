#!/usr/bin/env python3
"""Count analysis queue for current duty PM on prod (same SQL as pm-duty.js)."""
import json
import sys
from pathlib import Path

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"

NODE = r"""
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://asgard:123456789@localhost/asgard_crm' });

const exclude = `
  AND (t.source_pre_tender_id IS NULL)
  AND (LOWER(COALESCE(t.tender_title, '')) NOT LIKE 'st-%' AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE 'st-%')
  AND (LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%auto-tender%' AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%auto-tender%')
  AND (LOWER(COALESCE(t.comment_to, '')) NOT LIKE '%авто-tender из pre_tender%')
  AND (LOWER(COALESCE(t.comment_to, '')) NOT LIKE '%создано из заявки #%')
  AND (LOWER(COALESCE(t.comment_to, '')) NOT LIKE '%быстрый путь из заявки%')
  AND (LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%<script%' AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%<script%')
  AND (LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%javascript:%' AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%javascript:%')
  AND (LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%<iframe%' AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%<iframe%')
  AND (LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%<embed%' AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%<embed%')
  AND (LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%admin-matrix%' AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%admin-matrix%')
  AND (LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%conc-8 race%' AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%conc-8 race%')
  AND (LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%audit-3 update%' AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%audit-3 update%')
  AND (LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%&#60;script%' AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%&#60;script%')
  AND (LOWER(COALESCE(t.tender_title, '')) NOT LIKE '%&lt;script%' AND LOWER(COALESCE(t.customer_name, '')) NOT LIKE '%&lt;script%')
  AND (NOT (LOWER(COALESCE(t.customer_name, '')) = 'новый заказчик' AND LOWER(COALESCE(t.tender_title, '')) IN ('', 'новый тендер')))
  AND (NOT (TRIM(COALESCE(t.customer_name, '')) = '' AND LOWER(COALESCE(t.tender_title, '')) = 'новый тендер'))
  AND (NOT (LOWER(COALESCE(t.customer_name, '')) IN ('ооо "валидация"', 'ооо "кавычки & <теги>"')))
  AND (LOWER(COALESCE(cb.name, '')) NOT LIKE 'test %')
`;

(async () => {
  const duty = await p.query(`
    SELECT d.pm_user_id, u.name AS pm_name, d.period_start::text, d.period_end::text,
           ab.name AS assigned_by_name
    FROM pm_duty_roster d
    JOIN users u ON u.id = d.pm_user_id
    LEFT JOIN users ab ON ab.id = d.assigned_by_user_id
    WHERE d.period_start <= CURRENT_DATE AND d.period_end >= CURRENT_DATE
    ORDER BY d.id DESC
    LIMIT 1
  `);
  if (!duty.rows.length) {
    console.log(JSON.stringify({ error: 'no_duty' }));
    await p.end();
    return;
  }
  const d = duty.rows[0];
  const q = `
    SELECT COUNT(*)::int AS c
    FROM tenders t
    LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
    LEFT JOIN users cb ON cb.id = t.created_by
    WHERE t.deleted_at IS NULL
      AND t.registry_status = 'рассмотрение'
      AND (rev.is_final IS NULL OR rev.is_final = false)
      ${exclude}
  `;
  const r = await p.query(q);
  const sample = await p.query(`
    SELECT t.id, t.customer_name, t.tender_title, t.docs_deadline::text,
           rev.is_final, rev.decision
    FROM tenders t
    LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
    LEFT JOIN users cb ON cb.id = t.created_by
    WHERE t.deleted_at IS NULL
      AND t.registry_status = 'рассмотрение'
      AND (rev.is_final IS NULL OR rev.is_final = false)
      ${exclude}
    ORDER BY t.docs_deadline ASC NULLS LAST, t.created_at ASC
    LIMIT 5
  `);
  console.log(JSON.stringify({
    duty: d,
    analysis_count: r.rows[0].c,
    sample: sample.rows
  }));
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });
"""


def main():
    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    remote = f"{PROJECT}/tools/_check_duty_tmp.js"
    sftp = c.open_sftp()
    with sftp.file(remote, "w") as f:
        f.write(NODE)
    sftp.close()
    _, o, e = c.exec_command(f"cd {PROJECT} && node tools/_check_duty_tmp.js", timeout=90)
    out = o.read().decode("utf-8", errors="replace").strip()
    err = e.read().decode("utf-8", errors="replace").strip()
    c.exec_command(f"rm -f {remote}")
    c.close()
    if err:
        print(err, file=sys.stderr)
    data = json.loads(out)
    if data.get("error") == "no_duty":
        print("Сейчас дежурный РП не назначен.")
        return
    d = data["duty"]
    print(f"Дежурный: {d['pm_name']} (id {d['pm_user_id']})")
    print(f"Период: {d['period_start']} — {d['period_end']}")
    print(f"На анализе (вкладка «Анализ», без мусора): {data['analysis_count']}")
    if data.get("sample"):
        print("\nБлижайшие по сроку:")
        for row in data["sample"]:
            print(f"  #{row['id']} · {row['docs_deadline'] or '—'} · {(row['customer_name'] or '')[:40]}")


if __name__ == "__main__":
    main()
