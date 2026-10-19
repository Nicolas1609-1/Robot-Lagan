import {relaxedHand,handGeometry,handAssignments,stabilizeHand,fadeHand} from './hands.js';
import {JumpDetector} from './jump.js';
export {relaxedHand,handGeometry} from './hands.js';
// Coordenadas de MediaPipe sin espejo -> avatar y cámara mostrados como espejo.
export const LEG_POINTS={left:[23,25,27,29,31],right:[24,26,28,30,32]};
export const BONES={left_upper:[11,13],left_fore:[13,15],right_upper:[12,14],right_fore:[14,16],
 left_thigh:[23,25],left_shin:[25,27],right_thigh:[24,26],right_shin:[26,28],left_foot:[29,31],right_foot:[30,32]};
export const POSE_LINKS=[[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],[11,12],[11,13],[13,15],[15,17],[17,19],[15,19],[15,21],[12,14],[14,16],[16,18],[18,20],[16,20],[16,22],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32]];
export const HAND_LINKS=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
const length=a=>Math.hypot(...a);
const norm=(a,fallback=[0,-1,0])=>{const n=length(a);return n>1e-7&&Number.isFinite(n)?a.map(x=>x/n):[...fallback];};
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const clip=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const vector=p=>[p.x,p.y,p.z];
const mix=(a,b,t)=>a.map((x,i)=>x+(b[i]-x)*t);
const rotate=(a,yaw)=>[Math.cos(yaw)*a[0]+Math.sin(yaw)*a[2],a[1],-Math.sin(yaw)*a[0]+Math.cos(yaw)*a[2]];
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const angularDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
// Interpolación sobre la esfera: dos vectores opuestos no deben colapsar a cero.
function turnTowards(previous,target,amount,maxAngle){
 const distance=Math.acos(clip(dot(previous,target),-1,1));
 if(distance<1e-6)return [...target];
 const step=Math.min(distance*amount,maxAngle);
 let tangent=sub(target,previous.map(x=>x*Math.cos(distance)));
 if(length(tangent)<1e-6)tangent=cross(previous,Math.abs(previous[0])<.8?[1,0,0]:[0,1,0]);
 tangent=norm(tangent);
 return norm(previous.map((x,i)=>x*Math.cos(step)+tangent[i]*Math.sin(step)),previous);
}
export function angle(a,b,c){
 const u=norm(sub(a,b),[0,0,0]),v=norm(sub(c,b),[0,0,0]);
 return Math.acos(clip(u.reduce((s,x,i)=>s+x*v[i],0),-1,1))*180/Math.PI;
}
export function reliable(p,threshold=.45){
 return p&&[p.x,p.y,p.z].every(Number.isFinite)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1
   &&(p.visibility??1)>=threshold&&(p.presence??1)>=.35;
}
export function neutralMotion(){
 return {worldSpace:true,filtered:true,directions:{},position:[0,0,0],yaw:0,pitch:0,roll:0,torsoYaw:0,
  pelvis:{pitch:0,roll:0,visible:false,count:0},armContact:null,
  handVisible:{left:false,right:false},handBlend:{left:0,right:0},hands:{left:relaxedHand('left'),right:relaxedHand('right')},curls:{left:Array(5).fill(.12),right:Array(5).fill(.12)},face:{jaw:0,smile:0,blinkLeft:0,blinkRight:0,brow:0,yaw:0,roll:0},
  visible:new Set(),legCounts:[0,0],knees:{},bodyVisible:false,jump:{state:'waiting',active:false,height:0,count:0}};
}
export class Retargeter{
 constructor(){this.smoothing=.25;this.expressionStrength=1.5;this.threshold=.4;this.faceNeutral={};this.reset();}
 reset(){this.motion=neutralMotion();this.seen={};this.references={};this.sample=null;this.lastTime=null;this.poseInterval=40;this.lastPoseArrival=null;this.lastFace=null;this.handWrists={};this.handStates={};this.boneStates={};this.angleStates={};this.coordinateSpace=null;this.imageScale=null;this.contactAt=this.prayerAt=-Infinity;this.prayerDisagreements=0;this.jumpDetector=new JumpDetector();}
 clearDetails(){
  const neutral=neutralMotion();
  for(const key of ['hands','handVisible','handBlend','curls','face'])this.motion[key]=neutral[key];
  for(const side of ['left','right'])delete this.seen[side+'_hand'];
  this.lastFace=null;this.handWrists={};this.handStates={};
 }
 setSensitivity(high){this.threshold=high?.30:.4;}
 reacquireBody(){
  // Nueva distancia y suelo, conservando el contador de saltos y la cámara.
  this.references={};this.boneStates={};this.angleStates={};this.imageScale=null;
  this.contactAt=this.prayerAt=-Infinity;this.prayerDisagreements=0;
  this.sample=null;this.seen={};this.motion.visible=new Set();this.motion.position=[0,0,0];this.motion.armContact=null;
  this.jumpDetector.reset(true);this.motion.jump=this.jumpDetector.snapshot();this.clearDetails();
 }
 gain(dt,speed=0){return 1-Math.exp(-dt*((1-this.smoothing)*15+4+speed*10));}
 bodyGain(dt,speed=0){return 1-Math.exp(-dt*(10+(1-this.smoothing)*12+Math.min(40,speed*3)));}
 filterAngle(key,previous,target,dt,rate=5){
  const delta=angularDelta(previous,target),state=this.angleStates[key]??={};
  const measured=state.raw===undefined?0:Math.abs(angularDelta(state.raw,target));
  if(measured>Math.max(1.1,dt*12+.25)&&state.ready){
   const pending=state.pending;state.pending=target;
   if(pending===undefined||Math.abs(angularDelta(pending,target))>Math.max(.4,dt*12))return previous;
  }else state.pending=undefined;
  state.ready=true;state.raw=target;
  return previous+clip(delta*this.bodyGain(dt,measured/dt),-rate*dt,rate*dt);
 }
 center(){if(!this.sample||!this.motion.bodyVisible)return false;this.references={};this.motion.position=[0,0,0];this.jumpDetector.reset(true);return true;}
 calibrateFace(){if(!this.lastFace)return false;this.faceNeutral={...this.lastFace};return true;}
 updatePose(result,now,width=640,height=480,receivedAt=now){
  if(!Number.isFinite(now)||(this.lastTime!==null&&now<=this.lastTime))return this.motion;
  const m=this.motion,points=result.landmarks?.[0]||[],world=result.worldLandmarks?.[0];
  const dt=clip(this.lastTime===null?.04:(now-this.lastTime)/1000,.008,.12);
  if(this.lastTime!==null)this.poseInterval=this.poseInterval*.4+clip(now-this.lastTime,8,1000)*.6;
  const confidenceWindow=clip(this.poseInterval*2.5,350,1000);
  this.lastTime=now;
  this.lastPoseArrival=receivedAt;
  const visible=new Set();
  points.forEach((p,i)=>{
   // Histéresis de confianza: evitar perder un punto por una sola caída pequeña.
   const threshold=now-(this.seen['point'+i]??-Infinity)<confidenceWindow?Math.max(.25,this.threshold-.15):this.threshold;
   if(reliable(p,threshold)){visible.add(i);this.seen['point'+i]=now;}
  });
  m.visible=visible;m.legCounts=Object.values(LEG_POINTS).map(ids=>ids.filter(i=>visible.has(i)).length);
  m.jump=this.jumpDetector.update(points,visible,now);
  // Una muestra utiliza una sola unidad. Un punto 3D inválido se pierde; nunca
  // se reemplaza con píxeles dentro de un esqueleto expresado en metros.
  const useWorld=!!world,space=useWorld?'meters':'pixels';
  if(this.coordinateSpace!==space){this.boneStates={};this.references={};this.coordinateSpace=space;}
  const xyz=i=>useWorld?(world[i]&&vector(world[i]).every(Number.isFinite)?vector(world[i]):null)
   :points[i]?[points[i].x*width,points[i].y*height,points[i].z*width]:null;
  const valid=ids=>ids.every(i=>visible.has(i)&&xyz(i));
  const pairValid=(ids,min,max)=>valid(ids)&&(!useWorld||length(sub(xyz(ids[0]),xyz(ids[1])))>=min&&length(sub(xyz(ids[0]),xyz(ids[1])))<=max);
  const shoulders=pairValid([11,12],.10,.85),hips=pairValid([23,24],.07,.65);
  if(useWorld&&shoulders&&hips){
   const center=ids=>ids.map(xyz).reduce((a,b)=>a.map((x,i)=>(x+b[i])/2));
   const physical=length(sub(center([11,12]),center([23,24])));
   const projected=Math.hypot((points[11].x+points[12].x-points[23].x-points[24].x)*width/height/2,(points[11].y+points[12].y-points[23].y-points[24].y)/2);
   if(physical>.15&&physical<.85&&projected>.035){
    const scale=physical/projected;
    if(this.imageScale===null)this.imageScale=scale;
    else this.imageScale+=(scale-this.imageScale)*(1-Math.exp(-dt*10));
   }
  }
  m.bodyVisible=shoulders||hips;m.knees={};
  m.pelvis.visible=hips;m.pelvis.count=[23,24].filter(i=>visible.has(i)&&xyz(i)).length;
  if(m.bodyVisible){
   if(now-(this.seen.body??now)>1000)this.references={};
   this.seen.body=now;
   const ids=hips?[23,24]:[11,12],lateral=norm(sub(xyz(ids[0]),xyz(ids[1])),[1,0,0]);
   const targetYaw=Math.atan2(-lateral[2],lateral[0]);
   if(hips||now-(this.seen.hips??-Infinity)>1000)m.yaw=this.filterAngle('yaw',m.yaw,targetYaw,dt);
   if(hips){
    const tilt=clip(Math.atan2(lateral[1],Math.hypot(lateral[0],lateral[2])),-.8,.8);
    m.pelvis.roll=this.filterAngle('hipRoll',m.pelvis.roll,tilt,dt,5);
    this.seen.hips=now;
   }
   if(shoulders){
    const across=norm(sub(xyz(11),xyz(12)),[1,0,0]);
    const shoulderYaw=Math.atan2(-across[2],across[0]);
    const hasPelvis=hips||now-(this.seen.hips??-Infinity)<=1000;
    m.torsoYaw=this.filterAngle('torsoYaw',m.torsoYaw,hasPelvis?clip(angularDelta(hips?targetYaw:m.yaw,shoulderYaw),-1.1,1.1):0,dt,5);
    const tilt=clip(Math.atan2(across[1],Math.hypot(across[0],across[2])),-.65,.65);
    m.roll=this.filterAngle('torsoRoll',m.roll,clip(tilt-m.pelvis.roll,-.65,.65),dt,4);
   }
   if(shoulders&&hips){
    const up=xyz(11).map((x,i)=>-(x+xyz(12)[i]-xyz(23)[i]-xyz(24)[i])/2);
    if(!useWorld||length(up)>.12&&length(up)<1){
     const local=rotate(norm(up,[0,1,0]),-m.yaw);
     const lean=clip(Math.atan2(local[2],local[1]),-.9,.9);
     // Dos caderas miden giro y balanceo. La inclinación frontal se aproxima
     // con la columna; no se presenta como un punto adicional detectado.
     m.pelvis.pitch=this.filterAngle('hipPitch',m.pelvis.pitch,lean*.5,dt,5);
     m.pitch=this.filterAngle('torsoPitch',m.pitch,lean-m.pelvis.pitch,dt,4);
    }
   }
   const centerIds=hips?[23,24]:[11,12],p=points[centerIds[0]],q=points[centerIds[1]];
   const center=[(p.x+q.x)/2,(p.y+q.y)/2];
   // Usar el alto del torso evita confundir un giro de perfil con alejarse.
   const span=shoulders&&hips?Math.hypot((points[11].x+points[12].x-p.x-q.x)*width/height/2,(points[11].y+points[12].y-p.y-q.y)/2):null;
   const key=centerIds.join(':');
   this.sample={key,center};
   if(!this.references[key])this.references[key]={center:[center[0]+m.position[0]/3.3,center[1]],span:span>.05?span:null};
   const ref=this.references[key];
   if(!ref.span&&span>.05)ref.span=span;
   const depth=span>.05&&ref.span?clip(.6*(1-ref.span/span),-.45,.45):m.position[2];
   const target=[clip(-(center[0]-ref.center[0])*3.3,-1.25,1.25),m.position[1],depth];
   m.position=m.position.map((x,i)=>i===1?x:x+clip((target[i]-x)*this.bodyGain(dt),-dt*2,dt*2));
  }
  m.position[1]+=clip((m.jump.height-m.position[1])*(1-Math.exp(-dt*32)),-dt*6,dt*6);
  for(const [name,ids] of Object.entries(BONES)){
   if(now<(this.seen[name]??-Infinity))continue;
   const fallback=name.endsWith('_foot')?[0,0,1]:[0,-1,0];
   const state=this.boneStates[name]??={},arm=/(upper|fore)$/.test(name),leg=/(thigh|shin)/.test(name);
   // Un puño puede tapar momentáneamente la muñeca. Conservar sólo medidas
   // recientes, finitas y dentro de imagen; no contar la reconstrucción como punto.
   const occluded=(arm||leg)&&state.length&&now-(state.observedTime??-Infinity)<180&&ids.every(i=>reliable(points[i],.20)&&xyz(i))&&ids.some(i=>visible.has(i));
   if(valid(ids)||occluded){
    let raw=sub(xyz(ids[1]),xyz(ids[0])).map(x=>-x),size=length(raw);
    const foot=name.endsWith('_foot');
    if(useWorld&&(arm||leg)&&state.length>.12&&size>1e-6&&size<state.length*.6&&this.imageScale&&ids.every(i=>reliable(points[i],.20))){
     const a=points[ids[0]],b=points[ids[1]],scale=this.imageScale;
     const xy=[-(b.x-a.x)*width/height*scale,-(b.y-a.y)*scale],depth=-(b.z-a.z)*width/height*scale;
     const ratio=Math.hypot(...xy)/state.length;
     // El escorzo reduce la proyección. La profundidad observada debe aportar
     // su signo antes de reconstruir con la longitud calibrada en metros.
     if(ratio<.8&&Math.abs(depth)>state.length*.12&&(Math.abs(raw[2])<state.length*.15||Math.sign(raw[2])===Math.sign(depth))){
      raw=[...xy,Math.sign(depth)*Math.sqrt(Math.max(0,state.length**2-xy[0]**2-xy[1]**2))];size=state.length;
     }
    }
    if(!Number.isFinite(size)||size<1e-6||useWorld&&(size<(foot?.015:leg?.10:.055)||size>(foot?.5:leg?1.15:.95)))continue;
    if(state.length&&(size/state.length<.45||size/state.length>1.9)){
     state.lengthCount=state.pendingLength&&Math.abs(size/state.pendingLength-1)<.2?(state.lengthCount||0)+1:1;
     state.pendingLength=size;
     if(state.lengthCount<3)continue;
     state.length=size;
    }else{state.lengthCount=0;state.pendingLength=null;}
    const value=norm(raw,fallback),previous=m.directions[name];
    if(previous){
     // Comparar contra la medida anterior, no contra el modelo suavizado.
     const elapsed=clip((now-(state.time??now-dt*1000))/1000,.008,.25);
     const distance=Math.acos(clip(dot(value,state.raw||previous),-1,1));
     if(distance>Math.max(arm?1.75:1.35,elapsed*(leg?12:24)+.2)){
      const pending=state.pending;state.pending=value;
      if(!pending||dot(pending,value)<Math.cos(Math.min(1.2,Math.max(.45,elapsed*12))))continue;
     }else state.pending=null;
     const rate=foot?Math.min(18,8+distance/elapsed*.8):leg?Math.min(24,12+distance/elapsed*.8):Math.max(12,Math.min(32,distance/elapsed*1.3));
     m.directions[name]=turnTowards(previous,value,this.bodyGain(dt,distance/elapsed),rate*dt);
    }else m.directions[name]=value;
    state.raw=value;state.time=now;state.length=state.length?state.length*.98+size*.02:size;
    if(valid(ids))state.observedTime=now;
    this.seen[name]=now;
   }
  }
  for(const [side,ids] of Object.entries(LEG_POINTS))if(valid(ids.slice(0,3)))m.knees[side]=angle(...ids.slice(0,3).map(xyz));
  const previousContact=m.armContact;m.armContact=null;
  if(useWorld&&shoulders&&valid([13,14,15,16])){
   const width3D=length(sub(xyz(11),xyz(12))),separation=length(sub(xyz(15),xyz(16)));
   const upper=(length(sub(xyz(13),xyz(11)))+length(sub(xyz(14),xyz(12))))/2;
   const fore=(length(sub(xyz(15),xyz(13)))+length(sub(xyz(16),xyz(14))))/2;
   const weight=clip((.65-separation/width3D)/.37);
   if(weight>0&&upper>.12&&upper<.65&&fore>.12&&fore<.6){
    const center=xyz(15).map((x,i)=>-(x+xyz(16)[i]-xyz(11)[i]-xyz(12)[i])/2/(upper+fore));
    const delta=sub(xyz(16),xyz(15)).map(x=>-x/fore);
    const palmsAvailable=['left','right'].every(side=>m.handVisible[side]&&m.handBlend[side]>.6&&Math.abs(now-(this.seen[side+'_hand']??-Infinity))<300);
    const detailedPrayer=['left','right'].every(side=>m.hands[side].basis[1][1]<-.65)
     &&dot(m.hands.left.basis[2],m.hands.right.basis[2])<-.65&&dot(m.hands.left.basis[2],delta)>0;
    const fingersAvailable=valid([19,20]);
    let prayer=palmsAvailable?detailedPrayer:fingersAvailable&&[ [15,19],[16,20] ].every(([a,b])=>norm(sub(xyz(b),xyz(a)))[1]<-.65);
    if(prayer){this.prayerAt=now;this.prayerDisagreements=0;}
    else if(previousContact?.prayer&&now-(this.prayerAt??-Infinity)<300){
     if(!palmsAvailable&&!fingersAvailable)prayer=true;
     else if(palmsAvailable&&(this.prayerDisagreements=(this.prayerDisagreements||0)+1)<2)prayer=true;
    }
    m.armContact={center,delta,weight,prayer};
    this.contactAt=now;
   }
  }
  // Una oclusión breve no abre los brazos de golpe. La retención no renueva
  // su reloj y termina al separar las muñecas o perder ambas de verdad.
  else if(previousContact?.weight>.8&&shoulders&&now-(this.contactAt??-Infinity)<180&&[15,16].every(i=>reliable(points[i],.15)&&xyz(i))&&[15,16].some(i=>visible.has(i))){
   m.armContact=previousContact;
  }
  return m;
 }
 updateDetails(result,now,width=640,height=480){
  const hands=result.hands||{},face=result.face||{},m=this.motion;
  const entries=(hands.landmarks||[]).slice(0,2).map((p,index)=>({p,index})).filter(e=>e.p.length===21&&e.p.every(p=>[p.x,p.y,p.z].every(Number.isFinite)));
  for(const [entry,side] of handAssignments(entries,hands,result.posePoints,result.poseVisible||m.visible,this.handWrists,now,result.poseTime)){
   if(now<=(this.seen[side+'_hand']??-Infinity))continue;
   // Filtrar en coordenadas de cámara: el giro de cadera no debe cambiar la
   // orientación de una mano que llegó de otro worker unos milisegundos después.
   const shape=handGeometry(entry.p,hands.worldLandmarks?.[entry.index],side,0,width,height,m.hands[side],hands.gestures?.[entry.index]?.[0]);
   if(!shape)continue;
   const dt=clip((now-(this.seen[side+'_hand']??now-40))/1000,.008,.15);
   const state=this.handStates[side]??={};
   const stable=stabilizeHand(side,m.hands[side],shape,dt,state);
   if(!stable)continue;
   m.hands[side]=stable;
   // El detector de manos localiza la muñeca con más detalle que el corporal.
   // Ajustar su proyección conserva la profundidad medida del antebrazo.
   const elbowId=side==='left'?13:14,elbow=result.posePoints?.[elbowId],foreName=side+'_fore';
   if(elbow&&(result.poseVisible||m.visible).has(elbowId)&&Math.abs(now-(result.poseTime??now))<220&&now>=(this.seen[foreName]??-Infinity)&&now-(this.seen[foreName]??-Infinity)<600){
    const fore=m.directions[foreName],xy=[-(entry.p[0].x-elbow.x)*width,-(entry.p[0].y-elbow.y)*height];
    if(fore&&Math.hypot(...xy)>3){
     const planar=Math.hypot(fore[0],fore[1]);
     const previous=Math.atan2(fore[1],fore[0]),target=Math.atan2(xy[1],xy[0]);
     const heading=previous+clip(angularDelta(previous,target)*.65,-dt*8,dt*8);
     m.directions[foreName]=[Math.cos(heading)*planar,Math.sin(heading)*planar,fore[2]];this.seen[foreName]=now;
    }
   }
   const old=this.handWrists[side],wrist=entry.p[0];
   const elapsed=old?Math.max(.02,(now-old.time)/1000):1;
   this.handWrists[side]={x:wrist.x,y:wrist.y,time:now,
    vx:old?clip((wrist.x-old.x)/elapsed,-3,3)*.65+(old.vx||0)*.35:0,
    vy:old?clip((wrist.y-old.y)/elapsed,-3,3)*.65+(old.vy||0)*.35:0};
   m.handVisible[side]=true;m.handBlend[side]=1;this.seen[side+'_hand']=now;
  }
  const landmarks=face.faceLandmarks?.[0];
  if(landmarks?.length>=468){
   const dt=clip((now-(this.seen.face??now-40))/1000,.008,.2);
   const c=Object.fromEntries((face.faceBlendshapes?.[0]?.categories||[]).map(item=>[item.categoryName,item.score]));
   const ear=(landmarks[234].x+landmarks[454].x)/2;
   const span=Math.max(.025,Math.abs(landmarks[234].x-landmarks[454].x));
   const yaw=clip(-(landmarks[1].x-ear)/span*3.5,-.9,.9);
   const roll=Math.atan2((landmarks[263].y-landmarks[33].y)*height,(landmarks[263].x-landmarks[33].x)*width);
   const eyeY=(landmarks[33].y+landmarks[263].y)/2,chin=landmarks[152].y;
   const pitch=clip(((landmarks[1].y-eyeY)/Math.max(.01,chin-eyeY)-.43)*2,-.65,.65);
   const values={jaw:c.jawOpen||0,smileLeft:c.mouthSmileLeft||0,smileRight:c.mouthSmileRight||0,
    frownLeft:c.mouthFrownLeft||0,frownRight:c.mouthFrownRight||0,pucker:Math.max(c.mouthPucker||0,c.mouthFunnel||0),
    blinkLeft:c.eyeBlinkLeft||0,blinkRight:c.eyeBlinkRight||0,wideLeft:c.eyeWideLeft||0,wideRight:c.eyeWideRight||0,
    squintLeft:c.eyeSquintLeft||0,squintRight:c.eyeSquintRight||0,
    browLeft:Math.max(c.browInnerUp||0,c.browOuterUpLeft||0),browRight:Math.max(c.browInnerUp||0,c.browOuterUpRight||0),
    downLeft:c.browDownLeft||0,downRight:c.browDownRight||0,yaw,pitch,roll};
   this.lastFace=values;
   for(const [key,value] of Object.entries(values)){
    let target=value-(this.faceNeutral[key]||0);
    if(key==='yaw'){target-=m.bodyVisible?m.yaw+m.torsoYaw:0;target=clip(Math.atan2(Math.sin(target),Math.cos(target)),-.9,.9);}
    else if(key==='roll')target=clip(target-(m.bodyVisible?m.roll+m.pelvis.roll:0),-.6,.6);
    else if(key==='pitch')target=clip(target,-.65,.65);
    else target=clip(target/Math.max(.3,1-(this.faceNeutral[key]||0))*this.expressionStrength);
    const previous=m.face[key]||0;
    const a=key.startsWith('blink')?1-Math.exp(-dt*65):this.gain(dt,Math.abs(target-previous)/dt);
    m.face[key]=previous+(target-previous)*a;
   }
   m.face.smile=(m.face.smileLeft+m.face.smileRight)/2;
   m.face.brow=(m.face.browLeft+m.face.browRight)/2;this.seen.face=now;
  }
 }
 getRenderMotion(now){
  // No extrapolar: las aceleraciones y los cruces producen sobrepasos con
  // cámaras de 15–30 FPS. El rig interpola las últimas rotaciones aceptadas.
  return this.motion;
 }
 decay(now,dt){
  const m=this.motion,a=this.gain(dt)*.18;
  // seen usa el instante de captura. Para el cuerpo, medir la ausencia desde
  // la llegada evita que una inferencia lenta caduque caderas recién recibidas.
  const bodyClock=this.lastTime===null||this.lastPoseArrival===null?now:this.lastTime+Math.max(0,now-this.lastPoseArrival);
  if(this.lastPoseArrival!==null&&now-this.lastPoseArrival>450){
   m.jump=this.jumpDetector.update([],new Set(),this.lastTime+now-this.lastPoseArrival);
   m.position[1]+=clip((m.jump.height-m.position[1])*(1-Math.exp(-dt*32)),-dt*6,dt*6);
  }
  for(const name of Object.keys(BONES))if(bodyClock-(this.seen[name]??-Infinity)>900){
   const fallback=name.endsWith('_foot')?[0,0,1]:[0,-1,0];
   if(m.directions[name])m.directions[name]=norm(mix(m.directions[name],fallback,a),fallback);
  }
  if(bodyClock-(this.seen.body??-Infinity)>450)m.armContact=null;
  if(bodyClock-(this.seen.body??-Infinity)>1200){m.position=mix(m.position,[0,0,0],a);m.roll*=1-a;m.pitch*=1-a;m.torsoYaw*=1-a;}
  if(bodyClock-(this.seen.hips??-Infinity)>700){m.pelvis.visible=false;m.pelvis.roll*=1-a;m.pelvis.pitch*=1-a;}
  for(const side of ['left','right']){
   const age=now-(this.seen[side+'_hand']??-Infinity);
   const target=age<350?1:0;
   m.handBlend[side]+=(target-m.handBlend[side])*(1-Math.exp(-dt*6));
   m.handVisible[side]=age<650;
   if(age>350)m.hands[side]=fadeHand(side,m.hands[side],dt);
   if(age>650){delete this.handWrists[side];delete this.handStates[side];}
  }
  if(now-(this.seen.face??-Infinity)>700)for(const key of Object.keys(m.face))m.face[key]*=1-a;
 }
}
