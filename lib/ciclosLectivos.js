async function obtenerCiclo(conn, solicitado) {
  if (solicitado !== undefined && !/^(20\d{2}|2100)$/.test(String(solicitado))) {
    throw Object.assign(new Error("Ciclo lectivo inválido"), { status: 400 });
  }
  const rows = solicitado === undefined
    ? await conn.query("SELECT anio, activo, cerrado FROM ciclos_lectivos ORDER BY activo DESC, anio DESC LIMIT 1")
    : await conn.query("SELECT anio, activo, cerrado FROM ciclos_lectivos WHERE anio=?", [solicitado]);
  if (!rows.length) throw Object.assign(new Error("Ciclo lectivo no encontrado"), { status: 404 });
  return rows[0];
}
async function cursoAbierto(conn, id, materia = false) {
  const rows = await conn.query(`SELECT cl.anio, cl.cerrado FROM ciclos_lectivos cl
    JOIN cursos c ON c.ciclo_lectivo=cl.anio ${materia ? "JOIN curso_materia cm ON cm.curso_id=c.id" : ""}
    WHERE ${materia ? "cm" : "c"}.id=?`, [id]);
  if (!rows.length) throw Object.assign(new Error("Curso o materia no encontrado"), { status: 404 });
  if (rows[0].cerrado) throw Object.assign(new Error(`El ciclo ${rows[0].anio} está cerrado; solo permite consultas.`), { status: 423 });
  return rows[0];
}
module.exports = { obtenerCiclo, cursoAbierto };
