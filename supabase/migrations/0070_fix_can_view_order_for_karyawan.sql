-- 0070: fix can_view_order to allow karyawan to see available orders in their branch
--
-- Problem: can_view_order only allows karyawan to see orders they created,
-- are assigned to, or are in the team for. When an order is created by
-- maintainer/owner/admin without assigning a technician (p_team_ids: null),
-- karyawan cannot see it in their queue. They should be able to see
-- "available" orders in their branch: queued orders with no team assigned
-- (or they are in the team).

CREATE OR REPLACE FUNCTION public.can_view_order(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  select
    (select public.current_profile_id()) is not null
    and (
      -- Owner, admin_kasir, maintainer bisa lihat semua order
      (select public.has_role(
        array['owner', 'admin_kasir', 'maintainer']::public.user_role[]
      ))
      -- Owner/creator bisa lihat order yang dia buat
      or exists (
        select 1
          from public.orders o
         where o.id = p_order_id
           and (o.assigned_to = (select public.current_profile_id())
             or o.created_by  = (select public.current_profile_id()))
      )
      -- Anggota tim bisa lihat order yang mereka tim
      or exists (
        select 1
          from public.orders o
          join public.order_team_members t on t.order_id = o.id
         where o.id = p_order_id
           and t.profile_id = (select public.current_profile_id())
      )
      -- Karyawan bisa lihat order "tersedia" di cabang mereka:
      -- status queued, tidak ada tim yang ditugaskan, dan di cabang yang sama
      or exists (
        select 1
          from public.orders o
          join public.profiles p on p.id = (select public.current_profile_id())
         where o.id = p_order_id
           and o.status = 'queued'::public.order_status
           and o.assigned_to is null
           and not exists (
             select 1 from public.order_team_members t
              where t.order_id = o.id
           )
           and o.branch_id = p.branch_id
           and p.role = 'karyawan'::public.user_role
           and p.is_active
      )
    );
$function$;