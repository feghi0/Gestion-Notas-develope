BEGIN;

ALTER TABLE public.usuarios ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;

CREATE FUNCTION public.revocar_sesiones_usuario() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.activo IS DISTINCT FROM OLD.activo
     OR NEW.password IS DISTINCT FROM OLD.password
     OR NEW.rango IS DISTINCT FROM OLD.rango
     OR NEW.permiso IS DISTINCT FROM OLD.permiso THEN
    NEW.session_version := OLD.session_version + 1;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.revocar_sesiones_usuario() FROM PUBLIC;
CREATE TRIGGER usuarios_revocar_sesiones BEFORE UPDATE ON public.usuarios
FOR EACH ROW EXECUTE FUNCTION public.revocar_sesiones_usuario();

-- Sin FK a los datos vivos: el historial sobrevive a eliminaciones en cascada.
CREATE TABLE public.historial_notas (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fecha TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  accion TEXT NOT NULL CHECK (accion IN ('INICIAL', 'ALTA', 'MODIFICACION', 'BAJA')),
  nota_id INTEGER NOT NULL,
  evaluacion_id INTEGER NOT NULL,
  alumno_id INTEGER NOT NULL,
  curso_materia_id INTEGER,
  alumno_nombre TEXT NOT NULL,
  actor_id INTEGER,
  actor_nombre TEXT NOT NULL,
  origen TEXT NOT NULL,
  nota_anterior NUMERIC(4,2),
  nota_nueva NUMERIC(4,2),
  evaluacion JSONB NOT NULL
);
CREATE INDEX historial_notas_materia_id_idx ON public.historial_notas (curso_materia_id, id DESC);
CREATE INDEX historial_notas_materia_alumno_id_idx ON public.historial_notas (curso_materia_id, alumno_id, id DESC);
CREATE INDEX historial_notas_nota_id_idx ON public.historial_notas (nota_id, id DESC);
ALTER TABLE public.historial_notas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.historial_notas FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.historial_notas_id_seq FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.historial_notas FROM anon;
    REVOKE ALL ON SEQUENCE public.historial_notas_id_seq FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.historial_notas FROM authenticated;
    REVOKE ALL ON SEQUENCE public.historial_notas_id_seq FROM authenticated;
  END IF;
END $$;

-- No se inventa un autor ni una fecha de modificación para las notas previas.
INSERT INTO public.historial_notas
  (accion, nota_id, evaluacion_id, alumno_id, curso_materia_id, alumno_nombre,
   actor_nombre, origen, nota_nueva, evaluacion)
SELECT 'INICIAL', n.id, n.evaluacion_id, n.alumno_id, e.curso_materia_id,
       concat_ws(' ', u.apellido, u.nombre), 'Autor previo desconocido',
       'Estado al habilitar el historial', n.nota, to_jsonb(e)
FROM public.notas n
JOIN public.evaluaciones e ON e.id = n.evaluacion_id
JOIN public.usuarios u ON u.id = n.alumno_id;

CREATE FUNCTION public.auditar_cambio_nota() RETURNS TRIGGER
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
     actor_id, actor_nombre, origen, nota_anterior, nota_nueva, evaluacion)
  VALUES (
    CASE TG_OP WHEN 'INSERT' THEN 'ALTA' WHEN 'UPDATE' THEN 'MODIFICACION' ELSE 'BAJA' END,
    registro.id, registro.evaluacion_id, registro.alumno_id,
    (datos_evaluacion->>'curso_materia_id')::INTEGER,
    COALESCE(nombre_alumno, 'Alumno eliminado'), autor,
    COALESCE(nombre_autor, 'Sistema / fuera de la aplicación'),
    COALESCE(NULLIF(current_setting('app.audit_source', true), ''), 'sistema'),
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.nota END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.nota END,
    COALESCE(datos_evaluacion, '{}'::JSONB)
  );
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.auditar_cambio_nota() FROM PUBLIC;
CREATE TRIGGER notas_historial AFTER INSERT OR UPDATE OR DELETE ON public.notas
FOR EACH ROW EXECUTE FUNCTION public.auditar_cambio_nota();

CREATE FUNCTION public.proteger_historial_notas() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'El historial de notas es de solo lectura';
END;
$$;
REVOKE ALL ON FUNCTION public.proteger_historial_notas() FROM PUBLIC;
CREATE TRIGGER historial_notas_solo_lectura BEFORE UPDATE OR DELETE OR TRUNCATE ON public.historial_notas
FOR EACH STATEMENT EXECUTE FUNCTION public.proteger_historial_notas();

COMMIT;
