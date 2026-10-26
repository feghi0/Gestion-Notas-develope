BEGIN;
ALTER TABLE public.ciclos_lectivos ADD COLUMN apertura_automatica_en TIMESTAMPTZ;
ALTER TABLE public.cursos ADD COLUMN es_testing BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.ciclos_lectivos.apertura_automatica_en IS 'Registra la apertura automática anual para no revertir decisiones manuales posteriores.';
COMMENT ON COLUMN public.cursos.es_testing IS 'Curso con datos ficticios, excluido de la copia de estructura a futuros ciclos.';
COMMIT;
