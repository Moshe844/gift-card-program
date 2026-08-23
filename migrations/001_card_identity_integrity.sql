BEGIN;

-- A phone number may legitimately own multiple cards. Remove only uniqueness
-- constraints whose sole column is phone; do not touch composite constraints.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'gifts'::regclass
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname ORDER BY key_column.ordinality)
        FROM unnest(c.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = key_column.attnum
      ) = ARRAY['phone']::name[]
  LOOP
    EXECUTE format('ALTER TABLE gifts DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

-- Also remove a standalone phone-only unique index, if an older deployment
-- created the index directly instead of through a table constraint.
DO $$
DECLARE
  index_record record;
BEGIN
  FOR index_record IN
    SELECT namespace.nspname AS schema_name, index_class.relname AS index_name
    FROM pg_index index_info
    JOIN pg_class index_class ON index_class.oid = index_info.indexrelid
    JOIN pg_namespace namespace ON namespace.oid = index_class.relnamespace
    JOIN pg_attribute column_info
      ON column_info.attrelid = index_info.indrelid
      AND column_info.attnum = ANY(index_info.indkey)
    LEFT JOIN pg_constraint constraint_info ON constraint_info.conindid = index_info.indexrelid
    WHERE index_info.indrelid = 'gifts'::regclass
      AND index_info.indisunique
      AND NOT index_info.indisprimary
      AND index_info.indnatts = 1
      AND column_info.attname = 'phone'
      AND constraint_info.oid IS NULL
  LOOP
    EXECUTE format('DROP INDEX %I.%I', index_record.schema_name, index_record.index_name);
  END LOOP;
END $$;

-- Duplicated card numbers make exact ownership impossible. Stop instead of
-- guessing which live financial record is correct.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM gifts GROUP BY cardnum HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate card numbers exist. Run npm run db:audit and resolve them before migrating.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS gifts_cardnum_unique_idx ON gifts (cardnum);
CREATE INDEX IF NOT EXISTS gifts_phone_idx ON gifts (phone, id);
CREATE TABLE IF NOT EXISTS gift_activity (
  id bigserial PRIMARY KEY,
  phone varchar(10),
  card_last4 varchar(4),
  event_type text NOT NULL,
  status text NOT NULL,
  message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gift_activity_phone_created_idx ON gift_activity (phone, created_at DESC);

-- NOT VALID preserves existing rows for review while protecting every new or
-- updated row immediately.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'gifts'::regclass AND conname = 'gifts_phone_format_check') THEN
    ALTER TABLE gifts ADD CONSTRAINT gifts_phone_format_check
      CHECK (phone IS NOT NULL AND phone ~ '^\d{10}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'gifts'::regclass AND conname = 'gifts_cardnum_format_check') THEN
    ALTER TABLE gifts ADD CONSTRAINT gifts_cardnum_format_check
      CHECK (cardnum IS NOT NULL AND cardnum ~ '^\d{12,19}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'gifts'::regclass AND conname = 'gifts_amount_positive_check') THEN
    ALTER TABLE gifts ADD CONSTRAINT gifts_amount_positive_check
      CHECK (amount IS NOT NULL AND amount > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'gifts'::regclass AND conname = 'gifts_balance_nonnegative_check') THEN
    ALTER TABLE gifts ADD CONSTRAINT gifts_balance_nonnegative_check
      CHECK (balance IS NULL OR balance >= 0) NOT VALID;
  END IF;
END $$;

COMMIT;
