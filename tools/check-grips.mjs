import {chromium} from '@playwright/test';
import path from 'node:path';
import {prepareFixtures} from './prepare-fixtures.mjs';

const cleanup=await prepareFixtures(['fist.jpg','thumb_up.jpg','pointing_up.jpg','right_hands.jpg']);
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:900,height:750}});
 await page.goto('http://127.0.0.1:5173/');
 const output=await page.evaluate(async()=>{
  const {Retargeter}=await import('/src/tracking.js');
  const {createAvatar}=await import('/src/avatar.js');
  const {Vector3}=await import('/tools/node_modules/three/build/three.module.js');
  const samples=[];
  for(const [name,mirror,crop] of [['fist.jpg',false,false],['fist.jpg',true,false],['thumb_up.jpg',false,false],['pointing_up.jpg',false,false],['right_hands.jpg',false,false],['fist.jpg',false,true]]){
   const worker=new Worker('/vision.worker.js');
   const next=type=>new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Timeout '+type)),20000);
    worker.onmessage=({data})=>{
     if(data.type===type){clearTimeout(timeout);resolve(data);}
     else if(data.type==='error'||data.type==='frame-error'){clearTimeout(timeout);reject(Error(data.message));}
    };
   });
   try{
    const ready=next('ready');worker.postMessage({type:'init',kind:'hands',cpu:true});await ready;
    let bitmap=await createImageBitmap(await (await fetch('/tools/.cache/fixtures/'+name)).blob());
    if(mirror){
     const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');
     ctx.translate(bitmap.width,0);ctx.scale(-1,1);ctx.drawImage(bitmap,0,0);bitmap.close();bitmap=await createImageBitmap(canvas);
    }
    let width=bitmap.width,height=bitmap.height;
    const roi=crop?{x:.2,y:.1,width:.5,height:.7}:null;
    if(crop){
     const frame=new OffscreenCanvas(960,640),ctx=frame.getContext('2d');
     ctx.fillStyle='#b1b1b1';ctx.fillRect(0,0,960,640);
     ctx.drawImage(bitmap,roi.x*960,roi.y*640,roi.width*960,roi.height*640);bitmap.close();
     bitmap=await createImageBitmap(frame,roi.x*960,roi.y*640,roi.width*960,roi.height*640);
     width=960;height=640;
    }
    const result=next('result');
    worker.postMessage({type:'frame',bitmap,time:1000,epoch:1,crop:roi},[bitmap]);
    const {data}=await result;
    const side=mirror?'left':'right';
    if(name==='fist.jpg'&&data.handedness[0]?.[0]?.categoryName.toLowerCase()!==side)throw Error('La mano cambió de brazo en el worker');
    const tracker=new Retargeter();
    for(let i=0;i<16;i++)tracker.updateDetails({hands:data},1000+i*40,width,height);
    const shape=tracker.motion.hands[side];
    if(!tracker.motion.handVisible[side])throw Error('No se aceptó la mano: '+name);
    if(name==='fist.jpg'){
     if(data.gestures[0]?.[0]?.categoryName!=='Closed_Fist'||shape.gesture!=='Closed_Fist')throw Error('Puño sin reconocer');
     for(let finger=1;finger<5;finger++)if(shape.parameters[finger*4+1]<1||shape.points[finger*4+4][1]<-.23)throw Error('Puño con dedos abiertos');
     if(Math.abs(shape.points[4][0])>.05)throw Error('Pulgar sin oposición sobre la palma');
     // La foto muestra el interior del puño hacia la cámara. +Z palmar debe
     // apuntar al frente en ambos lados, sin invertir la mano reflejada.
     if(shape.basis[2][2]<.8)throw Error('Palma invertida');
    }
    if(name==='thumb_up.jpg'&&shape.gesture!=='Thumb_Up')throw Error('Pulgar sin reconocer');
    if(name==='pointing_up.jpg'){
     if(shape.parameters[5]>.15||shape.parameters[6]>.2||shape.parameters[9]<1)throw Error('Índice mezclado con dedos cerrados');
    }
    if(name==='right_hands.jpg')for(let finger=1;finger<5;finger++){
     if(shape.parameters[finger*4+2]>.14||shape.parameters[finger*4+3]>.14)throw Error('Palma abierta con falanges encogidas');
    }
    if(crop){
     const wrist=tracker.handWrists[side];
     if(wrist.x<roi.x||wrist.x>roi.x+roi.width||wrist.y<roi.y||wrist.y>roi.y+roi.height)throw Error('Muñeca recortada sin transformar');
    }
    samples.push({name,mirror,crop,data,motion:structuredClone(tracker.motion),side});
   }finally{worker.terminate();}
  }
  const host=document.createElement('div');host.id='grip-preview';
  Object.assign(host.style,{position:'fixed',inset:'0 auto auto 0',width:'720px',height:'640px',zIndex:1000});document.body.append(host);
  const avatar=await createAvatar(host);
  const show=index=>{
   const sample=samples[index],m=sample.motion,side=sample.side;
   m.directions[side+'_upper']=[side==='left'?-.5:.5,.5,.5];
   m.directions[side+'_fore']=m.hands[side].basis[1].map(x=>-x);
   avatar.setView('hands');
   for(let i=0;i<70;i++)avatar.update(m,1/60);
   const group=avatar.getGroups()[side+'_hand'];
   const normal=new Vector3().setFromMatrixColumn(group.matrixWorld,2);
   if(sample.name==='fist.jpg'&&normal.z<.8)throw Error('El rig invirtió la palma');
   const expected=new Vector3(0,-.43,0).applyMatrix4(avatar.getGroups()[side+'_fore'].matrixWorld);
   if(new Vector3().setFromMatrixPosition(group.matrixWorld).distanceTo(expected)>1e-7)throw Error('Puño separado del antebrazo');
  };
  window.gripTest={show};show(1);show(0);
  return samples.map(s=>({name:s.name,mirror:s.mirror,crop:s.crop,hands:s.data.landmarks.length,gesture:s.motion.hands[s.side].gesture,
   thumbX:Number(s.motion.hands[s.side].points[4][0].toFixed(3)),palmZ:Number(s.motion.hands[s.side].basis[2][2].toFixed(3))}));
 });
 console.log('GRIPS',JSON.stringify(output));
 await page.locator('#grip-preview').screenshot({path:path.join(import.meta.dirname,'.cache/fist-fixed.png')});
 await page.evaluate(()=>window.gripTest.show(4));
 await page.locator('#grip-preview').screenshot({path:path.join(import.meta.dirname,'.cache/palm-fixed.png')});
 console.log('FIST + MIRROR + THUMB + INDEX + WRIST QA OK');
}finally{await browser?.close();await cleanup();}
