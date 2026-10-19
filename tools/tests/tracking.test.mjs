import test from 'node:test';
import assert from 'node:assert/strict';
import {Retargeter,reliable,relaxedHand,handGeometry} from '../../src/tracking.js';
import {focusedHand} from '../../src/hands.js';

test('la vista cercana conserva la mano al perderla brevemente o detectar ambas',()=>{
 let side=focusedHand('left',{right:true,left:false});assert.equal(side,'right');
 side=focusedHand(side,{right:false,left:false});assert.equal(side,'right');
 side=focusedHand(side,{right:true,left:true});assert.equal(side,'right');
 side=focusedHand(side,{right:false,left:true});assert.equal(side,'left');
});

function scene({bent=false,hidden=false}={}){
 const p=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:0,presence:1}));
 const w=Array.from({length:33},()=>({x:0,y:0,z:0}));
 const coords={11:[.2,-.5,0],12:[-.2,-.5,0],13:[.3,-.4,0],14:[-.3,-.4,0],
  15:[.4,-.3,0],16:[-.4,-.3,0],23:[.12,0,0],24:[-.12,0,0],
  25:[.12,.3,0],26:[-.12,.3,0],27:bent?[.12,.3,-.3]:[.12,.6,0],
  28:[-.12,.6,0],29:[.12,.6,.03],30:[-.12,.6,.03],31:[.12,.6,-.1],32:[-.12,.6,-.1]};
 for(const [index,a] of Object.entries(coords)){w[index]={x:a[0],y:a[1],z:a[2]};p[index]={x:.5+a[0],y:.4+a[1]*.6,z:a[2],visibility:hidden&&index<23?0:.9,presence:1};}
 return {landmarks:[p],worldLandmarks:[w]};
}
test('las piernas usan diez puntos aunque no haya torso ni rostro',()=>{
 const t=new Retargeter(),m=t.updatePose(scene({hidden:true}),0);
 assert.deepEqual(m.legCounts,[5,5]);assert.equal(m.bodyVisible,true);
 assert.ok(m.directions.left_foot[2]>.9);
});
test('rodilla flexionada conserva 90 grados y cambia la espinilla',()=>{
 const m=new Retargeter().updatePose(scene({bent:true}),0);
 assert.ok(Math.abs(m.knees.left-90)<.01);assert.ok(m.directions.left_shin[2]>.9);
});
test('un tobillo fuera de imagen no se cuenta aunque tenga confianza alta',()=>{
 const result=scene();result.landmarks[0][27].y=1.1;
 const m=new Retargeter().updatePose(result,0);assert.equal(m.visible.has(27),false);assert.equal(m.legCounts[0],4);
 assert.equal(reliable({x:NaN,y:.5,z:0,visibility:1}),false);
});
test('histéresis conserva confianza moderada breve sin contar puntos fuera de imagen',()=>{
 const t=new Retargeter(),result=scene();t.updatePose(result,0);
 result.landmarks[0][27].visibility=.36;t.updatePose(result,100);assert.equal(t.motion.visible.has(27),true);
 result.landmarks[0][27].visibility=.1;t.updatePose(result,120);assert.equal(t.motion.visible.has(27),false);
});
test('una caída breve de confianza a 5 muestras/s no elimina la pierna al volver',()=>{
 const t=new Retargeter();t.updatePose(scene(),0);
 const missing=scene();missing.landmarks[0][27].visibility=.1;
 t.updatePose(missing,200);assert.equal(t.motion.visible.has(27),false);
 const recovered=scene();recovered.landmarks[0][27].visibility=.33;
 t.updatePose(recovered,400);assert.equal(t.motion.visible.has(27),true);
 recovered.landmarks[0][27].y=1.1;
 t.updatePose(recovered,600);assert.equal(t.motion.visible.has(27),false);
 const vanished=scene();vanished.landmarks[0][27].visibility=.1;
 t.updatePose(vanished,800);t.updatePose(vanished,1000);
 recovered.landmarks[0][27].y=.76;
 t.updatePose(recovered,1800);assert.equal(t.motion.visible.has(27),false);
});
test('sensibilidad alta acepta anclas moderadas con presencia y geometría válidas',()=>{
 const t=new Retargeter(),p=scene();
 for(const i of [11,12,23,24])p.landmarks[0][i].visibility=.38;
 assert.equal(t.updatePose(p,0).bodyVisible,false);
 t.setSensitivity(true);
 assert.equal(t.updatePose(p,200).bodyVisible,true);
 assert.equal(t.motion.pelvis.visible,true);
 p.landmarks[0][23].presence=.1;
 t.updatePose(p,400);assert.equal(t.motion.pelvis.visible,false);
});
test('una inferencia lenta no caduca caderas ni huesos recién recibidos, pero la ausencia sí',()=>{
 const t=new Retargeter();t.updatePose(scene({bent:true}),100,640,480,1150);
 const shin=[...t.motion.directions.left_shin];
 t.decay(1160,.016);
 assert.equal(t.motion.pelvis.visible,true);
 assert.deepEqual(t.motion.directions.left_shin,shin);
 t.decay(1900,.016);assert.equal(t.motion.pelvis.visible,false);
 t.decay(2200,.1);assert.notDeepEqual(t.motion.directions.left_shin,shin);
});
test('pérdida breve conserva pierna y la reaparición recupera sin referencia sentada',()=>{
 const t=new Retargeter();t.updatePose(scene({bent:true}),0);
 t.updatePose({landmarks:[],worldLandmarks:[]},300);t.decay(300,.1);assert.ok(t.motion.directions.left_shin[2]>.9);
 t.updatePose({landmarks:[],worldLandmarks:[]},1500);t.decay(1500,.1);
 let m=t.updatePose(scene(),1600);assert.deepEqual(m.position,[0,0,0]);
 // Recuperar con un giro gradual, sin saltar 90° en el primer fotograma.
 assert.ok(m.directions.left_shin[2]>.3);
 for(let time=1650;time<=2200;time+=50)m=t.updatePose(scene(),time);
 assert.ok(m.directions.left_shin[1]<-.99);
});
test('centrar sin cuerpo visible falla y no inventa una referencia',()=>{
 const t=new Retargeter();assert.equal(t.center(),false);t.updatePose(scene(),0);assert.equal(t.center(),true);
 assert.deepEqual(t.motion.position,[0,0,0]);
});

