# Gestión de Notas — ET N°35

## Sistema escolar web de gestión académica

Sistema integral de gestión de calificaciones desarrollado para la **Escuela Técnica N°35 "Ingeniero Eduardo Latzina"** (Buenos Aires, Argentina). Permite registrar, calcular, auditar y emitir oficialmente las calificaciones de los alumnos de forma digital, centralizada y segura, con roles diferenciados para toda la comunidad educativa.

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | HTML5 · CSS3 con tokens de diseño (Inter, sistema de diseño con tokens) · JavaScript vanilla |
| Backend | Node.js 18+ · Express.js 5 |
| Base de datos | MariaDB 10.4+ / MySQL 8 |
| Autenticación | JSON Web Tokens (JWT) |
| Hash de contraseñas | bcrypt (salt 10) |
| Rate limiting | express-rate-limit |
| Generación de PDF | PDFKit |
| Generación de Excel | ExcelJS |
| Lectura de Excel (cliente) | SheetJS / XLSX (CDN, frontend) |
| Empaquetado ZIP | archiver (v7, API CommonJS) |
| Envío de correo | Nodemailer (Gmail con contraseña de aplicación) |
| Variables de entorno | dotenv |
| Tipografía | Inter (Google Fonts) |

---

## Roles del sistema

| Rol | Permiso | Descripción / Acceso |
|---|---|---|
| **Profesor** | escritura / lectura / ambos | Sus cursos y materias asignadas. Carga global de notas, evaluaciones acumulativas y cierres administrativos |
| **Alumno** | lectura | Solo sus propias notas, sin carpetas intermedias |
| **Regente** | escritura / lectura / ambos | Todos los cursos y materias del colegio. Permiso configurable. Acceso a emisión de boletines |
| **Preceptor** | lectura | Cursos asignados específicamente. Solo lectura |
| **Secretario/a** | lectura | Todas las divisiones, materias y alumnos. Función exclusiva: emisión oficial de boletines en PDF (con envío por mail) y descarga de planilla Excel completa por curso |

---

## Funcionalidades principales

- Login seguro con JWT (8 horas de validez) y rate limiting (10 intentos / 15 min por IP)
- Cambio obligatorio de contraseña en el primer ingreso
- Dashboard con navegación por carpetas de curso → materias (excepto alumno, que ve sus materias directo)
- Carga global de evaluaciones por curso completo (examen, oral, TP, participación con ajustes +1/+0.5/-0.5)
- Sistema de evaluaciones acumulativas: recuperatorios que saldan notas previas desaprobadas, dejando registro histórico tachado
- Cálculo automático de promedios bimestrales, cuatrimestrales y nota final
- Cierres administrativos de Diciembre y Febrero con selectores dinámicos por alumno y tema adeudado
- Nota final con lógica de PREVIA si no se aprueba ningún cierre
- Boletines oficiales en PDF (uno por alumno) con firma institucional, empaquetados en ZIP
- Envío automático de boletines por mail a alumno y familiar, con detección automática del período más avanzado cursado
- **Importación de notas desde Excel** por parte del profesor: descarga una plantilla con sus alumnos, completa las notas y las importa de vuelta — si el alumno no existe en el sistema se crea automáticamente con contraseña temporal. Las columnas de bimestre solo se importan si no hay datos previos; las columnas de **cuatrimestre y nota final** siempre prevalecen sobre el cálculo automático (override)
- **Override de notas calculadas**: cuando el Excel importado incluye cuatrimestre o nota final, ese valor queda "congelado" (🔒) en la planilla. Se puede liberar manualmente con el botón 🔓, o se libera automáticamente ante cualquier modificación manual (agregar nota, eliminar nota, registrar cierre)
- **Exportación de planilla Excel del profesor** (por materia) con estilos, colores por período y notas calculadas incluidas
- **Exportación de planilla Excel del secretario** (por curso completo): un workbook con hoja de resumen de notas finales + una hoja detallada por materia con el nombre del profesor a cargo
- Diseño responsive con sistema de tokens CSS, Inter, degradés, sombras en capas y transiciones

---

## Lógica de negocio — Cálculo de calificaciones

### Tipos de evaluación y ajustes
- Examen escrito, Oral, Trabajo Práctico: nota de 1 a 10, se promedian de forma convencional
- Participación +1 / +0.5 / -0.5: se suman o restan directamente sobre el promedio base del bimestre (no son notas que se promedian, son ajustes)

### Evaluaciones acumulativas
Si un alumno desaprueba una evaluación (nota < 6), el profesor puede cargar una evaluación posterior marcada como "acumulativa" de la anterior. Reglas:
- Si la acumulativa se aprueba (≥6) y la evaluación original estaba desaprobada (<6): la original queda saldada (tachada, registro histórico)
- Si la acumulativa y la saldada pertenecen al **mismo bimestre**: se excluye la saldada del promedio y se calcula normalmente con el resto (el bimestre se recalcula sin esa nota)
- Si pertenecen a **bimestres distintos**: el bimestre de origen sigue mostrando DESAPROBADO como registro permanente, aunque esa nota puntual esté saldada (el cuatrimestre sí puede aprobar)
- Si la evaluación original ya tenía nota ≥6, una acumulativa que la referencie no salda nada (no hay nada que saldar)

