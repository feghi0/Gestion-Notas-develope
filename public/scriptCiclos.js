if(!localStorage.getItem("token"))location.href="index.html";
if(localStorage.getItem("rango")!=="regente")location.href="dashboard.html";
let cicloBusy=false;
async function cargarCiclos() {
  const res=await apiFetch("/ciclos");if(!res)return;
  const data=await res.json();if(!res.ok)throw new Error(data.error);
  const list=document.getElementById("listaCiclos");list.replaceChildren();
  const select=document.getElementById("copiarCiclo");select.replaceChildren(new Option("Sin copiar cursos",""));
  for(const ciclo of data.ciclos) {
    select.add(new Option(String(ciclo.anio),ciclo.anio));
    const row=document.createElement("div");row.style.cssText="padding:16px 0;border-bottom:1px solid #ddd;display:flex;flex-wrap:wrap;gap:10px;align-items:center";
    const label=document.createElement("strong");label.textContent=`${ciclo.anio} · ${ciclo.cerrado?"Cerrado":"Abierto"}${ciclo.activo?" · Actual":""}`;row.appendChild(label);
    for(const [accion,title] of [["activar","Establecer actual"],[ciclo.cerrado?"reabrir":"cerrar",ciclo.cerrado?"Reabrir":"Cerrar ciclo"]]) {
      if(accion==="activar"&&(ciclo.activo||ciclo.cerrado))continue;
      const button=document.createElement("button");button.textContent=title;button.type="button";button.addEventListener("click",()=>cambiarCiclo(ciclo.anio,accion));row.appendChild(button);
    }
    list.appendChild(row);
  }
  select.value=String((data.ciclos.find(c=>c.activo)||data.ciclos[0]).anio);
  if(!document.getElementById("nuevoAnio").value)document.getElementById("nuevoAnio").value=Math.max(...data.ciclos.map(c=>c.anio))+1;
}
async function operar(url,body) {
  if(cicloBusy)return;
  cicloBusy=true;
  for(const button of document.querySelectorAll("button"))button.disabled=true;
  try {
    const res=await apiFetch(url,{method:"POST",body:JSON.stringify(body||{})});if(!res)return;
    const data=await res.json();if(!res.ok)throw new Error(data.error);
    document.getElementById("estadoCiclos").textContent="Cambio guardado correctamente.";
    await cargarCiclos();
  } catch(err) {document.getElementById("estadoCiclos").textContent=err.message;}
  finally {cicloBusy=false;for(const button of document.querySelectorAll("button"))button.disabled=false;}
}
async function cambiarCiclo(anio,accion) {
  if(accion==="cerrar"&&!confirm(`¿Cerrar el ciclo ${anio}? Se conservará toda la información y solo se permitirán consultas hasta que lo reabras.`))return;
  await operar(`/ciclos/${anio}/${accion}`);
}
document.getElementById("crearCiclo").addEventListener("submit",async event=>{
  event.preventDefault();const anio=Number(document.getElementById("nuevoAnio").value);const source=document.getElementById("copiarCiclo").value;
  await operar("/ciclos",{anio,...(source?{copiarDe:Number(source)}:{})});
});
cargarCiclos().catch(err=>document.getElementById("estadoCiclos").textContent=err.message);
