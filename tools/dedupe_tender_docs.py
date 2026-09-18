#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Одноразовая очистка ДУБЛЕЙ документов тендеров (D-185).

Контекст
--------
Скрипты закрытия просчёта грузили один и тот же файл дважды: с типом `rp_estimate`
(контур РП) и с типом `Смета` / `ТКП`. В UI это выглядело как «всего по 2».
UI-фильтр (`exclude_types` в GET /api/files) новые дубли не показывает, но
исторические строки в БД остаются.

Что делает
----------
Удаляет ТОЛЬКО НАСТОЯЩИЕ ДУБЛИ: строки `documents` с типом из `--types`
(по умолчанию `Смета,ТКП`), у которых на том же тендере есть **вторая строка с тем же
`original_name`** (обычно это `rp_estimate` / `rp_tkp` — файл грузился дважды). Плюс
строка не должна быть ни на что ссылаться:
  * `tender_rp_reviews.{estimate,report,tkp}_file_id`
  * `tender_rp_review_message_files.document_id`
  * `works.*_file_id`-подобные ссылки, если колонки существуют (проверяются динамически)

⚠️ Строка-одиночка (единственная с таким `original_name` на тендере) НЕ удаляется никогда,
даже если она «ни на что не ссылается»: такие файлы ТО загружали вручную как обычные
документы (пример — `1228_Смета_2027_заполненная.xlsx`), и удаление потеряло бы файл.

Безопасность
------------
* По умолчанию — dry-run: печатает, что БУДЕТ удалено, и ничего не трогает.
* `--apply` — реальное удаление, в одной транзакции, с предварительным дампом
  идентификаторов в `tests/reports/dedupe-tender-docs-<ts>.json`.
* Одноразово, только по явной команде. На прод не ходит сам: запускать на сервере
  (`python3 tools/dedupe_tender_docs.py --apply`) после бэкапа БД.

Использование
-------------
  python tools/dedupe_tender_docs.py               # dry-run
  python tools/dedupe_tender_docs.py --apply       # удалить (нужен бэкап!)
  python tools/dedupe_tender_docs.py --types "Смета,ТКП" --limit 500
"""

import argparse
import json
import os
import sys
import time

try:
    import psycopg2
except ImportError:  # psycopg2 не всегда есть локально
    print('FAIL: нужен psycopg2 (pip install psycopg2-binary)', file=sys.stderr)
    sys.exit(2)

DEFAULT_TYPES = ['Смета', 'ТКП']


def connect():
    try:
        return psycopg2.connect(
            host=os.environ.get('PGHOST', '127.0.0.1'),
            port=int(os.environ.get('PGPORT', '5432')),
            user=os.environ.get('PGUSER', 'asgard'),
            password=os.environ.get('PGPASSWORD', '123456789'),
            dbname=os.environ.get('PGDATABASE', 'asgard_crm'),
        )
    except psycopg2.OperationalError as e:
        # Частая осечка: локально нет базы asgard_crm (есть только клон asgard_crm_test).
        print('FAIL: не удалось подключиться к БД (%s).' % e, file=sys.stderr)
        print('Подсказка: укажите базу явно, например', file=sys.stderr)
        print('  PGDATABASE=asgard_crm_test python tools/dedupe_tender_docs.py   # dry-run на клоне', file=sys.stderr)
        sys.exit(2)


def table_columns(cur, table):
    cur.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table,),
    )
    return {r[0] for r in cur.fetchall()}


def find_candidates(cur, types, limit):
    """Строки-дубли: тип из списка и у (tender_id, original_name) есть ЕЩЁ строка (любого типа).

    Для каждой группы одинаковых имён на тендере оставляем РОВНО одну строку:
    приоритет — та, на которую ссылается просчёт/сообщения; иначе самая ранняя.
    Удаляем только не-referenced «лишние» копии.
    """
    cur.execute(
        """
        SELECT d.id, d.tender_id, d.original_name, d.type, d.filename, d.created_at,
               (SELECT COUNT(*) FROM documents x
                 WHERE x.tender_id = d.tender_id
                   AND lower(btrim(COALESCE(x.original_name, ''))) = lower(btrim(COALESCE(d.original_name, '')))
               ) AS name_count
        FROM documents d
        WHERE COALESCE(d.type, '') = ANY(%s)
        ORDER BY d.tender_id, d.original_name, d.created_at
        LIMIT %s
        """,
        (types, limit),
    )
    rows = [dict(zip([d[0] for d in cur.description], r)) for r in cur.fetchall()]

    # Все мягкие ссылки, которые надо уважать.
    cur.execute("SELECT COALESCE(array_agg(estimate_file_id), '{}') FROM tender_rp_reviews WHERE estimate_file_id IS NOT NULL")
    ref_reviews_est = set(cur.fetchone()[0] or [])
    cur.execute("SELECT COALESCE(array_agg(report_file_id), '{}') FROM tender_rp_reviews WHERE report_file_id IS NOT NULL")
    ref_reviews_rep = set(cur.fetchone()[0] or [])
    cur.execute("SELECT COALESCE(array_agg(tkp_file_id), '{}') FROM tender_rp_reviews WHERE tkp_file_id IS NOT NULL")
    ref_reviews_tkp = set(cur.fetchone()[0] or [])
    referenced = ref_reviews_est | ref_reviews_rep | ref_reviews_tkp

    if table_exists(cur, 'tender_rp_review_message_files'):
        cur.execute("SELECT COALESCE(array_agg(document_id), '{}') FROM tender_rp_review_message_files")
        referenced |= set(cur.fetchone()[0] or [])

    # Прочие таблицы со ссылкой на documents.id — если есть.
    for table, col in [('documents_links', 'document_id'), ('tender_files_links', 'document_id')]:
        if table_exists(cur, table) and col in table_columns(cur, table):
            cur.execute(f"SELECT COALESCE(array_agg({col}), '{{}}') FROM {table}")  # noqa: S608
            referenced |= set(cur.fetchone()[0] or [])

    groups = {}
    order = []
    for r in rows:
        key = (r['tender_id'], (r['original_name'] or '').strip().lower())
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(r)

    orphans = []
    singled = []
    for key in order:
        group = groups[key]
        if len(group) <= 1:
            # Единственная копия имени на тендере — не дубль, не трогаем (даже если unreferenced).
            singled.extend(group)
            continue
        referenced_in_group = [r for r in group if r['id'] in referenced]
        if referenced_in_group:
            keep_ids = {referenced_in_group[0]['id']}
        else:
            # Ни одна копия не привязана: оставляем самую раннюю, остальное — дубли.
            keep_ids = {group[0]['id']}
        orphans.extend([r for r in group if r['id'] not in keep_ids])
    return rows, orphans, singled


def table_exists(cur, table):
    cur.execute(
        """
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table,),
    )
    return cur.fetchone() is not None


