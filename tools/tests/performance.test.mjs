import test from 'node:test';
import assert from 'node:assert/strict';
import {InferenceScheduler,inferenceInterval,needsCpuRecovery,RenderBudget,AutoBudget,trackingProfile,performanceReport} from '../../src/performance.js';

const worker=(delegate='CPU')=>({ready:true,busy:false,delegate,sentAt:0,videoTime:-1,interval:32});
test('el cuerpo, las manos y el rostro comparten CPU sin inferencias simultáneas ni inanición',()=>{
 const scheduler=new InferenceScheduler(1),workers={pose:worker(),hands:worker(),face:worker()},count={pose:0,hands:0,face:0};
 workers.hands.interval=100;workers.face.interval=200;
 for(let frame=1;frame<=90;frame++){
  const now=frame*100,kind=scheduler.choose(workers,now,frame);
  assert.ok(kind);workers[kind].busy=true;workers[kind].sentAt=now;workers[kind].videoTime=frame;count[kind]++;
  assert.equal(scheduler.choose(workers,now,frame),null);
  workers[kind].busy=false;scheduler.completed(kind);
 }
 assert.ok(count.pose>=45);assert.ok(count.hands>=10);assert.ok(count.face>=10);
});

test('la GPU puede seguir el cuerpo y un detalle, nunca manos y rostro a la vez',()=>{
 const scheduler=new InferenceScheduler(),workers={pose:worker('GPU'),hands:worker('GPU'),face:worker('GPU')};
 const kind=scheduler.choose(workers,100,1);assert.equal(kind,'pose');workers.pose.busy=true;
 const detail=scheduler.choose(workers,100,1);assert.ok(['hands','face'].includes(detail));workers[detail].busy=true;
 assert.equal(scheduler.choose(workers,100,1),null);
 workers.pose.busy=false;assert.equal(scheduler.choose(workers,150,2),'pose');
});

test('una CPU con varios núcleos admite cuerpo y un detalle, conservando un máximo de dos trabajos',()=>{
 const scheduler=new InferenceScheduler(2),workers={pose:worker(),hands:worker(),face:worker()};
 workers.pose.busy=true;assert.equal(scheduler.choose(workers,100,1),'hands');workers.hands.busy=true;
 assert.equal(scheduler.choose(workers,100,1),null);workers.pose.busy=false;
 assert.equal(scheduler.choose(workers,150,2),'pose');
});

test('no se repiten fotogramas, no se adelantan intervalos y se espera a los detectores listos',()=>{
 const scheduler=new InferenceScheduler(),workers={pose:worker()};
 workers.pose.videoTime=2;assert.equal(scheduler.choose(workers,100,2),null);
 workers.pose.sentAt=90;assert.equal(scheduler.choose(workers,100,3),null);
 workers.pose.ready=false;assert.equal(scheduler.choose(workers,200,3),null);
 workers.pose.ready=true;assert.equal(scheduler.choose(workers,200,3),'pose');
 assert.equal(inferenceInterval('pose',180,160),32);
 assert.ok(inferenceInterval('hands',180,60)>inferenceInterval('hands',20,15));
 assert.ok(inferenceInterval('face',180,60)>inferenceInterval('hands',180,60));
 assert.ok(inferenceInterval('hands',20,15,6)>inferenceInterval('hands',20,15,0));
 assert.equal(inferenceInterval('pose',180,160,50),32);
});

test('el dibujo mantiene tiempo real y un máximo de 60 FPS en una pantalla de 240 Hz',()=>{
 const budget=new RenderBudget();let frames=0,elapsed=0;
 for(let n=1;n<=2400;n++){
  const dt=budget.frame(n*1000/240,true);if(dt){frames++;elapsed+=dt;}
 }
 assert.ok(frames>=599&&frames<=601,frames);assert.ok(Math.abs(elapsed-10)<.025,elapsed);
});

test('la calidad de dibujo baja ante carga sostenida, conserva el esqueleto y se recupera sin oscilar',()=>{
 const budget=new RenderBudget();
 for(let n=1;n<=600;n++)budget.observe(30,n*1000/60);
 assert.equal(budget.scale,.625);assert.equal(budget.fps,30);
 for(let n=601;n<=2100;n++)budget.observe(5,n*1000/60);
 assert.equal(budget.fps,60);assert.equal(budget.scale,1);
});

test('una GPU lenta reduce la resolución aunque entregar los comandos WebGL tarde poco',()=>{
 const budget=new RenderBudget();
 for(let n=1;n<=250;n++){
  budget.frame(n*50,true);budget.observe(1,n*50);
 }
 assert.equal(budget.scale,.625);assert.equal(budget.fps,30);
});

