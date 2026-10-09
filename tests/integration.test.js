const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const { wrapClient } = require("../db/postgres");
const { buildSeed } = require("../scripts/generate-seed");

test("PostgreSQL: esquema, login, permisos, planilla y exportaciones", async t => {
  const db = new PGlite();
  await db.exec(fs.readFileSync("supabase/migrations/202610090001_initial.sql", "utf8"));
  const { sql, credentials } = await buildSeed();
  await db.exec(sql);
  const connection = wrapClient({
    async query(config) {
      const text = typeof config === "string" ? config : config.text;
      const result = await db.query(text, typeof config === "string" ? [] : config.values);
      return { rows: result.rows, rowCount: result.affectedRows, command: text.trim().split(/\s/)[0].toUpperCase() };
    },
    release() {}
  });
  const poolPath = require.resolve("../db/connection");
  require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: { getConnection: async () => connection } };
  process.env.JWT_SECRET = "test-only-secret-for-local-integration-testing";
  const app = require("../server");
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, token, body, method) => fetch(base + url, {
    method: method || (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const tokens = {};
  for (const credential of credentials) {
    const res = await request("/api/login", null, { dni: credential.dni, password: credential.password });
    assert.equal(res.status, 200);
    const login = await res.json();
    assert.equal(login.rango, credential.rango);
    assert.equal(login.debeCambiarPassword, true);
    tokens[credential.dni] = login.token;
  }
  const admin = tokens["90000001"], teacher = tokens["90000002"], student = tokens["90000005"];
  assert.equal((await request("/api/health")).status, 200);
  assert.equal((await request("/usuarios/cursos")).status, 401);
  assert.equal((await request("/usuarios/cursos", student)).status, 403);
  for (const url of ["/dashboard/1", "/dashboard/curso/1", "/usuarios/cursos", "/usuarios/curso/1/materias", "/usuarios/curso/1/alumnos", "/boletines/cursos"]) {
    assert.equal((await request(url, admin)).status, 200, url);
  }
  const dashboard = await request("/dashboard/5", student);
  assert.equal(dashboard.status, 200);
  assert.equal((await dashboard.json()).length, 2);
  assert.equal((await request("/planilla/1/5", student)).status, 200);
  const evaluation = { cursoMateriaId: 1, tipo: "Examen escrito", descripcion: "Prueba de migración", bimestre: 2, notas: [{ alumnoId: 5, nota: 9 }, { alumnoId: 6, nota: 7 }] };
  assert.equal((await request("/planilla/evaluacion-global", student, evaluation)).status, 403);
  assert.equal((await request("/planilla/evaluacion-global", teacher, evaluation)).status, 200);
  const saved = await db.query("SELECT nota FROM notas n JOIN evaluaciones e ON e.id=n.evaluacion_id WHERE e.descripcion='Prueba de migración' ORDER BY alumno_id");
  assert.deepEqual(saved.rows.map(row => Number(row.nota)), [9,7]);
  const createdPasswords = [];
  for (const [url, dni] of [["/usuarios/curso/1/alumno", "90000007"], ["/usuarios/materia/2/profesor", "90000008"]]) {
    const res = await request(url, admin, { nombre: "Nuevo", apellido: "Demo", dni });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.passwordTemporal.length >= 16);
    createdPasswords.push(data.passwordTemporal);
  }
  assert.notEqual(createdPasswords[0], createdPasswords[1]);
  const imported = await request("/planilla/importar/1", teacher, {
    filas: [{ nombre: "Importado", apellido: "Demo", dni: "90000009", b1: 8, cq1: 9, nf: 9 }]
  });
  assert.equal(imported.status, 200);
  const importData = await imported.json();
  assert.equal(importData.detalle[0].estado, "creado");
  assert.ok(importData.detalle[0].passwordTemporal.length >= 16);
  for (const url of ["/planilla/plantilla/1", "/boletines/excel/1", "/boletines/generar/1?enviarMails=false"]) {
    const res = await request(url, admin);
    assert.equal(res.status, 200, url);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0,2).toString(), "PK", url);
  }
  const conn = connection;
  await conn.beginTransaction();
  await conn.query("INSERT IGNORE INTO alumno_curso (alumno_id, curso_id) VALUES (?, ?)", [5,1]);
  await conn.query("UPDATE notas SET nota=? WHERE alumno_id=?", [1,5]);
  await conn.rollback();
  const after = await conn.query("SELECT nota FROM notas WHERE alumno_id=?", [5]);
  assert.ok(after.every(row => Number(row.nota) !== 1));
  const rls = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity");
  assert.equal(rls.rows.length, 9);
});
