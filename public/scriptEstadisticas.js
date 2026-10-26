const cursoSelect = document.getElementById('cursoEstadisticas');
const periodoSelect = document.getElementById('periodoEstadisticas');
const resultado = document.getElementById('resultadoEstadisticas');
const estado = document.getElementById('estadoEstadisticas');
let solicitud = 0;
const porcentaje = (n, total) => total ? `${(100 * n / total).toFixed(1)}%` : '—';
async function datos(url) {
  const res = await apiFetch(url); if (!res) throw new Error('No pudimos completar la consulta.');
  const data = await res.json(); if (!res.ok) throw new Error(data.error || 'No pudimos cargar los datos.'); return data;
}
async function cargarCursosEstadisticas() {
  const turno = ++solicitud;
  resultado.hidden = true; estado.textContent = 'Cargando cursos…'; cursoSelect.disabled = true;
  try {
    const data = await datos('/estadisticas/cursos' + cicloQuery()); if (turno !== solicitud) return;
    cursoSelect.replaceChildren(new Option('Seleccioná un curso', ''));
    for (const c of data.cursos) cursoSelect.add(new Option(`${c.anio}° ${c.division} · ${formatearTurno(c.turno)}${c.es_testing ? ' · Testing' : ''}`, c.id));
    estado.textContent = data.cursos.length ? 'Elegí un curso para ver sus indicadores.' : 'No tenés cursos disponibles en este ciclo.';
    const solicitado = new URLSearchParams(location.search).get('curso');
    if (solicitado && data.cursos.some(c => String(c.id) === solicitado)) { cursoSelect.value = solicitado; await cargarEstadisticas(); }
  } catch (err) { if (turno === solicitud) estado.textContent = err.message; }
  finally { cursoSelect.disabled = false; }
}
async function cargarEstadisticas() {
  const turno = ++solicitud;
  resultado.hidden = true;
  if (!cursoSelect.value) { estado.textContent = 'Seleccioná un curso.'; return; }
  estado.textContent = 'Calculando indicadores…';
  try {
    const data = await datos(`/estadisticas/curso/${encodeURIComponent(cursoSelect.value)}?periodo=${encodeURIComponent(periodoSelect.value)}`);
    if (turno !== solicitud) return;
    const r = data.resumen;
    const indicador = (titulo, valor, pie) => `<article class="indicador"><span>${titulo}</span><strong>${valor}</strong><small>${pie}</small></article>`;
    const leyenda = '<div class="leyenda"><span><i class="aprobadas"></i>Aprobación según lo cargado</span><span><i class="seguimiento"></i>Requiere seguimiento</span><span><i class="sinDatos"></i>Sin información suficiente</span></div>';
    resultado.innerHTML = `${data.curso.es_testing ? '<p class="badge-testing">Curso de testing · datos ficticios</p>' : ''}
      <div class="indicadores">${indicador('Alumnos del curso', r.alumnos, `${r.materias} materias`)}${indicador('Alumnos con seguimiento', r.alumnosSeguimiento, porcentaje(r.alumnosSeguimiento, r.alumnos) + ' del curso')}${indicador('Aprobación', r.porcentajeAprobacion === null ? '—' : r.porcentajeAprobacion + '%', 'De las materias por alumno con información')}${indicador('Cobertura de información', r.cobertura === null ? '—' : r.cobertura + '%', 'Materias por alumno con situación calculable')}</div>
      <section class="estadisticas-panel"><h2>Situación por materia</h2><p class="nota-indicadores">Cada barra incluye a los ${r.alumnos} alumnos. La falta de notas se muestra por separado y nunca se cuenta como un cero.</p>${leyenda}
      ${data.materias.map(m => `<div class="grafico-fila"><div class="grafico-titulo"><strong>${escHTML(m.nombre)}</strong><span>${porcentaje(m.aprobadas, r.alumnos)} con aprobación</span></div><div class="barra-apilada" role="img" aria-label="${escHTML(m.nombre)}: ${m.aprobadas} con aprobación, ${m.seguimiento} con seguimiento y ${m.sinDatos} sin información">${['aprobadas','seguimiento','sinDatos'].map(k => `<span class="${k}" style="width:${r.alumnos ? 100 * m[k] / r.alumnos : 0}%"></span>`).join('')}</div><small>${m.aprobadas} con aprobación · ${m.seguimiento} con seguimiento · ${m.sinDatos} sin información</small></div>`).join('') || '<p>Este curso todavía no tiene materias.</p>'}</section>
      <section class="estadisticas-panel"><h2>Seguimiento por alumno</h2><p class="nota-indicadores">Ordenados por cantidad de materias que requieren seguimiento. Aprobación: valor calculado de 6 o más; seguimiento: desaprobación, previa o recuperación pendiente según la lógica de la planilla. En períodos todavía incompletos los resultados son orientativos.</p><label><input type="checkbox" id="soloSeguimiento"> Mostrar solo alumnos con seguimiento</label><div class="tabla-scroll"><table class="tabla-estadisticas"><thead><tr><th>Alumno</th><th>Con aprobación</th><th>Con seguimiento</th><th>Sin información</th></tr></thead><tbody>${[...data.estudiantes].sort((a,b) => b.seguimiento - a.seguimiento || String(a.apellido).localeCompare(String(b.apellido), 'es')).map(a => `<tr data-seguimiento="${a.seguimiento}"><td>${escHTML(a.apellido)}, ${escHTML(a.nombre)}</td><td>${a.aprobadas}</td><td class="${a.seguimiento ? 'atencion' : ''}">${a.seguimiento}</td><td>${a.sinDatos}</td></tr>`).join('')}</tbody></table></div>${r.alumnos ? '' : '<p>Este curso no tiene alumnos.</p>'}</section>`;
    resultado.hidden = false; estado.textContent = `Ciclo ${data.curso.ciclo_lectivo} · ${data.curso.anio}° ${data.curso.division}${data.curso.cerrado ? ' · Histórico de ciclo cerrado' : ''}`;
    document.getElementById('soloSeguimiento').onchange = event => {
      resultado.querySelectorAll('tr[data-seguimiento]').forEach(fila => fila.hidden = event.target.checked && Number(fila.dataset.seguimiento) === 0);
    };
  } catch (err) { if (turno === solicitud) estado.textContent = err.message; }
}
cursoSelect.onchange = cargarEstadisticas; periodoSelect.onchange = cargarEstadisticas;
document.addEventListener('ciclochange', cargarCursosEstadisticas);
(async () => {
  if (!['regente','preceptor'].includes(localStorage.getItem('rango'))) { location.href = 'dashboard.html'; return; }
  await ciclosReady; await cargarCursosEstadisticas();
})();
