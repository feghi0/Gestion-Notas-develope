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
datos del boletín (con año de emisión). Volver a preparar el mismo contenido no
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
