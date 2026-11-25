BEGIN;
ALTER TABLE evaluaciones ADD COLUMN obligatoria BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE evaluaciones ADD COLUMN alumno_destino_id INTEGER REFERENCES usuarios(id);
ALTER TABLE evaluaciones ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notas ADD COLUMN observaciones TEXT NOT NULL DEFAULT '' CHECK (length(observaciones)<=2000);
ALTER TABLE notas ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notas ADD COLUMN nota_conceptual TEXT CHECK (nota_conceptual IS NULL OR nota_conceptual='EN_PROCESO');
ALTER TABLE notas ALTER COLUMN nota DROP NOT NULL;
-- Las participaciones negativas son ajustes, no notas negativas: conservar su efecto por tipo.
UPDATE notas n SET nota=abs(n.nota) FROM evaluaciones e WHERE e.id=n.evaluacion_id AND n.nota<0 AND lower(e.tipo) LIKE '%particip%';
ALTER TABLE notas ADD CONSTRAINT nota_valor_consistente CHECK (
  (nota_conceptual IS NOT NULL AND nota_conceptual='EN_PROCESO' AND nota IS NULL) OR (nota_conceptual IS NULL AND nota IS NOT NULL AND nota>=0 AND nota<=10));
UPDATE evaluaciones e SET alumno_destino_id=(SELECT min(alumno_id) FROM notas WHERE evaluacion_id=e.id) WHERE (COALESCE(e.cierre,0)>0 OR e.descripcion LIKE 'Import%') AND (SELECT count(*) FROM notas WHERE evaluacion_id=e.id)=1;
CREATE TABLE cierres_academicos (
 id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 curso_materia_id INTEGER NOT NULL REFERENCES curso_materia(id),
 bimestre INTEGER NOT NULL CHECK (bimestre BETWEEN 0 AND 4),
 cerrado BOOLEAN NOT NULL DEFAULT true,
 actor_id INTEGER NOT NULL REFERENCES usuarios(id),
 actualizado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(curso_materia_id,bimestre)
);
CREATE TABLE historial_evaluaciones (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 evaluacion_id INTEGER NOT NULL, curso_materia_id INTEGER NOT NULL,
 actor_id INTEGER, fecha TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 anterior JSONB NOT NULL, nuevo JSONB NOT NULL
);
ALTER TABLE historial_notas ADD COLUMN detalle_anterior JSONB;
ALTER TABLE historial_notas ADD COLUMN detalle_nuevo JSONB;
CREATE OR REPLACE FUNCTION public.auditar_cambio_nota() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  registro public.notas%ROWTYPE;
  datos_evaluacion JSONB;
  nombre_alumno TEXT;
  autor INTEGER := NULLIF(current_setting('app.actor_id', true), '')::INTEGER;
  nombre_autor TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN registro := OLD; ELSE registro := NEW; END IF;

  SELECT to_jsonb(e) INTO datos_evaluacion FROM public.evaluaciones e WHERE e.id = registro.evaluacion_id;
  SELECT concat_ws(' ', u.apellido, u.nombre) INTO nombre_alumno FROM public.usuarios u WHERE u.id = registro.alumno_id;
  -- En una cascada el padre puede haber desaparecido: conservar su instantánea.
  IF datos_evaluacion IS NULL OR nombre_alumno IS NULL THEN
    SELECT COALESCE(datos_evaluacion, h.evaluacion), COALESCE(nombre_alumno, h.alumno_nombre)
    INTO datos_evaluacion, nombre_alumno
    FROM public.historial_notas h WHERE h.nota_id = registro.id ORDER BY h.id DESC LIMIT 1;
  END IF;
  SELECT concat_ws(' ', u.nombre, u.apellido) INTO nombre_autor FROM public.usuarios u WHERE u.id = autor;

  INSERT INTO public.historial_notas
    (accion, nota_id, evaluacion_id, alumno_id, curso_materia_id, alumno_nombre,
     actor_id, actor_nombre, origen, nota_anterior, nota_nueva, evaluacion, detalle_anterior, detalle_nuevo)
  VALUES (
    CASE TG_OP WHEN 'INSERT' THEN 'ALTA' WHEN 'UPDATE' THEN 'MODIFICACION' ELSE 'BAJA' END,
    registro.id, registro.evaluacion_id, registro.alumno_id,
    (datos_evaluacion->>'curso_materia_id')::INTEGER,
    COALESCE(nombre_alumno, 'Alumno eliminado'), autor,
    COALESCE(nombre_autor, 'Sistema / fuera de la aplicación'),
    COALESCE(NULLIF(current_setting('app.audit_source', true), ''), 'sistema'),
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.nota END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.nota END,
    COALESCE(datos_evaluacion, '{}'::JSONB), to_jsonb(OLD), to_jsonb(NEW)
  );
  RETURN NULL;
END;
$$;

CREATE FUNCTION auditar_evaluacion() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW IS DISTINCT FROM OLD THEN
 INSERT INTO historial_evaluaciones(evaluacion_id,curso_materia_id,actor_id,anterior,nuevo)
 VALUES(NEW.id,NEW.curso_materia_id,NULLIF(current_setting('app.actor_id',true),'')::integer,to_jsonb(OLD),to_jsonb(NEW));
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER evaluacion_audit AFTER UPDATE ON evaluaciones FOR EACH ROW EXECUTE FUNCTION auditar_evaluacion();
CREATE TRIGGER evaluacion_historial_inmutable BEFORE UPDATE OR DELETE OR TRUNCATE ON historial_evaluaciones
 FOR EACH STATEMENT EXECUTE FUNCTION proteger_historial_notas();
