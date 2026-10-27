-- Fix: Add test mode flag to skip notifications during E2E/integration tests
-- This allows setting a database config to suppress notification inserts

-- Create a simple settings table if not exists
CREATE TABLE IF NOT EXISTS public.app_settings (
    key text PRIMARY KEY,
    value text NOT NULL,
    description text,
    updated_at timestamptz DEFAULT now()
);

-- Insert default setting for test mode
INSERT INTO public.app_settings (key, value, description)
VALUES ('test_mode', 'off', 'Set to "on" to skip notification inserts during automated tests')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Function to check if test mode is enabled
CREATE OR REPLACE FUNCTION public.is_test_mode()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT value = 'on' FROM public.app_settings WHERE key = 'test_mode';
$$;

-- Grant access
GRANT SELECT ON public.app_settings TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_test_mode() TO authenticated;

-- Update time_off request function to skip notifications in test mode
-- This will be done via a new migration that replaces the function