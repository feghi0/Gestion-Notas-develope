const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const bcrypt = require("bcrypt");

async function buildSeed() {
  const people = [
    ["90000001", "Regente", "Demo", "regente", "ambos"],
    ["90000002", "Docente", "Demo", "profesor", "escritura"],
    ["90000003", "Preceptor", "Demo", "preceptor", "lectura"],
    ["90000004", "Secretaria", "Demo", "secretario", "lectura"],
    ["90000005", "Ana", "Prueba", "alumno", "lectura"],
    ["90000006", "Bruno", "Prueba", "alumno", "lectura"]
  ];
  const quote = value => "'" + String(value).replace(/'/g, "''") + "'";
  const credentials = [];
  let sql = `BEGIN;
-- Rechaza bases con usuarios existentes para no mezclar datos de demostración.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM usuarios) THEN
    RAISE EXCEPTION 'El seed requiere una base sin usuarios';
  END IF;
END $$;
`;
  for (const [dni, nombre, apellido, rango, permiso] of people) {
    const password = randomBytes(18).toString("base64url");
    const hash = await bcrypt.hash(password, 10);
    credentials.push({ dni, rango, password });
    sql += `INSERT INTO usuarios (usuario,password,nombre,apellido,dni,rango,permiso,debe_cambiar_password)
VALUES (${[dni,hash,nombre,apellido,dni,rango,permiso].map(quote).join(",")},1);\n`;
  }
  sql += `
INSERT INTO cursos (anio,division,turno) VALUES (5,'DEMO','manana');
INSERT INTO materias (nombre) VALUES ('Matemática (demo)'),('Programación (demo)');
INSERT INTO curso_materia (curso_id,materia_id,dias,horario)
SELECT c.id,m.id,'Lunes','08:00' FROM cursos c CROSS JOIN materias m
WHERE c.division='DEMO' AND m.nombre LIKE '%(demo)';
INSERT INTO alumno_curso (alumno_id,curso_id)
SELECT u.id,c.id FROM usuarios u CROSS JOIN cursos c WHERE u.rango='alumno' AND c.division='DEMO';
INSERT INTO profesor_materia (profesor_id,curso_materia_id)
SELECT u.id,cm.id FROM usuarios u CROSS JOIN curso_materia cm WHERE u.dni='90000002';
INSERT INTO preceptor_curso (preceptor_id,curso_id)
SELECT u.id,c.id FROM usuarios u CROSS JOIN cursos c WHERE u.dni='90000003' AND c.division='DEMO';
INSERT INTO evaluaciones (curso_materia_id,tipo,descripcion,fecha,bimestre)
SELECT id,'Examen escrito','Evaluación ficticia',CURRENT_DATE,1 FROM curso_materia;
INSERT INTO notas (evaluacion_id,alumno_id,nota)
SELECT e.id,u.id,CASE WHEN u.dni='90000005' THEN 8 ELSE 4 END
FROM evaluaciones e CROSS JOIN usuarios u WHERE u.rango='alumno';
COMMIT;
`;
  return { sql, credentials };
}

if (require.main === module) {
  (async () => {
    const target = path.resolve(".local");
    fs.mkdirSync(target, { recursive: true });
    // No sobrescribir contraseñas ya entregadas.
    if (fs.existsSync(path.join(target, "demo-credentials.json"))) {
      throw new Error("Ya existen credenciales en .local; conservá las del seed generado.");
    }
    const { sql, credentials } = await buildSeed();
    fs.writeFileSync(path.join(target, "seed-demo.sql"), sql, { flag: "wx" });
    fs.writeFileSync(path.join(target, "demo-credentials.json"), JSON.stringify(credentials, null, 2), { flag: "wx", mode: 0o600 });
    console.log("Seed y credenciales creados en .local (excluido de Git y Vercel).");
  })().catch(err => { console.error(err.message); process.exitCode = 1; });
}

module.exports = { buildSeed };
