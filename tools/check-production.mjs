import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';

const origin=new URL(process.argv[2]||'http://127.0.0.1:4173/');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const response=await page.goto(origin.href);assert.equal(response.status(),200);
 await page.waitForFunction(()=>!!window.samurai);
 for(const resource of ['src/main.js','tools/package.json','.git/config']){
  assert.equal((await page.request.get(new URL(resource,origin).href)).status(),404,'Se expone un archivo del proyecto: '+resource);
 }
 const home=await page.request.get(origin.href),etag=home.headers().etag;
 if(origin.hostname==='127.0.0.1'||origin.hostname==='localhost')assert.ok(etag);
 if(etag){
  assert.equal((await page.request.get(origin.href,{headers:{'If-None-Match':etag}})).status(),304);
  assert.equal((await page.request.get(origin.href,{headers:{'If-None-Match':etag.startsWith('W/')?etag:'W/'+etag}})).status(),304);
 }
 for(const resource of ['robot.json','vision.worker.js','vendor/vision_bundle.js','models/pose_lite.task','models/pose_full.task','models/pose_heavy.task','models/face.task','models/gesture.task','vendor/wasm/vision_wasm_internal.wasm','vendor/wasm/vision_wasm_module_internal.wasm','vendor/wasm/vision_wasm_nosimd_internal.wasm']){
  const result=await page.request.get(new URL(resource,origin).href);
  assert.equal(result.status(),200,resource);
  assert.ok((await result.body()).length>0,resource);
  if(resource.endsWith('.wasm'))assert.match(result.headers()['content-type']||'',/application\/wasm/,resource);
 }
 await page.getByRole('button',{name:'Probar demo 3D',exact:true}).click();
 await page.waitForFunction(()=>window.samurai.getState().mode==='demo');
 await page.screenshot({path:path.join(import.meta.dirname,'.cache/publicada.png'),fullPage:true});
 const delegate=await page.evaluate(()=>new Promise((resolve,reject)=>{
  const worker=new Worker('/vision.worker.js'),timer=setTimeout(()=>{worker.terminate();reject(Error('No cargó el detector de producción'));},30000);
  worker.onmessage=({data})=>{
   if(data.type==='ready'){clearTimeout(timer);worker.terminate();resolve(data.delegate);}
   else if(data.type==='error'){clearTimeout(timer);worker.terminate();reject(Error(data.message));}
  };
  worker.onerror=event=>{clearTimeout(timer);worker.terminate();reject(Error(event.message));};
  worker.postMessage({type:'init',kind:'hands',cpu:true});
 }));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({url:origin.href,demo:true,models:true,wasmMime:true,detector:delegate,errors},null,2));
}finally{await browser.close();}
