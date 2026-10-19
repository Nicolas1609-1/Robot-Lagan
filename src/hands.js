// Retargeting de manos con proporciones fijas y articulaciones acotadas.
const len=a=>Math.hypot(...a),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const sub=(a,b)=>a.map((x,i)=>x-b[i]),mix=(a,b,t)=>a.map((x,i)=>x+(b[i]-x)*t);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const norm=a=>{const n=len(a);return n>1e-8?a.map(x=>x/n):null;};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const rotate=(a,y)=>[Math.cos(y)*a[0]+Math.sin(y)*a[2],a[1],-Math.sin(y)*a[0]+Math.cos(y)*a[2]];
const IDENTITY=[[1,0,0],[0,1,0],[0,0,1]];
const FINGER_LENGTHS=[.07,.05,.04],THUMB_LENGTHS=[.055,.047,.038];
// Dedos hacia -Y, palma hacia +Z: el pulgar izquierdo nace en -X.
const handSign=side=>side==='left'?1:-1;
export function focusedHand(current='left',visible={}){
 const other=current==='left'?'right':'left';
 return !visible[current]&&visible[other]?other:current;
}
function bend(a,b,c){
 const u=norm(sub(b,a)),v=norm(sub(c,b));
 return u&&v?Math.acos(clamp(dot(u,v),-1,1)):0;
}
export function handFromParameters(side,parameters,basis=IDENTITY,thumbDirections=null){
 const sign=handSign(side),points=Array.from({length:21},()=>[0,0,0]);
 points[1]=[-sign*.085,-.045,.025];
 for(let finger=0;finger<5;finger++){
  const [spread,...flexes]=parameters.slice(finger*4,finger*4+4);
  let p=finger===0?points[1]:[-sign*(.063-(finger-1)*.042),[-.145,-.16,-.151,-.13][finger-1],0];
  const start=finger===0?1:5+(finger-1)*4;
  points[start]=p;let flex=0;
  for(let joint=0;joint<3;joint++){
   flex+=flexes[joint];
   const length=(finger===0?THUMB_LENGTHS:FINGER_LENGTHS)[joint]*(finger===0?1:[1,1.12,1.05,.85][finger-1]);
   const x=(finger===0?-sign:1)*Math.sin(spread)*Math.cos(flex);
   const direction=finger===0&&thumbDirections?thumbDirections[joint]:[x,-Math.cos(spread)*Math.cos(flex),Math.sin(flex)];
   p=p.map((value,i)=>value+direction[i]*length);
   points[start+joint+1]=p;
  }
 }
 const thumb=thumbDirections||[1,2,3].map(i=>norm(sub(points[i+1],points[i])));
 return {basis:basis.map(a=>[...a]),points,parameters:[...parameters],thumbDirections:thumb.map(a=>[...a])};
}
export function relaxedHand(side,curls=Array(5).fill(.12)){
 const parameters=curls.flatMap((curl,i)=>i===0?[.48,.1+curl*.35,curl*.45,curl*.4]:[0,curl*1.35,curl*1.65,curl*.9]);
 const hand=handFromParameters(side,parameters),sign=handSign(side);
 const closed=[[sign*.15,-.8,.58],[sign*.78,-.3,.55],[sign*.9,.12,.42]].map(norm);
 const thumb=hand.thumbDirections.map((direction,i)=>smoothDirection(direction,closed[i],clamp(curls[0],0,1),Math.PI));
 return handFromParameters(side,parameters,IDENTITY,thumb);
}
export function handGeometry(landmarks,world,side,yaw,width=640,height=480,previous=null,gesture=null){
 if(landmarks?.length!==21||!landmarks.every(p=>[p.x,p.y,p.z].every(Number.isFinite)))return null;
 if(landmarks[0].x<-.05||landmarks[0].x>1.05||landmarks[0].y<-.05||landmarks[0].y>1.05)return null;
 const useWorld=world?.length===21;
 const p=(useWorld?world:landmarks).map(q=>{
  const a=useWorld?[q.x,q.y,q.z]:[q.x*width,q.y*height,q.z*width];
  return rotate(a.map(x=>-x),-yaw);
 });
 if(!p.every(a=>a.every(Number.isFinite)))return null;
 const forward=sub(p[9],p[0]),size=len(forward),across=sub(p[5],p[17]);
 if(size<(useWorld?.012:7)||size>(useWorld?.26:Math.max(width,height)*.6))return null;
 const ratio=len(across)/size;
 if(ratio<.28||ratio>1.5)return null;
 const sign=handSign(side),y=norm(forward.map(x=>-x)),lateral=norm(across.map(x=>-sign*x));
 const rawNormal=cross(lateral,y);
 if(len(rawNormal)<.28)return null;
 const z=norm(rawNormal),x=norm(cross(y,z)),basis=[x,y,z];
 const local=p.map(q=>basis.map(axis=>dot(sub(q,p[0]),axis)/size));
 const parameters=[],validFingers=[];
 let thumbDirections=previous?.thumbDirections||relaxedHand(side).thumbDirections;
 for(let finger=0;finger<5;finger++){
  const ids=finger===0?[1,2,3,4]:[5+(finger-1)*4,6+(finger-1)*4,7+(finger-1)*4,8+(finger-1)*4];
  const [a,b,c,d]=ids.map(i=>local[i]),segments=[sub(b,a),sub(c,b),sub(d,c)];
  // Los puntos ocultos de un puño pueden solaparse. Perder una falange no
  // debe congelar los otros cuatro dedos ni invalidar toda la muñeca.
  const valid=segments.every(v=>len(v)>=.015&&len(v)<=1.5);validFingers.push(valid);
  if(!valid){parameters.push(...(previous?.parameters||relaxedHand(side).parameters).slice(finger*4,finger*4+4));continue;}
  const first=norm(segments[0]);
  const spread=finger===0?Math.atan2(-sign*first[0],-first[1]):Math.atan2(first[0],-first[1]);
  const flex=Math.atan2(first[2],Math.hypot(first[0],first[1]));
  const limits=finger===0?[-.9,1.35,1.05,1.3,1.25]:[-.40,.40,1.50,1.85,1.40];
  parameters.push(clamp(spread,limits[0],limits[1]),clamp(flex,-.08,limits[2]),clamp(bend(a,b,c),0,limits[3]),clamp(bend(b,c,d),0,limits[4]));
  if(finger>0){
   const pixel=i=>[landmarks[i].x*width,landmarks[i].y*height];
   const image=ids.map(pixel),chain=image.slice(1).reduce((sum,p,i)=>sum+len(sub(p,image[i])),0);
   const palmPixels=len(sub(pixel(9),pixel(0)));
   // Una cadena visible recta corrige curvaturas espurias de profundidad,
   // sin forzar el ángulo de la articulación que une el dedo a la palma.
   if(chain>palmPixels*.75&&chain>12&&len(sub(image[3],image[0]))/chain>.985&&Math.abs(flex)<.75){
    parameters[finger*4+2]=Math.min(parameters[finger*4+2],.12);
    parameters[finger*4+3]=Math.min(parameters[finger*4+3],.12);
   }
  }
  // El pulgar se opone a la palma en otro plano; sus tres ejes no son los
  // de un dedo largo. Conservar sus direcciones permite cruzarlo sobre el puño.
  if(finger===0)thumbDirections=segments.map(norm);
 }
 const name=gesture?.score>=(gesture?.categoryName==='Open_Palm'?.6:.7)?gesture.categoryName:'';
 const close=finger=>{
  const i=finger*4;parameters[i]=clamp(parameters[i],-.18,.18);
  parameters[i+1]=clamp(parameters[i+1],1.35,1.45);
  parameters[i+2]=clamp(parameters[i+2],1.6,1.7);
  parameters[i+3]=clamp(parameters[i+3],.8,1.0);
 };
 const open=finger=>{
  const i=finger*4;parameters[i+1]=clamp(parameters[i+1],-.08,.12);
  parameters[i+2]=Math.min(parameters[i+2],.16);parameters[i+3]=Math.min(parameters[i+3],.16);
 };
 if(name==='Closed_Fist'){
  for(let i=1;i<5;i++)close(i);
  thumbDirections=[[sign*.15,-.8,.58],[sign*.78,-.3,.55],[sign*.9,.12,.42]].map(norm);
 }else if(name==='Open_Palm')for(let i=1;i<5;i++)open(i);
 else if(name==='Pointing_Up'){open(1);for(let i=2;i<5;i++)close(i);}
 else if(name==='Thumb_Up'||name==='Thumb_Down')for(let i=1;i<5;i++)close(i);
 else if(name==='Victory'){open(1);open(2);close(3);close(4);}
 return {...handFromParameters(side,parameters,basis,thumbDirections),validFingers,gesture:name||'None'};
}
export function basisQuaternion(b){
 const [a,c,d]=b,m00=a[0],m01=c[0],m02=d[0],m10=a[1],m11=c[1],m12=d[1],m20=a[2],m21=c[2],m22=d[2];
 const trace=m00+m11+m22;let q;
 if(trace>0){const s=2*Math.sqrt(trace+1);q=[(m21-m12)/s,(m02-m20)/s,(m10-m01)/s,s/4];}
 else if(m00>m11&&m00>m22){const s=2*Math.sqrt(1+m00-m11-m22);q=[s/4,(m01+m10)/s,(m02+m20)/s,(m21-m12)/s];}
 else if(m11>m22){const s=2*Math.sqrt(1+m11-m00-m22);q=[(m01+m10)/s,s/4,(m12+m21)/s,(m02-m20)/s];}
 else {const s=2*Math.sqrt(1+m22-m00-m11);q=[(m02+m20)/s,(m12+m21)/s,s/4,(m10-m01)/s];}
 return norm(q);
}
function quaternionBasis([x,y,z,w]){
 return [[1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w)],
  [2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w)],
  [2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y)]];
}
function slerp(a,b,t){
 let cos=dot(a,b);if(cos<0){b=b.map(x=>-x);cos=-cos;}
 if(cos>.9995)return norm(mix(a,b,t));
 const theta=Math.acos(clamp(cos,-1,1)),s=Math.sin(theta);
 return a.map((x,i)=>(Math.sin((1-t)*theta)*x+Math.sin(t*theta)*b[i])/s);
}
export function stabilizeHand(side,previous,target,dt,state={}){
 const q=basisQuaternion(previous.basis),next=basisQuaternion(target.basis);
 const difference=2*Math.acos(clamp(Math.abs(dot(q,next)),0,1));
 let holdOrientation=false;
 if(difference>2.1&&state.hasSample){
  const pending=state.pending;
  state.pending=next;
  if(!pending||Math.abs(dot(pending,next))<Math.cos(.30/2))holdOrientation=true;
 }else state.pending=null;
 const amount=difference<1e-7?1:Math.min(1-Math.exp(-dt*32),dt*10/difference);
 const basis=quaternionBasis(slerp(q,next,holdOrientation?0:amount));
 const a=1-Math.exp(-dt*32),step=dt*14;
 const parameters=previous.parameters.map((x,i)=>x+clamp((target.parameters[i]-x)*a,-step,step));
 const thumb=target.thumbDirections.map((direction,i)=>smoothDirection(previous.thumbDirections[i],direction,a,step));
 state.hasSample=true;return {...handFromParameters(side,parameters,basis,thumb),gesture:target.gesture,validFingers:target.validFingers};
}
function smoothDirection(previous,target,amount,maxAngle){
 const distance=Math.acos(clamp(dot(previous,target),-1,1));
 if(distance<1e-7)return [...target];
 let tangent=norm(sub(target,previous.map(x=>x*Math.cos(distance))));
 if(!tangent)tangent=norm(cross(previous,Math.abs(previous[0])<.8?[1,0,0]:[0,1,0]));
 const step=Math.min(distance*amount,maxAngle);
 return norm(previous.map((x,i)=>x*Math.cos(step)+tangent[i]*Math.sin(step)));
}
export function fadeHand(side,shape,dt){
 const neutral=relaxedHand(side),a=1-Math.exp(-dt*5);
 const thumb=shape.thumbDirections.map((direction,i)=>smoothDirection(direction,neutral.thumbDirections[i],a,dt*6));
 return handFromParameters(side,mix(shape.parameters,neutral.parameters,a),shape.basis,thumb);
}
export function handAssignments(entries,hands,posePoints,visible,history,now,poseTime=now){
 // Al tocarse las palmas, dos detecciones pueden ser la MISMA mano. No
 // enviar esa orientación a ambos lados ni decidir identidad por ruido.
 if(entries.length>=2&&Math.hypot(entries[0].p[0].x-entries[1].p[0].x,entries[0].p[0].y-entries[1].p[0].y)<.018
  &&Math.hypot(entries[0].p[9].x-entries[1].p[9].x,entries[0].p[9].y-entries[1].p[9].y)<.025){
  entries=[...entries].sort((a,b)=>(hands.handedness?.[b.index]?.[0]?.score||0)-(hands.handedness?.[a.index]?.[0]?.score||0)).slice(0,1);
 }
 const cost=(entry,side)=>{
  let score=0,evidence=false;
  const wrist=posePoints?.[side==='left'?15:16],old=history[side];
  if(wrist&&visible.has(side==='left'?15:16)&&Math.abs(now-poseTime)<220){
   score+=(old&&now-old.time<500?.25:1)*Math.hypot(wrist.x-entry.p[0].x,wrist.y-entry.p[0].y);evidence=true;
  }
  if(old&&now-old.time<500){
   const dt=clamp((now-old.time)/1000,0,.12);
   const x=old.x+(old.vx||0)*dt,y=old.y+(old.vy||0)*dt;
   score+=3*Math.hypot(x-entry.p[0].x,y-entry.p[0].y);evidence=true;
  }
  const category=hands.handedness?.[entry.index]?.[0],label=category?.categoryName?.toLowerCase();
  score+=label&&label!==side?(evidence?.1:.5)*(category.score??.8):0;
  return score+(evidence?0:.1);
 };
 if(entries.length>=2){
  return cost(entries[0],'left')+cost(entries[1],'right')<=cost(entries[0],'right')+cost(entries[1],'left')
   ?[[entries[0],'left'],[entries[1],'right']]:[[entries[0],'right'],[entries[1],'left']];
 }
 if(!entries.length)return [];
 const left=cost(entries[0],'left'),right=cost(entries[0],'right');
 const a=posePoints?.[15],b=posePoints?.[16],category=hands.handedness?.[entries[0].index]?.[0];
 if(a&&b&&visible.has(15)&&visible.has(16)&&Math.abs(now-poseTime)<220&&Math.hypot(a.x-b.x,a.y-b.y)<.06
  &&Math.abs(left-right)<.08&&(category?.score||0)<.8)return [];
 return [[entries[0],left<=right?'left':'right']];
}
