/* Un detector activo por worker; comparación temporal CPU/GPU, sin cola de imágenes. */
// Cambiar esta versión al regenerar SDK o modelos para invalidar la caché.
const ASSET_VERSION='1.1.0-20261014';
const versioned=url=>url+'?v='+ASSET_VERSION;
importScripts(versioned('/vendor/vision_bundle.js'));
const discard=instance=>{try{instance?.close();}catch{/* El contexto GPU ya puede estar perdido. */}};
let task,challenger,comparison,createTask,retryWithSubject=false,poseSensitivity='normal',kind='',delegate='',ready=false;
let appearanceCanvas,appearanceContext;
const poseConfidence=sensitivity=>sensitivity==='high'
 ?{minPoseDetectionConfidence:.35,minPosePresenceConfidence:.30,minTrackingConfidence:.35}
 :{minPoseDetectionConfidence:.5,minPosePresenceConfidence:.45,minTrackingConfidence:.45};
function torsoAppearance(bitmap,p){
 if(!p||![11,12].every(i=>p[i]&&(p[i].visibility??1)>.4))return null;
 const w=bitmap.width,h=bitmap.height,shoulderY=(p[11].y+p[12].y)/2;
 const hips=[23,24].every(i=>p[i]&&(p[i].visibility??1)>.4&&p[i].y<1);
 const bottom=hips?(p[23].y+p[24].y)/2:shoulderY+Math.abs(p[11].x-p[12].x)*w/h*1.15;
 const left=Math.min(p[11].x,p[12].x),right=Math.max(p[11].x,p[12].x);
 const x=Math.max(0,(left+(right-left)*.25)*w),y=Math.max(0,(shoulderY+(bottom-shoulderY)*.25)*h);
 const width=Math.min(w-x,(right-left)*w*.5),height=Math.min(h-y,(bottom-shoulderY)*h*.45);
 if(width<5||height<5)return null;
 if(!appearanceCanvas){appearanceCanvas=new OffscreenCanvas(8,8);appearanceContext=appearanceCanvas.getContext('2d',{willReadFrequently:true});}
 appearanceContext.drawImage(bitmap,x,y,width,height,0,0,8,8);
 const pixels=appearanceContext.getImageData(0,0,8,8).data,channels=[[],[],[]];
 for(let i=0;i<pixels.length;i+=4)for(let c=0;c<3;c++)channels[c].push(pixels[i+c]/255);
 const rgb=channels.map(values=>values.sort((a,b)=>a-b).slice(12,52).reduce((s,x)=>s+x,0)/40);
 const sum=Math.max(.03,rgb.reduce((s,x)=>s+x,0));
 return {rgb:rgb.map(x=>x/sum),brightness:sum/3};
}
function hardwareGPU(){
 try{
  const gl=new OffscreenCanvas(1,1).getContext('webgl2');if(!gl)return false;
  const info=gl.getExtension('WEBGL_debug_renderer_info');
  const name=info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):'';
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return !/SwiftShader|llvmpipe|software/i.test(name);
 }catch{return false;}
}
async function init(config){
 ready=false;discard(task);discard(challenger);task=challenger=null;comparison=null;retryWithSubject=false;kind=config.kind;poseSensitivity=config.sensitivity||'normal';
 const vision={...await Vision.FilesetResolver.forVisionTasks('/vendor/wasm')};
 for(const key of ['wasmLoaderPath','wasmBinaryPath'])if(vision[key])vision[key]=versioned(vision[key]);
 const options={runningMode:'VIDEO'};
 let Task;
 if(kind==='pose'){
  Task=Vision.PoseLandmarker;
  Object.assign(options,{numPoses:1,...poseConfidence(config.sensitivity),
   baseOptions:{modelAssetPath:versioned('/models/pose_'+(['lite','full','heavy'].includes(config.quality)?config.quality:'lite')+'.task')}});
 }else if(kind==='hands'){
  Task=Vision.GestureRecognizer;
  Object.assign(options,{numHands:2,minHandDetectionConfidence:.5,minHandPresenceConfidence:.5,minTrackingConfidence:.5,
   cannedGesturesClassifierOptions:{scoreThreshold:0,maxResults:1},
   baseOptions:{modelAssetPath:versioned('/models/gesture.task')}});
 }else if(kind==='face'){
  Task=Vision.FaceLandmarker;
  Object.assign(options,{numFaces:1,outputFaceBlendshapes:true,minFaceDetectionConfidence:.4,minFacePresenceConfidence:.4,minTrackingConfidence:.4,
   baseOptions:{modelAssetPath:versioned('/models/face.task')}});
 }else throw Error('Detector desconocido');
 createTask=processor=>Task.createFromOptions(vision,{...options,...(kind==='pose'?poseConfidence(poseSensitivity):{}),baseOptions:{...options.baseOptions,delegate:processor}});
 const gpu=!config.cpu&&hardwareGPU();
 let acceleration=config.cpu?'CPU tras recuperación':gpu?'GPU disponible':'GPU no disponible en el detector';
 delegate=gpu?'GPU':'CPU';
 try{task=await Task.createFromOptions(vision,{...options,baseOptions:{...options.baseOptions,delegate}});}
 catch(error){
  if(delegate==='CPU')throw error;delegate='CPU';acceleration='GPU no pudo iniciar; usando CPU';
  task=await Task.createFromOptions(vision,{...options,baseOptions:{...options.baseOptions,delegate}});
 }
 if(delegate==='GPU'){
  // Dos modelos sólo durante seis fotogramas de prueba. Comparan exactamente
  // la misma imagen; después se cierra y libera el detector más lento.
  try{
   challenger=await Task.createFromOptions(vision,{...options,baseOptions:{...options.baseOptions,delegate:'CPU'}});
   comparison=newComparison('startup');acceleration='Comparando CPU y GPU';
  }catch{acceleration='GPU disponible; no pudo compararse con CPU';}
 }
 ready=true;postMessage({type:'ready',kind,delegate,acceleration,benchmarking:!!comparison,
  ...(kind==='face'?{connections:Vision.FaceLandmarker.FACE_LANDMARKS_TESSELATION.map(c=>[c.start,c.end])}:{})});
}
function newComparison(mode){return {mode,models:{[delegate]:task,[delegate==='GPU'?'CPU':'GPU']:challenger},frame:0,costs:{GPU:[],CPU:[]},found:{GPU:0,CPU:0}};}
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]??Infinity;};
const detected=data=>kind==='face'?data.faceLandmarks?.length||0:data.landmarks?.length||0;
function infer(instance,bitmap,time){
 const start=performance.now();
 try{return {data:kind==='hands'?instance.recognizeForVideo(bitmap,time):instance.detectForVideo(bitmap,time),duration:performance.now()-start};}
 catch(error){return {error,duration:Infinity};}
}
function finishComparison(gpu,cpu){
 const g=gpu.error?Infinity:comparison.costs.GPU.length?median(comparison.costs.GPU):gpu.duration;
 const c=cpu.error?Infinity:comparison.costs.CPU.length?median(comparison.costs.CPU):cpu.duration;
 const cpuWins=!!gpu.error||!cpu.error&&(comparison.found.CPU>comparison.found.GPU+1||comparison.found.CPU>=comparison.found.GPU&&c<g*.9);
 const selected=cpuWins?'CPU':'GPU',loser=comparison.models[selected==='GPU'?'CPU':'GPU'];
 retryWithSubject=comparison.mode==='startup'&&!comparison.found.GPU&&!comparison.found.CPU&&!gpu.error&&!cpu.error;
 task=comparison.models[selected];
 discard(loser);challenger=null;comparison=null;delegate=selected;
 postMessage({type:'delegate-selected',kind,delegate,benchmarking:false,
  compute:{GPU:Number.isFinite(g)?Number(g.toFixed(1)):null,CPU:Number.isFinite(c)?Number(c.toFixed(1)):null},
  acceleration:gpu.error?'GPU falló durante la prueba; usando CPU':cpu.error?'CPU no completó la prueba; usando GPU':selected+' seleccionado por medición'});
 return cpuWins?cpu:gpu;
}
let chain=Promise.resolve();
onmessage=({data:message})=>{
 chain=chain.then(async()=>{
  if(message.type==='init')return init(message);
  if(message.type==='compare-subject'){
   if(!ready||comparison)return;
   try{challenger=await createTask(delegate==='GPU'?'CPU':'GPU');comparison=newComparison('subject');postMessage({type:'delegate-comparing',kind});}
   catch{postMessage({type:'delegate-selected',kind,delegate,compute:null,acceleration:delegate+'; no se pudo repetir la comparación'});}
   return;
  }
  if(message.type==='configure'){
   if(kind==='pose'&&ready){poseSensitivity=message.sensitivity;await task.setOptions(poseConfidence(poseSensitivity));if(challenger)await challenger.setOptions(poseConfidence(poseSensitivity));if(comparison)comparison=newComparison(comparison.mode);postMessage({type:'configured',kind,sensitivity:message.sensitivity});}
   return;
  }
  if(message.type!=='frame')return;
  const {bitmap,time,epoch,crop}=message;
  try{
   if(!ready)return postMessage({type:'skipped',kind,epoch});
   const start=performance.now();let inference;
   if(comparison){
    let gpu,cpu;
    // Alternar el orden evita favorecer siempre al primero por caché/calor.
    if(comparison.frame%2){cpu=infer(comparison.models.CPU,bitmap,time);gpu=infer(comparison.models.GPU,bitmap,time);}
    else{gpu=infer(comparison.models.GPU,bitmap,time);cpu=infer(comparison.models.CPU,bitmap,time);}
    comparison.frame++;
    if(comparison.frame>2){
     comparison.costs.GPU.push(gpu.duration);comparison.costs.CPU.push(cpu.duration);
     comparison.found.GPU+=gpu.data?detected(gpu.data):0;comparison.found.CPU+=cpu.data?detected(cpu.data):0;
    }
    inference=comparison.frame>=6||gpu.error||cpu.error?finishComparison(gpu,cpu):gpu.error?cpu:gpu;
   }else inference=infer(task,bitmap,time);
   if(inference.error)throw inference.error;
   const data=inference.data;
   if(!comparison&&retryWithSubject&&detected(data)){retryWithSubject=false;postMessage({type:'benchmark-needed',kind});}
   if(kind==='pose'){
    data.appearances=(data.landmarks||[]).map(p=>torsoAppearance(bitmap,p));
    if(crop)for(const points of data.landmarks||[])for(const p of points){
     p.x=crop.x+p.x*crop.width;p.y=crop.y+p.y*crop.height;p.z*=crop.width;
    }
   }
   if(kind==='hands'){
    // Tasks conserva el lado anatómico del vídeo sin espejo.
    // Reflejar la presentación con CSS no cambia la identidad de la mano.
    if(crop)for(const points of data.landmarks||[])for(const p of points){
     p.x=crop.x+p.x*crop.width;p.y=crop.y+p.y*crop.height;p.z*=crop.width;
    }
   }
   if(kind==='face'&&crop){
    for(const points of data.faceLandmarks||[])for(const p of points){
     p.x=crop.x+p.x*crop.width;p.y=crop.y+p.y*crop.height;p.z*=crop.width;
    }
   }
   postMessage({type:'result',kind,data,time,epoch,duration:performance.now()-start});
  }catch(error){postMessage({type:'frame-error',kind,epoch,message:error.message});}
  finally{bitmap.close();}
 }).catch(error=>postMessage({type:'error',kind,message:error.message}));
};
