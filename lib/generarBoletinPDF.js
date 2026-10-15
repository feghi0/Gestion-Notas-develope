// ─── lib/generarBoletinPDF.js ───────────────────────────────────────────────────
// Genera el PDF del boletín de un alumno usando PDFKit.
// Recibe los datos ya calculados (no hace queries ni cálculos acá).

const PDFDocument = require("pdfkit");

const NEGRO = "#111111";
const GRIS  = "#555555";
const GRIS_CLARO = "#dddddd";
const VERDE = "#1a7a1a";
const ROJO  = "#c00000";
const VIOLETA = "#7b1fa2";

/**
 * Genera el PDF del boletín y lo escribe en el stream `outputStream`.
 *
 * @param {Object} alumno - { nombre, apellido, dni }
 * @param {Object} curso - { anio, division, turno }
 * @param {Array} materias - [{ nombre, resumen: {...} }, ...]
 * @param {Stream} outputStream - destino del PDF generado
 * @returns {Promise<void>} resuelve cuando termina de escribir
 */
function generarBoletinPDF(alumno, curso, materias, outputStream) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });

    doc.on("error", reject);
    outputStream.on("error", reject);
    outputStream.on("finish", resolve);

    doc.pipe(outputStream);

    // ── Encabezado institucional ──
    doc
      .rect(0, 0, doc.page.width, 90)
      .fill(NEGRO);

    doc
      .fillColor("#ffffff")
      .fontSize(20)
      .font("Helvetica-Bold")
      .text("ET N°35", 40, 25);

    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#cccccc")
      .text("Ingeniero Eduardo Latzina", 40, 50);

    doc
      .fontSize(13)
      .font("Helvetica-Bold")
      .fillColor("#ffffff")
      .text("Boletín de Calificaciones", 0, 28, { align: "right", width: doc.page.width - 40 });

    const fechaEmision = new Date().toLocaleDateString("es-AR");
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#cccccc")
      .text(`Ciclo ${curso.ciclo_lectivo} · Emitido el ${fechaEmision}`, 0, 50, { align: "right", width: doc.page.width - 40 });

    doc.moveDown(4);
    doc.y = 110;

    // ── Datos del alumno ──
    doc
      .fillColor(NEGRO)
      .fontSize(14)
      .font("Helvetica-Bold")
      .text(`${alumno.apellido}, ${alumno.nombre}`, 40, doc.y);

    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor(GRIS)
      .text(`DNI: ${alumno.dni || "-"}    |    Curso: ${curso.anio}° ${curso.division}    |    Turno: ${capitalizar(curso.turno)}`, 40, doc.y + 18);

    doc.moveDown(2);

    let y = doc.y + 10;

    // ── Tabla por cada materia ──
    for (const materia of materias) {
      // Salto de página si no entra el bloque (estimado ~150px por materia)
      if (y > doc.page.height - 180) {
        doc.addPage();
        y = 40;
      }

      y = dibujarBloqueMateria(doc, materia, y);
      y += 18; // espacio entre materias
    }

    // doc.y queda desincronizado tras usar .rect()/.fill() manualmente con
    // coordenadas propias; lo sincronizamos con la posición real antes de
    // calcular dónde van las firmas.
    doc.y = y;

    // ── Pie de página con espacio para firmas ──
    agregarPieFirmas(doc);

    doc.end();
  });
}

