import {createAvatar,demoMotion} from './avatar.js';
import {Retargeter,POSE_LINKS,HAND_LINKS} from './tracking.js';
import {PersonLock} from './person.js';
import {cameraConstraints,cameraInfo,minimizeCameraZoom,videoFrameRect} from './camera.js';
import {InferenceScheduler,inferenceInterval,needsCpuRecovery,RenderBudget,AutoBudget,trackingProfile,performanceReport} from './performance.js';
import {createDanceUI} from './dance-ui.js';

const $=id=>document.getElementById(id);
const tracker=new Retargeter();
const person=new PersonLock();
let avatar,dance=null,mode='idle',stream=null,epoch=0,workers={},lastPose={},lastDetails={},poseAt=0,detailsAt=0;
let poseFps=0,lastPoseTime=0,demoTime=0,lastUi=0,faceConnections=[];
let videoFps=null,lastVideoFrames=0,lastVideoMeasured=0;
const detailTimes={hands:0,face:0};
const poseHistory=[];
let handCropCursor=0;
let renderFps=0,lastDraw='';
const scheduler=new InferenceScheduler((navigator.hardwareConcurrency||2)<=2?1:2),renderBudget=new RenderBudget();
const autoBudget=new AutoBudget({limitedMemory:(navigator.deviceMemory||8)<=2});
let selectedProfile='dance',detailsLoading=false,detailGeneration=0;
function currentProfile(){
 const profile=trackingProfile($('quality-select').value);
 if(dance?.active)return {...profile,economy:true,details:false,poseQuality:'lite',detailFactor:1};
 return $('quality-select').value==='dance'&&mode==='camera'?{...profile,...autoBudget.profile()}: {...profile,detailFactor:1};
}
let detectedBody=0,detectedLegs=[0,0];
const video=$('video'),canvas=$('landmarks'),ctx=canvas.getContext('2d');
let cameraState=null;
function updateFraming(){
 const stage=$('camera-stage'),frame=videoFrameRect(stage.clientWidth,stage.clientHeight,video.videoWidth,video.videoHeight);
 if(!frame)return;
 const width=Math.min(frame.width*.65,frame.height*.5),guide=$('framing-guide');
 Object.assign(guide.style,{width:width+'px',height:frame.height*.86+'px',left:(frame.x+(frame.width-width)/2)+'px',top:(frame.y+frame.height*.07)+'px'});
}
new ResizeObserver(updateFraming).observe($('camera-stage'));
video.addEventListener('resize',updateFraming);
async function refreshCameras(){
 if(!navigator.mediaDevices?.enumerateDevices)return;
 const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
 const selected=stream?.getVideoTracks()[0]?.getSettings().deviceId||$('camera-select').value;
 $('camera-select').replaceChildren(new Option('Predeterminada','',false,!selected),...devices.map((d,index)=>new Option(d.label||'Cámara '+(index+1),d.deviceId,false,d.deviceId===selected)));
}
let noticeTimer;
const forceCpu={},recoveryJobs={};
function notice(message,error=false){
 clearTimeout(noticeTimer);$('notice').textContent=message;$('notice').hidden=false;
 if(!error)noticeTimer=setTimeout(()=>$('notice').hidden=true,5500);
}
function state(text,live=false){$('state-pill').textContent=text;$('state-pill').classList.toggle('live',live);}
function worker(kind,quality,cpu=forceCpu[kind]||false){
 if(kind==='pose')quality=dance?.active?'lite':trackingProfile(quality).poseQuality;
 return new Promise((resolve,reject)=>{
  const instance=new Worker('/vision.worker.js');
  const record={instance,busy:false,ready:false,delegate:'',acceleration:'',benchmarking:false,compute:null,quality,cancel:null,sentAt:0,videoTime:-1,interval:inferenceInterval(kind),duration:0,latency:0,frames:0,samples:[],fps:0,emptyFrames:0};
  workers[kind]=record;
  record.selectedPromise=new Promise(resolve=>record.selected=resolve);
  const failInit=message=>{clearTimeout(timeout);instance.terminate();record.selected();if(workers[kind]===record)delete workers[kind];reject(Error(message));};
  const timeout=setTimeout(()=>failInit('La descarga del seguimiento tardó demasiado. Comprueba la conexión y vuelve a intentarlo.'),90000);
  record.cancel=()=>{clearTimeout(timeout);instance.terminate();record.selected();if(!record.ready)reject(Error('Carga cancelada'));};
  instance.onerror=error=>{
   clearTimeout(timeout);record.busy=false;
   if(!record.ready)failInit('No se pudo iniciar el seguimiento.');
   else notice('Se interrumpió el seguimiento. Pulsa Recuperar seguimiento.',true);
   console.error(error);
  };
  instance.onmessage=({data:message})=>{
   if(message.type==='ready'){clearTimeout(timeout);record.ready=true;record.delegate=message.delegate;record.acceleration=message.acceleration||'';record.benchmarking=!!message.benchmarking;if(!record.benchmarking)record.selected();if(message.connections)faceConnections=message.connections;resolve(record);}
   else if(message.type==='delegate-selected'){
    if(record!==workers[kind])return;
    record.delegate=message.delegate;record.acceleration=message.acceleration;record.compute=message.compute;record.benchmarking=false;
    record.frames=0;record.samples=[];record.fps=0;record.duration=record.latency=message.compute?.[message.delegate]||0;
    record.selected();if(kind==='pose'&&mode==='camera'&&currentProfile().details)prepareWorkers();
   }
   else if(message.type==='benchmark-needed'){if(record===workers[kind])record.pendingComparison=true;}
   else if(message.type==='error'){
    clearTimeout(timeout);record.busy=false;
    if(!record.ready)failInit('No se pudo cargar el modelo de '+(kind==='pose'?'cuerpo':'manos y rostro')+'.');
    else notice('El seguimiento encontró un problema. Pulsa Recuperar seguimiento.',true);
    console.error(message.message);
   }else if(message.type==='result'){
    record.busy=false;
    if(message.epoch!==epoch||mode!=='camera'||record!==workers[kind])return;
    record.frames++;
    record.samples.push(message.time);
    while(record.samples.length>2&&message.time-record.samples[0]>1500)record.samples.shift();
    if(record.samples.length>1)record.fps=(record.samples.length-1)*1000/(message.time-record.samples[0]);
    record.latency=record.latency*.6+(performance.now()-message.time)*.4;
    record.duration=record.duration*.6+message.duration*.4;
    const found=kind==='face'?message.data.faceLandmarks?.[0]?.length:message.data.landmarks?.[0]?.length;
    record.emptyFrames=found?0:record.emptyFrames+1;
    scheduler.completed(kind);
    for(const [type,r] of Object.entries(workers))r.interval=inferenceInterval(type,workers.pose?.latency||0,r.duration,r.emptyFrames)*(type==='pose'?1:currentProfile().detailFactor);
    if(kind==='pose'){
     const raw=message.data.landmarks?.[0]||[],valid=i=>raw[i]&&raw[i].x>=0&&raw[i].x<=1&&raw[i].y>=0&&raw[i].y<=1&&(raw[i].visibility??1)>=.3;
     detectedBody=raw.filter((p,i)=>valid(i)).length;
     detectedLegs=[[23,25,27,29,31],[24,26,28,30,32]].map(ids=>ids.filter(valid).length);
     lastPose=person.select(message.data,message.time);poseAt=performance.now();
     if(lastPose.reacquired){
      tracker.reacquireBody();poseHistory.length=0;lastDetails={};detailsAt=detailTimes.hands=detailTimes.face=0;
     }
     poseFps=record.fps;
     lastPoseTime=message.time;
     tracker.updatePose(lastPose,message.time,video.videoWidth,video.videoHeight,poseAt);
     dance?.onPose(tracker.motion,message.time,poseAt);
     poseHistory.push({time:message.time,points:lastPose.landmarks?.[0],visible:new Set(tracker.motion.visible)});
     while(poseHistory.length>24||poseHistory.length&&message.time-poseHistory[0].time>1800)poseHistory.shift();
    }else{
     const pose=poseHistory.reduce((best,p)=>!best||Math.abs(p.time-message.time)<Math.abs(best.time-message.time)?p:best,null);
     const details=person.filterDetails(kind,message.data,pose,message.time);
     lastDetails[kind]=details;detailsAt=detailTimes[kind]=performance.now();
     tracker.updateDetails({[kind]:details,posePoints:pose?.points,poseVisible:pose?.visible,poseTime:pose?.time??-Infinity},message.time,video.videoWidth,video.videoHeight);
    }
    scheduleInference(performance.now());
   }else if(message.type==='frame-error'||message.type==='skipped'){
    record.busy=false;if(message.type==='frame-error')console.warn(message.message);
    if(message.type==='frame-error'&&record===workers[kind]&&(record.delegate.includes('GPU')||record.benchmarking)&&!recoveryJobs[kind])restartWorker(kind,true);
   }
  };
  instance.postMessage({type:'init',kind,quality,cpu,sensitivity:$('sensitivity').value});
 });
}
async function prepareWorkers(){
 const current=epoch;
 if(!workers.pose)await worker('pose',$('quality-select').value);
 if(current!==epoch||mode!=='camera'||!currentProfile().details||workers.pose?.benchmarking||detailsLoading)return;
 // El cuerpo empieza a trabajar antes de descargar los detalles. El WASM
 // común ya está en caché cuando los otros workers lo solicitan.
 const generation=detailGeneration;
 (async()=>{
  detailsLoading=true;
  try{
  for(const kind of ['hands','face']){
   if(current!==epoch||mode!=='camera'||!currentProfile().details)return;
   try{if(!workers[kind])await worker(kind);await workers[kind]?.selectedPromise;}catch{if(current===epoch&&mode==='camera'&&currentProfile().details)notice('El cuerpo está listo. El detector de '+(kind==='hands'?'manos':'rostro')+' no pudo iniciar.',true);}
  }
  }finally{detailsLoading=false;if(generation!==detailGeneration&&mode==='camera'&&currentProfile().details)prepareWorkers();}
 })();
}
function applyProfile(){
 detailGeneration++;
 if(selectedProfile!==$('quality-select').value){selectedProfile=$('quality-select').value;autoBudget.reset();}
 const profile=currentProfile();
 renderBudget.setEconomy(profile.economy);avatar?.setRenderScale(renderBudget.scale);
 avatar?.setLightweight(profile.economy);
 $('face-calibrate').disabled=!profile.details||mode!=='camera';
 if(!profile.details){
  for(const kind of ['hands','face']){
   const record=workers[kind];delete workers[kind];record?.cancel?.();
   lastDetails[kind]={};detailTimes[kind]=0;
  }
  detailsAt=0;tracker.clearDetails();lastDraw='';
 }
}
function stop({keepDance=false}={}){
 if(!keepDance)dance?.cameraStopped();
 detailGeneration++;
 epoch++;clearTimeout(noticeTimer);$('notice').hidden=true;detailTimes.hands=detailTimes.face=0;if(stream)stream.getTracks().forEach(track=>track.stop());
 stream=null;cameraState=null;video.pause();video.srcObject=null;lastDraw='';
 videoFps=null;lastVideoFrames=0;lastVideoMeasured=0;
 for(const record of Object.values(workers))record.cancel?.();
 workers={};scheduler.reset();autoBudget.reset();mode='idle';tracker.reset();person.reset();poseHistory.length=0;lastPose={};lastDetails={};poseAt=detailsAt=lastPoseTime=0;poseFps=0;detectedBody=0;detectedLegs=[0,0];
 ctx.clearRect(0,0,canvas.width,canvas.height);
 $('camera-empty').hidden=false;$('framing-guide').hidden=true;$('camera-caption').hidden=true;
 $('quality-select').disabled=false;
 $('camera-button').textContent='Encender cámara';$('camera-button').disabled=!avatar;$('demo-button').textContent='Probar demo 3D';
 $('camera-empty').querySelector('h3').textContent='Todo empieza con tu movimiento';
 $('camera-empty').querySelector('p').textContent='Coloca la cámara donde se vean tu cabeza y ambos pies.';
 for(const id of ['center-button','reset-button','face-calibrate'])$(id).disabled=true;
 if($('floor-calibrate'))$('floor-calibrate').disabled=true;
 state('Cámara apagada');updateUi(performance.now());
}
async function startCamera(){
 const device=$('camera-select').value;
 stop({keepDance:true});const current=epoch;
 $('camera-button').disabled=true;$('quality-select').disabled=true;$('camera-button').textContent='Preparando cámara…';state('Conectando…');
 $('notice').hidden=true;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Abre la página en localhost o HTTPS para usar la cámara.');
  const constraints=cameraConstraints(device,navigator.mediaDevices.getSupportedConstraints?.());
  const request=navigator.mediaDevices.getUserMedia({audio:false,video:constraints});
  request.then(s=>{if(current!==epoch)s.getTracks().forEach(t=>t.stop());},()=>{});
  let cameraTimer;
  const captured=await Promise.race([request,new Promise((_,reject)=>{cameraTimer=setTimeout(()=>reject(Error('La cámara sigue esperando permiso. Autorízala en esta pestaña y vuelve a intentarlo.')),30000);})]).finally(()=>clearTimeout(cameraTimer));
  if(current!==epoch){captured.getTracks().forEach(track=>track.stop());return;}
  stream=captured;
  const track=stream.getVideoTracks()[0];
  let info;
  try{info=await minimizeCameraZoom(track);}catch{info=cameraInfo(track);}
  if(current!==epoch)return;
  cameraState=info;
  video.srcObject=stream;await video.play();updateFraming();
  lastVideoMeasured=performance.now();lastVideoFrames=video.getVideoPlaybackQuality?.().totalVideoFrames||0;
  mode='camera';$('camera-empty').hidden=true;$('framing-guide').hidden=false;$('camera-caption').hidden=false;
  applyProfile();
  $('camera-button').textContent='Apagar cámara';$('camera-button').disabled=false;
  state('Cargando cuerpo…');await prepareWorkers();
  if(current!==epoch)return;
  state('Cámara encendida',true);$('camera-button').textContent='Apagar cámara';
  for(const id of ['center-button','reset-button'])$(id).disabled=false;
  $('face-calibrate').disabled=!currentProfile().details;
  if($('floor-calibrate'))$('floor-calibrate').disabled=false;
  await refreshCameras();
 }catch(error){
  if(current!==epoch)return;
  stop();
  const messages={NotAllowedError:'Autoriza la cámara en el navegador y vuelve a pulsar Encender cámara.',
   NotFoundError:'No se encontró una cámara. Comprueba que esté conectada.',
   NotReadableError:'La cámara está ocupada. Cierra la aplicación de escritorio u otra videollamada e inténtalo de nuevo.'};
  notice(messages[error.name]||error.message,true);
 }finally{if(current===epoch||mode==='idle'){$('camera-button').disabled=false;$('quality-select').disabled=false;}}
}
function toggleDemo(){
 if(mode==='demo'){stop();return;}
 stop();mode='demo';demoTime=0;
 $('demo-button').textContent='Detener demo';
 $('camera-empty').querySelector('h3').textContent='Demo de movimiento';
 $('camera-empty').querySelector('p').textContent='Baile, saltos, rodillas, dedos y gestos. Esta animación no usa la cámara.';
 state('Demo · sin cámara');
}
async function restartWorker(kind,cpu=forceCpu[kind]||false){
 if(mode!=='camera')return;
 const current=epoch;
 recoveryJobs[kind]=true;
 const old=workers[kind];delete workers[kind];old?.cancel?.();
 forceCpu[kind]=cpu;
 try{
  const record=await worker(kind,$('quality-select').value,cpu);
  if(current!==epoch||mode!=='camera'){record.cancel?.();return;}
  state('Cámara encendida',true);
 }catch(error){if(current===epoch&&mode==='camera')notice(error.message,true);}
 finally{recoveryJobs[kind]=false;}
}
function recover(){
 if(mode!=='camera')return;
 epoch++;scheduler.reset();tracker.reset();person.reset();poseHistory.length=0;lastPose={};lastDetails={};poseAt=detailsAt=lastPoseTime=0;poseFps=0;
 restartWorker('pose');
 notice('Seguimiento reiniciado. Colócate en el centro para fijar la persona, con cabeza y pies visibles.');
}
function faceCrop(now){
 const w=video.videoWidth,h=video.videoHeight,p=lastPose.landmarks?.[0],visible=tracker.motion.visible;
 if(now-poseAt<450&&p&&[0,7,8].every(i=>visible.has(i))){
  const span=Math.max(Math.abs(p[7].x-p[8].x)*2.8,.14);
  const height=Math.min(1,span*w/h*1.18),width=Math.min(1,span);
  return {x:Math.max(0,Math.min(1-width,p[0].x-width/2)),y:Math.max(0,Math.min(1-height,p[0].y-height*.48)),width,height};
 }
 return null;
}
function handCrop(now){
 // Buscar de nuevo cerca de una muñeca corporal cuando el detector pierde
 // el puño. Alternar con la imagen completa conserva el seguimiento de ambas.
 if(++handCropCursor%2===0||now-poseAt>450)return null;
 const p=lastPose.landmarks?.[0],visible=tracker.motion.visible;
 if(!p)return null;
 const missing=[['left',15,17,19],['right',16,18,20]].filter(([side,wrist])=>visible.has(wrist)&&now-(tracker.seen[side+'_hand']??-Infinity)>250);
 if(!missing.length)return null;
 const [side,wrist,a,b]=missing[Math.floor(handCropCursor/2)%missing.length];
 const finger=[a,b].filter(i=>visible.has(i)),center={x:p[wrist].x,y:p[wrist].y};
 if(finger.length){center.x+=(finger.reduce((sum,i)=>sum+p[i].x,0)/finger.length-center.x)*.8;center.y+=(finger.reduce((sum,i)=>sum+p[i].y,0)/finger.length-center.y)*.8;}
 const shoulder=p[11]&&p[12]?Math.abs(p[11].x-p[12].x):.2;
 const extent=Math.max(0,...finger.map(i=>Math.hypot(p[i].x-p[wrist].x,(p[i].y-p[wrist].y)*video.videoHeight/video.videoWidth)));
 const width=Math.min(.65,Math.max(.3,shoulder*1.1,extent*5)),height=Math.min(1,width*video.videoWidth/video.videoHeight);
 return {x:Math.max(0,Math.min(1-width,center.x-width/2)),y:Math.max(0,Math.min(1-height,center.y-height/2)),width,height};
}
async function submit(kind,now){
 const record=workers[kind];
 if(!record?.ready||record.busy||mode!=='camera'||video.readyState<2||record.videoTime===video.currentTime||now-record.sentAt<record.interval)return;
 record.busy=true;record.sentAt=now;record.videoTime=video.currentTime;const current=epoch;
 try{
  // El cuerpo recibe siempre el mismo encuadre. Cambiar su recorte en cada
  // muestra altera la geometría del seguimiento VIDEO de MediaPipe.
  const crop=kind==='pose'?null:(kind==='face'?faceCrop(now):handCrop(now))||person.poseCrop(),w=video.videoWidth,h=video.videoHeight;
  const sx=Math.floor((crop?.x||0)*w),sy=Math.floor((crop?.y||0)*h);
  const sw=Math.min(w-sx,Math.max(1,Math.round((crop?.width||1)*w)));
  const sh=Math.min(h-sy,Math.max(1,Math.round((crop?.height||1)*h)));
  const maxSize=kind==='hands'?960:kind==='face'?512:640,scale=Math.min(1,maxSize/Math.max(sw,sh));
  const bitmap=await createImageBitmap(video,sx,sy,sw,sh,{resizeWidth:Math.max(1,Math.round(sw*scale)),resizeHeight:Math.max(1,Math.round(sh*scale)),resizeQuality:'low'});
  if(current!==epoch||mode!=='camera'||record!==workers[kind]){bitmap.close();record.busy=false;return;}
  const normalizedCrop=crop?{x:sx/w,y:sy/h,width:sw/w,height:sh/h}:null;
  record.instance.postMessage({type:'frame',bitmap,time:now,epoch:current,crop:normalizedCrop},[bitmap]);
 }catch(error){record.busy=false;console.warn(error);}
}
function scheduleInference(now){
 if(mode!=='camera'||document.hidden||video.readyState<2||dance?.practice)return;
 // submit marca busy antes de crear el bitmap; la segunda elección ve esa
 // reserva y respeta el presupuesto de CPU y el turno único de detalles.
 for(let slot=0;slot<2;slot++){
  const kind=scheduler.choose(workers,now,video.currentTime);
  if(!kind)break;
  submit(kind,now);
 }
}
function draw(now){
 if(!video.videoWidth||!video.videoHeight)return;
 const drawKey=[poseAt,detailsAt,$('points-toggle').checked,$('mesh-toggle').checked,now-poseAt<600,now-detailTimes.hands<500,now-detailTimes.face<500,video.videoWidth,video.videoHeight].join(':');
 if(drawKey===lastDraw)return;lastDraw=drawKey;
 const scale=Math.min(1,960/video.videoWidth),width=Math.round(video.videoWidth*scale),height=Math.round(video.videoHeight*scale);
 if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
 ctx.clearRect(0,0,canvas.width,canvas.height);
 if(!$('points-toggle').checked)return;
 const w=canvas.width,h=canvas.height;
 const line=(points,links,color,check=()=>true)=>{
  ctx.strokeStyle=color;ctx.lineWidth=Math.max(2,w/450);
  ctx.beginPath();
  for(const [a,b] of links){
   if(!points[a]||!points[b]||!check(a)||!check(b))continue;
   ctx.moveTo(points[a].x*w,points[a].y*h);ctx.lineTo(points[b].x*w,points[b].y*h);
  }
  ctx.stroke();
 };
 const dots=(points,color,radius,check=()=>true)=>{
  ctx.fillStyle=color;
  ctx.beginPath();
  points.forEach((p,i)=>{if(!check(i)||p.x<0||p.x>1||p.y<0||p.y>1)return;
   ctx.moveTo(p.x*w+radius,p.y*h);ctx.arc(p.x*w,p.y*h,radius,0,Math.PI*2);
  });
  ctx.fill();
 };
 const pose=now-poseAt<600?lastPose.landmarks?.[0]||[]:[];
 const valid=i=>tracker.motion.visible.has(i);
 line(pose,POSE_LINKS.filter(([a,b])=>a<23||b<23),'#7dcfb9',valid);
 line(pose,POSE_LINKS.filter(([a,b])=>a>=23&&b>=23),'#f4c368',valid);
 dots(pose,'#a1e7d4',Math.max(3,w/280),i=>i<23&&valid(i));
 dots(pose,'#ffc960',Math.max(5,w/190),i=>i>=23&&valid(i));
 if(now-detailTimes.hands<500){
  for(const hand of lastDetails.hands?.landmarks||[]){line(hand,HAND_LINKS,'#72bdf1');dots(hand,'#aadfff',Math.max(2,w/390));}
 }
 if(now-detailTimes.face<500){
  const face=lastDetails.face?.faceLandmarks?.[0]||[];
  if($('mesh-toggle').checked){
   line(face,faceConnections,'#c3b27b80');
  }
  dots(face,'#edcf8790',Math.max(1,w/800));
 }
}
const counters={};
function counter(id,meter,count,total){
 if(counters[id]===count)return;
 counters[id]=count;$(id).innerHTML=(count===null?'—':count)+' <small>/ '+total+'</small>';
 if(meter)$(meter).style.width=(count===null?0:count/total*100)+'%';
}
function summary(now){
 const m=tracker.motion,live=mode==='camera',fresh=live&&now-poseAt<700;
 const details={hands:live&&now-detailTimes.hands<600?lastDetails.hands:{},face:live&&now-detailTimes.face<600?lastDetails.face:{}};
 const arms=avatar?.getArmState();
 return {mode,body:fresh?m.visible.size:0,legs:fresh?m.legCounts:[0,0],
  hands:(details.hands?.landmarks||[]).reduce((n,h)=>n+h.length,0),
  face:details.face?.faceLandmarks?.[0]?.length||0,knees:fresh?m.knees:{},hips:fresh&&m.pelvis.visible?m.pelvis.count:0,poseFps:Number(poseFps.toFixed(1)),
  person:live?person.state:'off',jump:{...m.jump},dance:dance?.getState()||null,
  camera:live?cameraState:null,
  detection:{body:live?detectedBody:0,legs:live?detectedLegs:[0,0],selection:live?person.reason:'off'},
  performance:{renderFps:Number(renderFps.toFixed(1)),renderCost:Number(renderBudget.cost.toFixed(1)),renderLimit:renderBudget.fps,renderScale:renderBudget.scale,
   detailsPaused:!currentProfile().details,sensitivity:$('sensitivity').value,
   autoStage:$('quality-select').value==='dance'&&live?autoBudget.stage:null,compute:workers.pose?.compute||null,benchmarking:workers.pose?.benchmarking||false,
   detectorDelegates:Object.fromEntries(Object.entries(workers).map(([kind,r])=>[kind,r.delegate])),
   cores:navigator.hardwareConcurrency||null,memory:navigator.deviceMemory||null,
   videoFps:videoFps===null?null:Number(videoFps.toFixed(1)),acceleration:workers.pose?.acceleration||null,
   poseLatency:Math.round(workers.pose?.latency||0),poseModel:workers.pose?.quality||null,delegate:workers.pose?.delegate||null,
   detectorRates:Object.fromEntries(Object.entries(workers).map(([kind,r])=>[kind,Number(r.fps.toFixed(1))]))},
  handState:{focused:avatar?.getHandSide(),accepted:['left','right'].filter(side=>m.handVisible[side]),
   sides:Object.fromEntries(['left','right'].map(side=>{
    const arm=arms?.[side]||{},facing=value=>value>.25?'palma':value<-.25?'dorso':'perfil';
    return [side,{gesture:m.hands[side].gesture||'None',measured:facing(arm.measuredPalm),rendered:facing(arm.renderedPalm),
     differenceDegrees:Math.round((arm.handError||0)*180/Math.PI)}];
   }))}};
}
function updateUi(now){
 const s=summary(now),off=mode!=='camera',paused=s.performance.detailsPaused;
 counter('body-count','body-meter',off?null:s.body,33);
 $('hips-state').textContent=off?'Caderas · esperando cámara':s.hips===2?'Caderas · 2/2 en seguimiento':'Caderas · esperando puntos fiables';
  if($('person-state'))$('person-state').textContent=off?'Una persona por sesión':s.person==='tracking'?'Persona fijada':s.detection.selection==='reacquiring'?'Confirmando tu regreso':s.person==='holding'?'Persona oculta · esperando su regreso':s.detection.selection==='confirming'?'Cuerpo encontrado · confirmando persona':'Colócate en el centro para fijarte';
 if($('jump-state'))$('jump-state').textContent=off?'Saltos · esperando cámara':s.jump.reason==='feet_missing'?'Salto · muestra ambos pies':s.jump.reason==='hips_missing'?'Salto · muestra las caderas':!s.jump.calibrated?'Suelo · tomando referencia':s.jump.state==='takeoff'?'Despegue · confirmando':s.jump.active?(s.jump.state==='landing'?'Aterrizando':'Salto detectado')+' · '+s.jump.count:'Suelo calibrado · saltos: '+s.jump.count;
 if($('motion-performance')){
  const note=s.performance.autoStage==='measuring'?' · Midiendo equipo':s.performance.autoStage==='body'?' · Auto prioriza cuerpo':s.performance.autoStage==='reduced'?' · Detalles espaciados':paused?' · Equipo lento':'';
  $('motion-performance').textContent=mode==='demo'?s.performance.renderFps.toFixed(0)+' FPS 3D · demo sin cámara':off?(paused?'Equipo lento · cuerpo, piernas y saltos':'Baile y saltos · ajuste automático'):s.performance.benchmarking?'Comparando CPU y GPU…':s.poseFps?s.performance.renderFps.toFixed(0)+' FPS 3D · cuerpo '+s.poseFps.toFixed(0)+' muestras/s · respuesta '+s.performance.poseLatency+' ms · '+(s.performance.delegate||'')+note:'';
 }
 counter('left-count','left-meter',off?null:s.legs[0],5);
 counter('right-count','right-meter',off?null:s.legs[1],5);
 counter('hand-count',null,off||paused?null:s.hands,42);counter('face-count',null,off||paused?null:s.face,478);
 $('pose-rate').textContent=mode==='demo'?'DEMO':off?'SIN SEÑAL':poseFps?poseFps.toFixed(0)+' muestras/s':'BUSCANDO';
 const labels={Closed_Fist:'Puño cerrado',Open_Palm:'Palma abierta',Pointing_Up:'Índice extendido',Thumb_Up:'Pulgar arriba',Thumb_Down:'Pulgar abajo',Victory:'Dos dedos extendidos'};
 const accepted=['left','right'].filter(side=>tracker.motion.handVisible[side]);
 const pauseLabel=s.performance.autoStage==='measuring'?'midiendo equipo':s.performance.autoStage==='body'?'Auto prioriza cuerpo':'Equipo lento';
 $('hands-state').textContent=paused?'Dedos en pausa · '+pauseLabel:off?'Esperando cámara':accepted.length?accepted.map(side=>labels[tracker.motion.hands[side].gesture]||'Dedos en seguimiento').join(' · '):s.hands?'Recuperando la mano':'Buscando manos y puños';
 const f=tracker.motion.face;
 $('expression').textContent=paused?'Gestos en pausa · '+pauseLabel:off?'Esperando cámara':!s.face?'Rostro fuera de vista':f.blinkLeft>.55||f.blinkRight>.55?'Parpadeo':f.jaw>.25?'Boca abierta':f.smile>.3?'Sonrisa':'Rostro en seguimiento';
 let hint='Para mover las piernas, las rodillas y los tobillos deben estar dentro de la imagen.';
 let framing='La cámara y la detección se procesan en este navegador.';
 if(mode==='demo'){hint='Demo sintética. Enciende la cámara para controlar el robot con tus movimientos.';framing='La demo no representa puntos detectados.';}
 else if(mode==='camera'){
  const p=tracker.motion.visible;
  if(s.detection.selection==='reacquiring'){hint='Confirmando tu regreso. Mantente visible un momento; la cámara sigue encendida.';framing='Recuperando cuerpo y referencia del suelo';}
  else if(s.person==='holding'){hint='El seguimiento sigue fijado a la misma persona. Para elegir otra, pulsa Recuperar seguimiento.';framing='Esperando a la persona fijada';}
  else if(now-poseAt>700||s.body<4){hint='Buscando el cuerpo. Colócate en el centro y deja espacio alrededor de la cabeza y los pies.';framing='Todavía no hay una postura fiable.';}
  else if(s.hips<2){hint='Caderas sin una medida fiable. El robot conserva su orientación hasta recuperarlas.';framing='Caderas parcialmente ocultas · postura conservada';}
  else if(![25,26].every(i=>p.has(i))){hint='Rodillas sin puntos fiables: aléjate para incluir las piernas completas.';framing='Torso visible · faltan rodillas';}
  else if(![27,28].every(i=>p.has(i))){hint='Faltan tobillos: ajusta la inclinación de la cámara para incluir ambos pies.';framing='Rodillas visibles · faltan tobillos';}
  else if(s.legs.some(c=>c<5)){hint='Las piernas están visibles. Muestra talones y puntas sin taparlos.';framing='Piernas en seguimiento';}
  else{hint='Persona fijada. Deja ambos pies quietos un momento y después prueba un salto, con margen sobre la cabeza.';framing='Caderas 2/2 · piernas completas · rodillas '+(s.knees.left?.toFixed(0)||'—')+'° / '+(s.knees.right?.toFixed(0)||'—')+'°';}
 }
 $('hint').textContent=hint;$('framing-message').textContent=framing;
 $('framing-guide').hidden=mode!=='camera'||s.legs.every(c=>c===5);
 $('camera-zoom-reset').hidden=off||!s.camera?.zoom||s.camera.zoom.min===s.camera.zoom.max;
 $('camera-caption').textContent=s.camera?.zoomStatus==='enlarged'?'Zoom de cámara activo':'Imagen completa · sin recorte';
}
$('camera-button').onclick=()=>mode==='camera'?stop():startCamera();
$('demo-button').onclick=toggleDemo;
$('center-button').onclick=()=>notice(tracker.center()?'Postura centrada.':'Necesitas hombros o caderas visibles para centrar.');
$('face-calibrate').onclick=()=>notice(tracker.calibrateFace()?'Rostro calibrado.':'Necesitas un rostro visible para calibrar.');
 if($('floor-calibrate'))$('floor-calibrate').onclick=()=>{tracker.jumpDetector.reset(true);tracker.motion.jump=tracker.jumpDetector.snapshot();tracker.motion.position[1]=0;notice('Deja ambos pies apoyados y quietos un momento para calibrar el suelo.');};
