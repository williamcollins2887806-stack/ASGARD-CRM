-- ═══════════════════════════════════════════════════════════════════════════
-- V430: подписи под-ответственных — ПРИВАТНЫЕ, автор виден только ему (D-306c)
-- ═══════════════════════════════════════════════════════════════════════════
-- ЗАПРОС ЗАКАЗЧИКА (20.10.2026), дословно:
--   «эти фильтры другие не должны видеть — только внутри аккаунта, только
--    пользователь их видит».
--
-- ПРОБЛЕМА ПРЕДЫДУЩЕЙ РЕАЛИЗАЦИИ (V429): подсказки под-ответственных
-- собирались по ВСЕМ уже введённым подписям. На аккаунте АГПЗ сидят 4 человека
-- под одной учёткой — значит ФИО, которое вписала Вика, видели все остальные
-- трое, и наоборот. Это утечка: подпись — рабочий ярлык конкретного человека,
-- а не общий справочник.
--
-- РЕШЕНИЕ: храним АВТОРА подписи (`doc_owner_note_by`). Подсказки в фильтре и
-- в карточке отдаются ТОЛЬКО автору. Фильтр по подписи тоже работает лишь по
-- своим подписям — чужие «Пираев С.» не подмешиваются в выдачу.
--   • doc_owner_id      — аккаунт, на который записан документ (общая матрица);
--   • doc_owner_note    — подпись «чьими руками внесено»;
--   • doc_owner_note_by — кто вписал подпись; он и только он её видит.
--
-- Обратная совместимость: строки, где подпись уже есть, а автор неизвестен,
-- относим к последнему изменившему (`updated_by`), иначе к владельцу.

BEGIN;

ALTER TABLE doc_registry
  ADD COLUMN IF NOT EXISTS doc_owner_note_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN doc_registry.doc_owner_note_by IS
  'Автор подписи doc_owner_note. Подпись приватна: видит и фильтрует только автор.';

-- Заполняем автора у уже существующих подписей (не оставляем «ничьих»).
UPDATE doc_registry
   SET doc_owner_note_by = COALESCE(updated_by, doc_owner_id)
 WHERE doc_owner_note IS NOT NULL
   AND BTRIM(doc_owner_note) <> ''
   AND doc_owner_note_by IS NULL;

-- Подсказки и фильтр идут по паре (автор, аккаунт) — индекс под это.
CREATE INDEX IF NOT EXISTS idx_doc_registry_owner_note_by
  ON doc_registry (doc_owner_note_by, doc_owner_id, lower(doc_owner_note))
  WHERE deleted_at IS NULL AND doc_owner_note IS NOT NULL;

COMMIT;

-- ПРОВЕРКА:
--   SELECT doc_owner_note_by, doc_owner_id, doc_owner_note, count(*)
--     FROM doc_registry
--    WHERE deleted_at IS NULL AND doc_owner_note IS NOT NULL
--    GROUP BY 1,2,3 ORDER BY 4 DESC;
