import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname,'..');
const sdk = path.join(import.meta.dirname,'node_modules/@mediapipe/tasks-vision');
await fs.mkdir(path.join(root,'public/vendor/wasm'),{recursive:true});
await fs.copyFile(path.join(sdk,'vision_bundle.js'),path.join(root,'public/vendor/vision_bundle.js'));
for(const dir of [sdk,path.join(sdk,'wasm')]){
  for(const name of await fs.readdir(dir)){
    if(/^vision_wasm_.*\.(js|wasm)$/.test(name))
      await fs.copyFile(path.join(dir,name),path.join(root,'public/vendor/wasm',name));
  }
}
const models = {
 'pose_lite.task':'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
 'pose_full.task':'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
 'pose_heavy.task':'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
 'gesture.task':'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
 'face.task':'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
};
await fs.mkdir(path.join(root,'public/models'),{recursive:true});
const results = await Promise.allSettled(Object.entries(models).map(async ([name,url])=>{
  const file=path.join(root,'public/models',name);
  try{if((await fs.stat(file)).size>100000){console.log(name+' preparado');return;}}catch{}
  const response=await fetch(url);
  if(!response.ok)throw Error(name+': HTTP '+response.status);
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length<100000)throw Error(name+': archivo incompleto');
  await fs.writeFile(file,bytes);
  console.log(name+' descargado ('+(bytes.length/1048576).toFixed(1)+' MB)');
}));
for(const result of results)if(result.status==='rejected')throw result.reason;
console.log('Modelos y MediaPipe servidos localmente.');
