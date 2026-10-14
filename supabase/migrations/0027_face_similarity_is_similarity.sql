-- 0027_face_similarity_is_similarity.sql
--
-- Perbaikan: face_similarity mengembalikan jarak, bukan kemiripan.
--
-- 0026 memakai rumus 1 - (a.b / |a||b|). Itu jarak kosinus: vektor identik
-- bernilai 0, tegak lurus 1, berlawanan arah 2. Padahal pemanggilannya
-- membandingkan hasilnya terhadap ambang 0,5 dengan asumsi makin besar makin
-- mirip, sehingga wajah yang persis sama justru terlemah dan ditolak.
--
-- Yang dipakai di sini adalah kosinus similarity itu sendiri: 1 berarti
-- identik, 0 tegak lurus, negatif berlawanan arah.

CREATE OR REPLACE FUNCTION public.face_similarity(
  a double precision[],
  b double precision[]
) RETURNS double precision
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN a IS NULL OR b IS NULL THEN NULL
    WHEN array_length(a, 1) IS NULL THEN NULL
    WHEN array_length(a, 1) <> array_length(b, 1) THEN NULL
    ELSE (
      SELECT pg_catalog.sum(a[i] * b[i])
             / NULLIF(
                 pg_catalog.sqrt(pg_catalog.sum(a[i] * a[i]))
                 * pg_catalog.sqrt(pg_catalog.sum(b[i] * b[i])),
               0)
      FROM pg_catalog.generate_subscripts(a, 1) AS g(i)
    )
  END;
$function$;

-- Uji cepat agar kekeliruan yang sama tidak terulang diam-diam.
DO $$
DECLARE
  v_uji double precision;
BEGIN
  v_uji := public.face_similarity(array[1,0,0], array[1,0,0]);
  IF abs(v_uji - 1.0) > 0.0001 THEN
    RAISE EXCEPTION 'face_similarity rusak: vektor identik menghasilkan %, seharusnya 1', v_uji;
  END IF;

  v_uji := public.face_similarity(array[1,0,0], array[0,1,0]);
  IF abs(v_uji - 0.0) > 0.0001 THEN
    RAISE EXCEPTION 'face_similarity rusak: vektor tegak lurus menghasilkan %, seharusnya 0', v_uji;
  END IF;

  v_uji := public.face_similarity(array[1,0,0], array[-1,0,0]);
  IF abs(v_uji + 1.0) > 0.0001 THEN
    RAISE EXCEPTION 'face_similarity rusak: vektor berlawanan menghasilkan %, seharusnya -1', v_uji;
  END IF;
END;
$$;