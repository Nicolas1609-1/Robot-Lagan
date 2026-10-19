import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {prepareFixtures} from './prepare-fixtures.mjs';

const cleanup=await prepareFixtures(['pose.jpg'],{video:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-video-capture='+path.join(import.meta.dirname,'.cache/pose.y4m')]});
try{
 const page=await browser.newPage({viewport:{width:1100,height:950},permissions:['camera']}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.motionFixture={height:0,singleFoot:0,stranger:false,foreignDetails:false,absent:false,offsetX:0,scale:1,crops:[],missingAnkles:false,delay:650,anchorConfidence:.9,sensitivities:[],models:[],active:0,maxActive:0,comparisonActive:0,maxComparisons:0,comparisonRequests:[],instances:[]};
  class FixtureWorker{
   constructor(){window.motionFixture.instances.push(this);}
   postMessage(message){
    if(message.type==='init'){this.kind=message.kind;if(this.kind==='pose'){window.motionFixture.models.push(message.quality);window.motionFixture.sensitivities.push(message.sensitivity);}setTimeout(()=>this.onmessage?.({data:{type:'ready',delegate:'CPU',connections:[]}}),0);return;}
    if(message.type==='configure'){window.motionFixture.sensitivities.push(message.sensitivity);return;}
    if(message.type==='compare-subject'){
     const f=window.motionFixture;f.comparisonRequests.push(this.kind);f.comparisonActive++;f.maxComparisons=Math.max(f.maxComparisons,f.comparisonActive);
     setTimeout(()=>{f.comparisonActive--;this.onmessage?.({data:{type:'delegate-selected',kind:this.kind,delegate:'GPU',compute:{GPU:10,CPU:30},acceleration:'GPU seleccionado por medición'}});},70);return;
    }
    if(message.type!=='frame')return;
    message.bitmap.close();if(this.closed)return;
    const f=window.motionFixture,p=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:.9,presence:1})),w=p.map(()=>({x:0,y:0,z:0}));
    const joints={0:[0,-.8,0],11:[.2,-.5,0],12:[-.2,-.5,0],13:[.3,-.3,0],14:[-.3,-.3,0],15:[.35,-.1,0],16:[-.35,-.1,0],23:[.1,0,0],24:[-.1,0,0],25:[.1,.45,0],26:[-.1,.45,0],27:[.1,.85,0],28:[-.1,.85,0],29:[.1,.85,.025],30:[-.1,.85,.025],31:[.1,.85,-.12],32:[-.1,.85,-.12]};
    for(const [id,a] of Object.entries(joints)){w[id]={x:a[0],y:a[1],z:a[2]};p[id]={x:.5+f.offsetX+a[0]*.7*f.scale,y:.55+a[1]*.5*f.scale-f.height,z:a[2],visibility:.9,presence:1};}
    for(const i of [11,12,23,24])p[i].visibility=f.anchorConfidence;
    p[27].y-=f.singleFoot;
    if(f.missingAnkles)for(const i of [27,28])p[i].visibility=.05;
    let data;
    if(this.kind==='pose'){
     f.crops.push(message.crop);
     data=f.absent?{landmarks:[],worldLandmarks:[],appearances:[]}:{landmarks:[p],worldLandmarks:[w],appearances:[{rgb:f.stranger?[.2,.6,.2]:[.6,.25,.15],brightness:.5}]};
    }else if(this.kind==='hands'){
     const hand=Array.from({length:21},()=>({...p[15]}));hand[0]=f.foreignDetails?{x:.05,y:.2,z:0}:p[15];
     data={landmarks:[hand],worldLandmarks:[hand],handedness:[[{categoryName:'Left',score:.9}]]};
    }else{
     const face=Array.from({length:478},()=>({...p[0]}));if(f.foreignDetails)face[1]={x:.95,y:.2,z:0};
     data={faceLandmarks:[face],faceBlendshapes:[{categories:[{categoryName:'jawOpen',score:.3}]}]};
    }
    const delay=this.kind==='pose'?f.delay:8;
    f.active++;f.maxActive=Math.max(f.maxActive,f.active);
    setTimeout(()=>{f.active--;if(!this.closed)this.onmessage?.({data:{type:'result',data,time:message.time,epoch:message.epoch,duration:delay}});},delay);
   }
   terminate(){this.closed=true;}
  }
  window.Worker=FixtureWorker;
 });
 await page.goto(process.argv[2]||'http://127.0.0.1:5173/');await page.waitForFunction(()=>!!window.samurai);
 await page.getByRole('button',{name:'Encender cámara',exact:true}).click();
 await page.waitForFunction(()=>window.samurai.getState().person==='tracking'&&window.samurai.getState().body===33);
 await page.evaluate(()=>window.motionFixture.delay=8);
 await page.waitForFunction(()=>window.samurai.getState().person==='tracking'&&window.samurai.getState().jump.state==='grounded');
 const ground=await page.evaluate(()=>window.samurai.getDiagnostics().avatarHeight);
 await page.evaluate(()=>window.motionFixture.singleFoot=.1);await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>window.samurai.getState().jump.count),0);
 await page.evaluate(()=>{window.motionFixture.singleFoot=0;window.motionFixture.height=.09;});
 await page.waitForFunction(()=>window.samurai.getState().jump.active);
 await page.waitForFunction(base=>window.samurai.getDiagnostics().avatarHeight>base+.2,ground);
 const airborne=await page.evaluate(()=>window.samurai.getState());assert.equal(airborne.jump.count,1);
 await page.screenshot({path:path.join(import.meta.dirname,'.cache/web-jump.png'),fullPage:true});
 await page.evaluate(()=>window.motionFixture.height=0);
 await page.waitForFunction(()=>!window.samurai.getState().jump.active&&window.samurai.getState().jump.state==='grounded');
 await page.waitForFunction(base=>Math.abs(window.samurai.getDiagnostics().avatarHeight-base)<.02,ground);
 await page.evaluate(()=>window.motionFixture.foreignDetails=true);
 await page.waitForFunction(()=>window.samurai.getState().hands===0&&window.samurai.getState().face===0);
 await page.evaluate(()=>window.motionFixture.stranger=true);
 await page.waitForFunction(()=>window.samurai.getState().person==='holding'&&window.samurai.getState().body===0);
 await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>window.samurai.getState().person),'holding');
 for(const viewport of [{width:1100,height:950},{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.locator('#framing-guide').waitFor({state:'visible'});
  await page.waitForFunction(()=>{
   const v=document.getElementById('video'),g=document.getElementById('framing-guide'),box=v.getBoundingClientRect(),guide=g.getBoundingClientRect();
   const scale=Math.min(box.width/v.videoWidth,box.height/v.videoHeight),height=v.videoHeight*scale;
   return Math.abs(guide.height-height*.86)<2;
  });
  const framing=await page.evaluate(()=>{
   const v=document.getElementById('video'),g=document.getElementById('framing-guide'),box=v.getBoundingClientRect(),guide=g.getBoundingClientRect();
   const scale=Math.min(box.width/v.videoWidth,box.height/v.videoHeight),w=v.videoWidth*scale,h=v.videoHeight*scale;
   return {camera:window.samurai.getState().camera,fit:getComputedStyle(v).objectFit,
    inside:guide.left>=box.x+(box.width-w)/2&&guide.right<=box.x+(box.width+w)/2&&guide.top>=box.y+(box.height-h)/2&&guide.bottom<=box.y+(box.height+h)/2};
  });
  assert.ok(framing.inside,'Guía fuera de la imagen real');assert.equal(framing.fit,'contain');
  assert.equal(framing.camera.resizeMode,'none');assert.equal(framing.camera.deviceId,undefined);
 }
 await page.setViewportSize({width:1100,height:950});
 await page.evaluate(()=>{window.motionFixture.stranger=false;window.motionFixture.foreignDetails=false;});
 await page.waitForFunction(()=>window.samurai.getState().person==='tracking');
 assert.equal(await page.evaluate(()=>window.samurai.getState().jump.count),1);
 assert.ok(await page.evaluate(()=>window.motionFixture.crops.length>2&&window.motionFixture.crops.every(c=>c===null)));
 await page.getByRole('button',{name:'Calibrar suelo',exact:true}).click();
 await page.waitForFunction(()=>window.samurai.getState().jump.calibrated);
 assert.equal(await page.evaluate(()=>window.samurai.getState().jump.count),1);
 await page.evaluate(()=>{window.motionFixture.missingAnkles=true;window.motionFixture.height=.07;});
 await page.waitForFunction(()=>window.samurai.getState().jump.count===2&&window.samurai.getState().jump.active);
 await page.waitForFunction(base=>window.samurai.getDiagnostics().avatarHeight>base+.15,ground);
 await page.evaluate(()=>{window.motionFixture.height=0;window.motionFixture.missingAnkles=false;});
 await page.waitForFunction(()=>window.samurai.getState().jump.state==='grounded');
 await page.evaluate(()=>window.motionFixture.anchorConfidence=.38);
 await page.locator('#sensitivity').selectOption('high');
 await page.waitForFunction(()=>window.motionFixture.sensitivities.at(-1)==='high'&&window.samurai.getState().hips===2);
 assert.equal(await page.evaluate(()=>window.samurai.getState().person),'tracking');
 assert.equal(await page.evaluate(()=>window.samurai.getState().jump.count),2);
 await page.evaluate(()=>window.motionFixture.anchorConfidence=.9);
 await page.locator('#sensitivity').selectOption('normal');
 await page.evaluate(()=>window.motionFixture.delay=145);
 await page.waitForFunction(()=>window.samurai.getDiagnostics().workers.pose.duration>130);
 assert.deepEqual(await page.evaluate(()=>window.motionFixture.models),['lite']);
 assert.ok(await page.evaluate(()=>window.motionFixture.maxActive<=2),'Se supera el presupuesto de inferencias');
 await page.waitForFunction(()=>window.samurai.getState().performance.autoStage==='body'&&Object.keys(window.samurai.getDiagnostics().workers).length===1);
 assert.equal(await page.evaluate(()=>window.samurai.getState().body),33);
 assert.equal(await page.evaluate(()=>window.samurai.getState().jump.count),2);
 assert.match(await page.locator('#hands-state').textContent(),/Auto prioriza cuerpo/);
 // Rápido pide explícitamente detalles; usa el mismo modelo Lite ya cargado.
 await page.locator('#quality-select').selectOption('lite');
 await page.waitForFunction(()=>window.samurai.getState().hands>0&&window.samurai.getState().face===478);
 assert.deepEqual(await page.evaluate(()=>window.motionFixture.models),['lite']);
 await page.evaluate(()=>window.motionFixture.instances.filter(w=>!w.closed&&w.kind!=='pose').forEach(w=>w.onmessage({data:{type:'benchmark-needed',kind:w.kind}})));
 await page.waitForFunction(()=>window.motionFixture.comparisonRequests.length===2&&window.motionFixture.comparisonActive===0);
 assert.equal(await page.evaluate(()=>window.motionFixture.maxComparisons),1);
 assert.equal(await page.evaluate(()=>window.samurai.getState().performance.detectorDelegates.face),'GPU');
 assert.equal(await page.evaluate(()=>window.samurai.getState().jump.count),2);
 assert.ok(await page.evaluate(()=>window.samurai.getState().performance.renderFps<=62));
 await page.locator('#quality-select').selectOption('economy');
 await page.waitForFunction(()=>!document.getElementById('quality-select').disabled&&window.samurai.getState().body===33&&Object.keys(window.samurai.getDiagnostics().workers).length===1);
 assert.equal(await page.evaluate(()=>window.samurai.getState().jump.count),2);
 assert.equal(await page.evaluate(()=>window.samurai.getState().person),'tracking');
 assert.equal(await page.evaluate(()=>window.samurai.getState().performance.detailsPaused),true);
 assert.equal(await page.locator('#face-calibrate').isEnabled(),false);
 assert.match(await page.locator('#hands-state').textContent(),/en pausa/);
 await page.evaluate(()=>{window.motionFixture.delay=8;});
 await page.locator('#quality-select').selectOption('dance');
 await page.waitForFunction(()=>window.samurai.getState().hands>0&&window.samurai.getState().face===478);
 assert.equal(await page.evaluate(()=>window.samurai.getState().jump.count),2);
 assert.equal(await page.evaluate(()=>window.samurai.getState().performance.detailsPaused),false);
 await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.testReport=text;}}});});
 await page.locator('#diagnostics-button').click();
 assert.match(await page.evaluate(()=>window.testReport),/Detector corporal: CPU/);
 await page.waitForFunction(()=>window.samurai.getState().person==='tracking'&&window.samurai.getState().hips===2);
 // Salida real y regreso en otra posición/distancia, sin recrear cámara ni modelo.
 const modelsBefore=await page.evaluate(()=>window.motionFixture.models.length);
 await page.evaluate(()=>window.motionFixture.absent=true);
 await page.waitForFunction(()=>window.samurai.getState().person==='holding'&&window.samurai.getState().body===0);
 await page.waitForTimeout(1200);
 await page.evaluate(()=>{window.motionFixture.absent=false;window.motionFixture.stranger=true;window.motionFixture.offsetX=.27;window.motionFixture.scale=.45;});
 await page.waitForTimeout(350);
 assert.equal(await page.evaluate(()=>window.samurai.getState().person),'holding');
 await page.evaluate(()=>window.motionFixture.stranger=false);
 await page.waitForFunction(()=>window.samurai.getState().person==='tracking'&&window.samurai.getState().hips===2&&window.samurai.getState().jump.calibrated);
 assert.equal(await page.evaluate(()=>window.motionFixture.models.length),modelsBefore);
 assert.equal(await page.evaluate(()=>window.samurai.getState().jump.count),2);
 assert.equal(await page.evaluate(()=>window.samurai.getState().mode),'camera');
 await page.screenshot({path:path.join(import.meta.dirname,'.cache/web-dance-auto.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('SALTO + SALIR/VOLVER SIN APAGAR CÁMARA + PERSONA FIJADA + MODOS + DIAGNÓSTICO + ENCUADRE OK');
}finally{await browser.close();await cleanup();}
