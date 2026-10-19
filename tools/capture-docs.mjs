// Capturas de la interfaz real, sin usar la cámara ni publicar imágenes personales.
// Ejecutar con Vite activo: node capture-docs.mjs http://127.0.0.1:5181/
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const origin=new URL(process.argv[2]||'http://127.0.0.1:5181/');
assert(['127.0.0.1','localhost'].includes(origin.hostname),'Usa un servidor local de desarrollo.');
const output=path.join(import.meta.dirname,'docs/images');
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1120},deviceScaleFactor:1});
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw Error('Las capturas de documentación no usan cámara.');};
 });
 await page.goto(origin.href);
 await page.waitForFunction(()=>!!window.samurai);
 await page.getByRole('button',{name:'Probar demo 3D',exact:true}).click();
 await page.waitForFunction(()=>window.samurai.getState().mode==='demo');
 await page.waitForTimeout(1200);
 await page.screenshot({path:path.join(output,'estudio.png'),fullPage:true});

 // Vistas de un mismo movimiento programado: ayudan a estudiar el rig,
 // pero no representan puntos medidos de una persona.
 await page.evaluate(async()=>{
  const {createAvatar,demoMotion}=await import('/src/avatar.js');
  const host=document.createElement('div');host.id='docs-model';
  Object.assign(host.style,{position:'fixed',inset:'0',width:'900px',height:'800px',zIndex:'10000'});
  document.body.append(host);
  const avatar=await createAvatar(host);avatar.setRenderScale(1);
  window.docsModel={show(view,skeleton=false,time=2){
   avatar.setSkeleton(skeleton);avatar.setView(view);
   for(let i=0;i<180;i++)avatar.update(demoMotion(time),1/60);
  }};
 });
 const model=page.locator('#docs-model');
 for(const [name,view,skeleton,time] of [
  ['robot','front',false,2],['esqueleto','front',true,2],['mano','hands',false,4]
 ]){
  await page.evaluate(args=>window.docsModel.show(...args),[view,skeleton,time]);
  await model.locator('canvas').screenshot({path:path.join(output,name+'.png')});
 }
 // Otra página mantiene la captura de baile independiente de las vistas del rig.
 await page.goto(new URL('?modo=baile',origin).href);
 await page.waitForFunction(()=>!!window.samurai);
 await page.locator('#dance-sound').uncheck();
 await page.getByRole('button',{name:'Ver coreografía',exact:true}).click();
 await page.waitForFunction(()=>window.samurai.getState().dance.time>1);
 await page.getByRole('button',{name:'Pausar',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.samurai.getState().dance.score),0);
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:path.join(output,'baile.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({output,images:['estudio','robot','esqueleto','mano','baile'],camera:false,errors}));
}finally{await browser.close();}
