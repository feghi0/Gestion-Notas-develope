BEGIN;
ALTER TABLE periodos_recuperacion DROP CONSTRAINT periodos_recuperacion_modo_check;
ALTER TABLE periodos_recuperacion ADD CONSTRAINT periodos_recuperacion_modo_check CHECK(modo IN ('automatico','habilitado','bloqueado','programado'));
ALTER TABLE periodos_recuperacion ADD COLUMN desde DATE;
ALTER TABLE periodos_recuperacion ADD COLUMN hasta DATE;
ALTER TABLE periodos_recuperacion ADD CONSTRAINT periodo_fechas_validas CHECK (
 (modo='programado' AND desde IS NOT NULL AND hasta IS NOT NULL AND desde<=hasta)
 OR (modo<>'programado' AND desde IS NULL AND hasta IS NULL)
);
COMMIT;
