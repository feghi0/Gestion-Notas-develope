// Carga explícita e idempotente de datos ficticios. No envía correos.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const pool = require('../db/connection');
const { cursoAbierto } = require('../lib/ciclosLectivos');
const MATERIAS = ['Programación Sobre Redes', 'Administración de Sistemas y Redes', 'Desarrollo de Sistemas', 'Gestión de los Procesos Productivos', 'Matemática', 'Ciudadanía y Trabajo', 'Ciencia y Tecnología', 'Inglés', 'Prácticas Profesionalizantes'];
const anio = 2026;
const personas = [
  ...Array.from({ length: 30 }, (_, i) => ({ dni: String(91000000 + i), nombre: `Alumno ${String(i + 1).padStart(2, '0')}`, apellido: 'Testing 6º2', rango: 'alumno', detalle: '' })),
  ...MATERIAS.map((materia, i) => ({ dni: String(92000000 + i), nombre: `Profesor ${String(i + 1).padStart(2, '0')}`, apellido: 'Testing 6º2', rango: 'profesor', detalle: materia })),
  { dni: '93000000', nombre: 'Preceptor', apellido: 'Testing 6º2', rango: 'preceptor', detalle: '6º2 mañana' }
];
async function ejecutar() {
  if (!process.argv.includes('--apply')) { console.log('Para cargar el curso ficticio 6º2 mañana / 2026: node scripts/seed-curso-testing.js --apply'); return; }
  let conn;
  try {
    if (!process.env.DATABASE_URL?.includes('chbpvymjssniakvklity')) throw new Error('Proyecto de destino inesperado. Revisá DATABASE_URL.');
    const hashes = await Promise.all(personas.map(() => bcrypt.hash('hola1234', 10)));
    conn = await pool.getConnection(); await conn.beginTransaction();
    await conn.query('SELECT pg_advisory_xact_lock(636123)');
    await conn.query("SELECT set_config('app.audit_source','seed:testing_6_2_2026',true)");
    let [curso] = await conn.query("SELECT * FROM cursos WHERE ciclo_lectivo=? AND anio=6 AND division='2' AND turno='manana' ORDER BY id LIMIT 1", [anio]);
    if (!curso) {
      const [ciclo] = await conn.query('SELECT cerrado FROM ciclos_lectivos WHERE anio=?', [anio]);
      if (!ciclo || ciclo.cerrado) throw new Error('El ciclo 2026 debe existir y estar abierto.');
      const result = await conn.query("INSERT INTO cursos (anio,division,turno,ciclo_lectivo,es_testing) VALUES (6,'2','manana',?,true)", [anio]); curso = { id: result.insertId };
    }
    await cursoAbierto(conn, curso.id);
    // No convertir en testing un curso con cuentas reales o ajenas a esta carga.
    const miembros = await conn.query(`SELECT u.dni FROM usuarios u WHERE u.id IN (
      SELECT alumno_id FROM alumno_curso WHERE curso_id=? UNION SELECT preceptor_id FROM preceptor_curso WHERE curso_id=?
      UNION SELECT pm.profesor_id FROM profesor_materia pm JOIN curso_materia cm ON cm.id=pm.curso_materia_id WHERE cm.curso_id=?)`, [curso.id, curso.id, curso.id]);
    const dnis = new Set(personas.map(p => p.dni));
    if (miembros.some(p => !dnis.has(p.dni))) throw new Error('6º2 ya contiene cuentas ajenas a esta carga. No se modificó.');
    await conn.query('UPDATE cursos SET es_testing=true WHERE id=?', [curso.id]);
    for (let i = 0; i < personas.length; i++) {
      const p = personas[i];
      const [existente] = await conn.query('SELECT id,rango,nombre,apellido FROM usuarios WHERE dni=? OR usuario=?', [p.dni, p.dni]);
      if (existente && (existente.rango !== p.rango || existente.apellido !== p.apellido || existente.nombre !== p.nombre)) throw new Error(`El DNI ficticio ${p.dni} ya está ocupado. No se modificó.`);
      if (existente) p.id = existente.id;
      else p.id = (await conn.query(`INSERT INTO usuarios (usuario,password,nombre,apellido,dni,rango,permiso,debe_cambiar_password,email_usuario,email_familiar)
        VALUES (?,?,?,?,?,?,?,0,'','')`, [p.dni, hashes[i], p.nombre, p.apellido, p.dni, p.rango, p.rango === 'profesor' ? 'escritura' : 'lectura'])).insertId;
    }
    const alumnos = personas.filter(p => p.rango === 'alumno');
    for (const a of alumnos) await conn.query('INSERT INTO alumno_curso (alumno_id,curso_id) VALUES (?,?) ON CONFLICT (alumno_id,curso_id) DO NOTHING', [a.id, curso.id]);
    const preceptor = personas.find(p => p.rango === 'preceptor');
    await conn.query('INSERT INTO preceptor_curso (preceptor_id,curso_id) VALUES (?,?) ON CONFLICT (preceptor_id,curso_id) DO NOTHING', [preceptor.id, curso.id]);
    let notasCreadas = 0;
    for (let m = 0; m < MATERIAS.length; m++) {
      let [materia] = await conn.query('SELECT id FROM materias WHERE nombre=? ORDER BY id LIMIT 1', [MATERIAS[m]]);
      if (!materia) materia = { id: (await conn.query('INSERT INTO materias (nombre) VALUES (?)', [MATERIAS[m]])).insertId };
      let [cm] = await conn.query('SELECT id FROM curso_materia WHERE curso_id=? AND materia_id=?', [curso.id, materia.id]);
      if (!cm) cm = { id: (await conn.query('INSERT INTO curso_materia (curso_id,materia_id,dias,horario) VALUES (?,?,?,?)', [curso.id, materia.id, ['Lunes','Martes','Miércoles','Jueves','Viernes'][m % 5], m % 2 ? '09:30 a 10:50' : '08:00 a 09:20'])).insertId };
      await conn.query('INSERT INTO profesor_materia (profesor_id,curso_materia_id) VALUES (?,?) ON CONFLICT (profesor_id,curso_materia_id) DO NOTHING', [personas[30 + m].id, cm.id]);
      for (let b = 1; b <= 4; b++) for (let actividad = 1; actividad <= 2; actividad++) {
        const descripcion = `Testing 6º2 · B${b} · Actividad ${actividad}`;
        let [evaluacion] = await conn.query('SELECT id FROM evaluaciones WHERE curso_materia_id=? AND descripcion=? ORDER BY id LIMIT 1', [cm.id, descripcion]);
        if (!evaluacion) evaluacion = { id: (await conn.query(`INSERT INTO evaluaciones (curso_materia_id,tipo,descripcion,fecha,bimestre)
          VALUES (?,'Evaluación',?,?,?)`, [cm.id, descripcion, `${anio}-${String([0,3,5,8,10][b]).padStart(2, '0')}-${actividad === 1 ? '10' : '20'}`, b])).insertId };
        const filasNotas = [];
        for (let i = 0; i < alumnos.length; i++) {
          if (i >= 28 || (i >= 26 && (m + b) % 2 === 0)) continue;
          const nota = i < 10 ? 7 + (i + m + b + actividad) % 4
            : i < 18 ? ((i + m) % 4 === 0 ? 4 + (b + actividad) % 2 : 6 + (m + b + actividad) % 4)
            : (i + m) % 3 === 0 ? 6 + (b + actividad) % 3 : 2 + (i + m + b + actividad) % 4;
          filasNotas.push({ alumno_id: alumnos[i].id, nota });
        }
        const result = await conn.query(`INSERT INTO notas (evaluacion_id,alumno_id,nota)
          SELECT ?,x.alumno_id,x.nota FROM jsonb_to_recordset(?::jsonb) AS x(alumno_id integer,nota numeric)
          ON CONFLICT (evaluacion_id,alumno_id) DO NOTHING`, [evaluacion.id, JSON.stringify(filasNotas)]);
        notasCreadas += result.affectedRows;
      }
      console.log(`Materia ${m + 1}/${MATERIAS.length} preparada.`);
    }
    const [cuentas] = await conn.query(`SELECT (SELECT count(*) FROM alumno_curso WHERE curso_id=?) alumnos,
      (SELECT count(*) FROM curso_materia WHERE curso_id=?) materias,
      (SELECT count(*) FROM preceptor_curso WHERE curso_id=?) preceptores`, [curso.id, curso.id, curso.id]);
    if (Number(cuentas.alumnos) !== 30 || Number(cuentas.materias) !== 9 || Number(cuentas.preceptores) !== 1) throw new Error('La estructura no coincide con 30 alumnos, 9 materias y 1 preceptor. No se modificó.');
    await conn.commit();
    const archivo = path.resolve('.local', 'cuentas-testing-6-2-2026.csv'); fs.mkdirSync(path.dirname(archivo), { recursive: true });
    const celda = v => `"${String(v).replace(/"/g, '""')}"`;
    const filas = [['Rol','DNI / usuario','Nombre','Apellido','Materia / curso','Contraseña'], ...personas.map(p => [p.rango,p.dni,p.nombre,p.apellido,p.detalle,'hola1234'])];
    fs.writeFileSync(archivo, '\ufeff' + filas.map(f => f.map(celda).join(';')).join('\r\n'), 'utf8');
    console.log(JSON.stringify({ cursoId: curso.id, ciclo: anio, ...cuentas, profesores: 9, notasCreadas, cuentasCSV: archivo, correosEnviados: 0 }));
  } catch (err) { if (conn) await conn.rollback().catch(() => {}); throw err; }
  finally { if (conn) conn.release(); }
}
if (require.main === module) ejecutar().catch(err => { console.error(err.message); process.exitCode = 1; }).finally(() => pool.end());
