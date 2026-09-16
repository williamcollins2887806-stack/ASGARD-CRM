#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Бэкфилл «осиротевших» просчётов (D-172) на проде.

Что лечим: анализ закрыт («подаём»), просчёт не финальный, реестр активен
('рассмотрение'/'готовим'), но владельца просчёта нет (tenders.calculator_user_id
и tender_rp_reviews.calculator_user_id — NULL). Такие карточки, закрытые ДО выкатки
автопривязки к дежурному (13.09.2026), не видны никому: ни во вкладке «Просчёты»,
ни через PUT (403).

Зеркало серверного self-heal `ensureCalcOwner` (src/routes/pm-duty.js):
  * tenders: calculator_user_id = дежурный, calculator_kind='pm', updated_at=NOW();
  * tender_rp_reviews: calculator_user_id = дежурный, БЕЗ бампа updated_at
    (он — optimistic-lock токен, бамп ломал бы сохранение открытой формы);
  * запись в tender_rp_review_log (action='calc_owner_backfill').

Дежурный берётся из pm_duty_roster на CURRENT_DATE, а не хардкодом.

Предохранитель: если осиротевших больше 20 — прерываемся (массовую правку разбираем руками).

Запуск: python tools/backfill_calc_owner_orphans.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]

ROOT = Path(__file__).resolve().parents[1]
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
SSH_HOST = "root@92.242.61.184"
REMOTE_SQL = "/tmp/asgard_backfill_calc_owner.sql"
LOCAL_SQL = Path(tempfile.gettempdir()) / "asgard_backfill_calc_owner.sql"

DUTY = """(SELECT pm_user_id FROM pm_duty_roster
              WHERE CURRENT_DATE BETWEEN period_start AND period_end
              ORDER BY period_start DESC LIMIT 1)"""

SQL = f"""\\set ON_ERROR_STOP on
\\pset pager off
BEGIN;

-- Кого лечим.
CREATE TEMP TABLE _orphans ON COMMIT DROP AS
SELECT t.id AS tender_id, rev.id AS review_id
FROM tenders t
JOIN tender_rp_reviews rev ON rev.tender_id = t.id
WHERE t.deleted_at IS NULL
  AND t.registry_status IN ('рассмотрение', 'готовим')
  AND rev.analysis_finalized_at IS NOT NULL
  AND COALESCE(rev.is_final, false) = false
  AND t.calculator_user_id IS NULL
  AND rev.calculator_user_id IS NULL;

\\echo === ОСИРОТЕВШИЕ ПРОСЧЁТЫ (до правки) ===
SELECT o.tender_id, o.review_id, t.tender_number, t.registry_status, rev.decision,
       rev.work_price, rev.work_price_ex_vat, rev.analysis_finalized_at
FROM _orphans o
JOIN tenders t ON t.id = o.tender_id
JOIN tender_rp_reviews rev ON rev.id = o.review_id
ORDER BY o.tender_id;

DO $$
DECLARE
  n int;
  duty bigint;
BEGIN
  SELECT count(*) INTO n FROM _orphans;
  SELECT {DUTY} INTO duty;
  IF n > 20 THEN
    RAISE EXCEPTION 'осиротевших карточек больше 20 (%), массовую правку не делаем', n;
  END IF;
  IF n > 0 AND duty IS NULL THEN
    RAISE EXCEPTION 'нет дежурного РП на сегодня — назначать владельца некому';
  END IF;
  RAISE NOTICE 'к личению: % карточек, дежурный РП id=%', n, duty;
END $$;

-- 1) tenders — как syncCalculatorActor/ensureCalcOwner
UPDATE tenders t
SET calculator_user_id = {DUTY},
    calculator_kind = 'pm',
    updated_at = NOW()
WHERE t.id IN (SELECT tender_id FROM _orphans);

-- 2) tender_rp_reviews — БЕЗ бампа updated_at (optimistic-lock токен)
UPDATE tender_rp_reviews rev
SET calculator_user_id = {DUTY}
WHERE rev.id IN (SELECT review_id FROM _orphans)
  AND rev.calculator_user_id IS NULL;

-- 3) след в логе ревью (аудит: это бэкфилл, а не интерактивный self-heal)
INSERT INTO tender_rp_review_log (review_id, tender_id, actor_user_id, action, payload_json)
SELECT o.review_id, o.tender_id, t.calculator_user_id, 'calc_owner_backfill',
       jsonb_build_object('owner_user_id', t.calculator_user_id,
                          'reason', 'orphan_calc_phase_backfill',
                          'shell', '20.28.33')
FROM _orphans o
JOIN tenders t ON t.id = o.tender_id;

\\echo === ПОСЛЕ ПРАВКИ ===
SELECT t.id, t.tender_number, t.registry_status,
       t.calculator_user_id AS t_calc, t.calculator_kind,
       rev.calculator_user_id AS rev_calc, rev.is_final
FROM tenders t
JOIN tender_rp_reviews rev ON rev.tender_id = t.id
WHERE t.id IN (SELECT tender_id FROM _orphans)
ORDER BY t.id;

\\echo === КОНТРОЛЬ: сколько осиротевших осталось ===
SELECT count(*) AS orphans_left
FROM tenders t
JOIN tender_rp_reviews rev ON rev.tender_id = t.id
WHERE t.deleted_at IS NULL
  AND t.registry_status IN ('рассмотрение', 'готовим')
  AND rev.analysis_finalized_at IS NOT NULL
  AND COALESCE(rev.is_final, false) = false
  AND t.calculator_user_id IS NULL
  AND rev.calculator_user_id IS NULL;

COMMIT;

\\echo === ПОСЛЕ COMMIT: карточки в очереди «Просчёты» дежурного ===
SELECT t.id, t.tender_number, t.registry_status, t.calculator_user_id AS calc_owner,
       u.name AS calc_owner_name, rev.analysis_finalized_at IS NOT NULL AS analysis_closed
FROM tenders t
JOIN tender_rp_reviews rev ON rev.tender_id = t.id
LEFT JOIN users u ON u.id = t.calculator_user_id
WHERE t.id IN (2042, 2053, 2048, 1930)
ORDER BY t.id;
"""


