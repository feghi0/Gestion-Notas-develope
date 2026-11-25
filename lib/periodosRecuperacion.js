const reglas = require('../public/reglasAcademicas');
const {error} = require('./validacionAcademica');

async function obtenerPeriodos(conn, materiaId) {
 const [curso] = await conn.query('SELECT c.ciclo_lectivo FROM cursos c JOIN curso_materia cm ON cm.curso_id=c.id WHERE cm.id=?',[materiaId]);
 if(!curso) throw error('Materia no encontrada.',404);
 const ajustes=await conn.query('SELECT cierre,modo FROM periodos_recuperacion WHERE ciclo_lectivo=?',[curso.ciclo_lectivo]);
 const ahora=new Date();
 return {cicloLectivo:curso.ciclo_lectivo,periodos:[1,2].map(cierre=>{
  const modo=ajustes.find(a=>Number(a.cierre)===cierre)?.modo||'automatico';
  return {cierre,nombre:cierre===1?'Diciembre':'Febrero',modo,habilitado:!reglas.validarPeriodoDiciembre(cierre,undefined,ahora,modo)};
 })};
}
async function validarPeriodo(conn,materiaId,cierre,fecha) {
 if(![1,2].includes(Number(cierre)))return;
 const {periodos}=await obtenerPeriodos(conn,materiaId);
 const modo=periodos.find(p=>p.cierre===Number(cierre)).modo;
 const mensaje=reglas.validarPeriodoDiciembre(cierre,fecha,new Date(),modo);
 if(mensaje)throw error(mensaje,403);
}
module.exports={obtenerPeriodos,validarPeriodo};
