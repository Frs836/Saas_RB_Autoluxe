-- 0067: force PostgREST schema refresh
--
-- PostgREST caches the schema. Touching a system table or creating a dummy function
-- forces PostgREST to reload its schema cache.

-- Create a dummy function and immediately drop it to force schema refresh
CREATE OR REPLACE FUNCTION public.pgrst_dummy_refresh()
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
    -- Do nothing, just force schema reload
    NULL;
END;
$function$;

DROP FUNCTION public.pgrst_dummy_refresh();

-- Also touch the service_material_recipes table to fire any triggers
UPDATE public.service_material_recipes
SET updated_at = now()
WHERE id = (SELECT id FROM public.service_material_recipes LIMIT 1);