CREATE FUNCTION proteger_estado_academico() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE ev RECORD; original RECORD; fila RECORD; vuelta integer; target integer; periodo integer;
BEGIN
 FOR vuelta IN 1..2 LOOP
   IF vuelta=1 THEN IF TG_OP='INSERT' THEN CONTINUE; END IF; fila:=OLD;
   ELSE IF TG_OP='DELETE' THEN CONTINUE; END IF; fila:=NEW; END IF;
   IF TG_TABLE_NAME='notas' THEN SELECT * INTO ev FROM evaluaciones WHERE id=fila.evaluacion_id;
   ELSE ev:=fila; END IF;
   IF ev.id IS NULL THEN CONTINUE; END IF;
   target:=ev.curso_materia_id; periodo:=COALESCE(ev.bimestre,0);
   PERFORM pg_advisory_xact_lock(842615,target);
   IF EXISTS(SELECT 1 FROM cierres_academicos WHERE curso_materia_id=target AND cerrado AND (bimestre=0 OR (periodo>0 AND bimestre=periodo))) THEN
     RAISE EXCEPTION 'La materia o el bimestre está cerrado. Reabrilo antes de modificarlo.' USING ERRCODE='55000';
   END IF;
 END LOOP;
 IF TG_OP='UPDATE' AND NEW IS DISTINCT FROM OLD THEN NEW.revision:=OLD.revision+1; END IF;
 IF TG_OP<>'DELETE' THEN
   IF TG_TABLE_NAME='evaluaciones' THEN
     IF NEW.evaluacion_origen_id IS NOT NULL THEN
       SELECT * INTO original FROM evaluaciones WHERE id=NEW.evaluacion_origen_id;
       IF original.id IS NULL OR original.id=NEW.id OR original.curso_materia_id<>NEW.curso_materia_id OR
          (NEW.fecha IS NOT NULL AND original.fecha IS NOT NULL AND NEW.fecha<original.fecha) THEN
          RAISE EXCEPTION 'Origen o fecha de recuperatorio inválidos' USING ERRCODE='23514';
       END IF;
     END IF;
     IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM evaluaciones WHERE evaluacion_origen_id=NEW.id AND fecha<NEW.fecha) THEN
       RAISE EXCEPTION 'Hay recuperatorios anteriores a la nueva fecha original' USING ERRCODE='23514';
     END IF;
   ELSE
     SELECT * INTO ev FROM evaluaciones WHERE id=NEW.evaluacion_id;
     IF lower(COALESCE(ev.tipo,'')) LIKE '%particip%' THEN
       IF NEW.nota_conceptual IS NOT NULL OR NEW.nota IS NULL OR NEW.nota<0 OR NEW.nota>1 THEN RAISE EXCEPTION 'Ajuste de participación inválido' USING ERRCODE='23514'; END IF;
     ELSIF NEW.nota_conceptual IS NULL AND (NEW.nota IS NULL OR NEW.nota<1 OR NEW.nota>10) THEN
       RAISE EXCEPTION 'La nota debe estar entre 1 y 10' USING ERRCODE='23514';
     END IF;
     IF ev.es_acumulativo=1 OR COALESCE(ev.cierre,0)>0 THEN
       IF ev.evaluacion_origen_id IS NULL THEN RAISE EXCEPTION 'El recuperatorio requiere evaluación original' USING ERRCODE='23514'; END IF;
       SELECT n.*,e.cierre,e.tipo INTO original FROM notas n JOIN evaluaciones e ON e.id=n.evaluacion_id WHERE n.alumno_id=NEW.alumno_id AND e.id=ev.evaluacion_origen_id;
       IF original.id IS NULL OR original.nota>=6 OR lower(COALESCE(original.tipo,'')) LIKE '%particip%' OR
          (ev.cierre=1 AND COALESCE(original.cierre,0)<>0) OR (ev.cierre=2 AND COALESCE(original.cierre,0)<>1) THEN
         RAISE EXCEPTION 'El alumno necesita una evaluación original pendiente para recuperar' USING ERRCODE='23514';
       END IF;
     END IF;
     IF TG_OP='UPDATE' AND NEW.nota>=6 AND EXISTS(SELECT 1 FROM evaluaciones e JOIN notas n ON n.evaluacion_id=e.id WHERE e.evaluacion_origen_id=NEW.evaluacion_id AND n.alumno_id=NEW.alumno_id) THEN
       RAISE EXCEPTION 'Retirá primero las recuperaciones de esta nota original' USING ERRCODE='23514';
     END IF;
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER estado_academico_notas BEFORE INSERT OR UPDATE OR DELETE ON notas FOR EACH ROW EXECUTE FUNCTION proteger_estado_academico();
CREATE TRIGGER estado_academico_evaluaciones BEFORE INSERT OR UPDATE OR DELETE ON evaluaciones FOR EACH ROW EXECUTE FUNCTION proteger_estado_academico();
ALTER TABLE cierres_academicos ENABLE ROW LEVEL SECURITY;
ALTER TABLE historial_evaluaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cierres_academicos,historial_evaluaciones FROM PUBLIC;
REVOKE ALL ON FUNCTION auditar_evaluacion(),proteger_estado_academico() FROM PUBLIC;
DO $$ DECLARE rol text; BEGIN
 FOREACH rol IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=rol) THEN
   EXECUTE format('REVOKE ALL ON cierres_academicos,historial_evaluaciones FROM %I',rol);
   EXECUTE format('REVOKE ALL ON SEQUENCE cierres_academicos_id_seq,historial_evaluaciones_id_seq FROM %I',rol);
  END IF;
 END LOOP;
END $$;
COMMIT;
