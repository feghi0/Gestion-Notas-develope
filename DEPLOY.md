# Vercel + Supabase

Esta instalación es para una escuela. Se accede por Internet con usuarios creados
por la institución; no hay registro público ni separación entre escuelas.

## Instalación publicada

- Aplicación: https://gestion-de-notas.vercel.app
- Vercel: equipo `feghi0s-projects`, proyecto `gestion-de-notas`.
- Supabase: `chbpvymjssniakvklity`, São Paulo, plan Free.
- Datos ficticios: un curso, dos materias y seis usuarios de los cinco roles.
- Accesos de prueba: `.local/demo-credentials.json` (archivo privado local).
- Verificados en producción: health, login de todos los roles, consulta de
  planilla, Excel por materia y curso, y ZIP de boletines con envío de correos vía Gmail.
- GitHub conectado: Repositorio propio `feghi0/Gestion-Notas-develope`
  vinculado con Vercel. Despliegues automáticos (CI/CD) habilitados en cada push
  a `main`. El repositorio de Nazareno (`nazarenoapicella/Gestion-de-notas`)
  queda configurado como remote `upstream` para sincronizaciones futuras.

La integración de Vercel provee `POSTGRES_URL`; se configuró `DATABASE_URL` con
esa URI sin parámetros SSL que sobrescriban la validación del driver. Se añadió
`DB_SSL_CA` con la CA oficial de Supabase y se verificó TLS correctamente.

