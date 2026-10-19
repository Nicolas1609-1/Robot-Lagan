import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {prepareFixtures} from './prepare-fixtures.mjs';
const origin=process.argv[2]||'http://127.0.0.1:5181/';
const cleanup=await prepareFixtures(['pose.jpg','portrait.jpg','right_hands.jpg']);
let browser;
try{
 const fixtures=Object.fromEntries(await Promise.all(['pose.jpg','portrait.jpg','right_hands.jpg'].map(async name=>[name,(await fs.readFile(path.join(import.meta.dirname,'.cache/fixtures',name))).toString('base64')])));
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage();
 await page.route('**/__compute-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Comparación CPU GPU</title>'}));
 await page.goto(new URL('/__compute-test',origin).href);
 const result=await page.evaluate(async fixtures=>{
  const rows=[];
  for(const [kind,name,retry] of [['pose','pose.jpg'],['hands','right_hands.jpg'],['face','portrait.jpg'],['face','pose.jpg',true]]){
   const worker=new Worker('/vision.worker.js');let selected,needed=false,selections=0;
   worker.addEventListener('message',({data})=>{if(data.type==='delegate-selected'){selected=data;selections++;}if(data.type==='benchmark-needed')needed=true;});
   const next=type=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{worker.removeEventListener('message',handler);reject(Error('Tiempo agotado '+kind+' '+type));},45000);
    const handler=({data})=>{
     if(data.type===type){clearTimeout(timer);worker.removeEventListener('message',handler);resolve(data);}
     else if(data.type==='error'||data.type==='frame-error'){clearTimeout(timer);worker.removeEventListener('message',handler);reject(Error(data.message));}
    };worker.addEventListener('message',handler);
   });
   try{
    const ready=next('ready');worker.postMessage({type:'init',kind,quality:'lite'});const init=await ready;
    const image=new Image();image.src='data:image/jpeg;base64,'+fixtures[name];await image.decode();
    let last;
    for(let i=0;i<8;i++){
     const bitmap=await createImageBitmap(image),response=next('result');
     worker.postMessage({type:'frame',bitmap,time:i*100+100,epoch:1},[bitmap]);last=await response;
    }
    if(retry){
     image.src='data:image/jpeg;base64,'+fixtures['portrait.jpg'];await image.decode();
     const bitmap=await createImageBitmap(image),response=next('result');worker.postMessage({type:'frame',bitmap,time:1000,epoch:1},[bitmap]);last=await response;
     if(init.benchmarking){
      if(!needed)throw Error('No solicitó comparar con rostro presente');
      const started=next('delegate-comparing');worker.postMessage({type:'compare-subject'});await started;
      for(let i=0;i<8;i++){
       const bitmap=await createImageBitmap(image),response=next('result');worker.postMessage({type:'frame',bitmap,time:1100+i*100,epoch:1},[bitmap]);last=await response;
      }
      if(selections!==2)throw Error('No completó la segunda selección');
     }
    }
    const points=kind==='face'?last.data.faceLandmarks?.[0]?.length||0:last.data.landmarks?.[0]?.length||0;
    if(init.benchmarking&&!selected)throw Error('No completó la selección '+kind);
    rows.push({kind,initial:init.delegate,compared:init.benchmarking,selected:selected?.delegate||init.delegate,compute:selected?.compute||null,points,retry:!!retry,selections});
   }finally{worker.terminate();}
  }
  return rows;
 },fixtures);
 for(const row of result){assert.equal(row.points,row.kind==='pose'?33:row.kind==='hands'?21:478);if(row.compared){assert.ok(row.compute.CPU>0&&row.compute.GPU>0);}}
 await fs.writeFile(path.join(import.meta.dirname,'.cache/compute-real.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}finally{await browser?.close();await cleanup();}