def ssh(cmd: str) -> subprocess.CompletedProcess:
    return subprocess.run(["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no",
                           "-o", "ConnectTimeout=20", SSH_HOST, cmd],
                          capture_output=True, text=True, encoding="utf-8", errors="replace")


def main() -> None:
    dry = "--dry-run" in sys.argv
    sql = SQL.replace("COMMIT;", "ROLLBACK;  -- DRY-RUN: ничего не применяем") if dry else SQL
    LOCAL_SQL.write_text(sql, encoding="utf-8", newline="\n")
    if dry:
        print("!!! DRY-RUN: транзакция завершится ROLLBACK, прод не меняется\n")

    print("=== SCAN (read-only, до правки) ===")
    scan = ssh(f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -q -c "
               f"\"SELECT t.id, t.tender_number, t.registry_status, t.calculator_user_id, "
               f"rev.calculator_user_id FROM tenders t JOIN tender_rp_reviews rev ON rev.tender_id = t.id "
               f"WHERE t.deleted_at IS NULL AND t.registry_status IN ('рассмотрение','готовим') "
               f"AND rev.analysis_finalized_at IS NOT NULL AND COALESCE(rev.is_final,false)=false "
               f"AND t.calculator_user_id IS NULL AND rev.calculator_user_id IS NULL ORDER BY t.id\"")
    print(scan.stdout.strip() or scan.stderr.strip()[-500:])

    print("\n=== UPLOAD SQL ===")
    up = subprocess.run(["scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no",
                         str(LOCAL_SQL), f"{SSH_HOST}:{REMOTE_SQL}"],
                        capture_output=True, text=True, encoding="utf-8", errors="replace")
    if up.returncode != 0:
        raise SystemExit(f"scp fail: {up.stderr[-800:]}")
    print(f"залит {REMOTE_SQL}")

    print("\n=== APPLY ===")
    res = ssh(f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f {REMOTE_SQL}")
    print(res.stdout)
    if res.returncode != 0 or res.stderr.strip():
        print("STDERR:", res.stderr[-3000:])
    if res.returncode != 0:
        raise SystemExit("бэкфилл НЕ применён (psql вернул ошибку) — см. STDERR выше")

    print("=== BACKFILL DONE ===")


if __name__ == "__main__":
    main()
