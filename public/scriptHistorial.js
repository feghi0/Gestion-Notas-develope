(() => {
  const button = document.getElementById("historialBtn");
  if (!["regente", "profesor"].includes(localStorage.getItem("rango"))) return;
  button.hidden = false;
  const dialog = document.createElement("dialog");
  dialog.className = "historial-dialog";
  dialog.setAttribute("aria-labelledby", "historialTitulo");
  dialog.innerHTML = `
    <div class="historial-cabecera">
      <div><h2 id="historialTitulo">Historial de notas</h2>
      <p>Consultá quién cargó, modificó o eliminó una nota. El estado inicial corresponde a las notas previas a la habilitación del historial.</p></div>
      <button type="button" id="cerrarHistorial" aria-label="Cerrar historial">Cerrar</button>
    </div>
    <div class="historial-filtro"><label for="historialAlumno">Alumno</label>
      <select id="historialAlumno"><option value="">Todos los alumnos</option></select>
      <button type="button" id="actualizarHistorial">Actualizar</button>
    </div>
    <p id="historialEstado" role="status" aria-live="polite"></p>
    <div class="historial-scroll"><table aria-label="Cambios de notas">
      <thead><tr><th>Fecha y hora</th><th>Alumno</th><th>Evaluación</th><th>Acción</th><th>Antes</th><th>Después</th><th>Responsable</th></tr></thead>
      <tbody id="historialFilas"></tbody>
    </table></div>
    <button type="button" id="masHistorial" hidden>Ver más cambios</button>`;
  document.body.appendChild(dialog);
  const select = dialog.querySelector("#historialAlumno");
  const rows = dialog.querySelector("#historialFilas");
  const status = dialog.querySelector("#historialEstado");
  const more = dialog.querySelector("#masHistorial");
  const refresh = dialog.querySelector("#actualizarHistorial");
  let cursor = null;
  let loading = false;
  const labels = { INICIAL: "Estado inicial", ALTA: "Carga", MODIFICACION: "Modificación", BAJA: "Eliminación" };

  async function load(append = false) {
    if (loading) return;
    loading = true;
    select.disabled = refresh.disabled = more.disabled = true;
    status.textContent = "Cargando historial…";
    if (!append) { rows.replaceChildren(); cursor = null; more.hidden = true; }
    try {
      const query = new URLSearchParams();
      if (select.value) query.set("alumno", select.value);
      if (append && cursor) query.set("antes", cursor);
      const response = await apiFetch(`/planilla/historial/${encodeURIComponent(cursoMateriaId)}?${query}`);
      if (!response) return;
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pudimos consultar el historial.");
      for (const event of data.historial) {
        const row = document.createElement("tr");
        const evaluation = event.evaluacion || {};
        const period = evaluation.cierre ? `Cierre ${evaluation.cierre}` : evaluation.bimestre ? `Bimestre ${evaluation.bimestre}` : "Nota importada / fija";
        const values = [
          new Date(event.fecha).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }),
          event.alumno_nombre, `${evaluation.descripcion || evaluation.tipo || "Evaluación eliminada"} · ${period}`,
          labels[event.accion] || event.accion, event.nota_anterior ?? "—", event.nota_nueva ?? "—", event.actor_nombre
        ];
        for (const value of values) { const cell = document.createElement("td"); cell.textContent = value; row.appendChild(cell); }
        rows.appendChild(row);
      }
      cursor = data.siguiente;
      more.hidden = !cursor;
      status.textContent = rows.children.length ? `Registros mostrados: ${rows.children.length}. Horario de Buenos Aires.` : "No hay cambios registrados para este alumno o materia.";
    } catch (err) {
      status.textContent = err.message || "No pudimos consultar el historial.";
    } finally {
      loading = false;
      select.disabled = refresh.disabled = more.disabled = false;
    }
  }
  button.addEventListener("click", () => {
    const selected = select.value;
    select.replaceChildren(new Option("Todos los alumnos", ""));
    for (const alumno of alumnosGlobales) select.add(new Option(`${alumno.apellido}, ${alumno.nombre}`, String(alumno.id)));
    select.value = selected;
    dialog.showModal();
    load();
  });
  dialog.querySelector("#cerrarHistorial").addEventListener("click", () => dialog.close());
  select.addEventListener("change", () => load());
  refresh.addEventListener("click", () => load());
  more.addEventListener("click", () => load(true));
})();
