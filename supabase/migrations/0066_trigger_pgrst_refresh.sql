-- 0066: trigger PostgREST schema cache refresh by touching a table
--
-- PostgREST caches the schema. Adding a dummy trigger forces schema reload.

-- Create a dummy trigger on service_material_recipes to force schema reload
DROP TRIGGER IF EXISTS trigger_pgrst_refresh ON public.service_material_recipes;

CREATE OR REPLACE FUNCTION public.pgrst_schema_refresh()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
    RETURN NEW;
END;
$function$;

CREATE TRIGGER trigger_pgrst_refresh
    AFTER INSERT OR UPDATE OR DELETE ON public.service_material_recipes
    FOR EACH ROW EXECUTE FUNCTION public.pgrst_schema_refresh();

-- Also touch the table to fire the trigger
UPDATE public.service_material_recipes
SET updated_at = now()
WHERE id = (SELECT id FROM public.service_material_recipes LIMIT 1);