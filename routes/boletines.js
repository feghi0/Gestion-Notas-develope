const express        = require("express");
const router          = express.Router();
const pool            = require("../db/connection");
const authMiddleware  = require("../middleware/auth");
const archiver         = require("archiver");

const { cargarBoletinesCurso, renderBoletin, nombreBoletin } = require("../lib/boletinesCurso");
const { calcularResumenMateria } = require("../lib/calculoNotas");

const { enviarBoletinPorMail } = require("../lib/mailer");
const { createDeliveryService } = require("../lib/boletinEnvios");
const delivery = createDeliveryService({ pool, sendMail: enviarBoletinPorMail });
const ExcelJS = require("exceljs");
const { obtenerCiclo } = require("../lib/ciclosLectivos");
function idEnteroValido(val) {
  const n = parseInt(val, 10);
  return !isNaN(n) && n > 0;
}

function normalizarNombreArchivo(str) {
  return str
    .replace(/\s+/g, "_")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // quita tildes
}

// ─── GET /boletines/cursos ─────────────────────────────────────────────────────

router.get("/cursos", authMiddleware, async (req, res) => {
  const { rango } = req.user;

  if (rango !== "secretario" && rango !== "regente") {
    return res.status(403).json({ success: false, error: "Sin permisos para esta acción" });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    const ciclo=await obtenerCiclo(conn,req.query.ciclo);
    const cursos=await conn.query("SELECT id, anio, division, turno, ciclo_lectivo FROM cursos WHERE ciclo_lectivo=? ORDER BY anio, division",[ciclo.anio]);
    res.json({ success: true, cursos });
  } catch (err) {
    console.error("Error al listar cursos:", err);
    res.status(500).json({ success: false, error: "Error del servidor" });
  } finally {
    if (conn) conn.release();
  }
});

// Descarga sin efectos de correo. Los envíos se preparan y procesan por POST.
router.get("/generar/:cursoId", authMiddleware, async (req, res) => {
  if (!["secretario", "regente"].includes(req.user.rango)) {
    return res.status(403).json({ success: false, error: "Sin permisos para esta acción" });
  }
  if (!idEnteroValido(req.params.cursoId)) return res.status(400).json({ success: false, error: "Curso inválido" });
  if (req.query.enviarMails === "true") return res.status(400).json({ success: false, error: "Para enviar correos usá el panel de estado de envíos de boletines." });
  let conn;
  try {
    conn = await pool.getConnection();
    const { curso, boletines } = await cargarBoletinesCurso(conn, req.params.cursoId);
    conn.release(); conn = null;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="' + normalizarNombreArchivo('Boletines_' + curso.ciclo_lectivo + '_' + curso.anio + curso.division + '.zip') + '"');
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", err => { console.error("Error ZIP:", err.message); res.destroy(); });
    archive.pipe(res);
    for (const boletin of boletines) archive.append(await renderBoletin(boletin), { name: nombreBoletin(boletin.alumno) });
    await archive.finalize();
  } catch (err) {
    if (!res.headersSent) res.status(err.status || 500).json({ success: false, error: err.status ? err.message : "Error al generar los boletines" });
    else res.destroy();
  } finally { if (conn) conn.release(); }
});

// Todos los endpoints de correo requieren un rol institucional y sesión vigente.
router.use(["/envios", "/envio"], authMiddleware, (req, res, next) => {
  if (!["regente", "secretario"].includes(req.user.rango)) return res.status(403).json({ success: false, error: "Sin permisos para gestionar envíos" });
  next();
});
function deliveryRoute(handler) {
  return async (req, res) => {
    const id = req.params.cursoId || req.params.envioId;
    if (!/^[1-9]\d*$/.test(id)) return res.status(400).json({ success: false, error: "ID inválido" });
    try { res.json({ success: true, ...await handler(req) }); }
    catch (err) {
      console.error("Error al gestionar envío:", err.code || err.status || "interno");
      res.status(err.status || 500).json({ success: false, error: err.status ? err.message : "No pudimos actualizar los envíos. Consultá su estado antes de volver a intentar." });
    }
  };
}
router.get("/envios/:cursoId", deliveryRoute(req => {
  if ((req.query.antes !== undefined && !/^[1-9]\d*$/.test(req.query.antes)) ||
      (req.query.estado !== undefined && !["pendiente", "enviando", "enviado", "fallido", "incierto", "sin_email"].includes(req.query.estado))) {
    throw Object.assign(new Error("Filtro inválido"), { status: 400 });
  }
  return delivery.listar(req.params.cursoId, req.query.antes, req.query.estado);
}));
router.post("/envios/:cursoId/preparar", deliveryRoute(async req => ({
  ...await delivery.preparar(req.params.cursoId, req.user.id), ...await delivery.listar(req.params.cursoId)
})));
router.post("/envios/:cursoId/procesar", deliveryRoute(req => delivery.procesar(req.params.cursoId, req.user.id)));
router.post("/envio/:envioId/reintentar", deliveryRoute(req => delivery.reintentar(req.params.envioId, req.user.id)));
router.post("/envio/:envioId/resolver", deliveryRoute(req => delivery.resolver(req.params.envioId, req.user.id, req.body?.decision)));