### Bimestres y cuatrimestres
- Bimestre DESAPROBADO: si tiene cualquier evaluación normal con nota <6 sin saldar
- 1er Cuatrimestre = promedio efectivo de 1° y 2° Bimestre (excluyendo notas saldadas)
- 2do Cuatrimestre = promedio efectivo de 3° y 4° Bimestre
- Si algún bimestre efectivo es DESAPROBADO, el cuatrimestre completo es DESAPROBADO sin importar el promedio numérico

### Cierres administrativos (Diciembre y Febrero)
- Se habilitan automáticamente cuando el promedio anual es menor a 6 o algún cuatrimestre quedó DESAPROBADO
- **1er Cierre (Diciembre):** el profesor selecciona, por alumno, el tema adeudado (cualquier nota <6 sin saldar de cualquier bimestre) y carga la nueva nota. El selector es dinámico e inteligente:
  - Un alumno permanece en el selector **hasta que todos sus temas pendientes hayan sido evaluados**, independientemente de si los temas ya cargados aprobaron
  - Cada tema que recibe una nota de cierre **desaparece del selector** de ese alumno; si se elimina esa nota, el tema vuelve a aparecer
  - La nota final de diciembre solo se otorga cuando **todos** los temas adeudados fueron evaluados y todos aprobaron
- **2do Cierre (Febrero):** el profesor selecciona, por alumno, los temas que salieron desaprobados en diciembre, y carga la nueva nota
- Nota final = la nota del cierre donde aprobó (≥6); si no aprueba en ningún cierre, la nota final es **PREVIA**

---

## Generación y envío de boletines

### Boletín en PDF (PDFKit)
Generado en el servidor, un archivo por alumno, con:
- Encabezado institucional con degradé
- Datos del alumno (nombre, apellido, DNI, curso, turno)
- Una tabla por materia con: 1er y 2do Bimestre, 1er Cuatrimestre, 3er y 4to Bimestre, 2do Cuatrimestre, 1er y 2do Cierre, Nota Final
- **Cualquier valor numérico menor a 6 se muestra en rojo** (no solo el texto "DESAPROBADO"), para que cualquier nota reprobatoria sea visualmente inequívoca
- Todos los períodos se muestran siempre, incluso vacíos (con "-"), para que el boletín sea consistente a lo largo del año sin importar cuántas veces se lo genere
- Salto de página automático cuando hay muchas materias
- Pie con espacios de firma para Preceptor/a, Regente y Dirección, dándole validez institucional al documento impreso

### Descarga en ZIP
El secretario o regente selecciona un curso desde una pantalla dedicada y genera todos los boletines de una vez. Se descarga un único archivo ZIP que contiene un PDF independiente por alumno (ej: `Boletin_Lopez_Martina.pdf`), pensado para que cada PDF sea una unidad atómica reutilizable en el envío de mails.

### Envío automático por correo (Nodemailer + Gmail)
Al generar los boletines, opcionalmente se envían dos correos por alumno:
- Uno a `email_usuario` (el alumno)
- Uno a `email_familiar` (la familia)

El asunto del mail es `"Se envía informe: <período>"`, donde el período se determina automáticamente como **el bimestre o cierre más avanzado del año en el que el alumno tiene al menos una nota cargada**, mirando todas sus materias en conjunto (por ejemplo, si una materia ya tiene 3er bimestre cargado y otra solo 1er bimestre, el período informado es "3er Bimestre"). El envío usa autenticación de Gmail con contraseña de aplicación.

### Planilla Excel del secretario (ExcelJS)
Desde la misma pantalla de boletines, el secretario puede descargar una planilla Excel completa del curso. Solo se guarda localmente, no se envía por mail. El archivo generado contiene:
- **Hoja "Resumen del Curso":** una fila por alumno, una columna de Nota Final por cada materia del curso
- **Una hoja por materia:** desglose completo (1° a 4° Bimestre, ambos Cuatrimestres, 1er y 2do Cierre, Nota Final) con todos los alumnos. Incluye en el encabezado el nombre del profesor/a a cargo de esa materia
- Notas en **rojo** si son reprobatorias (<6, DESAPROBADO o PREVIA), en **verde** si son aprobadas (≥6)
- Filas alternadas para facilitar la lectura, columnas calculadas visualmente diferenciadas
- Nombre de archivo descriptivo: `Calificaciones_5A_27-8-2026.xlsx`

