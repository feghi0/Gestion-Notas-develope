const router = require('express').Router();
const pool = require('../db/connection');
const auth = require('../middleware/auth');
const { obtenerCiclo, cursoAbierto } = require('../lib/ciclosLectivos');
const bcrypt = require('bcrypt');
const passwordTemporal = require('../lib/temporaryPassword');

router.use(auth, (req, res, next) => {
  if (req.user.rango !== 'regente' || (req.method !== 'GET' && !['escritura', 'ambos'].includes(req.user.permiso))) {
    return res.status(403).json({ success: false, error: 'Solo un regente con escritura puede administrar la estructura escolar.' });
  }
  next();
});
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const id = value => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) fail(400, 'Identificador inválido'); return n; };
const texto = (value, max, obligatorio = true) => {
  if (typeof value !== 'string' || value.trim().length > max || (obligatorio && !value.trim())) fail(400, 'Completá los campos respetando su longitud máxima.');
  return value.trim();
};
function ruta(method, path, handler) {
  router[method](path, async (req, res) => {
    let conn;
    try {
      conn = await pool.getConnection();
      if (method !== 'get') { await conn.beginTransaction(); await conn.query('SELECT pg_advisory_xact_lock(636123)'); }
      const result = await handler(conn, req);
      if (method !== 'get') await conn.commit();
      res.json({ success: true, ...result });
    } catch (err) {
      if (conn && method !== 'get') await conn.rollback().catch(() => {});
      console.error('Error en estructura escolar:', err.code || err.status);
      res.status(err.status || (err.code === '23505' ? 409 : err.code === '55000' ? 423 : 500))
        .json({ success: false, error: err.status ? err.message : err.code === '23505' ? 'Ya existe esa asignación.' : err.code === '55000' ? 'El ciclo está cerrado.' : 'No pudimos guardar o consultar los datos.' });
    } finally { if (conn) conn.release(); }
  });
}
ruta('get', '/', async (conn, req) => {
  const ciclo = await obtenerCiclo(conn, req.query.ciclo);
  const cursos = await conn.query('SELECT * FROM cursos WHERE ciclo_lectivo=? ORDER BY anio, division, turno', [ciclo.anio]);
  const personal = await conn.query("SELECT id,nombre,apellido,dni,rango FROM usuarios WHERE activo=1 AND rango IN ('profesor','preceptor') ORDER BY apellido,nombre");
  return { ciclo, cursos, personal };
});
ruta('get', '/curso/:id', async (conn, req) => {
  const [curso] = await conn.query('SELECT * FROM cursos WHERE id=?', [id(req.params.id)]);
  if (!curso) fail(404, 'Curso no encontrado');
  const materias = await conn.query(`SELECT cm.*,m.nombre FROM curso_materia cm JOIN materias m ON m.id=cm.materia_id WHERE cm.curso_id=? ORDER BY m.nombre`, [curso.id]);
  const profesores = await conn.query('SELECT pm.* FROM profesor_materia pm JOIN curso_materia cm ON cm.id=pm.curso_materia_id WHERE cm.curso_id=?', [curso.id]);
  const preceptores = await conn.query('SELECT preceptor_id FROM preceptor_curso WHERE curso_id=?', [curso.id]);
  return { curso, materias, profesores, preceptores };
});
async function guardarCurso(conn, req, editar) {
  const body = req.body || {};
  const anio = id(body.anio); if (anio > 7) fail(400, 'El año del curso debe estar entre 1 y 7.');
  const division = texto(body.division, 5).toUpperCase();
  const turno = texto(body.turno, 30);
  if (!['Mañana', 'Tarde', 'Noche'].includes(turno)) fail(400, 'Turno inválido');
  let ciclo;
  if (editar) ciclo = await cursoAbierto(conn, id(req.params.id));
  else { ciclo = await obtenerCiclo(conn, body.ciclo); if (ciclo.cerrado) fail(423, 'El ciclo está cerrado'); }
  const duplicados = await conn.query('SELECT id FROM cursos WHERE ciclo_lectivo=? AND anio=? AND lower(division)=lower(?) AND lower(turno)=lower(?) AND id<>?', [ciclo.anio, anio, division, turno, editar ? req.params.id : 0]);
  if (duplicados.length) fail(409, 'Ya existe ese curso en el ciclo seleccionado.');
  if (editar) { await conn.query('UPDATE cursos SET anio=?,division=?,turno=? WHERE id=?', [anio, division, turno, req.params.id]); return {}; }
  const result = await conn.query('INSERT INTO cursos (anio,division,turno,ciclo_lectivo) VALUES (?,?,?,?)', [anio, division, turno, ciclo.anio]);
  return { id: result.insertId };
}
ruta('post', '/cursos', (conn, req) => guardarCurso(conn, req, false));
ruta('patch', '/curso/:id', (conn, req) => guardarCurso(conn, req, true));
async function guardarMateria(conn, req, editar) {
  const cursoId = id(req.params.id); await cursoAbierto(conn, cursoId);
  const body = req.body || {};
  const nombre = texto(body.nombre, 100);
  const dias = texto(body.dias ?? '', 50, false);
  const horario = texto(body.horario ?? '', 50, false);
  const cmId = editar ? id(req.params.materia) : 0;
  const duplicados = await conn.query('SELECT cm.id FROM curso_materia cm JOIN materias m ON m.id=cm.materia_id WHERE cm.curso_id=? AND lower(m.nombre)=lower(?) AND cm.id<>?', [cursoId, nombre, cmId]);
  if (duplicados.length) fail(409, 'El curso ya tiene una materia con ese nombre.');
  let actual;
  if (editar) { [actual] = await conn.query('SELECT cm.*,m.nombre FROM curso_materia cm JOIN materias m ON m.id=cm.materia_id WHERE cm.id=? AND cm.curso_id=?', [cmId, cursoId]); if (!actual) fail(404, 'Materia no encontrada'); }
  let materiaId = actual?.materia_id;
  if (!actual || actual.nombre !== nombre) {
    // El catálogo puede compartirse entre años: renombrar solo esta asignación.
    const [existente] = await conn.query('SELECT id FROM materias WHERE nombre=? ORDER BY id LIMIT 1', [nombre]);
    materiaId = existente?.id || (await conn.query('INSERT INTO materias (nombre) VALUES (?)', [nombre])).insertId;
  }
  if (editar) await conn.query('UPDATE curso_materia SET materia_id=?,dias=?,horario=? WHERE id=?', [materiaId, dias, horario, cmId]);
  else await conn.query('INSERT INTO curso_materia (curso_id,materia_id,dias,horario) VALUES (?,?,?,?)', [cursoId, materiaId, dias, horario]);
  return {};
}
ruta('post', '/curso/:id/materias', (conn, req) => guardarMateria(conn, req, false));
ruta('patch', '/curso/:id/materia/:materia', (conn, req) => guardarMateria(conn, req, true));
ruta('post', '/curso/:id/personal', async (conn, req) => {
  const cursoId = id(req.params.id); await cursoAbierto(conn, cursoId);
  const { rango, nombre, apellido, dni } = req.body || {};
  if (!['profesor', 'preceptor'].includes(rango) || !/^\d{6,9}$/.test(String(dni))) fail(400, 'Rol o DNI inválido');
  const nom = texto(nombre, 50), ape = texto(apellido, 50);
  const [existente] = await conn.query('SELECT id,rango,activo FROM usuarios WHERE dni=?', [String(dni)]);
  if (existente) { if (existente.rango !== rango || Number(existente.activo) !== 1) fail(409, 'El DNI pertenece a otro rol o a una cuenta inactiva.'); return { usuario: String(dni), existente: true }; }
  const clave = passwordTemporal(); const hash = await bcrypt.hash(clave, 10);
  await conn.query(`INSERT INTO usuarios (usuario,password,nombre,apellido,dni,rango,permiso,debe_cambiar_password,email_usuario,email_familiar)
    VALUES (?,?,?,?,?,?,?,1,'','')`, [String(dni), hash, nom, ape, String(dni), rango, rango === 'profesor' ? 'escritura' : 'lectura']);
  return { usuario: String(dni), passwordTemporal: clave };
});
ruta('post', '/curso/:id/preceptor', async (conn, req) => {
  const cursoId = id(req.params.id); await cursoAbierto(conn, cursoId);
  const userId = id(req.body?.usuarioId);
  const [user] = await conn.query("SELECT id FROM usuarios WHERE id=? AND rango='preceptor' AND activo=1", [userId]);
  if (!user) fail(400, 'Seleccioná un preceptor activo');
  await conn.query('INSERT INTO preceptor_curso (curso_id,preceptor_id) VALUES (?,?) ON CONFLICT (preceptor_id,curso_id) DO NOTHING', [cursoId, userId]); return {};
});
ruta('delete', '/curso/:id/preceptor/:usuario', async (conn, req) => {
  const cursoId = id(req.params.id); await cursoAbierto(conn, cursoId);
  await conn.query('DELETE FROM preceptor_curso WHERE curso_id=? AND preceptor_id=?', [cursoId, id(req.params.usuario)]); return {};
});
ruta('post', '/curso/:id/materia/:materia/profesor', async (conn, req) => {
  const cursoId = id(req.params.id), cmId = id(req.params.materia); await cursoAbierto(conn, cursoId);
  const [cm] = await conn.query('SELECT id FROM curso_materia WHERE id=? AND curso_id=?', [cmId, cursoId]);
  if (!cm) fail(404, 'Materia no encontrada');
  const userId = req.body?.usuarioId === '' ? null : id(req.body?.usuarioId);
  if (userId) { const [user] = await conn.query("SELECT id FROM usuarios WHERE id=? AND rango='profesor' AND activo=1", [userId]); if (!user) fail(400, 'Seleccioná un profesor activo'); }
  await conn.query('DELETE FROM profesor_materia WHERE curso_materia_id=?', [cmId]);
  if (userId) await conn.query('INSERT INTO profesor_materia (profesor_id,curso_materia_id) VALUES (?,?)', [userId, cmId]); return {};
});
module.exports = router;
