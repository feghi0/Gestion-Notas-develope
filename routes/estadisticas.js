const router = require('express').Router();
const pool = require('../db/connection');
const auth = require('../middleware/auth');
const { obtenerCiclo } = require('../lib/ciclosLectivos');
const { construirEstadisticas, periodos } = require('../lib/estadisticasCurso');
router.use(auth, (req, res, next) => {
  if (!['regente', 'preceptor'].includes(req.user.rango)) return res.status(403).json({ success: false, error: 'Esta sección es para regentes y preceptores.' });
  next();
});
router.get('/cursos', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const ciclo = await obtenerCiclo(conn, req.query.ciclo);
    const cursos = await conn.query(`SELECT c.id,c.anio,c.division,c.turno,c.ciclo_lectivo,c.es_testing FROM cursos c WHERE c.ciclo_lectivo=?
      ${req.user.rango === 'preceptor' ? 'AND EXISTS (SELECT 1 FROM preceptor_curso pc WHERE pc.curso_id=c.id AND pc.preceptor_id=?)' : ''} ORDER BY c.anio,c.division,c.turno`, req.user.rango === 'preceptor' ? [ciclo.anio, req.user.id] : [ciclo.anio]);
    res.json({ success: true, ciclo, cursos });
  } catch (err) { res.status(err.status || 500).json({ success: false, error: err.status ? err.message : 'No pudimos consultar los cursos.' }); }
  finally { if (conn) conn.release(); }
});
router.get('/curso/:id', async (req, res) => {
  const cursoId = Number(req.params.id), periodo = req.query.periodo || 'actual';
  if (!Number.isSafeInteger(cursoId) || cursoId < 1 || !periodos.includes(periodo)) return res.status(400).json({ success: false, error: 'Curso o período inválido.' });
  let conn;
  try {
    conn = await pool.getConnection();
    if (req.user.rango === 'preceptor') {
      const acceso = await conn.query('SELECT id FROM preceptor_curso WHERE curso_id=? AND preceptor_id=?', [cursoId, req.user.id]);
      if (!acceso.length) return res.status(403).json({ success: false, error: 'No tenés asignado este curso.' });
    }
    const [curso] = await conn.query('SELECT c.*,cl.cerrado FROM cursos c JOIN ciclos_lectivos cl ON cl.anio=c.ciclo_lectivo WHERE c.id=?', [cursoId]);
    if (!curso) return res.status(404).json({ success: false, error: 'Curso no encontrado.' });
    const alumnos = await conn.query(`SELECT u.id,u.nombre,u.apellido FROM alumno_curso ac JOIN usuarios u ON u.id=ac.alumno_id
      WHERE ac.curso_id=? AND (? OR (ac.activo=1 AND u.activo=1)) ORDER BY u.apellido,u.nombre`, [cursoId, curso.cerrado]);
    const materias = await conn.query('SELECT cm.id,m.nombre FROM curso_materia cm JOIN materias m ON m.id=cm.materia_id WHERE cm.curso_id=? ORDER BY m.nombre', [cursoId]);
    const notas = await conn.query(`SELECT e.id,e.curso_materia_id,e.tipo,e.descripcion,e.bimestre,e.cierre,e.es_acumulativo,e.evaluacion_origen_id,n.alumno_id,n.nota
      FROM curso_materia cm JOIN evaluaciones e ON e.curso_materia_id=cm.id JOIN notas n ON n.evaluacion_id=e.id WHERE cm.curso_id=? ORDER BY e.id`, [cursoId]);
    res.json({ success: true, curso, periodo, ...construirEstadisticas(alumnos, materias, notas, periodo) });
  } catch (err) { console.error('Estadísticas:', err.code); res.status(500).json({ success: false, error: 'No pudimos calcular las estadísticas.' }); }
  finally { if (conn) conn.release(); }
});
module.exports = router;
