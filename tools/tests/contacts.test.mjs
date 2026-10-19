import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createLegSolver,createAnkleSolver} from '../../src/legs.js';
import {solveArmReach} from '../../src/arms.js';
import {Retargeter} from '../../src/tracking.js';
import {lowerBody,prayer} from '../motion-fixtures.mjs';
import {handAssignments} from '../../src/hands.js';
const v=a=>new THREE.Vector3(...a);

test('un giro espurio de punta no endereza ni retuerce una rodilla claramente doblada',()=>{
 const solve=createLegSolver(THREE),sample=lowerBody({leftHip:1.0,leftKnee:1.4});let result;
 for(let i=0;i<100;i++)result=solve({...sample.directions.left,foot:i%2?[1,0,0]:[-1,0,0]});
 assert.ok(Math.abs(result.knee-1.4)<.02);
 assert.ok(result.shinDirection.angleTo(v(sample.directions.left.shin))<.03);
});

test('dos detecciones superpuestas y ambiguas no asignan la misma palma a ambos lados',()=>{
 const p=Array.from({length:21},()=>({x:.5,y:.4,z:0})),pose=[];pose[15]={x:.49,y:.4};pose[16]={x:.51,y:.4};
 const entries=[{p,index:0},{p:p.map(x=>({...x})),index:1}],visible=new Set([15,16]);
 const ambiguous={handedness:[[{categoryName:'Left',score:.55}],[{categoryName:'Right',score:.55}]]};
 assert.deepEqual(handAssignments(entries,ambiguous,pose,visible,{},0,0),[]);
 const certain={handedness:[[{categoryName:'Left',score:.95}],[{categoryName:'Right',score:.9}]]};
 const assigned=handAssignments(entries,certain,pose,visible,{},0,0);assert.equal(assigned.length,1);assert.equal(assigned[0][1],'left');
});

test('la oración resiste una oclusión breve de índices y se libera al separar manos',()=>{
 const tracker=new Retargeter();tracker.updatePose(prayer().result,0);
 const hidden=prayer().result;hidden.landmarks[0][19].visibility=0;hidden.landmarks[0][20].visibility=0;
 assert.equal(tracker.updatePose(hidden,100).armContact.prayer,true);
 assert.equal(tracker.updatePose(hidden,350).armContact.prayer,false);
 assert.equal(tracker.updatePose(prayer(0).result,400).armContact,null);
});

test('la patada atraviesa el muslo horizontal y vuelve sin invertir la rodilla',()=>{
 const solve=createLegSolver(THREE);let previous;
 for(let i=0;i<360;i++){
  const hip=(1-Math.cos(i/359*Math.PI*2))*.98,knee=.4+Math.sin(i/359*Math.PI)**2*.5;
  const sample=lowerBody({leftHip:hip,leftKnee:knee}),d=sample.directions.left;
  const s=solve({thigh:d.thigh,shin:d.shin,foot:d.foot,dt:1/60});
  assert.ok(Math.abs(s.knee-knee)<.04,'La rodilla se enderezó al superar 90°');
  assert.ok(s.shinDirection.angleTo(v(d.shin))<.05);
  if(previous)assert.ok(previous.angleTo(s.thighRotation)<.08,'La armadura invierte su giro');
  previous=s.thighRotation;
 }
});

test('arrodillarse conserva la flexión profunda y permite extender el empeine',()=>{
 const solve=createLegSolver(THREE),ankle=createAnkleSolver(THREE),sample=lowerBody({leftHip:.2,leftKnee:2.65,leftFoot:[0,.77,-.64]});let leg,foot;
 for(let i=0;i<120;i++){
  leg=solve({...sample.directions.left,dt:1/60});
  const shin=leg.thighRotation.clone().multiply(leg.shinLocal);
  foot=ankle({shin,foot:sample.directions.left.foot,dt:1/60});
 }
 assert.ok(Math.abs(leg.knee-2.65)<.01);
 assert.ok(leg.shinDirection.angleTo(v(sample.directions.left.shin))<.02);
 assert.ok(foot.pitch>1.2&&foot.pitch<=1.550001);
 assert.ok(Math.abs(foot.roll)<1e-8);
});