### Importación y exportación Excel del profesor (ExcelJS + SheetJS)
El profesor puede, desde la planilla de cualquiera de sus materias:
- **Descargar una plantilla** Excel con sus alumnos actuales pre-cargados y las columnas correctas (bimestres, cierres), generada en el servidor con ExcelJS con estilos completos y notas actuales ya incluidas
- **Importar el Excel** completado: SheetJS parsea el archivo en el navegador y envía los datos al backend, que los procesa alumno por alumno:
  - Busca el alumno por apellido + nombre (comparación accent e case insensitive)
  - Si no existe, lo crea con contraseña temporal `ET35` y lo inscribe al curso
  - Columnas de bimestre (B1–B4) y cierres: solo se importan si no hay datos previos en ese período — no sobreescriben
  - Columnas de **cuatrimestre (CQ1, CQ2) y nota final (NF)**: siempre se importan como override, congelando el valor calculado
  - El panel de resultados muestra exactamente qué se importó, qué se omitió y qué usuarios nuevos se crearon con sus credenciales

### Override de notas calculadas (🔒 / 🔓)

Cuando el Excel importado incluye un valor en las columnas de cuatrimestre o nota final, ese valor "congela" el cálculo automático para ese alumno en esa materia:

- La planilla web muestra el valor override con un **candado 🔒** visual
- Un botón **🔓** aparece junto a ese valor (solo visible para quienes tienen permiso de escritura)
- Al hacer clic en 🔓 se libera el override manualmente y el sistema vuelve al cálculo automático
- El override también se libera automáticamente ante **cualquier modificación manual**: agregar una nota, eliminar una nota, o registrar una nota de cierre
- Esto garantiza que una planilla importada se puede usar tal cual sin conflictos, pero si el docente hace cambios posteriores, el cálculo interno vuelve a tomar el control

---

## Roles y navegación del dashboard

- **Alumno:** ve directamente sus materias (sin carpetas intermedias)
- **Profesor / Preceptor / Regente:** navegan primero por carpetas de curso (5°A, 4°A, etc.) y al entrar ven las materias de ese curso específico, con botón de "Volver a cursos"
- **Secretario:** accede directamente a una pantalla dedicada de generación de boletines (no usa el dashboard de materias)
- El Regente tiene además acceso directo a la emisión de boletines desde su dashboard

---

## Diseño visual

El sistema utiliza un sistema de diseño propio (`tokens.css`) con:
- Tipografía **Inter** en toda la interfaz
- Paleta institucional negro/blanco con acentos funcionales por estado: verde (aprobado), rojo (desaprobado/alerta), violeta (cierres administrativos), azul (evaluaciones acumulativas)
- Sombras en capas para dar profundidad real sin perder sobriedad
- Degradés sutiles en headers y como barra de acento superior en cards y tablas
- Transiciones de 150-220ms en interacciones (hover, click, aparición de filas/cards)
- Diseño totalmente responsive: navegación adaptada en mobile, tablas con scroll horizontal contenido, formularios que pasan a una columna
- Accesibilidad: `prefers-reduced-motion` respetado, focus visible en todos los controles interactivos

---

## Modelo de datos

### Tablas principales
- `usuarios` — todos los actores del sistema (rango: profesor, alumno, regente, preceptor, secretario), con `email_usuario` y `email_familiar` para el envío de boletines
- `cursos` — año, división, turno
- `materias` — catálogo de materias
- `curso_materia` — relación curso↔materia con días y horario
- `profesor_materia` — asignación de profesores a curso_materia
- `preceptor_curso` — asignación de preceptores a cursos completos
- `alumno_curso` — inscripción de alumnos a cursos
- `evaluaciones` — exámenes, TPs, participaciones, cierres; incluye `es_acumulativo` y `evaluacion_origen_id` (autorreferencia) para el sistema de saldado
- `notas` — calificación de cada alumno por evaluación

### Relaciones clave
- Un alumno inscripto en un curso accede automáticamente a todas las materias de ese curso
- Un preceptor asignado a un curso ve todas sus materias en modo lectura
- Las evaluaciones de cierre (Diciembre/Febrero) referencian a la evaluación original que adeudan vía `evaluacion_origen_id`, con `ON DELETE CASCADE` para mantener integridad si se elimina la evaluación de origen

---

## Estructura del proyecto

```txt
gestion-notas/
│
├── db/
│   └── connection.js              # Pool de conexiones MariaDB
│
├── middleware/
│   └── auth.js                    # Verificación de JWT en rutas protegidas
│
├── lib/
│   ├── calculoNotas.js            # Lógica de promedios portada al backend (boletines)
│   ├── generarBoletinPDF.js       # Generador de PDFs con PDFKit
│   ├── detectarPeriodo.js         # Detección del bimestre/cierre más avanzado cursado
│   └── mailer.js                  # Configuración y envío de mails vía Gmail
│
├── routes/
│   ├── auth.js                    # POST /api/login · POST /api/cambiar-password
│   ├── dash.js                    # GET /dashboard/:id · GET /dashboard/curso/:cursoId
│   ├── planilla.js                # GET · POST · PATCH · DELETE /planilla/... · GET /planilla/plantilla/:id · POST /planilla/importar/:id
│   └── boletines.js               # GET /boletines/cursos · GET /boletines/generar/:cursoId · GET /boletines/excel/:cursoId
│
├── public/
│   ├── tokens.css                 # Sistema de diseño compartido (variables CSS)
│   ├── index.html                 # Login
│   ├── styleLogin.css
│   ├── scriptLogin.js
│   ├── dashboard.html             # Panel principal
│   ├── styleDashboard.css
│   ├── scriptDashboard.js
│   ├── planilla.html              # Tabla de notas
│   ├── stylePlanilla.css
│   ├── scriptPlanilla.js
│   ├── boletines.html             # Pantalla de secretario/a
│   ├── styleBoletines.css
│   ├── scriptBoletines.js
│   ├── cambiar.html               # Cambio de contraseña obligatorio
│   └── api.js                     # apiFetch() + escHTML() compartidos
│
├──_fix_planilla_routes.js
├── .env                           # Variables de entorno — NO subir al repositorio
├── .gitignore
├── hash.js                        # Utilidad para generar hashes bcrypt
├── package.json
└── server.js                      # Punto de entrada del servidor
```

