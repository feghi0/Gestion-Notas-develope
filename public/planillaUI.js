(() => {
 const scroll=document.querySelector('.table-scroll'),table=document.getElementById('tablaPlanilla');
 const proxy=document.createElement('div');proxy.className='scroll-planilla-fijo';proxy.tabIndex=0;proxy.setAttribute('aria-label','Desplazamiento horizontal de la planilla');proxy.innerHTML='<div></div>';document.body.append(proxy);
 scroll.addEventListener('scroll',()=>{proxy.scrollLeft=scroll.scrollLeft;});proxy.addEventListener('scroll',()=>{scroll.scrollLeft=proxy.scrollLeft;});
 const ajustar=()=>{proxy.firstChild.style.width=table.scrollWidth+'px';};new ResizeObserver(ajustar).observe(table);
 new IntersectionObserver(([entry])=>proxy.hidden=!entry.isIntersecting).observe(scroll);
 const colapsados=new Set();
 function columnas(){for(const el of table.querySelectorAll('[data-bimestre]'))el.classList.toggle('bimestre-colapsado',colapsados.has(el.dataset.bimestre));for(const b of table.querySelectorAll('[data-toggle]')){const cerrado=colapsados.has(b.dataset.toggle);b.textContent=cerrado?'B'+b.dataset.toggle+' +':'Ocultar';b.setAttribute('aria-expanded',String(!cerrado));}ajustar();}
 table.addEventListener('click',e=>{const boton=e.target.closest('[data-toggle]');if(boton){const n=boton.dataset.toggle;colapsados.has(n)?colapsados.delete(n):colapsados.add(n);columnas();}});
 const dialog=document.createElement('dialog');dialog.className='detalle-nota-dialog';dialog.innerHTML=`<form id="detalleNotaForm"><h2>Detalle de calificación</h2><p>El tema, fecha, tipo y obligatoriedad pertenecen a la evaluación y afectan a todos sus alumnos. La nota y observaciones son individuales.</p><label>Tema<input id="detalleTema" maxlength="500" required></label><label>Fecha<input id="detalleFecha" type="date" required></label><label>Tipo<input id="detalleTipo" maxlength="100" required></label><label>Bimestre<select id="detalleBimestre"><option>1</option><option>2</option><option>3</option><option>4</option></select></label><label><input id="detalleObligatoria" type="checkbox">Obligatoria</label><label>Calificación<select id="detalleModo"><option value="">Numérica</option><option value="EN_PROCESO">En proceso</option></select></label><label>Nota<input id="detalleValor" type="number" min="1" max="10" step="0.01"></label><label>Observaciones individuales<textarea id="detalleObservaciones" maxlength="2000"></textarea></label><p id="detalleError" role="alert"></p><div><button type="submit" id="detalleGuardar">Guardar cambios</button><button type="button" id="detalleCancelar">Cerrar</button></div></form>`;document.body.append(dialog);
 function habilitarRecuperaciones(){
  const activo=document.getElementById('globalEsAcumulativo').checked,origenId=Number(document.getElementById('globalEvaluacionOrigen').value),fecha=fechaCargaEvaluacion(),bimestre=Number(document.getElementById('globalBimestre').value);
  const original=evaluacionesGlobal.find(e=>Number(e.id)===origenId),selector=document.getElementById('globalBimestre');
  for(const o of selector.options)o.disabled=bloqueada(o.value)||(activo&&original&&Number(o.value)<Number(original.bimestre));
  selector.title=activo&&original?'La acumulativa debe pertenecer al bimestre '+original.bimestre+' o posterior.':'';
  if(selector.selectedOptions[0]?.disabled){selector.value=[...selector.options].find(o=>!o.disabled)?.value||'';}
  for(const a of alumnosGlobales){const input=document.getElementById('nota-'+a.id);if(!input)continue;const origen=evaluacionesGlobal.find(e=>Number(e.id)===origenId&&Number(e.alumno_id)===Number(a.id));const error=activo?ReglasAcademicas.puedeRecuperar(origen,a.id,fecha,0,Number(selector.value)):null;input.disabled=!!error;input.title=error||'';if(error)input.value='';}
 }
 for(const id of ['globalEsAcumulativo','globalEvaluacionOrigen','globalBimestre'])document.getElementById(id).addEventListener('change',()=>setTimeout(habilitarRecuperaciones,0));
 const campo=id=>document.getElementById(id);let seleccion=null,cierres=[];
 const bloqueada=b=>cierres.some(c=>c.cerrado&&(c.bimestre===0||Number(c.bimestre)===Number(b)));
 campo('detalleCancelar').onclick=()=>dialog.close();campo('detalleModo').onchange=()=>campo('detalleValor').disabled=!!campo('detalleModo').value;
 window.editarNota=(_boton,id,alumno)=>{
  seleccion=evaluacionesGlobal.find(e=>Number(e.id)===Number(id)&&Number(e.alumno_id)===Number(alumno));if(!seleccion)return;
  const e=seleccion;const bloqueoPeriodo=bloqueoPeriodoRecuperacion(e.cierre);const editable=puedeEscribir()&&!bloqueada(e.bimestre)&&!bloqueoPeriodo;campo('detalleTema').value=e.descripcion||'';campo('detalleFecha').value=String(e.fecha||'').slice(0,10);campo('detalleTipo').value=e.tipo||'';campo('detalleBimestre').value=e.bimestre||1;campo('detalleObligatoria').checked=e.obligatoria;campo('detalleModo').value=e.nota_conceptual||'';campo('detalleValor').value=e.nota??'';campo('detalleObservaciones').value=e.observaciones||'';campo('detalleError').textContent=bloqueoPeriodo||'';
  dialog.querySelectorAll('input,select,textarea').forEach(x=>x.disabled=!editable);campo('detalleBimestre').disabled=!editable||!!Number(e.cierre);campo('detalleGuardar').hidden=!editable;campo('detalleValor').min=esParticipacion(e.tipo)?0:1;campo('detalleValor').max=esParticipacion(e.tipo)?1:10;campo('detalleValor').disabled=!editable||!!e.nota_conceptual;dialog.showModal();
 };
 table.addEventListener('click',e=>{if(e.target.closest('button'))return;const ev=e.target.closest('[data-evaluacion]');if(ev)window.editarNota(ev,ev.dataset.evaluacion,ev.dataset.alumno);});
 campo('detalleNotaForm').onsubmit=async event=>{
  event.preventDefault();if(!puedeEscribir()||!seleccion)return;const e=seleccion,concepto=campo('detalleModo').value||null;
  const error=bloqueoPeriodoRecuperacion(e.cierre,campo('detalleFecha').value)||(concepto?null:ReglasAcademicas.validarNota(campo('detalleValor').value,campo('detalleTipo').value));
  if(error){campo('detalleError').textContent=error;return;}
  campo('detalleGuardar').disabled=true;
  try{const res=await apiFetch('/planilla/evaluacion/'+e.id,{method:'PATCH',body:JSON.stringify({alumnoId:e.alumno_id,cursoMateriaId,nota:concepto?null:Number(campo('detalleValor').value),notaConceptual:concepto,notaAnterior:e.nota,notaRevision:e.nota_revision,evaluacionRevision:e.evaluacion_revision,descripcion:campo('detalleTema').value,fecha:campo('detalleFecha').value,tipo:campo('detalleTipo').value,bimestre:Number(e.bimestre?campo('detalleBimestre').value:0)||null,obligatoria:campo('detalleObligatoria').checked,observaciones:campo('detalleObservaciones').value})});if(!res)return;const data=await res.json();if(!res.ok)throw Error(data.error);dialog.close();await cargar();}catch(err){campo('detalleError').textContent=err.message;}finally{campo('detalleGuardar').disabled=false;}
 };
 const periodos=document.createElement('section');periodos.className='control-cierre';document.getElementById('tableContainer').before(periodos);
 function renderPeriodos(data){
  const config=data.recuperaciones;if(!config){periodos.hidden=true;return;}
  periodos.hidden=false;periodos.replaceChildren();
  const titulo=document.createElement('h2');titulo.textContent='Períodos de recuperación — Ciclo '+config.cicloLectivo;periodos.append(titulo);
  const info=document.createElement('p');info.textContent='Esta configuración se aplica a todos los cursos del ciclo. Automático: diciembre en diciembre y febrero en febrero, según la hora de Buenos Aires. Las decisiones manuales se mantienen hasta cambiarlas o volver a automático.';periodos.append(info);
  for(const p of config.periodos){
   const fila=document.createElement('div'),estado=document.createElement('span');estado.textContent=p.nombre+': '+(p.habilitado?'Habilitado':'Bloqueado')+' ('+p.modo+'). ';fila.append(estado);
   if(data.user.rango==='regente'&&puedeEscribir()){
    for(const [modo,texto] of [['habilitado','Habilitar'],['bloqueado','Bloquear'],['automatico','Volver a automático']]){
     const boton=document.createElement('button');boton.type='button';boton.textContent=texto;boton.disabled=p.modo===modo;boton.setAttribute('aria-label',texto+' '+p.nombre);
     boton.onclick=async()=>{fila.querySelectorAll('button').forEach(b=>b.disabled=true);try{const r=await apiFetch('/planilla/periodos-recuperacion/'+cursoMateriaId+'/'+p.cierre,{method:'PATCH',body:JSON.stringify({modo})});if(!r)return;const d=await r.json();if(!r.ok)throw Error(d.error);await cargar();}catch(e){estado.textContent=e.message;fila.querySelectorAll('button').forEach(b=>b.disabled=b===boton&&p.modo===modo);}};fila.append(boton);
    }
   }
   periodos.append(fila);
  }
 }
 const cierre=document.createElement('div');cierre.className='control-cierre';document.getElementById('tableContainer').before(cierre);
 window.actualizarUXPlanilla=data=>{
  renderPeriodos(data);cierres=data.cierres||[];columnas();habilitarRecuperaciones();
  document.querySelectorAll("#globalBimestre option").forEach(o=>o.disabled=bloqueada(o.value));
  document.querySelectorAll("#globalForm input,#globalForm select,#globalForm button").forEach(el=>{if(cierres.some(c=>c.cerrado&&c.bimestre===0))el.disabled=true;});cierre.hidden=data.user.rango!=='regente'||!puedeEscribir();cierre.innerHTML='<label>Instancia de cierre <select id="instanciaAcademica"><option value="0">Materia completa</option>'+[1,2,3,4].map(b=>`<option value="${b}">Bimestre ${b}</option>`).join('')+'</select></label><button id="cerrarAcademico">Cerrar instancia</button><button id="abrirAcademico">Reabrir instancia</button><p id="estadoCierreAcademico" role="status"></p>';
  for(const [id,cerrado] of [['cerrarAcademico',true],['abrirAcademico',false]])campo(id).onclick=async()=>{const b=Number(campo('instanciaAcademica').value);campo('estadoCierreAcademico').textContent='Guardando…';try{const res=await apiFetch('/planilla/cierre-academico/'+cursoMateriaId,{method:'POST',body:JSON.stringify({bimestre:b,cerrado})});if(!res)return;const d=await res.json();if(!res.ok)throw Error(d.error);await cargar();campo('estadoCierreAcademico').textContent='Instancia '+(cerrado?'cerrada':'reabierta')+'.';}catch(e){campo('estadoCierreAcademico').textContent=e.message;}};
  campo('estadoCierreAcademico').textContent='Cerrados: '+((data.cierres||[]).filter(c=>c.cerrado).map(c=>c.bimestre?'B'+c.bimestre:'Materia').join(', ')||'ninguno');
 };
 document.getElementById('globalAlumnos').addEventListener('input',e=>{if(e.target.matches('input'))e.target.setCustomValidity(ReglasAcademicas.validarNota(e.target.value,campo('globalTipo').value)||'');});
})();
