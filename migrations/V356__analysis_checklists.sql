-- V356: Чек-листы анализа тендера (D-203)
-- Зачем: анализ нельзя закрыть, не заполнив чек-лист (10 базовых вопросов + свободные строки).
-- Чек-лист остаётся в карточке анализа, скачивается в Word и читается в карточке контрагента.
-- Шаблон вопросов живёт в settings.key='analysis_checklist_template', здесь — только ответы
-- и снимок шаблона (чтобы старый чек-лист читался так, как был заполнен).

CREATE TABLE IF NOT EXISTS tender_analysis_checklists (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  review_id INTEGER REFERENCES tender_rp_reviews(id) ON DELETE SET NULL,
  created_by_user_id INTEGER REFERENCES users(id),
  -- { "<question_id>": "<ответ>" }
  answers JSONB NOT NULL DEFAULT '{}',
  -- [{ id, text, answer }] — свободные строки (свои вопросы аналитика)
  free_answers JSONB NOT NULL DEFAULT '[]',
  -- снимок шаблона на момент заполнения
  template_snapshot JSONB NOT NULL DEFAULT '[]',
  -- денормализация для истории в карточке контрагента и Word
  work_title TEXT,
  customer_name TEXT,
  customer_inn TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Один чек-лист на тендер (перезапись при повторном сохранении).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tender_analysis_checklists_tender
  ON tender_analysis_checklists(tender_id);

CREATE INDEX IF NOT EXISTS idx_tender_analysis_checklists_inn
  ON tender_analysis_checklists(customer_inn);

CREATE INDEX IF NOT EXISTS idx_tender_analysis_checklists_created
  ON tender_analysis_checklists(created_at DESC);

COMMENT ON TABLE tender_analysis_checklists IS
  'Чек-лист анализа тендера: обязателен при закрытии анализа, хранит ответы и снимок шаблона';
COMMENT ON COLUMN tender_analysis_checklists.answers IS 'Ответы по базовым вопросам: {question_id: answer}';
COMMENT ON COLUMN tender_analysis_checklists.free_answers IS 'Свободные строки аналитика: [{id, text, answer}]';
COMMENT ON COLUMN tender_analysis_checklists.template_snapshot IS 'Снимок шаблона вопросов на момент заполнения';