$('reset-button').onclick=recover;
$('smoothing').oninput=e=>{tracker.smoothing=Number(e.target.value)/100;$('smooth-value').value=e.target.value+'%';};
$('expression-strength').oninput=e=>{tracker.expressionStrength=Number(e.target.value)/100;$('expression-value').value=e.target.value+'%';};
$('sensitivity').onchange=e=>{
 tracker.setSensitivity(e.target.value==='high');
 workers.pose?.instance.postMessage({type:'configure',sensitivity:e.target.value});
};
$('camera-select').onchange=()=>{if(mode==='camera')startCamera();};
$('camera-zoom-reset').onclick=async()=>{
 const track=stream?.getVideoTracks()[0],current=epoch;if(!track)return;
 $('camera-zoom-reset').disabled=true;
 try{
  const info=await minimizeCameraZoom(track);if(current!==epoch)return;
  cameraState=info;updateFraming();
  notice(info.zoomStatus==='minimum'?'La cámara está en su zoom mínimo. Si faltan los pies, aleja o reubica la cámara.':'No se pudo reducir el zoom. Revisa el ajuste en la aplicación de tu cámara.',info.zoomStatus!=='minimum');
 }catch{if(current===epoch)notice('La cámara no permite cambiar el zoom desde este navegador.',true);}
 finally{$('camera-zoom-reset').disabled=false;}
};
$('quality-select').onchange=async()=>{
 applyProfile();updateUi(performance.now());
 if(mode!=='camera')return;
 scheduler.reset();
 $('quality-select').disabled=true;state('Cambiando seguimiento…');
 if(workers.pose?.quality!==currentProfile().poseQuality)await restartWorker('pose');
 await prepareWorkers();
 $('quality-select').disabled=false;
};
$('diagnostics-button').onclick=async()=>{
 const text=performanceReport(summary(performance.now()),$('quality-select').selectedOptions[0].textContent,navigator.userAgent);
 $('performance-report').value=text;
 try{await navigator.clipboard.writeText(text);$('performance-report').hidden=true;notice('Diagnóstico copiado. Puedes compartir ese texto para revisar el rendimiento.');}
 catch{$('performance-report').hidden=false;notice('Selecciona y copia el diagnóstico que aparece debajo de los controles.');}
};
for(const [id,back] of [['front-button','front'],['back-button','back'],['face-button','face'],['hands-button','hands']])$(id).onclick=()=>{
 avatar?.setView(back);for(const [button,view] of [['front-button','front'],['back-button','back'],['face-button','face'],['hands-button','hands']])$(button).setAttribute('aria-pressed',String(view===back));
};
$('wire-toggle').onchange=e=>avatar?.setWireframe(e.target.checked);
$('skeleton-toggle').onchange=e=>avatar?.setSkeleton(e.target.checked);
addEventListener('pagehide',stop);

