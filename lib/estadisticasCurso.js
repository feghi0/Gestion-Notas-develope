const { calcularResumenMateria } = require('./calculoNotas');
const periodos = ['actual', 'b1', 'b2', 'b3', 'b4', 'cq1', 'cq2'];
function situacion(notas, periodo) {
  const resumen = calcularResumenMateria(notas);
  const campo = { b1: 'bimestre1', b2: 'bimestre2', b3: 'bimestre3', b4: 'bimestre4', cq1: 'cuatrimestre1', cq2: 'cuatrimestre2', actual: 'notaFinal' }[periodo];
  const valor = resumen[campo];
  if (valor === 'DESAPROBADO' || valor === 'PREVIA') return 'seguimiento';
  if (valor !== '-' && Number.isFinite(Number(valor))) return Number(valor) >= 6 ? 'aprobadas' : 'seguimiento';
  if (periodo === 'actual' && [resumen.cuatrimestre1, resumen.cuatrimestre2].some(v => v === 'DESAPROBADO' || (v !== '-' && Number(v) < 6))) return 'seguimiento';
  return 'sinDatos';
}
function construirEstadisticas(alumnos, materias, notas, periodo) {
  const porAlumnoMateria = new Map();
  for (const nota of notas) {
    const key = `${nota.alumno_id}:${nota.curso_materia_id}`;
    if (!porAlumnoMateria.has(key)) porAlumnoMateria.set(key, []);
    porAlumnoMateria.get(key).push(nota);
  }
  const resumenMaterias = materias.map(m => ({ id: Number(m.id), nombre: m.nombre, aprobadas: 0, seguimiento: 0, sinDatos: 0 }));
  const estudiantes = alumnos.map(a => {
    const alumno = { id: Number(a.id), nombre: a.nombre, apellido: a.apellido, aprobadas: 0, seguimiento: 0, sinDatos: 0 };
    for (const materia of resumenMaterias) {
      const lista = porAlumnoMateria.get(`${a.id}:${materia.id}`) || [];
      const estado = situacion(lista, periodo);
      alumno[estado]++; materia[estado]++;
    }
    return alumno;
  });
  const total = estudiantes.length * materias.length;
  const aprobadas = resumenMaterias.reduce((n, m) => n + m.aprobadas, 0);
  const seguimiento = resumenMaterias.reduce((n, m) => n + m.seguimiento, 0);
  const sinDatos = total - aprobadas - seguimiento;
  return { estudiantes, materias: resumenMaterias, resumen: {
    alumnos: estudiantes.length, materias: materias.length, aprobadas, seguimiento, sinDatos,
    porcentajeAprobacion: aprobadas + seguimiento ? Math.round(1000 * aprobadas / (aprobadas + seguimiento)) / 10 : null,
    cobertura: total ? Math.round(1000 * (total - sinDatos) / total) / 10 : null,
    alumnosSeguimiento: estudiantes.filter(a => a.seguimiento > 0).length,
    alumnosSinDatos: estudiantes.filter(a => a.aprobadas + a.seguimiento === 0).length
  } };
}
module.exports = { construirEstadisticas, periodos };