function handSample(side,wrist={x:.5,y:.5}){
 const shape=relaxedHand(side,Array(5).fill(0));
 const world=shape.points.map(([x,y,z])=>({x:-x,y:-y,z:-z}));
 const landmarks=shape.points.map(([x,y,z])=>({x:wrist.x-x*.45,y:wrist.y-y*.45,z:-z*.45}));
 return {landmarks,world};
}
// Muestra independiente del generador del robot: una mano derecha levantada,
// palma hacia la cámara sin espejo, con el pulgar a la derecha de la imagen.
function cameraPalm({left=false,back=false}={}){
 const world=Array.from({length:21},()=>({x:0,y:0,z:0}));
 const reflection=(left?-1:1)*(back?-1:1);
 for(let finger=0;finger<4;finger++){
  const start=5+finger*4,x=[.030,.005,-.021,-.045][finger],y=[-.075,-.086,-.080,-.064][finger];
  for(let joint=0;joint<4;joint++)world[start+joint]={x:x*reflection,y:y-joint*.025,z:0};
 }
 for(let joint=0;joint<4;joint++)world[1+joint]={x:(.047+joint*.014)*reflection,y:-.025-joint*.011,z:0};
 const landmarks=world.map(p=>({x:.5+p.x*2,y:.55+p.y*2,z:p.z*2}));
 return {landmarks,world};
}
test('palmas reales levantadas miran al frente y los pulgares siguen el espejo',()=>{
 for(const side of ['left','right']){
  const sample=cameraPalm({left:side==='left'}),shape=handGeometry(sample.landmarks,sample.world,side,0);
  assert.ok(shape.basis[2][2]>.99,'La palma mira hacia la cámara');
  const thumbX=shape.basis.reduce((sum,axis,i)=>sum+axis[0]*shape.points[4][i],0);
  assert.ok(thumbX*(side==='left'?1:-1)>0,'El pulgar queda hacia el centro al levantar la mano');
  const back=cameraPalm({left:side==='left',back:true}),turned=handGeometry(back.landmarks,back.world,side,0);
  assert.ok(turned.basis[2][2]<-.99,'Al girar la mano se ve el dorso');
 }
});
test('las palmas mantienen una base ortonormal y pulgares opuestos',()=>{
 for(const side of ['left','right']){
  const sample=handSample(side),shape=handGeometry(sample.landmarks,sample.world,side,0);
  for(const axis of shape.basis)assert.ok(Math.abs(Math.hypot(...axis)-1)<1e-6);
  const [x,y,z]=shape.basis,det=x[0]*(y[1]*z[2]-y[2]*z[1])-x[1]*(y[0]*z[2]-y[2]*z[0])+x[2]*(y[0]*z[1]-y[1]*z[0]);
  assert.ok(Math.abs(det-1)<1e-6);
  assert.ok(shape.points[4][0]*(side==='left'?-1:1)>0);
  assert.equal(shape.points.length,21);
 }
});
test('mover solo el pulgar no modifica los otros dedos',()=>{
 const sample=handSample('left'),a=handGeometry(sample.landmarks,sample.world,'left',0);
 sample.world[3].z-=.04;sample.world[4].z-=.08;
 const b=handGeometry(sample.landmarks,sample.world,'left',0);
 assert.deepEqual(a.points[8],b.points[8]);assert.deepEqual(a.points[20],b.points[20]);
 assert.ok(Math.abs(a.points[4][2]-b.points[4][2])>.05);
});
test('el giro de la palma cambia su orientación aunque el cierre sea el mismo',()=>{
 const sample=handSample('right'),a=handGeometry(sample.landmarks,sample.world,'right',0);
 sample.world=sample.world.map(p=>({x:-p.y,y:p.x,z:p.z}));
 const b=handGeometry(sample.landmarks,sample.world,'right',0);
 assert.ok(Math.hypot(...a.basis[1].map((x,i)=>x-b.basis[1][i]))>1);
 assert.ok(Math.hypot(...a.points[4].map((x,i)=>x-b.points[4][i]))<1e-6);
});
test('cada mano se asocia a su muñeca aunque lleguen en otro orden',()=>{
 const t=new Retargeter(),pose=scene();t.updatePose(pose,0);
 const left=handSample('left',pose.landmarks[0][15]),right=handSample('right',pose.landmarks[0][16]);
 t.updateDetails({hands:{landmarks:[right.landmarks,left.landmarks],worldLandmarks:[right.world,left.world],
  handedness:[[{categoryName:'Left'}],[{categoryName:'Left'}]]},posePoints:pose.landmarks[0]},40);
 assert.ok(t.motion.handVisible.left&&t.motion.handVisible.right);
 assert.equal(t.handWrists.left.x,pose.landmarks[0][15].x);assert.equal(t.handWrists.right.x,pose.landmarks[0][16].x);
});
function faceSample(values){
 const points=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
 points[234].x=.35;points[454].x=.65;points[33]={x:.4,y:.4,z:0};points[263]={x:.6,y:.4,z:0};points[152].y=.75;points[1].y=.55;
 return {faceLandmarks:[points],faceBlendshapes:[{categories:Object.entries(values).map(([categoryName,score])=>({categoryName,score}))}]};
}
test('parpadeo, sonrisa y cejas se conservan por lado y la calibración no los elimina',()=>{
 const t=new Retargeter();t.updateDetails({face:faceSample({eyeBlinkLeft:1,mouthSmileRight:.8,browOuterUpLeft:.7})},40,640,480);
 assert.ok(t.motion.face.blinkLeft>.8);assert.equal(t.motion.face.blinkRight,0);
 assert.ok(t.motion.face.smileRight>t.motion.face.smileLeft);assert.ok(t.motion.face.browLeft>t.motion.face.browRight);
 t.updateDetails({face:faceSample({jawOpen:.05})},80);assert.equal(t.calibrateFace(),true);
 t.updateDetails({face:faceSample({jawOpen:.7})},120);assert.ok(t.motion.face.jaw>.7);
});
test('un movimiento rápido conserva longitud, responde y no se extrapola',()=>{
 const t=new Retargeter(),p=scene();t.updatePose(p,0);
 const length=Math.hypot(.1,.1);
 p.worldLandmarks[0][13]={x:.2+length,y:-.5,z:0};t.updatePose(p,50);
 assert.ok(t.motion.directions.left_upper[0]<-.8);
 const m=t.getRenderMotion(100),later=t.getRenderMotion(10000);
 assert.ok(Object.values(m.directions).every(v=>v.every(Number.isFinite)&&Math.abs(Math.hypot(...v)-1)<1e-6));
 assert.deepEqual(later.directions,t.motion.directions);
 assert.deepEqual(m.directions,t.motion.directions);
});

