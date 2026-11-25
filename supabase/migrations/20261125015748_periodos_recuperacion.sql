BEGIN;
CREATE TABLE periodos_recuperacion (
 id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 ciclo_lectivo INTEGER NOT NULL REFERENCES ciclos_lectivos(anio),
 cierre SMALLINT NOT NULL CHECK (cierre IN (1,2)),
 modo TEXT NOT NULL CHECK (modo IN ('automatico','habilitado','bloqueado')),
 actor_id INTEGER NOT NULL REFERENCES usuarios(id),
 actualizado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(ciclo_lectivo,cierre)
);
ALTER TABLE periodos_recuperacion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON periodos_recuperacion FROM PUBLIC;
-- Solo el backend con autenticación y rol escolar puede configurar estos períodos.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON periodos_recuperacion FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON periodos_recuperacion FROM authenticated; END IF;
END $$;
COMMIT;
