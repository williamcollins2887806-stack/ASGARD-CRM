-- V054: Add missing approval columns to cash_requests
-- Required by approvalService for approve/resubmit flows

ALTER TABLE cash_requests
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sent_for_approval_at TIMESTAMPTZ DEFAULT NULL;
