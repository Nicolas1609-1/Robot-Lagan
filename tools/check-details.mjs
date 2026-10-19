import {chromium} from '@playwright/test';
import path from 'node:path';
import {prepareFixtures} from './prepare-fixtures.mjs';
const cleanup=await prepareFixtures(['portrait.jpg','right_hands.jpg']);
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1100,height:850}});
 await page.goto('http://127.0.0.1:5173/');
 await page.waitForFunction(()=>!!window.samurai);
 const results=await page.evaluate(async()=>{
  const {Retargeter}=await import('/src/tracking.js');
  const {createAvatar}=await import('/src/avatar.js');
  const tracker=new Retargeter(),output={};
  for(const [kind,name] of [['face','portrait.jpg'],['hands','right_hands.jpg']]){
   const w=new Worker('/vision.worker.js');
   const next=type=>new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Timeout '+kind+' '+type)),20000);
    w.onmessage=e=>{if(e.data.type===type){clearTimeout(timeout);resolve(e.data);}else if(e.data.type==='error'||e.data.type==='frame-error'){clearTimeout(timeout);reject(Error(e.data.message));}};
   });
   try{
    const ready=next('ready');w.postMessage({type:'init',kind,cpu:true});await ready;
    const response=await fetch('/tools/.cache/fixtures/'+name),bitmap=await createImageBitmap(await response.blob());
    const width=bitmap.width,height=bitmap.height,job=next('result');
    w.postMessage({type:'frame',bitmap,time:1000,epoch:1},[bitmap]);const result=await job;
    for(let tick=0;tick<12;tick++)tracker.updateDetails({[kind]:result.data},1000+tick*40,width,height);

    output[kind]={duration:result.duration,face:result.data.faceLandmarks?.[0]?.length||0,
     blendshapes:result.data.faceBlendshapes?.[0]?.categories?.length||0,
     hands:(result.data.landmarks||[]).map(p=>p.length),
     world:(result.data.worldLandmarks||[]).map(p=>p.length)};
   }finally{w.terminate();}
  }
  const host=document.createElement('div');host.id='rig-preview';
  Object.assign(host.style,{position:'fixed',inset:'0 auto auto 0',width:'720px',height:'640px',zIndex:1000});document.body.append(host);
  tracker.motion.directions.left_upper=[-.8,-.6,0];tracker.motion.directions.right_upper=[.8,-.6,0];
  for(const side of ['left','right'])tracker.motion.directions[side+'_fore']=tracker.motion.hands[side].basis[1].map(x=>-x);
  const avatar=await createAvatar(host);avatar.update(tracker.motion);output.fullDrawCalls=avatar.getRenderer().info.render.calls;avatar.setView('hands');avatar.update(tracker.motion);
  output.acceptedHands=Object.values(tracker.motion.handVisible).filter(Boolean).length;
  const snapshot=structuredClone(tracker.motion);
  const previousRotations={},previousPositions={};
  const {Quaternion,Vector3}=await import('/tools/node_modules/three/build/three.module.js');
  avatar.setView('hands');
  for(let frame=0;frame<360;frame++){
   if(frame===70)avatar.setView('front');
   if(frame===220)avatar.setView('back');
   const phase=frame*.05;
   tracker.motion.yaw=Math.sin(phase*.65)*1.4;
   tracker.motion.torsoYaw=Math.sin(phase*1.2)*.55;
   tracker.motion.pelvis={roll:Math.sin(phase*1.5)*.4,pitch:Math.sin(phase)*.2,visible:true,count:2};
   tracker.motion.position=[Math.sin(phase)*.8,Math.max(0,Math.sin(phase*2))*.25,0];
   for(const [side,sign] of [['left',-1],['right',1]]){
    const angle=frame*.06*sign,cos=Math.cos(angle),sin=Math.sin(angle);
    tracker.motion.hands[side].basis=snapshot.hands[side].basis.map(([x,y,z])=>[cos*x+sin*z,y,-sin*x+cos*z]);
    const direction=[Math.sin(phase)*.14,-Math.cos(phase),Math.sin(phase)];
    tracker.motion.directions[side+'_fore']=new Vector3(...direction).normalize().toArray();
    tracker.motion.directions[side+'_thigh']=new Vector3(sign*.12,-1,Math.sin(phase*1.3)*.8).normalize().toArray();
    tracker.motion.directions[side+'_shin']=new Vector3(0,-1,-Math.max(0,Math.sin(phase*1.3))*.9).normalize().toArray();
    tracker.motion.directions[side+'_foot']=new Vector3(sign*.05,Math.sin(phase),Math.cos(phase)).normalize().toArray();
    // Pérdida breve de manos durante el movimiento, con antebrazos que cruzan
    // la singularidad de mirar hacia la cámara en ambos sentidos.
    tracker.motion.handVisible[side]=frame%80<60;
    tracker.motion.handBlend[side]=tracker.motion.handVisible[side]?1:0;
   }
   avatar.update(tracker.motion,1/60);
   if(avatar.getCamera().position.length()>15)throw Error('La cámara se alejó excesivamente');
   for(const [name,group] of Object.entries(avatar.getGroups())){
    if(group.matrixWorld.elements.some(x=>!Number.isFinite(x))||Math.abs(group.matrixWorld.determinant()-1)>1e-7)throw Error('Matriz corporal inválida: '+name);
    const q=new Quaternion().setFromRotationMatrix(group.matrixWorld),previous=previousRotations[name];
    if(frame>25&&previous&&q.angleTo(previous)>.48)throw Error('Salto de orientación: '+name);
    previousRotations[name]=q;
    const position=new Vector3().setFromMatrixPosition(group.matrixWorld),oldPosition=previousPositions[name];
    if(frame>25&&oldPosition&&position.distanceTo(oldPosition)>.18)throw Error('Salto de posición: '+name);
    previousPositions[name]=position;
   }
   for(const side of ['left','right']){
    const group=avatar.getGroups()[side+'_hand'];
    const wrist=new Vector3().setFromMatrixPosition(group.matrixWorld);
    const expected=new Vector3(0,-.43,0).applyMatrix4(avatar.getGroups()[side+'_fore'].matrixWorld);
    if(wrist.distanceTo(expected)>1e-7)throw Error('Mano separada del antebrazo');
    if(group.matrixWorld.elements.some(x=>!Number.isFinite(x))||Math.abs(group.matrixWorld.determinant()-1)>1e-7)throw Error('Muñeca deformada durante giro');
    for(const bone of avatar.getSkeleton().bones){
     if(!bone.parent.isBone)continue;
     const expected=bone.position.clone().applyMatrix4(bone.parent.matrixWorld);
     if(bone.getWorldPosition(new Vector3()).distanceTo(expected)>1e-7)throw Error('Hueso desconectado: '+bone.name);
     if(bone.scale.toArray().some(x=>x!==1))throw Error('Hueso estirado: '+bone.name);
    }

   }
  }
  tracker.motion=snapshot;
  avatar.setView('hands');
  for(let frame=0;frame<35;frame++)avatar.update(tracker.motion,1/60);
  output.stressFrames=360;output.bones=avatar.getSkeleton().bones.length;output.skinned=avatar.getSkin().isSkinnedMesh;
  window.rigTest={avatar,tracker};output.drawCalls=avatar.getRenderer().info.render.calls;
  return output;
 });
 console.log('DETECTORS',JSON.stringify(results));
 if(results.face.face!==478||results.face.blendshapes!==52)throw Error('Rostro incompleto');
 if(!results.hands.hands.every(n=>n===21)||results.hands.hands.length!==2||!results.hands.world.every(n=>n===21))throw Error('Manos incompletas');
 if(results.acceptedHands!==2)throw Error('El estabilizador no aceptó las manos reales');
 if(results.bones!==64||!results.skinned)throw Error('Esqueleto o malla sin conectar');
 if(results.fullDrawCalls>30)throw Error('Demasiadas llamadas de dibujo');
 await page.locator('#rig-preview').screenshot({path:path.join(import.meta.dirname,'.cache/hands-real.png')});
 await page.evaluate(()=>{
  const {avatar,tracker}=window.rigTest;
  tracker.motion.face={jaw:.6,smileLeft:.8,smileRight:.8,blinkLeft:1,wideRight:.8,browRight:.8};
  avatar.setView('face');avatar.update(tracker.motion);
 });
 await page.locator('#rig-preview').screenshot({path:path.join(import.meta.dirname,'.cache/face-expression.png')});
 console.log('FACE + HANDS + RENDER QA OK');
}finally{await browser?.close();await cleanup();}
