import test from 'node:test';
import assert from 'node:assert/strict';
import {PersonLock} from '../../src/person.js';
function person({x=.5,y=0,scale=1,color=[.55,.25,.2],brightness=.5}={}){
 const points=Array.from({length:33},()=>({x,y:.4+ y,z:0,visibility:.9}));
 for(const [a,b,height,half] of [[11,12,.3,.12],[23,24,.55,.08],[15,16,.5,.23],[27,28,.9,.08]]){
  points[a]={x:x+half*scale,y:.55+(height-.55)*scale+y,z:0,visibility:.9};
  points[b]={x:x-half*scale,y:.55+(height-.55)*scale+y,z:0,visibility:.9};
 }
 points[0]={x,y:.55+(.18-.55)*scale+y,z:0,visibility:.9};
 return {points,color:{rgb:color,brightness}};
}
const result=(...people)=>({landmarks:people.map(p=>p.points),worldLandmarks:people.map(()=>Array.from({length:33},()=>({x:0,y:0,z:0}))),appearances:people.map(p=>p.color)});
const ready=(p=person())=>{const lock=new PersonLock();lock.select(result(p),0);lock.select(result(p),50);return lock;};
test('el inicio confirma al cuerpo con muestras separadas por 650 ms',()=>{
 const lock=new PersonLock(),owner=person();
 assert.equal(lock.select(result(owner),0).landmarks.length,0);
 assert.equal(lock.reason,'confirming');
 assert.equal(lock.select(result(owner),650).landmarks[0],owner.points);
 assert.equal(lock.state,'tracking');
});
test('anclas moderadas necesitan tres observaciones, también con un detector lento',()=>{
 const lock=new PersonLock(),owner=person();
 for(const i of [11,12,23,24])owner.points[i].visibility=.38;
 assert.equal(lock.select(result(owner),0).landmarks.length,0);
 assert.equal(lock.select(result(owner),900).landmarks.length,0);
 assert.equal(lock.select(result(owner),1800).landmarks[0],owner.points);
 const absent=new PersonLock();
 for(const i of [11,12,23,24])owner.points[i].presence=.12;
 for(const time of [0,900,1800])assert.equal(absent.select(result(owner),time).landmarks.length,0);
});
test('una secuencia inicial inconsistente o antigua no confirma a otra persona',()=>{
 const lock=new PersonLock(),owner=person(),other=person({scale:.4});
 lock.select(result(owner),100);
 assert.equal(lock.select(result(owner),50).landmarks.length,0);
 assert.equal(lock.select(result(other),750).landmarks.length,0);
 assert.equal(lock.select(result(owner),1400).landmarks.length,0);
 assert.equal(lock.select(result(owner),2050).landmarks[0],owner.points);
 const stale=new PersonLock();stale.select(result(owner),0);
 assert.equal(stale.select(result(owner),2000).landmarks.length,0);
});
test('la exposición cambia sin entregar el cuerpo a una camiseta de otro color',()=>{
 const lock=ready(),dim=person({brightness:.09});
 assert.equal(lock.select(result(dim),250).landmarks[0],dim.points);
 assert.equal(lock.select(result(person({color:[.2,.3,.5],brightness:.09})),450).landmarks.length,0);
 assert.equal(lock.select(result(person({brightness:.5})),650).landmarks.length,1);
});
test('un desplazamiento entre muestras lentas se acepta, pero una pérdida larga conserva el límite',()=>{
 const lock=ready(),moved=person({x:.79,y:-.1});
 assert.equal(lock.select(result(moved),700).landmarks[0],moved.points);
 const lost=ready();
 assert.equal(lost.select(result(person({x:.85})),5000).landmarks.length,0);
});
test('al iniciar no se fija a alguien que sólo entra por un lateral',()=>{
 const lock=new PersonLock(),edge=person({x:.85});
 lock.select(result(edge),0);assert.equal(lock.select(result(edge),50).landmarks.length,0);
 assert.equal(lock.state,'searching');
 const owner=person();lock.select(result(owner),100);assert.equal(lock.select(result(owner),150).landmarks[0],owner.points);
});
test('se fija una sola persona y el orden de candidatos no cambia su identidad',()=>{
 const owner=person(),other=person({x:.8,color:[.2,.3,.5]}),lock=ready(owner);
 for(let frame=1;frame<=20;frame++){
  const people=frame%2?[other,owner]:[owner,other],selected=lock.select(result(...people),50+frame*50);
  assert.equal(selected.landmarks.length,1);assert.equal(selected.landmarks[0],owner.points);
 }
});
test('otra persona no sustituye al usuario si lo tapa o si sale de la imagen',()=>{
 const owner=person(),lock=ready(owner);
 for(let time=100;time<=5000;time+=100){
  const rejected=lock.select(result(person({x:.5,color:[.2,.3,.5]})),time);
  assert.equal(rejected.landmarks.length,0);assert.equal(lock.state,'holding');
 }
 assert.equal(lock.select(result(owner),5100).landmarks[0],owner.points);
});
test('una persona más lejos o en otro lugar se rechaza aunque lleve ropa parecida',()=>{
 const lock=ready();
 assert.equal(lock.select(result(person({x:.85})),100).landmarks.length,0);
 assert.equal(lock.select(result(person({scale:.4})),150).landmarks.length,0);
});
test('salir y volver en otra posición y distancia recupera sin apagar la cámara',()=>{
 const lock=ready();
 for(const time of [500,1100,1800])lock.select({landmarks:[],worldLandmarks:[]},time);
 const returned=person({x:.76,scale:.48});
 assert.equal(lock.select(result(returned),2200).landmarks.length,0);
 assert.equal(lock.reason,'reacquiring');
 assert.equal(lock.select(result(returned),2250).landmarks.length,0);
 const accepted=lock.select(result(returned),2300);
 assert.equal(accepted.landmarks[0],returned.points);assert.equal(accepted.reacquired,true);
 assert.equal(lock.state,'tracking');
 assert.equal(lock.select(result(returned),2350).reacquired,undefined);
});
test('la recuperación después de salir no acepta otra ropa ni una sola muestra fugaz',()=>{
 const lock=ready(),other=person({x:.65,color:[.2,.3,.5]}),returned=person({x:.76,scale:.5});
 lock.select({landmarks:[]},500);lock.select({landmarks:[]},1500);
 for(const time of [1800,1850,1900])assert.equal(lock.select(result(other),time).landmarks.length,0);
 lock.select(result(returned),1950);lock.select({landmarks:[]},2000);
 assert.equal(lock.select(result(returned),2050).landmarks.length,0);
 assert.equal(lock.select(result(returned),2100).landmarks.length,0);
 assert.equal(lock.select(result(returned),2150).landmarks[0],returned.points);
});
test('saltar y desplazarse rápido conservan la persona y el recorte mantiene el alto completo',()=>{
 const lock=ready();
 for(let frame=1;frame<=12;frame++){
  const p=person({x:.5+frame*.018,y:-Math.sin(frame/12*Math.PI)*.12});
  assert.equal(lock.select(result(p),50+frame*100).landmarks[0],p.points);
  assert.equal(lock.poseCrop().y,0);assert.equal(lock.poseCrop().height,1);
 }
});
test('el rostro y las manos de un acompañante no se mezclan con el cuerpo fijado',()=>{
 const p=person(),lock=ready(p),pose={points:p.points,visible:new Set([0,15,16]),time:50};
 const own=Array.from({length:21},()=>({...p.points[15]})),stranger=Array.from({length:21},()=>({x:.1,y:.4,z:0}));
 const data={landmarks:[stranger,own],worldLandmarks:[stranger,own],handedness:[[{categoryName:'Left'}],[{categoryName:'Right'}]],gestures:[[],[]]};
 const filtered=lock.filterDetails('hands',data,pose,80);
 assert.equal(filtered.landmarks.length,1);assert.equal(filtered.landmarks[0],own);
 assert.equal(filtered.handedness[0][0].categoryName,'Right');
 const face=Array.from({length:478},()=>({...p.points[0]}));
 assert.equal(lock.filterDetails('face',{faceLandmarks:[face]},pose,80).faceLandmarks[0],face);
 face[1]={x:.9,y:.2,z:0};assert.deepEqual(lock.filterDetails('face',{faceLandmarks:[face]},pose,80),{});
 lock.select(result(person({color:[.2,.3,.5]})),100);
 assert.deepEqual(lock.filterDetails('hands',data,pose,120),{});
});
test('reiniciar permite elegir otra persona y descarta muestras antiguas',()=>{
 const lock=ready(),other=person({x:.7,color:[.2,.3,.5]});
 assert.equal(lock.select(result(other),20).landmarks.length,0);
 lock.reset();lock.select(result(other),200);
 assert.equal(lock.select(result(other),250).landmarks[0],other.points);
});
test('un torso mezclado con las caderas de otra persona no mueve el robot',()=>{
 const lock=ready(),mixed=person();for(const i of [23,24])mixed.points[i].x+=.18;
 assert.equal(lock.select(result(mixed),100).landmarks.length,0);
 assert.equal(lock.select(result(person()),150).landmarks.length,1);
});

test('pasar de hombros cercanos a torso completo compara la misma medida del cuerpo',()=>{
 const partial=person();for(const i of [23,24])partial.points[i].visibility=.1;
 const lock=ready(partial),full=person();
 // Las caderas entran en la imagen al enderezarse; no cambia la anchura de hombros.
 for(const i of [23,24])full.points[i].y=.37;
 assert.equal(lock.select(result(full),100).landmarks[0],full.points);
});

test('alejarse y acercarse conserva la persona al entrar y salir las caderas del encuadre',()=>{
 const lock=ready();
 for(let frame=1;frame<=120;frame++){
  const scale=1-.72*Math.sin(frame/120*Math.PI),owner=person({scale});
  if(frame%14<4)for(const i of [23,24])owner.points[i].visibility=.1;
  const selected=lock.select(result(person({x:.8,color:[.2,.3,.5]}),owner),50+frame*40);
  assert.equal(selected.landmarks[0],owner.points,'Se perdió a distancia en fotograma '+frame);
 }
});
