(() => {
 const table=document.getElementById('tablaPlanilla');
 const colapsados=new Set();
 function columnas(){for(const el of table.querySelectorAll('[data-bimestre]'))el.classList.toggle('bimestre-colapsado',colapsados.has(el.dataset.bimestre));for(const b of table.querySelectorAll('[data-toggle]')){const cerrado=colapsados.has(b.dataset.toggle);b.textContent=cerrado?'B'+b.dataset.toggle+' +':'Ocultar';b.setAttribute('aria-expanded',String(!cerrado));}}
 table.addEventListener('click',e=>{const boton=e.target.closest('[data-toggle]');if(boton){const n=boton.dataset.toggle;colapsados.has(n)?colapsados.delete(n):colapsados.add(n);columnas();}});
 const dialog=document.createElement('dialog');dialog.className='detalle-nota-dialog';dialog.innerHTML=`<form id="detalleNotaForm"><h2>Detalle de calificación</h2><p>El tema, fecha, tipo y vínculo acumulativo pertenecen a la evaluación y afectan a todos sus alumnos. La nota y observaciones son individuales.</p><label>Tema<input id="detalleTema" maxlength="500" required></label><label>Fecha<input id="detalleFecha" type="date" required></label><label>Tipo<select id="detalleTipo" required></select></label><label>Bimestre<select id="detalleBimestre"><option>1</option><option>2</option><option>3</option><option>4</option></select></label><label>Acumulativa de una evaluación anterior<select id="detalleOrigen"><option value="">Sin acumulativa</option></select></label><label>Calificación<select id="detalleModo"><option value="">Numérica</option><option value="EN_PROCESO">En proceso</option></select></label><label>Nota<input id="detalleValor" type="number" min="1" max="10" step="0.01"></label><label>Observaciones individuales<textarea id="detalleObservaciones" maxlength="2000"></textarea></label><p id="detalleError" role="alert"></p><div><button type="submit" id="detalleGuardar">Guardar cambios</button><button type="button" id="detalleCancelar">Cerrar</button></div></form>`;document.body.append(dialog);
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
  const e=seleccion;const bloqueoPeriodo=bloqueoPeriodoRecuperacion(e.cierre);const editable=puedeEscribir()&&!bloqueada(e.bimestre)&&!bloqueoPeriodo;campo('detalleTema').value=e.descripcion||'';campo('detalleFecha').value=String(e.fecha||'').slice(0,10);campo('detalleTipo').replaceChildren(...[...document.getElementById('globalTipo').options].map(o=>new Option(o.text,o.value)));if(!ReglasAcademicas.TIPOS_EVALUACION.includes(e.tipo))campo('detalleTipo').add(new Option(e.tipo,e.tipo));campo('detalleTipo').value=e.tipo||'';campo('detalleBimestre').value=e.bimestre||1;campo('detalleModo').value=e.nota_conceptual||'';campo('detalleValor').value=e.nota??'';campo('detalleObservaciones').value=e.observaciones||'';campo('detalleError').textContent=bloqueoPeriodo||'';
  dialog.querySelectorAll('input,select,textarea').forEach(x=>x.disabled=!editable);campo('detalleBimestre').disabled=!editable||!!Number(e.cierre);campo('detalleGuardar').hidden=!editable;campo('detalleValor').min=esParticipacion(e.tipo)?0:1;campo('detalleValor').max=esParticipacion(e.tipo)?1:10;campo('detalleValor').disabled=!editable||!!e.nota_conceptual;campo('detalleTipo').disabled=!editable||!!Number(e.cierre);campo('detalleOrigen').dataset.actual=e.evaluacion_origen_id||'';actualizarOrigenDetalle(editable);dialog.showModal();
 };
 function actualizarOrigenDetalle(editable){
  if(!seleccion)return;const e=seleccion,selector=campo('detalleOrigen'),previo=selector.dataset.actual===undefined?selector.value:selector.dataset.actual;
  selector.replaceChildren(new Option('Sin acumulativa',''));
  const unicas=new Map(evaluacionesGlobal.map(ev=>[Number(ev.id),ev]));
  const depende=id=>{const vistos=new Set();while(id){if(Number(id)===Number(e.id)||vistos.has(Number(id)))return true;vistos.add(Number(id));id=unicas.get(Number(id))?.evaluacion_origen_id;}return false;};
  for(const origen of unicas.values()){
   if(depende(origen.id)||esParticipacion(origen.tipo))continue;
   if(Number(e.cierre)===2?Number(origen.cierre)!==1:Number(origen.cierre)!==0)continue;
   const opcion=new Option((origen.bimestre?'B'+origen.bimestre:'Diciembre')+' · '+(origen.descripcion||origen.tipo),origen.id);
   const individuales=evaluacionesGlobal.filter(n=>Number(n.id)===Number(e.id));
   opcion.disabled=individuales.some(n=>ReglasAcademicas.puedeRecuperar(evaluacionesGlobal.find(o=>Number(o.id)===Number(origen.id)&&Number(o.alumno_id)===Number(n.alumno_id)),n.alumno_id,campo('detalleFecha').value,Number(e.cierre||0),Number(campo('detalleBimestre').value)));
   selector.add(opcion);
  }
  selector.value=String(previo);delete selector.dataset.actual;
  selector.disabled=!editable||!!Number(e.cierre)||esParticipacion(campo('detalleTipo').value);
  if(esParticipacion(campo('detalleTipo').value))selector.value='';
 }
 for(const id of ['detalleFecha','detalleBimestre','detalleTipo'])campo(id).addEventListener('change',()=>{
  const editable=puedeEscribir()&&!bloqueada(seleccion?.bimestre)&&!bloqueoPeriodoRecuperacion(seleccion?.cierre);actualizarOrigenDetalle(editable);
  campo('detalleValor').min=esParticipacion(campo('detalleTipo').value)?0:1;campo('detalleValor').max=esParticipacion(campo('detalleTipo').value)?1:10;
 });
 table.addEventListener('click',e=>{if(e.target.closest('button'))return;const ev=e.target.closest('[data-evaluacion]');if(ev)window.editarNota(ev,ev.dataset.evaluacion,ev.dataset.alumno);});
 campo('detalleNotaForm').onsubmit=async event=>{
  event.preventDefault();if(!puedeEscribir()||!seleccion)return;const e=seleccion,concepto=campo('detalleModo').value||null;
  if(campo('detalleOrigen').value&&campo('detalleOrigen').selectedOptions[0]?.disabled){campo('detalleError').textContent='La evaluación original seleccionada no es válida para todos los alumnos o para este bimestre y fecha.';return;}
  const error=bloqueoPeriodoRecuperacion(e.cierre,campo('detalleFecha').value)||(concepto?null:ReglasAcademicas.validarNota(campo('detalleValor').value,campo('detalleTipo').value));
  if(error){campo('detalleError').textContent=error;return;}
  campo('detalleGuardar').disabled=true;
  try{const res=await apiFetch('/planilla/evaluacion/'+e.id,{method:'PATCH',body:JSON.stringify({alumnoId:e.alumno_id,cursoMateriaId,nota:concepto?null:Number(campo('detalleValor').value),notaConceptual:concepto,notaAnterior:e.nota,notaRevision:e.nota_revision,evaluacionRevision:e.evaluacion_revision,descripcion:campo('detalleTema').value,fecha:campo('detalleFecha').value,tipo:campo('detalleTipo').value,bimestre:Number(e.bimestre?campo('detalleBimestre').value:0)||null,evaluacionOrigenId:campo('detalleOrigen').value?Number(campo('detalleOrigen').value):null,observaciones:campo('detalleObservaciones').value})});if(!res)return;const data=await res.json();if(!res.ok)throw Error(data.error);dialog.close();await cargar();}catch(err){campo('detalleError').textContent=err.message;}finally{campo('detalleGuardar').disabled=false;}
 };
 window.actualizarUXPlanilla=data=>{
  cierres=data.cierres||[];columnas();habilitarRecuperaciones();
  document.querySelectorAll('#globalBimestre option').forEach(o=>o.disabled=bloqueada(o.value));
  document.querySelectorAll('#globalForm input,#globalForm select,#globalForm button').forEach(el=>{if(cierres.some(c=>c.cerrado&&c.bimestre===0))el.disabled=true;});
 };
 document.getElementById('globalAlumnos').addEventListener('input',e=>{if(e.target.matches('input'))e.target.setCustomValidity(ReglasAcademicas.validarNota(e.target.value,campo('globalTipo').value)||'');});
})();
