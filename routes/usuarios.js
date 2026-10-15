const express        = require("express");
const router          = express.Router();
const pool            = require("../db/connection");
const authMiddleware  = require("../middleware/auth");
const bcrypt          = require("bcrypt");
const { obtenerCiclo, cursoAbierto } = require("../lib/ciclosLectivos");

const generarPasswordTemporal = require("../lib/temporaryPassword");

function idEnteroValido(val) {
  const n = parseInt(val, 10);
  return !isNaN(n) && n > 0;
}

function dniValido(val) {
  return /^\d{6,9}$/.test(String(val || "").trim());
}

function soloRegente(req, res) {
  if (req.user.rango !== "regente") {
    res.status(403).json({ success: false, error: "Solo el regente puede administrar usuarios." });
    return false;
  }
  return true;
}

// ─── GET /usuarios/cursos ──────────────────────────────────────────────────
// Punto de entrada de la navegación: lista de cursos como "carpetas".

router.get("/cursos", authMiddleware, async (req, res) => {
  if (!soloRegente(req, res)) return;

  let conn;
  try {
    conn = await pool.getConnection();
    const ciclo=await obtenerCiclo(conn,req.query.ciclo);
    const rows = await conn.query("SELECT id, anio, division, turno, ciclo_lectivo FROM cursos WHERE ciclo_lectivo=? ORDER BY anio, division",[ciclo.anio]);
    const cursos = rows.map(c => ({
      id: Number(c.id), anio: Number(c.anio), division: c.division, turno: c.turno, ciclo_lectivo: c.ciclo_lectivo
    }));
    res.json({ success: true, cursos });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success:false, error:err.message });
    console.error("Error al listar cursos:", err);
    res.status(500).json({ success: false, error: "No pudimos cargar los cursos." });
  } finally {
    if (conn) conn.release();
  }
});

// ─── GET /usuarios/curso/:cursoId/materias ─────────────────────────────────
// Segunda "carpeta": materias del curso, cada una con su profesor actual
// (o null si nadie la tiene asignada todavía).

router.get("/curso/:cursoId/materias", authMiddleware, async (req, res) => {
  if (!soloRegente(req, res)) return;

  const { cursoId } = req.params;
  if (!idEnteroValido(cursoId)) {
    return res.status(400).json({ success: false, error: "ID de curso inválido." });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(`
      SELECT
        cm.id AS curso_materia_id, m.nombre AS materia, cm.dias, cm.horario,
        u.id AS profesor_id, u.nombre AS profesor_nombre,
        u.apellido AS profesor_apellido, u.dni AS profesor_dni
      FROM curso_materia cm
      JOIN materias m ON m.id = cm.materia_id
      LEFT JOIN profesor_materia pm ON pm.curso_materia_id = cm.id
      LEFT JOIN usuarios u ON u.id = pm.profesor_id AND u.activo = 1
      WHERE cm.curso_id = ?
      ORDER BY m.nombre
    `, [cursoId]);

    const materias = rows.map(r => ({
      cursoMateriaId: Number(r.curso_materia_id),
      materia: r.materia,
      dias: r.dias,
      horario: r.horario,
      profesor: r.profesor_id ? {
        id: Number(r.profesor_id),
        nombre: r.profesor_nombre,
        apellido: r.profesor_apellido,
        dni: r.profesor_dni
      } : null
    }));

    res.json({ success: true, materias });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success:false, error:err.message });
    console.error("Error al listar materias del curso:", err);
    res.status(500).json({ success: false, error: "No pudimos cargar las materias de este curso." });
  } finally {
    if (conn) conn.release();
  }
});

// ─── GET /usuarios/curso/:cursoId/alumnos ──────────────────────────────────

