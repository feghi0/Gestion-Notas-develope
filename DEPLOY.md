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
  planilla, Excel por materia y curso, y ZIP de boletines sin correo.
- GitHub no quedó conectado: Vercel informó que `feghi0` necesita permisos de
  escritura o administración en `nazarenoapicella/Gestion-de-notas`. Los cambios
  de adaptación están guardados localmente; no se hizo push al repositorio.

La integración de Vercel provee `POSTGRES_URL`; se configuró `DATABASE_URL` con
esa URI sin parámetros SSL que sobrescriban la validación del driver. Se añadió
`DB_SSL_CA` con la CA oficial de Supabase y se verificó TLS correctamente.

El asesor de Supabase solo mostró el aviso informativo
[RLS sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
en las nueve tablas: es intencional, porque no hay acceso desde la API pública
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
  Falta la contraseña de aplicación de Gmail para activar el envío.
  Quitar esta variable para volver a enviar a alumno y familiar.

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

Los envíos de correo por curso siguen siendo síncronos: cursos grandes pueden
alcanzar el tiempo máximo de una función. Para grandes volúmenes se necesita
una cola de trabajos. El limitador de login original usa memoria por instancia,
por lo que conviene añadir límites en Vercel Firewall para protección global.

Para desplegar cada commit automáticamente, la cuenta que conecta GitHub en
Vercel necesita permisos de escritura o administración sobre el repositorio.
El despliegue por CLI funciona independientemente de esa conexión.

## Verificación local

Las pruebas ejecutan el esquema y los endpoints contra PostgreSQL embebido
(PGlite), incluyendo login de todos los roles, permisos, inserciones, rollback,
Excel y ZIP de PDF. No reemplazan la prueba final contra Supabase y Vercel.

Referencias: [Express en Vercel](https://vercel.com/docs/frameworks/backend/express)
y [conexiones de Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).
