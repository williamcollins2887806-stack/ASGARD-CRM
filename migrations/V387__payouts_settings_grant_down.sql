-- V387 down: удаление настроек страницы выплат.
DELETE FROM settings
 WHERE key IN (
   'payout_manager_user_ids',
   'self_employed_tax_rate',
   'payout_confirm_ttl_hours',
   'payout_reminder_hours'
 );
