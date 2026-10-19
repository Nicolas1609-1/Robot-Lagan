import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '@playwright/test';
const cache=path.join(import.meta.dirname,'.cache');
const fixtures=path.join(cache,'fixtures');
export async function prepareFixtures(names,{video=false}={}){
 const files=names.map(name=>path.join(fixtures,name));
 const movie=path.join(cache,'pose.y4m');
 await fs.mkdir(fixtures,{recursive:true});
 try{
  await Promise.all(names.map(async name=>{
   const response=await fetch('https://storage.googleapis.com/mediapipe-assets/'+name);
   if(!response.ok)throw Error(name+': HTTP '+response.status);
   await fs.writeFile(path.join(fixtures,name),new Uint8Array(await response.arrayBuffer()));
  }));
  if(video){
   const browser=await chromium.launch({channel:'chrome',headless:true});
   let rgba;
   try{
    const page=await browser.newPage();
    const bytes=await fs.readFile(path.join(fixtures,'pose.jpg'));
    rgba=await page.evaluate(async base64=>{
     const image=new Image();image.src='data:image/jpeg;base64,'+base64;await image.decode();
     const canvas=document.createElement('canvas');canvas.width=960;canvas.height=640;
     const context=canvas.getContext('2d');context.drawImage(image,0,0,960,640);
     return Array.from(context.getImageData(0,0,960,640).data);
    },bytes.toString('base64'));
   }finally{await browser.close();}
   const width=960,height=640,size=width*height;
   const frame=Buffer.alloc(size*1.5),byte=x=>Math.max(0,Math.min(255,Math.round(x)));
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,j=i*4,r=rgba[j],g=rgba[j+1],b=rgba[j+2];
    frame[i]=byte(16+.257*r+.504*g+.098*b);
    if(!(x%2)&&!(y%2)){
     let u=0,v=0;
     for(const offset of [0,4,width*4,width*4+4]){
      const a=rgba[j+offset],c=rgba[j+offset+1],d=rgba[j+offset+2];
      u+=128-.148*a-.291*c+.439*d;v+=128+.439*a-.368*c-.071*d;
     }
     const k=(y/2)*(width/2)+x/2;
     frame[size+k]=byte(u/4);frame[size+size/4+k]=byte(v/4);
    }
   }
   const output=await fs.open(movie,'w');
   try{
    await output.write(Buffer.from('YUV4MPEG2 W960 H640 F30:1 Ip A1:1 C420jpeg\n'));
    for(let i=0;i<10;i++){await output.write(Buffer.from('FRAME\n'));await output.write(frame);}
   }finally{await output.close();}
  }
 }catch(error){await cleanup();throw error;}
 async function cleanup(){
  for(const file of [...files,...(video?[movie]:[])])await fs.rm(file,{force:true});
  await fs.rmdir(fixtures).catch(error=>{if(error.code!=='ENOENT'&&error.code!=='ENOTEMPTY')throw error;});
 }
 return cleanup;
}