router.get("/curso/:cursoId/alumnos", authMiddleware, async (req, res) => {
  if (!soloRegente(req, res)) return;

  const { cursoId } = req.params;
  if (!idEnteroValido(cursoId)) {
    return res.status(400).json({ success: false, error: "ID de curso inválido." });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(`
      SELECT u.id, u.nombre, u.apellido, u.dni, COUNT(n.id) AS cantidad_notas
      FROM alumno_curso ac
      JOIN cursos c ON c.id=ac.curso_id
      JOIN ciclos_lectivos cl ON cl.anio=c.ciclo_lectivo
      JOIN usuarios u ON u.id = ac.alumno_id
      LEFT JOIN notas n ON n.alumno_id = u.id AND n.evaluacion_id IN (SELECT e.id FROM evaluaciones e JOIN curso_materia cm ON cm.id=e.curso_materia_id WHERE cm.curso_id=ac.curso_id)
      WHERE ac.curso_id = ? AND ((ac.activo=1 AND u.activo=1) OR cl.cerrado)
      GROUP BY u.id, u.nombre, u.apellido, u.dni
      ORDER BY u.apellido, u.nombre
    `, [cursoId]);

    const alumnos = rows.map(a => ({
      id: Number(a.id), nombre: a.nombre, apellido: a.apellido, dni: a.dni,
      cantidadNotas: Number(a.cantidad_notas)
    }));

    res.json({ success: true, alumnos });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success:false, error:err.message });
    console.error("Error al listar alumnos del curso:", err);
    res.status(500).json({ success: false, error: "No pudimos cargar los alumnos de este curso." });
  } finally {
    if (conn) conn.release();
  }
});

// ─── POST /usuarios/materia/:cursoMateriaId/profesor ───────────────────────
// Asigna un profesor a esa materia. Si el DNI ya pertenece a un profesor
// existente, lo reutiliza (reactivándolo si estaba dado de baja). Si no
// existe, lo crea con la contraseña por defecto. Reemplaza cualquier
// profesor anterior de esa materia: siempre queda uno solo a cargo.

router.post("/materia/:cursoMateriaId/profesor", authMiddleware, async (req, res) => {
  if (!soloRegente(req, res)) return;

  const { cursoMateriaId } = req.params;
  const { nombre, apellido, dni } = req.body;

  if (!idEnteroValido(cursoMateriaId)) {
    return res.status(400).json({ success: false, error: "ID de materia inválido." });
  }
  const nombreLimpio   = String(nombre || "").trim();
  const apellidoLimpio = String(apellido || "").trim();
  if (!nombreLimpio || !apellidoLimpio) {
    return res.status(400).json({ success: false, error: "Completá el nombre y el apellido del profesor." });
  }
  if (!dniValido(dni)) {
    return res.status(400).json({ success: false, error: "El DNI tiene que tener entre 6 y 9 números, sin puntos." });
  }
  const dniLimpio = String(dni).trim();

  let conn;
  try {
    conn = await pool.getConnection();

    await cursoAbierto(conn, cursoMateriaId, true);
    const cmRows = await conn.query("SELECT id FROM curso_materia WHERE id = ?", [cursoMateriaId]);
    if (!cmRows || cmRows.length === 0) {
      return res.status(404).json({ success: false, error: "Esa materia no existe." });
    }

    const existente = await conn.query("SELECT id, rango, activo FROM usuarios WHERE dni = ?", [dniLimpio]);

    let profesorId;
    let creoNuevo = false;
    const passwordTemporal = generarPasswordTemporal();

    if (existente && existente.length > 0) {
      const u = existente[0];
      if (u.rango !== "profesor") {
        return res.status(409).json({ success: false, error: "Ese DNI ya pertenece a un usuario con otro rol en el sistema." });
      }
      profesorId = Number(u.id);
      if (Number(u.activo) === 0) {
        await conn.query("UPDATE usuarios SET activo = 1 WHERE id = ?", [profesorId]);
      }
    } else {
      const hash = await bcrypt.hash(passwordTemporal, 10);
      const result = await conn.query(
        `INSERT INTO usuarios
           (usuario, password, nombre, apellido, dni, rango, permiso,
            debe_cambiar_password, email_usuario, email_familiar)
         VALUES (?, ?, ?, ?, ?, 'profesor', 'escritura', 1, '', '')`,
        [dniLimpio, hash, nombreLimpio, apellidoLimpio, dniLimpio]
      );
      profesorId = Number(result.insertId);
      creoNuevo = true;
    }

    // Reemplazo total: se borra cualquier asignación previa de esta materia
    // y se deja solo la nueva, para que siempre haya un único responsable.
    await cursoAbierto(conn, cursoMateriaId, true);
    await conn.query("DELETE FROM profesor_materia WHERE curso_materia_id = ?", [cursoMateriaId]);
    await conn.query(
      "INSERT INTO profesor_materia (profesor_id, curso_materia_id) VALUES (?, ?)",
      [profesorId, cursoMateriaId]
    );

    res.json({
      success: true,
      creoNuevo,
      usuario: dniLimpio,
      passwordTemporal: creoNuevo ? passwordTemporal : null
    });

  } catch (err) {
    if (err.status) return res.status(err.status).json({ success:false, error:err.message });
    console.error("Error al asignar profesor:", err);
    res.status(500).json({ success: false, error: "No pudimos asignar el profesor a esta materia." });
  } finally {
    if (conn) conn.release();
  }
});

