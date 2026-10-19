import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {JumpDetector} from '../../src/jump.js';
import {Retargeter} from '../../src/tracking.js';
import {createLegSolver,LEG_LIMITS} from '../../src/legs.js';

const angle=(a,b)=>Math.acos(Math.max(-1,Math.min(1,a.reduce((s,x,i)=>s+x*b[i],0))));
const visible=new Set([11,12,23,24,27,28,29,30,31,32]);
function body(height=0){
 const p=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:0}));
 for(const [a,b,y] of [[11,12,.3],[23,24,.55],[27,28,.87],[29,30,.90],[31,32,.92]]){
  p[a]={x:.6,y:y-height,z:0,visibility:.9};p[b]={x:.4,y:y-height,z:0,visibility:.9};
 }
 return p;
}
function ready(){const d=new JumpDetector();for(let t=0;t<=400;t+=50)d.update(body(),visible,t);return d;}
test('un salto breve a ocho muestras por segundo se confirma antes del aterrizaje',()=>{
 const d=ready();d.update(body(.012),visible,525);d.update(body(.07),visible,650);
 assert.equal(d.count,1);assert.equal(d.active,true);assert.ok(d.height>.2);
 d.update(body(),visible,775);d.update(body(),visible,900);assert.equal(d.active,false);assert.equal(d.count,1);
});
test('talones y puntas conservan el salto al perder ambos tobillos',()=>{
 const d=ready(),feet=new Set([...visible].filter(i=>i!==27&&i!==28));
 d.update(body(.06),feet,450);d.update(body(.075),feet,500);
 assert.equal(d.count,1);assert.ok(d.height>.2);
});
test('ponerse de puntillas no cuenta si las puntas siguen apoyadas',()=>{
 const d=ready(),p=body(.055);for(const i of [31,32])p[i].y=body()[i].y;
 for(let t=450;t<=950;t+=50)d.update(p,visible,t);
 assert.equal(d.count,0);assert.equal(d.height,0);
});
test('flexionar el torso al despegar no cancela un salto real',()=>{
 const d=ready();
 for(let t=450;t<=600;t+=50){const p=body(.06);p[11].y+=.06;p[12].y+=.06;d.update(p,visible,t);}
 assert.equal(d.count,1);assert.equal(d.active,true);
});
test('una pérdida breve de un pie durante el vuelo conserva la altura',()=>{
 const d=ready();d.update(body(.05),visible,450);d.update(body(.08),visible,500);
 const one=new Set([...visible].filter(i=>![28,30,32].includes(i)));
 d.update(body(.09),one,550);assert.equal(d.active,true);assert.ok(d.height>.2);assert.equal(d.count,1);
});

