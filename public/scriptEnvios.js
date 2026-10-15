const nombresEstadoEnvio = {
  pendiente: "Pendiente", enviando: "En proceso", enviado: "Enviado", fallido: "Fallido",
  incierto: "Requiere revisión", sin_email: "Sin email válido"
};
let enviandoBoletines = false;
let cursorEnvios = null;
let consultaEnvios = 0;

async function pedidoEnvios(url, post = false, body) {
  const response = await apiFetch(url, post ? { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) } : {});
  if (!response) throw new Error("No se pudo completar la consulta. Revisá el estado de los envíos.");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "No pudimos actualizar los envíos.");
  return data;
}

function mostrarEnvios(data, append = false) {
  const rows = document.getElementById("filasEnvios");
  if (!append) rows.replaceChildren();
  for (const envio of data.envios) {
    const row = document.createElement("tr");
    const values = [`${envio.alumno_nombre} · ${envio.periodo}`, envio.destinatario || "Sin email registrado",
      nombresEstadoEnvio[envio.estado], envio.intentos,
      new Date(envio.actualizado_en).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })];
    const labels = ["Alumno / período", "Destinatario", "Estado", "Intentos", "Actualización"];
    values.forEach((value, index) => {
      const cell = document.createElement("td"); cell.textContent = value; cell.dataset.label = labels[index];
      if (index === 2) {
        cell.className = `envio-${envio.estado}`;
        if (envio.error) { const detail = document.createElement("small"); detail.textContent = envio.error; cell.appendChild(detail); }
      }
      row.appendChild(cell);
    });
    const action = document.createElement("td"); action.dataset.label = "Acción";
    if (envio.estado === "fallido") {
      const button = document.createElement("button"); button.textContent = "Reintentar";
      button.type = "button"; button.disabled = enviandoBoletines;
      button.addEventListener("click", () => reintentarEnvio(envio.id)); action.appendChild(button);
    } else if (envio.estado === "incierto") {
      const detail = document.createElement("small");
      detail.textContent = `Buscá en Gmail: rfc822msgid:${envio.message_id || "(sin referencia)"}`;
      action.appendChild(detail);
      for (const [decision, label] of [["enviado", "Confirmar enviado"], ["no_enviado", "Confirmar no enviado"]]) {
        const button = document.createElement("button"); button.type = "button"; button.textContent = label;
        button.disabled = enviandoBoletines;
        button.addEventListener("click", () => resolverEnvio(envio.id, decision)); action.appendChild(button);
      }
    }
    else if (envio.estado === "sin_email") action.textContent = "Corregir el email y volver a generar";
    row.appendChild(action); rows.appendChild(row);
  }
  const summary = document.getElementById("resumenEnvios"); summary.replaceChildren();
  for (const [state, label] of Object.entries(nombresEstadoEnvio)) {
    const item = document.createElement("span"); item.textContent = `${label}: ${data.resumen[state] || 0}`; summary.appendChild(item);
  }
  document.getElementById("modoEnvios").textContent = data.testing
    ? `Modo de prueba: todos los boletines se envían únicamente a ${data.testing}.`
    : "Los correos se envían a las direcciones registradas del alumno y familiar.";
  document.getElementById("continuarEnvios").disabled = enviandoBoletines || !data.resumen.pendiente;
  cursorEnvios = data.siguiente;
  document.getElementById("masEnvios").hidden = !cursorEnvios;
  document.getElementById("estadoEnvios").textContent = data.envios.length || append
    ? `Registros mostrados: ${rows.children.length}. Horario de Buenos Aires.`
    : "No hay envíos registrados con este filtro. Descargar un ZIP sin marcar el envío no manda correos.";
}

async function cargarEstadoEnvios(append = false) {
  const curso = document.getElementById("selectCurso").value;
  if (!curso) return;
  const query = new URLSearchParams();
  const state = document.getElementById("filtroEnvios").value;
  if (state) query.set("estado", state);
  if (append && cursorEnvios) query.set("antes", cursorEnvios);
  const ticket = ++consultaEnvios;
  try {
    const data = await pedidoEnvios(`/boletines/envios/${curso}?${query}`);
    if (ticket === consultaEnvios) mostrarEnvios(data, append);
  } catch (err) { if (ticket === consultaEnvios) document.getElementById("estadoEnvios").textContent = err.message; }
}

