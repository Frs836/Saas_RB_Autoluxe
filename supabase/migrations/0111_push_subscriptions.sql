-- 0111: Push notification subscriptions
-- Menyimpan Web Push subscription per device per user.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint     text        NOT NULL,
  p256dh       text        NOT NULL,  -- public key
  auth         text        NOT NULL,  -- auth secret
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_profile_idx ON public.push_subscriptions (profile_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- User hanya bisa lihat & hapus subscription miliknya sendiri
CREATE POLICY push_select ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (profile_id = (SELECT public.current_profile_id()));

CREATE POLICY push_insert ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (profile_id = (SELECT public.current_profile_id()));

CREATE POLICY push_delete ON public.push_subscriptions
  FOR DELETE TO authenticated
  USING (profile_id = (SELECT public.current_profile_id()));

-- Service role bisa baca semua (untuk kirim notifikasi dari server)
CREATE POLICY push_service_select ON public.push_subscriptions
  FOR SELECT TO service_role USING (true);

COMMENT ON TABLE public.push_subscriptions IS
  '0111: Web Push API subscriptions. Satu profil bisa punya banyak subscription (multi-device).';
