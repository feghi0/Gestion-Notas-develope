const express        = require("express");
const router         = express.Router();
const pool           = require("../db/connection");
const authMiddleware = require("../middleware/auth");
const bcrypt = require("bcrypt");
const generarPasswordTemporal = require("../lib/temporaryPassword");
const ExcelJS = require("exceljs");
const { calcularResumenMateria } = require("../lib/calculoNotas");
// ─── Helpers de acceso ────────────────────────────────────────────────────────

async function verificarAcceso(conn, cursoMateriaId, user, requiereEscritura = false) {
  const { id, rango, permiso } = user;

  if (rango === "regente") {
    if (requiereEscritura && permiso === "lectura") {
      return { ok: false, status: 403, error: "Sin permisos de escritura" };
    }
    return { ok: true };
  }

  if (rango === "profesor") {
    if (requiereEscritura && permiso === "lectura") {
      return { ok: false, status: 403, error: "Sin permisos de escritura" };
    }
    const pm = await conn.query(
      "SELECT id FROM profesor_materia WHERE profesor_id = ? AND curso_materia_id = ?",
      [id, cursoMateriaId]
    );
    if (!pm || pm.length === 0) {
      return { ok: false, status: 403, error: "No tenés asignada esta materia" };
    }
    return { ok: true };
  }

  if (rango === "preceptor") {
    if (requiereEscritura) {
      return { ok: false, status: 403, error: "Sin permisos de escritura" };
    }
    const pc = await conn.query(`
      SELECT pc.id
      FROM preceptor_curso pc
      JOIN curso_materia cm ON cm.curso_id = pc.curso_id
      WHERE pc.preceptor_id = ? AND cm.id = ?
    `, [id, cursoMateriaId]);
    if (!pc || pc.length === 0) {
      return { ok: false, status: 403, error: "No tenés asignado este curso" };
    }
    return { ok: true };
  }

  if (rango === "alumno") {
    if (requiereEscritura) {
      return { ok: false, status: 403, error: "Sin permisos" };
    }
    const ac = await conn.query(`
      SELECT ac.id
      FROM alumno_curso ac
      JOIN curso_materia cm ON ac.curso_id = cm.curso_id
      WHERE ac.alumno_id = ? AND cm.id = ?
    `, [id, cursoMateriaId]);
    if (!ac || ac.length === 0) {
      return { ok: false, status: 403, error: "No estás inscripto en este curso" };
    }
    return { ok: true };
  }

  return { ok: false, status: 403, error: "Rango no reconocido" };
}

async function alumnosEnCurso(conn, alumnoIds, cursoMateriaId) {
  if (!alumnoIds || alumnoIds.length === 0) return { ok: true, faltante: null };
  const rows = await conn.query(`
    SELECT DISTINCT ac.alumno_id
    FROM alumno_curso ac
    JOIN curso_materia cm ON ac.curso_id = cm.curso_id
    WHERE ac.alumno_id IN (?) AND cm.id = ?
  `, [alumnoIds, cursoMateriaId]);
  const inscritosSet = new Set(rows.map(r => Number(r.alumno_id)));
  for (const aid of alumnoIds) {
    if (!inscritosSet.has(Number(aid))) {
      return { ok: false, faltante: aid };
    }
  }
  return { ok: true, faltante: null };
}

async function alumnoEnCurso(conn, alumnoId, cursoMateriaId) {
  const rows = await conn.query(`
    SELECT ac.id
    FROM alumno_curso ac
    JOIN curso_materia cm ON ac.curso_id = cm.curso_id
    WHERE ac.alumno_id = ? AND cm.id = ?
  `, [alumnoId, cursoMateriaId]);
  return rows && rows.length > 0;
}

function notaValida(nota) {
  const n = Number(nota);
  return !isNaN(n) && isFinite(n) && n >= -1 && n <= 10;
}

function bimestreValido(b) {
  return [1, 2, 3, 4].includes(Number(b));
}

function cierreValido(c) {
  return [1, 2].includes(Number(c));
}

function idEnteroValido(val) {
  const n = parseInt(val, 10);
  return !isNaN(n) && n > 0;
}

async function validarEvaluacionOrigen(conn, evaluacionOrigenId, cursoMateriaId) {
  if (!evaluacionOrigenId) return { ok: true };
  const rows = await conn.query(
    "SELECT id FROM evaluaciones WHERE id = ? AND curso_materia_id = ?",
    [evaluacionOrigenId, cursoMateriaId]
  );
  if (!rows || rows.length === 0) {
    return { ok: false, error: "La evaluación de origen no pertenece a este curso" };
  }
  return { ok: true };
}

// ─── Helpers de importación ────────────────────────────────────────────────────

async function buscarAlumnoPorDniONombre(conn, dni, apellido, nombre) {
  if (dni) {
    const porDni = await conn.query(
      "SELECT id FROM usuarios WHERE rango = 'alumno' AND dni = ? LIMIT 1",
      [String(dni).trim()]
    );
    if (porDni && porDni.length > 0) return Number(porDni[0].id);
  }
  const rows = await conn.query(
    `SELECT id FROM usuarios
     WHERE rango = 'alumno' AND TRIM(apellido) = TRIM(?) AND TRIM(nombre) = TRIM(?)
     LIMIT 1`,
    [apellido.trim(), nombre.trim()]
  );
  return rows && rows.length > 0 ? Number(rows[0].id) : null;
}

async function crearAlumnoNuevo(conn, dni, apellido, nombre, cursoId) {
  const dniLimpio     = String(dni || "").trim();
  const passwordTemporal = generarPasswordTemporal();
  const passwordHash  = await bcrypt.hash(passwordTemporal, 10);

  const result = await conn.query(
    `INSERT INTO usuarios
       (usuario, password, nombre, apellido, dni, rango, permiso,
        debe_cambiar_password, email_usuario, email_familiar)
     VALUES (?, ?, ?, ?, ?, 'alumno', 'lectura', 1, '', '')`,
    [dniLimpio, passwordHash, nombre.trim(), apellido.trim(), dniLimpio]
  );

  const nuevoId = Number(result.insertId);
  await conn.query(
    "INSERT IGNORE INTO alumno_curso (alumno_id, curso_id) VALUES (?, ?)",
    [nuevoId, cursoId]
  );

  return { id: nuevoId, usuario: dniLimpio, passwordTemporal };
}