---

## Instalación completa

### 1. Clonar el repositorio

```bash
git clone https://github.com/nazarenoapicella/Gestion-de-notas
cd gestion-notas
```

### 2. Instalar dependencias

```bash
npm install
```

> `exceljs` se instala junto con las demás dependencias. `SheetJS` (para importar Excel en el frontend) se carga desde CDN en `planilla.html` y no requiere instalación local.

### 3. Configurar variables de entorno

Crear el archivo `.env` en la raíz del proyecto:

```env
JWT_SECRET=reemplazar_por_clave_generada_aleatoriamente
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=colegio
PORT=3000
GMAIL_USER=secretaria.et35@gmail.com
GMAIL_APP_PASSWORD=clave_de_aplicacion_de_16_caracteres
```

Generar un JWT_SECRET seguro:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copiar el output de ese comando y pegarlo como valor de `JWT_SECRET`.

---

### 4. Crear la base de datos

Conectarse a MariaDB y ejecutar **todo el siguiente bloque SQL de una vez** (es seguro ejecutarlo completo, no requiere ajustes previos):

```sql
-- ══════════════════════════════════════════════════════════════════
--  BASE DE DATOS — GESTIÓN DE NOTAS · ET N°35
--  Ejecutar completo en la consola de MariaDB / MySQL
-- ══════════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS colegio
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE colegio;

-- ── Tablas base (sin dependencias externas) ─────────────────────────

CREATE TABLE IF NOT EXISTS usuarios (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  usuario                VARCHAR(50)                                    NOT NULL UNIQUE,
  password               VARCHAR(255)                                   NOT NULL,
  nombre                 VARCHAR(50)                                    DEFAULT NULL,
  apellido               VARCHAR(50)                                    DEFAULT NULL,
  dni                    VARCHAR(20)                                    DEFAULT NULL,
  rango                  ENUM('profesor','alumno','regente',
                              'preceptor','secretario')                 NOT NULL,
  permiso                ENUM('lectura','escritura','ambos')            NOT NULL,
  debe_cambiar_password  TINYINT(1)                                     NOT NULL DEFAULT 1,
  email_usuario          VARCHAR(150)                                   NOT NULL DEFAULT '',
  email_familiar         VARCHAR(150)                                   NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cursos (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  anio      INT                                NOT NULL,
  division  VARCHAR(5)                         NOT NULL,
  turno     ENUM('manana','tarde','noche')     NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS materias (
  id      INT AUTO_INCREMENT PRIMARY KEY,
  nombre  VARCHAR(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tablas de relación (dependen de las anteriores) ─────────────────

CREATE TABLE IF NOT EXISTS curso_materia (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  curso_id   INT          NOT NULL,
  materia_id INT          NOT NULL,
  dias       VARCHAR(50)  DEFAULT NULL,
  horario    VARCHAR(50)  DEFAULT NULL,
  UNIQUE KEY uq_curso_materia (curso_id, materia_id),
  CONSTRAINT fk_cm_curso   FOREIGN KEY (curso_id)   REFERENCES cursos(id)   ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cm_materia FOREIGN KEY (materia_id) REFERENCES materias(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alumno_curso (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  alumno_id INT NOT NULL,
  curso_id  INT NOT NULL,
  UNIQUE KEY uq_alumno_curso (alumno_id, curso_id),
  CONSTRAINT fk_ac_alumno FOREIGN KEY (alumno_id) REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ac_curso  FOREIGN KEY (curso_id)  REFERENCES cursos(id)   ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profesor_materia (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  profesor_id      INT NOT NULL,
  curso_materia_id INT NOT NULL,
  UNIQUE KEY uq_profesor_materia (profesor_id, curso_materia_id),
  CONSTRAINT fk_pm_profesor      FOREIGN KEY (profesor_id)      REFERENCES usuarios(id)      ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_pm_curso_materia FOREIGN KEY (curso_materia_id) REFERENCES curso_materia(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS preceptor_curso (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  preceptor_id INT NOT NULL,
  curso_id     INT NOT NULL,
  UNIQUE KEY uq_preceptor_curso (preceptor_id, curso_id),
  CONSTRAINT fk_pc_preceptor FOREIGN KEY (preceptor_id) REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_pc_curso     FOREIGN KEY (curso_id)     REFERENCES cursos(id)   ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evaluaciones (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  curso_materia_id     INT          NOT NULL,
  tipo                 ENUM('Examen escrito','Oral','TP',
                            'Participacion +0.5','Participacion +1',
                            'Participacion -0.5',
                            'Cierre Diciembre','Cierre Febrero',
                            'Importado desde Excel') DEFAULT NULL,
  descripcion          VARCHAR(500) DEFAULT NULL,
  fecha                DATE         DEFAULT NULL,
  bimestre             INT          DEFAULT NULL,
  cierre               INT          DEFAULT NULL,
  es_acumulativo       TINYINT(1)   NOT NULL DEFAULT 0,
  evaluacion_origen_id INT          DEFAULT NULL,
  CONSTRAINT fk_ev_curso_materia FOREIGN KEY (curso_materia_id)     REFERENCES curso_materia(id) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT fk_ev_origen        FOREIGN KEY (evaluacion_origen_id) REFERENCES evaluaciones(id)  ON DELETE CASCADE  ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- NOTA: Si ya tenés la BD creada sin 'Importado desde Excel' en el ENUM, ejecutar:
-- ALTER TABLE evaluaciones MODIFY COLUMN tipo ENUM('Examen escrito','Oral','TP',
--   'Participacion +0.5','Participacion +1','Participacion -0.5',
--   'Cierre Diciembre','Cierre Febrero','Importado desde Excel') DEFAULT NULL;

CREATE TABLE IF NOT EXISTS notas (
  id            INT          AUTO_INCREMENT PRIMARY KEY,
  evaluacion_id INT          NOT NULL,
  alumno_id     INT          NOT NULL,
  nota          DECIMAL(4,2) NOT NULL,
  UNIQUE KEY uq_nota (evaluacion_id, alumno_id),
  CONSTRAINT fk_nota_evaluacion FOREIGN KEY (evaluacion_id) REFERENCES evaluaciones(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_nota_alumno     FOREIGN KEY (alumno_id)     REFERENCES usuarios(id)     ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

### 5. Cargar datos de ejemplo (copy-paste listo)

Este bloque crea una instalación de prueba completa: 2 cursos, 4 materias, 1 profesor asignado a todas, 1 regente, 1 preceptor, 1 secretario y 6 alumnos (3 por curso).

**Contraseña de todos los usuarios de prueba: `1234`**

```sql
USE colegio;

