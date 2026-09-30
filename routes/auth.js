const express     = require("express");
const router      = express.Router();
const bcrypt      = require("bcrypt");
const jwt         = require("jsonwebtoken");
const rateLimit   = require("express-rate-limit");
const pool        = require("../db/connection");
const authMiddleware = require("../middleware/auth");

const RANGOS_VALIDOS = ["profesor", "alumno", "regente", "preceptor", "secretario"];

// Hash "de mentira": se compara contra esto cuando el DNI no existe,
// para que el tiempo de respuesta sea igual al de un login real
// (evita deducir qué DNIs existen midiendo tiempos de respuesta).
const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8gJlpVh9y0kX4X4X4X4X4X4X4X4X4X";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Hiciste demasiados intentos. Esperá 15 minutos y volvé a probar." }
});

// ─── POST /api/login ────────────────────────────────────────────────────────
// El login es DNI + contraseña únicamente. El rol ya no lo elige la persona:
// el sistema lo lee de la base de datos, evitando errores por elegir mal.

router.post("/login", loginLimiter, async (req, res) => {
  const { dni, password } = req.body;

  if (!dni || !password) {
    return res.status(400).json({ success: false, error: "Ingresá tu DNI y tu contraseña." });
  }

  const dniLimpio = String(dni).trim();
  let conn;
  try {
    conn = await pool.getConnection();

    const rows = await conn.query(
  "SELECT * FROM usuarios WHERE dni = ? AND activo = 1 LIMIT 1",
  [dniLimpio]
);
    const usuario = rows && rows.length > 0 ? rows[0] : null;

    const hashComparar = usuario ? usuario.password : DUMMY_HASH;
    const passwordOk   = await bcrypt.compare(password, hashComparar);

    if (!usuario || !passwordOk) {
      return res.status(401).json({ success: false, error: "El DNI o la contraseña no son correctos." });
    }

    if (!RANGOS_VALIDOS.includes(usuario.rango)) {
      return res.status(403).json({ success: false, error: "Tu usuario no tiene un rol asignado. Consultá con la secretaría del colegio." });
    }

    const token = jwt.sign(
      { id: usuario.id, rango: usuario.rango },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({
      success: true,
      token,
      id: usuario.id,
      usuario: `${usuario.nombre} ${usuario.apellido}`,
      rango: usuario.rango,
      permiso: usuario.permiso,
      debeCambiarPassword: !!usuario.debe_cambiar_password
    });

  } catch (err) {
    console.error("Error en login:", err);
    res.status(500).json({ success: false, error: "No pudimos conectar con el servidor. Probá de nuevo en un momento." });
  } finally {
    if (conn) conn.release();
  }
});

// ─── POST /api/cambiar-password ─────────────────────────────────────────────

router.post("/cambiar-password", authMiddleware, async (req, res) => {
  const { nuevaPassword } = req.body;
  const { id } = req.user;

  if (!nuevaPassword || nuevaPassword.length < 6) {
    return res.status(400).json({ success: false, error: "La contraseña debe tener al menos 6 caracteres." });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    const hash = await bcrypt.hash(nuevaPassword, 10);

    await conn.query(
      "UPDATE usuarios SET password = ?, debe_cambiar_password = 0 WHERE id = ?",
      [hash, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Error al cambiar contraseña:", err);
    res.status(500).json({ success: false, error: "No pudimos guardar la nueva contraseña. Probá de nuevo." });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;