async function asegurarInscripcion(conn, alumnoId, cursoId) {
  await conn.query(
    "INSERT IGNORE INTO alumno_curso (alumno_id, curso_id) VALUES (?, ?)",
    [alumnoId, cursoId]
  );
}

async function notasDelPeriodo(conn, alumnoId, cursoMateriaId, periodo) {
  if (periodo.tipo === "bimestre") {
    return conn.query(
      `SELECT n.id AS nota_id, n.nota, e.id AS evaluacion_id, e.tipo, e.descripcion
       FROM notas n
       JOIN evaluaciones e ON e.id = n.evaluacion_id
       WHERE e.curso_materia_id = ? AND n.alumno_id = ?
         AND e.bimestre = ? AND (e.cierre IS NULL OR e.cierre = 0)`,
      [cursoMateriaId, alumnoId, periodo.numero]
    );
  }
  return conn.query(
    `SELECT n.id AS nota_id, n.nota, e.id AS evaluacion_id, e.tipo, e.descripcion
     FROM notas n
     JOIN evaluaciones e ON e.id = n.evaluacion_id
     WHERE e.curso_materia_id = ? AND n.alumno_id = ?
       AND e.cierre = ?`,
    [cursoMateriaId, alumnoId, periodo.numero]
  );
}

function esNotaImportadaExcel(row) {
  const desc = String(row.descripcion || "").trim();
  const tipo = String(row.tipo || "").trim();
  return desc === "Importado desde Excel" || tipo === "Importado desde Excel";
}

function esNotaOverrideExcel(row, campo) {
  const desc = String(row.descripcion || "").trim();
  return desc === `Import override:${campo}`;
}

async function notasOverrideDelCampo(conn, alumnoId, cursoMateriaId, campo) {
  return conn.query(
    `SELECT n.id AS nota_id, n.nota, e.id AS evaluacion_id, e.tipo, e.descripcion
     FROM notas n
     JOIN evaluaciones e ON e.id = n.evaluacion_id
     WHERE e.curso_materia_id = ? AND n.alumno_id = ?
       AND e.descripcion = ?
       AND (e.bimestre IS NULL OR e.bimestre = 0)
       AND (e.cierre IS NULL OR e.cierre = 0)`,
    [cursoMateriaId, alumnoId, `Import override:${campo}`]
  );
}

/**
 * Elimina todos los overrides de cuatrimestres y nota final de un alumno
 * en una materia. Se llama automáticamente al hacer cualquier cambio manual
 * (agregar/eliminar nota, registrar cierre) para que el sistema vuelva a
 * calcular según la lógica interna y no queden notas congeladas.
 */
async function limpiarOverridesAlumno(conn, alumnoId, cursoMateriaId) {
  // Busca evaluaciones de tipo override que tengan nota de este alumno
  const overrides = await conn.query(
    `SELECT e.id AS evaluacion_id
     FROM evaluaciones e
     JOIN notas n ON n.evaluacion_id = e.id
     WHERE e.curso_materia_id = ?
       AND n.alumno_id = ?
       AND e.descripcion IN ('Import override:cq1', 'Import override:cq2', 'Import override:nf')`,
    [cursoMateriaId, alumnoId]
  );
  if (!overrides || overrides.length === 0) return;

  for (const ov of overrides) {
    await conn.query(
      "DELETE FROM notas WHERE evaluacion_id = ? AND alumno_id = ?",
      [ov.evaluacion_id, alumnoId]
    );
    // Si ya no quedan notas para esa evaluación, eliminarla también
    const restantes = await conn.query(
      "SELECT id FROM notas WHERE evaluacion_id = ?",
      [ov.evaluacion_id]
    );
    if (!restantes || restantes.length === 0) {
      await conn.query("DELETE FROM evaluaciones WHERE id = ?", [ov.evaluacion_id]);
    }
  }
}

// ─── Helpers de exportación ────────────────────────────────────────────────────

function valorCeldaNota(val) {
  if (!val || val === "-") return null;
  const n = parseFloat(val);
  return isNaN(n) ? String(val) : n; // número real o texto (DESAPROBADO, PREVIA)
}

function esNotaReprobatoria(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === "string") return val === "DESAPROBADO" || val === "PREVIA";
  return typeof val === "number" && val < 6;
}

function estiloCeldaNota(val) {
  if (val === null || val === undefined) return null;
  if (esNotaReprobatoria(val)) return { argb: "FFDC2626" }; // rojo
  if (typeof val === "number" && val >= 6) return { argb: "FF15803D" }; // verde
  return null;
}

// ─── GET /planilla/plantilla/:cursoMateriaId ───────────────────────────────────
// Genera y descarga la planilla en formato Excel (.xlsx) con estilos completos.
// Incluye los alumnos del curso y sus notas actuales (si existen).
// Las columnas calculadas (cuatrimestres, nota final) se marcan y no se importan.