El asesor de Supabase solo mostró el aviso informativo
[RLS sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
en las tablas de la aplicación: es intencional, porque no hay acceso desde la API pública
de Supabase; las consultas pasan por el servidor Express autenticado.

## Base nueva

1. Crear un proyecto Supabase dedicado, preferentemente en São Paulo.
2. Ejecutar una sola vez `supabase/migrations/202610090001_initial.sql` en el SQL
   Editor. Incluye la columna `activo`, utilizada por la aplicación y ausente en
   el esquema antiguo del README. Las tablas tienen RLS y no permiten acceso
   directo desde las claves públicas de Supabase.
3. Para datos ficticios: `npm run db:seed:generate`. Ejecutar el contenido de
   `.local/seed-demo.sql`. El script rechaza bases con usuarios existentes.
   Las credenciales aleatorias quedan en `.local/demo-credentials.json`;
   conservarlas de forma privada. No se publican con Git ni Vercel.

## Variables de entorno

- `DATABASE_URL`: URI de **Connect → Transaction pooler**, puerto 6543.
  Codificar los caracteres especiales de la contraseña. Solo en el servidor.
- `JWT_SECRET`: secreto aleatorio de al menos 32 caracteres.
- `DB_POOL_MAX`: opcional, 3 por instancia de forma predeterminada.
- `DB_SSL_CA`: certificado CA si Supabase requiere su CA propia; conservar la
  validación TLS. `DB_SSL=false` es únicamente para desarrollo local.
- `GMAIL_USER` y `GMAIL_APP_PASSWORD`: opcionales para envío de boletines.
  Sin estas variables, probar descargas con `enviarMails=false`.
- `BOLETINES_TEST_EMAIL`: cuando está configurado, reemplaza todos los
  destinatarios por esa dirección y envía un solo correo por alumno.
  En testing se usa `gestionnotas35@gmail.com` como remitente y destinatario.
  Contraseña de aplicación configurada y envío verificado con éxito.
  Quitar esta variable cuando se pase a producción real para enviar a alumno y familiar.

La autenticación sigue usando los usuarios y roles de la escuela. Supabase se
usa como PostgreSQL, no como sustituto automático del login por Supabase Auth.
Sin `DATABASE_URL`, el desarrollo local conserva la conexión MariaDB anterior.

## Publicar

Vercel detecta Express en `server.js` y sirve `public/` mediante su CDN.
`vercel.json` selecciona São Paulo y hasta 300 segundos por solicitud.

```sh
npm ci
npm test
vercel link
# Cargar variables en el entorno production antes de publicar.
vercel --prod
```

Verificar `/api/health` (200), login y acceso por rol. Probar carga de una nota,
descarga Excel y ZIP de boletines. No enviar correos a personas reales durante
las pruebas. Los datos demo no incluyen direcciones de correo.

Los envíos se procesan en lotes de tres correos por petición. Los pendientes se
conservan si se cierra la pantalla y pueden continuarse desde el panel. Para
procesamiento autónomo sin una pantalla abierta se necesita un worker o una cola.
El limitador de login original usa memoria por instancia,
por lo que conviene añadir límites en Vercel Firewall para protección global.

Para desplegar cada commit automáticamente, la cuenta que conecta GitHub en
Vercel necesita permisos de escritura o administración sobre el repositorio.
El despliegue por CLI funciona independientemente de esa conexión.

## Sesiones e historial de notas

Aplicar `supabase/migrations/20261015135414_session_security_note_history.sql`
antes de desplegar la versión que valida `session_version`.
Estas mejoras requieren PostgreSQL; la instalación MariaDB original necesita
una migración equivalente antes de usar esta versión.

Cada petición autenticada consulta el estado actual del usuario. Una baja,
reactivación, cambio de contraseña, rol o permiso incrementa `session_version`
y revoca los tokens previos. Los tokens anteriores sin versión solo se admiten
mientras el usuario conserve la versión 0. Una base no disponible responde 503
y no autoriza el acceso. Una petición que ya estaba ejecutándose puede terminar.

El botón **Historial de notas** de la planilla permite consultar los eventos
de una materia, filtrar por alumno y cargar páginas de 50 registros. Solo los
regentes y profesores actualmente asignados tienen acceso.
Los triggers registran altas, modificaciones, eliminaciones y cascadas, con
nota anterior y nueva, autor, fecha, alumno e instantánea de la evaluación.
Las notas previas se identifican como estado inicial con autor desconocido.
No se reconstruyen modificaciones anteriores a la habilitación del historial.

El autor se transmite desde el middleware mediante AsyncLocalStorage y
`set_config(..., true)` al iniciar cada transacción; no persiste en conexiones
reutilizadas. Las escrituras en `notas` deben usar `beginTransaction()` para
atribuir el autor. Cambios directos desde SQL se registran como sistema.
El historial tiene RLS sin acceso desde claves públicas y rechaza UPDATE,
DELETE y TRUNCATE. Un administrador de base de datos con privilegios suficientes
todavía puede alterar o quitar esa protección; no es un registro externo inviolable.

### Verificación local

Las pruebas ejecutan el esquema y los endpoints contra PostgreSQL embebido
(PGlite), incluyendo login de todos los roles, permisos, inserciones, rollback,
Excel y ZIP de PDF. No reemplazan la prueba final contra Supabase y Vercel.

## Estado y reintentos de boletines

Aplicar `supabase/migrations/20261015141030_bulletin_delivery_status.sql`
antes de desplegar esta versión. La tabla `boletin_envios` tiene RLS y no admite
acceso mediante las claves públicas de Supabase. Solo regentes y secretarios
pueden consultar, preparar, procesar o reintentar correos desde Express.

La descarga GET `/boletines/generar/:cursoId` solo genera el ZIP. El parámetro
anterior `enviarMails=true` se rechaza para evitar envíos mediante GET.
La pantalla usa POST para preparar los registros y procesar tres pendientes
por petición, mostrando su resultado por alumno y destinatario. Los botones
permiten continuar pendientes y reintentar únicamente fallidos confirmados.
Hay filtro por estado y paginación de 50 registros.

La clave única incluye curso, alumno, destinatario, remitente y hash de los
datos del boletín (con ciclo lectivo). Volver a preparar el mismo contenido no
duplica registros ni reenvía los enviados. Un boletín con contenido diferente
es una nueva versión. Los reintentos usan el PDF original almacenado, no las
notas recalculadas. Los PDFs se eliminan de la tabla cuando se confirma el envío;
los pendientes, fallidos y casos inciertos conservan el adjunto.

`SELECT ... FOR UPDATE SKIP LOCKED` reserva cada envío y confirma el estado
`enviando` antes de contactar Gmail; no mantiene la transacción durante SMTP.
Se guardan intentos, último operador, fechas, error y Message-ID. El estado
`enviado` significa que Gmail aceptó el mensaje, no que llegó o fue leído.

Un rechazo explícito de SMTP queda como fallido y permite reintentar. Una
desconexión con resultado ambiguo queda como `incierto`, sin reintento automático.
Si el proceso se interrumpe antes de guardar el resultado, después de diez
minutos la consulta del panel lo marca para revisión. El operador debe verificar
Enviados en Gmail. SMTP no permite garantizar entrega exactamente una vez frente
a cortes; por eso los casos ambiguos nunca se ponen automáticamente en pendiente.
El panel proporciona la referencia Message-ID para buscar en Gmail. Tras revisar,
el operador puede confirmar que se envió (sin mandar otro correo) o confirmar que
no se envió (habilita un reintento explícito). Se guarda el último operador, la
fecha de actualización y la confirmación manual.

El registro comienza con esta versión: no reconstruye los correos enviados
anteriormente. Las pruebas automatizadas y visuales usan transporte simulado;
no envían mensajes reales. `BOLETINES_TEST_EMAIL` continúa redirigiendo todos
los correos a la dirección de prueba configurada.

Referencias: [Express en Vercel](https://vercel.com/docs/frameworks/backend/express)
y [conexiones de Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Ciclos lectivos

Aplicar `supabase/migrations/20261015155214_academic_years.sql` antes de desplegar.
Los cursos y datos existentes pertenecen inicialmente a 2026, abierto y actual.
El selector de año filtra cursos, alumnos y boletines. Los PDFs y exportaciones
identifican el ciclo del curso, independientemente de la fecha de descarga.

Un regente con escritura puede administrar ciclos desde `ciclos.html`: crear,
establecer el actual, cerrar o reabrir. Copiar un ciclo genera cursos y materias
con nuevos identificadores; no copia alumnos, profesores, preceptores ni notas.
Las inscripciones y notas quedan asociadas a los cursos de cada año.

Cerrar un año bloquea modificaciones mediante la API y triggers de PostgreSQL;
las consultas históricas y exportaciones siguen disponibles. Dar de baja a un
alumno conserva su inscripción histórica y afecta solo al curso seleccionado.
La cuenta se desactiva únicamente si no conserva inscripciones activas en años
abiertos. Los años cerrados conservan las consultas de alumnos dados de baja.

La tabla de ciclos tiene RLS y acceso público revocado: se consulta a través del
backend autenticado. Las pruebas usan una base aislada y correo simulado.

## Cursos, materias y personal

Desde `estructura.html` (enlace «Cursos y materias») el regente puede crear y
editar cursos por ciclo, agregar o renombrar materias, configurar días y horarios,
asignar un profesor a cada materia y varios preceptores por curso. Requiere
permiso de escritura y ciclo abierto; la API también valida estas condiciones.
No requiere una migración adicional. Renombrar una materia cambia únicamente
su asignación a ese curso, sin alterar materias compartidas con otros ciclos.
No se ofrecen eliminaciones de cursos o materias que puedan borrar notas.

Se pueden crear cuentas de profesores y preceptores con DNI y contraseña temporal
aleatoria, que debe cambiarse al ingresar. Crear una cuenta no la asigna: después
hay que seleccionarla en el curso o materia. Quitar una asignación conserva la
cuenta. Los profesores nuevos tienen escritura y los preceptores solo lectura.
Las cuentas inactivas no se reactivan automáticamente desde este panel.

## Estadísticas académicas

`estadisticas.html` está disponible para regentes y preceptores desde el selector
de ciclo y desde cada tarjeta de curso. Los preceptores solo pueden consultar
cursos asignados; la API comprueba la asignación antes de devolver alumnos o notas.
Permite elegir bimestre, cuatrimestre o situación general y muestra barras por
materia, porcentajes, cobertura de carga y seguimiento individual. Usa la misma
lógica de cálculo que los boletines. Las materias sin información no se cuentan
como desaprobadas. El porcentaje de aprobación usa las materias por alumno con
información como denominador; la cobertura usa todas las materias por alumno.
Los resultados con períodos incompletos son orientativos, no una promoción final.

## Apertura anual automática

Aplicar `supabase/migrations/20261026021850_automatic_academic_year.sql` antes
del despliegue. Configurar `CRON_SECRET` como variable sensible de producción
en Vercel. La tarea protegida `/api/cron/ciclo-lectivo` se ejecuta diariamente a
las 06:00 UTC; la fecha se interpreta en Buenos Aires. A partir del 15 de febrero
prepara una única vez el ciclo del año y lo establece como actual, sin desplazar
un ciclo futuro que el regente haya activado explícitamente. El plan Hobby puede
ejecutar dentro de la hora programada, por lo que no se promete un minuto exacto.

La consulta autenticada `/ciclos` realiza la misma comprobación como respaldo.
La transacción y el bloqueo compartido con la creación manual evitan duplicados.
Se copian cursos y materias del último ciclo anterior, sin sobrescribir la
estructura existente ni copiar notas, alumnos o personal. Los cursos marcados
`es_testing` no se copian. Los ciclos anteriores no se cierran automáticamente.
Un ciclo cerrado no se reabre. La marca `apertura_automatica_en` impide que
ejecuciones posteriores reviertan decisiones manuales del regente.

Referencia: [configuración y protección de Vercel Cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## Curso ficticio 6.º 2

`node scripts/seed-curso-testing.js --apply` completa de forma idempotente el
6.º 2 mañana de 2026 en el proyecto configurado. Reutiliza el curso vacío,
comprueba conflictos de DNI y no admite convertir cursos con otras cuentas en
testing. Crea 30 alumnos, nueve profesores y un preceptor con `hola1234`, sin
cambio obligatorio inicial. Los correos quedan vacíos. Las materias y notas
están identificadas como ficticias y no se envían boletines automáticamente.
Al reejecutar no se sobrescriben notas ni contraseñas ya modificadas.
El archivo local ignorado `.local/cuentas-testing-6-2-2026.csv` contiene los
accesos iniciales. Las notas variadas sirven para explorar las estadísticas;
incluyen alumnos con aprobación, seguimiento y sin información.
Los DNI ficticios son de ocho cifras: alumnos desde `91000000`, profesores
desde `92000000` y preceptores desde `93000000`, aumentando de uno en uno.
Para este curso se usan alumnos `91000000` a `91000029`, profesores `92000000`
a `92000008` y preceptor `93000000`. El usuario de acceso coincide con el DNI.

## Diseño institucional de Natu

La presentación incorpora la paleta, escudo y estilos del archivo de referencia
`Gestion-de-Notas-Natu.zip`: rojo carmín, azul oscuro y acentos dorados. Se
importaron únicamente las hojas de estilo y el escudo; las rutas, consultas,
permisos y funciones pertenecen a la versión actual. `styleInstitucional.css`
extiende ese diseño a ciclos, estadísticas, estructura escolar, historial y
seguimiento de boletines. La planilla usa ahora `stylePlanilla.css` externo.
Los nuevos estilos no requieren migraciones ni cambios en Supabase.
