import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cameraInfo,minimizeCameraZoom} from '../../src/camera.js';

function camera({value=200,min=100,max=500,allowed=true}={}){
 const applied=[],settings={width:1280,height:720,resizeMode:'none',deviceId:'private-device',groupId:'private-group'};
 if(allowed)settings.zoom=value;
 const constraints={width:{ideal:1280},resizeMode:{exact:'none'},zoom:value,advanced:[{zoom:value},{exposureCompensation:0}]};
 return {applied,getCapabilities:()=>({zoom:{min,max}}),getSettings:()=>settings,getConstraints:()=>constraints,
  async applyConstraints(c){applied.push(c);settings.zoom=c.advanced.at(-1).zoom;}};
}

test('Reducir zoom conserva el encuadre nativo y elimina restricciones de zoom anteriores',async()=>{
 const track=camera(),info=await minimizeCameraZoom(track);
 assert.equal(info.zoomStatus,'minimum');assert.equal(info.zoom.value,100);
 assert.deepEqual(track.applied,[{width:{ideal:1280},resizeMode:{exact:'none'},advanced:[{exposureCompensation:0},{zoom:100}]}]);
});

test('Una cámara sin permiso de zoom no recibe cambios ni peticiones adicionales',async()=>{
 const track=camera({allowed:false});
 assert.equal((await minimizeCameraZoom(track)).zoomStatus,'unavailable');assert.equal(track.applied.length,0);
});

test('Una cámara en zoom mínimo o con zoom fijo no cambia sus restricciones',async()=>{
 for(const track of [camera({value:100}),camera({value:100,min:100,max:100})]){
  assert.equal((await minimizeCameraZoom(track)).zoomStatus,'minimum');assert.equal(track.applied.length,0);
 }
});

test('Una cámara que ignora el ajuste no informa que redujo el zoom',async()=>{
 const track=camera();track.applyConstraints=async()=>{};
 assert.equal((await minimizeCameraZoom(track)).zoomStatus,'enlarged');
});

test('El diagnóstico de encuadre no expone identificadores de dispositivos',()=>{
 const info=cameraInfo(camera());assert.equal(info.width,1280);assert.equal(info.height,720);
 assert.equal(info.deviceId,undefined);assert.equal(info.groupId,undefined);
 assert.equal(cameraInfo(null),null);
});