function bloquearEnvios(busy) {
  enviandoBoletines = busy;
  for (const id of ["selectCurso", "checkEnviarMails", "generarBtn", "continuarEnvios", "actualizarEnvios", "filtroEnvios", "masEnvios"]) document.getElementById(id).disabled = busy;
  for (const button of document.querySelectorAll("#filasEnvios button")) button.disabled = busy;
}

async function procesarPendientes(curso) {
  // Solicitudes pequeñas: al cerrar esta pantalla, los pendientes se conservan.
  let pendientes = true;
  while (pendientes) {
    document.getElementById("estadoEnvios").textContent = "Procesando correos pendientes… Podés consultar el resultado de cada alumno debajo.";
    const data = await pedidoEnvios(`/boletines/envios/${curso}/procesar`, true);
    mostrarEnvios(data);
    pendientes = data.procesados > 0 && data.resumen.pendiente > 0;
  }
}

async function prepararYEnviar(curso) {
  if (enviandoBoletines) return;
  bloquearEnvios(true);
  try {
    document.getElementById("estadoEnvios").textContent = "Preparando correos. Los boletines enviados anteriormente se omiten.";
    mostrarEnvios(await pedidoEnvios(`/boletines/envios/${curso}/preparar`, true));
    await procesarPendientes(curso);
  } finally { bloquearEnvios(false); await cargarEstadoEnvios(); }
}

async function continuarEnvios() {
  const curso = document.getElementById("selectCurso").value;
  if (!curso || enviandoBoletines) return;
  bloquearEnvios(true);
  try { await procesarPendientes(curso); }
  catch (err) { document.getElementById("estado").textContent = err.message; }
  finally { bloquearEnvios(false); await cargarEstadoEnvios(); }
}

async function reintentarEnvio(id) {
  if (enviandoBoletines) return;
  bloquearEnvios(true);
  try { mostrarEnvios(await pedidoEnvios(`/boletines/envio/${id}/reintentar`, true)); }
  catch (err) { document.getElementById("estado").textContent = err.message; }
  finally { bloquearEnvios(false); await cargarEstadoEnvios(); }
}

async function resolverEnvio(id, decision) {
  if (enviandoBoletines) return;
  const message = decision === "enviado"
    ? "¿Revisaste Gmail y confirmás que este boletín ya se envió? Se marcará como enviado sin mandar otro correo."
    : "¿Revisaste Gmail y confirmás que este boletín NO se envió? Se habilitará el reintento; una confirmación incorrecta podría duplicar el correo.";
  if (!window.confirm(message)) return;
  bloquearEnvios(true);
  try { await pedidoEnvios(`/boletines/envio/${id}/resolver`, true, { decision }); }
  catch (err) { document.getElementById("estado").textContent = err.message; }
  finally { bloquearEnvios(false); await cargarEstadoEnvios(); }
}

document.getElementById("selectCurso").addEventListener("change", () => {
  ++consultaEnvios; cursorEnvios = null;
  document.getElementById("filasEnvios").replaceChildren();
  document.getElementById("resumenEnvios").replaceChildren();
  document.getElementById("modoEnvios").textContent = "";
  document.getElementById("masEnvios").hidden = true;
  document.getElementById("continuarEnvios").disabled = true;
  document.getElementById("estadoEnvios").textContent = "Seleccioná un curso para consultar sus envíos.";
  cargarEstadoEnvios();
});
document.getElementById("filtroEnvios").addEventListener("change", () => cargarEstadoEnvios());
document.getElementById("actualizarEnvios").addEventListener("click", () => cargarEstadoEnvios());
document.getElementById("masEnvios").addEventListener("click", () => cargarEstadoEnvios(true));
document.getElementById("continuarEnvios").addEventListener("click", continuarEnvios);