const handChains=[[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]];
const segmentLengths=shape=>handChains.flatMap(ids=>ids.slice(1).map((index,i)=>Math.hypot(...shape.points[index].map((x,j)=>x-shape.points[ids[i]][j]))));
function handResult(sample,side='left'){
 return {hands:{landmarks:[sample.landmarks],worldLandmarks:[sample.world],handedness:[[{categoryName:side==='left'?'Left':'Right',score:.99}]]}};
}
function determinant(shape){
 const [x,y,z]=shape.basis;
 return x[0]*(y[1]*z[2]-y[2]*z[1])-x[1]*(y[0]*z[2]-y[2]*z[0])+x[2]*(y[0]*z[1]-y[1]*z[0]);
}
test('una palma casi nula o colineal se descarta sin deformar el modelo',()=>{
 const sample=handSample('left');
 const tiny=sample.world.map(p=>({x:p.x*.001,y:p.y*.001,z:p.z*.001}));
 assert.equal(handGeometry(sample.landmarks,tiny,'left',0),null);
 const flat=sample.world.map(p=>({...p}));flat[5]={x:0,y:.08,z:0};flat[17]={x:0,y:.14,z:0};
 assert.equal(handGeometry(sample.landmarks,flat,'left',0),null);
});
test('cambiar la escala y los puntos no cambia la longitud de ningún dedo',()=>{
 const sample=handSample('left'),reference=segmentLengths(relaxedHand('left'));
 for(const scale of [.4,.7,1,1.4]){
  const world=sample.world.map((p,i)=>({x:p.x*scale,y:p.y*scale,z:p.z*scale+(i%4===0?.003:0)}));
  const shape=handGeometry(sample.landmarks,world,'left',0);assert.ok(shape);
  segmentLengths(shape).forEach((value,i)=>assert.ok(Math.abs(value-reference[i])<1e-9));
 }
});
test('un punto de dedo disparado conserva ese dedo y deja actualizar los demás',()=>{
 const t=new Retargeter(),sample=handSample('left');
 t.updateDetails(handResult(sample),40);const before=structuredClone(t.motion.hands.left);
 const bad=structuredClone(sample);bad.world[8].z=2;
 t.updateDetails(handResult(bad),80);
 assert.deepEqual(t.motion.hands.left.parameters.slice(4,8),before.parameters.slice(4,8));
 assert.equal(t.motion.hands.left.validFingers[1],false);assert.equal(t.seen.left_hand,80);
 segmentLengths(t.motion.hands.left).forEach((value,i)=>assert.ok(Math.abs(value-segmentLengths(before)[i])<1e-9));
});
test('un giro espurio de 180 grados en un solo fotograma se ignora',()=>{
 const t=new Retargeter(),sample=handSample('left');
 t.updateDetails(handResult(sample),40);t.updateDetails(handResult(sample),80);
 const before=structuredClone(t.motion.hands.left);
 const bad=structuredClone(sample);bad.world=bad.world.map(p=>({x:-p.x,y:p.y,z:-p.z}));
 t.updateDetails(handResult(bad),120);
 assert.deepEqual(t.motion.hands.left.basis,before.basis);assert.equal(t.seen.left_hand,120);
 t.updateDetails(handResult(sample),160);assert.equal(t.seen.left_hand,160);
});
test('la pérdida de puntos desvanece la muñeca sin aplastar su base ni sus dedos',()=>{
 const t=new Retargeter(),sample=handSample('left');
 t.updateDetails(handResult(sample),40);const reference=segmentLengths(t.motion.hands.left);
 t.decay(800,.1);assert.ok(t.motion.handBlend.left>0&&t.motion.handBlend.left<1);assert.equal(t.motion.handVisible.left,false);
 for(let i=0;i<60;i++){
  t.decay(800+i*16,.016);assert.ok(Math.abs(determinant(t.motion.hands.left)-1)<1e-9);
  segmentLengths(t.motion.hands.left).forEach((value,j)=>assert.ok(Math.abs(value-reference[j])<1e-9));
 }
});
test('las manos cruzadas conservan su identidad con muñecas corporales atrasadas',()=>{
 const t=new Retargeter(),pose=scene();t.updatePose(pose,0);
 for(let frame=0;frame<7;frame++){
  const x=.65-frame*.07,left=handSample('left',{x,y:.3}),right=handSample('right',{x:1-x,y:.3});
  const reverse=frame%2===1,pairs=reverse?[right,left]:[left,right];
  t.updateDetails({hands:{landmarks:pairs.map(p=>p.landmarks),worldLandmarks:pairs.map(p=>p.world),
   handedness:pairs.map(()=>[{categoryName:'Left',score:.2}])},posePoints:pose.landmarks[0],poseTime:0},40+frame*40);
  assert.ok(Math.abs(t.handWrists.left.x-x)<1e-6);assert.ok(Math.abs(t.handWrists.right.x-(1-x))<1e-6);
 }
});
test('giros continuos de palma mantienen proporciones y matrices de rotación válidas',()=>{
 const t=new Retargeter(),sample=handSample('right'),reference=segmentLengths(relaxedHand('right'));
 for(let frame=0;frame<150;frame++){
  const a=frame*.045,world=sample.world.map(p=>({x:Math.cos(a)*p.x-Math.sin(a)*p.z,y:p.y,z:Math.sin(a)*p.x+Math.cos(a)*p.z}));
  t.updateDetails(handResult({...sample,world},'right'),40+frame*20);
  const shape=t.motion.hands.right;assert.ok(Math.abs(determinant(shape)-1)<1e-8);
  segmentLengths(shape).forEach((value,i)=>assert.ok(Math.abs(value-reference[i])<1e-8));
 }
});
test('una muestra antigua no hace retroceder la mano',()=>{
 const t=new Retargeter(),sample=handSample('left');t.updateDetails(handResult(sample),100);
 const before=structuredClone(t.motion.hands.left);t.updateDetails(handResult(sample),60);
 assert.deepEqual(t.motion.hands.left,before);assert.equal(t.seen.left_hand,100);
});

