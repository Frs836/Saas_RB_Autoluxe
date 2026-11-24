-- ============================================================
-- 0137_auto_generate_maintenance_trigger.sql
-- Trigger otomatis untuk membuat jadwal maintenance 6 bulan & 12 bulan
-- saat order diselesaikan atau garansi diterbitkan
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_auto_generate_maintenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- Cek jika status menjadi completed, diserahkan, atau menunggu_pembayaran
  IF (NEW.status IN ('completed', 'diserahkan', 'menunggu_pembayaran') AND (OLD.status IS DISTINCT FROM NEW.status)) THEN
    -- Panggil generator jika order adalah coating / polish / detailing
    PERFORM public.generate_maintenance_schedules(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_maintenance_schedules ON public.orders;
CREATE TRIGGER trg_orders_maintenance_schedules
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_auto_generate_maintenance();

-- Juga pasang trigger saat warranty baru dibuat
CREATE OR REPLACE FUNCTION public.trg_warranty_generate_maintenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.order_id IS NOT NULL THEN
    PERFORM public.generate_maintenance_schedules(NEW.order_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_warranties_maintenance_schedules ON public.warranties;
CREATE TRIGGER trg_warranties_maintenance_schedules
  AFTER INSERT OR UPDATE ON public.warranties
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_warranty_generate_maintenance();