test('con sólo cinco dibujos por segundo, la adaptación responde en cuatro segundos',()=>{
 const budget=new RenderBudget();
 for(let n=1;n<=20;n++){budget.frame(n*200,true);budget.observe(1,n*200);}
 assert.equal(budget.fps,30);assert.equal(budget.scale,.5);
 for(let n=21;n<=50;n++){budget.frame(n*200,true);budget.observe(1,n*200);}
 assert.equal(budget.scale,.375);
});

test('Equipo lento pausa los detalles y mantiene Lite; Auto recupera el seguimiento completo',()=>{
 assert.deepEqual(trackingProfile('economy'),{economy:true,details:false,poseQuality:'lite'});
 assert.deepEqual(trackingProfile('dance'),{economy:false,details:true,poseQuality:'lite'});
 assert.equal(trackingProfile('heavy').poseQuality,'heavy');
 const budget=new RenderBudget();budget.setEconomy(true);
 for(let n=1;n<=1200;n++){budget.frame(n*1000/30,true);budget.observe(1,n*1000/30);}
 assert.equal(budget.fps,30);assert.equal(budget.scale,.75);
 budget.setEconomy(false);assert.equal(budget.fps,60);assert.equal(budget.scale,1);
});

test('el diagnóstico distingue dibujo y medidas, sin copiar identificadores ni coordenadas',()=>{
 const state={body:33,poseFps:5,camera:{width:1280,height:720,frameRate:30,deviceId:'privado-no-copiar'},
  coordinates:'privado-no-copiar',performance:{renderFps:45,renderLimit:60,renderScale:1,poseLatency:180,delegate:'CPU',poseModel:'lite',detailsPaused:false}};
 const report=performanceReport(state,'Auto','Chrome de prueba');
 assert.match(report,/FPS 3D: 45/);assert.match(report,/Cuerpo: 5 muestras\/s/);assert.match(report,/CPU/);
 assert.doesNotMatch(report,/privado-no-copiar/);
});
test('Auto no carga detalles hasta medir cuerpo; el equipo lento permanece estable sin recargas',()=>{
 const a=new AutoBudget(),sample={latency:180,fps:5,renderFps:18,frames:10};
 assert.equal(a.profile().details,false);
 a.observe({...sample,benchmarking:true},0);assert.equal(a.started,null);
 a.observe(sample,100);assert.equal(a.observe(sample,1400),true);
 assert.equal(a.stage,'body');assert.equal(a.profile().details,false);
 for(let t=1500;t<30000;t+=500)a.observe({latency:20,fps:30,renderFps:30,frames:100},t);
 assert.equal(a.stage,'body');a.reset();assert.equal(a.stage,'measuring');
});
test('Auto conserva detalles en un equipo rápido y los espacia con carga sostenida',()=>{
 const a=new AutoBudget(),good={latency:20,fps:30,renderFps:30,frames:10};
 a.observe(good,0);a.observe(good,1300);assert.equal(a.stage,'full');
 const medium={latency:90,fps:12,renderFps:40,frames:100};
 for(let t=4500;t<=8000;t+=500)a.observe(medium,t);
 assert.equal(a.stage,'reduced');assert.equal(a.profile().detailFactor,4);
 for(let t=8500;t<=13000;t+=500)a.observe({latency:220,fps:5,renderFps:10,frames:150},t);
 assert.equal(a.stage,'body');
});
test('Auto con poca memoria conserva cuerpo aunque el procesador parezca rápido',()=>{
 const a=new AutoBudget({limitedMemory:true}),sample={latency:20,fps:30,renderFps:30,frames:20};
 a.observe(sample,0);a.observe(sample,1500);
 assert.equal(a.stage,'body');assert.equal(a.profile().details,false);
});
test('la comparación permite calentar CPU lenta sin forzarla por confundirla con un bloqueo GPU',()=>{
 const record={...worker('GPU'),busy:true};
 assert.equal(needsCpuRecovery(record,5000),true);
 record.benchmarking=true;assert.equal(needsCpuRecovery(record,8000),false);assert.equal(needsCpuRecovery(record,13000),true);
 record.delegate='CPU';assert.equal(needsCpuRecovery(record,13000),true);
 record.benchmarking=false;assert.equal(needsCpuRecovery(record,13000),false);
 record.delegate='GPU';record.busy=false;assert.equal(needsCpuRecovery(record,13000),false);
});
