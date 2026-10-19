import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {createSamuraiRig,RIG_LENGTHS} from '../../src/rig.js';
import {relaxedHand} from '../../src/hands.js';

const model=JSON.parse(fs.readFileSync(new URL('../../public/robot.json',import.meta.url),'utf8'));
const distance=(a,b)=>a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3()));

test('la envolvente rápida contiene la piel, incluidos pesos mezclados, dedos y cuernos al bailar',()=>{
 const rig=createSamuraiRig(THREE,model),point=new THREE.Vector3(),positions=rig.mesh.geometry.attributes.position;
 for(let frame=0;frame<8;frame++){
  const t=frame*.7;rig.root.position.set(Math.sin(t),.3+Math.cos(t)*.4,-.2);rig.root.rotation.y=t;
  rig.joints.base.rotation.set(Math.sin(t)*.3,t*.1,.15);
  for(const side of ['left','right']){
   rig.joints[side+'_upper'].rotation.set(t*.3,Math.sin(t),Math.cos(t));
   rig.joints[side+'_fore'].rotation.x=t*.4;rig.joints[side+'_thigh'].rotation.x=Math.sin(t);
   rig.joints[side+'_shin'].rotation.x=1+Math.sin(t);
   rig.hands[side].update(relaxedHand(side,Array(5).fill((Math.sin(t)+1)/2)),.016,true);
  }
  rig.refresh();const bounds=rig.getBounds().clone().expandByScalar(1e-6);
  for(let i=0;i<positions.count;i++){
   rig.mesh.getVertexPosition(i,point);point.applyMatrix4(rig.mesh.matrixWorld);
   assert.ok(bounds.containsPoint(point),'fuera de la envolvente: '+i);
  }
 }
});

test('la armadura y los dedos se enlazan a un esqueleto real de 64 huesos',()=>{
 const rig=createSamuraiRig(THREE,model);
 assert.equal(rig.skeleton.bones.length,64);assert.equal(rig.mesh.isSkinnedMesh,true);
 assert.equal(rig.joints.left_hand.parent,rig.joints.left_fore);
 assert.equal(rig.joints.left_fore.parent,rig.joints.left_upper);
 assert.equal(rig.joints.left_upper.parent,rig.joints.left_clavicle);
 assert.equal(rig.joints.left_shin.parent,rig.joints.left_thigh);
 assert.equal(rig.joints.left_foot.parent,rig.joints.left_shin);
 assert.equal(rig.joints.left_thumb_ip.parent,rig.joints.left_thumb_mcp);
 const {skinWeight:w,skinIndex:ids}=rig.mesh.geometry.attributes;
 for(let i=0;i<w.count;i++){
  assert.ok(Math.abs(w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i)-1)<1e-6);
  assert.ok(ids.getX(i)<64&&ids.getY(i)<64);
 }
 assert.ok(rig.mesh.userData.parts.some(p=>p.name==='left_index_pip_plate'));
});
test('los índices compartidos dibujan exactamente la misma piel con menos cálculos de vértice',()=>{
 const rig=createSamuraiRig(THREE,model),g=rig.mesh.geometry,index=g.index;
 assert.ok(new Set(index.array).size<g.attributes.position.count*.75);
 for(let i=0;i<index.count;i++)for(const attribute of Object.values(g.attributes))for(let c=0;c<attribute.itemSize;c++){
  assert.equal(attribute.getComponent(i,c),attribute.getComponent(index.getX(i),c));
 }
 rig.setLightweight(true);assert.equal(rig.mesh.material.isMeshLambertMaterial,true);
 rig.setLightweight(false);assert.equal(rig.mesh.material.isMeshStandardMaterial,true);
});

test('cadera, codos, muñecas y dedos conservan sus longitudes durante giros',()=>{
 const rig=createSamuraiRig(THREE,model),{joints:j}=rig;
 const lengths=new Map(rig.skeleton.bones.filter(b=>b.parent.isBone).map(b=>[b,b.position.length()]));
 for(let frame=0;frame<360;frame++){
  const t=frame*.045;j.base.position.set(Math.sin(t),1.65+Math.sin(t*2)*.2,Math.cos(t)*.2);
  j.base.rotation.set(Math.sin(t)*.3,Math.sin(t*.7)*1.5,Math.cos(t)*.4);
  j.spine.rotation.set(Math.sin(t)*.2,Math.cos(t)*.3,0);
  for(const [side,sign] of [['left',-1],['right',1]]){
   rig.orient(side+'_upper',new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(t)*2,sign*t,Math.cos(t))));
   rig.orient(side+'_fore',new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.cos(t)*2,sign*t,Math.sin(t))));
   rig.orient(side+'_thigh',new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(t),sign*t,.3)));
   rig.orient(side+'_shin',new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.cos(t),sign*t,.2)));
   rig.hands[side].update(relaxedHand(side,Array(5).fill((Math.sin(t)+1)/2)),1/60);
  }
  rig.refresh();
  for(const [b,length] of lengths){
   assert.ok(Math.abs(distance(b,b.parent)-length)<1e-9,b.name);
   assert.ok(b.matrixWorld.elements.every(Number.isFinite));assert.ok(Math.abs(b.matrixWorld.determinant()-1)<1e-8);
  }
  assert.ok(Math.abs(distance(j.left_fore,j.left_upper)-RIG_LENGTHS.upper)<1e-9);
  assert.ok(Math.abs(distance(j.left_hand,j.left_fore)-RIG_LENGTHS.fore)<1e-9);
 }
});

