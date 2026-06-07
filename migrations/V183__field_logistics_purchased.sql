-- V183: Статус «Куплено» для логистики (билеты/жильё/трансфер).
-- До этого field_logistics.status был только pending -> ready (файл загружен) -> sent
-- (отправлено рабочему). Не было честного признака «оплачено/куплено», из-за чего этап
-- готовности билетов/жилья считался ненадёжно. status — VARCHAR без CHECK, поэтому новое
-- значение 'purchased' пишется без правки ограничения; добавляем только метаданные.

ALTER TABLE field_logistics
  ADD COLUMN IF NOT EXISTS purchased_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purchased_by INTEGER REFERENCES users(id);
