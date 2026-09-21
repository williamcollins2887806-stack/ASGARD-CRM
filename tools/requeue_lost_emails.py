#!/usr/bin/env python3
"""requeue_lost_emails.py — точечный возврат в AI-разбор конкретных писем (D-204).

Зачем: при сбое разбора старый код ставил `ai_processed_at = NOW()` и письмо
терялось навсегда. Этот скрипт по списку id снимает отметку обработки —
и штатный AI-процессор сервиса подхватит эти письма на следующем проходе
(каждые 30 c), БЕЗ рестарта и БЕЗ массового `resetSkippedEmails` (он и был петлёй).

Безопасность:
  - по умолчанию dry-run: только показывает, что будет изменено;
  - реальные изменения — только с --apply;
  - меняются ТОЛЬКО перечисленные id (никаких LIKE по всей таблице);
  - отказ работать, если у письма разбор выглядит успешным, без явного --force.

Запуск (на проде, из /var/www/asgard-crm):
    python3 tools/requeue_lost_emails.py --emails 4255,4256           # показать
    python3 tools/requeue_lost_emails.py --emails 4255,4256 --apply   # выполнить
"""
import argparse
import io
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

DB = dict(host="127.0.0.1", dbname="asgard_crm", user="asgard", password="123456789")


def q(cur, sql, params=None):
    cur.execute(sql, params or ())
    return cur.fetchall()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--emails", required=True, help="id писем через запятую: 4255,4256")
    ap.add_argument("--apply", action="store_true", help="применить изменения (по умолчанию dry-run)")
    ap.add_argument("--force", action="store_true", help="разрешить сброс писем с успешным разбором")
    args = ap.parse_args()

    ids = [int(x) for x in args.emails.replace(" ", "").split(",") if x]
    if not ids:
        print("Пустой список id")
        return 2

    import psycopg2
    conn = psycopg2.connect(**DB)
    cur = conn.cursor()

    # Миграция V355 добавляет ai_attempts/ai_last_error_at. Если её ещё не
    # применили (обычная ситуация: код выкатили раньше миграции), скрипт не
    # должен падать трейсбеком — сообщаем и работаем по доступным колонкам.
    cur.execute("""
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'emails' AND column_name IN ('ai_attempts','ai_last_error_at')""")
    have_cols = {r[0] for r in cur.fetchall()}
    missing_cols = {'ai_attempts', 'ai_last_error_at'} - have_cols
    if missing_cols:
        print(f"ВНИМАНИЕ: в emails нет колонок {sorted(missing_cols)} — миграция V355 не применена.")
        print("Примените: python3 tools/... либо psql -f migrations/V355__email_ai_attempts.sql")
        print("Пока продолжаю без счётчика попыток.\n")
    attempts_expr = "COALESCE(ai_attempts, 0)" if 'ai_attempts' in have_cols else "0"

    print(f"=== Письма к возврату: {ids} ({'APPLY' if args.apply else 'DRY-RUN'}) ===\n")
    rows = q(cur, f"""
        SELECT id, LEFT(subject, 60), ai_classification, ai_summary,
               ai_processed_at IS NOT NULL AS processed,
               {attempts_expr} AS attempts,
               attachment_count
          FROM emails WHERE id = ANY(%s) ORDER BY id""", (ids,))

    if not rows:
        print("Ничего не найдено по этим id.")
        return 1

    ok_ids, risky_ids = [], []
    for r in rows:
        email_id, subj, cls, summary, processed, attempts, atts = r
        cls_s = str(cls or "").strip('"')
        print(f"#{email_id} | processed={processed} | attempts={attempts} | att={atts} | cls={cls_s!r}")
        print(f"   тема: {subj}")
        print(f"   summary: {str(summary or '')[:90]}")
        classified_ok = cls_s not in ("", "other", "None")
        if classified_ok and processed:
            risky_ids.append(email_id)
        else:
            ok_ids.append(email_id)

    missing = set(ids) - {r[0] for r in rows}
    if missing:
        print(f"\nВНИМАНИЕ: не найдены id {sorted(missing)}")

    if risky_ids and not args.force:
        print(f"\nОТКАЗ: у писем {risky_ids} разбор выглядит успешным (classification задан, processed=true).")
        print("Сброс затрёт результат. Нужен явный --force.")
        return 3

    target = ok_ids + risky_ids
    if not args.apply:
        print(f"\nDRY-RUN. Было бы сброшено: {target}")
        print("Запустите с --apply, чтобы выполнить.")
        return 0

    reset_cols = [
        "ai_processed_at = NULL", "ai_summary = NULL",
        "ai_classification = NULL", "ai_color = NULL", "updated_at = NOW()",
    ]
    if 'ai_attempts' in have_cols:
        reset_cols.append("ai_attempts = 0")
    if 'ai_last_error_at' in have_cols:
        reset_cols.append("ai_last_error_at = NULL")

    cur.execute(f"""
        UPDATE emails
           SET {', '.join(reset_cols)}
         WHERE id = ANY(%s)""", (target,))
    reset = cur.rowcount
    conn.commit()
    cur.close()
    conn.close()

    print(f"\nСброшено писем: {reset} (id: {target})")
    print("Письма подхватит штатный AI-процессор сервиса на следующем проходе (<=30 c).")
    print("Проверить результат:")
    print(f"  PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
          f"\"SELECT id, ai_classification, ai_summary, ai_processed_at "
          f"FROM emails WHERE id IN ({','.join(str(i) for i in target)})\"")
    print("  PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c "
          f"\"SELECT id, customer_name, work_description, ai_classification "
          f"FROM pre_tender_requests WHERE email_id IN ({','.join(str(i) for i in target)})\"")
    return 0


if __name__ == "__main__":
    sys.exit(main())
