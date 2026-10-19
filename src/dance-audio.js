import {BEAT,DURATION} from './dance.js';

// Base rítmica original generada en el equipo; no descarga canciones.
export function createDanceAudio(){
 let context=null,output=null,noise=null,cursor=-1,phase='',sources=new Set();
 function stop(){for(const source of sources)try{source.stop();}catch{}sources.clear();cursor=-1;phase='';}
 async function unlock(){
  try{
   const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Audio)return false;
   if(!context){
    context=new Audio();output=context.createGain();output.gain.value=.22;output.connect(context.destination);
    noise=context.createBuffer(1,Math.ceil(context.sampleRate*.06),context.sampleRate);
    const data=noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length);
   }
   await context.resume();return context.state==='running';
  }catch{return false;}
 }
 function track(source,envelope){sources.add(source);source.onended=()=>{sources.delete(source);source.disconnect();envelope.disconnect();};}
 function tone(at,hz,duration,type='sine',gain=.5,endHz=hz){
  const oscillator=context.createOscillator(),envelope=context.createGain();oscillator.type=type;
  oscillator.frequency.setValueAtTime(hz,at);oscillator.frequency.exponentialRampToValueAtTime(Math.max(15,endHz),at+duration);
  envelope.gain.setValueAtTime(.0001,at);envelope.gain.exponentialRampToValueAtTime(gain,at+.007);envelope.gain.exponentialRampToValueAtTime(.0001,at+duration);
  oscillator.connect(envelope).connect(output);oscillator.start(at);oscillator.stop(at+duration+.01);track(oscillator,envelope);
 }
 function hat(at){const source=context.createBufferSource(),gain=context.createGain();source.buffer=noise;gain.gain.value=.22;source.connect(gain).connect(output);source.start(at);track(source,gain);}
 function sync(snapshot,enabled){
  const nextPhase=['playing','preview'].includes(snapshot.state)?'song':snapshot.state==='countdown'?'countdown':'';
  if(!enabled||!context||context.state!=='running'||!nextPhase){if(sources.size||phase)stop();return;}
  if(phase!==nextPhase){stop();phase=nextPhase;}
  if(nextPhase==='countdown'){
   if(cursor!==snapshot.countdown){cursor=snapshot.countdown;tone(context.currentTime,720,.08,'sine',.45);}
   return;
  }
  const time=snapshot.time;if(time>=DURATION){stop();return;}
  const first=Math.ceil(time/(BEAT/2));
  for(let step=Math.max(first,cursor+1);step*BEAT/2<Math.min(time+.15,DURATION);step++){
   const at=context.currentTime+Math.max(0,step*BEAT/2-time),beat=Math.floor(step/2);cursor=step;
   hat(at);
   if(step%2===0){
    tone(at,140,.19,'sine',.85,42);
    const bass=[55,55,65.41,49][Math.floor(beat/4)%4];tone(at,bass,.22,'triangle',.22);
    const melody=[220,261.63,329.63,293.66,261.63,220,196,261.63][beat%8];tone(at,melody,.16,'triangle',.11);
   }
   if(step%4===2)tone(at,180,.065,'triangle',.15,110);
  }
 }
 return {unlock,sync,stop};
}
