import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {relaxedHand,focusedHand} from './hands.js';
import {createSamuraiRig,RIG_LENGTHS,roundedBox as rigBox} from './rig.js';
import {createArmSolver,buildDemoMotion,solveArmReach} from './arms.js';
import {createLegSolver,createAnkleSolver} from './legs.js';
import {createDanceCoach} from './dance-coach.js';

const v=a=>new THREE.Vector3(...a),front=v([0,0,1]);
const R=(axis,a)=>new THREE.Matrix4()['makeRotation'+axis](a);
const roundedBox=(...args)=>rigBox(THREE,...args);
function makeFace(materials){
 const root=new THREE.Group(),eyes={},brows={};
 for(const [side,sign] of [['left',-1],['right',1]]){
  const socket=new THREE.Mesh(roundedBox(.104,.053,.013,.009),materials.carbon);
  socket.position.set(sign*.066,.15,.18);socket.rotation.z=sign*.1;root.add(socket);
  const eye=new THREE.Mesh(roundedBox(.077,.038,.012,.006),materials.eye);
  eye.position.set(sign*.066,.15,.198);eye.rotation.z=sign*.1;root.add(eye);eyes[side]=eye;
  const brow=new THREE.Mesh(roundedBox(.098,.017,.014,.004),materials.carbon);
  brow.position.set(sign*.068,.202,.205);root.add(brow);brows[side]=brow;
 }
 const count=16,geometry=new THREE.BufferGeometry(),positions=new Float32Array((count+1)*2*3),indices=[];
 for(let i=0;i<count;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
 geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(indices);
 root.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x070b10,side:THREE.DoubleSide})));
 function update(face={}){
  const jaw=face.jaw||0,pucker=face.pucker||0,width=.075*(1-pucker*.48),height=.004+jaw*.063+pucker*.009;
  for(let i=0;i<=count;i++){
   const t=i/count,x=(t*2-1)*width,left=face.smileLeft??face.smile??0,right=face.smileRight??face.smile??0;
   const lift=t<.5?left*.031-(face.frownLeft||0)*.026:right*.031-(face.frownRight||0)*.026;
   const curve=.053+Math.pow(Math.abs(t*2-1),1.7)*lift;
   positions.set([x,curve+height*.28,.219,x,curve-height,.22],i*6);
  }
  geometry.attributes.position.needsUpdate=true;geometry.computeBoundingSphere();
  for(const [side,sign] of [['left',-1],['right',1]]){
   const blink=face[side==='left'?'blinkLeft':'blinkRight']||0,wide=face[side==='left'?'wideLeft':'wideRight']||0,squint=face[side==='left'?'squintLeft':'squintRight']||0;
   eyes[side].scale.y=Math.max(.06,(1-blink)*(1+wide*.65-squint*.5));
   const up=face[side==='left'?'browLeft':'browRight']??face.brow??0,down=face[side==='left'?'downLeft':'downRight']||0;
   brows[side].position.y=.202+up*.035-down*.014;brows[side].rotation.z=sign*(.06+down*.55-up*.08);
  }
 }
 return {root,update};
}
export const demoMotion=t=>buildDemoMotion(THREE,t);
export async function createAvatar(host){
 const smallDevice=(navigator.hardwareConcurrency||2)<=4||(navigator.deviceMemory||8)<=4;
 const renderer=new THREE.WebGLRenderer({antialias:!smallDevice,alpha:false,powerPreference:'high-performance'});
 renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
 const gl=renderer.getContext(),info=gl.getExtension('WEBGL_debug_renderer_info');
 const softwareGraphics=info&&/SwiftShader|llvmpipe|software/i.test(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
 if(smallDevice||softwareGraphics)renderer.setPixelRatio(.75);
 renderer.domElement.setAttribute('aria-label','Samurái 3D articulado. Arrastra para girar la vista.');host.append(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color('#11161c');
 scene.add(new THREE.HemisphereLight(0xc7deed,0x1c1420,2.1));
 const key=new THREE.DirectionalLight(0xffe5c1,3.5);key.position.set(3,6,5);scene.add(key);
 const rim=new THREE.DirectionalLight(0x77c5df,2.1);rim.position.set(-3,3,-3);scene.add(rim);
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.MeshStandardMaterial({color:'#10151b',roughness:1}));
 floor.rotation.x=-Math.PI/2;floor.position.y=-.045;scene.add(floor);
 const grid=new THREE.GridHelper(14,28,0x47535d,0x243039);grid.position.y=-.035;scene.add(grid);
 const camera=new THREE.PerspectiveCamera(38,1,.1,100);camera.position.set(.35,2.1,6.4);
 const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1.75,0);
 controls.enableDamping=true;controls.dampingFactor=.08;controls.enablePan=false;controls.minDistance=.55;controls.maxDistance=11;
 controls.minPolarAngle=.35;controls.maxPolarAngle=Math.PI*.7;
 const response=await fetch('/robot.json');if(!response.ok)throw Error('No se pudo cargar el modelo del samurái');
 const model=await response.json(),materials=Object.fromEntries(['carbon','eye'].map(name=>{
  const rgb=model.materials[name];
  const color=new THREE.Color().setRGB(...rgb,THREE.SRGBColorSpace);
  return [name,new THREE.MeshStandardMaterial({color,metalness:.3,roughness:.52,side:THREE.DoubleSide,flatShading:true,emissive:name==='eye'?color:0,emissiveIntensity:name==='eye'?.8:0})];
 }));
 const rig=createSamuraiRig(THREE,model),root=rig.root;
 let lightweight=smallDevice||!!softwareGraphics;rig.setLightweight(lightweight);
 scene.add(root,rig.helper);root.add(rig.markers);
 const groups=Object.fromEntries(Object.entries(rig.joints).filter(([name])=>!/(?:thumb|index|middle|ring|pinky)_/.test(name)));
 const facial=makeFace(materials);rig.joints.head.add(facial.root);groups.features=facial.root;
 const worldQuaternion=matrix=>new THREE.Quaternion().setFromRotationMatrix(matrix);
 const armSolvers={left:createArmSolver(THREE),right:createArmSolver(THREE)},armState={};
 const renderDirections={},shoulderLift={left:0,right:0};
 const legSolvers={left:createLegSolver(THREE),right:createLegSolver(THREE)},legState={};
 const ankleSolvers={left:createAnkleSolver(THREE),right:createAnkleSolver(THREE)};
 let contactWeight=0,prayerWeight=0;
 const contactCenter=new THREE.Vector3(),contactDelta=new THREE.Vector3();
 const rendered={position:[0,0,0],yaw:0,pitch:0,roll:0,torsoYaw:0,hipPitch:0,hipRoll:0};
 let rootHeight=.278;
 let fitTimer=0,view='front',handSide='left',interactionUntil=0;
 controls.addEventListener('change',()=>{interactionUntil=performance.now()+750;});
 const fitCorner=new THREE.Vector3();
 let danceCoach=null,danceVisible=false,dancePractice=false,danceTarget=null;
 function fitDance(){
  const width=dancePractice?3.5:6.7,halfFov=Math.tan(camera.fov*Math.PI/360);
  const distance=Math.max(5.8,width/(2*halfFov*camera.aspect)*1.04);
  camera.position.set(0,1.95,distance);controls.target.set(0,1.7,0);controls.update();
 }
 function update(m={},dt=.016){
  dt=THREE.MathUtils.clamp(Number.isFinite(dt)?dt:.016,.001,.05);
  const alpha=1-Math.exp(-dt*26),finite=(x,fallback=0)=>Number.isFinite(x)?x:fallback;
  for(const key of ['yaw','pitch','roll','torsoYaw','hipPitch','hipRoll']){
   const target=key==='hipPitch'?m.pelvis?.pitch:key==='hipRoll'?m.pelvis?.roll:m[key];
   const difference=Math.atan2(Math.sin(finite(target)-rendered[key]),Math.cos(finite(target)-rendered[key]));
   rendered[key]+=THREE.MathUtils.clamp(difference*alpha,-dt*6,dt*6);
  }
  rendered.position=rendered.position.map((x,i)=>{
   const speed=i===1?6:2,gain=i===1?1-Math.exp(-dt*38):alpha;
   return x+THREE.MathUtils.clamp((finite(m.position?.[i])-x)*gain,-dt*speed,dt*speed);
  });
  const directions=m.directions||{},dir=(name,fallback)=>{
   const raw=directions[name],target=v(raw?.every(Number.isFinite)&&Math.hypot(...raw)>.01?raw:fallback).normalize();
   const current=renderDirections[name]??=target.clone();
   const arm=/(upper|fore)$/.test(name),cutoff=arm&&m.filtered?65:26;
   const difference=current.angleTo(target),adaptive=1-Math.exp(-dt*(cutoff+Math.min(32,difference*40)));
   if(difference>1e-6){
    const q=new THREE.Quaternion().setFromUnitVectors(current,target);
    const rate=/(upper|fore)$/.test(name)?Math.min(32,16+difference*20):12;
    current.applyQuaternion(new THREE.Quaternion().slerp(q,Math.min(adaptive,dt*rate/difference))).normalize();
   }
   return current.clone();
  };
  // Calcular cada dirección una sola vez por fotograma.
  const frameDirections={};
  for(const side of ['left','right'])for(const part of ['upper','fore','thigh','shin','foot'])frameDirections[side+'_'+part]=dir(side+'_'+part,part==='foot'?[0,0,1]:[0,-1,0]);
  const pelvisRotation=R('Y',rendered.yaw).multiply(R('X',rendered.hipPitch)).multiply(R('Z',rendered.hipRoll));
  const rootRotation=new THREE.Matrix3().setFromMatrix4(pelvisRotation);
  const rotation=m.worldSpace?new THREE.Matrix3():new THREE.Matrix3().setFromMatrix4(R('Y',rendered.yaw));
  const forward=front.clone().applyMatrix3(rootRotation),solvedLegs={},solvedFeet={};
  for(const side of ['left','right']){
   const footIds=side==='left'?[29,31]:[30,32],footMeasured=m.visible?footIds.every(i=>m.visible.has(i)):!!directions[side+'_foot'];
   solvedLegs[side]=legSolvers[side]({thigh:frameDirections[side+'_thigh'].clone().applyMatrix3(rotation).toArray(),shin:frameDirections[side+'_shin'].clone().applyMatrix3(rotation).toArray(),foot:footMeasured?frameDirections[side+'_foot'].clone().applyMatrix3(rotation).toArray():undefined,reference:forward.toArray(),dt});
   legState[side]={knee:solvedLegs[side].knee,thigh:solvedLegs[side].thighDirection.toArray(),shin:solvedLegs[side].shinDirection.toArray()};
  }
  for(const side of ['left','right']){
   const shin=solvedLegs[side].thighRotation.clone().multiply(solvedLegs[side].shinLocal);
   const footIds=side==='left'?[29,31]:[30,32],measured=m.visible?footIds.every(i=>m.visible.has(i)):!!directions[side+'_foot'];
   const ankle=ankleSolvers[side]({shin,foot:frameDirections[side+'_foot'].clone().applyMatrix3(rotation).toArray(),measured,dt});
   const local=ankle.local,world=shin.clone().multiply(local);
   const toe=THREE.MathUtils.clamp(Math.max(0,ankle.pitch)*.35,0,.25);
   const toeLocal=new THREE.Quaternion().setFromAxisAngle(v([1,0,0]),-toe),toeWorld=world.clone().multiply(toeLocal);
   const soles=rig.footSupports[side].map(box=>{
    const isToe=box.bone.endsWith('_toe'),q=isToe?toeWorld:world;
    const row=new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
    const minimum=Math.min(...box.points.map(p=>row[1]*p[0]+row[5]*p[1]+row[9]*p[2]));
    return minimum+(isToe?rig.joints[side+'_toe'].position.clone().applyQuaternion(world).y:0);
   });
   solvedFeet[side]={local,toeLocal,sole:Math.min(...soles)};
   Object.assign(legState[side],{ankle:[ankle.pitch,ankle.yaw,ankle.roll],toe});
  }
  const supports=['left','right'].map((side,i)=>{
   const offset=v([(i===0?-1:1)*.245,0,0]).applyMatrix3(rootRotation).y;
   const row=new THREE.Matrix4().makeRotationFromQuaternion(solvedLegs[side].thighRotation).elements;
   const knee=Math.min(...rig.kneeSupports[side].map(box=>[row[1],row[5],row[9]].reduce((sum,k,j)=>sum+k*(k>=0?box.min[j]:box.max[j]),0)));
   return offset+Math.min(knee,RIG_LENGTHS.thigh*solvedLegs[side].thighDirection.y+RIG_LENGTHS.shin*solvedLegs[side].shinDirection.y+solvedFeet[side].sole);
  });
  const targetHeight=THREE.MathUtils.clamp(-.045-Math.min(...supports)-1.23,-.8,.65);
  rootHeight+=THREE.MathUtils.clamp((targetHeight-rootHeight)*(1-Math.exp(-dt*32)),-dt*4,dt*4);
  const p=rendered.position;
  const pelvis=rig.joints.base;
  pelvis.position.set(p[0],rootHeight+p[1]+1.23,p[2]);pelvis.quaternion.copy(worldQuaternion(pelvisRotation));
  const torsoRotation=worldQuaternion(R('Y',rendered.torsoYaw).multiply(R('X',rendered.pitch)).multiply(R('Z',rendered.roll)));
  // Distribuir la flexión entre abdomen y pecho conserva una columna continua.
  rig.joints.spine.quaternion.identity().slerp(torsoRotation,.35);
  rig.joints.torso.quaternion.identity().slerp(torsoRotation,.65);
  const face=m.face||{};
  const faceRotation=worldQuaternion(R('Y',finite(face.yaw)).multiply(R('X',finite(face.pitch))).multiply(R('Z',finite(face.roll))));
  rig.joints.neck.quaternion.identity().slerp(faceRotation,.3);
  rig.joints.head.quaternion.identity().slerp(faceRotation,.7);
  rig.joints.jaw.position.y=-finite(face.jaw)*.065;facial.update(face);
  for(const [side,sign] of [['left',-1],['right',1]]){
   const upper=frameDirections[side+'_upper'].clone().applyMatrix3(rotation);
   const elevation=Math.acos(THREE.MathUtils.clamp(-upper.y,-1,1));
   const target=THREE.MathUtils.clamp((elevation-1.1)*.24,0,.38);
   shoulderLift[side]+=(target-shoulderLift[side])*(1-Math.exp(-dt*35));
   rig.joints[side+'_clavicle'].quaternion.setFromAxisAngle(v([0,0,1]),sign*shoulderLift[side]);
  }
  root.updateMatrixWorld(true);
  // Retargeting por posición sólo cerca del contacto entre manos. El centro
  // usa la escala de los brazos y ambos objetivos comparten el mismo alcance.
  const contact=m.armContact;
  contactWeight+=((contact?.weight||0)-contactWeight)*(1-Math.exp(-dt*28));
  prayerWeight+=((contact?.prayer?1:0)-prayerWeight)*(1-Math.exp(-dt*28));
  if(contact){contactCenter.lerp(v(contact.center).multiplyScalar(RIG_LENGTHS.upper+RIG_LENGTHS.fore),alpha);contactDelta.lerp(v(contact.delta).multiplyScalar(RIG_LENGTHS.fore),alpha);}
  const shoulders=Object.fromEntries(['left','right'].map(side=>[side,rig.position(side+'_upper')]));
  const across=shoulders.right.clone().sub(shoulders.left).normalize();
  const prayerAcross=across.clone();
  if(['left','right'].every(side=>m.handVisible?.[side]&&m.handBlend?.[side]>.7)){
   const measured=v(m.hands.left.basis[2]).sub(v(m.hands.right.basis[2])).applyMatrix3(rotation).normalize();
   if(measured.dot(across)>.3)prayerAcross.copy(measured);
  }
  const center=shoulders.left.clone().add(shoulders.right).multiplyScalar(.5).add(contactCenter);
  const delta=contactDelta.clone().lerp(prayerAcross.multiplyScalar(.072),prayerWeight);
  const targets={left:center.clone().addScaledVector(delta,-.5),right:center.clone().addScaledVector(delta,.5)};
  if(contactWeight>.001)for(let i=0;i<4;i++)for(const side of ['left','right']){
   const offset=targets[side].clone().sub(shoulders[side]),excess=offset.length()-(RIG_LENGTHS.upper+RIG_LENGTHS.fore-.015);
   if(excess>0){offset.setLength(excess);for(const target of Object.values(targets))target.sub(offset);}
  }
  for(const side of ['left','right']){
   const upper=frameDirections[side+'_upper'].clone().applyMatrix3(rotation),foreDir=frameDirections[side+'_fore'].clone().applyMatrix3(rotation);
   if(contactWeight>.001){
    const elbow=shoulders[side].clone().addScaledVector(upper,RIG_LENGTHS.upper);
    const below=targets[side].clone().add(v([0,-RIG_LENGTHS.fore,0]).applyQuaternion(rig.joints.torso.getWorldQuaternion(new THREE.Quaternion())));
    elbow.lerp(below,prayerWeight);
    const reach=solveArmReach(THREE,{shoulder:shoulders[side],target:targets[side],elbow,upperLength:RIG_LENGTHS.upper,foreLength:RIG_LENGTHS.fore});
    if(reach)for(const [current,target] of [[upper,reach.upper],[foreDir,reach.fore]]){
     const turn=new THREE.Quaternion().setFromUnitVectors(current,target);
     current.applyQuaternion(new THREE.Quaternion().slerp(turn,contactWeight)).normalize();
    }
   }
   const inferredPrayer=prayerWeight*contactWeight*(1-(m.handBlend?.[side]||0));
   const shape=inferredPrayer>.5?relaxedHand(side,Array(5).fill(0)):m.hands?.[side]||relaxedHand(side,m.curls?.[side]);
   let basis=shape.basis.map(axis=>v(axis).applyMatrix3(rotation));
   if(inferredPrayer>.001){
    const y=v([0,-1,0]).applyQuaternion(rig.joints.torso.getWorldQuaternion(new THREE.Quaternion())),z=across.clone().multiplyScalar(side==='left'?1:-1);
    const x=new THREE.Vector3().crossVectors(y,z).normalize();z.crossVectors(x,y).normalize();
    const q=worldQuaternion(new THREE.Matrix4().makeBasis(...basis)).slerp(worldQuaternion(new THREE.Matrix4().makeBasis(x,y,z)),inferredPrayer);
    basis=[[1,0,0],[0,1,0],[0,0,1]].map(a=>v(a).applyQuaternion(q));
   }
   const handPose=m.handPose?.[side];
   const solved=armSolvers[side]({upper:upper.toArray(),fore:foreDir.toArray(),
    handPose:handPose?{...handPose,palm:v(handPose.palm).applyMatrix3(rotation).toArray()}:undefined,
    basis:basis.map(axis=>axis.toArray()),
    visible:!!m.handVisible?.[side]||inferredPrayer>.001,blend:Math.max(m.handBlend?.[side]??(m.handVisible?.[side]?1:0),inferredPrayer),reference:forward.toArray(),dt});
   rig.orient(side+'_upper',solved.upperRotation);
   rig.joints[side+'_fore'].quaternion.copy(solved.foreLocal);
   rig.joints[side+'_hand'].quaternion.copy(solved.wristRotation);rig.hands[side].update(shape,dt);
   // Las hombreras acompañan la elevación, no la torsión axial del hombro.
   const clavicleRotation=rig.joints[side+'_clavicle'].getWorldQuaternion(new THREE.Quaternion());
   const localDirection=upper.clone().applyQuaternion(clavicleRotation.clone().invert());
   const lift=new THREE.Quaternion().setFromUnitVectors(v([0,-1,0]),localDirection);
   rig.orient(side+'_pauldron',clavicleRotation.multiply(new THREE.Quaternion().slerp(lift,.22)));
   const measured=worldQuaternion(new THREE.Matrix4().makeBasis(...basis));
   const actual=solved.foreRotation.clone().multiply(solved.wristRotation);
   armState[side]={elbow:solved.elbow,twist:solved.twist,wrist:solved.wristRotation.toArray(),
    handError:actual.angleTo(measured),measuredPalm:shape.basis[2][2],renderedPalm:v([0,0,1]).applyQuaternion(actual).z};
   rig.orient(side+'_thigh',solvedLegs[side].thighRotation);
   rig.joints[side+'_shin'].quaternion.copy(solvedLegs[side].shinLocal);
   rig.joints[side+'_foot'].quaternion.copy(solvedFeet[side].local);
   rig.joints[side+'_toe'].quaternion.copy(solvedFeet[side].toeLocal);
  }
  rig.refresh();
  handSide=focusedHand(handSide,m.handVisible);
  if(!danceVisible&&(view==='face'||view==='hands')){
   const part=(view==='face'?groups.head:groups[handSide+'_hand']).matrixWorld;
   const target=v(view==='face'?[0,.12,0]:[0,-.15,0]).applyMatrix4(part);
   const shift=target.clone().sub(controls.target).multiplyScalar(.3);controls.target.add(shift);camera.position.add(shift);
  }
  controls.update();root.updateMatrixWorld(true);fitTimer+=dt;
  if(fitTimer>.25&&!danceVisible&&view!=='face'&&view!=='hands'){
   fitTimer=0;const {min,max}=rig.getBounds();let outside=0;
   for(const x of [min.x,max.x])for(const y of [min.y,max.y])for(const z of [min.z,max.z]){
    const projected=fitCorner.set(x,y,z).project(camera);outside=Math.max(outside,Math.abs(projected.x),Math.abs(projected.y));
   }
   if(outside>.90){
    const offset=camera.position.clone().sub(controls.target),distance=Math.min(11,offset.length()*Math.min(1.08,outside/.88));
    camera.position.copy(controls.target).add(offset.setLength(distance));
   }
  }
  if(danceVisible&&danceTarget)danceCoach.update(danceTarget,dt);
  renderer.render(scene,camera);
 }
 const resize=()=>{
  const width=host.clientWidth,height=host.clientHeight;if(!width||!height)return;
  renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();if(danceVisible)fitDance();
 };
 new ResizeObserver(resize).observe(host);resize();update();
 return {update,isInteracting:now=>now<interactionUntil,
 setDanceTarget(m){danceTarget=m;},
 setDanceStage(enabled,practice=false){
  if(enabled&&!danceCoach){danceCoach=createDanceCoach(THREE,rig);scene.add(danceCoach.root);}
  danceVisible=enabled;dancePractice=practice;view='front';root.visible=!enabled||!practice;
  root.position.x=enabled&&!practice?1.65:0;
  if(danceCoach){danceCoach.root.visible=enabled;danceCoach.root.position.x=practice?0:-1.65;}
  controls.enabled=!enabled;
  controls.maxDistance=enabled?20:11;
  controls.target.set(0,1.7,0);camera.position.set(.35,2.1,6.4);if(enabled)fitDance();else controls.update();
 },
 getDanceStage:()=>({visible:danceVisible,practice:dancePractice,sharedGeometry:!danceCoach||danceCoach.meshes.every(m=>m.geometry===rig.mesh.geometry),coachBones:danceCoach?.meshes[0]?.skeleton.bones.length||0}),
 setLightweight(value){if(lightweight!==value){lightweight=value;rig.setLightweight(value);}},
 setRenderScale(value){if(Math.abs(renderer.getPixelRatio()-value)>.01){renderer.setPixelRatio(value);resize();}},setView(next='front'){
  view=next==='back'||next===true?'back':next==='face'?'face':next==='hands'?'hands':'front';
  const target=view==='face'?v([0,3.02,0]):view==='hands'?v([0,-.15,0]).applyMatrix4(groups[handSide+'_hand'].matrixWorld):v([0,1.75,0]);
  controls.target.copy(target);camera.position.copy(target).add(v(view==='face'?[.08,.02,1.1]:view==='hands'?[.12,.06,1.1]:[.35,.35,view==='back'?-6.4:6.4]));controls.update();
 },setWireframe(value){rig.setWireframe(value);for(const material of Object.values(materials))material.wireframe=value;},
 setSkeleton:rig.setSkeleton,getSkeleton:()=>rig.skeleton,getSkin:()=>rig.mesh,getJoints:()=>rig.joints,
 getRenderer:()=>renderer,getGroups:()=>groups,getCamera:()=>camera,getArmState:()=>structuredClone(armState),getLegState:()=>structuredClone(legState),getHandSide:()=>handSide};
}
