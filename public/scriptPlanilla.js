const params         = new URLSearchParams(location.search);
const cursoMateriaId = params.get("materia");
const permiso        = localStorage.getItem("permiso");
const rango          = localStorage.getItem("rango");
const tbody          = document.getElementById("tbody");

let alumnosGlobales    = [];
let evaluacionesGlobal = [];
let cierreActivo       = 1;

if (!localStorage.getItem("token")) {
  location.href = "index.html";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esParticipacion(tipo) {
  return (tipo || "").toLowerCase().includes("particip");
}

function esCierre(ev) {
  const c = Number(ev.cierre);
  return c === 1 || c === 2;
}

function esImportadoExcel(ev) {
  return String(ev.descripcion || "").trim() === "Importado desde Excel";
}

function esOverrideImport(ev, campo) {
  return String(ev.descripcion || "").trim() === `Import override:${campo}`;
}

function ultimaNota(lista) {
  if (!lista || lista.length === 0) return null;
  const last = lista.reduce((a, b) => Number(a.id) > Number(b.id) ? a : b);
  return Number(last.nota);
}

function notaImportadaBimestre(evaluacionesAlumno, num) {
  return ultimaNota(evaluacionesAlumno.filter(e =>
    esImportadoExcel(e) && Number(e.bimestre) === Number(num) && !esCierre(e)
  ));
}

function notaOverrideCampo(evaluacionesAlumno, campo) {
  return ultimaNota(evaluacionesAlumno.filter(e => esOverrideImport(e, campo)));
}

function formatearNotaNum(n) {
  return Number(n).toFixed(2);
}

function puedeEscribir() {
  return permiso === "escritura" || permiso === "ambos";
}

// ─── Lógica de acumulativos ───────────────────────────────────────────────────

function calcularSaldadas(evaluacionesAlumno) {
  const saldadas  = new Set();
  const notaPorId = new Map();

  for (const ev of evaluacionesAlumno) {
    notaPorId.set(Number(ev.id), Number(ev.nota));
  }
  for (const ev of evaluacionesAlumno) {
    if (Number(ev.es_acumulativo) === 1 && ev.evaluacion_origen_id != null) {
      if (Number(ev.nota) >= 6) {
        const origenId   = Number(ev.evaluacion_origen_id);
        const notaOrigen = notaPorId.get(origenId);
        if (notaOrigen !== undefined && notaOrigen < 6) {
          saldadas.add(origenId);
        }
      }
    }
  }

  for (const num of [1, 2, 3, 4]) {
    const imp = notaImportadaBimestre(evaluacionesAlumno, num);
    if (imp === null || imp < 6) continue;
    for (const ev of evaluacionesAlumno) {
      if (esImportadoExcel(ev)) continue;
      if (esCierre(ev) || esParticipacion(ev.tipo)) continue;
      if (Number(ev.bimestre) !== num) continue;
      if (Number(ev.nota) < 6) saldadas.add(Number(ev.id));
    }
  }

  return saldadas;
}

function calcularBimestre(evaluacionesAlumno, num) {
  const importada = notaImportadaBimestre(evaluacionesAlumno, num);
  if (importada !== null) return formatearNotaNum(importada);

  const evaluaciones = evaluacionesAlumno.filter(
    e => Number(e.bimestre) === Number(num) && !esCierre(e)
  );
  if (evaluaciones.length === 0) return "-";

  const saldadas        = calcularSaldadas(evaluacionesAlumno);
  const participaciones = evaluaciones.filter(e =>  esParticipacion(e.tipo));
  const normales        = evaluaciones.filter(e => !esParticipacion(e.tipo));

  for (const saldada of normales.filter(e => saldadas.has(Number(e.id)))) {
    const acumulativa = evaluacionesAlumno.find(
      e =>
        Number(e.es_acumulativo) === 1 &&
        Number(e.evaluacion_origen_id) === Number(saldada.id) &&
        Number(e.nota) >= 6
    );
    if (acumulativa && Number(acumulativa.bimestre) !== Number(num)) {
      return "DESAPROBADO";
    }
  }

  const paraPromedio = normales.filter(e => !saldadas.has(Number(e.id)));
  if (paraPromedio.some(e => Number(e.nota) < 6)) return "DESAPROBADO";
  if (paraPromedio.length === 0 && participaciones.length === 0) return "-";

  const promedioBase = paraPromedio.length > 0
    ? paraPromedio.reduce((s, e) => s + Number(e.nota), 0) / paraPromedio.length
    : 0;
  const ajuste = participaciones.reduce((s, e) => s + Number(e.nota), 0);
  return (promedioBase + ajuste).toFixed(2);
}

function calcularBimestreEfectivo(evaluacionesAlumno, num) {
  const importada = notaImportadaBimestre(evaluacionesAlumno, num);
  if (importada !== null) return formatearNotaNum(importada);

  const evaluaciones = evaluacionesAlumno.filter(
    e => Number(e.bimestre) === Number(num) && !esCierre(e)
  );
  if (evaluaciones.length === 0) return "-";

  const saldadas        = calcularSaldadas(evaluacionesAlumno);
  const participaciones = evaluaciones.filter(e =>  esParticipacion(e.tipo));
  const normales        = evaluaciones.filter(e => !esParticipacion(e.tipo));
  const paraPromedio    = normales.filter(e => !saldadas.has(Number(e.id)));

  if (paraPromedio.some(e => Number(e.nota) < 6)) return "DESAPROBADO";
  if (paraPromedio.length === 0 && participaciones.length === 0) return "-";

  const promedioBase = paraPromedio.length > 0
    ? paraPromedio.reduce((s, e) => s + Number(e.nota), 0) / paraPromedio.length
    : 0;
  const ajuste = participaciones.reduce((s, e) => s + Number(e.nota), 0);
  return (promedioBase + ajuste).toFixed(2);
}

function calcularCuatrimestre(evaluacionesAlumno, b1, b2) {
  const campo = Number(b1) === 1 ? "cq1" : "cq2";
  const override = notaOverrideCampo(evaluacionesAlumno, campo);
  if (override !== null) return formatearNotaNum(override);

  const ef1 = calcularBimestreEfectivo(evaluacionesAlumno, b1);
  const ef2 = calcularBimestreEfectivo(evaluacionesAlumno, b2);
  if (ef1 === "DESAPROBADO" || ef2 === "DESAPROBADO") return "DESAPROBADO";
  const nums = [ef1, ef2].filter(n => n !== "-").map(Number);
  if (nums.length === 0) return "-";
  return (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2);
}

function necesitaCierres(cuat1, cuat2) {
  if (cuat1 === "DESAPROBADO" || cuat2 === "DESAPROBADO") return true;
  const nums = [cuat1, cuat2].filter(n => n !== "-").map(Number);
  if (nums.length === 0) return false;
  return nums.reduce((a, b) => a + b, 0) / nums.length < 6;
}

function estadoCierre1(evaluacionesAlumno) {
  const temas = evaluacionesAlumno.filter(e => Number(e.cierre) === 1);
  if (temas.length === 0) return null;
  const desaprobados = temas.filter(e => Number(e.nota) < 6);
  const prom = temas.reduce((s, e) => s + Number(e.nota), 0) / temas.length;
  return { temas, aprobado: desaprobados.length === 0, promedio: parseFloat(prom.toFixed(2)), desaprobados };
}

function estadoCierre2(evaluacionesAlumno) {
  const temas = evaluacionesAlumno.filter(e => Number(e.cierre) === 2);
  if (temas.length === 0) return null;
  const desaprobados = temas.filter(e => Number(e.nota) < 6);
  const prom = temas.reduce((s, e) => s + Number(e.nota), 0) / temas.length;
  return { temas, aprobado: desaprobados.length === 0, promedio: parseFloat(prom.toFixed(2)), desaprobados };
}

// ─── Renders ──────────────────────────────────────────────────────────────────

function renderResumenBimestre(prom) {
  const esDesap = prom === "DESAPROBADO";
  const esVacio = prom === "-";
  const numVal  = parseFloat(prom);
  // Desaprobado si es el string "DESAPROBADO" o si el número es < 6
  const esMalo  = esDesap || (!esVacio && !isNaN(numVal) && numVal < 6);
  const clase   = esMalo ? "desaprobado" : (!esVacio ? "aprobado" : "");
  return `
    <div class="bim-resumen">
      <div class="bim-resumen-label">Promedio bimestre</div>
      <div class="bim-resumen-valor ${clase}">${escHTML(prom)}</div>
    </div>`;
}

function renderResumenCierreHTML(estado) {
  if (!estado) return "";
  const clase = estado.aprobado ? "aprobado" : "desaprobado";
  const texto = estado.aprobado
    ? `${estado.promedio.toFixed(2)} — Aprobado`
    : `${estado.promedio.toFixed(2)} — Desaprobado`;
  return `
    <div class="cierre-resumen">
      <div class="cierre-resumen-label">Resultado cierre</div>
      <div class="cierre-resumen-valor ${clase}">${escHTML(texto)}</div>
    </div>`;
}

function renderBimestre(evaluacionesAlumno, alumno, num) {
  const evaluaciones = evaluacionesAlumno.filter(
    e => Number(e.bimestre) === Number(num) && !esCierre(e)
  );
  const saldadas = calcularSaldadas(evaluacionesAlumno);
  const promBim  = calcularBimestre(evaluacionesAlumno, num);

  let html = "";
  for (const ev of evaluaciones) {
    const esPartic    = esParticipacion(ev.tipo);
    const estaSaldada = saldadas.has(Number(ev.id));
    const esAcum      = Number(ev.es_acumulativo) === 1;
    const nota        = Number(ev.nota);

    let claseEval = "eval";
    let claseNota = "eval-nota";

    if (estaSaldada) {
      claseEval += " eval-saldada";
      claseNota += " eval-nota-gris";
    } else if (!esPartic && nota < 6) {
      claseNota += " eval-nota-roja";
    }

    const badgeAcum = esAcum ? `<span class="eval-acum-badge">Acumulativa</span><br>` : "";

    html += `
      <div class="${claseEval}">
        <div class="eval-top">
          <span class="eval-tipo">${esPartic ? "Valoración" : escHTML(ev.tipo || "Evaluación")}</span>
          <span class="${claseNota}">${escHTML(ev.nota)}</span>
        </div>
        ${badgeAcum}
        <div class="eval-desc">${escHTML(ev.descripcion)}</div>
        ${puedeEscribir()
          ? `<button onclick="eliminarEvaluacion(${Number(ev.id)}, ${Number(alumno.id)})">Eliminar</button>`
          : ""}
      </div>`;
  }

  html += renderResumenBimestre(promBim);
  return html;
}

function renderCeldaCierre1(evaluacionesAlumno, alumno, habilitado) {
  if (!habilitado) return `<td class="prom" style="color:#aaa;">-</td>`;
  const estado = estadoCierre1(evaluacionesAlumno);
  if (!estado) return `<td class="prom" style="color:#7b1fa2;font-size:13px;">Pendiente</td>`;

  let html = "";
  for (const ev of estado.temas) {
    const nota      = Number(ev.nota);
    const claseNota = nota >= 6 ? "eval-nota" : "eval-nota eval-nota-roja";
    html += `
      <div class="eval">
        <div class="eval-top">
          <span class="eval-tipo">${escHTML(ev.descripcion || "Tema")}</span>
          <span class="${claseNota}">${escHTML(ev.nota)}</span>
        </div>
        <span class="eval-cierre-badge dic">Diciembre</span>
        ${puedeEscribir()
          ? `<button onclick="eliminarEvaluacion(${Number(ev.id)}, ${Number(alumno.id)})">Eliminar</button>`
          : ""}
      </div>`;
  }
  html += renderResumenCierreHTML(estado);
  return `<td class="prom">${html}</td>`;
}

function renderCeldaCierre2(evaluacionesAlumno, alumno, habilitado) {
  if (!habilitado) return `<td class="prom" style="color:#aaa;">-</td>`;
  const estadoDic = estadoCierre1(evaluacionesAlumno);
  if (!estadoDic || estadoDic.aprobado) return `<td class="prom" style="color:#aaa;">-</td>`;

  const estado = estadoCierre2(evaluacionesAlumno);
  let html = "";
  if (estado) {
    for (const ev of estado.temas) {
      const nota      = Number(ev.nota);
      const claseNota = nota >= 6 ? "eval-nota" : "eval-nota eval-nota-roja";
      html += `
        <div class="eval">
          <div class="eval-top">
            <span class="eval-tipo">${escHTML(ev.descripcion || "Tema")}</span>
            <span class="${claseNota}">${escHTML(ev.nota)}</span>
          </div>
          <span class="eval-cierre-badge feb">Febrero</span>
          ${puedeEscribir()
            ? `<button onclick="eliminarEvaluacion(${Number(ev.id)}, ${Number(alumno.id)})">Eliminar</button>`
            : ""}
        </div>`;
    }
    html += renderResumenCierreHTML(estado);
  }
  return `<td class="prom">${html}</td>`;
}

// ─── Carga principal ──────────────────────────────────────────────────────────

async function cargar() {
  try {
    const res = await apiFetch(`/planilla/${cursoMateriaId}/${localStorage.getItem("id")}`);
    if (!res) return;
    if (!res.ok) { mostrarMensaje("No pudimos cargar la planilla. Recargá la página e intentá de nuevo.", "error"); return; }

    const data = await res.json();

    document.getElementById("materiaTitulo").textContent = data.materia.materia;
    document.getElementById("materiaInfo").textContent =
      `${data.materia.anio}° ${data.materia.division} • ${data.materia.dias} • ${data.materia.horario}`;

    tbody.innerHTML    = "";
    alumnosGlobales    = data.alumnos;
    evaluacionesGlobal = data.notas;

    if (puedeEscribir()) {
      document.getElementById("globalForm").style.display          = "block";
      document.getElementById("btnDescargarPlantilla").style.display = "inline-flex";
      document.getElementById("btnImportarExcel").style.display     = "inline-flex";
      renderGlobales();
    } else {
      document.getElementById("globalForm").style.display = "none";
    }

    const alumnosParaDic = [];
    const alumnosParaFeb = [];

    for (const alumno of data.alumnos) {
      const evAlumno = data.notas.filter(n => n.alumno_id == alumno.id);

      const cuat1 = calcularCuatrimestre(evAlumno, 1, 2);
      const cuat2 = calcularCuatrimestre(evAlumno, 3, 4);

      const habilitarCierres = necesitaCierres(cuat1, cuat2);

      const estadoDic = estadoCierre1(evAlumno);
      const estadoFeb = estadoCierre2(evAlumno);

      if (habilitarCierres) {
        // IDs de adeudados ya evaluados en diciembre (cierre=1 con evaluacion_origen_id)
        const evaluadosEnDic = new Set(
          evAlumno
            .filter(e => Number(e.cierre) === 1 && e.evaluacion_origen_id != null)
            .map(e => Number(e.evaluacion_origen_id))
        );

        // Temas del bimestre con nota baja que AÚN no fueron evaluados en diciembre
        const adeudados = temasAdeudados(evAlumno).filter(e => !esCierre(e));
        const pendientesDic = adeudados.filter(e => !evaluadosEnDic.has(Number(e.id)));

        if (pendientesDic.length > 0) {
          alumnosParaDic.push({ alumno, adeudados: pendientesDic });
        }

        // Febrero: solo si hay temas de diciembre que salieron mal
        if (estadoDic && !estadoDic.aprobado) {
          const temasDesap = estadoDic.temas.filter(e => Number(e.nota) < 6);
          if (temasDesap.length > 0 && (!estadoFeb || !estadoFeb.aprobado)) {
            alumnosParaFeb.push({ alumno, desapDic: temasDesap });
          }
        }
      }

      const nfOverride = notaOverrideCampo(evAlumno, "nf");
      let final;
      let claseNotaFinal = "prom";

      if (nfOverride !== null) {
        final = formatearNotaNum(nfOverride);
      } else if (estadoFeb) {
        final = estadoFeb.aprobado ? estadoFeb.promedio.toFixed(2) : "PREVIA";
      } else if (estadoDic) {
        // Solo dar nota final si todos los adeudados ya tienen evaluación en diciembre
        // (no quedan pendientes sin evaluar)
        const evaluadosEnDic2 = new Set(
          evAlumno
            .filter(e => Number(e.cierre) === 1 && e.evaluacion_origen_id != null)
            .map(e => Number(e.evaluacion_origen_id))
        );
        const adeudadosTotales = temasAdeudados(evAlumno).filter(e => !esCierre(e));
        const quedanPendientes = adeudadosTotales.some(e => !evaluadosEnDic2.has(Number(e.id)));
        if (!quedanPendientes && estadoDic.aprobado) {
          final = estadoDic.promedio.toFixed(2);
        } else {
          final = "-";
        }
      } else if (!habilitarCierres) {
        const nums = [cuat1, cuat2].filter(n => n !== "-" && n !== "DESAPROBADO").map(Number);
        final = nums.length > 0
          ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)
          : "-";
      } else {
        final = "-";
      }

      if (final === "PREVIA") claseNotaFinal += " nota-previa";

      const habFeb          = habilitarCierres && estadoDic && !estadoDic.aprobado;
      const ovCq1           = notaOverrideCampo(evAlumno, "cq1") !== null;
      const ovCq2           = notaOverrideCampo(evAlumno, "cq2") !== null;
      const ovNf            = notaOverrideCampo(evAlumno, "nf")  !== null;
      const hayOverride     = ovCq1 || ovCq2 || ovNf;

      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escHTML(alumno.apellido)}, ${escHTML(alumno.nombre)}</td>
        <td>${renderBimestre(evAlumno, alumno, 1)}</td>
        <td>${renderBimestre(evAlumno, alumno, 2)}</td>
        ${renderCeldaCalculada(cuat1, ovCq1, alumno.id)}
        <td>${renderBimestre(evAlumno, alumno, 3)}</td>
        <td>${renderBimestre(evAlumno, alumno, 4)}</td>
        ${renderCeldaCalculada(cuat2, ovCq2, alumno.id)}
        ${renderCeldaCierre1(evAlumno, alumno, habilitarCierres)}
        ${renderCeldaCierre2(evAlumno, alumno, habFeb)}
        ${renderCeldaCalculada(final, ovNf, alumno.id, claseNotaFinal)}
      `;
      tbody.appendChild(row);
    }

    if (puedeEscribir()) {
      renderFormularioCierres(alumnosParaDic, alumnosParaFeb);
    }

  } catch (err) {
    console.error("Error al cargar planilla:", err);
    alert("Error de conexión al cargar la planilla.");
  }
}

// ─── Eliminar evaluación ──────────────────────────────────────────────────────

async function eliminarEvaluacion(evaluacionId, alumnoId) {
  if (!puedeEscribir()) return;
  try {
    const res = await apiFetch("/planilla/evaluacion/" + evaluacionId, {
      method: "DELETE",
      body: JSON.stringify({ alumnoId, cursoMateriaId })
    });
    if (!res) return;
    if (!res.ok) { const err = await res.json(); alert(err.error || "Error al eliminar."); return; }
    cargar();
  } catch (err) {
    console.error("Error al eliminar evaluación:", err);
    mostrarMensaje("No nos pudimos conectar para eliminar la evaluación.", "error");
  }
}

// ─── Liberar override (nota congelada desde Excel) ────────────────────────────

async function liberarOverride(alumnoId) {
  if (!puedeEscribir()) return;
  try {
    const res = await apiFetch(`/planilla/override/${alumnoId}`, {
      method: "DELETE",
      body: JSON.stringify({ cursoMateriaId })
    });
    if (!res) return;
    if (!res.ok) { const err = await res.json(); alert(err.error || "Error al liberar."); return; }
    cargar();
  } catch (err) {
    console.error("Error al liberar override:", err);
    alert("Error de conexión al liberar.");
  }
}

function renderCeldaCalculada(valor, tieneOverride, alumnoId, extraClase = "") {
  const esDesap = valor === "DESAPROBADO";
  const estilo  = esDesap ? ' style="color:#dc2626;font-weight:bold;"' : "";
  const btn     = (tieneOverride && puedeEscribir())
    ? `<button class="btn-liberar-override" title="Liberar nota fija (volver al cálculo automático)"
         onclick="liberarOverride(${alumnoId})">🔓</button>`
    : "";
  const clase = extraClase ? `prom ${extraClase}`.trim() : "prom";
  return `<td class="${clase}"${estilo}>${escHTML(valor)}${btn}</td>`;
}

// ─── Formulario de evaluaciones regulares ────────────────────────────────────

function renderGlobales() {
  const contenedor = document.getElementById("globalAlumnos");
  contenedor.innerHTML = "";
  for (const alumno of alumnosGlobales) {
    const div   = document.createElement("div");
    div.classList.add("alumno-global");
    const span  = document.createElement("span");
    span.textContent = `${alumno.apellido}, ${alumno.nombre}`;
    const input = document.createElement("input");
    input.type = "number"; input.min = "1"; input.max = "10";
    input.step = "0.01"; input.placeholder = "Nota";
    input.id   = `nota-${alumno.id}`;
    div.appendChild(span);
    div.appendChild(input);
    contenedor.appendChild(div);
  }
  actualizarInputsNota();
}

function actualizarInputsNota() {
  const tipo     = document.getElementById("globalTipo").value;
  const esPartic = esParticipacion(tipo);
  for (const alumno of alumnosGlobales) {
    const input = document.getElementById(`nota-${alumno.id}`);
    if (!input) continue;
    if (esPartic) {
      input.min = "0"; input.max = "1"; input.step = "1"; input.placeholder = "0 o 1";
      if (input.value !== "" && input.value !== "0" && input.value !== "1") input.value = "";
    } else {
      input.min = "1"; input.max = "10"; input.step = "0.01"; input.placeholder = "Nota";
      if (input.value === "0" || input.value === "1") input.value = "";
    }
  }
}

async function guardarGlobal() {
  if (!puedeEscribir()) return;

  const descripcion = document.getElementById("globalDescripcion").value.trim();
  const tipo        = document.getElementById("globalTipo").value;
  const bimestre    = document.getElementById("globalBimestre").value;

  if (!descripcion) { mostrarMensaje("Escribí de qué se trata la evaluación (por ejemplo: 'Examen unidad 3') antes de guardar.", "error"); return; }

  const esAcumulativo    = document.getElementById("globalEsAcumulativo").checked;
  let evaluacionOrigenId = null;

  if (esAcumulativo) {
    const sel = document.getElementById("globalEvaluacionOrigen");
    evaluacionOrigenId = sel ? parseInt(sel.value, 10) : null;
    if (!evaluacionOrigenId || isNaN(evaluacionOrigenId)) {
      mostrarMensaje("Elegí a qué evaluación anterior corresponde esta recuperación.", "error"); return;
    }
  }

  const notas = [];
  for (const alumno of alumnosGlobales) {
    const notaInput = document.getElementById(`nota-${alumno.id}`);
    if (notaInput.value === "") continue;
    let valor = Number(notaInput.value);
    if (esParticipacion(tipo)) {
      if (valor !== 0 && valor !== 1) { mostrarMensaje("Para participación solo se puede cargar 0 (no sumó) o 1 (sí sumó).", "error"); return; }
      if (valor === 0) continue;
      if      (tipo.includes("+1"))   valor =  1;
      else if (tipo.includes("+0.5")) valor =  0.5;
      else if (tipo.includes("-0.5")) valor = -0.5;
    }
    notas.push({ alumnoId: alumno.id, nota: valor });
  }

  if (notas.length === 0) { mostrarMensaje("Cargá la nota de al menos un alumno antes de guardar.", "error"); return; }

  try {
    const res = await apiFetch("/planilla/evaluacion-global", {
      method: "POST",
      body: JSON.stringify({ cursoMateriaId, descripcion, tipo, bimestre, notas, esAcumulativo, evaluacionOrigenId })
    });
    if (!res) return;
    if (!res.ok) { const err = await res.json(); mostrarMensaje(err.error || "No se pudo eliminar esa evaluación. Probá de nuevo.", "error"); return; }
    document.getElementById("globalDescripcion").value = "";
    cargar();
  } catch (err) {
    console.error("Error al guardar evaluación global:", err);
    mostrarMensaje("No nos pudimos conectar con el servidor. Revisá tu conexión e intentá de nuevo.", "error");
  }
}

function actualizarSelectOrigen() {
  const contenedor = document.getElementById("origenContenedor");
  const checkbox   = document.getElementById("globalEsAcumulativo");
  if (!checkbox.checked) { contenedor.style.display = "none"; return; }

  const vistas       = new Set();
  const evalsPrevias = [];
  for (const ev of evaluacionesGlobal) {
    if (!vistas.has(Number(ev.id)) && !esCierre(ev)) {
      vistas.add(Number(ev.id));
      evalsPrevias.push(ev);
    }
  }

  if (evalsPrevias.length === 0) {
    contenedor.style.display = "none";
    checkbox.checked = false;
    mostrarMensaje("Todavía no cargaste ninguna evaluación anterior en esta materia, así que no hay ninguna para marcar como recuperada.", "info");
    return;
  }

  const sel = document.getElementById("globalEvaluacionOrigen");
  sel.innerHTML = "";
  for (const ev of evalsPrevias) {
    const opt = document.createElement("option");
    opt.value = ev.id;
    opt.textContent = `[B${ev.bimestre ?? "-"}] ${ev.descripcion || ev.tipo || "sin descripción"}`;
    sel.appendChild(opt);
  }
  contenedor.style.display = "block";
}

// ─── Formulario de cierres ────────────────────────────────────────────────────

function renderFormularioCierres(alumnosParaDic, alumnosParaFeb) {
  const contenedor = document.getElementById("cierreForm");

  if (alumnosParaDic.length === 0 && alumnosParaFeb.length === 0) {
    contenedor.style.display = "none";
    return;
  }

  contenedor.style.display = "block";

  if (cierreActivo === 1 && alumnosParaDic.length === 0) cierreActivo = 2;
  if (cierreActivo === 2 && alumnosParaFeb.length === 0) cierreActivo = 1;

  contenedor.innerHTML = `
    <h2>Cierres administrativos</h2>
    <p class="cierre-subtitulo">
      1er Cierre (Diciembre): seleccioná el alumno y el tema que adeuda.<br>
      2do Cierre (Febrero): seleccioná el alumno y el tema que salió mal en diciembre.
    </p>
    <div class="cierre-tabs">
      <button class="cierre-tab ${cierreActivo === 1 ? "activo" : ""}" id="tabDic"
        onclick="cambiarTabCierre(1)" ${alumnosParaDic.length === 0 ? "disabled" : ""}>
        1er Cierre — Diciembre
        ${alumnosParaDic.length > 0 ? `<span class="cierre-badge-count">${alumnosParaDic.length}</span>` : ""}
      </button>
      <button class="cierre-tab ${cierreActivo === 2 ? "activo" : ""}" id="tabFeb"
        onclick="cambiarTabCierre(2)" ${alumnosParaFeb.length === 0 ? "disabled" : ""}>
        2do Cierre — Febrero
        ${alumnosParaFeb.length > 0 ? `<span class="cierre-badge-count">${alumnosParaFeb.length}</span>` : ""}
      </button>
    </div>
    <div id="cierreContenido"></div>
  `;

  contenedor._alumnosParaDic = alumnosParaDic;
  contenedor._alumnosParaFeb = alumnosParaFeb;

  renderContenidoCierre();
}

function renderContenidoCierre() {
  const el      = document.getElementById("cierreContenido");
  const cf      = document.getElementById("cierreForm");
  const paraDic = cf._alumnosParaDic || [];
  const paraFeb = cf._alumnosParaFeb || [];
  if (!el) return;

  if (cierreActivo === 1) {
    renderContenidoDic(el, paraDic);
  } else {
    renderContenidoFeb(el, paraFeb);
  }
}

function renderContenidoDic(el, alumnosParaDic) {
  if (alumnosParaDic.length === 0) {
    el.innerHTML = `<p class="sin-pendientes">No hay alumnos con temas pendientes para diciembre.</p>`;
    return;
  }

  el.innerHTML = `
    <div class="cierre-fila">
      <select id="dicSelAlumno" onchange="actualizarTemasDic()">
        <option value="">— Seleccioná un alumno —</option>
        ${alumnosParaDic.map(({ alumno }) =>
          `<option value="${alumno.id}">${escHTML(alumno.apellido)}, ${escHTML(alumno.nombre)}</option>`
        ).join("")}
      </select>
      <select id="dicSelTema">
        <option value="">— Seleccioná un tema —</option>
      </select>
      <input type="number" id="dicNota" min="1" max="10" step="0.01" placeholder="Nota (1-10)">
      <button onclick="guardarCierreDic()">Guardar</button>
    </div>
  `;
  el._alumnosParaDic = alumnosParaDic;
}

function actualizarTemasDic() {
  const alumnoId = Number(document.getElementById("dicSelAlumno").value);
  const selTema  = document.getElementById("dicSelTema");
  const el       = document.getElementById("cierreContenido");
  const paraDic  = el._alumnosParaDic || [];

  selTema.innerHTML = `<option value="">— Seleccioná un tema —</option>`;
  if (!alumnoId) return;

  const entrada = paraDic.find(({ alumno }) => Number(alumno.id) === alumnoId);
  if (!entrada) return;

  for (const tema of entrada.adeudados) {
    const opt = document.createElement("option");
    opt.value = Number(tema.id);
    const bim = tema.bimestre ? `B${tema.bimestre}` : (tema.cierre ? `Cierre ${tema.cierre}` : "");
    opt.textContent = `[${bim}] ${tema.descripcion || tema.tipo || "sin descripción"} — nota: ${tema.nota}`;
    selTema.appendChild(opt);
  }
}

function temasAdeudados(evaluacionesAlumno) {
  const saldadas = calcularSaldadas(evaluacionesAlumno);
  return evaluacionesAlumno.filter(ev => {
    if (String(ev.descripcion || "").startsWith("Import override:")) return false;
    if (saldadas.has(Number(ev.id))) return false;
    if (Number(ev.nota) >= 6) return false;
    if (esParticipacion(ev.tipo)) return false;
    return true;
  });
}

async function guardarCierreDic() {
  if (!puedeEscribir()) return;

  const alumnoId     = Number(document.getElementById("dicSelAlumno").value);
  const evaluacionId = Number(document.getElementById("dicSelTema").value);
  const nota         = Number(document.getElementById("dicNota").value);

  if (!alumnoId)     { mostrarMensaje("Elegí primero el alumno.", "error"); return; }
  if (!evaluacionId) { mostrarMensaje("Elegí qué tema rindió el alumno.", "error"); return; }
  if (isNaN(nota) || nota < 1 || nota > 10) { mostrarMensaje("La nota tiene que ser un número entre 1 y 10.", "error"); return; }

  try {
    const res = await apiFetch("/planilla/cierre-tema", {
      method: "PATCH",
      body: JSON.stringify({ evaluacionId, alumnoId, cursoMateriaId, nota, numeroCierre: 1 })
    });
    if (!res) return;
    if (!res.ok) { const err = await res.json(); mostrarMensaje(err.error || "No se pudo eliminar esa evaluación. Probá de nuevo.", "error"); return; }
    cargar();
  } catch (err) {
    console.error("Error al guardar cierre diciembre:", err);
    mostrarMensaje("No nos pudimos conectar con el servidor. Revisá tu conexión e intentá de nuevo.", "error");
  }
}

function renderContenidoFeb(el, alumnosParaFeb) {
  if (alumnosParaFeb.length === 0) {
    el.innerHTML = `<p class="sin-pendientes">No hay alumnos con temas pendientes para febrero.</p>`;
    return;
  }

  el.innerHTML = `
    <div class="cierre-fila">
      <select id="febSelAlumno" onchange="actualizarTemasFeb()">
        <option value="">— Seleccioná un alumno —</option>
        ${alumnosParaFeb.map(({ alumno }) =>
          `<option value="${alumno.id}">${escHTML(alumno.apellido)}, ${escHTML(alumno.nombre)}</option>`
        ).join("")}
      </select>
      <select id="febSelTema">
        <option value="">— Seleccioná un tema —</option>
      </select>
      <input type="number" id="febNota" min="1" max="10" step="0.01" placeholder="Nota (1-10)">
      <button onclick="guardarCierreFeb()">Guardar</button>
    </div>
  `;
  el._alumnosParaFeb = alumnosParaFeb;
}

function actualizarTemasFeb() {
  const alumnoId = Number(document.getElementById("febSelAlumno").value);
  const selTema  = document.getElementById("febSelTema");
  const el       = document.getElementById("cierreContenido");
  const paraFeb  = el._alumnosParaFeb || [];

  selTema.innerHTML = `<option value="">— Seleccioná un tema —</option>`;
  if (!alumnoId) return;

  const entrada = paraFeb.find(({ alumno }) => Number(alumno.id) === alumnoId);
  if (!entrada) return;

  for (const tema of entrada.desapDic) {
    const opt = document.createElement("option");
    opt.value = Number(tema.id);
    opt.textContent = `${tema.descripcion || "Tema"} — nota dic: ${tema.nota}`;
    selTema.appendChild(opt);
  }
}

async function guardarCierreFeb() {
  if (!puedeEscribir()) return;

  const alumnoId     = Number(document.getElementById("febSelAlumno").value);
  const evaluacionId = Number(document.getElementById("febSelTema").value);
  const nota         = Number(document.getElementById("febNota").value);

  if (!alumnoId)     { mostrarMensaje("Elegí primero el alumno.", "error"); return; }
  if (!evaluacionId) { mostrarMensaje("Elegí qué tema rindió el alumno.", "error"); return; }
  if (isNaN(nota) || nota < 1 || nota > 10) { mostrarMensaje("La nota tiene que ser un número entre 1 y 10.", "error"); return; }

  try {
    const res = await apiFetch("/planilla/cierre-tema", {
      method: "PATCH",
      body: JSON.stringify({ evaluacionId, alumnoId, cursoMateriaId, nota, numeroCierre: 2 })
    });
    if (!res) return;
    if (!res.ok) { const err = await res.json(); mostrarMensaje(err.error || "No se pudo eliminar esa evaluación. Probá de nuevo.", "error"); return; }
    cargar();
  } catch (err) {
    console.error("Error al guardar cierre febrero:", err);
    mostrarMensaje("No nos pudimos conectar con el servidor. Revisá tu conexión e intentá de nuevo.", "error");
  }
}

function cambiarTabCierre(numero) {
  cierreActivo = numero;
  const tabDic = document.getElementById("tabDic");
  const tabFeb = document.getElementById("tabFeb");
  if (tabDic) tabDic.classList.toggle("activo", numero === 1);
  if (tabFeb) tabFeb.classList.toggle("activo", numero === 2);
  renderContenidoCierre();
}

// ─── IMPORTACIÓN DESDE EXCEL ─────────────────────────────────────────────────

/**
 * Descarga una plantilla Excel con las columnas correctas y los alumnos
 * actuales de la planilla pre-cargados para que el profesor solo tenga
 * que completar las notas.
 */
async function descargarPlantilla() {
  if (!puedeEscribir()) return;

  const btn = document.getElementById("btnDescargarPlantilla");
  if (btn) { btn.disabled = true; btn.textContent = "Generando..."; }

  try {
    const token = localStorage.getItem("token");
    const res   = await fetch(`/planilla/plantilla/${cursoMateriaId}`, {
      headers: { "Authorization": "Bearer " + token }
    });

    if (!res.ok) {
      let msg = `Error del servidor (${res.status})`;
      try {
        const txt = await res.text();
        if (!txt.startsWith("<")) {
          const json = JSON.parse(txt);
          msg = json.error || msg;
        }
      } catch (_) {}
      alert("Error al generar la plantilla: " + msg);
      return;
    }

    // Disparar la descarga del archivo
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");

    const cd    = res.headers.get("Content-Disposition") || "";
    const match = cd.match(/filename="(.+?)"/);
    a.download  = match ? match[1] : "Plantilla.xlsx";

    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

  } catch (err) {
    console.error("Error al descargar plantilla:", err);
    alert("Error de conexión al descargar la plantilla.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Descargar plantilla"; btn.style.display = "inline-flex"; }
    const icon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>`;
    if (btn) btn.innerHTML = icon + " Descargar plantilla";
  }
}