// ─── GET /boletines/excel/:cursoId ─────────────────────────────────────────────
// Genera un archivo Excel con una hoja por materia, todos los alumnos del curso,
// sus notas calculadas y el nombre del/la profesor/a a cargo de cada materia.
// Solo se descarga localmente — no se envía por mail.

router.get("/excel/:cursoId", authMiddleware, async (req, res) => {
  const { cursoId } = req.params;
  const { rango }   = req.user;

  if (rango !== "secretario" && rango !== "regente") {
    return res.status(403).json({ success: false, error: "Sin permisos para esta acción" });
  }
  if (!idEnteroValido(cursoId)) {
    return res.status(400).json({ success: false, error: "ID de curso inválido" });
  }

  let conn;
  try {
    conn = await pool.getConnection();

    // Datos del curso
    const cursoRows = await conn.query(
      "SELECT id, anio, division, turno, ciclo_lectivo FROM cursos WHERE id = ?",
      [cursoId]
    );
    if (!cursoRows || cursoRows.length === 0) {
      return res.status(404).json({ error: "Curso no encontrado" });
    }
    const curso = cursoRows[0];

    // Materias del curso con el nombre del profesor a cargo
    const materias = await conn.query(`
      SELECT
        cm.id            AS curso_materia_id,
        m.nombre         AS materia,
        cm.dias,
        cm.horario,
        u.nombre         AS prof_nombre,
        u.apellido       AS prof_apellido
      FROM curso_materia cm
      JOIN materias m               ON m.id  = cm.materia_id
      LEFT JOIN profesor_materia pm ON pm.curso_materia_id = cm.id
      LEFT JOIN usuarios u          ON u.id  = pm.profesor_id
      WHERE cm.curso_id = ?
      ORDER BY m.nombre
    `, [cursoId]);

    if (!materias || materias.length === 0) {
      return res.status(404).json({ error: "El curso no tiene materias asignadas" });
    }

    // Alumnos del curso
    const alumnos = await conn.query(`
      SELECT u.id, u.nombre, u.apellido
      FROM alumno_curso ac
      JOIN usuarios u ON ac.alumno_id = u.id
      WHERE ac.curso_id = ? AND u.rango = 'alumno' AND (ac.activo=1 OR EXISTS (SELECT 1 FROM cursos c JOIN ciclos_lectivos cl ON cl.anio=c.ciclo_lectivo WHERE c.id=ac.curso_id AND cl.cerrado))
      ORDER BY u.apellido, u.nombre
    `, [cursoId]);

    if (!alumnos || alumnos.length === 0) {
      return res.status(404).json({ error: "El curso no tiene alumnos inscriptos" });
    }

    // Todas las evaluaciones + notas de todas las materias del curso
    const curMatIds = materias.map(m => m.curso_materia_id);
    const evaluaciones = await conn.query(`
      SELECT
        e.id, e.curso_materia_id, e.bimestre, e.cierre, e.tipo,
        e.descripcion, e.es_acumulativo, e.evaluacion_origen_id,
        n.alumno_id, n.nota
      FROM evaluaciones e
      JOIN notas n ON n.evaluacion_id = e.id
      WHERE e.curso_materia_id IN (?)
    `, [curMatIds]);

    // ── Construcción del workbook ──────────────────────────────────────────────

    const wb = new ExcelJS.Workbook();
    wb.creator  = "ET N°35 — Sistema de Gestión de Notas";
    wb.created  = new Date();
    wb.modified = new Date();

    const fechaStr = new Date().toLocaleDateString("es-AR");

    // Colores reutilizables
    const COLOR = {
      negro:   "FF0A0A0A",
      blanco:  "FFFFFFFF",
      grisOsc: "FF2A2A2E",
      grisHdr: "FFF4F5F7",
      azulB12: "FF1E3A5F",
      verdeB34:"FF1A4731",
      violeta: "FF5B21B6",
      naranja: "FF9A3412",
      grisCal: "FF3D3D3D",
      fondoPar:"FFFFFFFF",
      fondoImp:"FFF6F7F9",
      fondoCal:"FFEEF0F2",
      verde6:  "FF15803D",
      rojo6:   "FFDC2626",
      grisVac: "FF9CA3AF",
    };

    function colorFuente(val) {
      if (val === null || val === undefined) return COLOR.grisVac;
      if (val === "DESAPROBADO" || val === "PREVIA") return COLOR.rojo6;
      const n = Number(val);
      if (!isNaN(n) && n < 6)  return COLOR.rojo6;
      if (!isNaN(n) && n >= 6) return COLOR.verde6;
      return COLOR.grisOsc;
    }

    function valorNumerico(val) {
      if (!val || val === "-") return null;
      const n = parseFloat(val);
      return isNaN(n) ? String(val) : n;
    }

    function bordeThin(color = "FFDDDDDD") {
      return {
        top:    { style: "thin", color: { argb: color } },
        left:   { style: "thin", color: { argb: color } },
        bottom: { style: "thin", color: { argb: color } },
        right:  { style: "thin", color: { argb: color } }
      };
    }

    function bordeMedium() {
      return {
        top:    { style: "medium", color: { argb: COLOR.negro } },
        left:   { style: "thin",   color: { argb: "FF444444" } },
        bottom: { style: "medium", color: { argb: COLOR.negro } },
        right:  { style: "thin",   color: { argb: "FF444444" } }
      };
    }

    // ── HOJA RESUMEN ──────────────────────────────────────────────────────────
    // Una fila por alumno, una columna de Nota Final por materia

    const wsResumen = wb.addWorksheet("Resumen del Curso", {
      views: [{ state: "frozen", xSplit: 2, ySplit: 4, activeCell: "C5" }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 }
    });

    // Fila 1 — título
    wsResumen.mergeCells(1, 1, 1, 2 + materias.length);
    wsResumen.getRow(1).height = 36;
    const rTitle = wsResumen.getCell("A1");
    rTitle.value = `RESUMEN DE CALIFICACIONES — CICLO ${curso.ciclo_lectivo} — ${curso.anio}°${curso.division} — ${curso.turno.toUpperCase()} — ${fechaStr}`;
    rTitle.font      = { bold: true, size: 13, color: { argb: COLOR.blanco }, name: "Calibri" };
    rTitle.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.negro } };
    rTitle.alignment = { horizontal: "center", vertical: "middle" };

    // Fila 2 — subtítulo
    wsResumen.mergeCells(2, 1, 2, 2 + materias.length);
    wsResumen.getRow(2).height = 18;
    const rSub = wsResumen.getCell("A2");
    rSub.value = `ET N°35 "Ingeniero Eduardo Latzina" — Notas Finales por Materia`;
    rSub.font      = { italic: true, size: 9.5, color: { argb: "FF555555" }, name: "Calibri" };
    rSub.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.grisHdr } };
    rSub.alignment = { horizontal: "center", vertical: "middle" };

    // Fila 3 — vacía
    wsResumen.getRow(3).height = 8;

    // Fila 4 — cabeceras
    wsResumen.getRow(4).height = 40;
    wsResumen.getColumn(1).width = 22;
    wsResumen.getColumn(2).width = 18;

    const hApellido = wsResumen.getCell(4, 1);
    const hNombre   = wsResumen.getCell(4, 2);
    [hApellido, hNombre].forEach((cell, i) => {
      cell.value     = i === 0 ? "Apellido" : "Nombre";
      cell.font      = { bold: true, size: 10.5, color: { argb: COLOR.blanco }, name: "Calibri" };
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.negro } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border    = bordeMedium();
    });

    materias.forEach((mat, i) => {
      const colIdx = 3 + i;
      wsResumen.getColumn(colIdx).width = 18;
      const cell = wsResumen.getCell(4, colIdx);
      cell.value     = mat.materia;
      cell.font      = { bold: true, size: 9.5, color: { argb: COLOR.blanco }, name: "Calibri" };
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.grisCal } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border    = bordeMedium();
    });

    // Filas de alumnos
    alumnos.forEach((alumno, aIdx) => {
      const rowIdx = 5 + aIdx;
      const dataRow = wsResumen.getRow(rowIdx);
      dataRow.height = 20;
      const bg = aIdx % 2 === 0 ? COLOR.fondoPar : COLOR.fondoImp;

      const cApellido = dataRow.getCell(1);
      const cNombre   = dataRow.getCell(2);
      cApellido.value = alumno.apellido;
      cNombre.value   = alumno.nombre;
      [cApellido, cNombre].forEach(c => {
        c.font      = { name: "Calibri", size: 10.5, color: { argb: COLOR.grisOsc } };
        c.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        c.alignment = { horizontal: "left", vertical: "middle" };
        c.border    = bordeThin();
      });

      materias.forEach((mat, mIdx) => {
        const evAlumno = evaluaciones.filter(
          e => Number(e.alumno_id) === Number(alumno.id) &&
               Number(e.curso_materia_id) === Number(mat.curso_materia_id)
        );
        const resumen = calcularResumenMateria(evAlumno);
        const nf      = valorNumerico(resumen.notaFinal);
        const cell    = dataRow.getCell(3 + mIdx);

        cell.value     = nf;
        cell.font      = { bold: true, size: 11, name: "Calibri", color: { argb: colorFuente(resumen.notaFinal) } };
        cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border    = bordeThin();
        if (typeof nf === "number") cell.numFmt = "0.00";
      });
    });

    // Leyenda al pie del resumen
    const legendRowRes = alumnos.length + 6;
    wsResumen.mergeCells(legendRowRes, 1, legendRowRes, 2 + materias.length);
    wsResumen.getRow(legendRowRes).height = 18;
    const cLegRes = wsResumen.getCell(legendRowRes, 1);
    cLegRes.value = "Para el detalle completo de notas por bimestre y cierre, ver las hojas individuales de cada materia.";
    cLegRes.font      = { italic: true, size: 8.5, color: { argb: "FF6B7280" }, name: "Calibri" };
    cLegRes.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9EC" } };
    cLegRes.alignment = { horizontal: "center", vertical: "middle" };

    // ── HOJA POR MATERIA ──────────────────────────────────────────────────────

    const COLS_MATERIA = [
      { key: "apellido", header: "Apellido",           width: 22, type: "id",   fill: COLOR.negro   },
      { key: "nombre",   header: "Nombre",             width: 18, type: "id",   fill: COLOR.negro   },
      { key: "b1",       header: "1er Bimestre",       width: 15, type: "note", fill: COLOR.azulB12 },
      { key: "b2",       header: "2do Bimestre",       width: 15, type: "note", fill: COLOR.azulB12 },
      { key: "cq1",      header: "1er Cuatrimestre ★", width: 18, type: "calc", fill: COLOR.grisCal },
      { key: "b3",       header: "3er Bimestre",       width: 15, type: "note", fill: COLOR.verdeB34},
      { key: "b4",       header: "4to Bimestre",       width: 15, type: "note", fill: COLOR.verdeB34},
      { key: "cq2",      header: "2do Cuatrimestre ★", width: 18, type: "calc", fill: COLOR.grisCal },
      { key: "c1",       header: "1er Cierre (Dic.)",  width: 17, type: "note", fill: COLOR.violeta },
      { key: "c2",       header: "2do Cierre (Feb.)",  width: 17, type: "note", fill: COLOR.naranja },
      { key: "nf",       header: "Nota Final ★",       width: 14, type: "calc", fill: COLOR.grisCal },
    ];

    for (const mat of materias) {
      // Nombre de la hoja: máx 31 caracteres (límite de Excel)
      const nombreHoja = mat.materia.length > 28
        ? mat.materia.slice(0, 28) + "..."
        : mat.materia;

      const ws = wb.addWorksheet(nombreHoja, {
        views: [{ state: "frozen", xSplit: 2, ySplit: 5, activeCell: "C6" }],
        pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 }
      });

      const profNombre = mat.prof_nombre
        ? `${mat.prof_apellido || ""}, ${mat.prof_nombre || ""}`.trim().replace(/^,\s*/, "")
        : "Sin asignar";

      // Fila 1 — título de la materia
      ws.mergeCells("A1:K1");
      ws.getRow(1).height = 36;
      const wTitle = ws.getCell("A1");
      wTitle.value = `${mat.materia.toUpperCase()} — ${curso.anio}°${curso.division} — ${curso.turno.toUpperCase()}`;
      wTitle.font      = { bold: true, size: 13, color: { argb: COLOR.blanco }, name: "Calibri" };
      wTitle.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.negro } };
      wTitle.alignment = { horizontal: "center", vertical: "middle" };

      // Fila 2 — institución y días/horario
      ws.mergeCells("A2:K2");
      ws.getRow(2).height = 18;
      const wSub = ws.getCell("A2");
      wSub.value = `ET N°35 "Ingeniero Eduardo Latzina" | ${mat.dias || "—"} | ${mat.horario || "—"} | Generado: ${fechaStr}`;
      wSub.font      = { italic: true, size: 9.5, color: { argb: "FF555555" }, name: "Calibri" };
      wSub.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.grisHdr } };
      wSub.alignment = { horizontal: "center", vertical: "middle" };

      // Fila 3 — nombre del profesor
      ws.mergeCells("A3:K3");
      ws.getRow(3).height = 20;
      const wProf = ws.getCell("A3");
      wProf.value = `Profesor/a a cargo: ${profNombre}`;
      wProf.font      = { bold: true, size: 10.5, color: { argb: COLOR.grisOsc }, name: "Calibri" };
      wProf.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF0F2" } };
      wProf.alignment = { horizontal: "center", vertical: "middle" };

      // Fila 4 — vacía
      ws.getRow(4).height = 7;

      // Fila 5 — cabeceras de columna
      ws.getRow(5).height = 40;

      COLS_MATERIA.forEach((col, i) => {
        ws.getColumn(i + 1).width = col.width;
        const cell = ws.getCell(5, i + 1);
        cell.value     = col.header;
        cell.font      = { bold: true, size: 10, color: { argb: COLOR.blanco }, name: "Calibri" };
        cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: col.fill } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border    = bordeMedium();
      });

      // Filas de alumnos (desde fila 6)
      alumnos.forEach((alumno, aIdx) => {
        const rowIdx  = 6 + aIdx;
        const dataRow = ws.getRow(rowIdx);
        dataRow.height = 20;

        const isEven = aIdx % 2 === 0;
        const bgData = isEven ? COLOR.fondoPar : COLOR.fondoImp;
        const bgCalc = isEven ? COLOR.fondoCal : "FFE5E7EB";

        const evAlumno = evaluaciones.filter(
          e => Number(e.alumno_id)       === Number(alumno.id) &&
               Number(e.curso_materia_id) === Number(mat.curso_materia_id)
        );
        const r = calcularResumenMateria(evAlumno);

        const valores = [
          alumno.apellido,
          alumno.nombre,
          valorNumerico(r.bimestre1Num),   // numérico siempre, nunca "DESAPROBADO"
          valorNumerico(r.bimestre2Num),
          valorNumerico(r.cuatrimestre1),
          valorNumerico(r.bimestre3Num),
          valorNumerico(r.bimestre4Num),
          valorNumerico(r.cuatrimestre2),
          valorNumerico(r.cierre1),
          valorNumerico(r.cierre2),
          valorNumerico(r.notaFinal),
        ];

        const rawVals = [
          null, null,
          r.bimestre1Num, r.bimestre2Num, r.cuatrimestre1,
          r.bimestre3Num, r.bimestre4Num, r.cuatrimestre2,
          r.cierre1,      r.cierre2,      r.notaFinal
        ];

        valores.forEach((val, colIdx) => {
          const cell   = dataRow.getCell(colIdx + 1);
          const colDef = COLS_MATERIA[colIdx];
          const isCalc = colDef.type === "calc";
          const isId   = colDef.type === "id";
          const bg     = isCalc ? bgCalc : bgData;

          cell.value     = val;
          cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
          cell.alignment = { horizontal: isId ? "left" : "center", vertical: "middle" };
          cell.border    = bordeThin();
          cell.font      = {
            name:  "Calibri",
            size:  isId ? 10.5 : 11,
            bold:  !isId && isCalc,
            color: { argb: isId ? COLOR.grisOsc : colorFuente(rawVals[colIdx]) }
          };
          if (typeof val === "number" && !isId) cell.numFmt = "0.00";
        });
      });

      // Fila de leyenda al pie
      const legendRow = alumnos.length + 7;
      ws.mergeCells(`A${legendRow}:K${legendRow}`);
      ws.getRow(legendRow).height = 20;
      const cLegend = ws.getCell(`A${legendRow}`);
      cLegend.value = "★ Cuatrimestres y Nota Final se calculan automáticamente. " +
                      "Notas en ROJO: desaprobado (<6) o PREVIA. Notas en VERDE: aprobado (≥6).";
      cLegend.font      = { italic: true, size: 8.5, color: { argb: "FF6B7280" }, name: "Calibri" };
      cLegend.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9EC" } };
      cLegend.alignment = { wrapText: true, vertical: "middle" };
    }

    // ── Nombre del archivo ────────────────────────────────────────────────────
    const fechaArchivo = new Date().toLocaleDateString("es-AR").replace(/\//g, "-");
    const filename = `Calificaciones_${curso.ciclo_lectivo}_${curso.anio}${curso.division}_${fechaArchivo}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error("Error al generar Excel de boletines:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error al generar el Excel" });
    }
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
