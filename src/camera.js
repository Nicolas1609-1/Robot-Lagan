export function cameraConstraints(device,supported={}){
 const constraints={width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}};
 // No permitir que el navegador recorte el sensor para cumplir una resolución.
 if(supported.resizeMode)constraints.resizeMode={exact:'none'};
 if(device)constraints.deviceId={exact:device};else constraints.facingMode='user';
 return constraints;
}

export function cameraInfo(track){
 if(!track)return null;
 const settings=track.getSettings?.()||{},capabilities=track.getCapabilities?.()||{};
 const range=capabilities.zoom;
 const zoomAvailable=Number.isFinite(settings.zoom)&&Number.isFinite(range?.min)&&Number.isFinite(range?.max);
 return {width:settings.width||0,height:settings.height||0,frameRate:settings.frameRate||0,
  resizeMode:settings.resizeMode||null,
  zoom:zoomAvailable?{value:settings.zoom,min:range.min,max:range.max}:null,
  zoomStatus:!zoomAvailable?'unavailable':settings.zoom<=range.min+1e-6?'minimum':'enlarged'};
}

export async function minimizeCameraZoom(track){
 const info=cameraInfo(track);
 // Solo usar el control ya expuesto por la cámara y el permiso existente.
 // No solicitar permisos adicionales de pan, inclinación o zoom.
 if(info?.zoomStatus==='enlarged'){
  const constraints=track.getConstraints?.()||{};
  const {zoom,advanced=[],...native}=constraints;
  const other=advanced.map(({zoom,...entry})=>entry).filter(entry=>Object.keys(entry).length);
  await track.applyConstraints({...native,advanced:[...other,{zoom:info.zoom.min}]});
 }
 return cameraInfo(track);
}

export function videoFrameRect(width,height,videoWidth,videoHeight){
 if(!width||!height||!videoWidth||!videoHeight)return null;
 const scale=Math.min(width/videoWidth,height/videoHeight),w=videoWidth*scale,h=videoHeight*scale;
 return {x:(width-w)/2,y:(height-h)/2,width:w,height:h};
}
