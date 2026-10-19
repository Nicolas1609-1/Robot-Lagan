import {relaxedHand} from './hands.js';

export const ARM_LIMITS=Object.freeze({elbow:2.70,wristFlex:1.60,wristSide:1.05});

// Alcance con dos segmentos de longitud fija: conserva el lado del codo
// observado y aproxima sólo los objetivos fuera del alcance físico del robot.
export function solveArmReach(THREE,{shoulder,target,elbow,upperLength,foreLength}){
 const axis=target.clone().sub(shoulder),distance=axis.length();
 if(distance<1e-7)return null;
 axis.divideScalar(distance);
 const minimum=Math.sqrt(upperLength**2+foreLength**2+2*upperLength*foreLength*Math.cos(ARM_LIMITS.elbow));
 const d=THREE.MathUtils.clamp(distance,minimum,upperLength+foreLength-.0001);
 const along=(upperLength**2+d*d-foreLength**2)/(2*d);
 const pole=elbow.clone().sub(shoulder);pole.addScaledVector(axis,-pole.dot(axis));
 if(pole.lengthSq()<1e-7){pole.set(0,-1,0).addScaledVector(axis,axis.y);}
 if(pole.lengthSq()<1e-7){pole.set(0,0,1).addScaledVector(axis,-axis.z);}
 const joint=shoulder.clone().addScaledVector(axis,along).addScaledVector(pole.normalize(),Math.sqrt(Math.max(0,upperLength**2-along**2)));
 const wrist=shoulder.clone().addScaledVector(axis,d);
 return {upper:joint.clone().sub(shoulder).normalize(),fore:wrist.clone().sub(joint).normalize(),wrist};
}

// Hombro con giro, codo de bisagra, pronación del antebrazo y muñeca separada.
// Las orientaciones entran y salen en el mismo espacio del robot.
export function createArmSolver(THREE){
 const v=a=>new THREE.Vector3(...a),down=v([0,-1,0]),axisY=v([0,1,0]);
 const qAxis=(axis,angle)=>new THREE.Quaternion().setFromAxisAngle(axis,angle);
 const clamp=THREE.MathUtils.clamp;
 let previousUpper=null,hinge=null,elbow=0,twist=0;
 const wrist=new THREE.Quaternion();
 return function solve({upper,fore,basis,handPose,visible=false,blend=visible?1:0,reference=[0,0,1],dt=.016}){
  dt=clamp(dt,.001,.05);upper=v(upper).normalize();fore=v(fore).normalize();
  const y=upper.clone().negate(),bend=clamp(upper.angleTo(fore),0,ARM_LIMITS.elbow);
  const normal=new THREE.Vector3().crossVectors(upper,fore).negate();
  if(hinge&&previousUpper)hinge.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(previousUpper,upper));
  if(!hinge){
   if(normal.lengthSq()>.0025)hinge=normal.normalize();
   else{
    const z=v(reference).addScaledVector(y,-v(reference).dot(y));
    if(z.lengthSq()<1e-7)z.copy(Math.abs(y.x)<.8?v([1,0,0]):v([0,1,0])).addScaledVector(y,-z.dot(y));
    hinge=new THREE.Vector3().crossVectors(y,z.normalize()).normalize();
   }
   elbow=bend;
  }
  hinge.addScaledVector(y,-hinge.dot(y)).normalize();
  // Cerca de un brazo recto no hay un plano de codo fiable: conservar el anterior.
  if(normal.lengthSq()>.01){
   const target=normal.normalize();
   const angle=Math.atan2(y.dot(new THREE.Vector3().crossVectors(hinge,target)),hinge.dot(target));
   hinge.applyAxisAngle(y,clamp(angle*(1-Math.exp(-dt*40)),-dt*18,dt*18));
  }
  previousUpper=upper.clone();elbow+=clamp((bend-elbow)*(1-Math.exp(-dt*75)),-dt*24,dt*24);
  const z=new THREE.Vector3().crossVectors(hinge,y).normalize();
  const upperRotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(hinge,y,z));
  const flex=qAxis(v([1,0,0]),-elbow),unturned=upperRotation.clone().multiply(flex);
  if(handPose){
   // La demo sigue la postura YA suavizada, también durante la entrada al modo.
   const handY=axisY.clone().applyQuaternion(unturned),palm=v(handPose.palm);
   const handZ=palm.addScaledVector(handY,-palm.dot(handY));
   if(handZ.lengthSq()<1e-7)handZ.copy(v([0,0,1]).applyQuaternion(unturned));
   handZ.normalize();const handX=new THREE.Vector3().crossVectors(handY,handZ).normalize();
   handZ.crossVectors(handX,handY).normalize();
   const rotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(handX,handY,handZ))
    .multiply(qAxis(axisY,handPose.turn)).multiply(qAxis(v([1,0,0]),handPose.bend));
   basis=[[1,0,0],[0,1,0],[0,0,1]].map(a=>v(a).applyQuaternion(rotation).toArray());
  }
  let desiredTwist=0,targetWrist=new THREE.Quaternion();
  if(visible&&basis?.length===3){
   const axes=basis.map(v),handRotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(...axes));
   const local=unturned.clone().invert().multiply(handRotation).normalize();
   // La parte axial gira el antebrazo. La muñeca sólo recibe la flexión residual.
   const axial=new THREE.Quaternion(0,local.y,0,local.w);
   if(axial.lengthSq()>1e-8)axial.normalize();else axial.identity();
   desiredTwist=2*Math.atan2(axial.y,axial.w);
   targetWrist.copy(axial).invert().multiply(local).normalize();
   if(targetWrist.w<0)targetWrist.set(-targetWrist.x,-targetWrist.y,-targetWrist.z,-targetWrist.w);
   const angle=2*Math.acos(clamp(targetWrist.w,-1,1)),length=Math.hypot(targetWrist.x,targetWrist.z);
   if(length>1e-8){
    const x=targetWrist.x/length*angle,zAngle=targetWrist.z/length*angle;
    const limit=Math.max(1,Math.hypot(x/ARM_LIMITS.wristFlex,zAngle/ARM_LIMITS.wristSide));
    targetWrist.setFromAxisAngle(v([targetWrist.x,0,targetWrist.z]).normalize(),angle/limit);
   }else targetWrist.identity();
   targetWrist.slerp(new THREE.Quaternion(),1-clamp(blend,0,1));
   desiredTwist=Math.atan2(Math.sin(desiredTwist),Math.cos(desiredTwist))*clamp(blend,0,1);
  }
  const delta=Math.atan2(Math.sin(desiredTwist-twist),Math.cos(desiredTwist-twist));
  twist+=clamp(delta*(1-Math.exp(-dt*32)),-dt*8,dt*8);
  const angle=wrist.angleTo(targetWrist);wrist.slerp(targetWrist,angle<1e-7?1:Math.min(1-Math.exp(-dt*32),dt*8/angle));
  const foreLocal=flex.clone().multiply(qAxis(axisY,twist));
  const foreRotation=upperRotation.clone().multiply(foreLocal);
  return {upperRotation,foreLocal,foreRotation,wristRotation:wrist.clone(),elbow,twist,
   upperDirection:down.clone().applyQuaternion(upperRotation),foreDirection:down.clone().applyQuaternion(foreRotation)};
 };
}

