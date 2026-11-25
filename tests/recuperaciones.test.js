const {test}=require('node:test');
const assert=require('node:assert/strict');
const {puedeRecuperar}=require('../public/reglasAcademicas');
const {validarPeriodoDiciembre}=require('../public/reglasAcademicas');

test('Diciembre se habilita por el reloj real de Buenos Aires, sin permitir fechas de otro mes',()=>{
 for(const mes of [1,2,3,4,5,6,7,8,9,10,11]){
  assert.ok(validarPeriodoDiciembre(1,'2026-12-15',new Date(`2026-${String(mes).padStart(2,'0')}-15T15:00:00Z`)));
 }
 const diciembre=new Date('2026-12-15T15:00:00Z');
 assert.equal(validarPeriodoDiciembre(1,'2026-12-15',diciembre),null);
 assert.ok(validarPeriodoDiciembre(1,'2026-08-15',diciembre));
 assert.ok(validarPeriodoDiciembre(1,'2026-12-15',new Date('2026-12-01T02:59:59Z')));
 assert.equal(validarPeriodoDiciembre(1,'2026-12-01',new Date('2026-12-01T03:00:00Z')),null);
 assert.equal(validarPeriodoDiciembre(1,undefined,new Date('2027-01-01T02:59:59Z')),null);
 assert.ok(validarPeriodoDiciembre(1,undefined,new Date('2027-01-01T03:00:00Z')));
 assert.equal(validarPeriodoDiciembre(0,'2026-08-15',diciembre),null);
 assert.ok(validarPeriodoDiciembre(2,'2026-02-15',diciembre));
});

test('Febrero y diciembre respetan las habilitaciones y bloqueos manuales',()=>{
 for(const [cierre,mes] of [[1,'12'],[2,'02']]){
  const natural=new Date(`2026-${mes}-15T15:00:00Z`),agosto=new Date('2026-08-15T15:00:00Z');
  assert.equal(validarPeriodoDiciembre(cierre,`2026-${mes}-15`,natural),null);
  assert.ok(validarPeriodoDiciembre(cierre,undefined,natural,'bloqueado'));
  assert.ok(validarPeriodoDiciembre(cierre,undefined,agosto));
  assert.equal(validarPeriodoDiciembre(cierre,'2026-08-15',agosto,'habilitado'),null);
  assert.ok(validarPeriodoDiciembre(cierre,'2026-08-15',natural));
 }
});

test('Un plazo se activa al iniciar y se bloquea al finalizar según Buenos Aires',()=>{
 const plazo={desde:'2026-12-10',hasta:'2026-12-20'};
 for(const cierre of [1,2]){
  assert.ok(validarPeriodoDiciembre(cierre,undefined,new Date('2026-12-10T02:59:59Z'),'programado',plazo));
  assert.equal(validarPeriodoDiciembre(cierre,'2026-12-10',new Date('2026-12-10T03:00:00Z'),'programado',plazo),null);
  assert.equal(validarPeriodoDiciembre(cierre,undefined,new Date('2026-12-21T02:59:59Z'),'programado',plazo),null);
  assert.ok(validarPeriodoDiciembre(cierre,undefined,new Date('2026-12-21T03:00:00Z'),'programado',plazo));
  assert.ok(validarPeriodoDiciembre(cierre,'2026-12-09',new Date('2026-12-15T15:00:00Z'),'programado',plazo));
  assert.ok(validarPeriodoDiciembre(cierre,undefined,new Date('2026-12-15T15:00:00Z'),'programado',{}));
 }
});
test('Una evaluación del tercer bimestre solo se recupera en tercero o cuarto',()=>{
 const original={alumno_id:1,nota:4,tipo:'Examen escrito',bimestre:3,fecha:'2026-08-01'};
 for(const b of [1,2,0])assert.ok(puedeRecuperar(original,1,'2026-10-01',0,b));
 for(const b of [3,4])assert.equal(puedeRecuperar(original,1,'2026-10-01',0,b),null);
 assert.ok(puedeRecuperar(original,1,'2026-07-01',0,3));
});
