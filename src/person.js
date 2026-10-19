// Una identidad temporal por sesión; no guarda imágenes ni identifica rostros.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const usable=p=>p&&[p.x,p.y,p.z].every(Number.isFinite)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1&&(p.visibility??1)>=.3&&(p.presence??1)>=.35;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const center=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
function describe(points,appearance){
 if(!points||points.length!==33)return null;
 const shoulders=[11,12].every(i=>usable(points[i]))?center(points[11],points[12]):null;
 const hips=[23,24].every(i=>usable(points[i]))?center(points[23],points[24]):null;
 if(!shoulders&&!hips)return null;
 const span=shoulders&&hips?distance(shoulders,hips):shoulders?distance(points[11],points[12])*.85:distance(points[23],points[24])*1.4;
 if(span<.025)return null;
 const anchors=[...(shoulders?[11,12]:[]),...(hips?[23,24]:[])];
 const confidence=Math.min(...anchors.map(i=>Math.min(points[i].visibility??1,points[i].presence??1)));
 return {points,shoulders,hips,span,appearance,confidence,
  sizes:{...(shoulders?{shoulders:distance(points[11],points[12])}:{}),...(hips?{hips:distance(points[23],points[24])}:{}),...(shoulders&&hips?{torso:span}:{})}};
}
function colorMatches(a,b){
 if(!a||!b)return true;
 const chroma=Math.hypot(...a.rgb.map((x,i)=>x-b.rgb[i]));
 const ratio=b.brightness/Math.max(.02,a.brightness);
 // La exposición automática cambia el brillo aunque la ropa sea la misma.
 // Conservar la cromaticidad inicial y límites de geometría y desplazamiento.
 return chroma<.20&&ratio>.10&&ratio<8;
}
export class PersonLock{
 constructor(){this.reset();}
 reset(){this.lock=null;this.pending=null;this.returnPending=null;this.missingSince=null;this.state='searching';this.reason='no_body';this.lastTime=-Infinity;this.lastObservation=-Infinity;this.velocity={x:0,y:0};this.scaleVelocity={};}
 select(result,now){
  if(!Number.isFinite(now)||now<=this.lastObservation)return {landmarks:[],worldLandmarks:[]};
  this.lastObservation=now;
  const candidates=(result.landmarks||[]).map((p,index)=>({index,pose:describe(p,result.appearances?.[index])})).filter(c=>c.pose);
  if(!this.lock){
   const candidate=candidates.filter(c=>Math.abs((c.pose.shoulders||c.pose.hips).x-.5)<=.25).sort((a,b)=>{
    const score=p=>Math.abs((p.shoulders||p.hips).x-.5)-p.span*.4;
    return score(a.pose)-score(b.pose);
   })[0];
   if(!candidate){this.pending=null;this.reason='no_body';return {landmarks:[],worldLandmarks:[]};}
   const pending=this.pending,p=candidate.pose,key=pending?.pose.shoulders&&p.shoulders?'shoulders':pending?.pose.hips&&p.hips?'hips':null;
   const ratios=key?Object.keys(p.sizes).filter(k=>pending.pose.sizes[k]>.025&&p.sizes[k]>.025).map(k=>p.sizes[k]/pending.pose.sizes[k]):[];
   const consistent=pending&&now-pending.time<=1500&&key&&distance(p[key],pending.pose[key])<=.12&&
    ratios.some(r=>r>=.65&&r<=1.6)&&colorMatches(pending.appearance,p.appearance);
   const weak=p.confidence<.45||!!pending?.weak,count=consistent?pending.count+1:1;
   this.reason='confirming';
   if(!consistent||count<(weak?3:2)){
    this.pending={pose:p,appearance:consistent?pending.appearance:p.appearance,time:now,count,weak:p.confidence<.45||(consistent&&pending.weak)};return {landmarks:[],worldLandmarks:[]};
   }
   p.appearance=pending.appearance||p.appearance;
   this.lock=candidate.pose;this.pending=null;return this.accept(result,candidate,now);
  }
  if(!candidates.length){
   this.missingSince??=now;this.returnPending=null;this.state='holding';this.reason='no_body';
   return {landmarks:[],worldLandmarks:[]};
  }
  if(this.missingSince!==null&&now-this.lastTime>=1000&&now-this.missingSince>=350)return this.reacquire(result,candidates,now);
  const elapsed=now-this.lastTime;
  // Una cadencia baja necesita margen entre muestras. Una ausencia larga
  // mantiene el límite anterior para no ampliar la búsqueda indefinidamente.
  const dt=clamp(elapsed/1000,0,elapsed<=1000?.45:.2),old=this.lock;
  this.reason=candidates.length?'identity':'no_body';
  const scored=candidates.map(candidate=>{
   const p=candidate.pose,key=old.shoulders&&p.shoulders?'shoulders':old.hips&&p.hips?'hips':null;
   if(!key)return null;
   if(!colorMatches(old.appearance,p.appearance)){this.reason='appearance';return null;}
   const predicted={x:old[key].x+this.velocity.x*dt,y:old[key].y+this.velocity.y*dt};
   // Comparar medidas compartidas: ancho de hombros no es alto de torso.
   // Una flexión o un giro pueden acortar una medida sin cambiar de persona.
   const ratios=Object.keys(p.sizes).filter(k=>old.sizes[k]>.025&&p.sizes[k]>.025).map(k=>{
    const prediction=now-this.lastTime<450?Math.exp((this.scaleVelocity[k]||0)*dt):1;
    return {key:k,value:p.sizes[k]/old.sizes[k]/prediction};
   }).sort((a,b)=>Math.abs(Math.log(a.value))-Math.abs(Math.log(b.value)));
   if(!ratios.length)return null;
   const dx=Math.abs(p[key].x-predicted.x),dy=Math.abs(p[key].y-predicted.y),ratio=ratios[0].value;
   if(old.shoulders&&old.hips&&p.shoulders&&p.hips){
    const scale=p.span/old.span;
    const skew=Math.hypot(p.hips.x-p.shoulders.x-(old.hips.x-old.shoulders.x)*scale,p.hips.y-p.shoulders.y-(old.hips.y-old.shoulders.y)*scale);
    if(skew>Math.min(old.span,p.span)*.55+dt*.7){this.reason='mixed_torso';return null;}
   }
   // El salto permite más desplazamiento vertical. Una pérdida larga no
   // amplía indefinidamente la búsqueda ni entrega el robot a otra persona.
   if(ratio<.55||ratio>1.8){this.reason='scale';return null;}
   if(dx>Math.max(.07,old.span*.45)+dt*.8||dy>Math.max(.10,old.span*.7)+dt*1.1){this.reason='position';return null;}
   return {...candidate,score:dx+dy*.65+Math.abs(Math.log(ratio))*.1};
  }).filter(Boolean).sort((a,b)=>a.score-b.score);
  if(!scored.length){this.state='holding';return {landmarks:[],worldLandmarks:[]};}
  return this.accept(result,scored[0],now);
 }
 reacquire(result,candidates,now){
  // Sólo tras ausencia real, nunca por el mero cruce de otra persona. La ropa
  // inicial permanece fija; la nueva posición necesita varias observaciones.
  const old=this.lock,pending=this.returnPending;
  const candidatesMatching=candidates.filter(({pose:p})=>{
   if(old.appearance&&(!p.appearance||!colorMatches(old.appearance,p.appearance)))return false;
   const key=old.shoulders&&p.shoulders?'shoulders':old.hips&&p.hips?'hips':null;
   if(!key)return false;
   const ratios=Object.keys(p.sizes).filter(k=>old.sizes[k]>.025&&p.sizes[k]>.025).map(k=>p.sizes[k]/old.sizes[k]);
   if(!ratios.some(r=>r>=.3&&r<=3.5))return false;
   if(!old.appearance&&(distance(old[key],p[key])>.18||!ratios.some(r=>r>=.65&&r<=1.5)))return false;
   return true;
  });
  const candidate=candidatesMatching.sort((a,b)=>Math.abs((a.pose.shoulders||a.pose.hips).x-.5)-Math.abs((b.pose.shoulders||b.pose.hips).x-.5))[0];
  this.state='holding';this.reason=candidate?'reacquiring':'appearance';
  if(!candidate){this.returnPending=null;return {landmarks:[],worldLandmarks:[]};}
  const p=candidate.pose,key=pending?.pose.shoulders&&p.shoulders?'shoulders':pending?.pose.hips&&p.hips?'hips':null;
  const stable=key&&now-pending.time<=1500&&distance(pending.pose[key],p[key])<.10&&
   Object.keys(p.sizes).some(k=>pending.pose.sizes[k]>.025&&p.sizes[k]/pending.pose.sizes[k]>.7&&p.sizes[k]/pending.pose.sizes[k]<1.4);
  const count=stable?pending.count+1:1;
  this.returnPending={pose:p,time:now,count};
  if(count<(p.confidence<.45?5:3))return {landmarks:[],worldLandmarks:[]};
  this.velocity={x:0,y:0};this.scaleVelocity={};
  return {...this.accept(result,candidate,now),reacquired:true};
 }
 accept(result,candidate,now){
  const old=this.lock,p=candidate.pose,key=old?.shoulders&&p.shoulders?'shoulders':old?.hips&&p.hips?'hips':null;
  if(key&&Number.isFinite(this.lastTime)){
   const dt=Math.max(.03,(now-this.lastTime)/1000);
   for(const axis of ['x','y'])this.velocity[axis]=this.velocity[axis]*.5+clamp((p[key][axis]-old[key][axis])/dt,-1.5,1.5)*.5;
  }
  // Mantener la apariencia inicial impide aprender progresivamente la ropa
  // de alguien que se cruza por delante.
  p.appearance=old?.appearance||p.appearance;
  if(old&&Number.isFinite(this.lastTime))for(const k of Object.keys(p.sizes)){
   if(old.sizes[k]>.025&&p.sizes[k]>.025){
    const speed=clamp(Math.log(p.sizes[k]/old.sizes[k])/Math.max(.03,(now-this.lastTime)/1000),-2.5,2.5);
    this.scaleVelocity[k]=(this.scaleVelocity[k]||0)*.6+speed*.4;
   }
  }
  this.lock=p;this.lastTime=now;this.missingSince=null;this.returnPending=null;this.state='tracking';this.reason='ready';
  return {...result,landmarks:[result.landmarks[candidate.index]],worldLandmarks:result.worldLandmarks?.[candidate.index]?[result.worldLandmarks[candidate.index]]:[]};
 }
 poseCrop(){
  if(!this.lock)return null;
  const points=this.lock.points.filter(usable),xs=points.map(p=>p.x),anchor=this.lock.shoulders||this.lock.hips;
  const left=Math.min(anchor.x-.30,...xs)-.06,right=Math.max(anchor.x+.30,...xs)+.06;
  const x=clamp(left,0,1),width=clamp(right,0,1)-x;
  // Conservar todo el alto para no recortar pies o cabeza al saltar.
  return {x,y:0,width:Math.max(.1,width),height:1};
 }
 filterDetails(kind,result,pose,now){
  if(this.state!=='tracking'||!pose?.points||Math.abs(now-pose.time)>350||now-this.lastTime>500)return {};
  const p=pose.points,visible=pose.visible,span=this.lock.span;
  if(kind==='hands'){
   const entries=(result.landmarks||[]).map((hand,index)=>({hand,index})).filter(({hand})=>{
    const wrist=hand?.[0];if(!wrist)return false;
    return [15,16].some(i=>visible.has(i)&&distance(wrist,p[i])<clamp(span*.5,.045,.14));
   });
   const filtered={...result};
   for(const key of ['landmarks','worldLandmarks','handedness','gestures'])filtered[key]=entries.map(e=>result[key]?.[e.index]).filter(Boolean);
   return filtered;
  }
  const face=result.faceLandmarks?.[0];
  if(!face||!visible.has(0)||!usable(p[0]))return {};
  const nose=face[1];
  if(!nose||distance(nose,p[0])>clamp(span*.45,.035,.11))return {};
  return result;
 }
}
