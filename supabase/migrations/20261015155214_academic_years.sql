BEGIN;
CREATE TABLE public.ciclos_lectivos (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  anio INTEGER NOT NULL UNIQUE CHECK (anio BETWEEN 2000 AND 2100),
  activo BOOLEAN NOT NULL DEFAULT false,
  cerrado BOOLEAN NOT NULL DEFAULT false,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT (activo AND cerrado))
);
CREATE UNIQUE INDEX ciclos_unico_actual ON public.ciclos_lectivos (activo) WHERE activo;
INSERT INTO public.ciclos_lectivos (anio, activo) VALUES (2026, true);
ALTER TABLE public.cursos ADD COLUMN ciclo_lectivo INTEGER NOT NULL DEFAULT 2026 REFERENCES public.ciclos_lectivos(anio);
CREATE INDEX cursos_ciclo_idx ON public.cursos (ciclo_lectivo);
ALTER TABLE public.alumno_curso ADD COLUMN activo SMALLINT NOT NULL DEFAULT 1 CHECK (activo IN (0,1));
ALTER TABLE public.ciclos_lectivos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ciclos_lectivos FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON public.ciclos_lectivos FROM anon;
    REVOKE ALL ON SEQUENCE public.ciclos_lectivos_id_seq FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON public.ciclos_lectivos FROM authenticated;
    REVOKE ALL ON SEQUENCE public.ciclos_lectivos_id_seq FROM authenticated;
  END IF;
END $$;

-- Defensa adicional: ni una ruta omitida puede modificar un año cerrado.
CREATE FUNCTION public.proteger_ciclo_cerrado() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public, pg_temp AS $$
DECLARE r RECORD; curso_id_actual INTEGER; bloqueado BOOLEAN; vuelta INTEGER;
BEGIN
  FOR vuelta IN 1..2 LOOP
    IF vuelta=1 THEN
      IF TG_OP='INSERT' THEN CONTINUE; END IF;
      r:=OLD;
    ELSE
      IF TG_OP='DELETE' THEN CONTINUE; END IF;
      r:=NEW;
    END IF;
    IF TG_TABLE_NAME='cursos' THEN
      IF TG_OP='UPDATE' AND NEW.ciclo_lectivo IS DISTINCT FROM OLD.ciclo_lectivo THEN
        RAISE EXCEPTION 'No se puede trasladar un curso existente a otro ciclo lectivo';
      END IF;
      SELECT cerrado INTO bloqueado FROM public.ciclos_lectivos WHERE anio=r.ciclo_lectivo;
    ELSE
      IF TG_TABLE_NAME IN ('curso_materia','alumno_curso','preceptor_curso') THEN
        curso_id_actual:=r.curso_id;
      ELSIF TG_TABLE_NAME IN ('evaluaciones','profesor_materia') THEN
        SELECT curso_id INTO curso_id_actual FROM public.curso_materia WHERE id=r.curso_materia_id;
      ELSE
        SELECT cm.curso_id INTO curso_id_actual FROM public.evaluaciones e
        JOIN public.curso_materia cm ON cm.id=e.curso_materia_id WHERE e.id=r.evaluacion_id;
      END IF;
      SELECT cl.cerrado INTO bloqueado FROM public.cursos c
      JOIN public.ciclos_lectivos cl ON cl.anio=c.ciclo_lectivo WHERE c.id=curso_id_actual;
    END IF;
    IF bloqueado THEN RAISE EXCEPTION 'El ciclo lectivo está cerrado; solo permite consultas' USING ERRCODE='55000'; END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.proteger_ciclo_cerrado() FROM PUBLIC;
DO $$ DECLARE tabla TEXT;
BEGIN
  FOREACH tabla IN ARRAY ARRAY['cursos','curso_materia','alumno_curso','preceptor_curso','evaluaciones','profesor_materia','notas'] LOOP
    EXECUTE format('CREATE TRIGGER ciclo_solo_lectura BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.proteger_ciclo_cerrado()', tabla);
  END LOOP;
END $$;
COMMIT;
