#!/usr/bin/env python3
"""Upload Segezhsky CBK estimate + report to tender #1868 and fill rp-review."""
import io
import json
import mimetypes
import sys
import time
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
TENDER_ID = 1868
ESTIMATE = Path(r"C:\Users\Nikita-ASGARD\Desktop\СМЕТА_СЕГЕЖСКИЙ_ЦБК_v1.xlsx")
REPORT = Path(r"C:\Users\Nikita-ASGARD\Desktop\ОТЧЁТ_АО_Сегежский_ЦБК_v1.docx")

REPORT_JSON = {
    "mode": "calc",
    "summary": (
        "Заказчик запросил очистку отложений черного щелока трубного пространства "
        "корпусов выпарных станций №1–3 (КР26). ГДО, 3 установки ВД, 2 тр/мин на установку. "
        "На установку 3 человека в смену (включая наблюдающего). Маршрут: Саратов — Москва — Сегежа."
    ),
    "scope": (
        "Очистка отложений черного щелока трубного пространства корпусов выпарных станций №1–3 "
        "в химкорпусе (ПЦ, выпарной отдел). Объём 28 904 тр. по ДВ; Ду 51; L 8500. "
        "3 выезда бригады по 14 к.д.; чистая работа 6+6+6 сут."
    ),
    "risks": (
        "Нет приложенного ТЗ — расчёт по письму; объём принят без площади загрязнения. "
        "Окно работ не задано — для расчёта принято плановое окно 10 к.д. "
        "Маршрут: Саратов — Москва — Петрозаводск — Сегежа; 3 выезда; оборудование 1 завоз + 1 вывоз."
    ),
    "recommendation": (
        "Утвердить схему наценки и итоговую цену для предложения. "
        "Запросить оптовое КП на материалы и утилизацию. "
        "Согласовать с заказчиком фактический объём и окно остановки линии."
    ),
    "questions_for_customer": [
        "Уточнить фактический объём и площадь загрязнения по каждой ВС",
        "Согласовать окно остановки линии и даты выездов бригады",
        "Подтвердить бренд материалов и условия утилизации отходов",
    ],
    "missing_info": ["tz"],
    "feasibility": "conditional",
    "competition": "medium",
    "price_range_min": 17990000,
    "price_range_max": null,
    "cost_without_vat": 17990000,
    "duration_days": 18,
    "resources": "21 чел.: 9+9 (3/уст., вкл. наблюдающего), 2 мастера, 1 ИТР; режим 24/7",
    "reject_preset": "",
    "points": [],
}

WORK_PRICE = 32920000  # цена с НДС по отчёту


def run(client, cmd, timeout=120):
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    return out, err


