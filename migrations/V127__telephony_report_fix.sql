-- V127: Фикс отчётов по звонкам — устранение "Неизвестного" в статистике
-- Добавляем индекс для ускорения fallback-поиска сотрудника по номеру телефона

CREATE INDEX IF NOT EXISTS idx_users_phone_normalized
  ON users (right(replace(replace(COALESCE(phone,''), '+', ''), '-', ''), 10))
  WHERE is_active = true AND phone IS NOT NULL;

-- Баннер обновления
INSERT INTO app_updates (version, title, changes, target) VALUES (
  '20.13.28',
  'Телефония: фикс "Неизвестного" в отчётах',
  '[
    {"icon":"📊","text":"В ежедневных отчётах по звонкам устранена строка «Неизвестный» — каждый звонок теперь попадает к конкретному сотруднику"},
    {"icon":"🔄","text":"Новая кнопка «Синхронизировать extensions из Mango» в разделе Маршрутизация — автоматически привязывает внутренние номера Mango к аккаунтам CRM"},
    {"icon":"🔍","text":"Улучшен fallback-поиск сотрудника по номеру телефона при отсутствии extension"}
  ]'::jsonb,
  'all'
) ON CONFLICT DO NOTHING;
