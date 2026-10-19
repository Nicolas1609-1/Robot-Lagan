import * as THREE from 'three';
const v=a=>new THREE.Vector3(...a);
export function punch(progress,{collapsed=false,confidence=.9,depth=true}={}){
 const upper=v([-.15,-.85,.5]).normalize().lerp(v([-.05,-.12,1]).normalize(),progress).normalize();
 const fore=v([0,.85,.52]).normalize().lerp(v([.03,.06,1]).normalize(),progress).normalize();
 const shoulder=v([.2,-.5,0]),elbow=shoulder.clone().addScaledVector(upper,-.32),wrist=elbow.clone().addScaledVector(fore,-.28);
 const coords={11:shoulder.toArray(),12:[-.2,-.5,0],13:elbow.toArray(),14:[-.3,-.2,0],15:wrist.toArray(),16:[-.4,0,0],23:[.12,0,0],24:[-.12,0,0]};
 const p=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:0,presence:1})),w=p.map(()=>({x:0,y:0,z:0}));
 for(const [i,c] of Object.entries(coords)){w[i]={x:c[0],y:c[1],z:c[2]};p[i]={x:.5+c[0]*.42,y:.55+c[1]*.42,z:depth?c[2]*.42/(4/3):0,visibility:.9,presence:1};}
 if(collapsed)w[15]={x:elbow.x,y:elbow.y+.01,z:elbow.z-.012};
 p[15].visibility=confidence;
 return {result:{landmarks:[p],worldLandmarks:[w]},upper:upper.toArray(),fore:fore.toArray()};
}

// Articulaciones físicas independientes del solver del robot. Ejes del avatar
// -> metros de MediaPipe y una proyección de cámara fija, sin puntos inventados.
export function lowerBody({yaw=0,roll=0,lean=0,leftHip=0,rightHip=0,leftKnee=0,rightKnee=0,leftTurn=0,rightTurn=0,leftSpread=0,rightSpread=0,leftFoot=null,rightFoot=null}={}){
 const pelvis=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,yaw,roll,'YXZ'));
 const torso=new THREE.Quaternion().setFromAxisAngle(v([1,0,0]),lean);
 const coords={},directions={},knees={left:leftKnee,right:rightKnee};
 const up=v([0,.52,0]).applyQuaternion(torso).applyQuaternion(pelvis);
 for(const [side,sign,hipId] of [['left',-1,23],['right',1,24]]){
  const hip=coords[hipId]=v([sign*.16,0,0]).applyQuaternion(pelvis);
  coords[side==='left'?11:12]=v([sign*.20,0,0]).applyQuaternion(pelvis).add(up);
  const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(-(side==='left'?leftHip:rightHip),side==='left'?leftTurn:rightTurn,side==='left'?leftSpread:rightSpread,'YXZ'));
  q.premultiply(pelvis);
  const thigh=v([0,-1,0]).applyQuaternion(q),shin=v([0,-1,0]).applyAxisAngle(v([1,0,0]),knees[side]).applyQuaternion(q);
  const foot=(side==='left'?leftFoot:rightFoot)?v(side==='left'?leftFoot:rightFoot).applyQuaternion(pelvis):v([0,0,1]).applyAxisAngle(v([0,1,0]),yaw+(side==='left'?leftTurn:rightTurn));
  directions[side]={thigh:thigh.toArray(),shin:shin.toArray(),foot:foot.toArray()};
  const knee=coords[hipId+2]=hip.clone().addScaledVector(thigh,.43),ankle=coords[hipId+4]=knee.clone().addScaledVector(shin,.43);
  coords[hipId+6]=ankle.clone().addScaledVector(foot,-.03);coords[hipId+8]=ankle.clone().addScaledVector(foot,.14);
  const shoulder=coords[side==='left'?11:12];
  coords[side==='left'?13:14]=shoulder.clone().add(v([sign*.08,-.25,0]));
  coords[side==='left'?15:16]=shoulder.clone().add(v([sign*.14,-.48,0]));
 }
 coords[0]=up.clone().add(v([0,.23,0]));
 const p=Array.from({length:33},()=>({x:.5,y:.4,z:0,visibility:0,presence:1})),w=p.map(()=>({x:0,y:0,z:0}));
 for(const [i,c] of Object.entries(coords)){
  w[i]={x:-c.x,y:-c.y,z:-c.z};p[i]={x:.5-c.x*.35,y:.44-c.y*.35,z:-c.z*.35/(4/3),visibility:.95,presence:1};
 }
 return {result:{landmarks:[p],worldLandmarks:[w]},directions,knees};
}

export function prayer(progress=1,{yaw=0,hidden=false,fingersUp=true}={}){
 const sample=lowerBody({yaw}),q=new THREE.Quaternion().setFromAxisAngle(v([0,1,0]),yaw);
 const p=sample.result.landmarks[0],w=sample.result.worldLandmarks[0];
 const put=(i,a)=>{a.applyQuaternion(q);w[i]={x:-a.x,y:-a.y,z:-a.z};p[i]={x:.5-a.x*.35,y:.44-a.y*.35,z:-a.z*.35/(4/3),visibility:hidden&&[15,16].includes(i)?.1:.95,presence:1};};
 for(const [sign,s,e,hand,index,pinky] of [[-1,11,13,15,19,17],[1,12,14,16,20,18]]){
  const shoulder=v([sign*.20,.52,0]),wrist=v([sign*(.30-.275*progress),.30,.25]);
  // Dos brazos humanos de .32 y .28 m, plano de codo hacia fuera y abajo.
  const axis=wrist.clone().sub(shoulder),d=axis.length();axis.normalize();
  const along=(.32**2+d*d-.28**2)/(2*d),pole=v([sign,-1,0]);pole.addScaledVector(axis,-pole.dot(axis)).normalize();
  const elbow=shoulder.clone().addScaledVector(axis,along).addScaledVector(pole,Math.sqrt(.32**2-along**2));
  put(s,shoulder);put(e,elbow);put(hand,wrist.clone());
  put(index,wrist.clone().add(v([0,fingersUp?.10:-.1,0])));put(pinky,wrist.clone().add(v([sign*.025,fingersUp?.085:-.085,0])));
 }
 return sample;
}
