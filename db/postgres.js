const { Pool, types } = require("pg");

// Las notas DECIMAL y las fechas deben conservar el formato usado por la app.
types.setTypeParser(1700, Number);
types.setTypeParser(1082, value => value);

// Compatibilidad acotada para las consultas parametrizadas existentes.
// Los valores siempre viajan separados del SQL, incluso las listas IN (?).
function compileQuery(sql, params = []) {
  const values = [];
  let index = 0;
  let text = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\?/g, token => {
    if (token !== "?") return token;
    if (index >= params.length) throw new Error("Faltan parámetros SQL");
    const value = params[index++];
    if (Array.isArray(value)) {
      if (!value.length) return "NULL";
      return value.map(item => { values.push(item); return `$${values.length}`; }).join(", ");
    }
    values.push(value);
    return `$${values.length}`;
  }).trim().replace(/;$/, "");
  if (index !== params.length) throw new Error("Sobran parámetros SQL");
  if (/^INSERT IGNORE INTO\b/i.test(text)) {
    text = text.replace(/^INSERT IGNORE INTO/i, "INSERT INTO") + " ON CONFLICT DO NOTHING";
  }
  if (/^INSERT INTO\b/i.test(text)) text += " RETURNING id";
  return { text, values };
}

function wrapClient(client) {
  let inTransaction = false;
  return {
    async query(sql, params) {
      const result = await client.query(compileQuery(sql, params));
      if (result.command === "SELECT") return result.rows;
      return { insertId: result.rows[0]?.id, affectedRows: result.rowCount };
    },
    async batch(sql, rows) {
      const results = [];
      for (const row of rows) results.push(await this.query(sql, row));
      return results;
    },
    async beginTransaction() { await client.query("BEGIN"); inTransaction = true; },
    async commit() { await client.query("COMMIT"); inTransaction = false; },
    async rollback() { await client.query("ROLLBACK"); inTransaction = false; },
    // Descartar una conexión con transacción abierta evita contaminar el pool.
    release() { client.release(inTransaction); }
  };
}

function createPostgresPool() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX || 3),
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    ssl: process.env.DB_SSL === "false" ? false : {
      rejectUnauthorized: true,
      ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, "\n") } : {})
    }
  });
  pool.on("error", err => console.error("PostgreSQL: conexión inactiva cerrada", err.code));
  if (process.env.VERCEL) require("@vercel/functions").attachDatabasePool(pool);
  return {
    async getConnection() { return wrapClient(await pool.connect()); },
    end() { return pool.end(); }
  };
}

module.exports = { compileQuery, wrapClient, createPostgresPool };
