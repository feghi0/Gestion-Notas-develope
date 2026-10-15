const jwt = require("jsonwebtoken");
const pool = require("../db/connection");
const requestContext = require("../lib/requestContext");

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, error: "No autorizado" });
  }

  const token = authHeader.slice(7);

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    if (!Number.isSafeInteger(decoded.id) || decoded.id <= 0) throw new Error("ID inválido");
  } catch (_) {
    return res.status(401).json({ success: false, error: "Token inválido o expirado" });
  }
  let conn;
  let user;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      "SELECT id, nombre, apellido, rango, permiso, activo, session_version FROM usuarios WHERE id = ?", [decoded.id]
    );
    user = rows[0];
    if (!user || Number(user.activo) !== 1 || Number(decoded.sessionVersion ?? 0) !== Number(user.session_version)) {
      return res.status(401).json({ success: false, error: "Tu sesión fue revocada. Iniciá sesión nuevamente." });
    }
    req.user = { id: user.id, rango: user.rango, permiso: user.permiso };
  } catch (err) {
    console.error("No se pudo validar la sesión:", err.code);
    return res.status(503).json({ success: false, error: "No pudimos validar tu sesión. Intentá nuevamente." });
  } finally {
    if (conn) conn.release();
  }
  // El contexto queda asociado a esta petición, sin compartir autor entre usuarios.
  requestContext.run({ actorId: user.id, source: `${req.method} ${req.baseUrl}${req.route?.path || req.path}` }, next);
}

module.exports = authMiddleware;
