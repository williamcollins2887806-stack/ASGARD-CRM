-- Расширяем app_update_seen.user_type для мобильного CRM (офисные пользователи)
ALTER TABLE app_update_seen
  DROP CONSTRAINT IF EXISTS app_update_seen_user_type_check;

ALTER TABLE app_update_seen
  ADD CONSTRAINT app_update_seen_user_type_check
    CHECK (user_type IN ('field', 'desktop', 'mobile'));
