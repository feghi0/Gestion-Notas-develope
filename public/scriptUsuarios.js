const rango = localStorage.getItem("rango");

if (!localStorage.getItem("token")) {
  location.href = "index.html";
}
if (rango !== "regente") {
  mostrarMensaje("Esta sección es solo para el regente.", "error");
  setTimeout(() => location.href = "dashboard.html", 1200);
}

const vista      = document.getElementById("vista");
const breadcrumb = document.getElementById("breadcrumb");
const volverBtn  = document.getElementById("volverBtn");

let cursoActual = null; // { id, anio, division, turno }

// ─── Navegación ───────────────────────────────────────────────────────────

function setBreadcrumb(texto) { breadcrumb.textContent = texto; }

function setVolver(mostrar, onClick) {
  volverBtn.style.display = mostrar ? "inline-flex" : "none";
  volverBtn.onclick = onClick || null;
}

// ─── Vista 1: lista de cursos ─────────────────────────────────────────────

async function mostrarCursos() {
  setBreadcrumb("Cursos");
  setVolver(false);
  vista.innerHTML = `<div class="cargando">Cargando cursos...</div>`;

  try {
    const res = await apiFetch("/usuarios/cursos");
    if (!res) return;
    const data = await res.json();

    if (!res.ok || !data.success) {
      vista.innerHTML = `<div class="vacio">${escHTML(data.error || "No pudimos cargar los cursos.")}</div>`;
      return;
    }
    if (data.cursos.length === 0) {
      vista.innerHTML = `<div class="vacio">No hay cursos creados.</div>`;
      return;
    }

    vista.innerHTML = `<div class="grid-cursos">${data.cursos.map(c => `
      <div class="curso-card" data-id="${c.id}">
        <h3>${escHTML(c.anio)}° ${escHTML(c.division)}</h3>
        <p>Turno ${escHTML(c.turno)}</p>
      </div>
    `).join("")}</div>`;

    for (const card of vista.querySelectorAll(".curso-card")) {
      const curso = data.cursos.find(c => c.id === Number(card.dataset.id));
      card.addEventListener("click", () => mostrarMenuCurso(curso));
    }
  } catch (err) {
    console.error("Error al cargar cursos:", err);
    vista.innerHTML = `<div class="vacio">Error de conexión.</div>`;
  }
}

// ─── Vista 2: submenú Materias / Alumnos ──────────────────────────────────

function mostrarMenuCurso(curso) {
  cursoActual = curso;
  setBreadcrumb(`Cursos / ${curso.anio}° ${curso.division}`);
  setVolver(true, mostrarCursos);

  vista.innerHTML = `
    <div class="grid-opciones">
      <div class="opcion-card" id="opcionMaterias">
        <div class="icono">📚</div>
        <h3>Materias</h3>
        <p>Ver y cambiar el profesor de cada materia</p>
      </div>
      <div class="opcion-card" id="opcionAlumnos">
        <div class="icono">🎓</div>
        <h3>Alumnos</h3>
        <p>Ver, agregar o dar de baja alumnos de este curso</p>
      </div>
    </div>
  `;

  document.getElementById("opcionMaterias").addEventListener("click", mostrarMaterias);
  document.getElementById("opcionAlumnos").addEventListener("click", mostrarAlumnos);
}

// ─── Vista 3a: Materias de un curso ────────────────────────────────────────

async function mostrarMaterias() {
  setBreadcrumb(`Cursos / ${cursoActual.anio}° ${cursoActual.division} / Materias`);
  setVolver(true, () => mostrarMenuCurso(cursoActual));
  vista.innerHTML = `<div class="cargando">Cargando materias...</div>`;

  try {
    const res = await apiFetch(`/usuarios/curso/${cursoActual.id}/materias`);
    if (!res) return;
    const data = await res.json();

    if (!res.ok || !data.success) {
      vista.innerHTML = `<div class="vacio">${escHTML(data.error || "No pudimos cargar las materias.")}</div>`;
      return;
    }
    if (data.materias.length === 0) {
      vista.innerHTML = `<div class="vacio">Este curso no tiene materias asignadas.</div>`;
      return;
    }

    vista.innerHTML = `<div class="lista">${data.materias.map(m => `
      <div class="fila" data-cmid="${m.cursoMateriaId}">
        <div class="fila-top">
          <div>
            <div class="fila-nombre">${escHTML(m.materia)}</div>
            <div class="fila-sub ${m.profesor ? "" : "sin-asignar"}">
              ${m.profesor
                ? `Profesor/a: ${escHTML(m.profesor.apellido)}, ${escHTML(m.profesor.nombre)} (DNI ${escHTML(m.profesor.dni)})`
                : "Sin profesor asignado"}
            </div>
          </div>
          <div class="fila-acciones">
            ${m.profesor ? `<button class="btn-chico btn-quitar" data-accion="quitar">Quitar</button>` : ""}
            <button class="btn-chico btn-asignar" data-accion="asignar">${m.profesor ? "Cambiar" : "Asignar profesor"}</button>
          </div>
        </div>
        <div class="form-container"></div>
      </div>
    `).join("")}</div>`;

    for (const fila of vista.querySelectorAll(".fila")) {
      const cmId = Number(fila.dataset.cmid);

      const btnQuitar = fila.querySelector('[data-accion="quitar"]');
      if (btnQuitar) btnQuitar.addEventListener("click", () => quitarProfesor(cmId));

      fila.querySelector('[data-accion="asignar"]').addEventListener("click", () =>
        toggleFormAsignarProfesor(fila, cmId)
      );
    }
  } catch (err) {
    console.error("Error al cargar materias:", err);
    vista.innerHTML = `<div class="vacio">Error de conexión.</div>`;
  }
}