export function buildDemoMotion(THREE,t){
 const v=a=>new THREE.Vector3(...a),clamp=THREE.MathUtils.clamp;
 const jumpPhase=t%8-4,jump=jumpPhase>=0&&jumpPhase<.8?Math.sin(jumpPhase/.8*Math.PI)*.55:0;
 const m={directions:{},position:[Math.sin(t*.7)*.16,jump,0],yaw:Math.sin(t*.5)*.22,roll:Math.sin(t*1.6)*.04,pitch:0,
  pelvis:{pitch:Math.max(0,Math.sin(t*.7))*.14,roll:Math.sin(t*1.6)*.18},
  hands:{},curls:{},handPose:{},handVisible:{left:true,right:true},handBlend:{left:1,right:1},
  face:{jaw:(Math.sin(t*2)+1)*.3,smile:(Math.sin(t*.8)+1)*.4,
   blinkLeft:Math.pow(Math.max(0,Math.sin(t*1.7)),18),blinkRight:Math.pow(Math.max(0,Math.sin(t*1.7)),18),
   browLeft:(Math.sin(t*.7)+1)*.4,browRight:(Math.sin(t*.7)+1)*.4,yaw:Math.sin(t*.5)*.15,roll:0}};
 for(const [side,sign] of [['left',-1],['right',1]]){
  const phase=t*.65+(sign===1?Math.PI:0),lift=.35+.65*(Math.sin(phase)+1)/2;
  const upper=v([sign*Math.sin(lift),-Math.cos(lift),.08]).normalize();
  const toward=v([sign*Math.cos(lift),Math.sin(lift),.16]);toward.addScaledVector(upper,-toward.dot(upper)).normalize();
  const bend=.40+1.10*(Math.sin(phase)+1)/2;
  const fore=upper.clone().multiplyScalar(Math.cos(bend)).addScaledVector(toward,Math.sin(bend)).normalize();
  m.directions[side+'_upper']=upper.toArray();m.directions[side+'_fore']=fore.toArray();
  // La palma se construye SOBRE el antebrazo, no sobre los ejes de la pantalla.
  const y=fore.clone().negate(),z=v([0,0,1]).addScaledVector(y,-y.z).normalize();
  const x=new THREE.Vector3().crossVectors(y,z).normalize();z.crossVectors(x,y).normalize();
  const handRotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));
  m.handPose[side]={palm:[0,0,1],turn:Math.sin(t*.9)*.25,bend:Math.sin(t*1.2)*.10};
  handRotation.multiply(new THREE.Quaternion().setFromAxisAngle(v([0,1,0]),m.handPose[side].turn));
  handRotation.multiply(new THREE.Quaternion().setFromAxisAngle(v([1,0,0]),m.handPose[side].bend));
  let curl=clamp(Math.sin(t*1.1+(sign===1?Math.PI:0))*1.4+.5,0,1);curl=curl*curl*(3-2*curl);
  m.curls[side]=Array(5).fill(curl*.94);m.hands[side]=relaxedHand(side,m.curls[side]);
  m.hands[side].basis=[[1,0,0],[0,1,0],[0,0,1]].map(axis=>v(axis).applyQuaternion(handRotation).toArray());
  const step=t*1.6+(sign===1?Math.PI:0);
  const raised=Math.max(0,Math.sin(step)),squat=Math.max(0,Math.sin(t*.7))*.35;
  const hip=new THREE.Quaternion().setFromEuler(new THREE.Euler(-raised*.95-squat,sign*.20,sign*Math.sin(step)*.13));
  const knee=raised*1.25+squat*1.5;
  m.directions[side+'_thigh']=v([0,-1,0]).applyQuaternion(hip).toArray();
  m.directions[side+'_shin']=v([0,-1,0]).applyAxisAngle(v([1,0,0]),knee).applyQuaternion(hip).toArray();
  m.directions[side+'_foot']=v([sign*.2,raised*.2,1]).normalize().toArray();
 }
 return m;
}
