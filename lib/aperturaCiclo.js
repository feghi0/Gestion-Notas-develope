const pool = require('../db/connection');

function fechaEscolar(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(fecha);
  return Object.fromEntries(partes.filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}

// Un mismo bloqueo coordina cron, creación manual y administración de cursos.
async function asegurarCicloAutomatico(fecha = new Date()) {
  const { year: anio, month, day } = fechaEscolar(fecha);
  if (anio < 2000 || anio > 2100 || month < 2 || (month === 2 && day < 15)) return { estado: 'antes_del_15_de_febrero' };
  let conn;
  try {
    conn = await pool.getConnection();
    const [previo] = await conn.query('SELECT apertura_automatica_en FROM ciclos_lectivos WHERE anio=?', [anio]);
    if (previo?.apertura_automatica_en) return { estado: 'ya_procesado', anio };
    await conn.beginTransaction();
    await conn.query('SELECT pg_advisory_xact_lock(636123)');
    const [existente] = await conn.query('SELECT * FROM ciclos_lectivos WHERE anio=?', [anio]);
    if (existente?.apertura_automatica_en) { await conn.commit(); return { estado: 'ya_procesado', anio }; }
    if (!existente) await conn.query('INSERT INTO ciclos_lectivos (anio) VALUES (?)', [anio]);
    let cursosCopiados = 0;
    if (!existente?.cerrado) {
      const [anterior] = await conn.query('SELECT anio FROM ciclos_lectivos WHERE anio<? ORDER BY anio DESC LIMIT 1', [anio]);
      if (anterior) {
        const cursos = await conn.query('SELECT * FROM cursos WHERE ciclo_lectivo=? AND es_testing=false ORDER BY id', [anterior.anio]);
        for (const curso of cursos) {
          let [destino] = await conn.query('SELECT id FROM cursos WHERE ciclo_lectivo=? AND anio=? AND lower(division)=lower(?) AND turno=? ORDER BY id LIMIT 1', [anio, curso.anio, curso.division, curso.turno]);
          if (!destino) {
            const result = await conn.query('INSERT INTO cursos (anio,division,turno,ciclo_lectivo) VALUES (?,?,?,?)', [curso.anio, curso.division, curso.turno, anio]);
            destino = { id: result.insertId }; cursosCopiados++;
          }
          await conn.query(`INSERT INTO curso_materia (curso_id,materia_id,dias,horario)
            SELECT ?,origen.materia_id,origen.dias,origen.horario FROM curso_materia origen
            WHERE origen.curso_id=? AND NOT EXISTS (SELECT 1 FROM curso_materia actual JOIN materias ma ON ma.id=actual.materia_id
              JOIN materias mo ON mo.id=origen.materia_id WHERE actual.curso_id=? AND lower(ma.nombre)=lower(mo.nombre))
            ON CONFLICT (curso_id,materia_id) DO NOTHING`, [destino.id, curso.id, destino.id]);
        }
      }
      const [futuro] = await conn.query('SELECT anio FROM ciclos_lectivos WHERE activo=true AND anio>?', [anio]);
      if (!futuro) {
        await conn.query('UPDATE ciclos_lectivos SET activo=false WHERE activo=true');
        await conn.query('UPDATE ciclos_lectivos SET activo=true WHERE anio=?', [anio]);
      }
    }
    // Registrar la ejecución impide que el cron revierta decisiones manuales posteriores.
    await conn.query('UPDATE ciclos_lectivos SET apertura_automatica_en=clock_timestamp() WHERE anio=?', [anio]);
    await conn.commit();
    return { estado: existente?.cerrado ? 'cerrado_conservado' : 'preparado', anio, cursosCopiados };
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    throw err;
  } finally { if (conn) conn.release(); }
}
module.exports = { asegurarCicloAutomatico, fechaEscolar };
