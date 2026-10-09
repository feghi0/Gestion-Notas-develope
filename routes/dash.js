const express        = require("express");
const router         = express.Router();
const pool           = require("../db/connection");
const authMiddleware = require("../middleware/auth");

function idEnteroValido(val) {
  const n = parseInt(val, 10);
  return !isNaN(n) && n > 0;
}

// ─── GET /dashboard/:id ────────────────────────────────────────────────────────
// Devuelve la lista de CURSOS (no materias) para profesor, preceptor y regente.
// Para alumno, sigue devolviendo directamente sus materias (no tiene carpetas).
//
// NOTA: el parámetro :id no se usa intencionalmente — la identidad se toma
// del JWT (req.user), no del parámetro de la URL.
router.get("/:id", authMiddleware, async (req, res) => {
  const { id, rango } = req.user;
  let conn;
  try {
    conn = await pool.getConnection();
    let resultado = [];

    if (rango === "profesor") {
      // Cursos donde el profesor tiene al menos una materia asignada
      resultado = await conn.query(`
        SELECT DISTINCT c.id, c.anio, c.division, c.turno
        FROM cursos c
        JOIN curso_materia cm    ON cm.curso_id = c.id
        JOIN profesor_materia pm ON pm.curso_materia_id = cm.id
        WHERE pm.profesor_id = ?
        ORDER BY c.anio, c.division
      `, [id]);

    } else if (rango === "alumno") {
      // El alumno no tiene carpetas: se devuelven directamente sus materias
      resultado = await conn.query(`
        SELECT
          cm.id,
          m.nombre     AS materia,
          c.anio,
          c.division,
          cm.dias,
          cm.horario,
          u.nombre     AS nombre_alumno,
          u.apellido
        FROM alumno_curso ac
        JOIN usuarios u       ON ac.alumno_id = u.id
        JOIN cursos c         ON ac.curso_id  = c.id
        JOIN curso_materia cm ON cm.curso_id  = c.id
        JOIN materias m       ON m.id = cm.materia_id
        WHERE ac.alumno_id = ?
        GROUP BY cm.id, m.nombre, c.anio, c.division, cm.dias, cm.horario, u.nombre, u.apellido
        ORDER BY m.nombre
      `, [id]);

    } else if (rango === "regente") {
      // El regente ve TODOS los cursos del colegio
      resultado = await conn.query(`
        SELECT id, anio, division, turno
        FROM cursos
        ORDER BY anio, division
      `);

    } else if (rango === "preceptor") {
      // El preceptor ve los cursos que tiene asignados
      resultado = await conn.query(`
        SELECT c.id, c.anio, c.division, c.turno
        FROM preceptor_curso pc
        JOIN cursos c ON pc.curso_id = c.id
        WHERE pc.preceptor_id = ?
        ORDER BY c.anio, c.division
      `, [id]);
    }

    res.json(resultado);

  } catch (err) {
    console.error("Error en dashboard:", err);
    res.status(500).json({ success: false, error: "Error del servidor" });
  } finally {
    if (conn) conn.release();
  }
});

// ─── GET /dashboard/curso/:cursoId ─────────────────────────────────────────────
// Devuelve las materias de un curso específico, según el rango del usuario.
// - profesor: solo las materias de ese curso que él dicta
// - preceptor: todas las materias de ese curso (debe tenerlo asignado)
// - regente: todas las materias de ese curso (sin restricción)
router.get("/curso/:cursoId", authMiddleware, async (req, res) => {
  const { cursoId } = req.params;
  const { id, rango } = req.user;

  if (!idEnteroValido(cursoId)) {
    return res.status(400).json({ success: false, error: "ID de curso inválido" });
  }

  let conn;
  try {
    conn = await pool.getConnection();

    // Validar ownership antes de devolver datos
    if (rango === "profesor") {
      const acceso = await conn.query(`
        SELECT 1
        FROM curso_materia cm
        JOIN profesor_materia pm ON pm.curso_materia_id = cm.id
        WHERE cm.curso_id = ? AND pm.profesor_id = ?
        LIMIT 1
      `, [cursoId, id]);
      if (!acceso || acceso.length === 0) {
        return res.status(403).json({ success: false, error: "No tenés materias asignadas en este curso" });
      }
    } else if (rango === "preceptor") {
      const acceso = await conn.query(
        "SELECT 1 FROM preceptor_curso WHERE preceptor_id = ? AND curso_id = ? LIMIT 1",
        [id, cursoId]
      );
      if (!acceso || acceso.length === 0) {
        return res.status(403).json({ success: false, error: "No tenés asignado este curso" });
      }
    } else if (rango !== "regente") {
      // Alumnos no usan esta ruta
      return res.status(403).json({ success: false, error: "Rol no autorizado para esta vista" });
    }

    const curso = await conn.query(
      "SELECT id, anio, division, turno FROM cursos WHERE id = ?",
      [cursoId]
    );
    if (!curso || curso.length === 0) {
      return res.status(404).json({ success: false, error: "Curso no encontrado" });
    }

    let materias;

    if (rango === "profesor") {
      // Solo las materias que el profesor dicta en este curso
      materias = await conn.query(`
        SELECT
          cm.id,
          m.nombre AS materia,
          c.anio,
          c.division,
          cm.dias,
          cm.horario
        FROM curso_materia cm
        JOIN materias m          ON m.id = cm.materia_id
        JOIN cursos c            ON c.id = cm.curso_id
        JOIN profesor_materia pm ON pm.curso_materia_id = cm.id
        WHERE cm.curso_id = ? AND pm.profesor_id = ?
        ORDER BY m.nombre
      `, [cursoId, id]);
    } else {
      // preceptor y regente ven todas las materias del curso, con el profesor a cargo
      materias = await conn.query(`
        SELECT
          cm.id,
          m.nombre     AS materia,
          c.anio,
          c.division,
          cm.dias,
          cm.horario,
          u.nombre     AS nombre_profesor,
          u.apellido
        FROM curso_materia cm
        JOIN materias m               ON m.id = cm.materia_id
        JOIN cursos c                 ON c.id = cm.curso_id
        LEFT JOIN profesor_materia pm ON pm.curso_materia_id = cm.id
        LEFT JOIN usuarios u          ON u.id = pm.profesor_id
        WHERE cm.curso_id = ?
        ORDER BY m.nombre
      `, [cursoId]);
    }

    res.json({ success: true, curso: curso[0], materias });

  } catch (err) {
    console.error("Error al cargar materias del curso:", err);
    res.status(500).json({ success: false, error: "Error del servidor" });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
