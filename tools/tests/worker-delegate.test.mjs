import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../public/vision.worker.js',import.meta.url),'utf8');
async function compare({GPU=20,CPU=10,gpuAvailable=true,failGpu=false,failCpu=false,failGpuFrame=false,gpuFound=1,cpuFound=1,subjectAfter=0}={}){
 let clock=0;const messages=[],tasks=[],inputs=[];
 class Task{
  static async createFromOptions(_vision,options){
   const delegate=options.baseOptions.delegate;
   if(delegate==='GPU'&&failGpu)throw Error('GPU no inicia');
   if(delegate==='CPU'&&failCpu)throw Error('CPU no inicia');
   const task={delegate,closed:false,close(){this.closed=true;if(delegate==='GPU'&&failGpuFrame)throw Error('Contexto perdido');},recognizeForVideo(bitmap,time){inputs.push({delegate,time,bitmap});if(delegate==='GPU'&&failGpuFrame)throw Error('GPU falla al inferir');clock+=delegate==='GPU'?GPU:CPU;return {landmarks:time>=subjectAfter&&(delegate==='GPU'?gpuFound:cpuFound)?[[{x:.5,y:.5,z:0}]]:[]};}};
   tasks.push(task);return task;
  }
 }
 const gl={getExtension:name=>name==='WEBGL_debug_renderer_info'?{UNMASKED_RENDERER_WEBGL:1}:{loseContext(){}},getParameter:()=>gpuAvailable?'Hardware GPU':'SwiftShader'};
 const context=vm.createContext({performance:{now:()=>clock},importScripts(){},OffscreenCanvas:class{getContext(){return gl;}},
  Vision:{FilesetResolver:{forVisionTasks:async()=>({})},GestureRecognizer:Task},postMessage:message=>messages.push(message)});
 vm.runInContext(source,context);
 const deliver=async message=>{context.onmessage({data:message});for(let i=0;i<20;i++)await Promise.resolve();};
 await deliver({type:'init',kind:'hands'});
 let closedBitmaps=0;
 for(let i=0;i<7;i++)await deliver({type:'frame',bitmap:{close(){closedBitmaps++;}},time:i*100,epoch:1});
 return {messages,tasks,inputs,closedBitmaps,deliver};
}
test('el detector compara los mismos fotogramas, elige CPU más rápida y libera GPU',async()=>{
 const r=await compare();const selected=r.messages.find(m=>m.type==='delegate-selected');
 assert.equal(selected.delegate,'CPU');assert.deepEqual({...selected.compute},{GPU:20,CPU:10});
 assert.equal(r.tasks.find(t=>t.delegate==='GPU').closed,true);assert.equal(r.tasks.find(t=>t.delegate==='CPU').closed,false);
 assert.equal(r.closedBitmaps,7);assert.equal(r.messages.filter(m=>m.type==='result').length,7);
 for(let i=0;i<6;i++){const pair=r.inputs.filter(p=>p.time===i*100);assert.equal(pair.length,2);assert.equal(pair[0].bitmap,pair[1].bitmap);}
 assert.equal(r.inputs.filter(p=>p.time===600).length,1);
});
test('si GPU gana conserva GPU; sin GPU o con fallo de inicio mantiene CPU',async()=>{
 const fast=await compare({GPU:8,CPU:25});assert.equal(fast.messages.find(m=>m.type==='delegate-selected').delegate,'GPU');
 assert.equal(fast.tasks.find(t=>t.delegate==='CPU').closed,true);
 for(const config of [{gpuAvailable:false},{failGpu:true}]){
  const r=await compare(config);assert.equal(r.messages.find(m=>m.type==='ready').delegate,'CPU');
  assert.equal(r.messages.some(m=>m.type==='delegate-selected'),false);assert.equal(r.tasks.length,1);
 }
});
test('una GPU que pierde todas las detecciones no gana sólo por ser más rápida',async()=>{
 const r=await compare({GPU:1,CPU:15,gpuFound:0});assert.equal(r.messages.find(m=>m.type==='delegate-selected').delegate,'CPU');
});
test('si CPU no puede cargar, se conserva GPU sin anunciar una comparación completada',async()=>{
 const r=await compare({failCpu:true});assert.equal(r.messages.find(m=>m.type==='ready').benchmarking,false);
 assert.equal(r.messages.some(m=>m.type==='delegate-selected'),false);assert.equal(r.tasks.length,1);
});
test('si la primera comparación no vio manos, solicita una sola prueba al encontrarlas',async()=>{
 const r=await compare({subjectAfter:600});
 assert.equal(r.messages.filter(m=>m.type==='benchmark-needed').length,1);
 await r.deliver({type:'compare-subject'});
 for(let i=7;i<=14;i++)await r.deliver({type:'frame',bitmap:{close(){}},time:i*100,epoch:1});
 assert.equal(r.messages.filter(m=>m.type==='delegate-selected').length,2);
 assert.equal(r.messages.filter(m=>m.type==='benchmark-needed').length,1);
 assert.equal(r.tasks.filter(t=>!t.closed).length,1);
});
test('un fallo GPU durante la prueba conserva CPU incluso si cerrar el contexto también falla',async()=>{
 const r=await compare({failGpuFrame:true}),selected=r.messages.find(m=>m.type==='delegate-selected');
 assert.equal(selected.delegate,'CPU');assert.equal(selected.compute.CPU,10);assert.equal(selected.compute.GPU,null);
 assert.equal(r.messages.filter(m=>m.type==='result').length,7);assert.equal(r.messages.some(m=>m.type==='frame-error'),false);
 assert.match(selected.acceleration,/GPU falló/);
});
