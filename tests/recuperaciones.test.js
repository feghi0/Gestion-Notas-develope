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
 assert.equal(validarPeriodoDiciembre(2,'2026-02-15',diciembre),null);
});
test('Una evaluación del tercer bimestre solo se recupera en tercero o cuarto',()=>{
 const original={alumno_id:1,nota:4,tipo:'Examen escrito',bimestre:3,fecha:'2026-08-01'};
 for(const b of [1,2,0])assert.ok(puedeRecuperar(original,1,'2026-10-01',0,b));
 for(const b of [3,4])assert.equal(puedeRecuperar(original,1,'2026-10-01',0,b),null);
 assert.ok(puedeRecuperar(original,1,'2026-07-01',0,3));
});