try{
 avatar=await createAvatar($('avatar'));$('avatar-loading').hidden=true;
 const syncDanceProfile=async()=>{
  applyProfile();
  if(mode==='camera'){
   if(workers.pose?.quality!==currentProfile().poseQuality)await restartWorker('pose');
   await prepareWorkers();
  }
 };
 dance=createDanceUI({avatar,onProfileChange:()=>syncDanceProfile().catch(console.warn),ensureCamera:async()=>{
  if(mode!=='camera')await startCamera();
  if(mode!=='camera')return false;
  await syncDanceProfile();return mode==='camera';
 }});
 $('dance-open').disabled=false;
 if(new URL(location.href).searchParams.get('modo')==='baile')dance.open();
 $('camera-button').disabled=false;
 refreshCameras().catch(console.warn);
 let frames=0,frameWindow=performance.now();
 function loop(now){
  if(document.hidden){requestAnimationFrame(loop);return;}
  if(mode==='camera'){
   // Si la prueba inicial de manos/rostro fue sin sujeto, repetir una sola
   // vez al aparecer. Nunca comparar varios detectores simultáneamente.
   if(!detailsLoading&&!Object.values(workers).some(r=>r.benchmarking)){
    const record=Object.values(workers).find(r=>r.pendingComparison&&r.ready&&!r.busy);
    if(record){record.pendingComparison=false;record.benchmarking=true;record.selectedPromise=new Promise(resolve=>record.selected=resolve);record.instance.postMessage({type:'compare-subject'});}
   }
   const pose=workers.pose;
   if($('quality-select').value==='dance'&&pose?.ready&&autoBudget.observe({latency:pose.latency,fps:pose.fps,renderFps,frames:pose.frames,benchmarking:pose.benchmarking},now)){
    applyProfile();prepareWorkers();
   }
   for(const [kind,record] of Object.entries(workers)){
    if(needsCpuRecovery(record,now)&&!recoveryJobs[kind]){
     state('Recuperando seguimiento…');restartWorker(kind,true);
     notice('Se está ajustando el procesamiento para recuperar el seguimiento.');
    }
   }
   scheduleInference(now);
  }
  const dt=renderBudget.frame(now,mode!=='idle'||dance.active||avatar.isInteracting(now));
  if(dt){
   const start=performance.now();
   if(mode==='camera'){tracker.decay(now,dt);draw(now);}else if(mode==='demo')demoTime+=dt;
   dance.update(now);
   avatar.update(mode==='demo'?demoMotion(demoTime):tracker.getRenderMotion(now),dt);
   if(mode!=='idle'||dance.active){renderBudget.observe(performance.now()-start,now);avatar.setRenderScale(renderBudget.scale);}
   frames++;
  }
  if(now-frameWindow>=1000){
   renderFps=frames*1000/(now-frameWindow);frames=0;frameWindow=now;
   if(mode==='camera'&&lastVideoMeasured&&now-lastVideoMeasured>=1000){
    const quality=video.getVideoPlaybackQuality?.();
    if(quality&&quality.totalVideoFrames>lastVideoFrames)videoFps=(quality.totalVideoFrames-lastVideoFrames)*1000/(now-lastVideoMeasured);
    else videoFps=null;
    lastVideoFrames=quality?.totalVideoFrames||0;lastVideoMeasured=now;
   }
  }
  if(now-lastUi>250){updateUi(now);lastUi=now;}
  requestAnimationFrame(loop);
 }
 requestAnimationFrame(loop);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){renderBudget.next=renderBudget.last=0;frames=0;frameWindow=performance.now();lastPoseTime=0;lastVideoMeasured=performance.now();lastVideoFrames=video.getVideoPlaybackQuality?.().totalVideoFrames||0;videoFps=null;}});
}catch(error){$('avatar-loading').textContent='No se pudo cargar el 3D';notice(error.message,true);}

