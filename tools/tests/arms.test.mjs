import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createArmSolver,buildDemoMotion,ARM_LIMITS} from '../../src/arms.js';

const v=a=>new THREE.Vector3(...a),down=v([0,-1,0]);
const basis=q=>[[1,0,0],[0,1,0],[0,0,1]].map(a=>v(a).applyQuaternion(q).toArray());
const settle=(solve,input)=>{let result;for(let i=0;i<150;i++)result=solve({...input,dt:1/60});return result;};

test('la demo orienta los dedos siguiendo el antebrazo durante todo el ciclo',()=>{
 for(let frame=0;frame<1200;frame++){
  const m=buildDemoMotion(THREE,frame/60);
  for(const side of ['left','right']){
   const forward=v(m.directions[side+'_fore']);
   const fingers=v(m.hands[side].basis[1]).negate();
   assert.ok(forward.angleTo(fingers)<=.100001,'La mano se queda vertical al levantar el brazo');
   const axes=m.hands[side].basis.map(v);
   assert.ok(Math.abs(new THREE.Matrix4().makeBasis(...axes).determinant()-1)<1e-9);
  }
 }
});

test('el codo flexiona alrededor de una bisagra y rechaza una flexión superior a 155 grados',()=>{
 const solve=createArmSolver(THREE);
 for(const fore of [[0,-1,0],[0,0,1],[0,1,0],[.8,-.6,0]]){
  const s=settle(solve,{upper:[0,-1,0],fore});
  const local=down.clone().applyQuaternion(s.foreLocal);
  assert.ok(Math.abs(local.x)<1e-9);assert.ok(s.elbow<=ARM_LIMITS.elbow+1e-9);
  assert.ok(Math.abs(local.angleTo(down)-s.elbow)<1e-7);
  if(fore[1]!==1)assert.ok(s.foreDirection.angleTo(v(fore))<.001);
 }
});

test('girar la palma prona el antebrazo y conserva neutra la muñeca',()=>{
 const solve=createArmSolver(THREE),turn=new THREE.Quaternion().setFromAxisAngle(v([0,1,0]),1.4);
 const s=settle(solve,{upper:[0,-1,0],fore:[0,-1,0],basis:basis(turn),visible:true});
 assert.ok(Math.abs(s.twist-1.4)<1e-6);
 assert.ok(s.wristRotation.angleTo(new THREE.Quaternion())<1e-6);
 assert.ok(s.foreRotation.angleTo(turn)<1e-6);
 assert.ok(s.foreDirection.angleTo(down)<1e-8);
});

test('flexionar la muñeca conserva el giro de palma medido y limita la desviación lateral',()=>{
 const solve=createArmSolver(THREE);
 const target=new THREE.Quaternion().setFromAxisAngle(v([0,1,0]),.8)
  .multiply(new THREE.Quaternion().setFromAxisAngle(v([1,0,0]),-.5));
 const input={upper:[0,-1,0],fore:[0,-1,0],basis:basis(target),visible:true};
 let s=settle(solve,input);
 assert.ok(s.foreRotation.clone().multiply(s.wristRotation).angleTo(target)<1e-5);
 const sideways=new THREE.Quaternion().setFromAxisAngle(v([0,0,1]),1.2);
 s=settle(solve,{...input,basis:basis(sideways)});
 assert.ok(Math.abs(s.wristRotation.angleTo(new THREE.Quaternion())-ARM_LIMITS.wristSide)<1e-5);
});

test('la demo mantiene codos y muñecas estables durante 1200 fotogramas y al perder manos',()=>{
 const solvers={left:createArmSolver(THREE),right:createArmSolver(THREE)},previous={};
 for(let frame=0;frame<1200;frame++){
  const m=buildDemoMotion(THREE,frame/60);
  for(const side of ['left','right']){
   const s=solvers[side]({upper:m.directions[side+'_upper'],fore:m.directions[side+'_fore'],
    basis:m.hands[side].basis,visible:frame%240<200,dt:1/60});
   for(const key of ['upperRotation','foreRotation','wristRotation']){
    assert.ok(s[key].toArray().every(Number.isFinite));
    if(previous[side])assert.ok(s[key].angleTo(previous[side][key])<.30,key);
   }
   assert.ok(s.wristRotation.angleTo(new THREE.Quaternion())<=ARM_LIMITS.wristFlex+.001);
   previous[side]=s;
  }
 }
});

test('entrar a la demo desde reposo no dobla la muñeca mientras el hombro se acomoda',()=>{
 const solve=createArmSolver(THREE);
 solve({upper:[0,-1,0],fore:[0,-1,0],dt:1/60});
 for(let frame=0;frame<120;frame++){
  const m=buildDemoMotion(THREE,frame/60),side='left';
  const s=solve({upper:m.directions[side+'_upper'],fore:m.directions[side+'_fore'],
   basis:m.hands[side].basis,handPose:m.handPose[side],visible:true,dt:1/60});
  assert.ok(s.wristRotation.angleTo(new THREE.Quaternion())<.11);
 }
});
