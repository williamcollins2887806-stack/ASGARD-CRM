-- NOT NULL constraint на field_checkins.assignment_id
-- Контекст:
--   V087 сделал backfill — все 328 строк получили FK
--   Эндпоинты field-manage.js:733 и worker-payments.js:1140 теперь заполняют assignment_id
--   Физически невозможно создать чекин без FK
--   Пора сделать constraint.

-- Защита: проверить что NULL'ов действительно нет
DO $$
DECLARE v_null_count int;
BEGIN
  SELECT COUNT(*) INTO v_null_count FROM field_checkins WHERE assignment_id IS NULL;
  IF v_null_count > 0 THEN
    RAISE EXCEPTION 'Миграция невозможна: % строк с assignment_id=NULL. Прогнать V087 заново?', v_null_count;
  END IF;
  RAISE NOTICE 'Все assignment_id заполнены, применяем NOT NULL';
END $$;

ALTER TABLE field_checkins
  ALTER COLUMN assignment_id SET NOT NULL;

-- Плюс — FK constraint (если его ещё нет)
-- Сначала проверить есть ли уже constraint
DO $$
DECLARE v_exists boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'field_checkins'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) LIKE '%employee_assignments%'
  ) INTO v_exists;

  IF NOT v_exists THEN
    ALTER TABLE field_checkins
      ADD CONSTRAINT fk_field_checkins_assignment_id
      FOREIGN KEY (assignment_id)
      REFERENCES employee_assignments(id)
      ON DELETE RESTRICT;  -- нельзя удалить assignment если есть чекины
    RAISE NOTICE 'FK constraint добавлен';
  ELSE
    RAISE NOTICE 'FK constraint уже существует, пропускаем';
  END IF;
END $$;