router.get("/plantilla/:cursoMateriaId", authMiddleware, async (req, res) => {
  const { cursoMateriaId } = req.params;
  const user = req.user;

  if (!idEnteroValido(cursoMateriaId)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  let conn;
  try {
    conn = await pool.getConnection();

    const acceso = await verificarAcceso(conn, cursoMateriaId, user, false);
    if (!acceso.ok) {
      return res.status(acceso.status).json({ error: acceso.error });
    }

    // Datos de la materia
    const materiaRows = await conn.query(`
      SELECT m.nombre AS materia, c.anio, c.division, c.turno, cm.dias, cm.horario
      FROM curso_materia cm
      JOIN materias m ON m.id = cm.materia_id
      JOIN cursos   c ON c.id = cm.curso_id
      WHERE cm.id = ?
    `, [cursoMateriaId]);

    if (!materiaRows || materiaRows.length === 0) {
      return res.status(404).json({ error: "Materia no encontrada" });
    }
    const mat = materiaRows[0];

    // Alumnos del curso
    const alumnos = await conn.query(`
  SELECT u.id, u.nombre, u.apellido, u.dni
  FROM alumno_curso ac
  JOIN usuarios u ON ac.alumno_id = u.id
  WHERE ac.curso_id = (SELECT curso_id FROM curso_materia WHERE id = ?)
    AND u.rango = 'alumno'
  ORDER BY u.apellido, u.nombre
`, [cursoMateriaId]);

    // Evaluaciones + notas de todos los alumnos
    const evaluaciones = await conn.query(`
      SELECT e.id, e.bimestre, e.cierre, e.tipo, e.es_acumulativo,
             e.evaluacion_origen_id, n.alumno_id, n.nota
      FROM evaluaciones e
      JOIN notas n ON n.evaluacion_id = e.id
      WHERE e.curso_materia_id = ?
    `, [cursoMateriaId]);

    // ── Construcción del workbook ──────────────────────────────────────────────

    const wb = new ExcelJS.Workbook();
    wb.creator = "ET N°35 - Sistema de Gestión de Notas";
    wb.created = new Date();

    const ws = wb.addWorksheet("Planilla de Notas", {
      views: [{ state: "frozen", xSplit: 2, ySplit: 4, activeCell: "C5" }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 }
    });

    const fechaStr = new Date().toLocaleDateString("es-AR");

    // ── Fila 1: Título institucional ──
    ws.mergeCells("A1:K1");
    ws.getRow(1).height = 38;
    const cTitle = ws.getCell("A1");
    cTitle.value = `PLANILLA DE NOTAS — ${mat.materia.toUpperCase()} — ${mat.anio}°${mat.division} — ${mat.turno.toUpperCase()}`;
    cTitle.font      = { bold: true, size: 14, color: { argb: "FFFFFFFF" }, name: "Calibri" };
    cTitle.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A0A0A" } };
    cTitle.alignment = { horizontal: "center", vertical: "middle" };

    // ── Fila 2: Subtítulo ──
    ws.mergeCells("A2:K2");
    ws.getRow(2).height = 20;
    const cSub = ws.getCell("A2");
    cSub.value = `ET N°35 "Ingeniero Eduardo Latzina" | ${mat.dias} | ${mat.horario} | Generado: ${fechaStr}`;
    cSub.font      = { italic: true, size: 10, color: { argb: "FF555555" }, name: "Calibri" };
    cSub.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F5F7" } };
    cSub.alignment = { horizontal: "center", vertical: "middle" };

    // ── Fila 3: Separador ──
    ws.getRow(3).height = 8;

    // ── Fila 4: Cabeceras de columna ──
   const COLS = [
  { key: "apellido", header: "Apellido",              width: 24, type: "id",   fill: "FF1A1A1A" },
  { key: "nombre",   header: "Nombre",                width: 20, type: "id",   fill: "FF1A1A1A" },
  { key: "dni",      header: "DNI",                   width: 15, type: "id",   fill: "FF1A1A1A" },
  { key: "b1",       header: "1er Bimestre",          width: 16, type: "note", fill: "FF1E3A5F" },
  { key: "b2",       header: "2do Bimestre",          width: 16, type: "note", fill: "FF1E3A5F" },
  { key: "cq1",      header: "1er Cuatrimestre ★",   width: 20, type: "calc", fill: "FF3D3D3D" },
  { key: "b3",       header: "3er Bimestre",          width: 16, type: "note", fill: "FF1A4731" },
  { key: "b4",       header: "4to Bimestre",          width: 16, type: "note", fill: "FF1A4731" },
  { key: "cq2",      header: "2do Cuatrimestre ★",   width: 20, type: "calc", fill: "FF3D3D3D" },
  { key: "c1",       header: "1er Cierre (Dic.) ",    width: 18, type: "note", fill: "FF5B21B6" },
  { key: "c2",       header: "2do Cierre (Feb.)",     width: 18, type: "note", fill: "FF9A3412" },
  { key: "nf",       header: "Nota Final ★",         width: 16, type: "calc", fill: "FF3D3D3D" },
];

    const hRow = ws.getRow(4);
    hRow.height = 38;

    COLS.forEach((col, i) => {
      const cell = ws.getCell(4, i + 1);
      cell.value = col.header;
      cell.font  = { bold: true, size: 10.5, color: { argb: "FFFFFFFF" }, name: "Calibri" };
      cell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: col.fill } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top:    { style: "medium", color: { argb: "FF111111" } },
        left:   { style: "thin",   color: { argb: "FF333333" } },
        bottom: { style: "medium", color: { argb: "FF111111" } },
        right:  { style: "thin",   color: { argb: "FF333333" } }
      };
      ws.getColumn(i + 1).width = col.width;
    });

    // ── Filas de alumnos (desde fila 5) ──

    alumnos.forEach((alumno, idx) => {
      const rowIdx  = idx + 5;
      const dataRow = ws.getRow(rowIdx);
      dataRow.height = 22;

      const isEven = idx % 2 === 0;
      const bgData = isEven ? "FFFFFFFF" : "FFF6F7F9";
      const bgCalc = isEven ? "FFEEF0F2" : "FFE5E7EB";

      // Calcular resumen usando la misma lógica del sistema
      const evAlumno = evaluaciones.filter(e => Number(e.alumno_id) === Number(alumno.id));
      const r = calcularResumenMateria(evAlumno);

      const valoresCeldas = [
  alumno.apellido,
  alumno.nombre,
  alumno.dni || "",
  valorCeldaNota(r.bimestre1),
  valorCeldaNota(r.bimestre2),
  valorCeldaNota(r.cuatrimestre1),
  valorCeldaNota(r.bimestre3),
  valorCeldaNota(r.bimestre4),
  valorCeldaNota(r.cuatrimestre2),
  valorCeldaNota(r.cierre1),
  valorCeldaNota(r.cierre2),
  valorCeldaNota(r.notaFinal),
];

      valoresCeldas.forEach((val, colIdx) => {
        const cell   = dataRow.getCell(colIdx + 1);
        const colDef = COLS[colIdx];
        const isCalc = colDef.type === "calc";

        cell.value = val;
        cell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: isCalc ? bgCalc : bgData } };
        cell.alignment = {
          horizontal: colIdx < 2 ? "left" : "center",
          vertical: "middle"
        };
        cell.border = {
          top:    { style: "thin", color: { argb: "FFDDDDDD" } },
          left:   { style: "thin", color: { argb: "FFDDDDDD" } },
          bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
          right:  { style: "thin", color: { argb: "FFDDDDDD" } }
        };

        const colorLetra = estiloCeldaNota(val);
        cell.font = {
          name: "Calibri",
          size: 11,
          bold: esNotaReprobatoria(val),
          color: colorLetra || { argb: colIdx < 2 ? "FF1C1D21" : "FF374151" }
        };

        // Formato numérico para celdas de nota
        if (typeof val === "number" && colIdx >= 2) {
          cell.numFmt = "0.00";
        }
      });
    });

    // ── Fila de leyenda al pie ──
    const legendRow = alumnos.length + 5 + 1;
    ws.mergeCells(`A${legendRow}:L${legendRow}`); // era K
    ws.getRow(legendRow).height = 32;
    const cLegend = ws.getCell(`A${legendRow}`);
    cLegend.value = "★ Cuatrimestres y Nota Final: se calculan automáticamente. " +
                    "Si completás esas columnas al importar, el valor del Excel prevalece sobre el cálculo. " +
                    "Valores no numéricos (DESAPROBADO, PREVIA, -) se ignoran al importar.";
    cLegend.font      = { italic: true, size: 9, color: { argb: "FF6B7280" }, name: "Calibri" };
    cLegend.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9EC" } };
    cLegend.alignment = { wrapText: true, vertical: "middle" };

    // ── Nombre del archivo ──
    const normNombre = mat.materia
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "");
    const fechaArchivo = new Date().toLocaleDateString("es-AR").replace(/\//g, "-");
    const filename = `Planilla_${mat.anio}°${mat.division}_${normNombre}_${fechaArchivo}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error("Error al generar plantilla Excel:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error al generar la plantilla" });
    }
  } finally {
    if (conn) conn.release();
  }
});

// ─── POST /planilla/importar/:cursoMateriaId ───────────────────────────────────

router.post("/importar/:cursoMateriaId", authMiddleware, async (req, res) => {
  const { cursoMateriaId } = req.params;
  const { filas }          = req.body;
  const user               = req.user;

  // Siempre devolver JSON aunque sea error
  res.setHeader("Content-Type", "application/json");

  if (!idEnteroValido(cursoMateriaId)) {
    return res.status(400).json({ success: false, error: "ID de materia inválido" });
  }
  if (!Array.isArray(filas) || filas.length === 0) {
    return res.status(400).json({ success: false, error: "No se recibieron filas para importar" });
  }
  if (filas.length > 150) {
    return res.status(400).json({ success: false, error: "Máximo 150 alumnos por importación" });
  }

  const PERIODOS = [
    { key: "b1",  tipo: "bimestre", numero: 1, etiqueta: "1er Bimestre",          tipoEval: "Importado desde Excel" },
    { key: "b2",  tipo: "bimestre", numero: 2, etiqueta: "2do Bimestre",          tipoEval: "Importado desde Excel" },
    { key: "b3",  tipo: "bimestre", numero: 3, etiqueta: "3er Bimestre",          tipoEval: "Importado desde Excel" },
    { key: "b4",  tipo: "bimestre", numero: 4, etiqueta: "4to Bimestre",          tipoEval: "Importado desde Excel" },
    { key: "c1",  tipo: "cierre",   numero: 1, etiqueta: "1er Cierre (Dic.)",     tipoEval: "Cierre Diciembre" },
    { key: "c2",  tipo: "cierre",   numero: 2, etiqueta: "2do Cierre (Feb.)",     tipoEval: "Cierre Febrero" },
    // Overrides: el valor importado prevalece sobre el cálculo automático
    { key: "cq1", tipo: "override", campo: "cq1", etiqueta: "1er Cuatrimestre (override)" },
    { key: "cq2", tipo: "override", campo: "cq2", etiqueta: "2do Cuatrimestre (override)" },
    { key: "nf",  tipo: "override", campo: "nf",  etiqueta: "Nota Final (override)" },
  ];

  let conn;
  try {
    conn = await pool.getConnection();

    const acceso = await verificarAcceso(conn, cursoMateriaId, user, true);
    if (!acceso.ok) {
      return res.status(acceso.status).json({ success: false, error: acceso.error });
    }

    const cmRows = await conn.query(
      "SELECT curso_id FROM curso_materia WHERE id = ?", [cursoMateriaId]
    );
    if (!cmRows || cmRows.length === 0) {
      return res.status(404).json({ success: false, error: "Materia no encontrada" });
    }
    const cursoId = Number(cmRows[0].curso_id);

    const detalle           = [];
    let bimestresImportados = 0;
    let bimestresOmitidos   = 0;
    let estudiantesNuevos   = 0;

    for (const fila of filas) {
      // --- BLOQUE REEMPLAZADO ---
      const apellido = String(fila.apellido || "").trim();
      const nombre   = String(fila.nombre   || "").trim();
      const dni      = String(fila.dni      || "").trim();

      if (!apellido || !nombre) {
        detalle.push({
          alumno: `${apellido} ${nombre}`.trim() || "(sin nombre)",
          estado: "error",
          error: "Falta el apellido o el nombre en esa fila.",
          notasImportadas: [], notasOmitidas: []
        });
        continue;
      }

      const filaRes = { alumno: `${apellido}, ${nombre}`, estado: "", notasImportadas: [], notasOmitidas: [], usuarioCreado: null, passwordTemporal: null, error: null };

      let alumnoId = await buscarAlumnoPorDniONombre(conn, dni, apellido, nombre);

      if (!alumnoId) {
        if (!dni) {
          filaRes.estado = "error";
          filaRes.error  = "Este alumno no está en el sistema y no completaste su DNI, así que no lo pudimos dar de alta. Agregá el DNI en la columna correspondiente y volvé a importar el archivo.";
          detalle.push(filaRes);
          continue;
        }
        try {
          // Asegurate de que crearAlumnoNuevo en tu otro archivo soporte recibir "dni" como parámetro
          const nuevo = await crearAlumnoNuevo(conn, dni, apellido, nombre, cursoId);
          alumnoId                  = nuevo.id;
          filaRes.estado            = "creado";
          filaRes.usuarioCreado     = nuevo.usuario;
          filaRes.passwordTemporal  = nuevo.passwordTemporal;
          estudiantesNuevos++;
        } catch (err) {
          filaRes.estado = "error";
          filaRes.error  = `No se pudo crear el usuario: ${err.message}`;
          detalle.push(filaRes);
          continue;
        }
      } else {
        filaRes.estado = "encontrado";
        await asegurarInscripcion(conn, alumnoId, cursoId);
      }
      // --- FIN BLOQUE REEMPLAZADO ---

      for (const periodo of PERIODOS) {
        const valorRaw = fila[periodo.key];
        if (valorRaw === null || valorRaw === undefined || valorRaw === "") continue;

        const nota = Number(valorRaw);
        if (isNaN(nota) || nota < 0 || nota > 10) continue;

        // ── Procesamiento de overrides (cq1, cq2, nf) ──────────────────────────
        if (periodo.tipo === "override") {
          const overrides = await notasOverrideDelCampo(conn, alumnoId, cursoMateriaId, periodo.campo) || [];
          const mismaNota = overrides.find(n => Number(n.nota) === nota);
          if (mismaNota) {
            filaRes.notasOmitidas.push(`${periodo.etiqueta}: ${nota} (ya existía)`);
            bimestresOmitidos++;
            continue;
          }

          await conn.beginTransaction();
          try {
            if (overrides.length > 0) {
              // Actualizar el override existente
              await conn.query("UPDATE notas SET nota = ? WHERE id = ?", [nota, overrides[overrides.length - 1].nota_id]);
              await conn.commit();
              filaRes.notasImportadas.push(`${periodo.etiqueta}: ${nota} (actualizada)`);
            } else {
              // Insertar nueva evaluación de override
              const insertResult = await conn.query(
                `INSERT INTO evaluaciones
                   (curso_materia_id, tipo, descripcion, fecha, bimestre, cierre, es_acumulativo, evaluacion_origen_id)
                 VALUES (?, 'Examen escrito', ?, ?, NULL, NULL, 0, NULL)`,
                [cursoMateriaId, `Import override:${periodo.campo}`, new Date()]
              );
              await conn.query(
                "INSERT INTO notas (evaluacion_id, alumno_id, nota) VALUES (?, ?, ?)",
                [Number(insertResult.insertId), alumnoId, nota]
              );
              await conn.commit();
              filaRes.notasImportadas.push(`${periodo.etiqueta}: ${nota}`);
            }
            bimestresImportados++;
          } catch (err) {
            try { await conn.rollback(); } catch (_) {}
            filaRes.notasOmitidas.push(`${periodo.etiqueta} (error: ${err.message})`);
          }
          continue;
        }

        // ── Procesamiento de bimestres y cierres ────────────────────────────────
        const existentes = await notasDelPeriodo(conn, alumnoId, cursoMateriaId, periodo) || [];
        const mismaNota = existentes.find(n => Number(n.nota) === nota);
        if (mismaNota) {
          filaRes.notasOmitidas.push(`${periodo.etiqueta}: ${nota} (ya existía)`);
          bimestresOmitidos++;
          continue;
        }

        const importadas = existentes.filter(esNotaImportadaExcel);
        const soloUnaImportada = existentes.length === 1 && importadas.length === 1;

        await conn.beginTransaction();
        try {
          if (soloUnaImportada) {
            await conn.query("UPDATE notas SET nota = ? WHERE id = ?", [nota, importadas[0].nota_id]);
            await conn.commit();
            filaRes.notasImportadas.push(`${periodo.etiqueta}: ${nota} (actualizada)`);
            bimestresImportados++;
            continue;
          }

          let insertResult;
          if (periodo.tipo === "bimestre") {
            insertResult = await conn.query(
              `INSERT INTO evaluaciones
                 (curso_materia_id, tipo, descripcion, fecha, bimestre, cierre, es_acumulativo, evaluacion_origen_id)
               VALUES (?, ?, 'Importado desde Excel', ?, ?, NULL, 0, NULL)`,
              [cursoMateriaId, "Examen escrito", new Date(), periodo.numero]
            );
          } else {
            insertResult = await conn.query(
              `INSERT INTO evaluaciones
                 (curso_materia_id, tipo, descripcion, fecha, bimestre, cierre, es_acumulativo, evaluacion_origen_id)
               VALUES (?, ?, 'Importado desde Excel', ?, NULL, ?, 0, NULL)`,
              [cursoMateriaId, periodo.tipoEval, new Date(), periodo.numero]
            );
          }

          await conn.query(
            "INSERT INTO notas (evaluacion_id, alumno_id, nota) VALUES (?, ?, ?)",
            [Number(insertResult.insertId), alumnoId, nota]
          );

          await conn.commit();
          filaRes.notasImportadas.push(`${periodo.etiqueta}: ${nota}`);
          bimestresImportados++;
        } catch (err) {
          try { await conn.rollback(); } catch (_) {}
          filaRes.notasOmitidas.push(`${periodo.etiqueta} (error: ${err.message})`);
        }
      }

      detalle.push(filaRes);
    }

    res.json({
      success: true,
      resumen: { totalFilas: filas.length, estudiantesNuevos, bimestresImportados, bimestresOmitidos },
      detalle
    });

  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    console.error("Error al importar Excel:", err);
    res.status(500).json({ success: false, error: "Error interno al importar: " + err.message });
  } finally {
    if (conn) conn.release();
  }
});

// ─── POST evaluacion-global ───────────────────────────────────────────────────

router.post("/evaluacion-global", authMiddleware, async (req, res) => {
  const {
    cursoMateriaId, tipo, descripcion, bimestre, notas,
    esAcumulativo, evaluacionOrigenId
  } = req.body;
  const user = req.user;

  if (!idEnteroValido(cursoMateriaId) || !descripcion || !bimestre || !Array.isArray(notas) || notas.length === 0) {
    return res.status(400).json({ success: false, error: "Datos incompletos" });
  }
  if (!bimestreValido(bimestre)) {
    return res.status(400).json({ success: false, error: "Bimestre inválido (valores: 1, 2, 3 o 4)" });
  }
  if (String(descripcion).trim().length === 0) {
    return res.status(400).json({ success: false, error: "La descripción no puede estar vacía" });
  }
  if (String(descripcion).length > 500) {
    return res.status(400).json({ success: false, error: "La descripción supera los 500 caracteres" });
  }
  if (tipo && String(tipo).length > 100) {
    return res.status(400).json({ success: false, error: "El tipo supera los 100 caracteres" });
  }
  if (esAcumulativo && !idEnteroValido(evaluacionOrigenId)) {
    return res.status(400).json({ success: false, error: "Debe indicar la evaluación de origen para una acumulativa" });
  }
  for (const n of notas) {
    if (!idEnteroValido(n.alumnoId)) {
      return res.status(400).json({ success: false, error: `alumnoId inválido: ${n.alumnoId}` });
    }
    if (!notaValida(n.nota)) {
      return res.status(400).json({ success: false, error: `Nota inválida para el alumno ${n.alumnoId} (rango: -1 a 10)` });
    }
  }

  let conn;
  try {
    conn = await pool.getConnection();

    const acceso = await verificarAcceso(conn, cursoMateriaId, user, true);
    if (!acceso.ok) {
      return res.status(acceso.status).json({ success: false, error: acceso.error });
    }

    await conn.beginTransaction();

    const alumnoIds = notas.map(n => n.alumnoId);
    const check = await alumnosEnCurso(conn, alumnoIds, cursoMateriaId);
    if (!check.ok) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: `El alumno ${check.faltante} no está inscripto en este curso` });
    }

    if (esAcumulativo) {
      const origenCheck = await validarEvaluacionOrigen(conn, evaluacionOrigenId, cursoMateriaId);
      if (!origenCheck.ok) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: origenCheck.error });
      }
    }

    const result = await conn.query(`
      INSERT INTO evaluaciones
        (curso_materia_id, tipo, descripcion, fecha, bimestre, es_acumulativo, evaluacion_origen_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      cursoMateriaId,
      tipo ? String(tipo).substring(0, 100) : null,
      String(descripcion).substring(0, 500),
      new Date(),
      bimestre,
      esAcumulativo ? 1 : 0,
      esAcumulativo ? Number(evaluacionOrigenId) : null
    ]);

    const evaluacionId = Number(result.insertId);

    await conn.batch(
      "INSERT INTO notas (evaluacion_id, alumno_id, nota) VALUES (?, ?, ?)",
      notas.map(n => [evaluacionId, n.alumnoId, Number(n.nota)])
    );

    // Al agregar una evaluación manualmente, resetear overrides de cada alumno afectado.
    for (const n of notas) {
      await limpiarOverridesAlumno(conn, n.alumnoId, cursoMateriaId);
    }

    await conn.commit();
    res.json({ success: true });

  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    console.error("Error al crear evaluación global:", err);
    res.status(500).json({ success: false, error: "Error al crear evaluacion global" });
  } finally {
    if (conn) conn.release();
  }
});