test('un pie oculto conserva el tobillo local mientras se mueve la espinilla',()=>{
 const solve=createAnkleSolver(THREE),shin=new THREE.Quaternion();
 const first=solve({shin,foot:[0,0,1]});
 shin.setFromAxisAngle(v([1,0,0]),1.6);
 const hidden=solve({shin,foot:[0,0,-1],measured:false});
 assert.ok(first.local.angleTo(hidden.local)<1e-8);
 assert.ok(v([0,0,1]).applyQuaternion(shin.clone().multiply(hidden.local)).y<-.99);
});

test('ruido de profundidad alrededor del empeine extendido no invierte el tobillo',()=>{
 const solve=createAnkleSolver(THREE),shin=new THREE.Quaternion();let previous;
 solve({shin,foot:[0,-1,0]});
 for(let i=0;i<120;i++){
  const s=solve({shin,foot:[0,Math.sin(i)*.01,-1]});
  assert.ok(s.pitch>1.5);
  if(previous)assert.ok(s.local.angleTo(previous)<.03);
  previous=s.local;
 }
});

test('el alcance junta objetivos sin estirar brazos, también con el torso girado',()=>{
 for(const yaw of [0,.8,-1.2]){
  const q=new THREE.Quaternion().setFromAxisAngle(v([0,1,0]),yaw);
  for(const sign of [-1,1]){
   const shoulder=v([sign*.55,0,0]).applyQuaternion(q),target=v([sign*.036,-.33,.38]).applyQuaternion(q),elbow=v([sign*.6,-.4,.1]).applyQuaternion(q);
   const s=solveArmReach(THREE,{shoulder,target,elbow,upperLength:.48,foreLength:.43});
   const end=shoulder.clone().addScaledVector(s.upper,.48).addScaledVector(s.fore,.43);
   assert.ok(end.distanceTo(target)<1e-8);
   assert.ok(Math.abs(s.upper.length()-1)<1e-8&&Math.abs(s.fore.length()-1)<1e-8);
  }
 }
});

test('el contacto requiere ambas muñecas y la oración requiere dedos hacia arriba',()=>{
 const tracker=new Retargeter();
 assert.equal(tracker.updatePose(prayer(0).result,0).armContact,null);
 const m=tracker.updatePose(prayer().result,40);
 assert.equal(m.armContact.weight,1);assert.equal(m.armContact.prayer,true);
 assert.equal(tracker.updatePose(prayer(1,{fingersUp:false}).result,80).armContact.prayer,false);
 assert.equal(tracker.updatePose(prayer(1,{hidden:true}).result,120).armContact,null);
 tracker.updatePose(prayer().result,160);tracker.decay(1000,.016);assert.equal(tracker.motion.armContact,null);
});

test('palmas detalladas recientes confirman oración aunque los índices corporales estén ocultos',()=>{
 const tracker=new Retargeter(),sample=prayer().result;
 sample.landmarks[0][19].visibility=0;sample.landmarks[0][20].visibility=0;
 for(const [side,sign] of [['left',1],['right',-1]]){
  tracker.motion.handVisible[side]=true;tracker.motion.handBlend[side]=1;tracker.seen[side+'_hand']=0;
  tracker.motion.hands[side].basis=[[0,0,sign],[0,-1,0],[sign,0,0]];
 }
 assert.equal(tracker.updatePose(sample,40).armContact.prayer,true);
 assert.equal(tracker.updatePose(sample,400).armContact.prayer,false,'Una palma antigua no impone oración');
});

test('el escorzo de una patada recupera profundidad sin mezclar píxeles y metros',()=>{
 const tracker=new Retargeter();for(let i=0;i<10;i++)tracker.updatePose(lowerBody().result,i*40);
 const sample=lowerBody({leftHip:1.7,leftKnee:.3}),w=sample.result.worldLandmarks[0];
 w[25]={x:w[23].x,y:w[23].y-.008,z:w[23].z-.012};
 for(let i=10;i<18;i++)tracker.updatePose(sample.result,i*40);
 assert.ok(tracker.motion.directions.left_thigh[2]>.95);
 const before=[...tracker.motion.directions.left_thigh];w[25].z=NaN;
 tracker.updatePose(sample.result,800);assert.deepEqual(tracker.motion.directions.left_thigh,before);
});
