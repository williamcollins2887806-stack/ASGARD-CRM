-- ═══════════════════════════════════════════════════════════════════════════
-- V421: emails.email_type — разрешить категории сортировщика папок
-- ═══════════════════════════════════════════════════════════════════════════
-- D-294 (аудит 20.10.2026). В логах 189 ошибок за сутки:
--   [FolderSorter] Error: new row for relation "emails" violates check
--   constraint "emails_email_type_check"
--
-- ПРИЧИНА: constraint разрешал только
--   direct_request | platform_tender | newsletter | internal | crm_outbound | unknown
-- а email-folder-sorter.js пишет СВОИ категории папок:
--   tkp | tender | invoice | act | contract | correspondence | other
-- Пересечение только по двум (tender→platform_tender нет, newsletter нет) —
-- фактически 5 из 7 значений падали, UPDATE откатывался.
--
-- ПОСЛЕДСТВИЕ (мягкое): письмо физически переносилось в папку IMAP, а в БД
-- оставалось email_type='unknown' и imap_folder='INBOX'. На доставку и на
-- обработку счетов не влияет (intake идёт по account_id + is_crm_copy), но
-- лог забивается и папки в UI расходятся с реальностью.
--
-- РЕШЕНИЕ: расширяем CHECK — добавляем категории сортировщика. Существующие
-- значения не трогаем, старые строки остаются валидными.

BEGIN;

ALTER TABLE emails DROP CONSTRAINT IF EXISTS emails_email_type_check;

ALTER TABLE emails ADD CONSTRAINT emails_email_type_check
  CHECK (email_type::text = ANY (ARRAY[
    -- исторические категории
    'direct_request', 'platform_tender', 'newsletter', 'internal',
    'crm_outbound', 'unknown',
    -- категории email-folder-sorter.js (папки CRM/*)
    'tkp', 'tender', 'invoice', 'act', 'contract', 'correspondence', 'other'
  ]::text[]));

COMMIT;
