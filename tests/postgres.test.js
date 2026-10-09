const { test } = require("node:test");
const assert = require("node:assert/strict");
const { compileQuery, wrapClient } = require("../db/postgres");

test("parámetros, listas y literales no interpolan datos en SQL", () => {
  assert.deepEqual(compileQuery("SELECT '?' AS literal FROM usuarios WHERE id IN (?) AND dni = ?", [[1,2], "' OR true --"]), {
    text: "SELECT '?' AS literal FROM usuarios WHERE id IN ($1, $2) AND dni = $3",
    values: [1,2,"' OR true --"]
  });
  assert.equal(compileQuery("SELECT * FROM usuarios WHERE id IN (?)", [[]]).text, "SELECT * FROM usuarios WHERE id IN (NULL)");
  assert.throws(() => compileQuery("SELECT ?", []));
  assert.throws(() => compileQuery("SELECT 1", [1]));
});

test("INSERT IGNORE conserva conflictos e IDs de inserción", () => {
  assert.equal(compileQuery("INSERT IGNORE INTO alumno_curso (alumno_id, curso_id) VALUES (?, ?)", [1,2]).text,
    "INSERT INTO alumno_curso (alumno_id, curso_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id");
});

test("una transacción abierta descarta su conexión al liberarla", async () => {
  let discarded;
  const conn = wrapClient({ query: async () => ({}), release: value => { discarded = value; } });
  await conn.beginTransaction();
  conn.release();
  assert.equal(discarded, true);
  await conn.rollback();
  conn.release();
  assert.equal(discarded, false);
});
