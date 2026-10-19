// Rutina original. El mismo reloj gobierna guía, audio y comparación.
export const BPM=112,BEAT=60/BPM,BEATS=64,DURATION=BEATS*BEAT;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const normalize=a=>{const n=Math.hypot(...a);return n>1e-8?a.map(x=>x/n):null;};
const mix=(a,b,t)=>a+(b-a)*t;
export const MOVES=Object.freeze([
 {id:'open',label:'Abre los brazos',tip:'Brazos a los lados',arms:[1.55,1.55],bend:[.15,.15]},
 {id:'up',label:'Brazos arriba',tip:'Alcanza el cielo',arms:[2.75,2.75],bend:[.16,.16]},
 {id:'left',label:'Inclínate a la izquierda',tip:'Sigue el lado iluminado',arms:[1.8,.65],bend:[.28,.5],lean:-.24},
 {id:'right',label:'Inclínate a la derecha',tip:'Cambia de lado',arms:[.65,1.8],bend:[.5,.28],lean:.24},
 {id:'squat',label:'Baja al ritmo',tip:'Flexiona ambas rodillas',arms:[1.0,1.0],bend:[1.2,1.2],hip:.48,knee:.95},
 {id:'elbows',label:'Marca con los codos',tip:'Codos abiertos, manos arriba',arms:[1.55,1.55],bend:[1.5,1.5]},
 {id:'reachLeft',label:'Alcanza a la izquierda',tip:'Un brazo arriba, otro abajo',arms:[2.65,.35],bend:[.15,.25]},
 {id:'reachRight',label:'Alcanza a la derecha',tip:'Ahora al otro lado',arms:[.35,2.65],bend:[.25,.15]}
]);
const ORDER=[0,1,2,3,0,5,4,1,6,7,2,3,5,4,0,1];
export function cueAt(time){
 const index=Math.min(ORDER.length-1,Math.max(0,Math.floor(time/(BEAT*4))));
 return {index,move:MOVES[ORDER[index]],next:ORDER.slice(index+1,index+4).map(i=>MOVES[i])};
}
export function danceMotion(time=0){
 const t=clamp(time,0,DURATION),cue=cueAt(t),move=cue.move;
 const previous=cue.index?MOVES[ORDER[cue.index-1]]:{arms:[.2,.2],bend:[.15,.15]};
 let blend=clamp((t-cue.index*BEAT*4)/.28);blend=blend*blend*(3-2*blend);
 const roll=mix(previous.lean||0,move.lean||0,blend),pulse=Math.sin(t/BEAT*Math.PI*2)*.025;
 const hip=mix(previous.hip||0,move.hip||0,blend),knee=mix(previous.knee||0,move.knee||0,blend);
 const rotateRoll=a=>[a[0]*Math.cos(roll)-a[1]*Math.sin(roll),a[0]*Math.sin(roll)+a[1]*Math.cos(roll),a[2]];
 const directions={};
 for(const [side,sign,i] of [['left',-1,0],['right',1,1]]){
  const lift=mix(previous.arms[i],move.arms[i],blend)+pulse,bend=mix(previous.bend[i],move.bend[i],blend);
  directions[side+'_upper']=rotateRoll([sign*Math.sin(lift),-Math.cos(lift),0]);
  directions[side+'_fore']=rotateRoll([sign*Math.sin(lift+bend),-Math.cos(lift+bend),0]);
  directions[side+'_thigh']=[0,-Math.cos(hip),Math.sin(hip)];
  directions[side+'_shin']=[0,-Math.cos(knee-hip),-Math.sin(knee-hip)];
  directions[side+'_foot']=[0,0,1];
 }
 return {worldSpace:true,filtered:true,directions,position:[0,0,0],yaw:0,pitch:0,roll,torsoYaw:0,
  pelvis:{pitch:0,roll:0},knees:{left:180-knee*180/Math.PI,right:180-knee*180/Math.PI},bodyVisible:true,
  visible:new Set([11,12,13,14,15,16,23,24,25,26,27,28,29,30,31,32])};
}
const PARTS=[['left_upper',[11,13],.20],['right_upper',[12,14],.20],['left_fore',[13,15],.16],['right_fore',[14,16],.16],
 ['left_thigh',[23,25],.05],['right_thigh',[24,26],.05],['left_shin',[25,27],.05],['right_shin',[26,28],.05]];
export function compareDancePose(m,target){
 if(!m?.bodyVisible||![11,12].every(i=>m.visible?.has(i)))return {valid:false,accuracy:0,coverage:0};
 let total=0,score=0;
 const squat=target.knees.left<150,armFactor=squat?.6:1;
 const yaw=Number.isFinite(m.yaw)?m.yaw:0;
 for(const [name,ids,weight] of PARTS){
  if(name.endsWith('thigh')||name.endsWith('shin'))continue;
  const raw=m.directions?.[name];if(!raw?.every(Number.isFinite)||!ids.every(i=>m.visible.has(i)))continue;
  const a=normalize([Math.cos(yaw)*raw[0]-Math.sin(yaw)*raw[2],raw[1]]),b=normalize(target.directions[name].slice(0,2));
  if(!a||!b)continue;
  const angle=Math.acos(clamp(a[0]*b[0]+a[1]*b[1],-1,1));
  score+=weight*armFactor*clamp(1-angle/1.8);total+=weight*armFactor;
 }
 for(const [side,ids] of [['left',[23,25,27]],['right',[24,26,28]]]){
  const knee=m.knees?.[side];if(!Number.isFinite(knee)||!ids.every(i=>m.visible.has(i)))continue;
  const weight=squat?.24:.10;score+=weight*clamp(1-Math.abs(knee-target.knees[side])/70);total+=weight;
 }
 if([23,24].every(i=>m.visible.has(i))){
  const lean=(m.roll||0)+(m.pelvis?.roll||0);score+=.08*clamp(1-Math.abs(lean-target.roll)/.6);total+=.08;
 }
 return {valid:total>=.6,accuracy:total?score/total:0,coverage:total/(.72*armFactor+(squat?.48:.2)+.08)};
}

