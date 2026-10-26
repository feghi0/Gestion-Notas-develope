// ─── api.js ───────────────────────────────────────────────────────────────────
// Funciones compartidas por todas las páginas.

// ─── Sanitización XSS ───────────────────────────────────────────────────────

function formatearTurno(turno) {
  const valor = String(turno || '').trim();
  return { manana: 'Mañana', tarde: 'Tarde', noche: 'Noche' }[valor.toLowerCase()] || valor;
}

function escHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Pedidos autenticados al servidor ───────────────────────────────────────

async function apiFetch(url, options = {}) {
  const token = localStorage.getItem("token");
  const cicloAlSolicitar = sessionStorage.getItem("cicloLectivo");

  const config = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...(token ? { "Authorization": "Bearer " + token } : {})
    }
  };

  try {
    const res = await fetch(url, config);

    if (res.status === 401) {
      localStorage.clear();
      mostrarMensaje("Tu sesión venció. Iniciá sesión de nuevo.", "info");
      setTimeout(() => { location.href = "index.html"; }, 1200);
      return null;
    }
    if ((!options.method || options.method === "GET") && cicloAlSolicitar !== sessionStorage.getItem("cicloLectivo")) return null;
    return res;
  } catch (err) {
    console.error("Error de red:", err);
    mostrarMensaje("No nos pudimos conectar con el servidor. Revisá tu conexión a internet.", "error");
    return null;
  }
}

// ─── Mensajes al usuario (reemplaza alert()) ────────────────────────────────
// tipo: "error" | "exito" | "info"
// El texto siempre debe decir qué pasó Y qué hacer al respecto.

function mostrarMensaje(texto, tipo = "info") {
  let contenedor = document.getElementById("mensajesContenedor");
  if (!contenedor) {
    contenedor = document.createElement("div");
    contenedor.id = "mensajesContenedor";
    contenedor.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 9999;
      display: flex; flex-direction: column; gap: 10px;
      max-width: 360px; width: calc(100% - 40px);
    `;
    document.body.appendChild(contenedor);
  }

  const colores = {
    error: { bg: "#fef2f2", borde: "#dc2626", texto: "#991b1b", icono: "✕" },
    exito: { bg: "#ecfdf3", borde: "#16a34a", texto: "#15803d", icono: "✓" },
    info:  { bg: "#eff4ff", borde: "#2563eb", texto: "#1d4ed8", icono: "i" }
  };
  const c = colores[tipo] || colores.info;

  const tarjeta = document.createElement("div");
  tarjeta.style.cssText = `
    background:${c.bg}; border-left:4px solid ${c.borde}; color:${c.texto};
    padding:14px 16px; border-radius:10px; font-family:"Inter",sans-serif;
    font-size:13.5px; line-height:1.5; box-shadow:0 8px 24px rgba(0,0,0,.12);
    display:flex; gap:10px; align-items:flex-start; animation: mensajeIn .25s ease both;
  `;
  tarjeta.innerHTML = `
    <span style="font-weight:800;flex-shrink:0;">${c.icono}</span>
    <span style="flex:1;">${escHTML(texto)}</span>
    <span style="cursor:pointer;font-weight:700;opacity:.5;flex-shrink:0;" onclick="this.parentElement.remove()">✕</span>
  `;

  if (!document.getElementById("mensajesKeyframes")) {
    const style = document.createElement("style");
    style.id = "mensajesKeyframes";
    style.textContent = `@keyframes mensajeIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}`;
    document.head.appendChild(style);
  }

  contenedor.appendChild(tarjeta);

  setTimeout(() => {
    tarjeta.style.transition = "opacity .3s ease, transform .3s ease";
    tarjeta.style.opacity = "0";
    tarjeta.style.transform = "translateX(20px)";
    setTimeout(() => tarjeta.remove(), 300);
  }, tipo === "error" ? 7000 : 4500);
}

// ─── Ícono de ayuda contextual ───────────────────────────────────────────────
// Cada página llama a initAyuda(config) una sola vez. El botón "?" siempre
// aparece en el mismo lugar (abajo a la derecha) para ser predecible.
//
// config = {
//   general: "texto por defecto si no hay uno específico para el rol",
//   porRol: { profesor: "...", alumno: "...", regente: "...", preceptor: "...", secretario: "..." }
// }

function initAyuda(config) {
  const rango = localStorage.getItem("rango");
  const texto = (config.porRol && config.porRol[rango]) || config.general || "No hay ayuda para esta pantalla todavía.";

  const btn = document.createElement("button");
  btn.setAttribute("aria-label", "Ayuda");
  btn.textContent = "?";
  btn.style.cssText = `
    position:fixed; bottom:22px; right:22px; z-index:9998;
    width:48px; height:48px; border-radius:50%; border:none;
    background:linear-gradient(145deg,#1a1a1a,#0a0a0a); color:white;
    font-size:20px; font-weight:800; font-family:"Inter",sans-serif;
    cursor:pointer; box-shadow:0 8px 20px rgba(10,10,10,.3);
    transition:transform .15s ease;
  `;
  btn.onmouseenter = () => btn.style.transform = "scale(1.08)";
  btn.onmouseleave = () => btn.style.transform = "scale(1)";

  const panel = document.createElement("div");
  panel.style.cssText = `
    position:fixed; bottom:82px; right:22px; z-index:9998;
    max-width:300px; width:calc(100% - 44px);
    background:white; border-radius:14px; padding:18px 20px;
    box-shadow:0 16px 40px rgba(10,10,10,.18); border:1px solid #eef0f2;
    font-family:"Inter",sans-serif; font-size:13px; line-height:1.6; color:#374151;
    display:none;
  `;
  panel.innerHTML = `
    <div style="font-weight:800;color:#0a0a0a;margin-bottom:8px;font-size:13.5px;">💡 Ayuda para esta pantalla</div>
    <div>${texto}</div>
  `;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });
  document.addEventListener("click", (e) => {
    if (!panel.contains(e.target) && e.target !== btn) panel.style.display = "none";
  });

  document.body.appendChild(panel);
  document.body.appendChild(btn);
}