function toggleFormAsignarProfesor(fila, cmId) {
  const cont = fila.querySelector(".form-container");
  if (cont.innerHTML.trim() !== "") { cont.innerHTML = ""; return; }

  cont.innerHTML = `
    <div class="form-inline">
      <input type="text" placeholder="Apellido" class="in-apellido">
      <input type="text" placeholder="Nombre" class="in-nombre">
      <input type="text" placeholder="DNI (sin puntos)" inputmode="numeric" class="in-dni">
      <div class="form-inline-acciones">
        <button class="btn-chico btn-asignar btn-confirmar">Guardar</button>
        <button class="btn-chico btn-quitar btn-cancelar-inline">Cancelar</button>
      </div>
    </div>
  `;

  cont.querySelector(".btn-cancelar-inline").addEventListener("click", () => { cont.innerHTML = ""; });
  cont.querySelector(".btn-confirmar").addEventListener("click", async () => {
    const apellido = cont.querySelector(".in-apellido").value.trim();
    const nombre   = cont.querySelector(".in-nombre").value.trim();
    const dni      = cont.querySelector(".in-dni").value.trim();

    if (!apellido || !nombre || !dni) {
      mostrarMensaje("Completá apellido, nombre y DNI.", "error");
      return;
    }

    try {
      const res = await apiFetch(`/usuarios/materia/${cmId}/profesor`, {
        method: "POST",
        body: JSON.stringify({ nombre, apellido, dni })
      });
      if (!res) return;
      const data = await res.json();

      if (!res.ok || !data.success) {
        mostrarMensaje(data.error || "No pudimos asignar el profesor.", "error");
        return;
      }

      mostrarMensaje(
        data.creoNuevo
          ? `Profesor creado y asignado. Usuario: ${data.usuario} · Contraseña temporal: ${data.passwordTemporal}`
          : `Profesor asignado a la materia.`,
        "exito"
      );
      mostrarMaterias();
    } catch (err) {
      console.error("Error al asignar profesor:", err);
      mostrarMensaje("No nos pudimos conectar con el servidor.", "error");
    }
  });
}

async function quitarProfesor(cmId) {
  if (!confirm("¿Quitar al profesor de esta materia? Su cuenta sigue existiendo si dicta otras materias.")) return;

  try {
    const res = await apiFetch(`/usuarios/materia/${cmId}/profesor`, { method: "DELETE" });
    if (!res) return;
    const data = await res.json();

    if (!res.ok || !data.success) {
      mostrarMensaje(data.error || "No pudimos quitar al profesor.", "error");
      return;
    }
    mostrarMensaje("Profesor quitado de la materia.", "exito");
    mostrarMaterias();
  } catch (err) {
    console.error("Error al quitar profesor:", err);
    mostrarMensaje("No nos pudimos conectar con el servidor.", "error");
  }
}

// ─── Vista 3b: Alumnos de un curso ─────────────────────────────────────────

