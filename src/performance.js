// Cuerpo + un detalle como máximo. Una CPU de pocos núcleos usa un turno.
// Sólo se envía el fotograma actual, sin una cola de imágenes antiguas.
export class InferenceScheduler{
 constructor(cpuSlots=2){this.cpuSlots=cpuSlots;this.reset();}
 reset(){this.bodySinceDetail=0;}
 completed(kind){if(kind==='pose')this.bodySinceDetail++;else this.bodySinceDetail=0;}
 choose(workers,now,videoTime){
  const busy=Object.values(workers).filter(r=>r.busy);
  const due=kind=>{
   const r=workers[kind];
   return r?.ready&&!r.busy&&r.videoTime!==videoTime&&now-r.sentAt>=r.interval&&
    busy.length<2&&(!r.delegate.includes('CPU')||busy.filter(b=>b.delegate.includes('CPU')).length<this.cpuSlots)&&
    (kind==='pose'||!['hands','face'].some(k=>workers[k]?.busy));
  };
  const details=['hands','face'].filter(due).sort((a,b)=>
   (now-workers[b].sentAt)/workers[b].interval-(now-workers[a].sentAt)/workers[a].interval);
  // Dos medidas corporales entre detalles evitan que el rostro quite el turno
  // al cuerpo, sin dejar las manos o las expresiones indefinidamente pendientes.
  const pose=workers.pose,cpu=pose?.delegate.includes('CPU');
  if(due('pose')&&(!cpu||this.bodySinceDetail<2||!details.length))return 'pose';
  if(details.length&&(!cpu||this.bodySinceDetail>=2||!due('pose')))return details[0];
  return due('pose')?'pose':null;
 }
}

export function inferenceInterval(kind,poseLatency=0,duration=0,emptyFrames=0){
 if(kind==='pose')return 32;
 const pressure=Math.max(1,Math.min(3,poseLatency/45));
 const search=emptyFrames>=6?(kind==='hands'?320:550):0;
 return Math.max((kind==='hands'?70:140)*pressure,duration*1.1,search);
}

export function needsCpuRecovery(record,now){
 // Una prueba ejecuta dos modelos y puede tener un calentamiento largo.
 // No confundir ese trabajo extra con un bloqueo de la GPU elegida.
 const limit=record.benchmarking?12000:4000;
 return record.ready&&record.busy&&(record.delegate.includes('GPU')||record.benchmarking)&&now-record.sentAt>limit;
}

export function trackingProfile(quality){
 const economy=quality==='economy';
 return {economy,details:!economy,poseQuality:economy||quality==='dance'?'lite':quality};
}

export class AutoBudget{
 constructor({limitedMemory=false}={}){this.limitedMemory=limitedMemory;this.reset();}
 reset(){this.stage='measuring';this.started=null;this.changedAt=0;this.slowSince=null;}
 profile(){return {details:['full','reduced'].includes(this.stage),economy:this.stage!=='full',detailFactor:this.stage==='reduced'?4:1};}
 observe({latency,fps,renderFps,frames,benchmarking},now){
  if(benchmarking||!frames||!fps)return false;
  this.started??=now;
  const change=stage=>{this.stage=stage;this.changedAt=now;this.slowSince=null;return true;};
  if(this.stage==='measuring'){
   if(frames<6||now-this.started<1200)return false;
   return change(!this.limitedMemory&&latency<=65&&fps>=16&&renderFps>=25?'full':'body');
  }
  // Tras una reducción no se recargan detectores una y otra vez. Cambiar
  // perfil o encender de nuevo permite repetir la medición explícitamente.
  if(this.stage==='body'||now-this.changedAt<3000)return false;
  const severe=latency>120||fps<9||renderFps<20;
  const moderate=this.stage==='full'&&(latency>75||fps<16||renderFps<27);
  if(!severe&&!moderate){this.slowSince=null;return false;}
  this.slowSince??=now;
  if(now-this.slowSince<(severe?1800:3000))return false;
  return change(severe?'body':'reduced');
 }
}

