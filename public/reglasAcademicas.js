(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReglasAcademicas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const EN_PROCESO = 'En proceso';
  function esParticipacion(tipo) { return String(tipo || '').toLowerCase().includes('particip'); }
  function validarNota(valor, tipo = '') {
    if (!['number', 'string'].includes(typeof valor) || !/^\d{1,2}(?:\.\d{1,2})?$/.test(String(valor))) return 'Ingresá un número con hasta dos decimales.';
    const n = Number(valor), minimo = esParticipacion(tipo) ? 0 : 1, maximo = esParticipacion(tipo) ? 1 : 10;
    return n < minimo || n > maximo ? `El valor debe estar entre ${minimo} y ${maximo}.` : null;
  }
  function validarFecha(valor) {
    return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor) && Number.isFinite(Date.parse(valor)) && new Date(valor + 'T00:00:00Z').toISOString().slice(0, 10) === valor;
  }
  function valorParticipacion(ev) {
    const n = Math.abs(Number(ev.nota));
    return String(ev.tipo).includes('-0.5') ? -n : Number(ev.nota);
  }
  function puedeRecuperar(origen, alumnoId, fecha, cierre = 0, bimestre = 0) {
    if (!origen || Number(origen.alumno_id) !== Number(alumnoId)) return 'Primero debe existir una nota de la evaluación original para este alumno.';
    if (!origen.fecha) return 'Completá la fecha de la evaluación original antes de recuperar.';
    if (esParticipacion(origen.tipo)) return 'Las valoraciones de participación no tienen recuperatorio.';
    if (origen.nota != null && Number(origen.nota) >= 6) return 'La evaluación original ya está aprobada.';
    if (origen.fecha && fecha < (origen.fecha instanceof Date ? origen.fecha.toISOString() : String(origen.fecha)).slice(0, 10)) return 'La fecha no puede ser anterior a la evaluación original.';
    if (cierre === 1 && Number(origen.cierre)) return 'Diciembre debe recuperar una evaluación de bimestre.';
    if (cierre === 2 && Number(origen.cierre) !== 1) return 'Febrero debe recuperar una evaluación de diciembre.';
    if (!cierre && ![1,2,3,4].includes(Number(bimestre))) return 'Seleccioná un bimestre válido para la recuperación.';
    if (!cierre && (Number(origen.cierre) || (bimestre && Number(origen.bimestre) > bimestre))) return 'La recuperación no puede preceder a la instancia original.';
    return null;
  }
  // Política final ajustable: se conserva la prioridad de overrides y cierres.
  // No introduce ponderaciones. La validación de completitud vive en validarCierre.
  function calcularNotaFinal({ evaluaciones, cuat1, cuat2, requiereCierres, diciembre, febrero, override, saldadas }) {
    if (override !== null) return Number(override).toFixed(2);
    const adeudadas = evaluaciones.filter(e => !String(e.descripcion || '').startsWith('Import override:') && !esParticipacion(e.tipo) && !Number(e.cierre) && Number(e.nota) < 6 && !saldadas.has(Number(e.id)));
    if (febrero) {
      const cubiertas = new Set(febrero.temas.map(e => Number(e.evaluacion_origen_id)));
      const pendientes = diciembre?.temas.filter(e => Number(e.nota) < 6).some(e => !cubiertas.has(Number(e.id)));
      const cubiertasDic = new Set(diciembre?.temas.map(e => Number(e.evaluacion_origen_id)) || []);
      if (pendientes || adeudadas.some(e => !cubiertasDic.has(Number(e.id)))) return '-';
      return febrero.aprobado ? febrero.promedio.toFixed(2) : 'PREVIA';
    }
    if (diciembre) {
      const cubiertas = new Set(diciembre.temas.map(e => Number(e.evaluacion_origen_id)));
      return diciembre.aprobado && !adeudadas.some(e => !cubiertas.has(Number(e.id))) ? diciembre.promedio.toFixed(2) : '-';
    }
    if (requiereCierres) return '-';
    const nums = [cuat1, cuat2].filter(n => n !== '-' && n !== EN_PROCESO).map(Number);
    return nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2) : '-';
  }
  // La fecha real de Buenos Aires manda; cambiar la fecha del examen no habilita el período.
  function validarPeriodoDiciembre(cierre, fecha, ahora = new Date()) {
    if (Number(cierre) !== 1) return null;
    const mes = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', month: '2-digit' }).format(ahora);
    if (mes !== '12') return 'Las notas de diciembre solo pueden cargarse o modificarse durante diciembre (hora de Buenos Aires).';
    if (fecha && (!validarFecha(fecha) || String(fecha).slice(5, 7) !== '12')) return 'La fecha de la evaluación de diciembre debe pertenecer a diciembre.';
    return null;
  }
  return { EN_PROCESO, validarNota, validarFecha, puedeRecuperar, esParticipacion, valorParticipacion, calcularNotaFinal, validarPeriodoDiciembre };
});
