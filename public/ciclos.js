function cicloQuery() {
  const anio = sessionStorage.getItem("cicloLectivo");
  return anio ? `?ciclo=${encodeURIComponent(anio)}` : "";
}
const ciclosReady = (async () => {
  const host = document.getElementById("container") || document.querySelector(".container");
  if (!host) return;
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:0 0 24px;padding:16px;background:white;border:1px solid #ddd;border-radius:12px;color:#222";
  bar.innerHTML = '<label for="selectCicloLectivo">Ciclo lectivo</label><select id="selectCicloLectivo" style="padding:8px;border:1px solid #ccc;border-radius:8px"></select><span id="estadoCiclo"></span>';
  host.prepend(bar);
  if (['regente', 'preceptor'].includes(localStorage.getItem('rango'))) {
    const estadisticasLink = document.createElement('a'); estadisticasLink.href='estadisticas.html';estadisticasLink.textContent='Estadísticas';bar.appendChild(estadisticasLink);
  }
  if (localStorage.getItem("rango") === "regente") {
    const link = document.createElement("a"); link.href="ciclos.html";link.textContent="Administrar ciclos";bar.appendChild(link);
    const cursosLink = document.createElement("a"); cursosLink.href="estructura.html";cursosLink.textContent="Cursos y materias";bar.appendChild(cursosLink);
  }
  try {
    const res=await apiFetch("/ciclos"); if(!res)return;
    const data=await res.json(); if(!res.ok)throw new Error(data.error);
    const select=document.getElementById("selectCicloLectivo");
    for(const ciclo of data.ciclos) select.add(new Option(`${ciclo.anio}${ciclo.activo ? " · actual" : ""}${ciclo.cerrado ? " · cerrado" : ""}`,ciclo.anio));
    const saved=sessionStorage.getItem("cicloLectivo");
    select.value=String((data.ciclos.find(c=>String(c.anio)===saved)||data.ciclos.find(c=>c.activo)||data.ciclos[0]).anio);
    function update() {
      window.cicloSeleccionado=data.ciclos.find(c=>String(c.anio)===select.value);
      sessionStorage.setItem("cicloLectivo",select.value);
      document.getElementById("estadoCiclo").textContent=window.cicloSeleccionado.cerrado?"Solo lectura":"Abierto";
    }
    update();
    select.addEventListener("change",()=>{update();document.dispatchEvent(new Event("ciclochange"));});
  } catch(err) {document.getElementById("estadoCiclo").textContent="No pudimos cargar los ciclos. Recargá la página.";}
})();
if(location.pathname.endsWith("usuarios.html")) {
  const protect=()=>{
    const closed=window.cicloSeleccionado?.cerrado;
    if(!closed)return;
    for(const button of document.querySelectorAll('#vista [data-accion],#btnMostrarFormAlumno'))button.disabled=true;
    for(const form of document.querySelectorAll('#vista .form-container,#panelFormAlumno'))form.hidden=true;
  };
  new MutationObserver(protect).observe(document.getElementById("vista"),{childList:true,subtree:true});
  ciclosReady.then(protect);
}