function capitalizar(str) {
  if (!str) return "-";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Determina si un valor de celda representa una calificación reprobatoria.
 * Cubre tres casos:
 *  - el texto literal "DESAPROBADO" (bimestre/cuatrimestre marcado como tal)
 *  - el texto literal "PREVIA" (nota final que quedó pendiente de mesa examinadora)
 *  - cualquier valor numérico real menor a 6 (ej: un cierre con nota 4.00,
 *    o una nota final numérica que diera por debajo de 6)
 * "-" (sin datos) nunca se considera reprobatorio.
 */
function esValorReprobatorio(valor) {
  if (valor === "DESAPROBADO" || valor === "PREVIA") return true;
  if (valor === "-" || valor === null || valor === undefined) return false;
  const n = Number(valor);
  return !isNaN(n) && n < 6;
}

/**
 * Dibuja el bloque de una materia: nombre + tabla de bimestres/cuatrimestres/cierres/final.
 * Retorna el nuevo valor de Y después de dibujar.
 */
function dibujarBloqueMateria(doc, materia, startY) {
  const marginLeft = 40;
  const pageWidth   = doc.page.width - 80;

  let y = startY;

  // Nombre de la materia
  doc
    .fillColor(NEGRO)
    .fontSize(11)
    .font("Helvetica-Bold")
    .text(materia.nombre, marginLeft, y);

  y += 18;

  const r = materia.resumen;

  // Definición de columnas: [etiqueta, valor]
  const columnas = [
    { label: "1° Bim.",  valor: r.bimestre1 },
    { label: "2° Bim.",  valor: r.bimestre2 },
    { label: "1° Cuat.", valor: r.cuatrimestre1 },
    { label: "3° Bim.",  valor: r.bimestre3 },
    { label: "4° Bim.",  valor: r.bimestre4 },
    { label: "2° Cuat.", valor: r.cuatrimestre2 },
    { label: "1er Cierre", valor: r.cierre1 },
    { label: "2do Cierre", valor: r.cierre2 },
    { label: "NOTA FINAL", valor: r.notaFinal, destacado: true }
  ];

  const colWidth = pageWidth / columnas.length;
  const rowHeaderH = 22;
  const rowValueH  = 26;

  // Encabezados de columna
  let x = marginLeft;
  doc.font("Helvetica-Bold").fontSize(7.5);
  for (const col of columnas) {
    doc
      .fillColor("#ffffff")
      .rect(x, y, colWidth, rowHeaderH)
      .fill(col.destacado ? VIOLETA : NEGRO);
    doc
      .fillColor("#ffffff")
      .text(col.label, x, y + 6, { width: colWidth, align: "center" });
    x += colWidth;
  }

  y += rowHeaderH;

  // Valores
  x = marginLeft;
  doc.font("Helvetica-Bold").fontSize(9.5);
  for (const col of columnas) {
    // FIX: ahora cualquier valor reprobatorio (texto "DESAPROBADO"/"PREVIA"
    // O un número real < 6, como un cierre en 4.00) se pinta en rojo.
    // Antes solo se detectaba el string "DESAPROBADO" exacto, así que una nota
    // numérica desaprobada (ej. nota final "4.00" sin pasar por cierre) quedaba
    // en negro como si fuera una nota normal aprobada.
    const esReprobatorio = esValorReprobatorio(col.valor);
    const esVacio = col.valor === "-";
    const esTextoLargo = col.valor === "DESAPROBADO" || col.valor === "PREVIA";

    let bgColor = "#f4f4f4";
    let textColor = NEGRO;

    if (col.destacado) {
      bgColor = "#f3e5f5";
      textColor = VIOLETA;
    }
    if (esReprobatorio) {
      textColor = ROJO;
    } else if (!esVacio && !col.destacado) {
      textColor = VERDE;
    }

    doc
      .rect(x, y, colWidth, rowValueH)
      .fillAndStroke(bgColor, GRIS_CLARO);

    const textoMostrar = col.valor === "DESAPROBADO" ? "DESAP." : col.valor;

    doc
      .fillColor(textColor)
      .fontSize(esTextoLargo ? 7.5 : 9.5)
      .text(textoMostrar, x, y + (esTextoLargo ? 9 : 8), { width: colWidth, align: "center" });

    x += colWidth;
  }

  y += rowValueH;

  return y;
}

/**
 * Agrega el bloque de firmas y sellos al final del documento,
 * para darle validez institucional al boletín impreso.
 * Se ubica siempre a una altura fija desde abajo, en la página actual,
 * salvo que el contenido ya la haya invadido (en cuyo caso usa una página nueva).
 */
function agregarPieFirmas(doc) {
  const margin = 40;
  const pageWidth = doc.page.width - margin * 2;
  // Área útil real de la página (PDFKit dispara salto automático si nos acercamos
  // al margen inferior declarado en el documento)
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  const alturaBloque = 95; // todo el bloque de firmas + pie debe entrar en este alto
  const yDeseado = bottomLimit - alturaBloque;

  if (doc.y > yDeseado - 10) {
    doc.addPage();
  }

  const y = doc.page.height - doc.page.margins.bottom - alturaBloque;

  doc
    .moveTo(margin, y)
    .lineTo(doc.page.width - margin, y)
    .strokeColor(GRIS_CLARO)
    .stroke();

  const colWidth = pageWidth / 3;

  const firmas = ["Preceptor/a", "Regente", "Dirección"];
  let x = margin;
  for (const firma of firmas) {
    doc
      .moveTo(x + 20, y + 45)
      .lineTo(x + colWidth - 20, y + 45)
      .strokeColor(NEGRO)
      .stroke();

    doc
      .fontSize(9)
      .fillColor(GRIS)
      .font("Helvetica")
      .text(firma, x, y + 50, { width: colWidth, align: "center" });

    x += colWidth;
  }

  doc
    .fontSize(7.5)
    .fillColor("#999999")
    .text(
      "Documento de carácter oficial — Escuela Técnica N°35 \"Ingeniero Eduardo Latzina\"",
      margin, y + 75,
      { width: pageWidth, align: "center" }
    );
}

module.exports = { generarBoletinPDF };