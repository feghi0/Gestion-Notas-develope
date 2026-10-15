const { createHash } = require("node:crypto");
const { cargarBoletinesCurso, renderBoletin, nombreBoletin } = require("./boletinesCurso");
const { destinatariosBoletin } = require("./mailer");

function huellaBoletin(boletin) {
  const { alumno, curso, materias, periodo } = boletin;
  const anio = curso.ciclo_lectivo;
  return createHash("sha256").update(JSON.stringify({ version: 2, anio,
    alumno: { id: alumno.id, nombre: alumno.nombre, apellido: alumno.apellido, dni: alumno.dni }, curso, materias, periodo
  })).digest("hex");
}

function createDeliveryService({ pool, sendMail }) {
  async function withConnection(callback) {
    const conn = await pool.getConnection();
    try { return await callback(conn); } finally { conn.release(); }
  }
  async function preparar(cursoId, actorId) {
    const remitente = (process.env.GMAIL_USER || "").trim().toLowerCase();
    if (!remitente) throw Object.assign(new Error("Falta configurar la cuenta remitente de Gmail"), { status: 400 });
    return withConnection(async conn => {
      const { boletines } = await cargarBoletinesCurso(conn, cursoId);
      let creados = 0;
      for (const boletin of boletines) {
        const destinos = destinatariosBoletin(boletin.alumno);
        const contenidoHash = huellaBoletin(boletin);
        const pdf = await renderBoletin(boletin);
        for (const destinatario of destinos.length ? destinos : [""]) {
          const valido = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(destinatario);
          const result = await conn.query(`INSERT INTO boletin_envios
            (curso_id, alumno_id, alumno_nombre, periodo, destinatario, remitente, contenido_hash,
             asunto, archivo, pdf, estado, error, creado_por)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (curso_id, alumno_id, destinatario, remitente, contenido_hash) DO NOTHING`,
          [cursoId, boletin.alumno.id, `${boletin.alumno.nombre} ${boletin.alumno.apellido}`, boletin.periodo,
            destinatario.toLowerCase(), remitente, contenidoHash, `Se envia informe: ${boletin.periodo}`,
            nombreBoletin(boletin.alumno), pdf, valido ? "pendiente" : "sin_email",
            valido ? null : "Falta un email válido. Corregí el registro del alumno y volvé a preparar los boletines.", actorId]);
          creados += result.affectedRows;
        }
      }
      return { creados };
    });
  }
  async function marcarInterrumpidos(conn, cursoId) {
    // Nunca volver a ponerlos en pendiente: Gmail podría haber aceptado el correo.
    await conn.query(`UPDATE boletin_envios SET estado='incierto',
      error='El envío se interrumpió. Revisá la carpeta Enviados de Gmail antes de tomar una decisión.',
      actualizado_en=clock_timestamp() WHERE curso_id=? AND estado='enviando'
      AND iniciado_en < clock_timestamp() - INTERVAL '10 minutes'`, [cursoId]);
  }
  async function listar(cursoId, antes, estado) {
    return withConnection(async conn => {
      await marcarInterrumpidos(conn, cursoId);
      const counts = await conn.query("SELECT estado, COUNT(*) AS cantidad FROM boletin_envios WHERE curso_id=? GROUP BY estado", [cursoId]);
      let sql = `SELECT id, alumno_id, alumno_nombre, periodo, destinatario, remitente, estado, intentos,
        error, message_id, creado_en, actualizado_en, enviado_en FROM boletin_envios WHERE curso_id=?`;
      const args = [cursoId];
      if (antes) { sql += " AND id < ?"; args.push(antes); }
      if (estado) { sql += " AND estado=?"; args.push(estado); }
      const rows = await conn.query(sql + " ORDER BY id DESC LIMIT 51", args);
      return { envios: rows.slice(0, 50), siguiente: rows.length > 50 ? String(rows[49].id) : null,
        resumen: Object.fromEntries(counts.map(r => [r.estado, Number(r.cantidad)])),
        testing: (process.env.BOLETINES_TEST_EMAIL || "").trim() || null };
    });
  }
  async function reclamar(cursoId, actorId, envioId) {
    return withConnection(async conn => {
      await conn.beginTransaction();
      try {
        const rows = await conn.query(`SELECT * FROM boletin_envios WHERE curso_id=?
          AND estado=${envioId ? "'fallido' AND id=?" : "'pendiente'"}
          ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`, envioId ? [cursoId, envioId] : [cursoId]);
        if (!rows.length) { await conn.commit(); return null; }
        const row = rows[0];
        row.message_id = `<boletin-${row.id}-${row.contenido_hash}@${row.remitente.split("@")[1]}>`;
        await conn.query(`UPDATE boletin_envios SET estado='enviando', intentos=intentos+1,
          ultimo_actor_id=?, iniciado_en=clock_timestamp(), actualizado_en=clock_timestamp(), error=NULL, message_id=? WHERE id=?`, [actorId, row.message_id, row.id]);
        await conn.commit();
        return row;
      } catch (err) { await conn.rollback(); throw err; }
    });
  }
  async function enviarUno(cursoId, actorId, envioId) {
    const row = await reclamar(cursoId, actorId, envioId);
    if (!row) return false;
    let result;
    if (row.remitente !== (process.env.GMAIL_USER || "").trim().toLowerCase()) {
      result = { ok: false, incierto: false, error: "La cuenta remitente cambió. Restaurá la cuenta original o prepará un nuevo boletín." };
    } else {
      try {
        result = await sendMail(row.destinatario, row.asunto, row.alumno_nombre, Buffer.from(row.pdf), row.archivo,
          { messageId: row.message_id });
      } catch (_) {
        result = { ok: false, incierto: true, error: "No se pudo confirmar el resultado del envío. Revisá Gmail." };
      }
    }
    // Si falla la persistencia después de SMTP, no se reenvía automáticamente.
    await withConnection(conn => conn.query(`UPDATE boletin_envios SET estado=?, error=?, message_id=?,
      actualizado_en=clock_timestamp(), enviado_en=CASE WHEN ?='enviado' THEN clock_timestamp() ELSE NULL END,
      pdf=CASE WHEN ?='enviado' THEN NULL ELSE pdf END WHERE id=? AND estado='enviando'`,
    [result.ok ? "enviado" : result.incierto ? "incierto" : "fallido", result.error || null, result.messageId || row.message_id,
      result.ok ? "enviado" : "fallido", result.ok ? "enviado" : "fallido", row.id]));
    return true;
  }
  async function procesar(cursoId, actorId) {
    let procesados = 0;
    // Tres correos por petición, con tiempos SMTP acotados; los pendientes sobreviven a la navegación.
    for (let i = 0; i < 3; i++) { if (!await enviarUno(cursoId, actorId)) break; procesados++; }
    return { procesados, ...await listar(cursoId) };
  }
  async function reintentar(envioId, actorId) {
    const rows = await withConnection(conn => conn.query("SELECT curso_id FROM boletin_envios WHERE id=?", [envioId]));
    if (!rows.length) throw Object.assign(new Error("Envío no encontrado"), { status: 404 });
    if (!await enviarUno(rows[0].curso_id, actorId, envioId)) {
      throw Object.assign(new Error("Solo se pueden reintentar envíos fallidos. Este registro ya fue enviado, está en proceso o requiere revisión."), { status: 409 });
    }
    return listar(rows[0].curso_id);
  }
  async function resolver(envioId, actorId, decision) {
    if (!["enviado", "no_enviado"].includes(decision)) throw Object.assign(new Error("Decisión inválida"), { status: 400 });
    return withConnection(async conn => {
      const result = await conn.query(`UPDATE boletin_envios SET estado=?, ultimo_actor_id=?,
        error=?, actualizado_en=clock_timestamp(),
        enviado_en=CASE WHEN ?='enviado' THEN clock_timestamp() ELSE NULL END,
        pdf=CASE WHEN ?='enviado' THEN NULL ELSE pdf END WHERE id=? AND estado='incierto'`,
      [decision === "enviado" ? "enviado" : "fallido", actorId,
        decision === "enviado" ? "Envío confirmado manualmente tras revisar Gmail." : "El operador confirmó que no se envió. Reintento habilitado.",
        decision, decision, envioId]);
      if (!result.affectedRows) throw Object.assign(new Error("Solo se pueden resolver envíos que requieren revisión"), { status: 409 });
      return { resuelto: true };
    });
  }
  return { preparar, listar, procesar, reintentar, resolver };
}
module.exports = { createDeliveryService, huellaBoletin };
