-- V375: default receive_mode 'browser' (pure WebRTC).
-- V365 ставил 'both' (WebRTC + GSM каскад). Теперь «браузер» — только WebRTC;
-- GSM-плечо доступно лишь при явном выборе 'mobile' или 'both'.

ALTER TABLE pbx_operators ALTER COLUMN receive_mode SET DEFAULT 'browser';
