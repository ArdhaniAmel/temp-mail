ALTER TABLE emails ADD COLUMN sender_name TEXT;
ALTER TABLE emails ADD COLUMN snippet TEXT;
ALTER TABLE emails ADD COLUMN otp_code TEXT;
ALTER TABLE emails ADD COLUMN upstream_message_id TEXT;
ALTER TABLE emails ADD COLUMN dedupe_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_emails_dedupe_hash
ON emails(dedupe_hash);

CREATE INDEX IF NOT EXISTS idx_emails_recipient_unread
ON emails(recipient, is_read, received_at DESC);
