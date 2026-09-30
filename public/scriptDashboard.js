const id      = localStorage.getItem("id");
const permiso = localStorage.getItem("permiso");
const usuario = localStorage.getItem("usuario");
const rango   = localStorage.getItem("rango");

const colores = [
  "linear-gradient(135deg, #2563eb, #1d4ed8)",
  "linear-gradient(135deg, #db2777, #be185d)",
  "linear-gradient(135deg, #16a34a, #15803d)",
  "linear-gradient(135deg, #d97706, #b45309)",
  "linear-gradient(135deg, #7c3aed, #6d28d9)",
];

const USA_CARPETAS = ["profesor", "preceptor", "regente"];

if (!id || !localStorage.getItem("token")) {
  location.href = "index.html";
}

document.getElementById("userInfo").textContent = usuario;

if (rango === "regente") {
  const btn = document.getElementById("boletinesBtn");
  if (btn) btn.style.display = "inline-flex";
  const btnUsuarios = document.getElementById("usuariosBtn");
  if (btnUsuarios) btnUsuarios.style.display = "inline-flex";
}

function svgFolder() {
  return `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>`;
}

async function cargarCursos() {
  document.getElementById("volverBtn").style.display = "none";
  document.getElementById("breadcrumb").textContent   = "";

  try {
    const res = await apiFetch("/dashboard/" + id);
    if (!res) return;

    if (!res.ok) {
      mostrarMensaje("No pudimos cargar tus materias. Recargá la página.", "error");
      return;
    }

    const data = await res.json();
    const grid = document.getElementById("grid");

    if (!data || data.length === 0) {
      grid.innerHTML = "<p class='vacio-msg'>No hay cursos asignados.</p>";
      return;
    }

    grid.innerHTML = "";

    for (let i = 0; i < data.length; i++) {
      const curso = data[i];
      const color = colores[i % colores.length];

      const card = document.createElement("div");
      card.classList.add("card");
      card.style.animationDelay = `${i * 0.04}s`;

      card.innerHTML = `
        <div class="card-header curso-header" style="background:${color}">
          <span class="curso-icono">${svgFolder()}</span>
          <span class="curso-nombre">${escHTML(curso.anio)}° ${escHTML(curso.division)}</span>
        </div>
        <div class="card-body">
          <p><strong>Turno</strong> ${escHTML(curso.turno)}</p>
        </div>
      `;

      card.addEventListener("click", function () {
        cargarMateriasDeCurso(curso.id, `${curso.anio}° ${curso.division}`);
      });

      grid.appendChild(card);
    }

  } catch (err) {
    console.error("Error al cargar cursos:", err);
    mostrarMensaje("No nos pudimos conectar con el servidor.", "error");
  }
}

async function cargarMateriasDeCurso(cursoId, etiquetaCurso) {
  try {
    const res = await apiFetch("/dashboard/curso/" + cursoId);
    if (!res) return;

    if (!res.ok) {
      const err = await res.json();
      mostrarMensaje(err.error || "No pudimos cargar las materias de este curso.", "error");
      return;
    }

    const data = await res.json();
    const grid = document.getElementById("grid");

    document.getElementById("volverBtn").style.display = "inline-flex";
    document.getElementById("breadcrumb").textContent  = `Cursos / ${etiquetaCurso}`;

    if (!data.materias || data.materias.length === 0) {
      grid.innerHTML = "<p class='vacio-msg'>No hay materias en este curso.</p>";
      return;
    }

    grid.innerHTML = "";

    for (let i = 0; i < data.materias.length; i++) {
      const materia = data.materias[i];
      const color   = colores[i % colores.length];

      const card = document.createElement("div");
      card.classList.add("card");
      card.style.animationDelay = `${i * 0.04}s`;

      card.innerHTML = `
        <div class="card-header" style="background:${color}">
          ${escHTML(materia.materia)}
        </div>
        <div class="card-body">
          <p><strong>Curso</strong> ${escHTML(materia.anio)}° ${escHTML(materia.division)}</p>
          <p><strong>Días</strong> ${escHTML(materia.dias)}</p>
          <p><strong>Horario</strong> ${escHTML(materia.horario)}</p>
          ${
            (rango === "regente" || rango === "preceptor") && materia.nombre_profesor
              ? `<p><strong>Profesor</strong> ${escHTML(materia.nombre_profesor)} ${escHTML(materia.apellido)}</p>`
              : ""
          }
        </div>
        <div class="card-actions">
          ${
            permiso === "escritura" || permiso === "ambos"
              ? `<button class="admin-btn">Administrar notas</button>`
              : ""
          }
          ${
            permiso === "lectura"
              ? `<button class="view-btn">Visualizar notas</button>`
              : ""
          }
        </div>
      `;

      grid.appendChild(card);

      const adminBtn = card.querySelector(".admin-btn");
      if (adminBtn) {
        adminBtn.addEventListener("click", function () {
          location.href = "planilla.html?materia=" + materia.id;
        });
      }

      const viewBtn = card.querySelector(".view-btn");
      if (viewBtn) {
        viewBtn.addEventListener("click", function () {
          location.href = "planilla.html?materia=" + materia.id;
        });
      }
    }

  } catch (err) {
    console.error("Error al cargar materias del curso:", err);
    mostrarMensaje("No nos pudimos conectar con el servidor.", "error");
  }
}

