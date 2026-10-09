require("dotenv").config();
if (process.env.VERCEL && !process.env.DATABASE_URL) {
  throw new Error("Falta configurar DATABASE_URL de Supabase");
}

if (process.env.DATABASE_URL) {
  module.exports = require("./postgres").createPostgresPool();
} else {
const mariadb = require("mariadb");

const pool = mariadb.createPool({
  host:             process.env.DB_HOST     || "localhost",
  user:             process.env.DB_USER     || "root",
  password:         process.env.DB_PASSWORD || "",
  database:         process.env.DB_NAME     || "colegio",
  connectionLimit:  10,
  connectTimeout:   10000,
  acquireTimeout:   10000,   // FIX: evita espera infinita si el pool está lleno
  idleTimeout:      60000,   // FIX: libera conexiones ociosas después de 60s
  resetAfterUse:    true     // FIX: limpia el estado de la conexión al devolverla al pool
});

module.exports = pool;
}