// Mismas acciones que la interfaz; no activar cámara desde herramientas de agentes.
const context=document.modelContext;
if(context?.registerTool){
 const lifecycle=new AbortController();addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
 const tools=[
  {name:'read_tracking',title:'Leer seguimiento',description:'Leer contadores y estado actual, sin imágenes ni coordenadas.',
   inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},
   execute(input){if(input&&Object.keys(input).length)throw Error('No se aceptan parámetros');return summary(performance.now());}},
  {name:'set_demo',title:'Cambiar demo',description:'Activar o detener la demo sintética del samurái, sin usar cámara.',
   inputSchema:{type:'object',properties:{enabled:{type:'boolean'}},required:['enabled'],additionalProperties:false},
   annotations:{readOnlyHint:false,untrustedContentHint:false},
   execute(input){if(!input||typeof input.enabled!=='boolean'||Object.keys(input).some(k=>k!=='enabled'))throw Error('enabled debe ser booleano');
    if(input.enabled&&mode!=='demo')toggleDemo();else if(!input.enabled&&mode==='demo')stop();updateUi(performance.now());return summary(performance.now());}}
 ];
 for(const tool of tools)try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(console.warn);}catch(error){console.warn(error);}
}
window.samurai={getState:()=>summary(performance.now()),getDiagnostics:()=>({poseAt,detailsAt,lastPoseTime,now:performance.now(),points:lastPose.landmarks?.[0]?.length||0,avatarHeight:Number((avatar?.getJoints().base.matrixWorld.elements[13]||0).toFixed(3)),workers:Object.fromEntries(Object.entries(workers).map(([kind,r])=>[kind,{ready:r.ready,busy:r.busy,delegate:r.delegate,duration:Number(r.duration.toFixed(1)),interval:Number(r.interval.toFixed(1)),fps:Number(r.fps.toFixed(1))}]))})};