-- ── Materias ────────────────────────────────────────────────────────

INSERT INTO materias (nombre) VALUES
  ('Base de Datos'),
  ('Programacion'),
  ('Matematica'),
  ('Ingles');

-- ── Cursos ──────────────────────────────────────────────────────────

INSERT INTO cursos (anio, division, turno) VALUES
  (5, 'A', 'manana'),   -- id 1
  (4, 'A', 'manana');   -- id 2

-- ── Usuarios ────────────────────────────────────────────────────────
-- Hash generado con bcrypt salt 10 para la contraseña "1234"
-- Para generar un hash propio: node hash.js

INSERT INTO usuarios
  (usuario, password, nombre, apellido, dni, rango, permiso, debe_cambiar_password, email_usuario, email_familiar)
VALUES
  -- Regente (ve todo, puede cargar notas)
  ('regente01',
   '$2b$10$uUPTbv7R2.YgbWl0O7OtYO1lla1RsCdpJsCm6pYRlMZ47xlRA2kf6',
   'María', 'Fernandez', '11111111',
   'regente', 'ambos', 0,
   'regente@et35.edu.ar', 'regente.familiar@gmail.com'),         -- id 1

  -- Profesor (dicta todas las materias en ambos cursos)
  ('profe1',
   '$2b$10$uUPTbv7R2.YgbWl0O7OtYO1lla1RsCdpJsCm6pYRlMZ47xlRA2kf6',
   'Carlos', 'García', '22222222',
   'profesor', 'escritura', 0,
   'profe@et35.edu.ar', 'profe.familiar@gmail.com'),             -- id 2

  -- Preceptor (supervisa ambos cursos)
  ('prece01',
   '$2b$10$uUPTbv7R2.YgbWl0O7OtYO1lla1RsCdpJsCm6pYRlMZ47xlRA2kf6',
   'Ana', 'Rodríguez', '33333333',
   'preceptor', 'lectura', 0,
   'prece@et35.edu.ar', 'prece.familiar@gmail.com'),             -- id 3

  -- Secretario/a (emite boletines)
  ('secretaria1',
   '$2b$10$uUPTbv7R2.YgbWl0O7OtYO1lla1RsCdpJsCm6pYRlMZ47xlRA2kf6',
   'Laura', 'Sosa', '44444444',
   'secretario', 'lectura', 0,
   'secretaria@et35.edu.ar', 'secretaria.familiar@gmail.com'),   -- id 4

  -- Alumnos de 5°A (curso id 1)
  ('alumno1',
   '$2b$10$uUPTbv7R2.YgbWl0O7OtYO1lla1RsCdpJsCm6pYRlMZ47xlRA2kf6',
   'Martina', 'López', '55555555',
   'alumno', 'lectura', 0,
   'martina@alumno.et35.edu.ar', 'familia.lopez@gmail.com'),     -- id 5

  ('alumno2',
   '$2b$10$uUPTbv7R2.YgbWl0O7OtYO1lla1RsCdpJsCm6pYRlMZ47xlRA2kf6',
   'Juan', 'Pérez', '66666666',
   'alumno', 'lectura', 0,
   'juan@alumno.et35.edu.ar', 'familia.perez@gmail.com'),        -- id 6

  ('alumno3',
   '$2b$10$uUPTbv7R2.YgbWl0O7OtYO1lla1RsCdpJsCm6pYRlMZ47xlRA2kf6',
   'Sofía', 'Ramírez', '77777777',
   'alumno', 'lectura', 0,
   'sofia@alumno.et35.edu.ar', 'familia.ramirez@gmail.com'),     -- id 7

  -- Alumnos de 4°A (curso id 2)
  ('alumno4',
   '$2b$10$uUPTbv7R2.YgbWl0O7OtYO1lla1RsCdpJsCm6pYRlMZ47xlRA2kf6',
   'Lucas', 'Gómez', '88888888',
   'alumno', 'lectura', 0,
   'lucas@alumno.et35.edu.ar', 'familia.gomez@gmail.com'),       -- id 8

  ('alumno5',
   '$2b$10$uUPTbv7R2.YgbWl0O7OtYO1lla1RsCdpJsCm6pYRlMZ47xlRA2kf6',
   'Valentina', 'Sosa', '99999999',
   'alumno', 'lectura', 0,
   'valentina@alumno.et35.edu.ar', 'familia.sosa@gmail.com'),    -- id 9

  ('alumno6',
   '$2b$10$uUPTbv7R2.YgbWl0O7OtYO1lla1RsCdpJsCm6pYRlMZ47xlRA2kf6',
   'Tomás', 'Rodríguez', '10101010',
   'alumno', 'lectura', 0,
   'tomas@alumno.et35.edu.ar', 'familia.rodriguez@gmail.com');   -- id 10

