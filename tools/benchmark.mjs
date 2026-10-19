import {chromium} from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import {prepareFixtures} from './prepare-fixtures.mjs';
const cleanup=await prepareFixtures(['pose.jpg'],{video:true});
let browser;
try{
 const graphics=process.argv[6]==='gpu'?[]:['--use-angle=swiftshader','--enable-unsafe-swiftshader'];
 browser=await chromium.launch({channel:'chrome',headless:true,args:[...graphics,'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-video-capture='+path.join(import.meta.dirname,'.cache/pose.y4m')]});
 const page=await browser.newPage({viewport:{width:1440,height:1050},permissions:['camera']});
 const declaredCores=Number(process.argv[7]||0);
 if(declaredCores)await page.addInitScript(cores=>Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>cores}),declaredCores);
 const slowdown=Number(process.argv[5]||1);
 if(slowdown>1){const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:slowdown});}
 const origin=process.argv[2]||'http://127.0.0.1:5173/';
 await page.addInitScript(()=>{
  window.benchmarkFrames=[];window.benchmarkTasks=[];window.benchmarkDetections={pose:0,hands:0,face:0};
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{
   constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.type==='result')window.benchmarkDetections[data.kind]++;});}
  };
  new PerformanceObserver(list=>{for(const entry of list.getEntries())window.benchmarkTasks.push(entry.duration);}).observe({type:'longtask',buffered:true});
  let last=performance.now();function tick(now){window.benchmarkFrames.push(now-last);last=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);
 });
 await page.goto(origin);await page.waitForFunction(()=>!!window.samurai);
 await page.locator('#camera-button').click();
 await page.waitForFunction(()=>window.samurai.getState().legs.every(n=>n===5),null,{timeout:45000});
 const report={origin,slowdown,declaredCores,method:'Chrome: limitación de hilo principal y núcleos declarados; no emula la CPU física de otro equipo',results:[]};
 for(const quality of (process.argv[4]?.split(',')||['dance','lite'])){
  await page.locator('#quality-select').selectOption(quality);await page.waitForFunction(()=>!document.querySelector('#quality-select').disabled);
  await page.waitForTimeout(10000);
  await page.evaluate(()=>{window.benchmarkFrames=[];window.benchmarkTasks=[];window.benchmarkDetections={pose:0,hands:0,face:0};window.benchmarkStart=performance.now();});
  const samples=[];
  for(let i=0;i<20;i++){
   samples.push(await page.evaluate(()=>({state:window.samurai.getState(),diag:window.samurai.getDiagnostics()})));
   await page.waitForTimeout(500);
  }
  const metrics=await page.evaluate(()=>{
   const frames=window.benchmarkFrames.sort((a,b)=>a-b),tasks=window.benchmarkTasks;
   return {rafFps:1000/(frames.reduce((s,n)=>s+n,0)/frames.length),rafP95:frames[Math.floor(frames.length*.95)],rafP99:frames[Math.floor(frames.length*.99)],longTasks:tasks.length,longTaskMax:Math.max(0,...tasks),measuredRates:Object.fromEntries(Object.entries(window.benchmarkDetections).map(([k,n])=>[k,n*1000/(performance.now()-window.benchmarkStart)])),cores:navigator.hardwareConcurrency};
  });
  const average=key=>samples.reduce((n,s)=>n+key(s),0)/samples.length;
  const result={quality,poseFps:average(s=>s.state.poseFps),renderFps:average(s=>s.state.performance.renderFps),poseLatency:average(s=>s.state.performance.poseLatency),model:samples.at(-1).state.performance.poseModel,body:samples.at(-1).state.body,performance:samples.at(-1).state.performance,...metrics,workers:samples.at(-1).diag.workers};
  report.results.push(result);console.log(JSON.stringify(result));
 }
 await page.locator('#camera-button').click();
 if(process.argv[3])await fs.writeFile(process.argv[3],JSON.stringify(report,null,2));
}finally{await browser?.close();await cleanup();}
