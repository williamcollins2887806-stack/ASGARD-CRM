-- V202: База эталонных проектов для обучения Mimir Conductor
-- ═══════════════════════════════════════════════════════════════════════════
-- Идея: каждый завершённый проект (с фактическими цифрами) → эталон. Conductor
-- при просчёте новой работы тянет похожие эталоны через text-ILIKE (когда
-- embeddings офлайн) или векторный поиск (когда embeddings включатся) и
-- использует план/факт/variance как опорные данные. Промпты агентов НЕ
-- содержат хардкод-цифр — все нормы берутся из эталонов + ГЭСН.
--
-- Feedback-loop: после реальной работы РП через UI вносит факт → запись
-- в эту таблицу → точность следующих просчётов растёт.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mimir_reference_projects (
    id SERIAL PRIMARY KEY,

    -- Идентификация проекта
    customer_name TEXT NOT NULL,
    customer_inn TEXT,
    customer_kpp TEXT,
    object_name TEXT,                        -- «Цех Аммиак-2», «АГПЗ установка 1.7», ...
    city TEXT,
    region TEXT,                              -- ЯНАО, Кемеровская обл и т.д.

    -- Тип работ (для text-ILIKE поиска)
    work_type TEXT NOT NULL,                  -- 'гидромеханическая очистка теплообменных труб'
    work_subtype TEXT,                        -- 'аммиачные генератор-ректификаторы 901Г'
    industry_sector TEXT,                     -- 'нефтехимия', 'газопереработка', 'СПГ', 'химия'
    asset_type TEXT,                          -- 'теплообменник', 'АВО', 'емкость', 'трубопровод'

    -- Договор/контракт
    contract_number TEXT,
    contract_date DATE,
    contract_value_planned NUMERIC(14,2),     -- цена договора план
    contract_value_actual NUMERIC(14,2),      -- цена договора факт (с ДС/доплатами)
    vat_rate_pct NUMERIC(5,2) DEFAULT 22,     -- ставка НДС
    contract_value_planned_no_vat NUMERIC(14,2), -- без НДС
    contract_value_actual_no_vat NUMERIC(14,2),

    -- Финансовый результат (главное для обучения)
    cost_planned NUMERIC(14,2),               -- плановая себестоимость
    cost_actual NUMERIC(14,2),                -- фактическая себестоимость
    profit_planned NUMERIC(14,2),
    profit_actual NUMERIC(14,2),              -- может быть отрицательная (убыток КАО Азот)
    margin_planned_pct NUMERIC(5,2),
    margin_actual_pct NUMERIC(5,2),

    -- Длительность
    duration_planned_calendar_days INTEGER,
    duration_actual_calendar_days INTEGER,
    duration_planned_workshifts INTEGER,
    duration_actual_workshifts INTEGER,
    date_start DATE,
    date_end_planned DATE,
    date_end_actual DATE,

    -- Бригада
    crew_size_planned INTEGER,
    crew_size_actual INTEGER,
    crew_composition_actual JSONB,            -- {"ИТР":1, "мастер":2, "слесарь":18}
    work_regime TEXT,                         -- 'круглосуточно', '2 смены', '1 смена 5/2'

    -- Полная структура ресурсов из факта (для точного RAG)
    resources_actual JSONB,
    -- {
    --   "labor": {
    --     "rates": {"ИТР": 10000, "мастер": 8000, "слесарь": 6500},
    --     "multipliers": {"вредность": 1.04, "многосменность": 1.20},
    --     "per_diem_rub_per_day": 1000,
    --     "payroll_tax_pct": 30.2
    --   },
    --   "materials": [
    --     {"name": "Свёрла Ø20-33", "qty_planned": 50, "qty_actual": 170, "unit": "шт", "price": 1837}
    --   ],
    --   "equipment": [...],
    --   "chemistry": [...],
    --   "travel": {
    --     "hotel_itr_rub_per_day": 2800, "dorm_worker_rub_per_day": 1600,
    --     "transport_bus_rub_per_day": 12000
    --   },
    --   "logistics": {"freight_one_way_rub": 145000, "express_per_send_rub": 21000},
    --   "ppe_kit_rub_per_person": 16370,
    --   "overheads_pct": 19.3,
    --   "warranty_reserve_pct": 2.4,
    --   "finance_rate_pct": 18.0
    -- }

    -- Отклонения и причины
    variance JSONB,
    -- {
    --   "cost_pct": 80, "duration_pct": 260, "crew_pct": 40, "materials_pct": 240,
    --   "root_causes": ["скрытое состояние объекта", "невозможность пред-обследования"]
    -- }

    -- Инсайты (что должно учитываться в будущих просчётах)
    insights JSONB,
    -- {
    --   "lessons_learned": [...],
    --   "risk_factors_realized": [...],
    --   "what_to_check_before_bid": [
    --     "Запросить актуальные протоколы ВИК (<3 года)",
    --     "Если ВИК старше 3 лет — добавить buffer +50% к материалам"
    --   ],
    --   "applicable_for_future": "гидромеханическая очистка теплообменников где невозможен пред-осмотр"
    -- }

    -- Связи
    source_work_id INTEGER REFERENCES works(id) ON DELETE SET NULL,
    source_tender_id INTEGER REFERENCES tenders(id) ON DELETE SET NULL,
    source_document_ids INTEGER[],            -- массив id из documents (исходники)

    -- Качество эталона
    quality_score INTEGER DEFAULT 5,          -- 1-10, сколько доверяем (1 — сырые данные, 10 — золотой эталон)
    is_active BOOLEAN DEFAULT TRUE,           -- можно временно отключить

    -- Метаданные
    notes TEXT,
    embedding_text TEXT,                      -- денормализованный текст для поиска (work_type + object + scope)
    -- embedding VECTOR(1536),                -- закомментировано: pgvector экстеншн + 1536 размерность OpenAI
    -- Добавим колонку embedding отдельной миграцией когда токенатор включит embeddings

    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mrp_work_type ON mimir_reference_projects (lower(work_type));
CREATE INDEX IF NOT EXISTS idx_mrp_customer ON mimir_reference_projects (lower(customer_name));
CREATE INDEX IF NOT EXISTS idx_mrp_object ON mimir_reference_projects (lower(object_name));
CREATE INDEX IF NOT EXISTS idx_mrp_industry ON mimir_reference_projects (industry_sector);
CREATE INDEX IF NOT EXISTS idx_mrp_active ON mimir_reference_projects (is_active);
-- pg_trgm для нечёткого поиска по work_type (если экстеншн есть)
-- CREATE INDEX IF NOT EXISTS idx_mrp_wt_trgm ON mimir_reference_projects USING gin (work_type gin_trgm_ops);

-- Регистрация миграции выполняется migrations/run.js (INSERT INTO migrations(name)).
-- Прямой INSERT здесь убран: колонки `version` нет, схема `migrations(id,name,executed_at)`.
