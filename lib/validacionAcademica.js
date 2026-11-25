const reglas = require('../public/reglasAcademicas');
const { calcularResumenMateria } = require('./calculoNotas');
const error = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status });
function fechaHoy() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date()); }
async function validarRecuperacion(conn, { origenId, alumnoId, materiaId, fecha, cierre = 0, bimestre = 0 }) {
  const [origen] = await conn.query(`SELECT e.*,n.alumno_id,n.nota,n.nota_conceptual FROM evaluaciones e
    JOIN notas n ON n.evaluacion_id=e.id WHERE e.id=? AND e.curso_materia_id=? AND n.alumno_id=?`, [origenId, materiaId, alumnoId]);
  const mensaje = reglas.puedeRecuperar(origen, alumnoId, fecha, Number(cierre), Number(bimestre));
  if (mensaje) throw error(mensaje);
}
async function validarCierre(conn, materiaId, bimestre) {
  const evaluaciones = await conn.query(`SELECT * FROM evaluaciones WHERE curso_materia_id=?
    AND obligatoria AND COALESCE(cierre,0)=0 AND lower(COALESCE(tipo,'')) NOT LIKE '%particip%'
    AND COALESCE(descripcion,'') NOT LIKE 'Import override:%' ${bimestre ? 'AND bimestre=?' : ''}`, bimestre ? [materiaId,bimestre] : [materiaId]);
  const alumnos = await conn.query(`SELECT u.id,u.nombre,u.apellido FROM usuarios u JOIN alumno_curso ac ON ac.alumno_id=u.id
    JOIN curso_materia cm ON cm.curso_id=ac.curso_id WHERE cm.id=? AND ac.activo=1 AND u.activo=1`, [materiaId]);
  if (!alumnos.length) throw error('No hay alumnos activos para cerrar esta instancia.');
  const periodos = bimestre ? [bimestre] : [1,2,3,4];
  if (periodos.some(b => !evaluaciones.some(e => Number(e.bimestre) === b))) throw error('Faltan evaluaciones obligatorias en uno o más bimestres.');
  const notas = await conn.query(`SELECT e.*,n.alumno_id,n.nota,n.nota_conceptual FROM evaluaciones e JOIN notas n ON n.evaluacion_id=e.id WHERE e.curso_materia_id=?`, [materiaId]);
  for (const alumno of alumnos) {
    const delAlumno = notas.filter(n => n.alumno_id === alumno.id);
    for (const e of evaluaciones.filter(e => e.alumno_destino_id == null || Number(e.alumno_destino_id) === Number(alumno.id))) {
      const nota = delAlumno.find(n => n.id === e.id);
      if (!e.descripcion || !e.tipo || !reglas.validarFecha(e.fecha instanceof Date?e.fecha.toISOString().slice(0,10):e.fecha) || !nota || (!nota.nota_conceptual && reglas.validarNota(nota.nota,e.tipo))) throw error(`Falta completar una evaluación obligatoria de ${alumno.apellido}, ${alumno.nombre}.`);
    }
    if (!bimestre && calcularResumenMateria(delAlumno).notaFinal === '-') throw error(`Hay recuperaciones o instancias pendientes de ${alumno.apellido}, ${alumno.nombre}.`);
  }
}
module.exports = { validarRecuperacion, validarCierre, fechaHoy, error };
