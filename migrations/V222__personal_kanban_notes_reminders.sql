-- V222: заметки и напоминания на карте личного канбана.
--
-- Заметки видны owner и руководителям. Напоминания — личные (привязаны к user_id).
-- Крон src/services/personal-kanban-reminders-cron.js каждую минуту разгребает
-- очередь is_done=false AND fired_at IS NULL AND remind_at<=now() (см. partial-index).

CREATE TABLE IF NOT EXISTS personal_kanban_card_notes (
  id          BIGSERIAL PRIMARY KEY,
  card_id     INTEGER NOT NULL REFERENCES personal_kanban_cards(id) ON DELETE CASCADE,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- author_id NULL-able с ON DELETE SET NULL: заметки переживают удаление автора
-- (показывается как «[удалённый пользователь]» в UI). Сама заметка важнее, чем имя автора.

ALTER TABLE personal_kanban_card_notes DROP CONSTRAINT IF EXISTS chk_pk_notes_body_len;
ALTER TABLE personal_kanban_card_notes ADD CONSTRAINT chk_pk_notes_body_len
  CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000);

CREATE INDEX IF NOT EXISTS idx_pk_notes_card
  ON personal_kanban_card_notes(card_id, created_at DESC);

COMMENT ON TABLE personal_kanban_card_notes IS
  'Заметки на карте. Видит owner + руководители (HEAD_PM, директора).';

CREATE TABLE IF NOT EXISTS personal_kanban_card_reminders (
  id          BIGSERIAL PRIMARY KEY,
  card_id     INTEGER NOT NULL REFERENCES personal_kanban_cards(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remind_at   TIMESTAMPTZ NOT NULL,
  message     TEXT,
  is_done     BOOLEAN NOT NULL DEFAULT FALSE,
  fired_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE personal_kanban_card_reminders DROP CONSTRAINT IF EXISTS chk_pk_reminders_msg_len;
ALTER TABLE personal_kanban_card_reminders ADD CONSTRAINT chk_pk_reminders_msg_len
  CHECK (message IS NULL OR char_length(btrim(message)) BETWEEN 1 AND 500);

-- Partial-index «очередь крона»: только не-выполненные и не-выстрелившие.
CREATE INDEX IF NOT EXISTS idx_pk_reminders_due
  ON personal_kanban_card_reminders(remind_at)
  WHERE is_done = FALSE AND fired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pk_reminders_user_open
  ON personal_kanban_card_reminders(user_id, is_done, remind_at);

COMMENT ON TABLE personal_kanban_card_reminders IS
  'Личные напоминания PM на карте. Крон каждую минуту обрабатывает очередь по idx_pk_reminders_due.';
COMMENT ON COLUMN personal_kanban_card_reminders.fired_at IS
  'Момент, когда крон отправил пуш. NULL = ещё не выстрелило.';