export function performanceReport(state,quality,browser=''){
 const p=state.performance,c=state.camera;
 return ['Samurái · versión cpu-gpu-auto-5','Seguimiento: '+quality,
  'FPS 3D: '+p.renderFps+' · límite: '+p.renderLimit+' · resolución 3D: '+Math.round(p.renderScale*100)+'%',
  'Cuerpo: '+state.poseFps+' muestras/s · respuesta: '+p.poseLatency+' ms',
  'Detector corporal: '+(p.delegate||'sin cámara')+' · modelo: '+(p.poseModel||'sin cámara'),
  'Aceleración: '+(p.acceleration||'sin dato'),
  'Comparación corporal: '+(p.compute?'CPU '+(p.compute.CPU??'no disponible')+' ms · GPU '+(p.compute.GPU??'no disponible')+' ms':'una opción disponible o midiendo'),
  'Manos: '+(p.detectorDelegates?.hands||'en pausa')+' · rostro: '+(p.detectorDelegates?.face||'en pausa'),
  'Ajuste automático: '+(p.autoStage||'manual'),
  'Recursos declarados: '+(p.cores??'sin dato')+' núcleos · RAM aproximada: '+(p.memory??'sin dato')+' GB',
  'Sensibilidad: '+(p.sensitivity==='high'?'Alta':'Normal')+' · persona: '+(state.person||'sin cámara'),
  'Puntos corporales: '+state.body+'/33 · detalles: '+(p.detailsPaused?'en pausa':'activos'),
  'Puntos del detector: '+(state.detection?.body??0)+'/33 · selección: '+(state.detection?.selection||'sin cámara'),
  'Piernas: '+(state.legs||[0,0]).join('/5 · ')+'/5 · caderas: '+(state.hips??0)+'/2',
  'Cámara: '+(c?c.width+'×'+c.height+' · '+c.frameRate+' FPS':'apagada'),
  'Video recibido: '+(p.videoFps===null||p.videoFps===undefined?'sin medición':p.videoFps+' FPS'),
  'Navegador: '+browser].join('\n');
}

export class RenderBudget{
 constructor(){this.last=0;this.next=0;this.cost=0;this.cadence=1000/60;this.scale=1;this.fps=60;this.slowSince=0;this.fastSince=0;this.lastChange=0;this.economy=false;}
 setEconomy(enabled){
  if(this.economy===enabled)return;
  this.economy=enabled;this.fps=enabled?30:60;this.scale=enabled?Math.min(.75,this.scale):1;
  this.slowSince=this.fastSince=0;this.next=0;
 }
 frame(now,active=true){
  const interval=1000/(active?this.fps:20);
  if(now+.5<this.next)return 0;
  const dt=this.last?Math.min(.1,(now-this.last)/1000):1/60;
  this.cadence=this.cadence*.95+(this.last?now-this.last:1000/60)*.05;
  this.last=now;
  this.next=this.next&&now-this.next<interval?this.next+interval:now+interval;
  return dt;
 }
 observe(cost,now){
  this.cost=this.cost?this.cost*.9+cost*.1:cost;
  // WebGL entrega comandos sin esperar a que la GPU termine. Medir también
  // la cadencia detecta una GPU lenta aunque renderer.render tarde poco en JS.
  const slow=this.cost>18||this.cadence>(this.fps===60?28:45),fast=this.cost<10&&this.cadence<(this.fps===60?20:37);
  this.slowSince=slow?(this.slowSince||now):0;this.fastSince=fast?(this.fastSince||now):0;
  if(now-this.lastChange<2500)return;
  if(this.slowSince&&now-this.slowSince>=1500){
   if(this.cadence>60||this.cost>40){this.scale=Math.max(.375,Math.min(.5,this.scale-.125));this.fps=30;}
   else if(this.scale>.625)this.scale=Math.max(.625,this.scale-.125);else this.fps=30;
   this.lastChange=now;this.slowSince=this.fastSince=0;
  }else if(this.fastSince&&now-this.fastSince>=4000&&(this.fps<(this.economy?30:60)||this.scale<(this.economy?.75:1))){
   if(this.fps<60)this.fps=60;else this.scale=Math.min(1,this.scale+.125);
   if(this.economy){this.fps=30;this.scale=Math.min(.75,this.scale+.125);}
   this.lastChange=now;this.slowSince=this.fastSince=0;
  }
 }
}
