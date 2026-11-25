const router=require('express').Router();
const pool=require('../db/connection');
const auth=require('../middleware/auth');
const {obtenerCiclo}=require('../lib/ciclosLectivos');
const {obtenerPeriodosCiclo,guardarPeriodo}=require('../lib/periodosRecuperacion');
const {error}=require('../lib/validacionAcademica');
router.use(auth,(req,res,next)=>{
 if(req.user.rango!=='regente')return res.status(403).json({success:false,error:'Solo el regente puede administrar los períodos.'});
 next();
});
router.get('/:anio',async(req,res)=>{
 let conn;try{
  conn=await pool.getConnection();const ciclo=await obtenerCiclo(conn,req.params.anio);
  res.json({success:true,cerrado:ciclo.cerrado,permiteEscritura:req.user.permiso!=='lectura',...await obtenerPeriodosCiclo(conn,ciclo.anio)});
 }catch(e){res.status(e.status||500).json({success:false,error:e.status?e.message:'No pudimos consultar los períodos.'});}finally{if(conn)conn.release();}
});
router.put('/:anio/:cierre',async(req,res)=>{
 let conn;try{
  if(req.user.permiso==='lectura')throw error('Sin permiso de escritura.',403);
  conn=await pool.getConnection();await conn.beginTransaction();
  const ciclo=await obtenerCiclo(conn,req.params.anio);if(ciclo.cerrado)throw error('El ciclo está cerrado; reabrilo para configurar sus períodos.',423);
  await conn.query('SELECT pg_advisory_xact_lock(842617,?)',[ciclo.anio]);
  await guardarPeriodo(conn,{cicloLectivo:ciclo.anio,cierre:Number(req.params.cierre),modo:req.body.modo,desde:req.body.desde,hasta:req.body.hasta,actorId:req.user.id});
  await conn.commit();res.json({success:true,...await obtenerPeriodosCiclo(conn,ciclo.anio)});
 }catch(e){if(conn)await conn.rollback().catch(()=>{});res.status(e.status||500).json({success:false,error:e.status?e.message:'No pudimos guardar el período.'});}finally{if(conn)conn.release();}
});
module.exports=router;
