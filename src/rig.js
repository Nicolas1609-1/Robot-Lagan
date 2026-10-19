import {relaxedHand,handFromParameters} from './hands.js';

// Las longitudes pertenecen al robot, nunca a una muestra ruidosa de cámara.
export const RIG_LENGTHS=Object.freeze({upper:.48,fore:.43,thigh:.64,shin:.85});
const SIDES=[['left',-1],['right',1]];
const FINGERS=['thumb','index','middle','ring','pinky'];

export function roundedBox(THREE,width,height,depth,radius=.012){
 const w=width/2,h=height/2,r=Math.min(radius,w,h),s=new THREE.Shape();
 s.moveTo(-w+r,-h);s.lineTo(w-r,-h);s.quadraticCurveTo(w,-h,w,-h+r);
 s.lineTo(w,h-r);s.quadraticCurveTo(w,h,w-r,h);s.lineTo(-w+r,h);
 s.quadraticCurveTo(-w,h,-w,h-r);s.lineTo(-w,-h+r);s.quadraticCurveTo(-w,-h,-w+r,-h);
 const g=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.002,bevelThickness:.002,curveSegments:3});
 return g.translate(0,0,-depth/2);
}

// Un solo SkinnedMesh: las placas duras llevan peso 1 en su articulación.
// La columna del núcleo mezcla dos huesos; las placas externas no se deforman.
export function createSamuraiRig(THREE,model){
 const root=new THREE.Group();root.name='samurai';
 const joints={},bones=[],hands={};
 const vec=a=>new THREE.Vector3(...a),down=vec([0,-1,0]);
 function bone(name,parent,position=[0,0,0]){
  const b=new THREE.Bone();b.name=name;b.position.fromArray(position);
  (parent||root).add(b);joints[name]=b;bones.push(b);return b;
 }
 const pelvis=bone('base',null,[0,1.23,0]);
 const spine=bone('spine',pelvis,[0,.15,0]);
 const chest=bone('torso',spine,[0,.60,0]);
 const neck=bone('neck',chest,[0,.40,0]);
 const head=bone('head',neck,[0,.07,0]);bone('jaw',head);
 for(const [side,sign] of SIDES){
  const clavicle=bone(side+'_clavicle',chest,[sign*.4,.25,0]);
  const upper=bone(side+'_upper',clavicle,[sign*.15,0,0]);
  bone(side+'_pauldron',clavicle,[sign*.15,0,0]);
  const fore=bone(side+'_fore',upper,[0,-RIG_LENGTHS.upper,0]);
  const wrist=bone(side+'_hand',fore,[0,-RIG_LENGTHS.fore,0]);
  const thigh=bone(side+'_thigh',pelvis,[sign*.245,0,0]);
  const shin=bone(side+'_shin',thigh,[0,-RIG_LENGTHS.thigh,0]);
  const foot=bone(side+'_foot',shin,[0,-RIG_LENGTHS.shin,0]);
  bone(side+'_toe',foot,[0,0,.20]);
  const rest=relaxedHand(side),chains=[];
  for(let finger=0;finger<5;finger++){
   const start=finger===0?1:5+(finger-1)*4;
   const labels=finger===0?['cmc','mcp','ip','tip']:['mcp','pip','dip','tip'];
   const chain=[];let parent=wrist;
   for(let segment=0;segment<4;segment++){
    const length=segment===0?0:vec(rest.points[start+segment]).distanceTo(vec(rest.points[start+segment-1]));
    const joint=bone(side+'_'+FINGERS[finger]+'_'+labels[segment],parent,
     segment===0?rest.points[start]:[0,-length,0]);
    chain.push(joint);parent=joint;
   }
   chains.push({finger,start,bones:chain,rotations:[]});
  }
  let parameters=rest.parameters,thumb=rest.thumbDirections;
  function update(shape=rest,dt=.016,immediate=false){
   const alpha=immediate?1:1-Math.exp(-dt*40);
   parameters=parameters.map((x,i)=>x+((shape.parameters?.[i]??x)-x)*alpha);
   if(shape.thumbDirections)thumb=thumb.map((direction,i)=>{
    const current=vec(direction),q=new THREE.Quaternion().setFromUnitVectors(current,vec(shape.thumbDirections[i]));
    return current.applyQuaternion(new THREE.Quaternion().slerp(q,alpha)).normalize().toArray();
   });
   const points=handFromParameters(side,parameters,undefined,thumb).points;
   for(const chain of chains){
    if(chain.finger>0){
     const offset=chain.finger*4;
     // Ejes de bisagra: incluso al superar 180° de flexión acumulada,
     // la placa de una falange no cambia de cara ni gira sobre sí misma.
     chain.bones[0].quaternion.setFromAxisAngle(vec([0,0,1]),parameters[offset])
      .multiply(new THREE.Quaternion().setFromAxisAngle(vec([1,0,0]),-parameters[offset+1]));
     for(let segment=1;segment<3;segment++)chain.bones[segment].quaternion.setFromAxisAngle(vec([1,0,0]),-parameters[offset+segment+1]);
     continue;
    }
    let parentRotation=new THREE.Quaternion();
    for(let segment=0;segment<3;segment++){
     const direction=vec(points[chain.start+segment+1]).sub(vec(points[chain.start+segment])).normalize();
     const previous=chain.rotations[segment];
     const rotation=previous?new THREE.Quaternion().setFromUnitVectors(down.clone().applyQuaternion(previous),direction).multiply(previous):new THREE.Quaternion().setFromUnitVectors(down,direction);
     chain.bones[segment].quaternion.copy(parentRotation.clone().invert().multiply(rotation));
     parentRotation.copy(rotation);chain.rotations[segment]=rotation.clone();
    }
   }
  }
  update(rest,.016,true);hands[side]={chains,update};
 }
 root.updateMatrixWorld(true);
 const skeleton=new THREE.Skeleton(bones),boneIndex=new Map(bones.map((b,i)=>[b,i]));
 const data={position:[],normal:[],color:[],skinIndex:[],skinWeight:[]},parts=[],footSupports={left:[],right:[]},kneeSupports={left:[],right:[]};
 function add(geometry,joint,material,name,offset=[0,0,0],blend=null){
  const g=geometry.index?geometry.toNonIndexed():geometry;
  if(!g.attributes.normal)g.computeVertexNormals();
  const matrix=joint.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(...offset));
  const normalMatrix=new THREE.Matrix3().getNormalMatrix(matrix);
  const color=new THREE.Color().setRGB(...model.materials[material],THREE.SRGBColorSpace);
  const begin=data.position.length/3;
  if(name.endsWith('_sole')){
   g.computeBoundingBox();
   const box=g.boundingBox.clone().translate(vec(offset));
   const unique=new Map();
   for(let i=0;i<g.attributes.position.count;i++){
    const p=new THREE.Vector3().fromBufferAttribute(g.attributes.position,i).add(vec(offset));
    unique.set(p.toArray().map(x=>x.toFixed(7)).join(','),p.toArray());
   }
   footSupports[joint.name.split('_')[0]].push({bone:joint.name,min:box.min.toArray(),max:box.max.toArray(),points:[...unique.values()]});
  }
  if(/_knee_(?:cap|axle_)/.test(name)){
   g.computeBoundingBox();const box=g.boundingBox.clone().translate(vec(offset));
   kneeSupports[joint.name.split('_')[0]].push({min:box.min.toArray(),max:box.max.toArray()});
  }
  for(let i=0;i<g.attributes.position.count;i++){
   const local=new THREE.Vector3().fromBufferAttribute(g.attributes.position,i);
   const p=local.clone().applyMatrix4(matrix),n=new THREE.Vector3().fromBufferAttribute(g.attributes.normal,i).applyMatrix3(normalMatrix).normalize();
   data.position.push(...p.toArray());data.normal.push(...n.toArray());data.color.push(color.r,color.g,color.b);
   const weight=blend?THREE.MathUtils.clamp((p.y-1.5)/.75,0,1):1;
   data.skinIndex.push(boneIndex.get(joint),blend?boneIndex.get(blend):0,0,0);
   data.skinWeight.push(weight,1-weight,0,0);
  }
  parts.push({name,bone:joint.name,start:begin,count:data.position.length/3-begin});
  if(g!==geometry)g.dispose();geometry.dispose();
 }
 function solid(joint,material,name,size,position,radius=.012){add(roundedBox(THREE,...size,radius),joint,material,name,position);}
 function horn(points){
  const curve=new THREE.CatmullRomCurve3(points.map(vec)),a=[],b=[];
  for(let i=0;i<=32;i++){
   const t=i/32,p=curve.getPoint(t),tangent=curve.getTangent(t),normal=vec([-tangent.y,tangent.x,0]).normalize();
   const width=.048*(1-t*.55);a.push(p.clone().addScaledVector(normal,width));b.push(p.clone().addScaledVector(normal,-width));
  }
  const shape=new THREE.Shape();shape.moveTo(a[0].x,a[0].y);
  for(const p of a.slice(1))shape.lineTo(p.x,p.y);
  for(const p of b.reverse())shape.lineTo(p.x,p.y);shape.closePath();
  return new THREE.ExtrudeGeometry(shape,{depth:.047,bevelEnabled:true,bevelSize:.004,bevelThickness:.004,bevelSegments:2,curveSegments:2}).translate(0,0,.023);
 }
 for(const item of model.meshes){
  if(/(?:palm|finger_|thumb|_eye|_brow|_horn_|_wrist_band|_elbow_(?:rim|core|pin))|^(?:mouth|helmet)$/.test(item.name))continue;
  if(/_(?:boot|knee_(?:rim|core|pin|cuff))$/.test(item.name))continue;
  let name=item.bone,offset=[0,0,0],blend=null;
  if(name==='base')offset=[0,-1.23,0];
  const hipFlap=/^(left|right)_(?:hip_skirt|skirt_joint_(?:rim|core|pin))$/.exec(item.name);
  if(hipFlap){
   // Placas independientes en cada cadera, ligadas al muslo. Sus posiciones
   // de reposo se conservan, pero ya no quedan inmóviles sobre la pierna elevada.
   const side=hipFlap[1],sign=side==='left'?-1:1;
   name=side+'_thigh';offset=[-sign*.245,-1.23,0];
  }
  if(name==='torso'){
   if(/abdomen/.test(item.name)){name='spine';offset=[0,-1.38,0];}
   else{offset=[0,-1.98,0];if(item.name==='torso_shell'||item.name==='back_spine')blend=spine;}
  }
  // Las aletas quedan en la hombrera: levantar el brazo ya no las gira enteras sobre la cabeza.
  if(/shoulder_(?:shield|edge|rim|core|pin)|blade_|second_fin/.test(item.name))name=item.bone.replace('_upper','_pauldron');
  if(/_ankle_(?:rim|core|pin)$/.test(item.name)){name=item.bone.replace('_foot','_toe');offset=[0,0,-.20];}
  let geometry;
  if(/_(?:bicep|forearm|thigh|shin)$/.test(item.name)){
   const box=new THREE.Box3().setFromPoints(item.vertices.map(vec)),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
   geometry=roundedBox(THREE,size.x,size.y,size.z,.037);
   const positions=geometry.attributes.position;
   for(let i=0;i<positions.count;i++){
    const t=THREE.MathUtils.clamp(positions.getY(i)/size.y+.5,0,1);
    const taper=.84+.16*t;positions.setX(i,positions.getX(i)*taper);positions.setZ(i,positions.getZ(i)*taper);
   }
   geometry.translate(...center.toArray());geometry.computeVertexNormals();
  }else if(/_(?:forearm_plate|shin_plate)$/.test(item.name)){
   const half=item.vertices.length/2,outline=item.vertices.slice(0,half),z=item.vertices[half][2];
   const shape=new THREE.Shape(outline.map(p=>new THREE.Vector2(p[0],p[1])));
   geometry=new THREE.ExtrudeGeometry(shape,{depth:outline[0][2]-z,bevelEnabled:true,bevelSize:.006,bevelThickness:.006,bevelSegments:2,curveSegments:2}).translate(0,0,z);
  }else{
   const vertices=[];
   for(const face of item.faces)for(let i=1;i<face.length-1;i++)for(const index of [face[0],face[i],face[i+1]])vertices.push(...item.vertices[index]);
   geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  }
  if(/_shin(?:_|$)/.test(item.name)){
   const positions=geometry.attributes.position;
   for(let i=0;i<positions.count;i++){
    positions.setX(i,positions.getX(i)*.86);
    if(item.name.endsWith('_shin'))positions.setZ(i,positions.getZ(i)*.88);
    if(item.name.endsWith('_line'))positions.setZ(i,positions.getZ(i)-.055);
   }
   geometry.computeVertexNormals();
  }
  add(geometry,joints[name],item.material,item.name,offset,blend);
 }
 solid(head,'carbon','helmet_shell',[.33,.33,.29],[0,.17,-.015],.085);
 add(horn([[-.045,.31,0],[-.19,.38,0],[-.29,.49,0],[-.34,.57,0]]),head,'gold','left_crescent');
 add(horn([[.045,.31,0],[.20,.39,0],[.31,.54,0],[.33,.69,0],[.27,.82,0]]),head,'gold','right_crescent');
 solid(head,'steel','nose_bridge',[.025,.066,.019],[0,.116,.188],.007);
 for(const [side,sign] of SIDES){
  // Rodillera anclada al muslo y eje lateral: la carcasa de la espinilla
  // puede flexionar debajo sin arrastrar toda la rodilla ni chocar con el muslo.
  solid(joints[side+'_thigh'],'armor',side+'_knee_cap',[.255,.145,.082],[0,-RIG_LENGTHS.thigh,.145],.032);
  for(const [radius,depth,material] of [[.105,.036,'armor'],[.074,.041,'carbon'],[.03,.047,'steel']]){
   const bearing=new THREE.CylinderGeometry(radius,radius,depth,12).rotateZ(Math.PI/2);
   add(bearing,joints[side+'_thigh'],material,side+'_knee_axle_'+material,[sign*.145,-RIG_LENGTHS.thigh,0]);
  }
  // Dos piezas de bota enlazadas al tobillo y al hueso de la punta ya existente.
  solid(joints[side+'_foot'],'red',side+'_boot_heel',[.30,.14,.30],[0,.018,.055],.028);
  solid(joints[side+'_toe'],'red',side+'_boot_toe',[.28,.135,.24],[0,.016,.035],.026);
  solid(joints[side+'_foot'],'carbon',side+'_heel_sole',[.286,.026,.282],[0,-.048,.055],.008);
  solid(joints[side+'_toe'],'carbon',side+'_toe_sole',[.266,.026,.22],[0,-.048,.035],.008);
  // La rueda del codo pertenece al húmero: no gira al pronar el antebrazo.
  for(const [name,radius,depth,material] of [['rim',.09,.048,'armor'],['core',.063,.054,'carbon'],['pin',.025,.060,'steel']]){
   const bearing=new THREE.CylinderGeometry(radius,radius,depth,12).rotateZ(Math.PI/2);
   add(bearing,joints[side+'_upper'],material,side+'_elbow_'+name,[0,-RIG_LENGTHS.upper,0]);
  }
  for(const [part,radius] of [['upper',.098],['fore',.076],['thigh',.108],['shin',.094],['foot',.065]]){
   add(new THREE.SphereGeometry(radius,10,8),joints[side+'_'+part],'carbon',side+'_'+part+'_bearing');
  }
  const wrist=joints[side+'_hand'];
  // Palma compacta, dorso rojo y collar de muñeca. +Z es siempre el interior.
  solid(wrist,'carbon',side+'_palm_core',[.151,.122,.061],[0,-.088,0],.025);
  solid(wrist,'armor',side+'_palm_pad',[.126,.087,.012],[0,-.09,.032],.020);
  solid(wrist,'red',side+'_back_plate',[.137,.098,.015],[0,-.085,-.033],.018);
  add(new THREE.SphereGeometry(.039,10,8),wrist,'carbon',side+'_wrist_bearing');
  solid(joints[side+'_fore'],'steel',side+'_wrist_cuff',[.137,.035,.092],[0,-RIG_LENGTHS.fore+.008,0],.010);
  solid(joints[side+'_fore'],'gold',side+'_wrist_inlay',[.107,.010,.007],[0,-RIG_LENGTHS.fore+.008,.050],.003);
  for(const {finger,bones:chain} of hands[side].chains){
   for(let segment=0;segment<3;segment++){
    const length=chain[segment+1].position.length(),width=(finger===0?.038:.032)-segment*.003;
    add(new THREE.SphereGeometry(width*.48,8,6),chain[segment],'carbon',chain[segment].name+'_hinge');
    solid(chain[segment],'steel',chain[segment].name+'_phalanx',[width,length-.012,.029],[0,-length/2,0],.010);
    solid(chain[segment],'red',chain[segment].name+'_plate',[width*.85,length-.023,.007],[0,-length/2,-.018],.005);
   }
  }
 }
 const geometry=new THREE.BufferGeometry();
 for(const name of ['position','normal','color','skinWeight'])geometry.setAttribute(name,new THREE.Float32BufferAttribute(data[name],name==='skinWeight'?4:3));
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(data.skinIndex,4));
 // Compartir índices idénticos dentro de cada placa permite reutilizar el
 // cálculo de sus vértices en la GPU. No cambia posiciones, pesos ni huesos.
 const drawIndices=new Uint32Array(geometry.attributes.position.count);
 const positionBits=new Uint32Array(geometry.attributes.position.array.buffer),normalBits=new Uint32Array(geometry.attributes.normal.array.buffer);
 for(const part of parts){
  const shared=new Map();
  for(let i=part.start;i<part.start+part.count;i++){
   const j=i*3,key=[positionBits[j],positionBits[j+1],positionBits[j+2],normalBits[j],normalBits[j+1],normalBits[j+2]].join(',');
   const previous=shared.get(key);
   if(previous===undefined){shared.set(key,i);drawIndices[i]=i;}else drawIndices[i]=previous;
  }
 }
 geometry.setIndex(new THREE.BufferAttribute(drawIndices,1));
 const material=new THREE.MeshStandardMaterial({vertexColors:true,metalness:.38,roughness:.48,side:THREE.DoubleSide});
 const lightMaterial=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});
 const mesh=new THREE.SkinnedMesh(geometry,material);mesh.name='samurai_armor';mesh.frustumCulled=false;
 root.add(mesh);mesh.bind(skeleton);mesh.userData.parts=parts;
 // Precalcular una envolvente local por hueso. La unión contiene también
 // vértices con pesos mezclados: cada combinación es una media convexa.
 // Durante el baile sólo se transforman sus ocho esquinas, no toda la piel.
 const boneBounds=bones.map(()=>new THREE.Box3()),point=new THREE.Vector3();
 const positions=geometry.attributes.position,indices=geometry.attributes.skinIndex,weights=geometry.attributes.skinWeight;
 for(let i=0;i<positions.count;i++)for(let slot=0;slot<4;slot++){
  if(weights.getComponent(i,slot)<=0)continue;
  const index=indices.getComponent(i,slot);
  point.fromBufferAttribute(positions,i).applyMatrix4(mesh.bindMatrix).applyMatrix4(skeleton.boneInverses[index]);
  boneBounds[index].expandByPoint(point);
 }
 const boundsCorners=boneBounds.map(box=>box.isEmpty()?[]:
  [box.min.x,box.max.x].flatMap(x=>[box.min.y,box.max.y].flatMap(y=>[box.min.z,box.max.z].map(z=>new THREE.Vector3(x,y,z)))));
 const worldBounds=new THREE.Box3();
 function getBounds(){
  worldBounds.makeEmpty();
  boundsCorners.forEach((corners,index)=>{for(const corner of corners)worldBounds.expandByPoint(point.copy(corner).applyMatrix4(bones[index].matrixWorld));});
  return worldBounds;
 }
 const helper=new THREE.SkeletonHelper(root);helper.name='samurai_skeleton';helper.visible=false;
 helper.setColors(new THREE.Color('#65f1d1'),new THREE.Color('#ffcf61'));helper.renderOrder=10;
 const markers=new THREE.InstancedMesh(new THREE.SphereGeometry(.018,6,4),new THREE.MeshBasicMaterial({color:'#ffcf61',depthTest:false,depthWrite:false}),bones.length);
 markers.name='skeleton_joints';markers.visible=false;markers.frustumCulled=false;markers.renderOrder=11;
 function refresh(){
  root.updateMatrixWorld(true);skeleton.update();
  if(markers.visible){
   const inverse=root.matrixWorld.clone().invert();
   bones.forEach((b,i)=>markers.setMatrixAt(i,new THREE.Matrix4().makeTranslation(...new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(inverse).toArray())));
   markers.instanceMatrix.needsUpdate=true;
  }
 }
 function orient(name,worldQuaternion){
  const b=joints[name];b.parent.updateWorldMatrix(true,false);
  b.quaternion.copy(b.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldQuaternion));
  b.updateWorldMatrix(false,false);
 }
 return {root,joints,skeleton,mesh,helper,markers,hands,footSupports,kneeSupports,refresh,orient,getBounds,
  position:name=>joints[name].getWorldPosition(new THREE.Vector3()),
  setSkeleton(value){helper.visible=value;markers.visible=value;refresh();},
  setLightweight:value=>{mesh.material=value?lightMaterial:material;},
  setWireframe:value=>{material.wireframe=lightMaterial.wireframe=value;}};
}
