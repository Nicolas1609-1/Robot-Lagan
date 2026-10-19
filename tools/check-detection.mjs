import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {prepareFixtures} from './prepare-fixtures.mjs';
import {PersonLock} from '../src/person.js';
import {Retargeter} from '../src/tracking.js';

// Foto de prueba oficial, nunca la cámara de una persona. Las variantes miden
// distancia, exposición y desenfoque; no representan todos los dispositivos.
const origin=process.argv[2]||'http://127.0.0.1:5173/';
const sourcePath=path.resolve(process.argv[3]||path.join(import.meta.dirname,'../public/vision.worker.js'));
const output=process.argv[4]||path.join(import.meta.dirname,'.cache/detection.json');
const cleanup=await prepareFixtures(['pose.jpg']);
let browser;
try{
 const bytes=await fs.readFile(path.join(import.meta.dirname,'.cache/fixtures/pose.jpg'));
 const source=await fs.readFile(sourcePath,'utf8');
 const workerSource=source.replace("const versioned=url=>url+'?v='+ASSET_VERSION;",`const versioned=url=>new URL(url,${JSON.stringify(origin)}).href+'?v='+ASSET_VERSION;`)
  .replace("forVisionTasks('/vendor/wasm')",`forVisionTasks(${JSON.stringify(new URL('/vendor/wasm',origin).href)})`);
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage();
 await page.route('**/__detection-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Prueba de detección</title>'}));
 await page.goto(new URL('/__detection-test',origin).href);
 const rows=await page.evaluate(async({workerSource,base64})=>{
  const image=new Image();image.src='data:image/jpeg;base64,'+base64;await image.decode();
  const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})),worker=new Worker(url);
  function request(message,transfer=[]){
   return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{worker.removeEventListener('message',handler);reject(Error('Tiempo agotado: '+message.type));},45000);
    function handler({data}){
     if(data.type==='error'||data.type==='frame-error'){clearTimeout(timer);worker.removeEventListener('message',handler);reject(Error(data.message));}
     else if(['ready','result','configured'].includes(data.type)){clearTimeout(timer);worker.removeEventListener('message',handler);resolve(data);}
    }
    worker.addEventListener('message',handler);worker.postMessage(message,transfer);
   });
  }
  const cases=[{name:'original'},{name:'lejos',scale:.5},{name:'muy_lejos',scale:.35},{name:'límite_distancia',scale:.25},
   {name:'poca_luz',brightness:.35},{name:'luz_muy_baja',brightness:.18},
   {name:'lejos_y_poca_luz',scale:.5,brightness:.35},{name:'desenfoque',blur:1.8},{name:'sin_persona',empty:true}];
  const rows=[];
  try{
   for(const c of cases){
    await request({type:'init',kind:'pose',quality:'lite',cpu:true,sensitivity:'normal'});
    const canvas=new OffscreenCanvas(640,426),ctx=canvas.getContext('2d');
    ctx.fillStyle='#666';ctx.fillRect(0,0,640,426);
    const scale=c.scale||1,w=640*scale,h=426*scale;
    ctx.filter=`brightness(${c.brightness||1}) blur(${c.blur||0}px)`;
    if(!c.empty)ctx.drawImage(image,(640-w)/2,(426-h)/2,w,h);
    const samples=[];
    for(let frame=0;frame<4;frame++){
     const bitmap=await createImageBitmap(canvas),time=100+frame*650;
     const result=await request({type:'frame',bitmap,time,epoch:0},[bitmap]);
     samples.push({time,data:result.data,duration:result.duration});
    }
    rows.push({name:c.name,samples});
   }
   // setOptions cambia umbrales dentro del mismo worker, sin interrumpir cámara.
   if(workerSource.includes("message.type==='configure'")){
    const changed=await request({type:'configure',sensitivity:'high'});
    const bitmap=await createImageBitmap(image),sample=await request({type:'frame',bitmap,time:3000,epoch:0},[bitmap]);
    rows.push({name:'configuración_alta',configured:changed.sensitivity,raw:sample.data.landmarks?.[0]?.length||0});
   }
  }finally{worker.terminate();URL.revokeObjectURL(url);}
  return rows;
 },{workerSource,base64:bytes.toString('base64')});
 const report={origin,source:path.basename(sourcePath),sampleInterval:650,rows:[]};
 for(const row of rows){
  if(!row.samples){assert.equal(row.configured,'high');assert.equal(row.raw,33);report.rows.push(row);continue;}
  const lock=new PersonLock(),tracker=new Retargeter();
  const samples=row.samples.map(({data,time,duration})=>{
   const motion=tracker.updatePose(lock.select(data,time),time,640,426);
   return {raw:data.landmarks?.[0]?.filter(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1&&(p.visibility??1)>=.3&&(p.presence??1)>=.35).length||0,
    accepted:motion.visible.size,legs:motion.legCounts,person:lock.state,reason:lock.reason,duration:Number(duration.toFixed(1))};
  });
  if(row.name==='sin_persona')assert.ok(samples.every(s=>s.raw===0&&s.accepted===0));
  if(['original','lejos','poca_luz','lejos_y_poca_luz','desenfoque'].includes(row.name)){
   assert.equal(samples.at(-1).accepted,33,row.name+': el cliente descartó puntos medidos');
   assert.deepEqual(samples.at(-1).legs,[5,5]);
  }
  report.rows.push({name:row.name,samples});
  console.log(JSON.stringify({name:row.name,...samples.at(-1)}));
 }
 await fs.writeFile(output,JSON.stringify(report,null,2));
}finally{await browser?.close();await cleanup();}
