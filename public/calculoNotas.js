(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./reglasAcademicas'));
 else root.CalculoNotas=factory(root.ReglasAcademicas);
})(typeof globalThis!=='undefined'?globalThis:this,function(reglas){
// ─── lib/calculoNotas.js ───────────────────────────────────────────────────────
// Lógica de cálculo de promedios, replicada desde scriptPlanilla.js (frontend)
// para poder generar el boletín en el servidor con PDFKit.
// IMPORTANTE: esta lógica debe mantenerse en sincronía con scriptPlanilla.js
// si en el futuro se modifican las reglas de negocio de promedios.

function esParticipacion(tipo) {
  return (tipo || "").toLowerCase().includes("particip");
}

function esCierre(ev) {
  const c = Number(ev.cierre);
  return c === 1 || c === 2;
}

function esImportadoExcel(ev) {
  return String(ev.descripcion || "").trim() === "Importado desde Excel";
}

function esOverrideImport(ev, campo) {
  return String(ev.descripcion || "").trim() === `Import override:${campo}`;
}

function ultimaNota(lista) {
  if (!lista || lista.length === 0) return null;
  const last = lista.reduce((a, b) => Number(a.id) > Number(b.id) ? a : b);
  return Number(last.nota);
}

function notaImportadaBimestre(evaluacionesAlumno, num) {
  return ultimaNota(evaluacionesAlumno.filter(e =>
    esImportadoExcel(e) && Number(e.bimestre) === Number(num) && !esCierre(e)
  ));
}

function notaOverrideCampo(evaluacionesAlumno, campo) {
  return ultimaNota(evaluacionesAlumno.filter(e => esOverrideImport(e, campo)));
}

function formatearNotaNum(n) {
  return Number(n).toFixed(2);
}

// ─── Saldadas ──────────────────────────────────────────────────────────────────

function calcularSaldadas(evaluacionesAlumno) {
  const saldadas  = new Set();
  const notaPorId = new Map();

  for (const ev of evaluacionesAlumno) {
    notaPorId.set(Number(ev.id), Number(ev.nota));
  }
  for (const ev of evaluacionesAlumno) {
    if (Number(ev.es_acumulativo) === 1 && ev.evaluacion_origen_id != null) {
      if (Number(ev.nota) >= 6) {
        const origenId   = Number(ev.evaluacion_origen_id);
        const notaOrigen = notaPorId.get(origenId);
        if (notaOrigen !== undefined && notaOrigen < 6) {
          saldadas.add(origenId);
        }
      }
    }
  }

  // Un valor importado ≥ 6 en el bimestre salda las evaluaciones pendientes de ese período
  for (const num of [1, 2, 3, 4]) {
    const imp = notaImportadaBimestre(evaluacionesAlumno, num);
    if (imp === null || imp < 6) continue;
    for (const ev of evaluacionesAlumno) {
      if (esImportadoExcel(ev)) continue;
      if (esCierre(ev) || esParticipacion(ev.tipo)) continue;
      if (Number(ev.bimestre) !== num) continue;
      if (Number(ev.nota) < 6) saldadas.add(Number(ev.id));
    }
  }

  return saldadas;
}

// ─── Bimestre visual ───────────────────────────────────────────────────────────

function calcularBimestre(evaluacionesAlumno, num) {
  const importada = notaImportadaBimestre(evaluacionesAlumno, num);
  if (importada !== null) return formatearNotaNum(importada);

  const evaluaciones = evaluacionesAlumno.filter(
    e => Number(e.bimestre) === Number(num) && !esCierre(e)
  );
  if (evaluaciones.length === 0) return "-";

  const saldadas        = calcularSaldadas(evaluacionesAlumno);
  const participaciones = evaluaciones.filter(e =>  esParticipacion(e.tipo));
  const normales        = evaluaciones.filter(e => !esParticipacion(e.tipo));

  for (const saldada of normales.filter(e => saldadas.has(Number(e.id)))) {
    const acumulativa = evaluacionesAlumno.find(
      e =>
        Number(e.es_acumulativo) === 1 &&
        Number(e.evaluacion_origen_id) === Number(saldada.id) &&
        Number(e.nota) >= 6
    );
    if (acumulativa && Number(acumulativa.bimestre) !== Number(num)) {
      return "En proceso";
    }
  }

  const paraPromedio = normales.filter(e => !saldadas.has(Number(e.id)));
  if (paraPromedio.some(e => Number(e.nota) < 6)) return "En proceso";
  if (paraPromedio.length === 0 && participaciones.length === 0) return "-";

  const promedioBase = paraPromedio.length > 0
    ? paraPromedio.reduce((s, e) => s + Number(e.nota), 0) / paraPromedio.length
    : 0;
  const ajuste = participaciones.reduce((s, e) => s + reglas.valorParticipacion(e), 0);
  return (promedioBase + ajuste).toFixed(2);
}

// ─── Bimestre numérico (para Excel) ───────────────────────────────────────────
// Igual que calcularBimestre pero SIEMPRE retorna el promedio como número (string "N.NN")
// aunque haya notas pendientes. El Excel colorea en rojo si el valor < 6.

function calcularBimestreNumerico(evaluacionesAlumno, num) {
  if(evaluacionesAlumno.some(e=>Number(e.bimestre)===Number(num)&&e.nota_conceptual))return reglas.EN_PROCESO;
  const importada = notaImportadaBimestre(evaluacionesAlumno, num);
  if (importada !== null) return formatearNotaNum(importada);

  const evaluaciones = evaluacionesAlumno.filter(
    e => Number(e.bimestre) === Number(num) && !esCierre(e)
  );
  if (evaluaciones.length === 0) return "-";

  const saldadas        = calcularSaldadas(evaluacionesAlumno);
  const participaciones = evaluaciones.filter(e =>  esParticipacion(e.tipo));
  const normales        = evaluaciones.filter(e => !esParticipacion(e.tipo));
  const paraPromedio    = normales.filter(e => !saldadas.has(Number(e.id)));

  if (paraPromedio.length === 0 && participaciones.length === 0) return "-";

  const promedioBase = paraPromedio.length > 0
    ? paraPromedio.reduce((s, e) => s + Number(e.nota), 0) / paraPromedio.length
    : 0;
  const ajuste = participaciones.reduce((s, e) => s + reglas.valorParticipacion(e), 0);
  return (promedioBase + ajuste).toFixed(2);
}

// ─── Bimestre efectivo (para cuatrimestre) ────────────────────────────────────

function calcularBimestreEfectivo(evaluacionesAlumno, num) {
  const importada = notaImportadaBimestre(evaluacionesAlumno, num);
  if (importada !== null) return formatearNotaNum(importada);

  const evaluaciones = evaluacionesAlumno.filter(
    e => Number(e.bimestre) === Number(num) && !esCierre(e)
  );
  if (evaluaciones.length === 0) return "-";

  const saldadas        = calcularSaldadas(evaluacionesAlumno);
  const participaciones = evaluaciones.filter(e =>  esParticipacion(e.tipo));
  const normales        = evaluaciones.filter(e => !esParticipacion(e.tipo));
  const paraPromedio    = normales.filter(e => !saldadas.has(Number(e.id)));

  if (paraPromedio.some(e => Number(e.nota) < 6)) return "En proceso";
  if (paraPromedio.length === 0 && participaciones.length === 0) return "-";

  const promedioBase = paraPromedio.length > 0
    ? paraPromedio.reduce((s, e) => s + Number(e.nota), 0) / paraPromedio.length
    : 0;
  const ajuste = participaciones.reduce((s, e) => s + reglas.valorParticipacion(e), 0);
  return (promedioBase + ajuste).toFixed(2);
}

function calcularCuatrimestre(evaluacionesAlumno, b1, b2) {
  const campo = Number(b1) === 1 ? "cq1" : "cq2";
  const override = notaOverrideCampo(evaluacionesAlumno, campo);
  if (override !== null) return formatearNotaNum(override);

  const ef1 = calcularBimestreEfectivo(evaluacionesAlumno, b1);
  const ef2 = calcularBimestreEfectivo(evaluacionesAlumno, b2);
  if (ef1 === "En proceso" || ef2 === "En proceso") return "En proceso";
  const nums = [ef1, ef2].filter(n => n !== "-").map(Number);
  if (nums.length === 0) return "-";
  return (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2);
}

function necesitaCierres(cuat1, cuat2) {
  if (cuat1 === "En proceso" || cuat2 === "En proceso") return true;
  const nums = [cuat1, cuat2].filter(n => n !== "-").map(Number);
  if (nums.length === 0) return false;
  return nums.reduce((a, b) => a + b, 0) / nums.length < 6;
}

// ─── Estado de cierres ─────────────────────────────────────────────────────────

function estadoCierre1(evaluacionesAlumno) {
  const temas = evaluacionesAlumno.filter(e => Number(e.cierre) === 1);
  if (temas.length === 0) return null;
  const pendientes = temas.filter(e => Number(e.nota) < 6);
  const prom = temas.reduce((s, e) => s + Number(e.nota), 0) / temas.length;
  return {
    temas,
    aprobado: pendientes.length === 0,
    promedio: parseFloat(prom.toFixed(2)),
    pendientes
  };
}

function estadoCierre2(evaluacionesAlumno) {
  const temas = evaluacionesAlumno.filter(e => Number(e.cierre) === 2);
  if (temas.length === 0) return null;
  const pendientes = temas.filter(e => Number(e.nota) < 6);
  const prom = temas.reduce((s, e) => s + Number(e.nota), 0) / temas.length;
  return {
    temas,
    aprobado: pendientes.length === 0,
    promedio: parseFloat(prom.toFixed(2)),
    pendientes
  };
}

/**
 * Calcula el resumen completo de una materia para un alumno:
 * bimestres, cuatrimestres, cierres y nota final.
 * Esta es la función principal que usa el generador de boletines.
 */
function calcularResumenMateria(evaluacionesAlumno) {
  const prom1 = calcularBimestre(evaluacionesAlumno, 1);
  const prom2 = calcularBimestre(evaluacionesAlumno, 2);
  const prom3 = calcularBimestre(evaluacionesAlumno, 3);
  const prom4 = calcularBimestre(evaluacionesAlumno, 4);

  const cuat1 = calcularCuatrimestre(evaluacionesAlumno, 1, 2);
  const cuat2 = calcularCuatrimestre(evaluacionesAlumno, 3, 4);

  const habCierres = necesitaCierres(cuat1, cuat2);

  const ec1 = estadoCierre1(evaluacionesAlumno);
  const ec2 = estadoCierre2(evaluacionesAlumno);

  const final = reglas.calcularNotaFinal({evaluaciones:evaluacionesAlumno,cuat1,cuat2,requiereCierres:habCierres,
    diciembre:ec1,febrero:ec2,override:notaOverrideCampo(evaluacionesAlumno,"nf"),saldadas:calcularSaldadas(evaluacionesAlumno)});

  return {
    bimestre1: prom1,
    bimestre2: prom2,
    bimestre3: prom3,
    bimestre4: prom4,
    // Versiones numéricas de los bimestres: para el Excel, donde "En proceso" se
    // reemplaza por el promedio real coloreado en rojo.
    bimestre1Num: calcularBimestreNumerico(evaluacionesAlumno, 1),
    bimestre2Num: calcularBimestreNumerico(evaluacionesAlumno, 2),
    bimestre3Num: calcularBimestreNumerico(evaluacionesAlumno, 3),
    bimestre4Num: calcularBimestreNumerico(evaluacionesAlumno, 4),
    cuatrimestre1: cuat1,
    cuatrimestre2: cuat2,
    cierre1: ec1 ? ec1.promedio.toFixed(2) : "-",
    cierre1Aprobado: ec1 ? ec1.aprobado : null,
    cierre2: ec2 ? ec2.promedio.toFixed(2) : "-",
    cierre2Aprobado: ec2 ? ec2.aprobado : null,
    notaFinal: final
  };
}

return { esParticipacion,esCierre,esImportadoExcel,esOverrideImport,ultimaNota,notaImportadaBimestre,notaOverrideCampo,formatearNotaNum,calcularSaldadas,calcularBimestre,calcularBimestreNumerico,calcularBimestreEfectivo,calcularCuatrimestre,necesitaCierres,estadoCierre1,estadoCierre2,calcularResumenMateria };
});
