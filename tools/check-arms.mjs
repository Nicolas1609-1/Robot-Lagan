import {chromium} from '@playwright/test';
import path from 'node:path';
import assert from 'node:assert/strict';

const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]||'http://127.0.0.1:5173/');await page.waitForFunction(()=>!!window.samurai);
 const output=await page.evaluate(async()=>{
  const {createAvatar,demoMotion}=await import('/src/avatar.js');
  const {Vector3,Quaternion}=await import('/tools/node_modules/three/build/three.module.js');
  const host=document.createElement('div');host.id='arm-preview';
  Object.assign(host.style,{position:'fixed',inset:'0 auto auto 0',width:'720px',height:'780px',zIndex:1000});document.body.append(host);
  const avatar=await createAvatar(host),previous={};let maxWrist=0,maxStep=0,maxElbow=0,maxHandError=0;
  for(let frame=0;frame<1200;frame++){
   if(frame%4===0)await new Promise(requestAnimationFrame);
   const m=demoMotion(frame/60);avatar.update(m,1/60);
   for(const side of ['left','right']){
    const joints=avatar.getJoints(),state=avatar.getArmState()[side];
    const wrist=joints[side+'_hand'].quaternion.angleTo(new Quaternion());
    maxWrist=Math.max(maxWrist,wrist);maxElbow=Math.max(maxElbow,state.elbow);
    if(frame>90){
     const localDown=new Vector3(0,-1,0).applyQuaternion(joints[side+'_fore'].quaternion);
     if(Math.abs(localDown.x)>1e-7)throw Error('Codo doblado fuera de su bisagra');
     if(Math.abs(joints[side+'_hand'].quaternion.y)>1e-5)throw Error('La muñeca está pronando en lugar del antebrazo');
     const expected=new Vector3(0,-.43,0).applyMatrix4(joints[side+'_fore'].matrixWorld);
     if(joints[side+'_hand'].getWorldPosition(new Vector3()).distanceTo(expected)>1e-7)throw Error('Muñeca desprendida');
     const measured=new Vector3(...m.hands[side].basis[1]).negate().applyAxisAngle(new Vector3(0,1,0),m.yaw);
     const actual=new Vector3(0,-1,0).applyQuaternion(joints[side+'_hand'].getWorldQuaternion(new Quaternion()));
     maxHandError=Math.max(maxHandError,measured.angleTo(actual));
    }
    for(const part of ['upper','fore','hand']){
     const key=side+'_'+part,q=joints[key].getWorldQuaternion(new Quaternion());
     if(frame>90&&previous[key])maxStep=Math.max(maxStep,q.angleTo(previous[key]));previous[key]=q;
    }
   }
  }
  const show=(t,view='front',skeleton=false)=>{
   avatar.setSkeleton(skeleton);avatar.setView(view);
   for(let i=0;i<150;i++)avatar.update(demoMotion(t),1/60);
  };
  window.armTest={show};show(2);
  return {seconds:20,maxWrist:maxWrist*180/Math.PI,maxElbow:maxElbow*180/Math.PI,maxStep:maxStep*180/Math.PI,maxHandError:maxHandError*180/Math.PI};
 });
 console.log('ARM DEMO',JSON.stringify(output));
 assert.ok(output.maxWrist<18);assert.ok(output.maxStep<12);assert.ok(output.maxHandError<12);
 for(const [name,t,view,skeleton] of [['arms-wave',2,'front',false],['arms-wave-skeleton',2,'front',true],['arms-open',4.2,'hands',false],['arms-fist',1.2,'hands',false],['arms-reverse',8,'back',false]]){
  await page.evaluate(args=>window.armTest.show(...args),[t,view,skeleton]);
  await page.screenshot({path:path.join(import.meta.dirname,'.cache/'+name+'.png'),clip:{x:0,y:0,width:720,height:780}});
 }
 assert.deepEqual(errors,[]);console.log('DEMO + ELBOW HINGE + FOREARM TWIST + WRIST QA OK');
}finally{await browser.close();}
