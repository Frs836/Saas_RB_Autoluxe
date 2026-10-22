-- Drop old set_service_recipe (5 params) to avoid overload ambiguity
DROP FUNCTION IF EXISTS public.set_service_recipe(
  uuid, uuid, uuid, numeric, boolean
);

-- The new 14-param version from 0063 is already in place