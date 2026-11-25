# Mejoras de planilla y boletines

## Instalación

Aplicar `supabase/migrations/20261125005446_detailed_grades_academic_closures.sql`
antes de publicar el código. No se aplicó esta migración a producción durante
la implementación. Incluye metadatos, calificación conceptual, observaciones,
auditoría de evaluaciones y cierres académicos. Revisar datos históricos fuera
de escala antes de migrar: no se corrigen notas académicas inválidas en silencio.

## Comportamiento

- La planilla usa un viewport con encabezados fijos y una barra horizontal
  adicional sincronizada al pie de la ventana mientras la tabla está visible.
- Cada bimestre conserva una columna mínima independiente al colapsarlo.
- El estado pendiente de aprobación se presenta como «En proceso» en el motor
  compartido, planillas, estadísticas y exportaciones.
- El PDF es una matriz A4 horizontal: una fila por materia, bordes completos,
  filas indivisibles y encabezados repetidos al cambiar de página.
- El detalle permite editar tema, tipo, fecha, bimestre, obligatoriedad, nota
  numérica o conceptual y observaciones individuales. Los metadatos de una
  evaluación son compartidos; la pantalla lo informa explícitamente.
- Se verifican pertenencia, nota original pendiente, escala, formato, fecha,
  conflictos de edición y estado de cierre. PostgreSQL también bloquea las
  escrituras sobre instancias académicas cerradas.

## Reglas ajustables

`public/reglasAcademicas.js` contiene `calcularNotaFinal`, compartida por la
planilla y el servidor. Se conserva el criterio existente de promedio y prioridad
de importaciones y cierres; no se inventaron ponderaciones. La completitud de
evaluaciones obligatorias se valida en `lib/validacionAcademica.js`.

Los ajustes de participación se almacenan como magnitudes no negativas; el tipo
de valoración determina si suman o restan. No son notas académicas negativas.
Las calificaciones académicas nuevas admiten 1 a 10, hasta dos decimales, o el
estado conceptual «En proceso». Un recuperatorio exige una nota de origen
pendiente para ese alumno. Los cierres importados sin vínculo original se
rechazan para evitar recuperaciones sin antecedente.

Para cerrar una materia se exige información obligatoria en los cuatro bimestres
y resultados calculables sin recuperaciones pendientes. Cerrar no implica aprobar:
puede conservarse un resultado final de previa. Reabrir permite corregir datos.

## Verificación

Se ejecutaron las doce pruebas existentes, extendiendo integración con escala,
fechas, edición detallada, estado conceptual, recuperaciones y cierre/reapertura.
Se comprobó en Chromium local el colapsado independiente, scroll y apertura del
modal, sin errores de JavaScript y con una base aislada. No se enviaron correos
ni se modificaron datos de la instalación publicada.