// ─── IMPORTAR DESDE EXCEL ─────────────────────────────────────────────────────

// Columnas del Excel que se mapean a períodos importables.
// Normalizadas: sin acentos, minúsculas, sin asteriscos ni paréntesis.
const MAPA_COLUMNAS_PERIODO = {
  "1er bimestre":       "b1",
  "primer bimestre":    "b1",
  "2do bimestre":       "b2",
  "segundo bimestre":   "b2",
  "3er bimestre":       "b3",
  "tercer bimestre":    "b3",
  "4to bimestre":       "b4",
  "cuarto bimestre":    "b4",
  "1er cierre":         "c1",
  "1er cierre dic":     "c1",
  "cierre diciembre":   "c1",
  "2do cierre":         "c2",
  "2do cierre feb":     "c2",
  "cierre febrero":     "c2",
  // Overrides: el valor importado prevalece sobre el cálculo automático
  "1er cuatrimestre":   "cq1",
  "primer cuatrimestre": "cq1",
  "2do cuatrimestre":   "cq2",
  "segundo cuatrimestre": "cq2",
  "nota final":         "nf",
};

const COLUMNAS_IGNORAR = new Set([
  // (vacío: ya no hay columnas que se ignoren silenciosamente)
]);

function normalizarCol(str) {
  return String(str || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*★\s*/g, " ")
    .replace(/[().]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function esFilaEncabezado(celdas) {
  const norms = (celdas || []).map(c => normalizarCol(c));
  const tieneApellidoNombre = norms.includes("apellido") && norms.includes("nombre");
  return tieneApellidoNombre || norms.includes("alumno");
}

function matrizAFilasObjeto(matriz) {
  if (!matriz || matriz.length === 0) {
    return { error: "El archivo está vacío o no tiene datos." };
  }

  let headerIdx = -1;
  for (let i = 0; i < matriz.length; i++) {
    if (esFilaEncabezado(matriz[i])) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    return {
      error: 'No se encontraron columnas de identificación del alumno.\nEl archivo debe tener "Apellido" y "Nombre" (o una columna "Alumno").\nUsá "Descargar plantilla" para obtener el formato correcto.'
    };
  }

  const headers = (matriz[headerIdx] || []).map(c => String(c == null ? "" : c).trim());
  const rows = [];

  for (let i = headerIdx + 1; i < matriz.length; i++) {
    const celdas = matriz[i] || [];
    const primera = String(celdas[0] || "").trim();
    if (primera.startsWith("★") || primera.toLowerCase().includes("columnas calculadas")) continue;
    if (celdas.every(c => c === null || c === undefined || String(c).trim() === "")) continue;

    const obj = {};
    headers.forEach((h, col) => {
      if (!h) return;
      obj[h] = celdas[col] === undefined ? null : celdas[col];
    });
    rows.push(obj);
  }

  return { rows };
}

function parsearFilasExcel(rows) {
  if (!rows || rows.length === 0) {
    return { error: "El archivo está vacío o no tiene datos." };
  }

  const colsOriginales = Object.keys(rows[0]);
  const colsNorm       = colsOriginales.map(normalizarCol);

  const tieneApellido      = colsNorm.some(c => c === "apellido");
  const tieneNombre        = colsNorm.some(c => c === "nombre");
  const tieneAlumno        = colsNorm.some(c => c === "alumno");
  const tieneApellidoNombre = tieneApellido && tieneNombre;

  if (!tieneApellidoNombre && !tieneAlumno) {
    return { error: 'No se encontraron columnas de identificación del alumno.\nEl archivo debe tener "Apellido" y "Nombre" (o una columna "Alumno").\nUsá "Descargar plantilla" para obtener el formato correcto.' };
  }

  // Mapear columnas de notas
  const mapaColumnasFila   = {}; // nombreOriginal → key (b1…c2)
  const noReconocidas      = [];

  for (const colOrig of colsOriginales) {
    const norm = normalizarCol(colOrig);
    if (["apellido", "nombre", "alumno"].includes(norm)) continue;
    if (COLUMNAS_IGNORAR.has(norm)) continue;

    const key = MAPA_COLUMNAS_PERIODO[norm];
    if (key) {
      mapaColumnasFila[colOrig] = key;
    } else {
      noReconocidas.push(colOrig);
    }
  }

  if (Object.keys(mapaColumnasFila).length === 0) {
    return { error: "No se encontraron columnas de notas reconocibles.\nColumnas esperadas: 1er Bimestre, 2do Bimestre, 3er Bimestre, 4to Bimestre, 1er Cierre, 2do Cierre.\nUsá \"Descargar plantilla\" para obtener el formato correcto." };
  }

  // Función que obtiene un valor de fila de forma case+accent insensitive
  function obtenerVal(row, nombreBuscado) {
    const normBuscado = normalizarCol(nombreBuscado);
    for (const [k, v] of Object.entries(row)) {
      if (normalizarCol(k) === normBuscado) return v;
    }
    return undefined;
  }

  function parsearNombre(row) {
    if (tieneApellidoNombre) {
      return {
        apellido: String(obtenerVal(row, "apellido") || "").trim(),
        nombre:   String(obtenerVal(row, "nombre")   || "").trim()
      };
    }
    const alumnoStr = String(obtenerVal(row, "alumno") || "").trim();
    if (!alumnoStr) return { apellido: "", nombre: "" };
    if (alumnoStr.includes(",")) {
      const p = alumnoStr.split(",").map(s => s.trim());
      return { apellido: p[0] || "", nombre: p[1] || "" };
    }
    const p = alumnoStr.split(/\s+/);
    return p.length === 1
      ? { apellido: p[0], nombre: "" }
      : { apellido: p[p.length - 1], nombre: p.slice(0, -1).join(" ") };
  }

  const filas = [];

  for (const row of rows) {
    const { apellido, nombre } = parsearNombre(row);
if (!apellido && !nombre) continue;

const dni = String(obtenerVal(row, "dni") || "").trim();

const fila = { apellido, nombre, dni };

    for (const [colOrig, key] of Object.entries(mapaColumnasFila)) {
      const v = row[colOrig];
      if (v === null || v === undefined || v === "") { fila[key] = null; continue; }

      const s = String(v).trim().toUpperCase();
      if (["-", "DESAPROBADO", "PREVIA", "N/A", ""].includes(s)) { fila[key] = null; continue; }

      const n = Number(v);
      fila[key] = (!isNaN(n) && n >= 0 && n <= 10) ? n : null;
    }

    filas.push(fila);
  }

  if (filas.length === 0) {
    return { error: "No se encontraron alumnos con datos válidos en el archivo." };
  }

  return { filas, noReconocidas };
}

async function importarExcel(event) {
  if (!puedeEscribir()) return;

  const file = event.target.files[0];
  event.target.value = "";

  if (!file) return;

  if (typeof XLSX === "undefined") {
    alert("Error: SheetJS no cargó. Verificá tu conexión a internet y recargá la página.");
    return;
  }

  const panel = document.getElementById("importResultado");
  panel.style.display = "block";
  panel.innerHTML     = `<div class="import-cargando">Leyendo el archivo…</div>`;

  const reader = new FileReader();

  reader.onerror = () => {
    panel.innerHTML = `<div class="import-cargando" style="color:#dc2626;">No se pudo leer el archivo.</div>`;
  };

  reader.onload = async function (e) {
    try {
      const data     = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const sheet    = workbook.Sheets[workbook.SheetNames[0]];
      const matriz   = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      const convertido = matrizAFilasObjeto(matriz);

      if (convertido.error) {
        panel.innerHTML = `
          <div class="import-resultado" style="display:block; border-left-color:#dc2626;">
            <h3>No se pudo procesar el archivo</h3>
            <p style="color:#dc2626;font-size:13.5px;white-space:pre-line;">${escHTML(convertido.error)}</p>
            <button class="import-cerrar-btn" onclick="document.getElementById('importResultado').style.display='none'">Cerrar</button>
          </div>`;
        return;
      }

      const parseado = parsearFilasExcel(convertido.rows);

      if (parseado.error) {
        panel.innerHTML = `
          <div class="import-resultado" style="display:block; border-left-color:#dc2626;">
            <h3>No se pudo procesar el archivo</h3>
            <p style="color:#dc2626;font-size:13.5px;white-space:pre-line;">${escHTML(parseado.error)}</p>
            <button class="import-cerrar-btn" onclick="document.getElementById('importResultado').style.display='none'">Cerrar</button>
          </div>`;
        return;
      }

      let advertencia = "";
      if (parseado.noReconocidas && parseado.noReconocidas.length > 0) {
        advertencia += `<p style="color:#a16207;font-size:12.5px;margin-bottom:12px;">
          ⚠️ Columnas ignoradas (no reconocidas): <strong>${escHTML(parseado.noReconocidas.join(", "))}</strong>
        </p>`;
      }

      panel.innerHTML = `<div class="import-cargando">Importando ${parseado.filas.length} alumnos…</div>`;

      // ── Enviar al backend ──
      const token = localStorage.getItem("token");
      let res;
      try {
        res = await fetch(`/planilla/importar/${cursoMateriaId}`, {
          method:  "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": "Bearer " + token
          },
          body: JSON.stringify({ filas: parseado.filas })
        });
      } catch (fetchErr) {
        panel.innerHTML = `<div class="import-cargando" style="color:#dc2626;">Error de red: ${escHTML(fetchErr.message)}</div>`;
        return;
      }

      // ── Parsear respuesta como texto primero ──
      const textoRespuesta = await res.text();
      let resultado;
      try {
        resultado = JSON.parse(textoRespuesta);
      } catch (_) {
        const esHTML = textoRespuesta.trim().startsWith("<");
        panel.innerHTML = `
          <div class="import-resultado" style="display:block; border-left-color:#dc2626;">
            <h3>Error del servidor (${res.status})</h3>
            <p style="color:#dc2626;font-size:13.5px;">
              ${esHTML
                ? "El servidor no reconoció el endpoint de importación.<br>Asegurate de que el servidor esté actualizado y reinicialo con <code>pm2 restart gestion-notas</code> o <code>npm start</code>."
                : escHTML(textoRespuesta.slice(0, 300))
              }
            </p>
            <button class="import-cerrar-btn" onclick="document.getElementById('importResultado').style.display='none'">Cerrar</button>
          </div>`;
        return;
      }

      if (!resultado.success) {
        panel.innerHTML = `
          <div class="import-resultado" style="display:block; border-left-color:#dc2626;">
            <h3>Error al importar</h3>
            <p style="color:#dc2626;">${escHTML(resultado.error)}</p>
            <button class="import-cerrar-btn" onclick="document.getElementById('importResultado').style.display='none'">Cerrar</button>
          </div>`;
        return;
      }

      mostrarResultadoImportacion(resultado, advertencia);
      cargar(); // recargar la planilla

    } catch (err) {
      console.error("Error al importar Excel:", err);
      panel.innerHTML = `<div class="import-cargando" style="color:#dc2626;">Error inesperado: ${escHTML(err.message)}</div>`;
    }
  };

  reader.readAsArrayBuffer(file);
}

function mostrarResultadoImportacion(resultado, advertencia = "") {
  const panel = document.getElementById("importResultado");
  const { resumen, detalle } = resultado;

  let statsHTML = `<div class="import-stats">`;
  if (resumen.bimestresImportados > 0)
    statsHTML += `<span class="import-stat stat-ok">✓ ${resumen.bimestresImportados} notas importadas</span>`;
  if (resumen.bimestresOmitidos > 0)
    statsHTML += `<span class="import-stat stat-skip">— ${resumen.bimestresOmitidos} omitidas (ya existían)</span>`;
  if (resumen.estudiantesNuevos > 0)
    statsHTML += `<span class="import-stat stat-new">+ ${resumen.estudiantesNuevos} alumnos creados</span>`;
  statsHTML += `</div>`;

  let filasHTML = `<div class="import-filas">`;
  for (const fila of detalle) {
    const claseEstado = fila.estado === "creado" ? "nuevo-fila"
                      : fila.estado === "error"  ? "error-fila"
                      : "ok-fila";
    const badgeLabel  = fila.estado === "creado" ? "Nuevo" : fila.estado === "encontrado" ? "Encontrado" : "Error";
    const badgeClase  = fila.estado === "creado" ? "badge-nuevo" : fila.estado === "encontrado" ? "badge-encontrado" : "badge-error";

    filasHTML += `<div class="import-fila ${claseEstado}">`;
    filasHTML += `<div class="import-fila-nombre">${escHTML(fila.alumno)} <span class="import-fila-badge ${badgeClase}">${badgeLabel}</span></div>`;

    if (fila.estado === "creado")
      filasHTML += `<div class="import-fila-creds">usuario: <strong>${escHTML(fila.usuarioCreado)}</strong> &nbsp;|&nbsp; contraseña temporal: <strong>${escHTML(fila.passwordTemporal)}</strong></div>`;

    if (fila.error)
      filasHTML += `<div class="import-fila-info" style="color:#dc2626;">${escHTML(fila.error)}</div>`;

    if (fila.notasImportadas && fila.notasImportadas.length > 0)
      filasHTML += `<div class="import-fila-info">✓ ${fila.notasImportadas.map(escHTML).join(" &nbsp;·&nbsp; ")}</div>`;

    if (fila.notasOmitidas && fila.notasOmitidas.length > 0)
      filasHTML += `<div class="import-fila-info" style="color:#a16207;">— ${fila.notasOmitidas.map(escHTML).join(" &nbsp;·&nbsp; ")}</div>`;

    filasHTML += `</div>`;
  }
  filasHTML += `</div>`;

  panel.innerHTML = `
    <div class="import-resultado" style="display:block;">
      <h3>Importación completada — ${resumen.totalFilas} alumno${resumen.totalFilas !== 1 ? "s" : ""} procesado${resumen.totalFilas !== 1 ? "s" : ""}</h3>
      ${advertencia}${statsHTML}${filasHTML}
      ${resumen.estudiantesNuevos > 0 ? `
        <p style="margin-top:12px;font-size:12.5px;color:#1d4ed8;background:#eff4ff;padding:10px 14px;border-radius:8px;">
          💡 <strong>Alumnos nuevos creados</strong> con contraseñas temporales individuales indicadas arriba. Deben cambiarlas al primer ingreso. Comunicales sus credenciales.
        </p>` : ""}
      <button class="import-cerrar-btn" onclick="document.getElementById('importResultado').style.display='none'">Cerrar</button>
    </div>`;
}

// ─── Event listeners ──────────────────────────────────────────────────────────

document.getElementById("globalTipo").addEventListener("change", actualizarInputsNota);

cargar();
initAyuda({
  porRol: {
    profesor: "Cargá notas con 'Carga global de notas' para todo el curso de una vez. Si un alumno desaprobó un tema y después lo recuperó, tildá 'evaluación acumulativa' y elegí la nota vieja: el sistema la reemplaza sin borrar el historial. Los 'Cierres administrativos' aparecen solos cuando un alumno necesita rendir en diciembre o febrero.",
    alumno: "Cada columna es un período del año. 'DESAPROBADO' significa que ese período no se aprobó. 'PREVIA' quiere decir que hay que rendir la materia fuera de las fechas normales.",
    regente: "Podés cargar o solo mirar notas según tu permiso. Las columnas de 'Cierre' se completan solas cuando un alumno necesita una instancia de recuperación en diciembre o febrero.",
    preceptor: "Esta es la planilla completa de la materia, solo para consultar. No podés cargar ni cambiar ninguna nota desde acá."
  }
});
