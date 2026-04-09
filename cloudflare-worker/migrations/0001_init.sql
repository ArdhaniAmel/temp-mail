CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  sender TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  received_at TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  raw_headers TEXT
);

CREATE INDEX IF NOT EXISTS idx_emails_recipient_received
ON emails(recipient, received_at DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL,
  filename TEXT,
  content_type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachments_email_id
ON attachments(email_id);
