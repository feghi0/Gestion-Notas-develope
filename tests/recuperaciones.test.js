const {test}=require('node:test');
const assert=require('node:assert/strict');
const {puedeRecuperar}=require('../public/reglasAcademicas');
test('Una evaluación del tercer bimestre solo se recupera en tercero o cuarto',()=>{
 const original={alumno_id:1,nota:4,tipo:'Examen escrito',bimestre:3,fecha:'2026-08-01'};
 for(const b of [1,2,0])assert.ok(puedeRecuperar(original,1,'2026-10-01',0,b));
 for(const b of [3,4])assert.equal(puedeRecuperar(original,1,'2026-10-01',0,b),null);
 assert.ok(puedeRecuperar(original,1,'2026-07-01',0,3));
});