-- ── Curso_materia ────────────────────────────────────────────────────
-- 5°A tiene las 4 materias · 4°A tiene Base de Datos e Inglés

INSERT INTO curso_materia (curso_id, materia_id, dias, horario) VALUES
  (1, 1, 'Lunes y Miercoles', '08:00 - 10:00'),  -- id 1: 5°A · Base de Datos
  (1, 2, 'Martes y Jueves',   '08:00 - 10:00'),  -- id 2: 5°A · Programacion
  (1, 3, 'Miercoles',         '10:00 - 12:00'),  -- id 3: 5°A · Matematica
  (1, 4, 'Viernes',           '10:00 - 12:00'),  -- id 4: 5°A · Ingles
  (2, 1, 'Lunes',             '14:00 - 16:00'),  -- id 5: 4°A · Base de Datos
  (2, 4, 'Jueves',            '14:00 - 16:00');  -- id 6: 4°A · Ingles

-- ── Profesor_materia ─────────────────────────────────────────────────
-- profe1 (id 2) dicta las 6 instancias

INSERT INTO profesor_materia (profesor_id, curso_materia_id) VALUES
  (2, 1), (2, 2), (2, 3), (2, 4), (2, 5), (2, 6);

-- ── Preceptor_curso ──────────────────────────────────────────────────
-- prece01 (id 3) supervisa ambos cursos

INSERT INTO preceptor_curso (preceptor_id, curso_id) VALUES
  (3, 1), (3, 2);

-- ── Alumno_curso ─────────────────────────────────────────────────────
-- alumnos 1-3 (ids 5-7) → 5°A · alumnos 4-6 (ids 8-10) → 4°A

INSERT INTO alumno_curso (alumno_id, curso_id) VALUES
  (5, 1), (6, 1), (7, 1),
  (8, 2), (9, 2), (10, 2);