async function cargarMateriasAlumno() {
  document.getElementById("volverBtn").style.display = "none";
  document.getElementById("breadcrumb").textContent   = "";

  try {
    const res = await apiFetch("/dashboard/" + id);
    if (!res) return;

    if (!res.ok) {
      mostrarMensaje("No pudimos cargar tus materias. Recargá la página.", "error");
      return;
    }

    const data = await res.json();
    const grid = document.getElementById("grid");

    if (!data || data.length === 0) {
      grid.innerHTML = "<p class='vacio-msg'>No hay materias asignadas.</p>";
      return;
    }

    grid.innerHTML = "";

    for (let i = 0; i < data.length; i++) {
      const materia = data[i];
      const color   = colores[i % colores.length];

      const card = document.createElement("div");
      card.classList.add("card");
      card.style.animationDelay = `${i * 0.04}s`;

      card.innerHTML = `
        <div class="card-header" style="background:${color}">
          ${escHTML(materia.materia)}
        </div>
        <div class="card-body">
          <p><strong>Curso</strong> ${escHTML(materia.anio)}° ${escHTML(materia.division)}</p>
          <p><strong>Días</strong> ${escHTML(materia.dias)}</p>
          <p><strong>Horario</strong> ${escHTML(materia.horario)}</p>
        </div>
        <div class="card-actions">
          <button class="view-btn">Visualizar notas</button>
        </div>
      `;

      grid.appendChild(card);

      const viewBtn = card.querySelector(".view-btn");
      viewBtn.addEventListener("click", function () {
        location.href = "planilla.html?materia=" + materia.id;
      });
    }

  } catch (err) {
    console.error("Error al cargar materias del alumno:", err);
    mostrarMensaje("No nos pudimos conectar con el servidor.", "error");
  }
}

function volverACursos() {
  cargarCursos();
}

if (rango === "secretario") {
  location.href = "boletines.html";
} else if (rango === "alumno") {
  cargarMateriasAlumno();
} else if (USA_CARPETAS.includes(rango)) {
  cargarCursos();
} else {
  document.getElementById("grid").innerHTML = "<p class='vacio-msg'>Rol no reconocido.</p>";
}

initAyuda({
  porRol: {
    profesor: "Tocá un curso para ver sus materias. 'Administrar notas' te deja cargar y editar; si no ves ese botón en una materia, es porque ahí solo podés mirar.",
    alumno: "Acá ves tus materias. Tocá una para ver tus notas de bimestres, cuatrimestres y el resultado final.",
    regente: "Podés ver todos los cursos del colegio. Arriba a la derecha tenés el botón 'Boletines' para generar las libretas de un curso completo.",
    preceptor: "Ves todas las materias de los cursos que tenés asignados, pero no podés cargar ni cambiar notas — solo consultarlas."
  }
});