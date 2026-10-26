const router = require("express").Router();
const pool = require("../db/connection");
const auth = require("../middleware/auth");
const { obtenerCiclo } = require("../lib/ciclosLectivos");
const { asegurarCicloAutomatico } = require("../lib/aperturaCiclo");
router.use(auth);
router.get("/", async (req,res) => {
  let conn;
  try {
    await asegurarCicloAutomatico();
    conn=await pool.getConnection();
    const ciclos=await conn.query("SELECT anio, activo, cerrado FROM ciclos_lectivos ORDER BY anio DESC");
    res.json({success:true,ciclos});
  } catch (_) { res.status(500).json({success:false,error:"No pudimos consultar los ciclos lectivos"}); }
  finally { if(conn)conn.release(); }
});
router.use((req,res,next) => {
  if(req.user.rango!=="regente" || req.user.permiso==="lectura") return res.status(403).json({success:false,error:"Solo un regente con permiso de escritura puede administrar ciclos"});
  next();
});
router.post("/", async (req,res) => {
  const {anio,copiarDe}=req.body || {};
  if(!/^(20\d{2}|2100)$/.test(String(anio))) return res.status(400).json({success:false,error:"Año inválido"});
  let conn;
  try {
    conn=await pool.getConnection(); await conn.beginTransaction();
    await conn.query("SELECT pg_advisory_xact_lock(636123)");
    if((await conn.query("SELECT id FROM ciclos_lectivos WHERE anio=?",[anio])).length) throw Object.assign(new Error("Ese ciclo ya existe"),{status:409});
    if(copiarDe!==undefined) await obtenerCiclo(conn,copiarDe);
    await conn.query("INSERT INTO ciclos_lectivos (anio) VALUES (?)",[anio]);
    let copiados=0;
    if(copiarDe!==undefined) {
      const cursos=await conn.query("SELECT id,anio,division,turno FROM cursos WHERE ciclo_lectivo=? AND es_testing=false ORDER BY id",[copiarDe]);
      for(const curso of cursos) {
        const result=await conn.query("INSERT INTO cursos (anio,division,turno,ciclo_lectivo) VALUES (?,?,?,?)",[curso.anio,curso.division,curso.turno,anio]);
        await conn.query(`INSERT INTO curso_materia (curso_id,materia_id,dias,horario)
          SELECT ?,materia_id,dias,horario FROM curso_materia WHERE curso_id=?`,[result.insertId,curso.id]);
        copiados++;
      }
    }
    await conn.commit();res.status(201).json({success:true,anio:Number(anio),cursosCopiados:copiados});
  } catch(err) {
    if(conn)await conn.rollback().catch(()=>{});
    res.status(err.status||500).json({success:false,error:err.status?err.message:"No pudimos crear el ciclo"});
  } finally {if(conn)conn.release();}
});
router.post("/:anio/:accion", async (req,res) => {
  const {anio,accion}=req.params;
  if(!["activar","cerrar","reabrir"].includes(accion))return res.status(400).json({success:false,error:"Acción inválida"});
  let conn;
  try {
    conn=await pool.getConnection();await conn.beginTransaction();
    await conn.query("SELECT pg_advisory_xact_lock(636123)");
    const ciclo=await obtenerCiclo(conn,anio);
    if(accion==="activar") {
      if(ciclo.cerrado)throw Object.assign(new Error("Reabrí el ciclo antes de establecerlo como actual"),{status:409});
      await conn.query("UPDATE ciclos_lectivos SET activo=false WHERE activo=true");
      await conn.query("UPDATE ciclos_lectivos SET activo=true WHERE anio=?",[anio]);
    } else await conn.query(`UPDATE ciclos_lectivos SET cerrado=?, activo=CASE WHEN ? THEN false ELSE activo END WHERE anio=?`,[accion==="cerrar",accion==="cerrar",anio]);
    await conn.commit();res.json({success:true});
  } catch(err) {
    if(conn)await conn.rollback().catch(()=>{});
    res.status(err.status||500).json({success:false,error:err.status?err.message:"No pudimos actualizar el ciclo"});
  } finally {if(conn)conn.release();}
});
module.exports=router;
