import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]||'http://127.0.0.1:5181/');await page.waitForFunction(()=>!!window.samurai);
 const data=await page.evaluate(async()=>{
  const {createAvatar}=await import('/src/avatar.js'),{danceMotion,DURATION}=await import('/src/dance.js');
  const host=document.createElement('div');Object.assign(host.style,{width:'800px',height:'500px'});document.body.append(host);
  const avatar=await createAvatar(host);avatar.setDanceStage(true,false);
  for(let t=0;t<DURATION;t+=.15){avatar.setDanceTarget(danceMotion(t));avatar.update(danceMotion(t),1/30);}
  const stage=avatar.getDanceStage(),calls=avatar.getRenderer().info.render.calls;
  avatar.setDanceStage(false);
  return {stage,calls,restored:avatar.getDanceStage(),bones:avatar.getSkeleton().bones.length};
 });
 assert.equal(data.stage.sharedGeometry,true);assert.equal(data.stage.coachBones,64);assert.equal(data.restored.visible,false);assert.ok(data.calls<=20);assert.deepEqual(errors,[]);
 await page.goto((process.argv[2]||'http://127.0.0.1:5181/')+'?modo=baile');await page.waitForFunction(()=>!!window.samurai);
 assert.equal(await page.locator('#dance-panel').isVisible(),true);
 await page.setViewportSize({width:390,height:844});await page.locator('#dance-sound').uncheck();await page.getByRole('button',{name:'Ver coreografía',exact:true}).click();await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>window.samurai.getState().dance.stage.sharedGeometry),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:new URL('.cache/dance-mobile.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
 console.log(JSON.stringify({...data,deepLink:true,mobile:true,errors}));
}finally{await browser.close();}
