import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1000,height:850}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]||'http://127.0.0.1:5181/');await page.waitForFunction(()=>!!window.samurai);
 const report=await page.evaluate(async()=>{
  const {createAvatar}=await import('/src/avatar.js'),{Retargeter}=await import('/src/tracking.js');
  const {lowerBody,prayer}=await import('/tools/motion-fixtures.mjs');
  const {Vector3,Quaternion}=await import('/tools/node_modules/three/build/three.module.js');
  const host=document.createElement('div');host.id='contacts-preview';Object.assign(host.style,{position:'fixed',inset:'0 auto auto 0',width:'720px',height:'800px',zIndex:1000});document.body.append(host);
  const avatar=await createAvatar(host),tracker=new Retargeter();let time=0;
  const cases={reposo:lowerBody(),patada:lowerBody({leftHip:1.9,leftKnee:.12,leftFoot:[0,.95,.3]}),
   arrodillado:lowerBody({leftHip:.1,rightHip:.1,leftKnee:1.65,rightKnee:1.65,leftFoot:[0,0,-1],rightFoot:[0,0,-1]}),
   flexion_profunda:lowerBody({leftHip:.2,rightHip:.2,leftKnee:2.65,rightKnee:2.65,leftFoot:[0,.77,-.64],rightFoot:[0,.77,-.64]}),
   oracion:prayer(),oracion_giro:prayer(1,{yaw:.7}),oracion_detalles:{...prayer(),handTurn:.5}};
  const step=sample=>{
   if(sample.handTurn!==undefined)for(const [side,sign] of [['left',1],['right',-1]]){
    tracker.motion.handVisible[side]=true;tracker.motion.handBlend[side]=1;tracker.seen[side+'_hand']=time;
    tracker.motion.hands[side].basis=[[0,0,sign],[0,-1,0],[sign,0,0]].map(axis=>new Vector3(...axis).applyAxisAngle(new Vector3(0,1,0),sample.handTurn).toArray());
   }
   const m=tracker.updatePose(sample.result,time,640,480);time+=1000/30;avatar.update(m,1/60);avatar.update(m,1/60);
  };
  const show=name=>{for(let i=0;i<80;i++)step(cases[name]);avatar.setView('front');avatar.getCamera().position.set(name.startsWith('oracion')?2:3,2.1,5);avatar.update(tracker.motion,1/60);};
  const rows=[];
  for(const [name,sample] of Object.entries(cases)){
   show(name);const j=avatar.getJoints();
   if(name.startsWith('oracion')){
    const palms=['left','right'].map(side=>new Vector3(0,-.09,.038).applyMatrix4(j[side+'_hand'].matrixWorld));
    const gap=palms[0].distanceTo(palms[1]);if(gap>.045)throw Error(name+': separación de palmas '+JSON.stringify({gap,palms:palms.map(p=>p.toArray()),wrists:['left','right'].map(side=>j[side+'_hand'].getWorldPosition(new Vector3()).toArray()),arms:avatar.getArmState(),contact:tracker.motion.armContact}));
    const normals=['left','right'].map(side=>new Vector3(0,0,1).applyQuaternion(j[side+'_hand'].getWorldQuaternion(new Quaternion())));
    if(normals[0].dot(normals[1])>-.9)throw Error(name+': palmas no enfrentadas');
    rows.push({name,palmGap:gap,normalDot:normals[0].dot(normals[1]),contact:tracker.motion.armContact});
   }else{
    let error=0;
    for(const side of ['left','right'])for(const part of ['thigh','shin']){
     const actual=new Vector3(0,-1,0).applyQuaternion(j[side+'_'+part].getWorldQuaternion(new Quaternion()));
     error=Math.max(error,actual.angleTo(new Vector3(...sample.directions[side][part])));
    }
    if(error>.12)throw Error(name+': dirección de pierna '+error);
    const mesh=avatar.getSkin();let kneeFloor=Infinity;
    for(const part of mesh.userData.parts.filter(p=>/_knee_(?:cap|axle_)/.test(p.name)))for(let i=part.start;i<part.start+part.count;i++)kneeFloor=Math.min(kneeFloor,mesh.getVertexPosition(i,new Vector3()).applyMatrix4(mesh.matrixWorld).y);
    if(kneeFloor<-.07)throw Error(name+': rodilla bajo el suelo '+kneeFloor);
    rows.push({name,error,kneeFloor,legs:avatar.getLegState()});
   }
  }
  let maxRotation=0,previous={};
  for(let i=0;i<120;i++){
   const t=i/119,hip=Math.sin(t*Math.PI)*1.95,knee=.12+Math.sin(t*Math.PI)*.2;
   step(lowerBody({leftHip:hip,leftKnee:knee,leftFoot:[0,Math.sin(hip),Math.cos(hip)]}));
   for(const part of ['thigh','shin','foot']){
    const q=avatar.getJoints()['left_'+part].getWorldQuaternion(new Quaternion());
    if(previous[part]&&i>10)maxRotation=Math.max(maxRotation,q.angleTo(previous[part]));previous[part]=q;
   }
  }
  if(maxRotation>.30)throw Error('Salto de rotación en patada: '+maxRotation);
  for(let i=0;i<60;i++)step(prayer(1-i/59));
  if(tracker.motion.armContact!==null)throw Error('Contacto pegado después de separar manos');
  window.contactTest={show};show('oracion');
  return {cases:rows,maxKickRotation:maxRotation,bones:avatar.getSkeleton().bones.length,calls:avatar.getRenderer().info.render.calls};
 });
 for(const name of ['patada','arrodillado','flexion_profunda','oracion','oracion_giro']){
  await page.evaluate(name=>window.contactTest.show(name),name);
  await page.locator('#contacts-preview').screenshot({path:path.join(import.meta.dirname,'.cache/'+name+'.png')});
 }
 assert.deepEqual(errors,[]);assert.equal(report.bones,64);assert.ok(report.calls<=12);
 await fs.writeFile(path.join(import.meta.dirname,'.cache/contacts.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{await browser.close();}