const rotateY=([x,y,z],a)=>[Math.cos(a)*x+Math.sin(a)*z,y,-Math.sin(a)*x+Math.cos(a)*z];
function rotateBody(result,a,ids=Array.from({length:33},(_,i)=>i)){
 for(const i of ids){
  const p=result.worldLandmarks[0][i],[x,y,z]=rotateY([p.x,p.y,p.z],a);
  result.worldLandmarks[0][i]={x,y,z};
  result.landmarks[0][i]={...result.landmarks[0][i],x:.5+x*.7,y:.4+y*.6,z:z*.7};
 }
 return result;
}
test('las caderas giran la pelvis y el torso puede girar por separado',()=>{
 const t=new Retargeter();t.updatePose(scene(),0);
 for(let i=1;i<=30;i++)t.updatePose(rotateBody(scene(),.8),i*40);
 assert.ok(Math.abs(t.motion.yaw-.8)<.01);assert.ok(Math.abs(t.motion.torsoYaw)<.01);
 const separate=new Retargeter();separate.updatePose(scene(),0);
 for(let i=1;i<=30;i++)separate.updatePose(rotateBody(scene(),.6,[11,12,13,14,15,16]),i*40);
 assert.ok(Math.abs(separate.motion.yaw)<.01);assert.ok(separate.motion.torsoYaw>.58);
 assert.equal(separate.motion.pelvis.visible,true);
});
test('el balanceo de caderas mueve la pelvis aunque los hombros estén horizontales',()=>{
 const t=new Retargeter();t.updatePose(scene(),0);
 const p=scene();p.worldLandmarks[0][23].y=.055;p.worldLandmarks[0][24].y=-.055;
 for(let i=1;i<=25;i++)t.updatePose(p,i*40);
 assert.ok(t.motion.pelvis.roll>.4);assert.ok(t.motion.roll<-.4);
});
test('un punto 3D inválido no se sustituye por píxeles y no dispara huesos',()=>{
 const t=new Retargeter(),p=scene();t.updatePose(p,0);
 const before=structuredClone(t.motion.directions);
 p.worldLandmarks[0][13].x=NaN;t.updatePose(p,40);
 assert.deepEqual(t.motion.directions.left_upper,before.left_upper);
 assert.deepEqual(t.motion.directions.left_fore,before.left_fore);
 p.worldLandmarks[0][13]={x:3,y:-2,z:1};t.updatePose(p,80);
 assert.deepEqual(t.motion.directions.left_upper,before.left_upper);
 assert.deepEqual(t.motion.directions.left_fore,before.left_fore);
});
test('un salto corporal aislado de 180° se conserva hasta otra medida fiable',()=>{
 const t=new Retargeter(),p=scene();t.updatePose(p,0);
 const before=[...t.motion.directions.left_upper];
 p.worldLandmarks[0][13]={x:.1,y:-.6,z:0};t.updatePose(p,40);
 assert.deepEqual(t.motion.directions.left_upper,before);
 t.updatePose(scene(),80);assert.ok(t.motion.directions.left_upper[1]<-.7);
});
test('ocultar caderas brevemente no sustituye su giro con el de los hombros',()=>{
 const t=new Retargeter();t.updatePose(scene(),0);
 const p=rotateBody(scene(),.8,[11,12,13,14,15,16]);
 p.landmarks[0][23].visibility=p.landmarks[0][24].visibility=.1;
 for(let i=1;i<=5;i++)t.updatePose(p,i*40);
 assert.ok(Math.abs(t.motion.yaw)<.01);assert.ok(t.motion.torsoYaw>.5);
 assert.equal(t.motion.pelvis.visible,false);
});
test('girar el cuerpo no gira otra vez una mano medida en el mismo espacio',()=>{
 const t=new Retargeter(),sample=handSample('left');t.updatePose(scene(),0);
 for(let i=1;i<=20;i++)t.updateDetails(handResult(sample),i*40);
 const before=structuredClone(t.motion.hands.left.basis);
 for(let i=21;i<=40;i++){
  t.updatePose(rotateBody(scene(),1),i*40);
  t.updateDetails(handResult(sample),i*40);
 }
 t.motion.hands.left.basis.forEach((axis,i)=>axis.forEach((x,j)=>assert.ok(Math.abs(x-before[i][j])<1e-8)));
});
test('un giro de perfil no crea un salto de profundidad',()=>{
 const t=new Retargeter();t.updatePose(scene(),0);
 for(let i=1;i<=50;i++)t.updatePose(rotateBody(scene(),i*.03),i*40);
 assert.ok(Math.abs(t.motion.position[2])<1e-8);
});
test('un salto con ambos pies cambia altura y levantar solo uno conserva el apoyo',()=>{
 const t=new Retargeter();for(let time=0;time<=80;time+=40)t.updatePose(scene(),time);
 const one=scene();one.landmarks[0][27].y-=.1;
 for(let i=3;i<=10;i++)t.updatePose(one,i*40);
 assert.ok(Math.abs(t.motion.position[1])<1e-8);
 const both=scene();for(const p of both.landmarks[0])p.y-=.1;
 for(let i=11;i<=22;i++)t.updatePose(both,i*40);
 assert.ok(t.motion.position[1]>.25&&t.motion.position[1]<.65);
 assert.equal(t.motion.jump.count,1);
});
test('el tiempo de procesamiento no se confunde con pérdida de medidas durante un salto',()=>{
 const t=new Retargeter();
 for(let i=0;i<5;i++){t.updatePose(scene(),i*125,640,480,i*125+300);t.decay(i*125+305,.016);}
 const airborne=scene();for(const p of airborne.landmarks[0])p.y-=.1;
 for(let i=5;i<9;i++){t.updatePose(airborne,i*125,640,480,i*125+300);t.decay(i*125+305,.016);}
 assert.equal(t.motion.jump.count,1);assert.equal(t.motion.jump.active,true);
});
test('recuperar al cuerpo toma nueva referencia y suelo sin perder los saltos',()=>{
 const t=new Retargeter();
 for(let i=0;i<5;i++)t.updatePose(scene(),i*100);
 const airborne=scene();for(const p of airborne.landmarks[0])p.y-=.1;
 for(let i=5;i<8;i++)t.updatePose(airborne,i*100);
 assert.equal(t.motion.jump.count,1);
 t.reacquireBody();
 assert.equal(t.motion.jump.count,1);assert.equal(t.motion.jump.calibrated,false);
 assert.deepEqual(t.motion.position,[0,0,0]);assert.deepEqual(t.references,{});
 const returned=scene();for(const p of returned.landmarks[0])p.x+=.05;
 t.updatePose(returned,2000);assert.equal(t.motion.pelvis.visible,true);
 assert.equal(t.motion.jump.count,1);assert.ok(Math.abs(t.motion.position[0])<1e-8);
});
test('secuencias de baile, ruido, oclusiones y giros mantienen límites de movimiento',()=>{
 const t=new Retargeter();t.updatePose(scene(),0);
 const distance=(a,b)=>Math.acos(Math.min(1,Math.max(-1,a.reduce((s,x,i)=>s+x*b[i],0))));
 for(let i=1;i<=600;i++){
  const time=i*50,a=Math.sin(i*.12)*1.2,p=rotateBody(scene({bent:i%40<20}),a);
  p.worldLandmarks[0][23].y+=Math.sin(i*.18)*.03;p.worldLandmarks[0][24].y-=Math.sin(i*.18)*.03;
  if(i%35===0)p.worldLandmarks[0][13]={x:2,y:2,z:2};
  if(i%60<6)for(const index of [23,24,25,27])p.landmarks[0][index].visibility=.05;
  const before=structuredClone(t.motion);t.updatePose(p,time);
  assert.ok(Math.abs(angularDifference(before.yaw,t.motion.yaw))<=5*.05+1e-8);
  for(const [name,value] of Object.entries(t.motion.directions)){
   assert.ok(value.every(Number.isFinite)&&Math.abs(Math.hypot(...value)-1)<1e-7);
   if(before.directions[name])assert.ok(distance(before.directions[name],value)<=(name.endsWith('foot')?18:/(shin|thigh)/.test(name)?24:32)*.05+1e-6);
  }
  assert.ok(t.motion.position.every(Number.isFinite));
 }
});
function angularDifference(a,b){return Math.atan2(Math.sin(b-a),Math.cos(b-a));}
test('muestras corporales fuera de orden no cambian el esqueleto',()=>{
 const t=new Retargeter();t.updatePose(scene(),100);const before=structuredClone(t.motion);
 t.updatePose(rotateBody(scene(),1),80);assert.deepEqual(t.motion,before);
});

