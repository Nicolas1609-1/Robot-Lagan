import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]||'http://127.0.0.1:5173/');await page.waitForFunction(()=>!!window.samurai);
 const result=await page.evaluate(async()=>{
  const {createAvatar}=await import('/src/avatar.js'),{Retargeter}=await import('/src/tracking.js');
  const {punch}=await import('/tools/motion-fixtures.mjs'),{relaxedHand}=await import('/src/hands.js');
  const {Vector3,Quaternion}=await import('/tools/node_modules/three/build/three.module.js');
  const host=document.createElement('div');host.id='boxing-preview';
  Object.assign(host.style,{position:'fixed',inset:'0 auto auto 0',width:'720px',height:'780px',zIndex:1000});document.body.append(host);
  const avatar=await createAvatar(host),tracker=new Retargeter();let time=0,worst=0,peak=0;
  function update(progress,options){
   const sample=punch(progress,options),m=tracker.updatePose(sample.result,time,640,480);time+=1000/30;
   m.hands.left=relaxedHand('left',Array(5).fill(1));m.hands.right=relaxedHand('right',Array(5).fill(1));
   for(let frame=0;frame<4;frame++)avatar.update(m,1/120);
   return {sample,m};
  }
  for(let i=0;i<12;i++)update(0);
  for(let cycle=0;cycle<12;cycle++)for(const progress of [0,1/3,2/3,1,2/3,1/3]){
   const {sample}=update(progress);await new Promise(requestAnimationFrame);
   if(progress===1){
    const actual=new Vector3(0,-1,0).applyQuaternion(avatar.getJoints().left_fore.getWorldQuaternion(new Quaternion()));
    worst=Math.max(worst,actual.angleTo(new Vector3(...sample.fore)));peak=Math.max(peak,actual.z);
   }
  }
  if(worst>.5||peak<.85)throw Error('El rig pierde el ápice del jab: '+worst+' / '+peak);
  for(let i=0;i<15;i++)update(1,{collapsed:true});
  const recovered=new Vector3(0,-1,0).applyQuaternion(avatar.getJoints().left_fore.getWorldQuaternion(new Quaternion()));
  if(recovered.z<.9)throw Error('El rig pierde el golpe con escorzo');
  const m=tracker.motion;
  const show=(pose='punch',side=false,skeleton=false)=>{
   m.position=[0,0,0];m.yaw=m.pitch=m.roll=m.torsoYaw=0;m.pelvis={pitch:0,roll:0};
   for(const s of ['left','right']){
    m.directions[s+'_thigh']=pose==='crouch'?[0,-.72,.7]:[0,-1,0];
    m.directions[s+'_shin']=pose==='crouch'?[0,-.8,-.6]:[0,-1,0];
    m.directions[s+'_foot']=[0,0,1];
   }
   avatar.setView('front');if(side)avatar.getCamera().position.set(4,2.0,3.5);
   avatar.setSkeleton(skeleton);for(let i=0;i<120;i++)avatar.update(m,1/60);
  };
  let soleError=0;
  for(const pose of ['rest','crouch']){
   show(pose);const mesh=avatar.getSkin();let minimum=Infinity;
   for(const part of mesh.userData.parts.filter(p=>p.name.endsWith('_sole')))for(let i=part.start;i<part.start+part.count;i++){
    minimum=Math.min(minimum,mesh.getVertexPosition(i,new Vector3()).applyMatrix4(mesh.matrixWorld).y);
   }
   soleError=Math.max(soleError,Math.abs(minimum+.045));
   if(Math.abs(minimum+.045)>.012)throw Error('Las botas no apoyan en el suelo: '+minimum);
   for(const state of Object.values(avatar.getLegState()))if(state.ankle[0]<-1.051||state.ankle[0]>1.551||Math.abs(state.ankle[1])>.901||Math.abs(state.ankle[2])>.001)throw Error('Tobillo fuera de límites');
  }
  window.boxingTest={show};show();
  return {cycles:12,peakDirectionZ:peak,worstDegrees:worst*180/Math.PI,recoveredDirectionZ:recovered.z,soleError,calls:avatar.getRenderer().info.render.calls};
 });
 console.log('BOXING',JSON.stringify(result));assert.ok(result.calls<=20);
 for(const [name,pose,side,skeleton] of [['boxing-front','punch',false,false],['boxing-skeleton','punch',false,true],['crouch-side','crouch',true,false]]){
  await page.evaluate(args=>window.boxingTest.show(...args),[pose,side,skeleton]);
  await page.locator('#boxing-preview').screenshot({path:path.join(import.meta.dirname,'.cache/'+name+'.png')});
 }
 assert.deepEqual(errors,[]);console.log('JAB + ESCORZO + RODILLAS + TOBILLOS + SUELAS OK');
}finally{await browser.close();}
