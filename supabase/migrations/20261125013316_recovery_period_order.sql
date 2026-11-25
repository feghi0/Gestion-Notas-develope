BEGIN;
CREATE FUNCTION public.validar_orden_bimestre() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE origen RECORD;
BEGIN
 IF NEW.evaluacion_origen_id IS NOT NULL AND COALESCE(NEW.cierre,0)=0 THEN
  SELECT bimestre,cierre INTO origen FROM evaluaciones WHERE id=NEW.evaluacion_origen_id;
  IF origen.bimestre IS NULL OR COALESCE(origen.cierre,0)<>0 OR NEW.bimestre IS NULL
     OR NEW.bimestre<origen.bimestre THEN
   RAISE EXCEPTION 'La acumulativa debe guardarse en el mismo bimestre que la evaluación original o en uno posterior.' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM evaluaciones e WHERE e.evaluacion_origen_id=NEW.id
   AND COALESCE(e.cierre,0)=0 AND (COALESCE(NEW.cierre,0)<>0 OR NEW.bimestre IS NULL OR e.bimestre<NEW.bimestre)) THEN
  RAISE EXCEPTION 'No se puede mover el origen después del bimestre de sus acumulativas.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validar_orden_bimestre() FROM PUBLIC;
CREATE TRIGGER orden_bimestre BEFORE INSERT OR UPDATE ON public.evaluaciones
FOR EACH ROW EXECUTE FUNCTION public.validar_orden_bimestre();
COMMIT;
