-- Enable pgcrypto extension for crypt() and gen_salt() functions
-- Required by create_staff_profile RPC for password hashing

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Verify extension is available
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'
  ) THEN
    RAISE EXCEPTION 'pgcrypto extension failed to install';
  END IF;
END $$;