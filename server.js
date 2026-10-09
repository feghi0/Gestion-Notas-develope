require("dotenv").config();
const express = require("express");
const path    = require("path");
const app = express();

if (process.env.VERCEL && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error("JWT_SECRET debe tener al menos 32 caracteres aleatorios");
}
if (process.env.VERCEL) app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (req.headers.authorization) res.set("Cache-Control", "no-store");
  next();
});

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api",       require("./routes/auth"));
app.use("/dashboard", require("./routes/dash"));
app.use("/planilla",  require("./routes/planilla"));
app.use("/boletines", require("./routes/boletines"));
app.use("/usuarios", require("./routes/usuarios"));

app.get("/api/health", async (req, res) => {
  let conn;
  res.set("Cache-Control", "no-store");
  try {
    conn = await require("./db/connection").getConnection();
    await conn.query("SELECT 1 AS ok");
    res.json({ ok: true });
  } catch (_) {
    res.status(503).json({ ok: false });
  } finally {
    if (conn) conn.release();
  }
});

if (require.main === module && !process.env.VERCEL) {
const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
}).on("error", (err) => {
  console.error("Error al iniciar el servidor:", err);
  process.exit(1);
});
}

module.exports = app;
