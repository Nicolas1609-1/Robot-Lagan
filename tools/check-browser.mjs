import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {prepareFixtures} from './prepare-fixtures.mjs';
const root=path.resolve(import.meta.dirname,'..');
const cleanup=await prepareFixtures(['pose.jpg'],{video:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:[
 '--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
 '--use-file-for-fake-video-capture='+path.join(root,'tools/.cache/pose.y4m')
]});
const context=await browser.newContext({viewport:{width:1440,height:1050},permissions:['camera']});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')console.log('CONSOLE:',m.text().slice(0,300));});
await page.addInitScript(()=>{
 const registry={};
 Object.defineProperty(document,'modelContext',{value:{registerTool(tool){registry[tool.name]=tool;}}});
 window.webTools=registry;
  window.poseInitializations=0;
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{
   postMessage(message,...args){if(message.type==='init'&&message.kind==='pose')window.poseInitializations++;return super.postMessage(message,...args);}
  };
});
try{
 await page.goto(process.argv[2]||'http://127.0.0.1:5173/',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>!!window.samurai);
 await page.screenshot({path:path.join(root,'tools/.cache/web-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'Probar demo 3D'}).click();
 await page.waitForTimeout(700);
 console.log('DEMO',await page.evaluate(()=>window.samurai.getState()));
 await page.locator('#back-button').click();
 await page.screenshot({path:path.join(root,'tools/.cache/web-demo.png'),fullPage:true});
 await page.locator('#hands-button').click();await page.waitForTimeout(180);await page.locator('#avatar').screenshot({path:path.join(root,'tools/.cache/web-hand-demo.png')});
 await page.locator('#face-button').click();await page.waitForTimeout(180);await page.locator('#avatar').screenshot({path:path.join(root,'tools/.cache/web-face-demo.png')});
 const tools=await page.evaluate(async()=>{
  const read=await window.webTools.read_tracking.execute({});
  const demo=await window.webTools.set_demo.execute({enabled:false});
  let invalid=false;try{await window.webTools.set_demo.execute({enabled:'yes'});}catch{invalid=true;}
  return {names:Object.keys(window.webTools),read,demo,invalid};
 });
 console.log('WEBTOOLS',JSON.stringify(tools));
 if(!tools.invalid||tools.demo.mode!=='idle')throw Error('Herramientas no validaron entrada o estado');
 await page.getByRole('button',{name:'Encender cámara',exact:true}).click();
 await page.waitForFunction(()=>window.samurai.getState().legs.every(n=>n===5),null,{timeout:45000});
 await page.waitForTimeout(800);
 console.log('CAMERA',JSON.stringify(await page.evaluate(()=>window.samurai.getState())));
 await page.locator('#sensitivity').selectOption('high');
 await page.waitForFunction(()=>window.samurai.getState().performance.sensitivity==='high'&&window.samurai.getState().body===33);
 {
  const s=await page.evaluate(()=>window.samurai.getState());
  if(s.person!=='tracking'||s.hips!==2)throw Error('Cambiar sensibilidad perdió el cuerpo');
 }
 await page.locator('#sensitivity').selectOption('normal');
 const initializations=await page.evaluate(()=>window.poseInitializations);
 await page.evaluate(async()=>{
  const video=document.getElementById('video'),snapshot=await createImageBitmap(video);
  const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  const ctx=canvas.getContext('2d'),stream=canvas.captureStream(30);
  const fixture=window.sdkReturnFixture={snapshot,canvas,ctx,stream,empty:true,scale:1,offset:0};
  const draw=()=>{
   ctx.fillStyle='#666';ctx.fillRect(0,0,canvas.width,canvas.height);
   if(!fixture.empty){const w=canvas.width*fixture.scale,h=canvas.height*fixture.scale;ctx.drawImage(snapshot,(canvas.width-w)/2+canvas.width*fixture.offset,(canvas.height-h)/2,w,h);}
   fixture.timer=setTimeout(draw,1000/30);
  };draw();video.srcObject=stream;await video.play();
 });
 await page.waitForFunction(()=>window.samurai.getState().person==='holding'&&window.samurai.getState().body===0);
 await page.waitForTimeout(1200);
 await page.evaluate(()=>{window.sdkReturnFixture.empty=false;window.sdkReturnFixture.scale=.5;window.sdkReturnFixture.offset=.24;});
 await page.waitForFunction(()=>window.samurai.getState().person==='tracking'&&window.samurai.getState().legs.every(n=>n===5)&&window.samurai.getState().jump.calibrated,null,{timeout:20000});
 if(await page.evaluate(()=>window.poseInitializations)!==initializations)throw Error('El regreso reinició el detector');
 console.log('REGRESO SDK REAL',JSON.stringify(await page.evaluate(()=>window.samurai.getState())));
 await page.evaluate(()=>{window.sdkReturnFixture.scale=1;window.sdkReturnFixture.offset=0;});
 await page.waitForFunction(()=>window.samurai.getState().person==='tracking');
 await page.locator('#front-button').click();
 await page.screenshot({path:path.join(root,'tools/.cache/web-camera.png'),fullPage:true});
 await page.getByRole('button',{name:'Recuperar seguimiento'}).click();
 await page.waitForFunction(()=>window.samurai.getState().legs.every(n=>n===5),null,{timeout:15000});
 console.log('RECOVER',JSON.stringify(await page.evaluate(()=>window.samurai.getState())));
 await page.getByRole('button',{name:'Apagar cámara',exact:true}).click();
 await page.evaluate(()=>{const f=window.sdkReturnFixture;clearTimeout(f.timer);f.stream.getTracks().forEach(t=>t.stop());f.snapshot.close();});
 await page.waitForFunction(()=>window.samurai.getState().mode==='idle');
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{
   postMessage(message,...args){
    if(message.type==='init'&&message.kind==='pose'&&!window.blockedPoseTest){
     window.blockedPoseTest=true;this.block=true;
     setTimeout(()=>this.dispatchEvent(new MessageEvent('message',{data:{type:'ready',kind:'pose',delegate:'GPU'}})),0);
     return;
    }
    if(this.block){message.bitmap?.close();return;}
    return super.postMessage(message,...args);
   }
  };
 });
 await page.reload({waitUntil:'networkidle'});
 await page.waitForFunction(()=>!!window.samurai);
 await page.locator('#camera-button').click();
 await page.waitForFunction(()=>window.samurai.getState().legs.every(n=>n===5)&&window.samurai.getDiagnostics().workers.pose.delegate==='CPU',null,{timeout:30000});
 console.log('GPU RECOVERY',JSON.stringify(await page.evaluate(()=>window.samurai.getState())));
 await page.locator('#camera-button').click();
 await page.waitForFunction(()=>window.samurai.getState().mode==='idle');
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:path.join(root,'tools/.cache/web-mobile.png'),fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 if(overflow)throw Error('Desbordamiento horizontal en móvil');
 if(errors.length)throw Error('Errores de página: '+errors.join(' | '));
 console.log('BROWSER QA OK');
}catch(error){
 await page.screenshot({path:path.join(root,'tools/.cache/web-failure.png'),fullPage:true});
 console.error('QA FAILED',error);console.error('PAGE ERRORS',errors);
 console.log('STATE',await page.evaluate(()=>({app:window.samurai?.getState(),diagnostics:window.samurai?.getDiagnostics(),notice:document.querySelector('#notice')?.textContent,workerScripts:performance.getEntriesByType('resource').map(x=>x.name).filter(x=>/worker|models|wasm/.test(x))})));
 process.exitCode=1;
}finally{await browser.close();await cleanup();}
