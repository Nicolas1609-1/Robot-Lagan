import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]||'http://127.0.0.1:5181/');await page.waitForFunction(()=>!!window.samurai);
 const report=await page.evaluate(async()=>{
  const {createAvatar}=await import('/src/avatar.js'),{Retargeter}=await import('/src/tracking.js');
  const {lowerBody}=await import('/tools/motion-fixtures.mjs');
  const {Vector3,Quaternion}=await import('/tools/node_modules/three/build/three.module.js');
  const host=document.createElement('div');host.id='legs-preview';
  Object.assign(host.style,{position:'fixed',inset:'0 auto auto 0',width:'720px',height:'780px',zIndex:1000});document.body.append(host);
  const avatar=await createAvatar(host),tracker=new Retargeter();let time=0;
  const update=(options,frames=60)=>{
   const sample=lowerBody(options);
   for(let i=0;i<frames;i++){
    const m=tracker.updatePose(sample.result,time,640,480);time+=1000/30;
    avatar.update(m,1/60);avatar.update(m,1/60);
   }
   return sample;
  };
  const cases=[['reposo',{}],['sentadilla',{leftHip:.75,rightHip:.75,leftKnee:1.55,rightKnee:1.55,lean:.5}],
   ['rodilla_alta',{leftHip:1.25,leftKnee:1.4}],['giro_lateral',{leftTurn:Math.PI/2,leftKnee:Math.PI/3}],
   ['caderas',{roll:.65,yaw:.7,leftKnee:.4,rightKnee:.4,leftHip:.2,rightHip:.2}],
   ['paso_lateral',{leftSpread:-.65,leftKnee:.7,leftHip:.25,leftTurn:-.8}]];
  const rows=[];
  for(const [name,options] of cases){
   const sample=update(options),j=avatar.getJoints();let worst=0;
   for(const side of ['left','right'])for(const part of ['thigh','shin']){
    const actual=new Vector3(0,-1,0).applyQuaternion(j[side+'_'+part].getWorldQuaternion(new Quaternion()));
    const error=actual.angleTo(new Vector3(...sample.directions[side][part]));worst=Math.max(worst,error);
   }
   if(worst>.35)throw Error(name+': desfase de pierna '+worst*180/Math.PI);
   for(const side of ['left','right']){
    const state=avatar.getLegState()[side];
    if(Math.abs(state.knee-sample.knees[side])>.18)throw Error(name+': rodilla no acompaña '+side+' '+state.knee);
    if(j[side+'_shin'].quaternion.y!==0||j[side+'_shin'].quaternion.z!==0)throw Error('Se perdió la bisagra');
   }
   const mesh=avatar.getSkin();let floor=Infinity;
   for(const part of mesh.userData.parts.filter(p=>p.name.endsWith('_sole')))for(let i=part.start;i<part.start+part.count;i++)floor=Math.min(floor,mesh.getVertexPosition(i,new Vector3()).applyMatrix4(mesh.matrixWorld).y);
   if(Math.abs(floor+.045)>.025)throw Error(name+': suelas fuera del suelo '+floor);
   rows.push({name,worstDegrees:worst*180/Math.PI,knees:avatar.getLegState(),hips:{...tracker.motion.pelvis},footHeight:j.left_foot.getWorldPosition(new Vector3()).y,floor});
  }
  const heights=[];
  for(let i=0;i<72;i++){
   const phase=i*Math.PI/12,lift=Math.max(0,Math.sin(phase));
   const sample=lowerBody({leftHip:lift*1.2,leftKnee:lift*1.4});
   const m=tracker.updatePose(sample.result,time,640,480);time+=125;
   for(let f=0;f<8;f++)avatar.update(m,1/64);
   heights.push(avatar.getJoints().left_foot.getWorldPosition(new Vector3()).y);
  }
  const range=Math.max(...heights)-Math.min(...heights);
  if(range<.4)throw Error('La pierna sigue rígida al bailar a ocho muestras/s: '+range);
  const show=(name,skeleton=false)=>{
   const options=cases.find(c=>c[0]===name)[1];update(options);avatar.setView('front');
   if(name==='sentadilla')avatar.getCamera().position.set(4,2.0,3.5);
   avatar.setSkeleton(skeleton);avatar.update(tracker.motion,1/60);
  };
  window.legsTest={show};show('giro_lateral',true);
  return {cases:rows,movingFootRange:range,calls:avatar.getRenderer().info.render.calls,skeletonVisible:true,bones:avatar.getSkeleton().bones.length};
 });
 for(const [name,skeleton] of [['sentadilla',false],['giro_lateral',true],['rodilla_alta',false],['paso_lateral',false]]){
  await page.evaluate(([name,skeleton])=>window.legsTest.show(name,skeleton),[name,skeleton]);
  await page.locator('#legs-preview').screenshot({path:path.join(import.meta.dirname,'.cache/'+name+'.png')});
 }
 assert.deepEqual(errors,[]);assert.equal(report.bones,64);assert.ok(report.calls<=20);
 await fs.writeFile(path.join(import.meta.dirname,'.cache/lower-body.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{await browser.close();}
