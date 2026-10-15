const { PassThrough } = require("node:stream");
const { generarBoletinPDF } = require("./generarBoletinPDF");
const { calcularResumenMateria } = require("./calculoNotas");
const { detectarPeriodoMasAvanzado } = require("./detectarPeriodo");

async function cargarBoletinesCurso(conn, cursoId) {
  const cursos = await conn.query("SELECT id, anio, division, turno, ciclo_lectivo FROM cursos WHERE id = ?", [cursoId]);
  if (!cursos.length) throw Object.assign(new Error("Curso no encontrado"), { status: 404 });
  const alumnos = await conn.query(`SELECT u.id, u.nombre, u.apellido, u.dni, u.email_usuario, u.email_familiar
    FROM alumno_curso ac JOIN usuarios u ON u.id = ac.alumno_id
    WHERE ac.curso_id = ? AND u.rango = 'alumno' AND ((u.activo=1 AND ac.activo=1) OR EXISTS (SELECT 1 FROM ciclos_lectivos cl WHERE cl.anio=? AND cl.cerrado)) ORDER BY u.apellido, u.nombre`, [cursoId, cursos[0].ciclo_lectivo]);
  if (!alumnos.length) throw Object.assign(new Error("El curso no tiene alumnos activos inscriptos"), { status: 404 });
  const materias = await conn.query(`SELECT cm.id AS curso_materia_id, m.nombre AS materia
    FROM curso_materia cm JOIN materias m ON m.id = cm.materia_id WHERE cm.curso_id = ? ORDER BY m.nombre, cm.id`, [cursoId]);
  if (!materias.length) throw Object.assign(new Error("El curso no tiene materias asignadas"), { status: 404 });
  const evaluaciones = await conn.query(`SELECT e.id, e.curso_materia_id, e.tipo, e.descripcion, e.bimestre, e.cierre,
    e.es_acumulativo, e.evaluacion_origen_id, n.alumno_id, n.nota
    FROM evaluaciones e JOIN notas n ON n.evaluacion_id = e.id WHERE e.curso_materia_id IN (?) ORDER BY e.id`,
  [materias.map(m => m.curso_materia_id)]);
  const curso = cursos[0];
  return { curso, boletines: alumnos.map(alumno => {
    const notas = evaluaciones.filter(e => Number(e.alumno_id) === Number(alumno.id));
    return {
      alumno, curso, periodo: detectarPeriodoMasAvanzado(notas),
      materias: materias.map(m => ({ nombre: m.materia,
        resumen: calcularResumenMateria(notas.filter(e => Number(e.curso_materia_id) === Number(m.curso_materia_id))) }))
    };
  }) };
}

async function renderBoletin({ alumno, curso, materias }) {
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", chunk => chunks.push(chunk));
  await generarBoletinPDF(alumno, curso, materias, stream);
  return Buffer.concat(chunks);
}

function nombreBoletin(alumno) {
  return `Boletin_${alumno.apellido}_${alumno.nombre}.pdf`.replace(/\s+/g, "_").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
module.exports = { cargarBoletinesCurso, renderBoletin, nombreBoletin };