// ─── DELETE /usuarios/materia/:cursoMateriaId/profesor ─────────────────────
// Saca al profesor de ESA materia. Su cuenta no se toca: sigue existiendo
// y puede tener otras materias asignadas.

router.delete("/materia/:cursoMateriaId/profesor", authMiddleware, async (req, res) => {
  if (!soloRegente(req, res)) return;

  const { cursoMateriaId } = req.params;
  if (!idEnteroValido(cursoMateriaId)) {
    return res.status(400).json({ success: false, error: "ID de materia inválido." });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await cursoAbierto(conn, cursoMateriaId, true);
    await conn.query("DELETE FROM profesor_materia WHERE curso_materia_id = ?", [cursoMateriaId]);
    res.json({ success: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success:false, error:err.message });
    console.error("Error al quitar profesor de la materia:", err);
    res.status(500).json({ success: false, error: "No pudimos quitar al profesor de esta materia." });
  } finally {
    if (conn) conn.release();
  }
});

// ─── POST /usuarios/curso/:cursoId/alumno ──────────────────────────────────
// Inscribe un alumno en el curso. Si el DNI ya existe como alumno, lo
// reutiliza (reactivándolo si había sido dado de baja); si no, lo crea.

router.post("/curso/:cursoId/alumno", authMiddleware, async (req, res) => {
  if (!soloRegente(req, res)) return;

  const { cursoId } = req.params;
  const { nombre, apellido, dni, emailUsuario, emailFamiliar } = req.body;

  if (!idEnteroValido(cursoId)) {
    return res.status(400).json({ success: false, error: "ID de curso inválido." });
  }
  const nombreLimpio   = String(nombre || "").trim();
  const apellidoLimpio = String(apellido || "").trim();
  if (!nombreLimpio || !apellidoLimpio) {
    return res.status(400).json({ success: false, error: "Completá el nombre y el apellido del alumno." });
  }
  if (!dniValido(dni)) {
    return res.status(400).json({ success: false, error: "El DNI tiene que tener entre 6 y 9 números, sin puntos." });
  }
  const dniLimpio = String(dni).trim();

  let conn;
  try {
    conn = await pool.getConnection();

    await cursoAbierto(conn, cursoId);
    const cursoRows = await conn.query("SELECT id FROM cursos WHERE id = ?", [cursoId]);
    if (!cursoRows || cursoRows.length === 0) {
      return res.status(404).json({ success: false, error: "Ese curso no existe." });
    }

    const existente = await conn.query("SELECT id, rango, activo FROM usuarios WHERE dni = ?", [dniLimpio]);

    let alumnoId;
    let creoNuevo = false;
    const passwordTemporal = generarPasswordTemporal();

    await conn.beginTransaction();

    if (existente && existente.length > 0) {
      const u = existente[0];
      if (u.rango !== "alumno") {
        await conn.rollback();
        return res.status(409).json({ success: false, error: "Ese DNI ya pertenece a un usuario con otro rol en el sistema." });
      }
      alumnoId = Number(u.id);
      if (Number(u.activo) === 0) {
        await conn.query("UPDATE usuarios SET activo = 1 WHERE id = ?", [alumnoId]);
      }
    } else {
      const hash = await bcrypt.hash(passwordTemporal, 10);
      const result = await conn.query(
        `INSERT INTO usuarios
           (usuario, password, nombre, apellido, dni, rango, permiso,
            debe_cambiar_password, email_usuario, email_familiar)
         VALUES (?, ?, ?, ?, ?, 'alumno', 'lectura', 1, ?, ?)`,
        [dniLimpio, hash, nombreLimpio, apellidoLimpio, dniLimpio,
         String(emailUsuario || "").trim(), String(emailFamiliar || "").trim()]
      );
      alumnoId = Number(result.insertId);
      creoNuevo = true;
    }

    await conn.query(
      "INSERT INTO alumno_curso (alumno_id, curso_id) VALUES (?, ?) ON CONFLICT (alumno_id, curso_id) DO UPDATE SET activo=1",
      [alumnoId, cursoId]
    );

    await conn.commit();

    res.json({
      success: true,
      creoNuevo,
      usuario: dniLimpio,
      passwordTemporal: creoNuevo ? passwordTemporal : null
    });

  } catch (err) {
    if (err.status) return res.status(err.status).json({ success:false, error:err.message });
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    console.error("Error al inscribir alumno:", err);
    res.status(500).json({ success: false, error: "No pudimos agregar el alumno." });
  } finally {
    if (conn) conn.release();
  }
});

