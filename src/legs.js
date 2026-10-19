export const LEG_LIMITS=Object.freeze({knee:2.8});

// Cadera esférica y rodilla de bisagra. Transportar el plano anterior evita
// que una rodilla casi recta invierta su giro por ruido de profundidad.
export function createLegSolver(THREE){
 const v=a=>new THREE.Vector3(...a),down=v([0,-1,0]),clamp=THREE.MathUtils.clamp;
 let previous=null,hinge=null,knee=null,footYaw=0,missingFoot=0;
 return function solve({thigh,shin,foot,reference=[0,0,1],dt=.016}){
  dt=clamp(dt,.001,.05);thigh=v(thigh).normalize();shin=v(shin).normalize();
  const y=thigh.clone().negate(),normal=new THREE.Vector3().crossVectors(thigh,shin);
  let target=clamp(thigh.angleTo(shin),0,LEG_LIMITS.knee);
  const forward=v(reference).normalize();
  // La cadera puede rotar la pierna alrededor del muslo. El pie observado
  // orienta su plano de flexión: usar sólo el frente de la pelvis anulaba
  // la rodilla al bailar con una pierna girada de lado.
  if(foot?.every(Number.isFinite)&&Math.hypot(foot[0],foot[2])>.35){
   const heading=v([foot[0],0,foot[2]]).normalize(),base=v([forward.x,0,forward.z]).normalize();
   const angle=Math.atan2(new THREE.Vector3().crossVectors(base,heading).y,base.dot(heading));
   // Una punta dirigida hacia atrás puede ser extensión del empeine al
   // arrodillarse, no una orden de girar toda la cadera media vuelta.
   const target=Math.abs(angle)>2?0:clamp(angle,-1.65,1.65);
   footYaw+=clamp((target-footYaw)*(1-Math.exp(-dt*35)),-dt*14,dt*14);missingFoot=0;
  }else{missingFoot+=dt;if(missingFoot>.5)footYaw*=Math.exp(-dt*.7);}
  forward.applyAxisAngle(v([0,1,0]),footYaw);
  // Transportar el eje lateral desde reposo. Proyectar el frente sobre el
  // muslo cambia de signo al superar 90° y enderezaba una rodilla levantada.
  const lateral=new THREE.Vector3().crossVectors(v([0,1,0]),forward);
  if(lateral.lengthSq()<1e-7)lateral.set(1,0,0);
  const anatomical=lateral.normalize().applyQuaternion(new THREE.Quaternion().setFromUnitVectors(down,thigh));
  let hingeTarget=anatomical.clone();
  if(normal.lengthSq()>.015){
   normal.normalize();
   const plane=Math.atan2(y.dot(new THREE.Vector3().crossVectors(anatomical,normal)),anatomical.dot(normal));
   // Un signo opuesto cerca de extensión es ruido o hiperextensión,
   // no una orden para dar media vuelta al muslo.
   if(target>.35)hingeTarget.copy(normal);
   else if(Math.abs(plane)>1.45)target=0;
   else hingeTarget.applyAxisAngle(y,clamp(plane,-1.1,1.1));
  }
  if(hinge&&previous)hinge.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(previous,thigh));
  if(!hinge){
   hinge=hingeTarget.clone();
   knee=target;
  }
  hinge.addScaledVector(y,-hinge.dot(y)).normalize();
  const angle=Math.atan2(y.dot(new THREE.Vector3().crossVectors(hinge,hingeTarget)),hinge.dot(hingeTarget));
  hinge.applyAxisAngle(y,clamp(angle*(1-Math.exp(-dt*35)),-dt*12,dt*12));
  previous=thigh.clone();knee+=clamp((target-knee)*(1-Math.exp(-dt*45)),-dt*14,dt*14);
  const z=new THREE.Vector3().crossVectors(hinge,y).normalize();
  const thighRotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(hinge,y,z));
  const shinLocal=new THREE.Quaternion().setFromAxisAngle(v([1,0,0]),knee);
  const shinRotation=thighRotation.clone().multiply(shinLocal);
  return {thighRotation,shinLocal,knee,thighDirection:down.clone().applyQuaternion(thighRotation),shinDirection:down.clone().applyQuaternion(shinRotation)};
 };
}

// Resolver en el marco de la espinilla evita el giro de 180° de una bota
// vertical. La flexión plantar amplia permite apoyar el empeine al arrodillarse.
export function createAnkleSolver(THREE){
 const v=a=>new THREE.Vector3(...a),clamp=THREE.MathUtils.clamp;
 let rotation=new THREE.Quaternion(),ready=false;
 return ({shin,foot,measured=true,dt=.016})=>{
  const local=v(foot).applyQuaternion(shin.clone().invert()).normalize();
  const rawPitch=Math.atan2(-local.y,local.z),previousPitch=new THREE.Euler().setFromQuaternion(rotation,'YXZ').x;
  const continuousPitch=ready?previousPitch+Math.atan2(Math.sin(rawPitch-previousPitch),Math.cos(rawPitch-previousPitch)):rawPitch;
  const pitch=clamp(continuousPitch,-1.05,1.55);
  const yaw=clamp(Math.atan2(local.x,Math.hypot(local.y,local.z)),-.9,.9);
  const target=new THREE.Quaternion().setFromAxisAngle(v([0,1,0]),yaw)
   .multiply(new THREE.Quaternion().setFromAxisAngle(v([1,0,0]),pitch));
  if(!ready){rotation.copy(measured?target:new THREE.Quaternion());ready=true;}
  if(measured){
   const angle=rotation.angleTo(target);
   rotation.slerp(target,angle<1e-7?1:Math.min(1-Math.exp(-dt*38),dt*12/angle));
  }
  // Al ocultarse la punta se mantiene el tobillo local, no una bota anclada
  // al frente del escenario mientras la rodilla sigue moviéndose.
  const angles=new THREE.Euler().setFromQuaternion(rotation,'YXZ');
  return {local:rotation.clone(),pitch:angles.x,yaw:angles.y,roll:angles.z};
 };
}