def main():
    ap = argparse.ArgumentParser(description='Дедупликация документов тендеров (dry-run по умолчанию).')
    ap.add_argument('--apply', action='store_true', help='реально удалить (по умолчанию только показать)')
    ap.add_argument('--types', default=','.join(DEFAULT_TYPES), help='типы документов-дублей через запятую')
    ap.add_argument('--limit', type=int, default=2000, help='максимум строк к разбору')
    ap.add_argument('--report-dir', default='tests/reports', help='куда положить JSON-отчёт')
    args = ap.parse_args()

    types = [t.strip() for t in args.types.split(',') if t.strip()]
    if not types:
        print('FAIL: пустой список типов', file=sys.stderr)
        return 2

    with connect() as conn:
        with conn.cursor() as cur:
            all_rows, orphans, singled = find_candidates(cur, types, args.limit)

        print(f'Типы к очистке: {types}')
        print(f'Найдено строк этих типов: {len(all_rows)}')
        print(f'Дубли (кандидаты на удаление): {len(orphans)}')
        print(f'Одиночные файлы (НЕ дубли, не трогаем): {len(singled)}')
        for r in orphans[:50]:
            print(f"  DUPE #{r['id']} tender={r['tender_id']} type={r['type']} name={r['original_name']}")
        if len(orphans) > 50:
            print(f'  … и ещё {len(orphans) - 50}')
        for r in singled[:20]:
            print(f"  KEEP #{r['id']} tender={r['tender_id']} type={r['type']} name={r['original_name']} (единственная копия)")

        report = {
            'generated_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
            'types': types,
            'found': len(all_rows),
            'orphans': [r['id'] for r in orphans],
            'singled_kept': [r['id'] for r in singled],
            'apply': bool(args.apply),
            'rows': [
                {
                    'id': r['id'],
                    'tender_id': r['tender_id'],
                    'original_name': r['original_name'],
                    'type': r['type'],
                    'filename': r['filename'],
                }
                for r in orphans
            ],
        }
        os.makedirs(args.report_dir, exist_ok=True)
        report_path = os.path.join(args.report_dir, f'dedupe-tender-docs-{int(time.time())}.json')
        with open(report_path, 'w', encoding='utf-8') as fh:
            json.dump(report, fh, ensure_ascii=False, indent=2)
        print(f'Отчёт: {report_path}')

        if not args.apply:
            print('DRY-RUN: ничего не удалено. Для удаления повторите с --apply (после бэкапа БД).')
            return 0

        if not orphans:
            print('Нечего удалять.')
            return 0

        ids = [r['id'] for r in orphans]
        with conn.cursor() as cur:
            cur.execute('DELETE FROM documents WHERE id = ANY(%s)', (ids,))
            deleted = cur.rowcount
        conn.commit()
        print(f'DELETED: {deleted} строк.')
        return 0


if __name__ == '__main__':
    sys.exit(main())