```

---

### 6. Generar hash de contraseña para nuevos usuarios

Cuando debas crear un usuario nuevo en producción, generá el hash primero:

```bash
node hash.js
# Escribí la contraseña que querés usar, copiá el hash generado
# y usalo en el INSERT de usuarios
```

---

### 7. Iniciar el servidor

**Producción:**
```bash
npm start
```

**Desarrollo (con hot-reload automático al guardar archivos):**
```bash
npm run dev
```

Verificar en la consola que aparezca:
```
Servidor corriendo en http://localhost:3000
```

Acceder desde el navegador en el mismo equipo:
```
http://localhost:3000
```

Acceder desde otro equipo de la misma red (reemplazar por la IP real del servidor):
```
http://192.168.1.50:3000
```

Para saber la IP del servidor:
- Windows: `ipconfig` en cmd
- Linux: `ip addr` o `hostname -I`

---

### 8. Mantener el servidor siempre activo (producción)

```bash
npm install -g pm2
pm2 start server.js --name gestion-notas
pm2 startup      # genera el comando para que arranque al encender el equipo
pm2 save         # guarda la configuración
```

Comandos útiles de PM2:

```bash
pm2 status                       # ver si el proceso está corriendo
pm2 logs gestion-notas           # ver los logs en tiempo real
pm2 restart gestion-notas        # reiniciar tras actualizar código
pm2 stop gestion-notas           # detener el servidor
```

---

### 9. Configurar Gmail para envío de boletines

1. Ir a [myaccount.google.com](https://myaccount.google.com)
2. Seguridad → Verificación en dos pasos → activar
3. Seguridad → Contraseñas de aplicaciones → crear una para "Mail" (o directamente en `myaccount.google.com/apppasswords`)
4. Copiar la clave de 16 caracteres generada
5. Pegarla en `.env` como valor de `GMAIL_APP_PASSWORD` (junto con `GMAIL_USER`)

> La cuenta de Gmail gratuita tiene un límite de ~500 mails por día. Si el colegio tiene muchos cursos y emite boletines el mismo día para varios, considerar Google Workspace o un servicio SMTP dedicado a futuro.

---

## Seguridad

| Mecanismo | Descripción |
|---|---|
| JWT (8 horas) | Autenticación stateless, token válido una jornada escolar completa |
| bcrypt (salt 10) | Hash seguro de contraseñas, nunca se almacena texto plano |
| Dummy hash timing-safe | Previene enumeración de usuarios por diferencia de tiempo de respuesta |
| Rate limiting | 10 intentos de login por IP cada 15 minutos |
| authMiddleware | JWT verificado en cada ruta protegida |
| Validación de ownership | Profesores solo acceden a sus materias; preceptores a sus cursos asignados; secretario y regente con acceso total controlado por rol |
| Validación de rango | Lista blanca de roles válidos en login |
| Sanitización XSS | `escHTML()` en todo el frontend antes de inyectar en el DOM |
| Consultas parametrizadas | Sin concatenación de strings en SQL, sin riesgo de injection |
| Validación de entrada | Tipos, rangos y longitudes verificados en el backend antes de tocar la BD |
| Body size limit | Máximo 10 kb por request JSON |
| Variables de entorno | Secretos (JWT, Gmail) fuera del código fuente |
| Manejo de errores global | Handler `.on("error")` en el servidor HTTP; try/catch en todas las rutas con respuesta estructurada |
| Transacciones BD | INSERT y DELETE críticos con rollback automático ante error |
| Foreign keys CASCADE | Integridad referencial automática en toda la base de datos, incluyendo evaluaciones acumulativas |

---

## Endpoints de la API

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/login` | No | Iniciar sesión, recibir token JWT |
| POST | `/api/cambiar-password` | JWT | Cambiar contraseña del usuario autenticado |
| GET | `/dashboard/:id` | JWT | Cursos (prof/prece/reg) o materias directas (alumno) |
| GET | `/dashboard/curso/:cursoId` | JWT | Materias de un curso, con validación de ownership |
| GET | `/planilla/:cmId/:uId` | JWT | Planilla completa de notas de una materia |
| POST | `/planilla/evaluacion` | JWT | Carga nota individual para un alumno específico |
| POST | `/planilla/evaluacion-global` | JWT | Carga global de evaluación para todo el curso |
| POST | `/planilla/cierre-global` | JWT | Registra notas de cierre (Dic/Feb) para múltiples alumnos |
| PATCH | `/planilla/cierre-tema` | JWT | Nota de un tema en cierre de Diciembre o Febrero para un alumno |
| DELETE | `/planilla/evaluacion/:id` | JWT | Eliminar evaluación de un alumno |
| DELETE | `/planilla/override/:alumnoId` | JWT | Liberar manualmente el override de cuatrimestre/nota final de un alumno |
| GET | `/planilla/plantilla/:cmId` | JWT | Descarga la plantilla Excel de la materia con alumnos y notas actuales |
| POST | `/planilla/importar/:cmId` | JWT | Importa notas desde Excel; crea alumnos nuevos si no existen |
| GET | `/boletines/cursos` | JWT | Listado de cursos para generación de boletines |
| GET | `/boletines/generar/:cursoId` | JWT | Genera ZIP de boletines PDF + envío de mails opcional (`?enviarMails=false` para solo ZIP) |
| GET | `/boletines/excel/:cursoId` | JWT | Genera Excel con todas las materias del curso (solo descarga local) |

---

## .gitignore recomendado

```
node_modules/
.env
*.log
.DS_Store
Thumbs.db
```

---

## Migraciones de base de datos

Si ya tenés la BD creada de una versión anterior del sistema, aplicá estas alteraciones en orden:

