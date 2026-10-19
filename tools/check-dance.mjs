import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
try{
 const page=await browser.newPage({viewport:{width:1300,height:1000},permissions:['camera']}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.danceFixture={absent:false,init:[],delay:30};
  class FixtureWorker{
   postMessage(message){
    const f=window.danceFixture;
    if(message.type==='init'){this.kind=message.kind;f.init.push({kind:this.kind,quality:message.quality});setTimeout(()=>this.onmessage?.({data:{type:'ready',delegate:'CPU',benchmarking:false,connections:[]}}),0);return;}
    if(message.type!=='frame')return;message.bitmap.close();
    import('/src/dance.js').then(({danceMotion})=>{
     const time=window.samurai.getState().dance?.time||0,m=danceMotion(time),d=m.directions;
     const p=Array.from({length:33},()=>({x:.5,y:.4,z:0,visibility:.95,presence:1})),w=p.map(()=>({x:0,y:0,z:0}));
     const coords={0:[0,.78,0]},add=(a,b,k)=>a.map((x,i)=>x+b[i]*k);
     for(const [side,sign,s,e,hand,hip] of [['left',-1,11,13,15,23],['right',1,12,14,16,24]]){
      const x=sign*.2,roll=m.roll;
      coords[s]=[x*Math.cos(roll),.52+x*Math.sin(roll),0];
      coords[e]=add(coords[s],d[side+'_upper'],.32);coords[hand]=add(coords[e],d[side+'_fore'],.28);
      coords[hip]=[sign*.12,0,0];coords[hip+2]=add(coords[hip],d[side+'_thigh'],.43);coords[hip+4]=add(coords[hip+2],d[side+'_shin'],.43);
      coords[hip+6]=add(coords[hip+4],[0,0,1],-.03);coords[hip+8]=add(coords[hip+4],[0,0,1],.14);
     }
     for(const [i,c] of Object.entries(coords)){w[i]={x:-c[0],y:-c[1],z:-c[2]};p[i]={x:.5-c[0]*.35,y:.44-c[1]*.35,z:-c[2]*.35/(4/3),visibility:.95,presence:1};}
     const data=f.absent?{landmarks:[],worldLandmarks:[],appearances:[]}:{landmarks:[p],worldLandmarks:[w],appearances:[{rgb:[.6,.3,.2],brightness:.5}]};
     setTimeout(()=>{if(!this.closed)this.onmessage?.({data:{type:'result',data,time:message.time,epoch:message.epoch,duration:f.delay}});},f.delay);
    });
   }
   terminate(){this.closed=true;}
  }
  window.Worker=FixtureWorker;
 });
 await page.goto(process.argv[2]||'http://127.0.0.1:5181/');await page.waitForFunction(()=>!!window.samurai);
 await page.getByRole('button',{name:'Modo baile ↗',exact:true}).click();
 await page.getByRole('button',{name:'Ver coreografía',exact:true}).click();
 await page.waitForFunction(()=>window.samurai.getState().dance?.time>.8);
 assert.equal(await page.evaluate(()=>window.samurai.getState().mode),'idle');
 assert.equal(await page.evaluate(()=>window.samurai.getState().dance.score),0);
 await page.getByRole('button',{name:'Pausar',exact:true}).click();
 const held=await page.evaluate(()=>window.samurai.getState().dance.time);await page.waitForTimeout(350);
 assert.equal(await page.evaluate(()=>window.samurai.getState().dance.time),held);
 await page.getByRole('button',{name:'Continuar',exact:true}).click();
 await page.waitForFunction(time=>window.samurai.getState().dance.time>time+.3,held);
 await page.screenshot({path:path.join(import.meta.dirname,'.cache/dance-preview.png'),fullPage:true});
 await page.getByRole('button',{name:'Jugar con cámara',exact:true}).click();
 await page.waitForFunction(()=>window.samurai.getState().dance.state==='playing',null,{timeout:20000});
 await page.waitForFunction(()=>window.samurai.getState().dance.score>150,null,{timeout:10000});
 assert.deepEqual(await page.evaluate(()=>window.danceFixture.init),[{kind:'pose',quality:'lite'}]);
 assert.equal(await page.locator('#avatar canvas').count(),1);
 await page.screenshot({path:path.join(import.meta.dirname,'.cache/dance-playing.png'),fullPage:true});
 await page.evaluate(()=>window.danceFixture.absent=true);
 await page.waitForFunction(()=>window.samurai.getState().dance.state==='paused');
 const paused=await page.evaluate(()=>window.samurai.getState().dance.time);await page.waitForTimeout(500);
 assert.equal(await page.evaluate(()=>window.samurai.getState().dance.time),paused);
 await page.evaluate(()=>window.danceFixture.absent=false);
 await page.waitForFunction(()=>window.samurai.getState().dance.state==='playing',null,{timeout:15000});
 await page.waitForFunction(()=>window.samurai.getState().dance.state==='finished',null,{timeout:50000});
 const result=await page.evaluate(()=>window.samurai.getState().dance);
 assert.ok(result.score>6500,JSON.stringify(result));assert.ok(result.judged>50);assert.ok(result.bestCombo>10);
 await page.locator('#dance-results').waitFor({state:'visible'});
 await page.screenshot({path:path.join(import.meta.dirname,'.cache/dance-result.png'),fullPage:true});
 await page.getByRole('button',{name:'Volver al estudio',exact:true}).click();
 assert.equal(await page.locator('#dance-panel').isVisible(),false);
 assert.equal(await page.locator('.settings').isVisible(),true);
 await page.getByRole('button',{name:'Apagar cámara',exact:true}).click();
 const mobile=await browser.newPage({viewport:{width:390,height:844}});mobile.on('pageerror',e=>errors.push(e.message));
 await mobile.goto(process.argv[2]||'http://127.0.0.1:5181/');await mobile.waitForFunction(()=>!!window.samurai);
 await mobile.getByRole('button',{name:'Modo baile ↗',exact:true}).click();
 await mobile.locator('#dance-sound').uncheck();await mobile.getByRole('button',{name:'Ver coreografía',exact:true}).click();
 await mobile.waitForTimeout(400);
 assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Desbordamiento móvil');
 await mobile.screenshot({path:path.join(import.meta.dirname,'.cache/dance-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 const report={previewScore:0,bodyLossPause:true,returnWithoutCameraRestart:true,completed:result,detector:'Pose Lite only (fixture)',canvas:1,mobileOverflow:false,errors};
 await fs.writeFile(path.join(import.meta.dirname,'.cache/dance-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
