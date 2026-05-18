ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS sender_category TEXT
    CHECK (sender_category IN (
      'automated','client','internal'
    ));

CREATE INDEX IF NOT EXISTS idx_et_sender_category
  ON email_threads(sender_category);

CREATE INDEX IF NOT EXISTS idx_et_from_email
  ON email_threads(from_email);
