-- Fix: gen_salt() function not found due to empty search_path
-- The create_staff_profile function uses SET search_path = '' which breaks
-- extensions.gen_salt() lookup. Change to explicit schema-qualified call.

CREATE OR REPLACE FUNCTION public.create_staff_profile(
    p_full_name text,
    p_email text,
    p_password text,
    p_phone_number text DEFAULT NULL,
    p_date_of_birth date DEFAULT NULL,
    p_branch_id uuid DEFAULT NULL,
    p_role user_role DEFAULT 'karyawan'::user_role,
    p_work_schedule work_schedule DEFAULT 'field'::work_schedule,
    p_is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor       uuid;
    v_actor_role  public.user_role;
    v_profile_id  uuid;
    v_auth_user   uuid;
    v_profile     public.profiles%rowtype;
BEGIN
    -- 1. Authorization: hanya maintainer/owner
    v_actor := public.current_profile_id();
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Sesi tidak valid.'; END IF;
    SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
    IF v_actor_role NOT IN ('owner','maintainer') THEN
        RAISE EXCEPTION 'Hanya maintainer/owner yang bisa menambah staf.';
    END IF;

    -- 2. Validasi input
    IF p_full_name IS NULL OR trim(p_full_name) = '' THEN RAISE EXCEPTION 'Nama lengkap wajib diisi.'; END IF;
    IF p_email IS NULL OR trim(p_email) = '' THEN RAISE EXCEPTION 'Email wajib diisi.'; END IF;
    IF p_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN RAISE EXCEPTION 'Format email tidak valid.'; END IF;
    IF p_password IS NULL OR length(p_password) < 8 THEN RAISE EXCEPTION 'Password minimal 8 karakter.'; END IF;
    IF p_date_of_birth IS NOT NULL AND p_date_of_birth > CURRENT_DATE THEN RAISE EXCEPTION 'Tanggal lahir tidak boleh di masa depan.'; END IF;

    -- Branch access check
    IF p_branch_id IS NOT NULL AND NOT public.can_access_branch(p_branch_id) THEN
        RAISE EXCEPTION 'Cabang tujuan tidak dapat diakses.';
    END IF;

    -- Create auth user - FIX: gunakan extensions.gen_salt('bf') eksplisit
    INSERT INTO auth.users (instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, confirmation_token)
    VALUES ('00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', lower(p_email), crypt(p_password, extensions.gen_salt('bf')), NOW(), jsonb_build_object('full_name', p_full_name), NOW(), NOW(), '') RETURNING id INTO v_auth_user;

    -- Fallback branch_id
    IF p_branch_id IS NULL THEN
        SELECT branch_id INTO p_branch_id FROM public.profiles WHERE id = public.current_profile_id();
    END IF;

    -- Create profile
    INSERT INTO public.profiles (id, auth_id, full_name, email, phone_number, date_of_birth, role, branch_id, work_schedule, is_active, created_at, updated_at)
    VALUES (v_auth_user, v_auth_user, p_full_name, lower(p_email), p_phone_number, p_date_of_birth, p_role, p_branch_id, p_work_schedule, p_is_active, NOW(), NOW())
    RETURNING * INTO v_profile;

    -- Activity log
    INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
    VALUES (public.current_profile_id(), 'staff.create', 'profile', v_auth_user, jsonb_build_object('full_name', p_full_name, 'email', p_email, 'role', p_role));

    RETURN jsonb_build_object('profile', to_jsonb(v_profile), 'auth_user_id', v_auth_user);
END;
$$;

-- Grant execute to authenticated
GRANT EXECUTE ON FUNCTION public.create_staff_profile(text, text, text, text, date, uuid, user_role, work_schedule, boolean) TO authenticated;

COMMENT ON FUNCTION public.create_staff_profile(text, text, text, text, date, uuid, user_role, work_schedule, boolean) IS 'Membuat akun staf baru tanpa email konfirmasi. Hanya maintainer/owner. Fix: extensions.gen_salt schema-qualified.';