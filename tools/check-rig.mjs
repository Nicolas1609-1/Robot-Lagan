import {chromium} from '@playwright/test';
import path from 'node:path';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1250,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]||'http://127.0.0.1:5173/');await page.waitForFunction(()=>!!window.samurai);
 const state=await page.evaluate(async()=>{
  const {createAvatar}=await import('/src/avatar.js'),{relaxedHand}=await import('/src/hands.js');
  const {Vector3}=await import('/tools/node_modules/three/build/three.module.js');
  const host=document.createElement('div');host.id='skeleton-preview';
  Object.assign(host.style,{position:'fixed',inset:'0 auto auto 0',width:'720px',height:'780px',zIndex:1000});document.body.append(host);
  const avatar=await createAvatar(host);
  const motion={worldSpace:true,directions:{},hands:{left:relaxedHand('left',Array(5).fill(0)),right:relaxedHand('right',Array(5).fill(0))},handVisible:{left:false,right:false},face:{smile:.25}};
  const settle=()=>{for(let i=0;i<90;i++)avatar.update(motion,1/60);};
  const show=(view,pose='rest',skeleton=false)=>{
   for(const [side,sign] of [['left',-1],['right',1]]){
    motion.directions[side+'_upper']=pose==='raised'?[sign*.5,.8,.1]:[sign*.10,-1,0];
    motion.directions[side+'_fore']=pose==='raised'?[sign*.25,.5,.8]:[0,-1,.06];
    motion.hands[side]=relaxedHand(side,Array(5).fill(pose==='fist'?1:0));
    motion.handVisible[side]=false;
   }
   if(pose==='fist'){
    motion.directions.left_upper=[-.7,-.2,.5];motion.directions.left_fore=[0,.25,.95];
   }
   avatar.setSkeleton(skeleton);avatar.setView(view);settle();
  };
  show('front');window.skeletonTest={show,avatar,motion};
  const skeleton=avatar.getSkeleton(),mesh=avatar.getSkin();
  const part=mesh.userData.parts.find(p=>p.name==='left_index_dip_phalanx');
  const vertex=()=>mesh.applyBoneTransform(part.start,new Vector3().fromBufferAttribute(mesh.geometry.attributes.position,part.start));
  const open=vertex();show('hands','fist');const closed=vertex();
  if(open.distanceTo(closed)<.15)throw Error('Los vértices no acompañan al esqueleto');
  for(let i=0;i<mesh.geometry.attributes.position.count;i+=7){
   const p=mesh.getVertexPosition(i,new Vector3());if(!p.toArray().every(Number.isFinite))throw Error('Vértice deformado');
  }
  show('front','raised');
  if(Math.abs(avatar.getJoints().left_clavicle.quaternion.z)<.02)throw Error('La clavícula no acompaña al brazo elevado');
  const joints=avatar.getJoints();
  for(let i=0;i<150;i++){
   motion.directions.left_thigh=[0,-1,.2];motion.directions.left_shin=[0,-.2,-1];avatar.update(motion,1/60);
  }
  if(Math.abs(joints.left_shin.quaternion.y)>1e-8||Math.abs(joints.left_shin.quaternion.z)>1e-8)throw Error('Rodilla fuera de su bisagra');
  const knee=avatar.getLegState().left.knee;
  if(knee<.8||knee>2.8)throw Error('Rodilla no acompaña la flexión');
  const expected=new Vector3(0,-.85,0).applyMatrix4(joints.left_shin.matrixWorld);
  if(expected.distanceTo(joints.left_foot.getWorldPosition(new Vector3()))>1e-7)throw Error('Pie desprendido de la pierna');
  motion.directions.left_thigh=[0,-1,0];motion.directions.left_shin=[0,-1,0];show('front');
  return {bones:skeleton.bones.length,skinned:mesh.isSkinnedMesh,calls:avatar.getRenderer().info.render.calls,kneeHinge:true,clavicle:true};
 });
 console.log('RIG',JSON.stringify(state));assert.equal(state.bones,64);assert.equal(state.skinned,true);assert.ok(state.calls<=20);
 for(const [name,view,pose,skeleton] of [['rig-front','front','rest',false],['rig-back','back','rest',false],['rig-raised','front','raised',false],['rig-skeleton','front','raised',true],['rig-fist','hands','fist',false],['rig-palm','hands','rest',false]]){
  await page.evaluate(([view,pose,skeleton])=>window.skeletonTest.show(view,pose,skeleton),[view,pose,skeleton]);
  await page.locator('#skeleton-preview').screenshot({path:path.join(import.meta.dirname,'.cache/'+name+'.png')});
 }
 await page.evaluate(()=>document.getElementById('skeleton-preview').remove());
 await page.locator('#skeleton-toggle').check();await page.locator('#skeleton-toggle').uncheck();
 await page.setViewportSize({width:390,height:850});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 assert.deepEqual(errors,[]);console.log('SKELETON + SKIN + DESIGN QA OK');
}finally{await browser.close();}
