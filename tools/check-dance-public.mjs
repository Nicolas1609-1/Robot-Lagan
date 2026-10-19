import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
const origin=process.argv[2]||'https://lagan.nicolas16.life/';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1300,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(new URL('?modo=baile',origin).href);await page.waitForFunction(()=>!!window.samurai);
 await page.locator('#dance-panel').waitFor({state:'visible'});
 await page.locator('#dance-sound').uncheck();await page.getByRole('button',{name:'Ver coreografía',exact:true}).click();
 await page.waitForFunction(()=>window.samurai.getState().dance.time>.6);
 const s=await page.evaluate(()=>window.samurai.getState());
 assert.equal(s.mode,'idle');assert.equal(s.dance.practice,true);assert.equal(s.dance.score,0);
 assert.equal(s.dance.stage.sharedGeometry,true);assert.equal(s.dance.stage.coachBones,64);assert.equal(await page.locator('#avatar canvas').count(),1);
 await page.getByRole('button',{name:'Pausar',exact:true}).click();
 const held=await page.evaluate(()=>window.samurai.getState().dance.time);await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>window.samurai.getState().dance.time),held);
 await page.getByRole('button',{name:'Continuar',exact:true}).click();
 await page.waitForFunction(time=>window.samurai.getState().dance.time>time+.2,held);
 await page.screenshot({path:path.join(import.meta.dirname,'.cache/dance-public.png'),fullPage:true});
 await page.getByRole('button',{name:'Volver al estudio',exact:true}).click();assert.equal(await page.locator('.settings').isVisible(),true);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({url:new URL('?modo=baile',origin).href,preview:true,score:0,sharedGeometry:true,coachBones:64,pauseResume:true,studioReturn:true,errors}));
}finally{await browser.close();}