export class DanceSession{
 constructor(){this.reset();}
 reset(){this.state='ready';this.practice=false;this.elapsed=0;this.anchor=null;this.countdownAt=0;this.resumeTime=0;this.lastCapture=-Infinity;this.lastValid=-Infinity;this.stable=0;this.stableAt=0;this.latency=.18;this.results=[];this.pending=new Map();this.combo=0;this.bestCombo=0;this.points=0;this.feedback='Sigue al guía';this.reason='';}
 start(now,practice=false){this.reset();this.practice=practice;this.state=practice?'preview':'arming';this.anchor=practice?{wall:now,song:0}:null;this.reason=practice?'Ensayo sin cámara · sin puntuación':'Buscando una postura estable';}
 time(now){return this.anchor?Math.max(0,this.anchor.song+(now-this.anchor.wall)/1000):this.elapsed;}
 pause(now,reason='manual'){
  if(!['playing','preview','countdown','arming'].includes(this.state))return;
  this.elapsed=Math.min(DURATION,this.time(now));this.anchor=null;this.state='paused';this.reason=reason;this.stable=0;
 }
 resume(now){if(this.state!=='paused')return;if(this.practice){this.anchor={wall:now,song:this.elapsed};this.state='preview';}else{this.state='arming';this.stable=0;this.reason='Buscando una postura estable';}}
 receive(m,capture,arrival){
  if(this.practice||!['arming','paused','countdown','playing','finishing'].includes(this.state)||capture<=this.lastCapture||arrival-capture>900||capture>arrival)return;
  this.lastCapture=capture;
  const check=compareDancePose(m,danceMotion(0));
  if(!check.valid){this.stable=0;return;}
  this.lastValid=arrival;this.latency=this.latency*.75+(arrival-capture)/1000*.25;
  if(this.state==='arming'||this.state==='paused'&&this.reason==='body'){
   if(!this.stable)this.stableAt=arrival;
   this.stable++;
   if(this.stable>=3&&arrival-this.stableAt>=250){this.state='countdown';this.countdownAt=arrival;this.resumeTime=this.elapsed;this.reason='';}
   return;
  }
  if(!['playing','finishing'].includes(this.state)||!this.anchor||capture<this.anchor.wall)return;
  const time=this.time(capture);if(time>=DURATION)return;
  const beat=Math.floor(time/BEAT);if(this.results[beat]!==undefined)return;
  // Un pequeño margen temporal admite reacción humana e inferencias lentas.
  const match=[0,-.12,-.24].map(offset=>compareDancePose(m,danceMotion(Math.max(0,time+offset)))).filter(x=>x.valid).sort((a,b)=>b.accuracy-a.accuracy)[0];
  if(match&&match.accuracy>(this.pending.get(beat)?.accuracy??-1))this.pending.set(beat,match);
 }
 judge(beat){
  if(this.results[beat]!==undefined)return;
  const result=this.pending.get(beat);this.pending.delete(beat);this.results[beat]=result||null;
  if(!result){this.feedback='Sin muestra · muestra el cuerpo';return;}
  this.points+=result.accuracy*Math.min(1,result.coverage)*10000/BEATS;
  this.combo=result.accuracy>=.63?this.combo+1:0;this.bestCombo=Math.max(this.bestCombo,this.combo);
  this.feedback=result.accuracy>=.86?'¡Perfecto!':result.accuracy>=.63?'¡Bien!':'Sigue intentando';
 }
 tick(now){
  if(['playing','countdown'].includes(this.state)&&now-this.lastValid>1000)this.pause(now,'body');
  if(this.state==='countdown'&&now-this.countdownAt>=BEAT*4*1000){this.anchor={wall:this.countdownAt+BEAT*4*1000,song:this.resumeTime};this.state='playing';}
  const time=this.time(now),grace=clamp(this.latency+.12,.22,.9);
  if(['playing','finishing'].includes(this.state)){
   for(let beat=0;beat<Math.min(BEATS,Math.floor((time-grace)/BEAT));beat++)this.judge(beat);
   if(time>=DURATION){this.state='finishing';this.elapsed=DURATION;}
   if(time>=DURATION+grace){for(let beat=0;beat<BEATS;beat++)this.judge(beat);this.anchor=null;this.state='finished';this.reason='';}
  }else if(this.state==='preview'&&time>=DURATION){this.elapsed=DURATION;this.anchor=null;this.state='finished';}
  return this.snapshot(now);
 }
 snapshot(now){
  const time=Math.min(DURATION,this.time(now)),judged=this.results.filter(Boolean).length;
  return {state:this.state,practice:this.practice,time,progress:time/DURATION,score:Math.round(this.points),combo:this.combo,bestCombo:this.bestCombo,
   countdown:this.state==='countdown'?Math.max(1,Math.ceil(4-(now-this.countdownAt)/(BEAT*1000))):null,
   feedback:this.feedback,judged,total:BEATS,stars:judged>=BEATS*.5?Math.min(5,Math.floor(this.points/2000)+1):0,reason:this.reason,cue:cueAt(time)};
 }
}
