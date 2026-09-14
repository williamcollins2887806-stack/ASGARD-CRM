-- V352: Token-согласование просчёта тендера по email + публичный cloud файлов без ЛК

CREATE TABLE IF NOT EXISTS tender_director_mail_tokens (
  id              SERIAL PRIMARY KEY,
  tender_id       INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  token_hash      CHAR(64) NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  used_action     VARCHAR(16),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tender_director_mail_tokens_tender
  ON tender_director_mail_tokens(tender_id);

CREATE TABLE IF NOT EXISTS tender_file_share_tokens (
  id              SERIAL PRIMARY KEY,
  tender_id       INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  token_hash      CHAR(64) NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tender_file_share_tokens_tender
  ON tender_file_share_tokens(tender_id);

COMMENT ON TABLE tender_director_mail_tokens IS 'Email-согласование просчёта РП директором без входа в CRM';
COMMENT ON TABLE tender_file_share_tokens IS 'Публичный просмотр/скачивание файлов тендера по ссылке из письма';