// ─── POST cierre-global ───────────────────────────────────────────────────────
// Carga un tema del cierre (diciembre o febrero) para todos los alumnos a la vez.
// Un cierre puede tener múltiples temas. Cada llamada agrega un tema nuevo.
// La nota del cierre se calcula en el frontend promediando todos los temas.

router.post("/cierre-global", authMiddleware, async (req, res) => {
  const { cursoMateriaId, numeroCierre, descripcion, notas } = req.body;
  const user = req.user;

  // Validaciones
  if (!idEnteroValido(cursoMateriaId)) {
    return res.status(400).json({ success: false, error: "cursoMateriaId inválido" });
  }
  if (!cierreValido(numeroCierre)) {
    return res.status(400).json({ success: false, error: "numeroCierre inválido (1 = Diciembre, 2 = Febrero)" });
  }
  if (!descripcion || String(descripcion).trim().length === 0) {
    return res.status(400).json({ success: false, error: "La descripción no puede estar vacía" });
  }
  if (String(descripcion).length > 500) {
    return res.status(400).json({ success: false, error: "La descripción supera los 500 caracteres" });
  }
  if (!Array.isArray(notas) || notas.length === 0) {
    return res.status(400).json({ success: false, error: "Debe haber al menos una nota" });
  }
  for (const n of notas) {
    if (!idEnteroValido(n.alumnoId)) {
      return res.status(400).json({ success: false, error: `alumnoId inválido: ${n.alumnoId}` });
    }
    // En cierre las notas van de 1 a 10 (sin negativos)
    const nota = Number(n.nota);
    if (isNaN(nota) || nota < 1 || nota > 10) {
      return res.status(400).json({ success: false, error: `Nota inválida para el alumno ${n.alumnoId} (rango: 1 a 10)` });
    }
  }

  let conn;
  try {
    conn = await pool.getConnection();

    const acceso = await verificarAcceso(conn, cursoMateriaId, user, true);
    if (!acceso.ok) {
      return res.status(acceso.status).json({ success: false, error: acceso.error });
    }

    await conn.beginTransaction();

    const alumnoIds = notas.map(n => n.alumnoId);
    const check = await alumnosEnCurso(conn, alumnoIds, cursoMateriaId);
    if (!check.ok) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: `El alumno ${check.faltante} no está inscripto en este curso` });
    }

    // Insertar la evaluación de cierre (sin bimestre, con cierre=numeroCierre)
    const result = await conn.query(`
      INSERT INTO evaluaciones
        (curso_materia_id, tipo, descripcion, fecha, bimestre, cierre, es_acumulativo, evaluacion_origen_id)
      VALUES (?, ?, ?, ?, NULL, ?, 0, NULL)
    `, [
      cursoMateriaId,
      numeroCierre === 1 ? "Cierre Diciembre" : "Cierre Febrero",
      String(descripcion).trim().substring(0, 500),
      new Date(),
      Number(numeroCierre)
    ]);

    const evaluacionId = Number(result.insertId);

    await conn.batch(
      "INSERT INTO notas (evaluacion_id, alumno_id, nota) VALUES (?, ?, ?)",
      notas.map(n => [evaluacionId, n.alumnoId, Number(n.nota)])
    );

    // Al registrar un cierre manualmente, resetear overrides de cada alumno.
    for (const n of notas) {
      await limpiarOverridesAlumno(conn, n.alumnoId, cursoMateriaId);
    }

    await conn.commit();
    res.json({ success: true });

  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    console.error("Error al cargar cierre global:", err);
    res.status(500).json({ success: false, error: "Error al cargar cierre global" });
  } finally {
    if (conn) conn.release();
  }
});

