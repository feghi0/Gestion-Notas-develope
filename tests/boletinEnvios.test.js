const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const { wrapClient } = require("../db/postgres");
const { buildSeed } = require("../scripts/generate-seed");
const { createDeliveryService } = require("../lib/boletinEnvios");

async function fixture(t, sendMail) {
  const db = new PGlite();
  for (const file of fs.readdirSync("supabase/migrations").sort()) {
    await db.exec(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  await db.exec((await buildSeed()).sql);
  const client = {
    async query(config) {
      const text = typeof config === "string" ? config : config.text;
      const result = await db.query(text, typeof config === "string" ? [] : config.values);
      return { rows: result.rows, rowCount: result.affectedRows, command: text.trim().split(/\s/)[0].toUpperCase() };
    }, release() {}
  };
  const previous = { GMAIL_USER: process.env.GMAIL_USER, BOLETINES_TEST_EMAIL: process.env.BOLETINES_TEST_EMAIL };
  process.env.GMAIL_USER = "sender@example.test";
  process.env.BOLETINES_TEST_EMAIL = "testing@example.test";
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await db.close();
  });
  const pool = { getConnection: async () => wrapClient(client) };
  return { db, pool, service: createDeliveryService({ pool, sendMail }) };
}

test("preparar es idempotente y reintentar omite los correos ya enviados", async t => {
  const calls = [];
  let fail = true;
  const { db, service } = await fixture(t, async (to, subject, name, pdf, filename, options) => {
    assert.equal(to, "testing@example.test");
    assert.equal(pdf.subarray(0,4).toString(), "%PDF");
    calls.push({ name, messageId: options.messageId, pdf });
    return name.startsWith("Bruno") && fail ? { ok: false, incierto: false, error: "Rechazo simulado" }
      : { ok: true, messageId: options.messageId };
  });
  assert.equal((await service.preparar(1, 1)).creados, 2);
  assert.equal((await service.preparar(1, 1)).creados, 0);
  const processed = await service.procesar(1, 1);
  assert.equal(processed.resumen.enviado, 1);
  assert.equal(processed.resumen.fallido, 1);
  assert.equal((await service.procesar(1, 1)).procesados, 0);
  assert.equal((await service.preparar(1, 1)).creados, 0);
  const failed = processed.envios.find(row => row.estado === "fallido");
  fail = false;
  await service.reintentar(failed.id, 4);
  await assert.rejects(service.reintentar(failed.id, 4), /Solo se pueden reintentar/);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].messageId, calls[2].messageId);
  assert.deepEqual(calls[1].pdf, calls[2].pdf);
  const final = await service.listar(1);
  assert.equal(final.resumen.enviado, 2);
  assert.equal(final.envios.find(row => row.id === failed.id).intentos, 2);
  assert.ok(final.envios.every(row => row.pdf === undefined));
  assert.ok((await db.query("SELECT pdf FROM boletin_envios WHERE estado='enviado'")).rows.every(row => row.pdf === null));
  await db.query("UPDATE notas SET nota=9 WHERE alumno_id=5");
  assert.equal((await service.preparar(1, 1)).creados, 1);
});

test("dos solicitudes simultáneas no reclaman el mismo correo", async t => {
  let signalStarted, releaseSend;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const gate = new Promise(resolve => { releaseSend = resolve; });
  let calls = 0;
  const { db, service } = await fixture(t, async () => {
    calls++; signalStarted(); await gate;
    return { ok: true, messageId: "simulado" };
  });
  await service.preparar(1, 1);
  // Un único destinatario para aislar la carrera en una misma fila.
  await db.query("DELETE FROM boletin_envios WHERE alumno_id=6");
  const first = service.procesar(1, 1);
  await started;
  assert.equal((await service.procesar(1, 4)).procesados, 0);
  releaseSend(); await first;
  assert.equal(calls, 1);
});

test("cortes y resultados inciertos nunca se reenvían automáticamente", async t => {
  let calls = 0;
  const { db, service } = await fixture(t, async () => { calls++; throw new Error("Conexión cortada"); });
  await service.preparar(1, 1);
  const result = await service.procesar(1, 1);
  assert.equal(result.resumen.incierto, 2);
  assert.equal((await service.procesar(1, 1)).procesados, 0);
  await assert.rejects(service.reintentar(result.envios[0].id, 1), /Solo se pueden reintentar/);
  assert.equal(calls, 2);
  await db.query("UPDATE boletin_envios SET estado='enviando', iniciado_en=clock_timestamp()-INTERVAL '11 minutes' WHERE id=$1", [result.envios[0].id]);
  assert.equal((await service.listar(1)).resumen.incierto, 2);
  assert.equal(calls, 2);
  await assert.rejects(service.resolver(result.envios[0].id, 1, "incorrecta"), /Decisión inválida/);
  await service.resolver(result.envios[0].id, 1, "enviado");
  await assert.rejects(service.resolver(result.envios[0].id, 1, "no_enviado"), /Solo se pueden resolver/);
  await service.resolver(result.envios[1].id, 4, "no_enviado");
  assert.equal(calls, 2);
  assert.equal((await service.listar(1)).resumen.fallido, 1);
  await service.reintentar(result.envios[1].id, 4);
  assert.equal(calls, 3);
});

test("emails ausentes se muestran sin envío, corregirlos crea nuevos pendientes", async t => {
  let calls = 0;
  const { db, service } = await fixture(t, async () => { calls++; return { ok: true }; });
  delete process.env.BOLETINES_TEST_EMAIL;
  await service.preparar(1, 1);
  assert.equal((await service.listar(1)).resumen.sin_email, 2);
  assert.equal((await service.procesar(1, 1)).procesados, 0);
  await db.query("UPDATE usuarios SET email_usuario='student@example.test', email_familiar='STUDENT@example.test' WHERE id=5");
  assert.equal((await service.preparar(1, 1)).creados, 1);
  await service.procesar(1, 1);
  assert.equal(calls, 1);
  const sent = await service.listar(1, undefined, "enviado");
  assert.equal(sent.envios.length, 1);
});

test("un corte al guardar la confirmación no convierte el correo en reintentable", async t => {
  let calls = 0;
  const { db, pool, service: setup } = await fixture(t, async () => ({ ok: true }));
  await setup.preparar(1, 1);
  await db.query("DELETE FROM boletin_envios WHERE alumno_id=6");
  const service = createDeliveryService({
    pool: { async getConnection() {
      const conn = await pool.getConnection();
      const query = conn.query.bind(conn);
      conn.query = (sql, params) => {
        if (sql.includes("SET estado=?, error=?")) throw new Error("Fallo de persistencia simulado");
        return query(sql, params);
      };
      return conn;
    } },
    sendMail: async () => { calls++; return { ok: true, messageId: "aceptado" }; }
  });
  await assert.rejects(service.procesar(1, 1), /persistencia/);
  assert.equal(calls, 1);
  assert.equal((await setup.listar(1)).resumen.enviando, 1);
  assert.equal((await setup.procesar(1, 1)).procesados, 0);
  await db.query("UPDATE boletin_envios SET iniciado_en=clock_timestamp()-INTERVAL '11 minutes'");
  const result = await setup.listar(1);
  assert.equal(result.resumen.incierto, 1);
  await assert.rejects(setup.reintentar(result.envios[0].id, 1), /Solo se pueden reintentar/);
  assert.equal(calls, 1);
});
