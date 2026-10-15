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
  await db.exec(fs.readFileSync("supabase/migrations/20261015135414_session_security_note_history.sql", "utf8"));
  await db.exec(fs.readFileSync("supabase/migrations/20261015141030_bulletin_delivery_status.sql", "utf8"));
  await db.exec(fs.readFileSync("supabase/migrations/20261015155214_academic_years.sql", "utf8"));
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
  assert.equal((await request("/boletines/envios/1", student)).status, 403);
  assert.equal((await request("/boletines/envios/1", teacher)).status, 403);
  assert.equal((await request("/boletines/envios/1", tokens["90000004"])).status, 200);
  assert.equal((await request("/boletines/envios/1/preparar", student, {})).status, 403);
  assert.equal((await request("/boletines/envios/1/procesar", student, {})).status, 403);
  assert.equal((await request("/boletines/envio/1/reintentar", student, {})).status, 403);
  assert.equal((await request("/boletines/envio/1/resolver", student, { decision: "no_enviado" })).status, 403);
  assert.equal((await request("/boletines/envios/1?estado=inventado", admin)).status, 400);
  assert.equal((await request("/boletines/generar/1?enviarMails=true", admin)).status, 400);
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
  const audit = await db.query("SELECT * FROM historial_notas WHERE accion='ALTA' ORDER BY id");
  assert.equal(audit.rows.length, 2);
  assert.ok(audit.rows.every(row => row.actor_id === 2 && row.actor_nombre === "Docente Demo"));
  assert.ok(audit.rows.every(row => row.origen === "POST /planilla/evaluacion-global"));
  assert.deepEqual(audit.rows.map(row => Number(row.nota_nueva)), [9,7]);
  assert.equal((await request("/planilla/historial/1", student)).status, 403);
  assert.equal((await request("/planilla/historial/1", tokens["90000003"])).status, 403);
  const history = await request("/planilla/historial/1?alumno=5", teacher);
  assert.equal(history.status, 200);
  assert.ok((await history.json()).historial.every(row => row.alumno_id === 5));
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
  const importId = importData.detalle[0].usuarioCreado;
  const importUser = (await db.query("SELECT id FROM usuarios WHERE dni=$1", [importId])).rows[0];
  const importAudit = await db.query("SELECT * FROM historial_notas WHERE alumno_id=$1", [importUser.id]);
  assert.equal(importAudit.rows.length, 3);
  assert.ok(importAudit.rows.every(row => row.actor_id === 2 && row.origen === "POST /planilla/importar/:cursoMateriaId"));
  const update = await request("/planilla/importar/1", teacher, {
    filas: [{ nombre: "Importado", apellido: "Demo", dni: "90000009", nf: 10 }]
  });
  assert.equal(update.status, 200);
  const modifications = await db.query("SELECT * FROM historial_notas WHERE accion='MODIFICACION'");
  assert.equal(modifications.rows.length, 1);
  assert.equal(Number(modifications.rows[0].nota_anterior), 9);
  assert.equal(Number(modifications.rows[0].nota_nueva), 10);
  // Un docente no puede consultar la materia que se acaba de reasignar.
  assert.equal((await request("/planilla/historial/2", teacher)).status, 403);
  assert.equal((await request("/planilla/historial/1?antes=incorrecto", admin)).status, 400);
  const eraseOverride = await request(`/planilla/override/${importUser.id}`, teacher, { cursoMateriaId: 1 }, "DELETE");
  assert.equal(eraseOverride.status, 200);
  const erasedOverrides = await db.query("SELECT * FROM historial_notas WHERE accion='BAJA'");
  assert.equal(erasedOverrides.rows.length, 2);
  assert.ok(erasedOverrides.rows.every(row => row.actor_id === 2));
  for (const url of ["/planilla/plantilla/1", "/boletines/excel/1", "/boletines/generar/1?enviarMails=false"]) {
    const res = await request(url, admin);
    assert.equal(res.status, 200, url);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0,2).toString(), "PK", url);
  }
  const conn = connection;
  const auditCount = Number((await db.query("SELECT COUNT(*) AS count FROM historial_notas")).rows[0].count);
  await conn.beginTransaction();
  await conn.query("INSERT IGNORE INTO alumno_curso (alumno_id, curso_id) VALUES (?, ?)", [5,1]);
  await conn.query("UPDATE notas SET nota=? WHERE alumno_id=?", [1,5]);
  await conn.rollback();
  const after = await conn.query("SELECT nota FROM notas WHERE alumno_id=?", [5]);
  assert.ok(after.every(row => Number(row.nota) !== 1));
  assert.equal(Number((await db.query("SELECT COUNT(*) AS count FROM historial_notas")).rows[0].count), auditCount);
  // Un cambio sin efecto no agrega un evento; una cascada conserva la evaluación.
  await db.query("UPDATE notas SET nota=nota");
  assert.equal(Number((await db.query("SELECT COUNT(*) AS count FROM historial_notas")).rows[0].count), auditCount);
  const evaluationId = (await db.query("SELECT id FROM evaluaciones WHERE descripcion='Prueba de migración'")).rows[0].id;
  await db.query("DELETE FROM evaluaciones WHERE id=$1", [evaluationId]);
  const deleted = await db.query("SELECT * FROM historial_notas WHERE accion='BAJA'");
  const deletedEvaluation = deleted.rows.filter(row => row.evaluacion_id === evaluationId);
  assert.equal(deletedEvaluation.length, 2);
  assert.ok(deletedEvaluation.every(row => row.curso_materia_id === 1 && row.evaluacion.descripcion === "Prueba de migración"));
  // Paginación estable: sin repetir ni saltear eventos.
  const noteId = (await db.query("SELECT id FROM notas ORDER BY id LIMIT 1")).rows[0].id;
  for (let i = 0; i < 55; i++) await db.query("UPDATE notas SET nota=$1 WHERE id=$2", [2 + i % 8, noteId]);
  const firstPage = await (await request("/planilla/historial/1", admin)).json();
  assert.equal(firstPage.historial.length, 50);
  assert.ok(firstPage.siguiente);
  const nextPage = await (await request(`/planilla/historial/1?antes=${firstPage.siguiente}`, admin)).json();
  const ids = new Set(firstPage.historial.map(row => row.id));
  assert.ok(nextPage.historial.every(row => !ids.has(row.id)));
  await assert.rejects(db.query("DELETE FROM historial_notas"), /solo lectura/);
  await assert.rejects(db.query("UPDATE historial_notas SET actor_nombre='otro'"), /solo lectura/);
  // Probar la baja real mediante el endpoint y luego reactivar: el JWT viejo no revive.
  assert.equal((await request("/usuarios/curso/1/alumno/5", admin, undefined, "DELETE")).status, 200);
  assert.equal((await request("/dashboard/5", student)).status, 401);
  await db.query("UPDATE usuarios SET activo=1 WHERE id=5");
  assert.equal((await request("/dashboard/5", student)).status, 401);
  const jwt = require("jsonwebtoken");
  await db.query("UPDATE usuarios SET permiso='lectura' WHERE id=2");
  assert.equal((await request("/dashboard/2", teacher)).status, 401);
  const refreshedTeacher = jwt.sign({ id: 2, rango: "regente", permiso: "ambos", sessionVersion: 1 }, process.env.JWT_SECRET);
  // Los roles y permisos del JWT se ignoran en favor de los valores actuales de BD.
  assert.equal((await request("/usuarios/cursos", refreshedTeacher)).status, 403);
  assert.equal((await request("/planilla/evaluacion-global", refreshedTeacher, evaluation)).status, 403);
  assert.equal((await request("/api/cambiar-password", refreshedTeacher, { nuevaPassword: "nueva-para-test" })).status, 200);
  assert.equal((await request("/dashboard/2", refreshedTeacher)).status, 401);
  const newLogin = await request("/api/login", null, { dni: "90000002", password: "nueva-para-test" });
  assert.equal(newLogin.status, 200);
  const newTeacherToken=(await newLogin.json()).token;
  assert.equal((await request("/dashboard/2", newTeacherToken)).status, 200);
  const rls = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity");
  assert.equal(rls.rows.length, 12);
  // Dos ciclos con el mismo curso y alumno no comparten inscripciones ni notas.
  assert.equal((await request("/ciclos", student, { anio:2027, copiarDe:2026 })).status,401);
  assert.equal((await request("/ciclos", newTeacherToken, { anio:2027 })).status,403);
  const createYear=await request("/ciclos",admin,{anio:2027,copiarDe:2026});
  assert.equal(createYear.status,201);
  assert.equal((await request("/ciclos",admin,{anio:2027})).status,409);
  const newCourses=(await (await request("/usuarios/cursos?ciclo=2027",admin)).json()).cursos;
  assert.equal(newCourses.length,1);
  const newCourse=newCourses[0].id;
  assert.notEqual(newCourse,1);
  const newMatter=(await db.query("SELECT id FROM curso_materia WHERE curso_id=$1 ORDER BY id LIMIT 1",[newCourse])).rows[0].id;
  assert.equal((await db.query("SELECT * FROM alumno_curso WHERE curso_id=$1",[newCourse])).rows.length,0);
  assert.equal((await db.query("SELECT n.id FROM notas n JOIN evaluaciones e ON e.id=n.evaluacion_id JOIN curso_materia cm ON cm.id=e.curso_materia_id WHERE cm.curso_id=$1",[newCourse])).rows.length,0);
  assert.equal((await (await request("/dashboard/1?ciclo=2026",admin)).json()).length,1);
  assert.equal((await (await request("/boletines/cursos?ciclo=2027",admin)).json()).cursos[0].ciclo_lectivo,2027);
  assert.equal((await request("/usuarios/cursos?ciclo=incorrecto",admin)).status,400);
  const previousGrades=await db.query("SELECT n.id,n.nota FROM notas n JOIN evaluaciones e ON e.id=n.evaluacion_id WHERE n.alumno_id=5 ORDER BY n.id");
  assert.equal((await request(`/usuarios/curso/${newCourse}/alumno`,admin,{dni:"90000005",nombre:"Ana",apellido:"Prueba"})).status,200);
  assert.equal((await request("/usuarios/curso/1/alumno",admin,{dni:"90000005",nombre:"Ana",apellido:"Prueba"})).status,200);
  const grades={cursoMateriaId:newMatter,tipo:"Examen escrito",descripcion:"Solo 2027",bimestre:1,notas:[{alumnoId:5,nota:10}]};
  assert.equal((await request("/planilla/evaluacion-global",admin,grades)).status,200);
  const olderGrades=await db.query("SELECT n.id,n.nota FROM notas n JOIN evaluaciones e ON e.id=n.evaluacion_id WHERE n.alumno_id=5 AND e.curso_materia_id<>$1 ORDER BY n.id",[newMatter]);
  assert.deepEqual(olderGrades.rows,previousGrades.rows);
  const newSheet=await (await request(`/planilla/${newMatter}/1`,admin)).json();
  assert.equal(newSheet.notas.length,1);assert.equal(Number(newSheet.notas[0].nota),10);
  assert.equal(newSheet.materia.ciclo_lectivo,2027);
  assert.equal((await request("/ciclos/2027/activar",admin,{})).status,200);
  assert.equal((await (await request("/dashboard/1",admin)).json())[0].ciclo_lectivo,2027);
  // La baja en un curso no borra el anterior ni desactiva al alumno de otro año abierto.
  assert.equal((await request("/usuarios/curso/1/alumno/5",admin,undefined,"DELETE")).status,200);
  assert.equal((await db.query("SELECT activo FROM usuarios WHERE id=5")).rows[0].activo,1);
  assert.equal((await db.query("SELECT * FROM alumno_curso WHERE alumno_id=5")).rows.length,2);
  assert.equal((await request("/ciclos/2026/cerrar",admin,{})).status,200);
  assert.equal((await request("/planilla/evaluacion-global",admin,{...grades,cursoMateriaId:1})).status,423);
  assert.equal((await request("/usuarios/curso/1/alumno/5",admin,undefined,"DELETE")).status,423);
  assert.equal((await request("/usuarios/materia/1/profesor",admin,{dni:"90000002",nombre:"Docente",apellido:"Demo"})).status,423);
  await assert.rejects(db.query("UPDATE notas SET nota=1 WHERE evaluacion_id IN (SELECT id FROM evaluaciones WHERE curso_materia_id=1)"),/cerrado/);
  await assert.rejects(db.query("UPDATE cursos SET ciclo_lectivo=2026 WHERE id=$1",[newCourse]),/trasladar/);
  const archive=await (await request("/planilla/1/1",admin)).json();
  assert.equal(archive.cicloCerrado,true);
  assert.ok(archive.alumnos.some(row=>row.id===5));
  const currentStudent=jwt.sign({id:5,sessionVersion:(await db.query("SELECT session_version FROM usuarios WHERE id=5")).rows[0].session_version},process.env.JWT_SECRET);
  const personalArchive=await (await request("/planilla/1/5",currentStudent)).json();
  assert.equal(personalArchive.alumnos.length,1);
  assert.ok(personalArchive.notas.every(row=>row.alumno_id===5));
  assert.equal((await request("/ciclos",currentStudent,{anio:2029})).status,403);
  const zip=await request("/boletines/generar/1?enviarMails=false",admin);
  assert.equal(zip.status,200);assert.ok(zip.headers.get("content-disposition").includes("2026"));await zip.arrayBuffer();
  assert.equal((await request("/ciclos/2026/activar",admin,{})).status,409);
  assert.equal((await request("/ciclos/2026/reabrir",admin,{})).status,200);
});
