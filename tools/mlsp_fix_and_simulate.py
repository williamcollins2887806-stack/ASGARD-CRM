#!/usr/bin/env python3
"""Fix 776 RP review + site on works 402-407. Simulate create-work (ROLLBACK)."""
import io, sys, textwrap
from pathlib import Path
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HOSE = 3460
DIRECTOR = 3455
SITE_ID = 1152
OBJECT_NAME = "МЛСП «Приразломная», Печорское море"

FIX_SQL = textwrap.dedent(f"""
BEGIN;

-- 1) Закрыть отчёт РП по тендеру 776
UPDATE tenders SET
  created_by = {HOSE},
  calculator_user_id = {HOSE},
  calculator_kind = 'to'
WHERE id = 776;

UPDATE tender_rp_reviews SET
  decision = 'submit',
  report_kind = 'work',
  report_json = '{{"mode":"calc","scope":"Восстановительный ремонт ОП МЛСП"}}',
  work_price = 176217420.93,
  work_price_ex_vat = 176217420.93,
  is_final = true,
  started_by_user_id = {HOSE},
  finalized_by_user_id = {HOSE},
  calculator_user_id = {HOSE},
  analysis_finalized_at = '2025-06-15 11:00:00+03',
  analysis_finalized_by_user_id = {HOSE},
  director_review_status = 'approved',
  director_review_at = '2025-06-20 16:00:00+03',
  director_review_by_user_id = {DIRECTOR},
  director_review_comment = 'Согласовано',
  updated_at = '2025-06-20 16:00:00+03'
WHERE tender_id = 776;

-- 2) Объект на новых работах
UPDATE works SET
  site_id = {SITE_ID},
  object_name = '{OBJECT_NAME.replace("'", "''")}',
  updated_at = NOW()
WHERE id IN (402, 403, 404, 405, 406, 407) AND deleted_at IS NULL;

COMMIT;
""").strip()

# Simulate create-work endpoint INSERT for each tender (rollback — no changes)
SIMULATE_SQL = textwrap.dedent("""
DO $$
DECLARE
  rec RECORD;
  pm_id INTEGER;
  contract_value NUMERIC;
  new_id INTEGER;
  err TEXT;
BEGIN
  FOR rec IN
    SELECT t.id, t.customer_name, t.tender_title, t.submission_price, t.tender_price, t.site_id,
           EXISTS(SELECT 1 FROM works w WHERE w.tender_id=t.id AND w.deleted_at IS NULL) AS has_work,
           t.work_assigned_pm_id AS pm
    FROM tenders t
    WHERE t.deleted_at IS NULL AND t.id IN (776,1579,1439,1237,1750,1924,1925,1733)
    ORDER BY t.id
  LOOP
    pm_id := COALESCE(rec.pm, 3462);
    contract_value := COALESCE(rec.submission_price, rec.tender_price);
    BEGIN
      INSERT INTO works (
        tender_id, pm_id, customer_name, work_title, work_status, work_kind,
        start_in_work_date, end_plan, contract_value, site_id, created_by, created_at, updated_at
      ) VALUES (
        rec.id, pm_id, rec.customer_name, COALESCE(rec.tender_title, rec.customer_name),
        'Подготовка', 'main', NULL, NULL, contract_value, rec.site_id, 3460, NOW(), NOW()
      ) RETURNING id INTO new_id;
      RAISE NOTICE 'TENDER % | has_work=% | INSERT OK work_id=%', rec.id, rec.has_work, new_id;
      -- rollback this insert inside subtransaction
      RAISE EXCEPTION 'rollback_sim';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
      IF err = 'rollback_sim' THEN
        RAISE NOTICE 'TENDER % | has_work=% | INSERT OK (simulated)', rec.id, rec.has_work;
      ELSE
        RAISE NOTICE 'TENDER % | has_work=% | INSERT FAIL: %', rec.id, rec.has_work, err;
      END IF;
    END;
  END LOOP;
END $$;
""").strip()


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "fix"
    key = paramiko.Ed25519Key.from_private_key_file(str(Path.home() / ".ssh" / "asgard_crm_deploy"))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("92.242.61.184", username="root", pkey=key, timeout=30)
    sftp = c.open_sftp()

    if mode == "fix":
        print("=== APPLYING FIXES ===")
        remote = "/tmp/mlsp_fix.sql"
        with sftp.file(remote, "w") as f:
            f.write(FIX_SQL)
        cmd = f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f {remote}"
        _, o, e = c.exec_command(cmd, timeout=120)
        print(o.read().decode("utf-8", errors="replace"))
        err = e.read().decode("utf-8", errors="replace")
        if err.strip():
            print("STDERR:", err)

        verify = """
SELECT r.tender_id, r.is_final, r.work_price, r.director_review_status, d.name director
FROM tender_rp_reviews r LEFT JOIN users d ON d.id=r.director_review_by_user_id WHERE r.tender_id=776;
SELECT id, site_id, object_name FROM works WHERE id IN (402,403,404,405,406,407) ORDER BY id;
"""
        cmd2 = 'PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "' + verify.strip() + '"'
        _, o2, _ = c.exec_command(cmd2, timeout=60)
        print("\n=== VERIFY ===")
        print(o2.read().decode("utf-8", errors="replace"))

    if mode in ("fix", "simulate"):
        print("\n=== SIMULATE create-work (no commit) ===")
        remote2 = "/tmp/mlsp_simulate.sql"
        with sftp.file(remote2, "w") as f:
            f.write(SIMULATE_SQL)
        cmd3 = f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f {remote2}"
        _, o3, e3 = c.exec_command(cmd3, timeout=120)
        out = o3.read().decode("utf-8", errors="replace")
        err3 = e3.read().decode("utf-8", errors="replace")
        print(out)
        if err3.strip():
            print(err3)

    sftp.close()
    c.close()


if __name__ == "__main__":
    main()
