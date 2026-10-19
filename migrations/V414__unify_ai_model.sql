-- ═══════════════════════════════════════════════════════════════════════════
-- V414: единая модель AI по всей CRM (D-286, заказчик 19.10.2026)
-- ═══════════════════════════════════════════════════════════════════════════
-- «установи везде вот эту модель по всей СРМ, где используется дип сик флеш»
--
-- ПОЧЕМУ МИГРАЦИЯ, А НЕ ТОЛЬКО КОД.
-- src/services/ai-models.js — единый реестр, MODEL_DEFAULT обновлён на -1017.
-- НО модель читается ЕЩЁ И ИЗ settings.ai_config, и она перебивает код:
--   ai_provider.js:163  if (cfg.openai_model && !process.env.OPENAI_MODEL)
--                         OPENAI_MODEL = normalizeModelId(cfg.openai_model);
-- В проде там лежало `deepseek/deepseek-v4-pro` — модель, отключённая
-- 15.10.2026. То есть часть CRM работала на списанной модели, и смена
-- константы в коде НЕ меняла поведение.
--
-- LEGACY_MODEL_MAP теперь сводит v4-pro и v4.1-flash к -1017 и в рантайме,
-- но данные приводим явно: иначе настройку видно в UI как «v4-pro» и
-- администратор считает, что работает старая модель.

BEGIN;

-- 1. Настройка провайдера: любая старая deepseek/flash-модель → -1017.
--    ВНИМАНИЕ: settings.value_json имеет тип TEXT (не jsonb), поэтому работаем
--    через приведение ::jsonb и обратно ::text.
UPDATE settings
   SET value_json = jsonb_set(
         value_json::jsonb,
         '{openai_model}',
         to_jsonb('deepseek/deepseek-v4.1-flash-1017'::text))::text,
       updated_at = NOW()
 WHERE key = 'ai_config'
   AND (value_json::jsonb) ? 'openai_model'
   AND ((value_json::jsonb) ->> 'openai_model') IN (
         'deepseek/deepseek-v4-pro',
         'deepseek/deepseek-v4.1-flash',
         'deepseek-v4-pro',
         'deepseek-v4.1-flash'
       );

-- 2. Кэш анализа писем: помечаем, что записан другой моделью, чтобы кэш
--    не выдавал старый результат как «свежий» от новой модели.
--    В проде встречались разные написания ('deepseek-flash' и т.п.).
UPDATE mimir_hint_analysis_cache
   SET model_used = 'deepseek/deepseek-v4.1-flash-1017'
 WHERE model_used IN (
         'deepseek/deepseek-v4-pro',
         'deepseek/deepseek-v4.1-flash',
         'deepseek-v4-pro',
         'deepseek-v4.1-flash',
         'deepseek-flash'
       );

COMMIT;
