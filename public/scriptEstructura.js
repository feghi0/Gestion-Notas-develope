const etiquetaTurno = turno => ({ manana: 'Mañana', tarde: 'Tarde', noche: 'Noche' }[turno] || turno);
let estructura = { cursos: [], personal: [] }, cursoDetalle = null, ocupado = false, revision = 0, detalleRevision = 0;
const detalle = document.getElementById('detalle');
const aviso = document.getElementById('aviso');
const escribir = () => !ocupado && estructura.ciclo && !estructura.ciclo.cerrado && ['escritura', 'ambos'].includes(localStorage.getItem('permiso'));
const campos = form => Object.fromEntries(new FormData(form));
const nombrePersona = id => { const p = estructura.personal.find(p => Number(p.id) === Number(id)); return p ? `${p.apellido}, ${p.nombre} · DNI ${p.dni}` : 'Cuenta inactiva'; };
function opciones(rol, seleccionado, vacio) {
  return `<option value="">${vacio}</option>` + estructura.personal.filter(p => p.rango === rol).map(p => `<option value="${Number(p.id)}" ${Number(p.id) === Number(seleccionado) ? 'selected' : ''}>${escHTML(nombrePersona(p.id))}</option>`).join('');
}
async function consultar(path) {
  const res = await apiFetch(path); if (!res) throw new Error('No pudimos completar la solicitud.');
  const data = await res.json(); if (!res.ok) throw new Error(data.error || 'No pudimos cargar los datos.'); return data;
}
async function cargarEstructura() {
  const actual = ++revision;
  const data = await consultar('/estructura' + cicloQuery());
  if (actual !== revision) return;
  estructura = data;
  document.getElementById('listaCursos').innerHTML = data.cursos.length ? data.cursos.map(c => `<button type="button" class="estructura-item" data-curso="${Number(c.id)}">${Number(c.anio)}° ${escHTML(c.division)} · ${escHTML(etiquetaTurno(c.turno))}</button>`).join('') : '<p>No hay cursos. Creá el primero para este ciclo.</p>';
  document.getElementById('nuevoCurso').hidden = !escribir();
  document.getElementById('formCurso').querySelectorAll('input,select,button').forEach(el => el.disabled = !escribir());
}
async function abrirCurso(id) {
  const actual = revision;
  const solicitud = ++detalleRevision;
  const data = await consultar('/estructura/curso/' + id);
  if (solicitud !== detalleRevision || actual !== revision || Number(data.curso.ciclo_lectivo) !== Number(estructura.ciclo.anio)) return;
  cursoDetalle = data.curso;
  const c = data.curso;
  const disabled = escribir() ? '' : 'disabled';
  detalle.hidden = false;
  detalle.innerHTML = `<h2>${Number(c.anio)}° ${escHTML(c.division)} · ${escHTML(etiquetaTurno(c.turno))}</h2>
  <p>${escribir() ? 'Los cambios afectan este curso del ciclo seleccionado.' : 'Solo lectura.'}</p>
  <form class="estructura-form" data-tipo="curso"><label>Año del curso<input name="anio" type="number" min="1" max="7" value="${Number(c.anio)}" required ${disabled}></label><label>División<input name="division" maxlength="5" value="${escHTML(c.division)}" required ${disabled}></label><label>Turno<select name="turno" ${disabled}>${['manana','tarde','noche'].map(t => `<option value="${t}" ${c.turno === t ? 'selected' : ''}>${etiquetaTurno(t)}</option>`).join('')}</select></label><button ${disabled}>Guardar curso</button></form>
  <h3>Materias y profesores</h3><div>${data.materias.map(m => {
    const p = data.profesores.find(p => Number(p.curso_materia_id) === Number(m.id));
    return `<article class="estructura-item"><h3>${escHTML(m.nombre)}</h3><form class="estructura-form" data-tipo="materia" data-id="${Number(m.id)}">${inputsMateria(m)}<button ${disabled}>Guardar materia</button></form>
    <form class="estructura-form" data-tipo="profesor" data-id="${Number(m.id)}"><label>Profesor a cargo<select name="usuarioId" ${disabled}>${opciones('profesor', p?.profesor_id, 'Sin profesor')}</select></label><button ${disabled}>Guardar profesor</button></form></article>`;
  }).join('') || '<p>Este curso todavía no tiene materias.</p>'}</div>
  <details ${disabled ? 'hidden' : ''}><summary>Agregar materia</summary><form class="estructura-form" data-tipo="materiaNueva">${inputsMateria({})}<button ${disabled}>Agregar materia</button></form></details>
  <h3>Preceptores</h3>${data.preceptores.map(p => `<div class="estructura-item">${escHTML(nombrePersona(p.preceptor_id))} <button type="button" data-quitar="${Number(p.preceptor_id)}" ${disabled}>Quitar del curso</button></div>`).join('') || '<p>Sin preceptores asignados.</p>'}
  <form class="estructura-form" data-tipo="preceptor"><label>Preceptor<select name="usuarioId" required ${disabled}>${opciones('preceptor', null, 'Seleccioná un preceptor')}</select></label><button ${disabled}>Asignar al curso</button></form>
  <details ${disabled ? 'hidden' : ''}><summary>Crear cuenta de profesor o preceptor</summary><p>Después de crear la cuenta, seleccionála en la asignación correspondiente.</p>
  <form class="estructura-form" data-tipo="personal"><label>Rol<select name="rango"><option value="profesor">Profesor</option><option value="preceptor">Preceptor</option></select></label><label>Nombre<input name="nombre" maxlength="50" required></label><label>Apellido<input name="apellido" maxlength="50" required></label><label>DNI<input name="dni" inputmode="numeric" pattern="[0-9]{6,9}" required></label><button ${disabled}>Crear cuenta</button></form></details>`;
}
function inputsMateria(m) {
  const disabled = escribir() ? '' : 'disabled';
  return `<label>Nombre<input name="nombre" maxlength="100" value="${escHTML(m.nombre || '')}" required ${disabled}></label><label>Días<input name="dias" maxlength="50" value="${escHTML(m.dias || '')}" placeholder="Lunes y miércoles" ${disabled}></label><label>Horario<input name="horario" maxlength="50" value="${escHTML(m.horario || '')}" placeholder="08:00 a 09:20" ${disabled}></label>`;
}
async function guardar(path, method, body, mantener = true) {
  if (!escribir()) return;
  const cursoId = cursoDetalle?.id;
  ocupado = true; aviso.textContent = 'Guardando…';
  document.querySelectorAll('.container button,.container input,.container select').forEach(el => el.disabled = true);
  let mensaje;
  try {
    const res = await apiFetch(path, { method, body: JSON.stringify(body) }); if (!res) throw new Error('No pudimos completar la solicitud.');
    const data = await res.json(); if (!res.ok) throw new Error(data.error || 'No pudimos guardar.');
    mensaje = data.passwordTemporal ? `Cuenta creada. Usuario: ${data.usuario}\nContraseña temporal: ${data.passwordTemporal}\nGuardala y compartila con su titular. Debe cambiarla al ingresar.` : data.existente ? 'La cuenta ya existía. Podés seleccionarla para asignarla.' : 'Cambios guardados.';
    if (!mantener) document.getElementById('formCurso').reset();
  } catch (err) { mensaje = err.message; }
  finally {
    ocupado = false;
    try { await cargarEstructura(); if (cursoId) await abrirCurso(cursoId); }
    catch (err) { mensaje += '\n' + err.message; }
    document.getElementById('selectCicloLectivo').disabled = false;
    aviso.textContent = mensaje;
  }
}
document.getElementById('listaCursos').onclick = event => {
  const boton = event.target.closest('[data-curso]'); if (!boton || ocupado) return;
  abrirCurso(Number(boton.dataset.curso)).catch(err => aviso.textContent = err.message);
};
document.getElementById('formCurso').onsubmit = event => {
  event.preventDefault(); guardar('/estructura/cursos', 'POST', { ...campos(event.target), ciclo: estructura.ciclo.anio }, false);
};
detalle.onsubmit = event => {
  event.preventDefault(); if (!cursoDetalle) return;
  const form = event.target, body = campos(form), base = '/estructura/curso/' + cursoDetalle.id;
  const rutas = { curso: [base, 'PATCH'], materia: [`${base}/materia/${form.dataset.id}`, 'PATCH'], materiaNueva: [base + '/materias', 'POST'], profesor: [`${base}/materia/${form.dataset.id}/profesor`, 'POST'], preceptor: [base + '/preceptor', 'POST'], personal: [base + '/personal', 'POST'] };
  if (rutas[form.dataset.tipo]) guardar(...rutas[form.dataset.tipo], body);
};
detalle.onclick = event => {
  const boton = event.target.closest('[data-quitar]');
  if (boton && cursoDetalle) guardar(`/estructura/curso/${cursoDetalle.id}/preceptor/${boton.dataset.quitar}`, 'DELETE', {});
};
document.addEventListener('ciclochange', () => { cursoDetalle = null; detalle.hidden = true; aviso.textContent = ''; cargarEstructura().catch(err => aviso.textContent = err.message); });
(async () => {
  if (localStorage.getItem('rango') !== 'regente') { location.href = 'dashboard.html'; return; }
  await ciclosReady;
  await cargarEstructura();
})().catch(err => aviso.textContent = err.message);
