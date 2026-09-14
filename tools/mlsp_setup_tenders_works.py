#!/usr/bin/env python3
"""
Setup MLSP Приразломная tenders: mark won, RP review, create works.
Run on production via SSH + psql.
"""
import io
import sys
import textwrap
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# User IDs
HOSE = 3460          # Вилявисенсио-Мятов Хосе Александр (HEAD_TO)
TRUKHIN = 3462       # Трухин Антон Сергеевич
ANDROSOV = 3474      # Андросов Никита Андреевич
KLIMAKIN = 3458      # Климакин Дмитрий
DIRECTOR = 3455      # Кудряшов Олег Сергеевич (DIRECTOR_GEN)

CUSTOMER = "ООО «Газпром нефть шельф»"
CUSTOMER_INN = "8905053872"

SQL = textwrap.dedent("""
BEGIN;

-- ─── 1. Химическая промывка ОП и ТО (tender 1579, уже выиграли) ───
UPDATE tenders SET
  created_by = {HOSE},
  calculator_user_id = {HOSE},
  calculator_kind = 'to',
  tender_price = 353295390,
  submission_price = 353295390,
  created_at = '2025-12-17 14:00:00+03',
  period = '2025-12',
  won_at = COALESCE(won_at, '2026-01-20 12:00:00+03'),
  won_by_user_id = {HOSE}
WHERE id = 1579 AND deleted_at IS NULL;

INSERT INTO tender_rp_reviews (
  tender_id, decision, report_kind, report_json, work_price, work_price_ex_vat,
  is_final, started_by_user_id, finalized_by_user_id, calculator_user_id,
  analysis_finalized_at, analysis_finalized_by_user_id,
  director_review_status, director_review_at, director_review_by_user_id,
  director_review_comment, created_at, updated_at
) VALUES (
  1579, 'submit', 'work', '{{"mode":"calc","scope":"Химпромывка ОП и ТО МЛСП"}}',
  353295390, 353295390,
  true, {HOSE}, {HOSE}, {HOSE},
  '2025-12-10 11:00:00+03', {HOSE},
  'approved', '2025-12-12 16:00:00+03', {DIRECTOR}, 'Согласовано',
  '2025-12-10 11:00:00+03', '2025-12-12 16:00:00+03'
) ON CONFLICT (tender_id) DO UPDATE SET
  decision = 'submit', report_kind = 'work', work_price = 353295390, work_price_ex_vat = 353295390,
  is_final = true, calculator_user_id = {HOSE},
  director_review_status = 'approved', director_review_at = '2025-12-12 16:00:00+03',
  director_review_by_user_id = {DIRECTOR}, updated_at = NOW();

INSERT INTO works (
  tender_id, pm_id, customer_name, work_title, work_status, work_kind,
  contract_value, created_by, created_at, updated_at
)
SELECT 1579, {TRUKHIN}, '{CUSTOMER}',
  'Оказание услуг по химической промывке огневых подогревателей Z44010 и теплообменных аппаратов МЛСП «Приразломная»',
  'Подготовка', 'main', 353295390, {HOSE}, '2026-01-21 10:00:00+03', NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM works WHERE tender_id = 1579 AND deleted_at IS NULL
);

UPDATE tenders SET work_assigned_pm_id = {TRUKHIN}, work_assigned_at = NOW(), work_assigned_by_user_id = {HOSE}
WHERE id = 1579 AND work_assigned_pm_id IS NULL;

-- ─── 2. Восстановительный ремонт (776) — уже есть работа 354, только проверка РП ───
-- skip

-- ─── 3. Деаэратор (tender 1439) ───
UPDATE tenders SET
  registry_status = 'выиграли', tender_status = 'Выиграли',
  created_by = {HOSE}, calculator_user_id = {HOSE}, calculator_kind = 'to',
  tender_price = 18991380, submission_price = 18991380,
  created_at = '2025-08-01 10:00:00+03', period = '2025-08',
  won_at = '2025-09-01 12:00:00+03', won_by_user_id = {HOSE}
WHERE id = 1439;

INSERT INTO tender_rp_reviews (
  tender_id, decision, report_kind, report_json, work_price, work_price_ex_vat,
  is_final, started_by_user_id, finalized_by_user_id, calculator_user_id,
  analysis_finalized_at, analysis_finalized_by_user_id,
  director_review_status, director_review_at, director_review_by_user_id,
  created_at, updated_at
) VALUES (
  1439, 'submit', 'work', '{{"mode":"calc"}}', 18991380, 15826150,
  true, {HOSE}, {HOSE}, {HOSE},
  '2025-07-20 11:00:00+03', {HOSE},
  'approved', '2025-07-25 15:00:00+03', {DIRECTOR},
  '2025-07-20 11:00:00+03', '2025-07-25 15:00:00+03'
) ON CONFLICT (tender_id) DO UPDATE SET
  decision = 'submit', is_final = true, work_price = 18991380, work_price_ex_vat = 15826150,
  director_review_status = 'approved', director_review_at = '2025-07-25 15:00:00+03',
  director_review_by_user_id = {DIRECTOR}, calculator_user_id = {HOSE}, updated_at = NOW();

INSERT INTO works (tender_id, pm_id, customer_name, work_title, work_status, work_kind, contract_value, created_by, created_at, updated_at)
SELECT 1439, {TRUKHIN}, '{CUSTOMER}',
  'Промывка деаэратора V49001 МЛСП «Приразломная»',
  'Подготовка', 'main', 18991380, {HOSE}, '2025-09-02 10:00:00+03', NOW()
WHERE NOT EXISTS (SELECT 1 FROM works WHERE tender_id = 1439 AND deleted_at IS NULL);

UPDATE tenders SET work_assigned_pm_id = {TRUKHIN}, work_assigned_at = NOW(), work_assigned_by_user_id = {HOSE}
WHERE id = 1439 AND work_assigned_pm_id IS NULL;

-- ─── 4. Емкости ТК — новый тендер ───
INSERT INTO tenders (
  customer_name, customer_inn, tender_title, tender_price, submission_price,
  registry_status, tender_status, source_kind, created_by, created_by_user_id,
  calculator_user_id, calculator_kind, period, created_at, won_at, won_by_user_id
)
SELECT '{CUSTOMER}', '{CUSTOMER_INN}',
  'Оказание услуг по зачистке танков и аппаратов технологического комплекса МЛСП «Приразломная»',
  115914998.27, 115914998.27,
  'выиграли', 'Выиграли', 'to_manual', {HOSE}, {HOSE},
  {HOSE}, 'to', '2025-01', '2025-01-10 10:00:00+03', '2025-02-15 12:00:00+03', {HOSE}
WHERE NOT EXISTS (
  SELECT 1 FROM tenders
  WHERE deleted_at IS NULL
    AND tender_title ILIKE '%зачистке танков и аппаратов технологического комплекса%'
    AND registry_status = 'выиграли'
);

-- get TK tender id into temp - use DO block
DO $$
DECLARE tid INTEGER;
BEGIN
  SELECT id INTO tid FROM tenders
  WHERE deleted_at IS NULL
    AND tender_title ILIKE '%зачистке танков и аппаратов технологического комплекса%'
  ORDER BY id DESC LIMIT 1;

  IF tid IS NOT NULL THEN
    INSERT INTO tender_rp_reviews (
      tender_id, decision, report_kind, work_price, work_price_ex_vat, is_final,
      started_by_user_id, calculator_user_id, director_review_status,
      director_review_at, director_review_by_user_id, created_at, updated_at
    ) VALUES (
      tid, 'submit', 'work', 115914998.27, 115914998.27, true,
      {HOSE}, {HOSE}, 'approved', '2025-01-20 15:00:00+03', {DIRECTOR},
      '2025-01-12 11:00:00+03', '2025-01-20 15:00:00+03'
    ) ON CONFLICT (tender_id) DO UPDATE SET
      is_final = true, work_price = 115914998.27, director_review_status = 'approved', updated_at = NOW();

    INSERT INTO works (tender_id, pm_id, customer_name, work_title, work_status, work_kind, contract_value, created_by, created_at, updated_at)
    SELECT tid, {TRUKHIN}, '{CUSTOMER}',
      'Зачистка танков и аппаратов технологического комплекса МЛСП «Приразломная»',
      'Подготовка', 'main', 115914998.27, {HOSE}, '2025-02-16 10:00:00+03', NOW()
    WHERE NOT EXISTS (SELECT 1 FROM works WHERE tender_id = tid AND deleted_at IS NULL);

    UPDATE tenders SET work_assigned_pm_id = {TRUKHIN}, work_assigned_at = NOW(), work_assigned_by_user_id = {HOSE}
    WHERE id = tid AND work_assigned_pm_id IS NULL;
  END IF;
END $$;

-- ─── 5. Каусорб — новый тендер ───
INSERT INTO tenders (
  customer_name, customer_inn, tender_title, tender_price, submission_price,
  registry_status, tender_status, source_kind, created_by, created_by_user_id,
  calculator_user_id, calculator_kind, period, created_at, won_at, won_by_user_id
)
SELECT '{CUSTOMER}', '{CUSTOMER_INN}',
  'Зачистка аппаратов и замена наполнителей фильтров тонкой очистки Z49002 (каусорб) МЛСП «Приразломная»',
  25000000, 25000000,
  'выиграли', 'Выиграли', 'to_manual', {HOSE}, {HOSE},
  {HOSE}, 'to', '2025-08', '2025-08-05 10:00:00+03', '2025-08-28 12:00:00+03', {HOSE}
WHERE NOT EXISTS (
  SELECT 1 FROM tenders
  WHERE deleted_at IS NULL AND tender_title ILIKE '%каусорб%' AND tender_title ILIKE '%Z49002%'
);

DO $$
DECLARE tid INTEGER;
BEGIN
  SELECT id INTO tid FROM tenders
  WHERE deleted_at IS NULL AND tender_title ILIKE '%каусорб%' AND tender_title ILIKE '%Z49002%'
  ORDER BY id DESC LIMIT 1;

  IF tid IS NOT NULL THEN
    INSERT INTO tender_rp_reviews (
      tender_id, decision, report_kind, work_price, work_price_ex_vat, is_final,
      started_by_user_id, calculator_user_id, director_review_status,
      director_review_at, director_review_by_user_id, created_at, updated_at
    ) VALUES (
      tid, 'submit', 'work', 25000000, 20833333.33, true,
      {HOSE}, {HOSE}, 'approved', '2025-08-20 15:00:00+03', {DIRECTOR},
      '2025-08-10 11:00:00+03', '2025-08-20 15:00:00+03'
    ) ON CONFLICT (tender_id) DO UPDATE SET
      is_final = true, director_review_status = 'approved', updated_at = NOW();

    INSERT INTO works (tender_id, pm_id, customer_name, work_title, work_status, work_kind, contract_value, created_by, created_at, updated_at)
    SELECT tid, {TRUKHIN}, '{CUSTOMER}',
      'Замена наполнителей ФТО Z49002 (каусорб) МЛСП «Приразломная»',
      'Подготовка', 'main', 25000000, {HOSE}, '2025-08-29 10:00:00+03', NOW()
    WHERE NOT EXISTS (SELECT 1 FROM works WHERE tender_id = tid AND deleted_at IS NULL);

    UPDATE tenders SET work_assigned_pm_id = {TRUKHIN}, work_assigned_at = NOW(), work_assigned_by_user_id = {HOSE}
    WHERE id = tid AND work_assigned_pm_id IS NULL;
  END IF;
END $$;

-- ─── 6. Факельный оголовок (tender 1237) ───
UPDATE tenders SET
  registry_status = 'выиграли', tender_status = 'Выиграли',
  created_by = {HOSE}, calculator_user_id = {HOSE}, calculator_kind = 'to',
  created_at = '2026-03-01 10:00:00+03', period = '2026-03',
  won_at = '2026-04-15 12:00:00+03', won_by_user_id = {HOSE}
WHERE id = 1237;

INSERT INTO tender_rp_reviews (
  tender_id, decision, report_kind, is_final, started_by_user_id, calculator_user_id,
  director_review_status, director_review_at, director_review_by_user_id, created_at, updated_at
) VALUES (
  1237, 'submit', 'work', true, {HOSE}, {HOSE},
  'approved', '2026-04-01 15:00:00+03', {DIRECTOR},
  '2026-03-15 11:00:00+03', '2026-04-01 15:00:00+03'
) ON CONFLICT (tender_id) DO UPDATE SET
  is_final = true, director_review_status = 'approved', calculator_user_id = {HOSE}, updated_at = NOW();

INSERT INTO works (tender_id, pm_id, customer_name, work_title, work_status, work_kind, created_by, created_at, updated_at)
SELECT 1237, {ANDROSOV}, '{CUSTOMER}',
  'Выполнение СМР по замене оголовка факельного совмещённого (ОФС) МЛСП «Приразломная»',
  'Подготовка', 'main', {HOSE}, '2026-04-16 10:00:00+03', NOW()
WHERE NOT EXISTS (SELECT 1 FROM works WHERE tender_id = 1237 AND deleted_at IS NULL);

UPDATE tenders SET work_assigned_pm_id = {ANDROSOV}, work_assigned_at = NOW(), work_assigned_by_user_id = {HOSE}
WHERE id = 1237 AND work_assigned_pm_id IS NULL;

-- ─── 7. Емкости БК (tender 1750) ───
UPDATE tenders SET
  registry_status = 'выиграли', tender_status = 'Выиграли',
  created_by = {HOSE}, calculator_user_id = {HOSE}, calculator_kind = 'to',
  tender_price = 87508237.72, submission_price = 87508237.72,
  created_at = '2025-01-05 10:00:00+03', period = '2025-01',
  won_at = '2025-05-20 12:00:00+03', won_by_user_id = {HOSE}
WHERE id = 1750;

INSERT INTO tender_rp_reviews (
  tender_id, decision, report_kind, work_price, work_price_ex_vat, is_final,
  started_by_user_id, calculator_user_id, director_review_status,
  director_review_at, director_review_by_user_id, created_at, updated_at
) VALUES (
  1750, 'submit', 'work', 87508237.72, 87508237.72, true,
  {HOSE}, {HOSE}, 'approved', '2025-05-10 15:00:00+03', {DIRECTOR},
  '2025-04-20 11:00:00+03', '2025-05-10 15:00:00+03'
) ON CONFLICT (tender_id) DO UPDATE SET
  is_final = true, work_price = 87508237.72, director_review_status = 'approved', updated_at = NOW();

INSERT INTO works (tender_id, pm_id, customer_name, work_title, work_status, work_kind, contract_value, created_by, created_at, updated_at)
SELECT 1750, {TRUKHIN}, '{CUSTOMER}',
  'Очистка ёмкостного парка бурового комплекса (БК) МЛСП «Приразломная»',
  'Подготовка', 'main', 87508237.72, {HOSE}, '2025-05-21 10:00:00+03', NOW()
WHERE NOT EXISTS (SELECT 1 FROM works WHERE tender_id = 1750 AND deleted_at IS NULL);

UPDATE tenders SET work_assigned_pm_id = {TRUKHIN}, work_assigned_at = NOW(), work_assigned_by_user_id = {HOSE}
WHERE id = 1750 AND work_assigned_pm_id IS NULL;

COMMIT;

-- Verification
SELECT t.id, t.registry_status, LEFT(t.tender_title, 70) AS title,
       w.id AS work_id, u.name AS pm
FROM tenders t
LEFT JOIN works w ON w.tender_id = t.id AND w.deleted_at IS NULL
LEFT JOIN users u ON u.id = w.pm_id
WHERE t.deleted_at IS NULL AND (
  t.id IN (776,1579,1439,1237,1750)
  OR t.tender_title ILIKE '%зачистке танков и аппаратов технологического%'
  OR t.tender_title ILIKE '%каусорб%'
)
ORDER BY t.id;
""").format(
    HOSE=HOSE, TRUKHIN=TRUKHIN, ANDROSOV=ANDROSOV, KLIMAKIN=KLIMAKIN,
    DIRECTOR=DIRECTOR, CUSTOMER=CUSTOMER.replace("'", "''"), CUSTOMER_INN=CUSTOMER_INN
)


def main():
    dry = "--dry-run" in sys.argv
    print("DRY RUN" if dry else "APPLYING...")
    key = paramiko.Ed25519Key.from_private_key_file(str(Path.home() / ".ssh" / "asgard_crm_deploy"))
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("92.242.61.184", username="root", pkey=key, timeout=30)

    if dry:
        print(SQL[:2000], "\n... [truncated]")
        client.close()
        return

    # Write SQL to temp file on server and execute
    sftp = client.open_sftp()
    remote = "/tmp/mlsp_setup.sql"
    with sftp.file(remote, "w") as f:
        f.write(SQL)
    sftp.close()

    cmd = f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f {remote}"
    _, stdout, stderr = client.exec_command(cmd, timeout=180)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    print(out)
    if err.strip():
        print("STDERR:", err)
    client.close()


if __name__ == "__main__":
    main()
