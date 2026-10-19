import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Retargeter} from '../../src/tracking.js';
import {createArmSolver} from '../../src/arms.js';
import {punch} from '../motion-fixtures.mjs';

const v=a=>new THREE.Vector3(...a),angle=(a,b)=>v(a).angleTo(v(b));

test('un jab hacia la cámara llega a la extensión antes de volver a la guardia',()=>{
 const tracker=new Retargeter(),solve=createArmSolver(THREE);
 for(let i=0;i<10;i++)tracker.updatePose(punch(0).result,i*1000/30);
 let measured;
 for(let i=0;i<4;i++){
  const sample=punch(i/3),m=tracker.updatePose(sample.result,(10+i)*1000/30);measured=m;
  for(let frame=0;frame<4;frame++)solve({upper:m.directions.left_upper,fore:m.directions.left_fore,dt:1/120});
 }
 const expected=punch(1),rendered=solve({upper:measured.directions.left_upper,fore:measured.directions.left_fore,dt:1/120});
 assert.ok(angle(measured.directions.left_fore,expected.fore)<.20,'El filtro pierde el ápice del golpe');
 assert.ok(rendered.foreDirection.angleTo(v(expected.fore))<.35,'El codo llega tarde al golpe');
});

test('un antebrazo acortado en 3D recupera profundidad con proyección y longitud calibrada',()=>{
 const tracker=new Retargeter();for(let i=0;i<10;i++)tracker.updatePose(punch(0).result,i*40);
 for(let i=10;i<16;i++)tracker.updatePose(punch(1,{collapsed:true}).result,i*40);
 assert.ok(tracker.motion.directions.left_fore[2]>.9,'Se perdió el golpe frontal por escorzo');
});

test('una muñeca parcialmente tapada conserva un golpe breve con una medida de profundidad válida',()=>{
 const tracker=new Retargeter();for(let i=0;i<10;i++)tracker.updatePose(punch(0).result,i*40);
 for(let i=10;i<14;i++)tracker.updatePose(punch(1,{collapsed:true,confidence:.22}).result,i*40);
 assert.ok(tracker.motion.directions.left_fore[2]>.85);
 assert.equal(tracker.motion.visible.has(15),false,'Una reconstrucción no debe contarse como punto observado');
});

test('sin profundidad de cámara no se inventa un golpe ni se sustituyen coordenadas 3D inválidas',()=>{
 const tracker=new Retargeter();for(let i=0;i<10;i++)tracker.updatePose(punch(0).result,i*40);
 const before=[...tracker.motion.directions.left_fore];
 for(let i=10;i<12;i++){
  const sample=punch(1,{collapsed:true,depth:false}).result;sample.worldLandmarks[0][15].z=NaN;
  tracker.updatePose(sample,i*40);
 }
 assert.deepEqual(tracker.motion.directions.left_fore,before);
});

test('una reconstrucción breve no renueva indefinidamente una muñeca oculta',()=>{
 const tracker=new Retargeter();for(let i=0;i<10;i++)tracker.updatePose(punch(0).result,i*40);
 for(let i=10;i<14;i++)tracker.updatePose(punch(1,{collapsed:true,confidence:.22}).result,i*40);
 const seen=tracker.seen.left_fore,before=[...tracker.motion.directions.left_fore];
 for(let i=14;i<24;i++)tracker.updatePose(punch(0,{collapsed:true,confidence:.22}).result,i*40);
 assert.equal(tracker.seen.left_fore,seen);assert.deepEqual(tracker.motion.directions.left_fore,before);
});
