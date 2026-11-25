(() => {
 if(!localStorage.getItem('token')){location.href='index.html';return;}
 if(localStorage.getItem('rango')!=='regente'){location.href='dashboard.html';return;}
 const selector=document.getElementById('cicloPeriodo'),lista=document.getElementById('listaPeriodos'),estado=document.getElementById('estadoPeriodos');
 let version=0,ocupado=false;
 function mensaje(texto,error=false){estado.textContent=texto;estado.dataset.error=String(error);}
 async function cargar(){
  const solicitud=++version;lista.replaceChildren();mensaje('Cargando períodos…');
  try{
   const r=await apiFetch('/periodos/'+selector.value);if(!r)return;const data=await r.json();if(solicitud!==version)return;if(!r.ok)throw Error(data.error);
   mensaje(data.cerrado?'El ciclo está cerrado. Sus períodos son de solo lectura.':'');
   for(const p of data.periodos){
    const card=document.createElement('section');card.className='card';
    const titulo=document.createElement('h2');titulo.textContent=p.nombre;card.append(titulo);
    const status=document.createElement('p');status.className='periodo-estado';status.textContent=p.habilitado?'Habilitado':p.modo==='programado'?(data.hoy<p.desde?'Programado · todavía no comenzó':'Finalizado · bloqueado'):'Bloqueado';card.append(status);
    const form=document.createElement('form');
    form.innerHTML='<label>Funcionamiento<select name="modo"><option value="programado">Programar por fechas</option><option value="bloqueado">Bloqueado</option></select></label><label>Desde<input type="date" name="desde" required></label><label>Hasta (inclusive)<input type="date" name="hasta" required></label><div class="periodo-acciones"><button class="generar-btn" type="submit">Guardar período</button></div>';
    const modo=form.elements.modo,desde=form.elements.desde,hasta=form.elements.hasta;
    modo.value=p.modo==='bloqueado'?'bloqueado':'programado';desde.value=p.desde||'';hasta.value=p.hasta||'';
    const readonly=data.cerrado||!data.permiteEscritura;
    function ajustar(){desde.disabled=hasta.disabled=readonly||modo.value!=='programado';hasta.min=desde.value;desde.max=hasta.value;}
    modo.onchange=ajustar;desde.onchange=hasta.onchange=ajustar;
    if(readonly)form.querySelectorAll('input,select,button').forEach(c=>c.disabled=true);ajustar();
    async function guardar(payload){
     if(ocupado||readonly)return;ocupado=true;selector.disabled=true;lista.querySelectorAll('button').forEach(b=>b.disabled=true);
     try{const respuesta=await apiFetch('/periodos/'+data.cicloLectivo+'/'+p.cierre,{method:'PUT',body:JSON.stringify(payload)});if(!respuesta)return;const resultado=await respuesta.json();if(!respuesta.ok)throw Error(resultado.error);await cargar();mensaje('Período de '+p.nombre.toLowerCase()+' guardado para todos los cursos del ciclo '+data.cicloLectivo+'.');}
     catch(e){mensaje(e.message,true);}finally{ocupado=false;selector.disabled=false;lista.querySelectorAll('button').forEach(b=>b.disabled=readonly);}
    }
    form.onsubmit=e=>{e.preventDefault();guardar({modo:modo.value,desde:desde.value,hasta:hasta.value});};
    card.append(form);lista.append(card);
   }
  }catch(e){mensaje(e.message,true);}
 }
 selector.onchange=()=>{sessionStorage.setItem('cicloLectivo',selector.value);cargar();};
 (async()=>{try{const r=await apiFetch('/ciclos');if(!r)return;const data=await r.json();if(!r.ok)throw Error(data.error);for(const ciclo of data.ciclos)selector.add(new Option(ciclo.anio+(ciclo.cerrado?' · Cerrado':''),ciclo.anio));const elegido=sessionStorage.getItem('cicloLectivo');selector.value=data.ciclos.some(c=>String(c.anio)===elegido)?elegido:String((data.ciclos.find(c=>c.activo)||data.ciclos[0]).anio);await cargar();}catch(e){mensaje(e.message,true);}})();
})();