```sql
USE colegio;

-- 1. Agregar emails a usuarios (si no existen)
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS email_usuario  VARCHAR(150) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email_familiar VARCHAR(150) NOT NULL DEFAULT '';

-- 2. Agregar rol secretario (si no existe en el ENUM)
ALTER TABLE usuarios
  MODIFY COLUMN rango ENUM('profesor','alumno','regente','preceptor','secretario') NOT NULL;

-- 3. Actualizar ENUM de tipo en evaluaciones para incluir importaciones y cierres
ALTER TABLE evaluaciones
  MODIFY COLUMN tipo ENUM(
    'Examen escrito','Oral','TP',
    'Participacion +0.5','Participacion +1','Participacion -0.5',
    'Cierre Diciembre','Cierre Febrero',
    'Importado desde Excel'
  ) DEFAULT NULL;

-- 4. Corregir FK de evaluacion_origen_id (debe ser INT, no UNSIGNED)
--    Solo si da error al crear la FK autorreferencial:
ALTER TABLE evaluaciones
  MODIFY COLUMN evaluacion_origen_id INT DEFAULT NULL;

-- 5. Agregar FK con CASCADE en evaluacion_origen_id (si no existe)
ALTER TABLE evaluaciones
  ADD CONSTRAINT fk_ev_origen
    FOREIGN KEY (evaluacion_origen_id)
    REFERENCES evaluaciones(id)
    ON DELETE CASCADE ON UPDATE CASCADE;
```

---

## Requisitos del servidor (instalación local)

### Hardware

| Componente | Mínimo | Recomendado |
|---|---|---|
| Procesador | Doble núcleo | Intel Core i3 o equivalente |
| RAM | 2 GB | 4 GB |
| Almacenamiento | 10 GB libres | 20 GB libres (SSD) |
| Red | WiFi / Ethernet interno | Ethernet (más estable) |

Una Raspberry Pi 4 (4 GB) o una PC de escritorio retirada de uso administrativo son suficientes.

### Software

| Requisito | Versión | Cómo verificar |
|---|---|---|
| Sistema operativo | Windows 10/11, Ubuntu Server 22.04 LTS, o Debian 12 | — |
| Node.js | 18 o superior | `node --version` |
| MariaDB | 10.4+ (o MySQL 8) | `mysql --version` |
| npm | incluido con Node.js | `npm --version` |
| Git (opcional) | cualquiera | `git --version` |

### Puertos

| Puerto | Uso | Acceso |
|---|---|---|
| `3000` | Servidor web | Toda la red interna |
| `3306` | MariaDB | Solo local (127.0.0.1) |

---

## Stack tecnológico completo

| Categoría | Tecnología | Uso en el proyecto |
|---|---|---|
| Runtime | Node.js 18+ | Ejecuta todo el backend |
| Framework backend | Express.js 5 | Enrutamiento HTTP y middlewares |
| Base de datos | MariaDB 10.4+ / MySQL 8 | Persistencia de usuarios, cursos, notas |
| Driver de BD | mariadb (npm) | Pool de conexiones asíncrono |
| Autenticación | jsonwebtoken | Generación y verificación de JWT |
| Hashing | bcrypt | Hash de contraseñas con salt 10 |
| Rate limiting | express-rate-limit | Protección del endpoint de login |
| Generación de PDF | pdfkit | Boletines oficiales en PDF |
| Generación de Excel (backend) | exceljs | Planilla del secretario (por curso) y plantilla del profesor (por materia) con estilos, colores y formatos |
| Lectura de Excel (frontend) | SheetJS / xlsx (CDN) | Parseo del Excel importado por el profesor, sin subir archivos al servidor |
| Compresión | archiver (v7, API CommonJS) | Empaquetado de boletines en ZIP |
| Envío de mail | nodemailer | Envío de boletines vía Gmail (App Password) |
| Variables de entorno | dotenv | Configuración fuera del código fuente |
| Frontend | HTML5, CSS3, JavaScript vanilla | Sin frameworks ni bundlers |
| Tipografía | Inter (Google Fonts) | Sistema de diseño visual |

---

## Credenciales de acceso para prueba (datos de ejemplo)

| Usuario | Contraseña | Rol | Ve |
|---|---|---|---|
| `regente01` | `1234` | Regente | Todas las materias de ambos cursos |
| `profe1` | `1234` | Profesor | Las 6 materias que dicta |
| `prece01` | `1234` | Preceptor | Todas las materias de 5°A y 4°A (solo lectura) |
| `secretaria1` | `1234` | Secretario/a | Pantalla de generación de boletines PDF (ZIP + mail) y descarga de planilla Excel por curso |
| `alumno1` | `1234` | Alumno | Sus notas en las 4 materias de 5°A |
| `alumno2` | `1234` | Alumno | Sus notas en las 4 materias de 5°A |
| `alumno3` | `1234` | Alumno | Sus notas en las 4 materias de 5°A |
| `alumno4` | `1234` | Alumno | Sus notas en las 2 materias de 4°A |
| `alumno5` | `1234` | Alumno | Sus notas en las 2 materias de 4°A |
| `alumno6` | `1234` | Alumno | Sus notas en las 2 materias de 4°A |

---

## Licencia

Proyecto educativo — Escuela Técnica N°35 "Ingeniero Eduardo Latzina". Uso libre para aprendizaje.