async function mostrarAlumnos() {
  setBreadcrumb(`Cursos / ${cursoActual.anio}° ${cursoActual.division} / Alumnos`);
  setVolver(true, () => mostrarMenuCurso(cursoActual));
  vista.innerHTML = `<div class="cargando">Cargando alumnos...</div>`;

  try {
    const res = await apiFetch(`/usuarios/curso/${cursoActual.id}/alumnos`);
    if (!res) return;
    const data = await res.json();

    if (!res.ok || !data.success) {
      vista.innerHTML = `<div class="vacio">${escHTML(data.error || "No pudimos cargar los alumnos.")}</div>`;
      return;
    }

    const listaHTML = data.alumnos.length === 0
      ? `<div class="vacio">Este curso no tiene alumnos inscriptos.</div>`
      : `<div class="lista">${data.alumnos.map(a => `
          <div class="fila" data-id="${a.id}">
            <div class="fila-top">
              <div>
                <div class="fila-nombre">${escHTML(a.apellido)}, ${escHTML(a.nombre)}</div>
                <div class="fila-sub ${a.cantidadNotas > 0 ? "con-notas" : ""}">
                  DNI ${escHTML(a.dni)} · ${a.cantidadNotas} nota${a.cantidadNotas !== 1 ? "s" : ""} cargada${a.cantidadNotas !== 1 ? "s" : ""}
                </div>
              </div>
              <div class="fila-acciones">
                <button class="btn-chico btn-quitar" data-accion="eliminar">Eliminar</button>
              </div>
            </div>
          </div>
        `).join("")}</div>`;

    vista.innerHTML = `
      <button class="btn-toggle-agregar" id="btnMostrarFormAlumno">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        Agregar alumno
      </button>
      <div class="form-agregar-panel" id="panelFormAlumno" style="display:none;">
        <div class="form-inline">
          <input type="text" placeholder="Apellido" class="in-apellido">
          <input type="text" placeholder="Nombre" class="in-nombre">
          <input type="text" placeholder="DNI (sin puntos)" inputmode="numeric" class="in-dni">
          <input type="email" placeholder="Mail del alumno (opcional)" class="in-email-usuario">
          <input type="email" placeholder="Mail de la familia (opcional)" class="in-email-familiar">
          <div class="form-inline-acciones">
            <button class="btn-chico btn-asignar btn-confirmar">Crear e inscribir</button>
            <button class="btn-chico btn-quitar btn-cancelar-inline">Cancelar</button>
          </div>
        </div>
      </div>
      ${listaHTML}
    `;

    const panel = document.getElementById("panelFormAlumno");
    document.getElementById("btnMostrarFormAlumno").addEventListener("click", () => {
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    });
    panel.querySelector(".btn-cancelar-inline").addEventListener("click", () => {
      panel.style.display = "none";
    });
    panel.querySelector(".btn-confirmar").addEventListener("click", async () => {
      const apellido       = panel.querySelector(".in-apellido").value.trim();
      const nombre         = panel.querySelector(".in-nombre").value.trim();
      const dni             = panel.querySelector(".in-dni").value.trim();
      const emailUsuario   = panel.querySelector(".in-email-usuario").value.trim();
      const emailFamiliar  = panel.querySelector(".in-email-familiar").value.trim();

      if (!apellido || !nombre || !dni) {
        mostrarMensaje("Completá apellido, nombre y DNI.", "error");
        return;
      }

      try {
        const res = await apiFetch(`/usuarios/curso/${cursoActual.id}/alumno`, {
          method: "POST",
          body: JSON.stringify({ nombre, apellido, dni, emailUsuario, emailFamiliar })
        });
        if (!res) return;
        const data = await res.json();

        if (!res.ok || !data.success) {
          mostrarMensaje(data.error || "No pudimos agregar el alumno.", "error");
          return;
        }

        mostrarMensaje(
          data.creoNuevo
            ? `Alumno creado e inscripto. Usuario: ${data.usuario} · Contraseña temporal: ${data.passwordTemporal}`
            : `Alumno inscripto en el curso.`,
          "exito"
        );
        mostrarAlumnos();
      } catch (err) {
        console.error("Error al agregar alumno:", err);
        mostrarMensaje("No nos pudimos conectar con el servidor.", "error");
      }
    });

    for (const btn of vista.querySelectorAll('[data-accion="eliminar"]')) {
      const fila = btn.closest(".fila");
      const alumnoId = Number(fila.dataset.id);
      const nombreAlumno = fila.querySelector(".fila-nombre").textContent;
      btn.addEventListener("click", () => eliminarAlumno(alumnoId, nombreAlumno));
    }
  } catch (err) {
    console.error("Error al cargar alumnos:", err);
    vista.innerHTML = `<div class="vacio">Error de conexión.</div>`;
  }
}

async function eliminarAlumno(alumnoId, nombreAlumno) {
  if (!confirm(`¿Dar de baja a ${nombreAlumno}? Ya no va a poder iniciar sesión ni aparecer en las planillas, pero todas sus notas y evaluaciones quedan guardadas en el sistema.`)) return;

  try {
    const res = await apiFetch(`/usuarios/curso/${cursoActual.id}/alumno/${alumnoId}`, { method: "DELETE" });
    if (!res) return;
    const data = await res.json();

    if (!res.ok || !data.success) {
      mostrarMensaje(data.error || "No pudimos dar de baja al alumno.", "error");
      return;
    }
    mostrarMensaje(`${nombreAlumno} fue dado de baja. Su historial académico quedó guardado.`, "exito");
    mostrarAlumnos();
  } catch (err) {
    console.error("Error al eliminar alumno:", err);
    mostrarMensaje("No nos pudimos conectar con el servidor.", "error");
  }
}

// ─── Inicio ────────────────────────────────────────────────────────────────

mostrarCursos();

initAyuda({
  porRol: {
    regente: "Entrá a un curso y elegí Materias o Alumnos. En Materias podés asignar o cambiar el profesor escribiendo su nombre, apellido y DNI. En Alumnos podés agregar o dar de baja: al dar de baja, el alumno pierde el acceso pero todas sus notas quedan guardadas para siempre."
  }
});