def main():
    if not ESTIMATE.exists():
        raise SystemExit(f"Estimate not found: {ESTIMATE}")
    if not REPORT.exists():
        raise SystemExit(f"Report not found: {REPORT}")

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", pkey=key, timeout=30)

    sftp = client.open_sftp()
    remote_est = "/tmp/segezh_estimate.xlsx"
    remote_rep = "/tmp/segezh_report.docx"
    sftp.put(str(ESTIMATE), remote_est)
    sftp.put(str(REPORT), remote_rep)
    sftp.close()

    # Pick actor: HEAD_TO or TO user
    sql_user = (
        "SELECT id, login, role, name FROM users "
        "WHERE is_active = true AND role IN ('HEAD_TO','TO','ADMIN') "
        "ORDER BY CASE role WHEN 'HEAD_TO' THEN 0 WHEN 'TO' THEN 1 ELSE 2 END, id LIMIT 1;"
    )
    out, err = run(client, f"sudo -u postgres psql -d asgard_crm -t -A -F'|' -c \"{sql_user}\"")
    if err.strip():
        print("USER ERR:", err)
    line = [x for x in out.strip().splitlines() if x.strip()]
    if not line:
        raise SystemExit("No TO/ADMIN user found")
    uid, login, role, name = line[0].split("|", 3)
    uid = int(uid)
    print(f"Actor: {name} ({login}, {role}, id={uid})")

  # Ensure review row exists
    ensure_sql = f"""
INSERT INTO tender_rp_reviews (tender_id, decision, report_kind, report_json, started_by_user_id)
SELECT {TENDER_ID}, 'pending', 'work', '{{}}'::jsonb, {uid}
WHERE NOT EXISTS (SELECT 1 FROM tender_rp_reviews WHERE tender_id = {TENDER_ID});
"""
    remote_sql = "/tmp/segezh_ensure.sql"
    sftp = client.open_sftp()
    with sftp.file(remote_sql, "w") as f:
        f.write(ensure_sql)
    sftp.close()
    out, err = run(client, f"sudo -u postgres psql -d asgard_crm -f {remote_sql}")
    print(out)
    if err.strip():
        print("ENSURE ERR:", err)

    ts = int(time.time() * 1000)
    est_name = f"{ts}_SMETA_SEGEZHSKIY_CBK_v1.xlsx"
    rep_name = f"{ts}_OTCHET_AO_Segezhskiy_CBK_v1.docx"
    upload_root = "/var/www/asgard-crm/uploads"
    est_dir = f"{upload_root}/rp_estimates/{TENDER_ID}"
    rep_dir = f"{upload_root}/rp_reports/{TENDER_ID}"

    run(client, f"mkdir -p {est_dir} {rep_dir}")
    run(client, f"cp {remote_est} {est_dir}/{est_name}")
    run(client, f"cp {remote_rep} {rep_dir}/{rep_name}")

    est_url = f"/uploads/rp_estimates/{TENDER_ID}/{est_name}"
    rep_url = f"/uploads/rp_reports/{TENDER_ID}/{rep_name}"
    est_size = ESTIMATE.stat().st_size
    rep_size = REPORT.stat().st_size

    # Check if report_file_id column exists; add if missing
    col_check, _ = run(
        client,
        "sudo -u postgres psql -d asgard_crm -t -A -c "
        "\"SELECT 1 FROM information_schema.columns "
        "WHERE table_name='tender_rp_reviews' AND column_name='report_file_id';\"",
    )
    if col_check.strip() != "1":
        mig = """
ALTER TABLE tender_rp_reviews ADD COLUMN IF NOT EXISTS report_file_id INTEGER;
COMMENT ON COLUMN tender_rp_reviews.report_file_id IS 'Прикреплённый файл отчёта (docx/pdf)';
"""
        sftp = client.open_sftp()
        with sftp.file("/tmp/v280_report_file.sql", "w") as f:
            f.write(mig)
        sftp.close()
        out, err = run(client, "sudo -u postgres psql -d asgard_crm -f /tmp/v280_report_file.sql")
        print("Migration report_file_id:", out or err)

    rj = json.dumps(REPORT_JSON, ensure_ascii=False).replace("'", "''")
    doc_sql = f"""
WITH est AS (
  INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
  VALUES ('{est_name}', 'СМЕТА_СЕГЕЖСКИЙ_ЦБК_v1.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', {est_size}, 'rp_estimate', {TENDER_ID}, {uid}, '{est_url}', NOW())
  RETURNING id
), rep AS (
  INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id, uploaded_by, download_url, created_at)
  VALUES ('{rep_name}', 'ОТЧЁТ_АО_Сегежский_ЦБК_v1.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', {rep_size}, 'rp_report', {TENDER_ID}, {uid}, '{rep_url}', NOW())
  RETURNING id
)
UPDATE tender_rp_reviews SET
  decision = 'submit',
  report_kind = 'work',
  report_json = '{rj}'::jsonb,
  missing_info_flags = ARRAY['tz']::text[],
  estimate_file_id = (SELECT id FROM est),
  report_file_id = (SELECT id FROM rep),
  work_price = {WORK_PRICE},
  is_final = false,
  started_by_user_id = COALESCE(started_by_user_id, {uid}),
  updated_at = NOW()
WHERE tender_id = {TENDER_ID}
RETURNING id, estimate_file_id, report_file_id, work_price;

INSERT INTO tender_rp_review_log (review_id, tender_id, actor_user_id, action, payload_json)
SELECT id, {TENDER_ID}, {uid}, 'attach_estimate', '{{"name":"СМЕТА_СЕГЕЖСКИЙ_ЦБК_v1.xlsx"}}'::jsonb
FROM tender_rp_reviews WHERE tender_id = {TENDER_ID};
INSERT INTO tender_rp_review_log (review_id, tender_id, actor_user_id, action, payload_json)
SELECT id, {TENDER_ID}, {uid}, 'attach_report', '{{"name":"ОТЧЁТ_АО_Сегежский_ЦБК_v1.docx"}}'::jsonb
FROM tender_rp_reviews WHERE tender_id = {TENDER_ID};
INSERT INTO tender_rp_review_log (review_id, tender_id, actor_user_id, action, payload_json)
SELECT id, {TENDER_ID}, {uid}, 'save_draft', '{{"decision":"submit","work_price":{WORK_PRICE}}}'::jsonb
FROM tender_rp_reviews WHERE tender_id = {TENDER_ID};
"""
    sftp = client.open_sftp()
    with sftp.file("/tmp/segezh_fill.sql", "w") as f:
        f.write(doc_sql)
    sftp.close()
    out, err = run(client, "sudo -u postgres psql -d asgard_crm -f /tmp/segezh_fill.sql")
    print("=== Fill result ===")
    print(out)
    if err.strip():
        print("FILL ERR:", err)

    verify_sql = f"""
SELECT t.id, t.registry_status, calc.name AS calculator,
       rev.decision, rev.is_final, rev.work_price,
       ef.original_name AS estimate, rf.original_name AS report_doc,
       rev.report_json->>'summary' AS summary_preview
FROM tenders t
LEFT JOIN users calc ON calc.id = t.calculator_user_id
LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
LEFT JOIN documents ef ON ef.id = rev.estimate_file_id
LEFT JOIN documents rf ON rf.id = rev.report_file_id
WHERE t.id = {TENDER_ID};
"""
    sftp = client.open_sftp()
    with sftp.file("/tmp/segezh_verify.sql", "w") as f:
        f.write(verify_sql)
    sftp.close()
    out, _ = run(client, "sudo -u postgres psql -d asgard_crm -f /tmp/segezh_verify.sql")
    print("=== Verify ===")
    print(out)

    client.close()
    print("DONE")


if __name__ == "__main__":
    main()