test('cerrar la mano mueve vértices de la malla mediante sus huesos sin escalar falanges',()=>{
 const rig=createSamuraiRig(THREE,model),{mesh,joints}=rig;
 const part=mesh.userData.parts.find(p=>p.name==='left_index_dip_phalanx');
 const vertex=()=>mesh.applyBoneTransform(part.start,new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,part.start));
 rig.hands.left.update(relaxedHand('left',Array(5).fill(0)),.016,true);rig.refresh();const open=vertex();
 rig.hands.left.update(relaxedHand('left',Array(5).fill(1)),.016,true);rig.refresh();const closed=vertex();
 assert.ok(open.distanceTo(closed)>.13);
 for(const b of rig.skeleton.bones)assert.deepEqual(b.scale.toArray(),[1,1,1]);
 const expected=rig.position('left_hand');
 assert.ok(joints.left_index_mcp.getWorldPosition(new THREE.Vector3()).distanceTo(expected)>.14);
});
test('levantar un muslo mueve su placa de cadera sin arrastrar la del otro lado',()=>{
 const rig=createSamuraiRig(THREE,model),mesh=rig.mesh;
 const vertex=side=>{
  const part=mesh.userData.parts.find(p=>p.name===side+'_hip_skirt');
  return mesh.getVertexPosition(part.start,new THREE.Vector3());
 };
 const left=vertex('left'),right=vertex('right');
 rig.joints.left_thigh.rotation.x=-1.2;rig.refresh();
 assert.ok(left.distanceTo(vertex('left'))>.15);
 assert.ok(right.distanceTo(vertex('right'))<1e-8);
});

test('el pulgar nace del lado opuesto en cada mano y el diagnóstico dibuja los huesos reales',()=>{
 const rig=createSamuraiRig(THREE,model);
 assert.ok(rig.joints.left_thumb_cmc.position.x<0);
 assert.ok(rig.joints.right_thumb_cmc.position.x>0);
 rig.setSkeleton(true);assert.equal(rig.helper.visible,true);assert.equal(rig.markers.visible,true);
 assert.equal(rig.helper.bones.length,64);
 const matrix=new THREE.Matrix4();rig.markers.getMatrixAt(0,matrix);
 assert.ok(new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(rig.position('base'))<1e-7);
 rig.setSkeleton(false);assert.equal(rig.helper.visible,false);
});

test('el pulgar cerrado queda sobre los dedos y no oculto dentro de la palma',()=>{
 const rig=createSamuraiRig(THREE,model);
 for(const side of ['left','right']){
  const fist=relaxedHand(side,Array(5).fill(1));rig.hands[side].update(fist,.016,true);rig.refresh();
  assert.ok(fist.points[4][2]>fist.points[7][2]+.015);
  assert.ok(Math.abs(fist.points[4][0])<.05);
 }
});

test('las bisagras siguen la postura de cada dedo al abrir y cerrar sin invertir las placas',()=>{
 const rig=createSamuraiRig(THREE,model),previous={};
 for(let frame=0;frame<=120;frame++){
  const curl=(Math.sin(frame/120*Math.PI*2-Math.PI/2)+1)/2;
  for(const side of ['left','right']){
   const shape=relaxedHand(side,Array(5).fill(curl));rig.hands[side].update(shape,.016,true);rig.refresh();
   const wrist=rig.joints[side+'_hand'];
   for(const chain of rig.hands[side].chains)for(let i=0;i<4;i++){
    const b=chain.bones[i],expected=new THREE.Vector3(...shape.points[chain.start+i]).applyMatrix4(wrist.matrixWorld);
    assert.ok(expected.distanceTo(b.getWorldPosition(new THREE.Vector3()))<1e-8,b.name);
    if(chain.finger>0&&previous[b.name])assert.ok(previous[b.name].angleTo(b.quaternion)<.13,b.name);
    previous[b.name]=b.quaternion.clone();
   }
  }
 }
});