test('puño y palma abierta responden aunque la muñeca tenga un giro espurio',()=>{
 const t=new Retargeter(),sample=handSample('left'),result=handResult(sample);
 for(let i=0;i<10;i++)t.updateDetails(result,40+i*40);
 const basis=structuredClone(t.motion.hands.left.basis);
 const changed=structuredClone(result);changed.hands.worldLandmarks[0]=sample.world.map(p=>({x:-p.x,y:p.y,z:-p.z}));
 changed.hands.gestures=[[{categoryName:'Closed_Fist',score:.95}]];
 t.updateDetails(changed,440);
 t.motion.hands.left.basis.forEach((axis,i)=>axis.forEach((x,j)=>assert.ok(Math.abs(x-basis[i][j])<1e-12)));
 assert.ok(t.motion.hands.left.parameters[5]>.5);
 for(let time=480;time<=800;time+=40)t.updateDetails({...result,hands:{...result.hands,gestures:changed.hands.gestures}},time);
 const fist=t.motion.hands.left;
 assert.ok(fist.points[8][1]>-.2&&Math.abs(fist.points[4][0])<.05);
 for(let time=840;time<=1240;time+=40)t.updateDetails({...result,hands:{...result.hands,gestures:[[{categoryName:'Open_Palm',score:.95}]]}},time);
 assert.ok(t.motion.hands.left.parameters[5]<.13&&t.motion.hands.left.points[8][1]<-.28);
});
test('el pulgar se opone en tres dimensiones sin mover el índice',()=>{
 const sample=handSample('left'),initial=handGeometry(sample.landmarks,sample.world,'left',0);
 const moved=structuredClone(sample);moved.world[2].x-=.06;moved.world[3].x-=.10;moved.world[4].x-=.13;
 const next=handGeometry(moved.landmarks,moved.world,'left',0);
 assert.ok(Math.hypot(...initial.points[4].map((x,i)=>x-next.points[4][i]))>.08);
 assert.deepEqual(initial.points[8],next.points[8]);
 segmentLengths(next).forEach((value,i)=>assert.ok(Math.abs(value-segmentLengths(initial)[i])<1e-8));
});
test('una falange oculta de un puño no abre la mano ni bloquea los otros dedos',()=>{
 const t=new Retargeter(),sample=handSample('left'),result=handResult(sample);
 result.hands.gestures=[[{categoryName:'Closed_Fist',score:.95}]];
 for(let i=0;i<10;i++)t.updateDetails(result,40+i*40);
 const hidden=structuredClone(result);hidden.hands.worldLandmarks[0][8]={...hidden.hands.worldLandmarks[0][7]};
 t.updateDetails(hidden,440);
 assert.equal(t.motion.hands.left.validFingers[1],false);assert.equal(t.motion.handVisible.left,true);
 assert.ok(t.motion.hands.left.parameters[5]>1.3&&t.motion.hands.left.parameters[9]>1.3);
});
test('la muñeca de manos corrige la proyección del antebrazo conservando profundidad',()=>{
 const t=new Retargeter(),pose=scene();t.updatePose(pose,0);
 const before=t.motion.directions.left_fore,hand=handSample('left',{x:.8,y:.05});
 t.updateDetails({...handResult(hand),posePoints:pose.landmarks[0],poseVisible:t.motion.visible,poseTime:0},40,640,480);
 assert.equal(t.motion.directions.left_fore[2],before[2]);
 assert.ok(t.motion.directions.left_fore[1]>before[1]);
 assert.ok(Math.abs(Math.hypot(...t.motion.directions.left_fore)-1)<1e-8);
});
test('dedos visiblemente rectos corrigen curvaturas espurias de profundidad',()=>{
 const sample=handSample('left');sample.world[7].z-=.04;sample.world[8].z-=.08;
 const shape=handGeometry(sample.landmarks,sample.world,'left',0);
 assert.ok(shape.parameters[6]<=.12&&shape.parameters[7]<=.12);
});