function motionPose(a){
 const p=body(),w=Array.from({length:33},()=>({x:0,y:0,z:0}));
 const coordinates={11:[.2,-.5,0],12:[-.2,-.5,0],23:[.12,0,0],24:[-.12,0,0],
  13:[.2+.32*Math.sin(a),-.5+.32*Math.cos(a),0],14:[-.35,-.2,0],
  15:[.2+.6*Math.sin(a),-.5+.6*Math.cos(a),0],16:[-.45,0,0],
  25:[.12,.3,0],26:[-.12,.3,0],27:[.12,.6,0],28:[-.12,.6,0],29:[.12,.6,.03],30:[-.12,.6,.03],31:[.12,.6,-.1],32:[-.12,.6,-.1]};
 for(const [i,c] of Object.entries(coordinates)){w[i]={x:c[0],y:c[1],z:c[2]};p[i]={x:.5+c[0]*.3,y:.4+c[1]*.3,z:c[2],visibility:.9,presence:1};}
 return {landmarks:[p],worldLandmarks:[w]};
}
test('un brazo rápido y continuo no se congela al recibir ocho muestras por segundo',()=>{
 const t=new Retargeter();let worst=0;
 for(let i=0;i<40;i++){
  const a=i*1.35,m=t.updatePose(motionPose(a),i*125),target=[-Math.sin(a),-Math.cos(a),0];
  if(i>2)worst=Math.max(worst,angle(m.directions.left_upper,target));
 }
 assert.ok(worst<.35,'Desfase angular: '+worst);
});
test('la pierna conserva puntos moderados durante el movimiento',()=>{
 const t=new Retargeter();t.updatePose(motionPose(0),0);
 const p=motionPose(.2);for(const i of [25,27,29,31])p.landmarks[0][i].visibility=.3;
 t.updatePose(p,100);assert.equal(t.motion.legCounts[0],5);
});
test('las rodillas conservan una bisagra y rotaciones válidas durante baile y giros',()=>{
 const solve=createLegSolver(THREE);
 for(let i=0;i<1200;i++){
  const t=i/60,thigh=new THREE.Vector3(Math.sin(t*3)*.5,-1,Math.cos(t*4)*.5).normalize();
  const rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,-1,0),thigh);
  const shin=new THREE.Vector3(0,-1,0).applyAxisAngle(new THREE.Vector3(1,0,0),1.2+Math.sin(t*5)).applyQuaternion(rotation);
  const result=solve({thigh:thigh.toArray(),shin:shin.toArray(),dt:1/60});
  assert.ok(result.knee>=0&&result.knee<=LEG_LIMITS.knee);
  assert.ok(result.thighRotation.toArray().every(Number.isFinite));
  assert.ok(Math.abs(result.shinLocal.y)<1e-10&&Math.abs(result.shinLocal.z)<1e-10);
  assert.ok(result.thighDirection.angleTo(thigh)<1e-6);
  assert.ok(Math.abs(result.shinDirection.length()-1)<1e-8);
 }
});
test('la rodilla limita una flexión imposible sin invertir el hueso',()=>{
 const result=createLegSolver(THREE)({thigh:[0,-1,0],shin:[0,.999,-.01],dt:.016});
 assert.equal(result.knee,LEG_LIMITS.knee);assert.ok(Number.isFinite(result.shinDirection.z));
});

test('doblar la rodilla hacia atrás no gira el muslo ni su armadura media vuelta',()=>{
 const solve=createLegSolver(THREE);let result;
 for(let i=0;i<30;i++)solve({thigh:[0,-1,0],shin:[0,-1,0]});
 for(let i=0;i<60;i++)result=solve({thigh:[0,-1,0],shin:[0,-Math.cos(.4),-Math.sin(.4)]});
 assert.ok(result.thighRotation.angleTo(new THREE.Quaternion())<.02);
 assert.ok(Math.abs(result.knee-.4)<.01);
});

test('ruido de hiperextensión no invierte la rodilla de una pierna apoyada',()=>{
 const solve=createLegSolver(THREE);let previous;
 for(let i=0;i<180;i++){
  const result=solve({thigh:[0,-1,0],shin:[0,-1,Math.sin(i*.7)*.12],dt:1/60});
  if(previous)assert.ok(result.thighRotation.angleTo(previous)<.08);
  assert.ok(new THREE.Vector3(0,0,1).applyQuaternion(result.thighRotation).z>.97);
  previous=result.thighRotation;
 }
});
test('girar la pierna y el pie 90 grados conserva la flexión de rodilla y el eje de cadera',()=>{
 const solve=createLegSolver(THREE),bend=Math.PI/3,shin=[-Math.sin(bend),-Math.cos(bend),0];let result;
 for(let i=0;i<90;i++)result=solve({thigh:[0,-1,0],shin,foot:[1,0,0],reference:[0,0,1],dt:1/60});
 assert.ok(Math.abs(result.knee-bend)<.02,'El giro lateral dejó la rodilla recta: '+result.knee);
 assert.ok(result.shinDirection.angleTo(new THREE.Vector3(...shin))<.03);
});
