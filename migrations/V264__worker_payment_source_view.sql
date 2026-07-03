-- V264: worker_payment_source_v — каноническая классификация выплат рабочим
-- по ИСТОЧНИКУ ДЕНЕГ (касса РП / банк компании / СЗ-сервис / Авто-ФОТ).
--
-- Контекст:
--   src/lib/pm-balance.js — SSoT баланса РП. Из кассы РП вычитаются ТОЛЬКО
--   cash/card/transfer paid_by=PM_id и cash/card paid_by=NULL+work.pm_id=PM_id.
--   payment_method='bank'/'self'/'auto' — это деньги компании / автоматика ФОТ
--   из field_checkins (триггер V072a/V230 ставит payment_method='auto'),
--   они НЕ уходят из кассы РП.
--
-- Эта view раскладывает каждую запись worker_payments по 5 источникам:
--   pm_cash         — РП лично выдал (paid_by IS NOT NULL, cash/card/transfer)
--   pm_cash_legacy  — старая схема без paid_by, но на работе PM (cash/card, paid_by IS NULL)
--   company_bank    — payment_method='bank' (безнал с р/с компании)
--   company_se      — payment_method='self' (НПД через СЗ-сервис компании)
--   auto_fot        — payment_method='auto' (автоматика ФОТ от field_checkins)
--   other           — всё что не подошло (защитная категория)
--
-- is_from_pm_cash:
--   true  — строка УМЕНЬШАЕТ баланс РП (выплачено из кассы РП)
--   false — справочно, баланс РП НЕ трогается
--
-- Используется в:
--   - GET /api/payroll-dashboard/worker/:id/breakdown
--   - GET /api/payroll-dashboard/payouts-by-source
--   - GET /api/cash/statement (для пометки info-строк bank/se/auto)
--   - XLSX-выписка РП (колонка «Источник», блок «Из этого справочно»)

CREATE OR REPLACE VIEW worker_payment_source_v AS
SELECT wp.*,
  CASE
    WHEN wp.payment_method = 'bank'                                            THEN 'company_bank'
    WHEN wp.payment_method = 'self'                                            THEN 'company_se'
    WHEN wp.payment_method = 'auto'                                            THEN 'auto_fot'
    WHEN wp.paid_by IS NOT NULL AND wp.payment_method IN ('cash','card','transfer')
                                                                               THEN 'pm_cash'
    WHEN wp.paid_by IS NULL AND wp.payment_method IN ('cash','card')
                                                                               THEN 'pm_cash_legacy'
    ELSE 'other'
  END AS source_kind,
  CASE
    WHEN wp.payment_method IN ('bank','self','auto')                           THEN false  -- деньги компании / автоматика
    WHEN wp.paid_by IS NOT NULL AND wp.payment_method IN ('cash','card','transfer')
                                                                               THEN true   -- касса РП
    WHEN wp.paid_by IS NULL AND wp.payment_method IN ('cash','card')           THEN true   -- legacy касса РП
    ELSE false
  END AS is_from_pm_cash
FROM worker_payments wp;

COMMENT ON VIEW worker_payment_source_v IS
  'V264: каноническая классификация worker_payments по источнику денег '
  '(касса РП / банк компании / СЗ-сервис / Авто-ФОТ). Используется в '
  '/api/payroll-dashboard/worker/:id/breakdown, /payouts-by-source, '
  '/api/cash/statement и XLSX-выписке РП. SSoT баланса РП — src/lib/pm-balance.js.';
