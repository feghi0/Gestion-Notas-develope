BEGIN;
CREATE TABLE public.boletin_envios (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  curso_id INTEGER NOT NULL,
  alumno_id INTEGER NOT NULL,
  alumno_nombre TEXT NOT NULL,
  periodo TEXT NOT NULL,
  destinatario TEXT NOT NULL,
  remitente TEXT NOT NULL,
  contenido_hash TEXT NOT NULL,
  asunto TEXT NOT NULL,
  archivo TEXT NOT NULL,
  pdf BYTEA,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'enviando', 'enviado', 'fallido', 'incierto', 'sin_email')),
  intentos INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  error TEXT,
  message_id TEXT,
  creado_por INTEGER NOT NULL,
  ultimo_actor_id INTEGER,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  iniciado_en TIMESTAMPTZ,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  enviado_en TIMESTAMPTZ,
  UNIQUE (curso_id, alumno_id, destinatario, remitente, contenido_hash)
);
CREATE INDEX boletin_envios_curso_id_idx ON public.boletin_envios (curso_id, id DESC);
CREATE INDEX boletin_envios_pendientes_idx ON public.boletin_envios (curso_id, id) WHERE estado = 'pendiente';
ALTER TABLE public.boletin_envios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.boletin_envios FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.boletin_envios_id_seq FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.boletin_envios FROM anon;
    REVOKE ALL ON SEQUENCE public.boletin_envios_id_seq FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.boletin_envios FROM authenticated;
    REVOKE ALL ON SEQUENCE public.boletin_envios_id_seq FROM authenticated;
  END IF;
END $$;
COMMIT;