// ─── DELETE /usuarios/curso/:cursoId/alumno/:alumnoId ──────────────────────
// Baja de ESTA inscripción, sin borrar otros años. Solo se desactiva la cuenta
// cuando ya no quedan inscripciones activas en ciclos abiertos.

router.delete("/curso/:cursoId/alumno/:alumnoId", authMiddleware, async (req, res) => {
  if (!soloRegente(req, res)) return;

  const { alumnoId, cursoId } = req.params;
  if (!idEnteroValido(alumnoId) || !idEnteroValido(cursoId)) {
    return res.status(400).json({ success: false, error: "ID de alumno inválido." });
  }

  let conn;
  try {
    conn = await pool.getConnection();

    await cursoAbierto(conn,cursoId);
    const rows=await conn.query("SELECT u.id FROM usuarios u JOIN alumno_curso ac ON ac.alumno_id=u.id WHERE u.id=? AND ac.curso_id=? AND ac.activo=1 AND u.rango='alumno'",[alumnoId,cursoId]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: "No encontramos ese alumno." });
    }

    await conn.beginTransaction();
    await conn.query("UPDATE alumno_curso SET activo=0 WHERE alumno_id=? AND curso_id=?",[alumnoId,cursoId]);
    const otras=await conn.query("SELECT ac.id FROM alumno_curso ac JOIN cursos c ON c.id=ac.curso_id JOIN ciclos_lectivos cl ON cl.anio=c.ciclo_lectivo WHERE ac.alumno_id=? AND ac.activo=1 AND NOT cl.cerrado LIMIT 1",[alumnoId]);
    if(!otras.length)await conn.query("UPDATE usuarios SET activo=0 WHERE id=?",[alumnoId]);
    await conn.commit();

    res.json({ success: true });

  } catch (err) {
    if (err.status) return res.status(err.status).json({ success:false, error:err.message });
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    console.error("Error al dar de baja al alumno:", err);
    res.status(500).json({ success: false, error: "No pudimos dar de baja al alumno." });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
