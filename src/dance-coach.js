import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {createArmSolver} from './arms.js';
import {createLegSolver} from './legs.js';
import {RIG_LENGTHS} from './rig.js';

// Una segunda instancia comparte geometría. Sin otro canvas ni detector.
export function createDanceCoach(THREE,rig){
 const root=clone(rig.root),joints={},meshes=[];
 root.name='dance_coach';root.visible=false;
 root.traverse(object=>{
  if(object.isBone)joints[object.name]=object;
  if(object.isSkinnedMesh)meshes.push(object);
  if(object.name==='skeleton_joints')object.visible=false;
 });
 // Recuperar la postura de enlace: abrir el juego mientras el usuario cierra
 // un puño o abre la boca no debe dejar al guía congelado en ese gesto.
 const index=new Map(rig.skeleton.bones.map((bone,i)=>[bone.name,i]));
 for(const joint of Object.values(joints)){
  const bind=rig.skeleton.boneInverses[index.get(joint.name)].clone().invert();
  if(joint.parent.isBone)bind.premultiply(rig.skeleton.boneInverses[index.get(joint.parent.name)]);
  bind.decompose(joint.position,joint.quaternion,joint.scale);
 }
 const material=new THREE.MeshLambertMaterial({vertexColors:true,color:0xffe5a5,side:THREE.DoubleSide});
 for(const mesh of meshes)mesh.material=material;
 const arms={left:createArmSolver(THREE),right:createArmSolver(THREE)},legs={left:createLegSolver(THREE),right:createLegSolver(THREE)};
 const v=a=>new THREE.Vector3(...a);
 const sole=Math.min(...Object.values(rig.footSupports).flatMap(boxes=>boxes.flatMap(box=>box.points.map(p=>p[1]))));
 function orient(name,q){const b=joints[name];b.parent.updateWorldMatrix(true,false);b.quaternion.copy(b.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));b.updateWorldMatrix(false,false);}
 function update(m,dt){
  const d=m.directions,solved={},height=[];
  for(const side of ['left','right']){
   solved[side]=legs[side]({thigh:d[side+'_thigh'],shin:d[side+'_shin'],foot:[0,0,1],dt});
   height.push(RIG_LENGTHS.thigh*solved[side].thighDirection.y+RIG_LENGTHS.shin*solved[side].shinDirection.y+sole);
  }
  joints.base.position.set(0,-.045-Math.min(...height),0);joints.base.quaternion.identity();
  joints.spine.quaternion.setFromAxisAngle(v([0,0,1]),m.roll*.35);
  joints.torso.quaternion.setFromAxisAngle(v([0,0,1]),m.roll*.65);
  for(const name of ['neck','head','jaw'])joints[name].quaternion.identity();
  root.updateMatrixWorld(true);
  for(const side of ['left','right']){
   joints[side+'_clavicle'].quaternion.identity();
   const arm=arms[side]({upper:d[side+'_upper'],fore:d[side+'_fore'],dt});
   orient(side+'_upper',arm.upperRotation);joints[side+'_fore'].quaternion.copy(arm.foreLocal);joints[side+'_hand'].quaternion.identity();
   const lift=new THREE.Quaternion().setFromUnitVectors(v([0,-1,0]),v(d[side+'_upper']));
   orient(side+'_pauldron',new THREE.Quaternion().slerp(lift,.22));
   orient(side+'_thigh',solved[side].thighRotation);joints[side+'_shin'].quaternion.copy(solved[side].shinLocal);
   orient(side+'_foot',new THREE.Quaternion());joints[side+'_toe'].quaternion.identity();
  }
  root.updateMatrixWorld(true);for(const mesh of meshes)mesh.skeleton.update();
 }
 return {root,update,meshes};
}