// ─── POST evaluacion (individual — solo para compatibilidad) ──────────────────

router.post("/evaluacion", authMiddleware, async (req, res) => {
  const {
    alumnoId, cursoMateriaId, tipo, descripcion,
    nota, bimestre, cierre,
    esAcumulativo, evaluacionOrigenId
  } = req.body;
  const user = req.user;

  if (!idEnteroValido(alumnoId) || !idEnteroValido(cursoMateriaId)) {
    return res.status(400).json({ success: false, error: "Datos incompletos o inválidos" });
  }
  if (!notaValida(nota)) {
    return res.status(400).json({ success: false, error: "Nota inválida (rango: -1 a 10)" });
  }
  if (bimestre && !bimestreValido(bimestre)) {
    return res.status(400).json({ success: false, error: "Bimestre inválido (valores: 1, 2, 3 o 4)" });
  }
  if (cierre && !cierreValido(cierre)) {
    return res.status(400).json({ success: false, error: "Cierre inválido (valores: 1 o 2)" });
  }
  if (tipo        && String(tipo).length        > 100) {
    return res.status(400).json({ success: false, error: "El tipo supera los 100 caracteres" });
  }
  if (descripcion && String(descripcion).length > 500) {
    return res.status(400).json({ success: false, error: "La descripción supera los 500 caracteres" });
  }
  if (esAcumulativo && !idEnteroValido(evaluacionOrigenId)) {
    return res.status(400).json({ success: false, error: "Debe indicar la evaluación de origen para una acumulativa" });
  }

  let conn;
  try {
    conn = await pool.getConnection();

    const acceso = await verificarAcceso(conn, cursoMateriaId, user, true);
    if (!acceso.ok) {
      return res.status(acceso.status).json({ success: false, error: acceso.error });
    }

    await conn.beginTransaction();

    if (!(await alumnoEnCurso(conn, alumnoId, cursoMateriaId))) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: "El alumno no está inscripto en este curso" });
    }

    if (esAcumulativo) {
      const origenCheck = await validarEvaluacionOrigen(conn, evaluacionOrigenId, cursoMateriaId);
      if (!origenCheck.ok) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: origenCheck.error });
      }
    }

    const result = await conn.query(`
      INSERT INTO evaluaciones
        (curso_materia_id, tipo, descripcion, fecha, bimestre, cierre, es_acumulativo, evaluacion_origen_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      cursoMateriaId,
      tipo        ? String(tipo).substring(0, 100)        : null,
      descripcion ? String(descripcion).substring(0, 500) : null,
      new Date(),
      bimestre            || null,
      cierre              || null,
      esAcumulativo ? 1   : 0,
      esAcumulativo ? Number(evaluacionOrigenId) : null
    ]);

    const evaluacionId = Number(result.insertId);

    await conn.query(
      "INSERT INTO notas (evaluacion_id, alumno_id, nota) VALUES (?, ?, ?)",
      [evaluacionId, alumnoId, Number(nota)]
    );

    // Al agregar una nota manualmente, resetear overrides del alumno.
    await limpiarOverridesAlumno(conn, alumnoId, cursoMateriaId);

    await conn.commit();
    res.json({ success: true });

  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    console.error("Error al guardar evaluación:", err);
    res.status(500).json({ success: false, error: "Error al guardar evaluación" });
  } finally {
    if (conn) conn.release();
  }
});

// ─── DELETE override/:alumnoId ────────────────────────────────────────────────
// Limpia manualmente los overrides (cq1, cq2, nf) de un alumno en una materia.
// Permite "descongelar" notas importadas desde Excel para que vuelvan al cálculo
// automático sin necesidad de agregar o eliminar otras notas.

router.delete("/override/:alumnoId", authMiddleware, async (req, res) => {
  const { alumnoId } = req.params;
  const { cursoMateriaId } = req.body;
  const user = req.user;

  if (!idEnteroValido(alumnoId) || !idEnteroValido(cursoMateriaId)) {
    return res.status(400).json({ success: false, error: "Datos incompletos o inválidos" });
  }

  let conn;
  try {
    conn = await pool.getConnection();

    const acceso = await verificarAcceso(conn, cursoMateriaId, user, true);
    if (!acceso.ok) {
      return res.status(acceso.status).json({ success: false, error: acceso.error });
    }

    await conn.beginTransaction();
    await limpiarOverridesAlumno(conn, alumnoId, cursoMateriaId);
    await conn.commit();

    res.json({ success: true });

  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    console.error("Error al limpiar overrides:", err);
    res.status(500).json({ success: false, error: "Error al limpiar overrides" });
  } finally {
    if (conn) conn.release();
  }
});

// ─── DELETE evaluacion/:id ────────────────────────────────────────────────────

router.delete("/evaluacion/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { alumnoId, cursoMateriaId } = req.body;
  const user = req.user;

  if (!idEnteroValido(id) || !idEnteroValido(alumnoId) || !idEnteroValido(cursoMateriaId)) {
    return res.status(400).json({ success: false, error: "Datos incompletos o inválidos" });
  }

  let conn;
  try {
    conn = await pool.getConnection();

    const acceso = await verificarAcceso(conn, cursoMateriaId, user, true);
    if (!acceso.ok) {
      return res.status(acceso.status).json({ success: false, error: acceso.error });
    }

    const evalCheck = await conn.query(
      "SELECT id FROM evaluaciones WHERE id = ? AND curso_materia_id = ?",
      [id, cursoMateriaId]
    );
    if (!evalCheck || evalCheck.length === 0) {
      return res.status(404).json({ success: false, error: "Evaluación no encontrada en este curso" });
    }

    await conn.beginTransaction();

    await conn.query(
      "DELETE FROM notas WHERE evaluacion_id = ? AND alumno_id = ?",
      [id, alumnoId]
    );

    const restantes = await conn.query(
      "SELECT id FROM notas WHERE evaluacion_id = ?",
      [id]
    );
    if (restantes.length === 0) {
      await conn.query("DELETE FROM evaluaciones WHERE id = ?", [id]);
    }

    // Al eliminar una nota manualmente, resetear overrides del alumno
    // para que el sistema vuelva al cálculo interno.
    await limpiarOverridesAlumno(conn, alumnoId, cursoMateriaId);

    await conn.commit();
    res.json({ success: true });

  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    console.error("Error al eliminar evaluación:", err);
    res.status(500).json({ success: false, error: "Error al eliminar evaluación" });
  } finally {
    if (conn) conn.release();
  }
});
// ─── PATCH cierre-tema ────────────────────────────────────────────────────────
// Actualiza la nota de un tema de diciembre para un alumno específico.
// Se usa en febrero: el profesor selecciona un tema desaprobado de diciembre
// y carga la nueva nota. La nota se guarda sobre la fila existente en `notas`.

router.patch("/cierre-tema", authMiddleware, async (req, res) => {
  const { evaluacionId, alumnoId, cursoMateriaId, nota, numeroCierre } = req.body;
  const user = req.user;

  if (!idEnteroValido(evaluacionId) || !idEnteroValido(alumnoId) || !idEnteroValido(cursoMateriaId)) {
    return res.status(400).json({ success: false, error: "Datos incompletos o inválidos" });
  }
  if (!cierreValido(numeroCierre)) {
    return res.status(400).json({ success: false, error: "numeroCierre inválido (1 o 2)" });
  }
  const notaN = Number(nota);
  if (isNaN(notaN) || notaN < 1 || notaN > 10) {
    return res.status(400).json({ success: false, error: "Nota inválida (rango: 1 a 10)" });
  }

  let conn;
  try {
    conn = await pool.getConnection();

    const acceso = await verificarAcceso(conn, cursoMateriaId, user, true);
    if (!acceso.ok) {
      return res.status(acceso.status).json({ success: false, error: acceso.error });
    }

    // Verificar que la evaluación origen pertenece a este curso
    const evalCheck = await conn.query(
      "SELECT id, descripcion, tipo FROM evaluaciones WHERE id = ? AND curso_materia_id = ?",
      [evaluacionId, cursoMateriaId]
    );
    if (!evalCheck || evalCheck.length === 0) {
      return res.status(404).json({ success: false, error: "Evaluación no encontrada en este curso" });
    }

    // Verificar que el alumno tiene nota en esa evaluación origen
    const notaCheck = await conn.query(
      "SELECT id FROM notas WHERE evaluacion_id = ? AND alumno_id = ?",
      [evaluacionId, alumnoId]
    );
    if (!notaCheck || notaCheck.length === 0) {
      return res.status(404).json({ success: false, error: "El alumno no tiene nota en esta evaluación" });
    }

    const evalOrigen = evalCheck[0];
    const labelCierre = Number(numeroCierre) === 1 ? "Cierre Diciembre" : "Cierre Febrero";
    const descripcion = evalOrigen.descripcion || evalOrigen.tipo || "Tema";

    await conn.beginTransaction();

    // Crear una nueva evaluación de cierre para este tema
    const result = await conn.query(`
      INSERT INTO evaluaciones
        (curso_materia_id, tipo, descripcion, fecha, bimestre, cierre, es_acumulativo, evaluacion_origen_id)
      VALUES (?, ?, ?, ?, NULL, ?, 0, ?)
    `, [
      cursoMateriaId,
      labelCierre,
      descripcion,
      new Date(),
      Number(numeroCierre),
      evaluacionId   // referencia a la evaluación origen
    ]);

    const nuevaEvalId = Number(result.insertId);

    await conn.query(
      "INSERT INTO notas (evaluacion_id, alumno_id, nota) VALUES (?, ?, ?)",
      [nuevaEvalId, alumnoId, notaN]
    );

    // Al registrar una nota de cierre manualmente, resetear overrides del alumno.
    await limpiarOverridesAlumno(conn, alumnoId, cursoMateriaId);

    await conn.commit();
    res.json({ success: true });

  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    console.error("Error al registrar nota de cierre:", err);
    res.status(500).json({ success: false, error: "Error al registrar nota de cierre" });
  } finally {
    if (conn) conn.release();
  }
});

// ─── GET planilla ─────────────────────────────────────────────────────────────

router.get("/:cursoMateriaId/:usuarioId", authMiddleware, async (req, res) => {
  const { cursoMateriaId } = req.params;
  const user = req.user;

  if (!idEnteroValido(cursoMateriaId)) {
    return res.status(400).json({ success: false, error: "ID de materia inválido" });
  }

  let conn;
  try {
    conn = await pool.getConnection();

    const acceso = await verificarAcceso(conn, cursoMateriaId, user, false);
    if (!acceso.ok) {
      return res.status(acceso.status).json({ success: false, error: acceso.error });
    }

    const materia = await conn.query(`
      SELECT
        cm.id   AS curso_materia_id,
        m.nombre AS materia,
        c.anio,
        c.division,
        cm.dias,
        cm.horario
      FROM curso_materia cm
      INNER JOIN materias m ON cm.materia_id = m.id
      INNER JOIN cursos c   ON cm.curso_id   = c.id
      WHERE cm.id = ?
    `, [cursoMateriaId]);

    if (!materia || materia.length === 0) {
      return res.status(404).json({ success: false, error: "Materia no encontrada" });
    }

    let alumnos, evaluaciones;

    if (user.rango === "alumno") {
      alumnos = await conn.query(
        "SELECT id, nombre, apellido FROM usuarios WHERE id = ?",
        [user.id]
      );
      evaluaciones = await conn.query(`
        SELECT
          e.id, e.tipo, e.descripcion, e.fecha, e.bimestre, e.cierre,
          e.es_acumulativo, e.evaluacion_origen_id,
          n.alumno_id, n.nota
        FROM evaluaciones e
        INNER JOIN notas n ON e.id = n.evaluacion_id
        WHERE e.curso_materia_id = ? AND n.alumno_id = ?
        ORDER BY e.bimestre, e.cierre, e.id
      `, [cursoMateriaId, user.id]);
    } else {
      alumnos = await conn.query(`
        SELECT DISTINCT u.id, u.nombre, u.apellido
        FROM curso_materia cm
        INNER JOIN cursos c        ON cm.curso_id  = c.id
        INNER JOIN alumno_curso ac ON c.id         = ac.curso_id
        INNER JOIN usuarios u      ON ac.alumno_id = u.id
        WHERE cm.id = ? AND u.rango = 'alumno'
        ORDER BY u.apellido, u.nombre
      `, [cursoMateriaId]);
      evaluaciones = await conn.query(`
        SELECT
          e.id, e.tipo, e.descripcion, e.fecha, e.bimestre, e.cierre,
          e.es_acumulativo, e.evaluacion_origen_id,
          n.alumno_id, n.nota
        FROM evaluaciones e
        INNER JOIN notas n ON e.id = n.evaluacion_id
        WHERE e.curso_materia_id = ?
        ORDER BY e.bimestre, e.cierre, e.id
      `, [cursoMateriaId]);
    }

    res.json({
      success: true,
      user:    { id: user.id, permiso: user.permiso, rango: user.rango },
      materia: materia[0],
      alumnos,
      notas:   evaluaciones
    });

  } catch (err) {
    console.error("Error al cargar planilla:", err);
    res.status(500).json({ success: false, error: "Error al cargar planilla" });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
