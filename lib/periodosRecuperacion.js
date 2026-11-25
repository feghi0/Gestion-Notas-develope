const reglas = require('../public/reglasAcademicas');
const {error} = require('./validacionAcademica');

async function obtenerPeriodosCiclo(conn,cicloLectivo) {
 const ajustes=await conn.query('SELECT cierre,modo,desde::text AS desde,hasta::text AS hasta FROM periodos_recuperacion WHERE ciclo_lectivo=?',[cicloLectivo]);
 const ahora=new Date();
 const hoy=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(ahora);
 return {cicloLectivo:Number(cicloLectivo),hoy,periodos:[1,2].map(cierre=>{
  const ajuste=ajustes.find(a=>Number(a.cierre)===cierre)||{modo:'automatico',desde:null,hasta:null};
  return {cierre,nombre:cierre===1?'Diciembre':'Febrero',...ajuste,habilitado:!reglas.validarPeriodoDiciembre(cierre,undefined,ahora,ajuste.modo,ajuste)};
 })};
}
async function obtenerPeriodos(conn, materiaId) {
 const [curso]=await conn.query('SELECT c.ciclo_lectivo FROM cursos c JOIN curso_materia cm ON cm.curso_id=c.id WHERE cm.id=?',[materiaId]);
 if(!curso)throw error('Materia no encontrada.',404);
 return obtenerPeriodosCiclo(conn,curso.ciclo_lectivo);
}
async function guardarPeriodo(conn,{cicloLectivo,cierre,modo,desde,hasta,actorId}) {
 if(![1,2].includes(cierre)||!['automatico','habilitado','bloqueado','programado'].includes(modo))throw error('Configuración de período inválida.');
 if(modo==='programado'){
  if(!reglas.validarFecha(desde)||!reglas.validarFecha(hasta)||desde>hasta)throw error('Indicá fechas válidas: el inicio no puede ser posterior al fin.');
  const [otro]=await conn.query("SELECT cierre,desde::text AS desde,hasta::text AS hasta FROM periodos_recuperacion WHERE ciclo_lectivo=? AND cierre=? AND modo='programado'",[cicloLectivo,cierre===1?2:1]);
  if(otro&&(cierre===1? hasta>=otro.desde:desde<=otro.hasta))throw error('El período de febrero debe comenzar después de que termine diciembre.');
 }else{desde=null;hasta=null;}
 await conn.query(`INSERT INTO periodos_recuperacion(ciclo_lectivo,cierre,modo,desde,hasta,actor_id) VALUES(?,?,?,?,?,?)
 ON CONFLICT(ciclo_lectivo,cierre) DO UPDATE SET modo=EXCLUDED.modo,desde=EXCLUDED.desde,hasta=EXCLUDED.hasta,actor_id=EXCLUDED.actor_id,actualizado_en=clock_timestamp()`,[cicloLectivo,cierre,modo,desde,hasta,actorId]);
}
async function validarPeriodo(conn,materiaId,cierre,fecha) {
 if(![1,2].includes(Number(cierre)))return;
 const {periodos}=await obtenerPeriodos(conn,materiaId);
 const periodo=periodos.find(p=>p.cierre===Number(cierre));
 const mensaje=reglas.validarPeriodoDiciembre(cierre,fecha,new Date(),periodo.modo,periodo);
 if(mensaje)throw error(mensaje,403);
}
module.exports={obtenerPeriodos,obtenerPeriodosCiclo,guardarPeriodo,validarPeriodo};
