-- ============================================================
-- 0149_include_face_reset_in_maintainer_wipe.sql
-- Sertakan reset data wajah (face_descriptor, foto, status verifikasi)
-- pada maintainer_wipe_attendance dan maintainer_master_wipe
-- agar saat maintainer mereset data absensi atau sistem,
-- seluruh data wajah staf juga ikut bersih dan dapat didaftarkan ulang.
-- ============================================================

CREATE OR REPLACE FUNCTION public.maintainer_wipe_attendance(
    p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted_attendances int := 0;
    v_deleted_time_off int := 0;
    v_deleted_handoffs int := 0;
    v_deleted_oil int := 0;
    v_reset_faces int := 0;
    v_target_profile_ids uuid[];
BEGIN
    PERFORM public.check_is_maintainer_or_owner();

    IF p_branch_id IS NOT NULL THEN
        SELECT array_agg(id) INTO v_target_profile_ids FROM public.profiles WHERE branch_id = p_branch_id;
    END IF;

    IF p_branch_id IS NULL THEN
        WITH d1 AS (DELETE FROM public.attendance_logs RETURNING id) SELECT count(*) INTO v_deleted_attendances FROM d1;
        WITH d2 AS (DELETE FROM public.time_off_requests RETURNING id) SELECT count(*) INTO v_deleted_time_off FROM d2;
        WITH d3 AS (DELETE FROM public.shift_handoffs RETURNING id) SELECT count(*) INTO v_deleted_handoffs FROM d3;
        WITH d5 AS (DELETE FROM public.off_in_lieu_logs RETURNING id) SELECT count(*) INTO v_deleted_oil FROM d5;
        
        -- Reset data wajah seluruh profil
        WITH rf AS (
            UPDATE public.profiles
               SET face_descriptor          = NULL,
                   face_reference_photo_url = NULL,
                   face_registered_at       = NULL,
                   face_verification        = NULL,
                   face_review_note         = NULL,
                   face_reviewed_at         = NULL,
                   face_reviewed_by         = NULL,
                   updated_at               = now()
             WHERE face_descriptor IS NOT NULL
            RETURNING id
        ) SELECT count(*) INTO v_reset_faces FROM rf;
    ELSE
        IF v_target_profile_ids IS NOT NULL AND array_length(v_target_profile_ids, 1) > 0 THEN
            WITH d1 AS (DELETE FROM public.attendance_logs WHERE profile_id = ANY(v_target_profile_ids) RETURNING id)
            SELECT count(*) INTO v_deleted_attendances FROM d1;

            WITH d2 AS (DELETE FROM public.time_off_requests WHERE profile_id = ANY(v_target_profile_ids) RETURNING id)
            SELECT count(*) INTO v_deleted_time_off FROM d2;

            WITH d5 AS (DELETE FROM public.off_in_lieu_logs WHERE profile_id = ANY(v_target_profile_ids) RETURNING id)
            SELECT count(*) INTO v_deleted_oil FROM d5;

            -- Reset data wajah profil pada cabang ini
            WITH rf AS (
                UPDATE public.profiles
                   SET face_descriptor          = NULL,
                       face_reference_photo_url = NULL,
                       face_registered_at       = NULL,
                       face_verification        = NULL,
                       face_review_note         = NULL,
                       face_reviewed_at         = NULL,
                       face_reviewed_by         = NULL,
                       updated_at               = now()
                 WHERE id = ANY(v_target_profile_ids) AND face_descriptor IS NOT NULL
                RETURNING id
            ) SELECT count(*) INTO v_reset_faces FROM rf;
        END IF;

        WITH d3 AS (DELETE FROM public.shift_handoffs WHERE branch_id = p_branch_id RETURNING id)
        SELECT count(*) INTO v_deleted_handoffs FROM d3;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_attendances', v_deleted_attendances,
        'deleted_time_off', v_deleted_time_off,
        'deleted_shift_handoffs', v_deleted_handoffs,
        'deleted_off_in_lieu_logs', v_deleted_oil,
        'reset_faces', v_reset_faces
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.maintainer_wipe_attendance TO authenticated;
