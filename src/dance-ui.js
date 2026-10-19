import {DanceSession,danceMotion,cueAt,BEAT,DURATION} from './dance.js';
import {createDanceAudio} from './dance-audio.js';

const $=id=>document.getElementById(id),clock=s=>'0:'+String(Math.ceil(Math.max(0,s))).padStart(2,'0');
function pictogram(move){
 const lines=[];
 for(const [sign,i] of [[-1,0],[1,1]]){
  const a=move.arms[i],b=a+move.bend[i],x=32+sign*8,y=26;
  const ex=x+sign*Math.sin(a)*15,ey=y+Math.cos(a)*15,wx=ex+sign*Math.sin(b)*13,wy=ey+Math.cos(b)*13;
  lines.push(`<path d="M${x} ${y} L${ex.toFixed(2)} ${ey.toFixed(2)} L${wx.toFixed(2)} ${wy.toFixed(2)}"/>`);
 }
 return `<svg viewBox="0 0 64 76" aria-hidden="true"><circle cx="32" cy="13" r="6"/><path d="M24 26H40M32 20V48M32 48L21 68M32 48L43 68"/>${lines.join('')}</svg>`;
}
export function createDanceUI({avatar,ensureCamera,onProfileChange}){
 const session=new DanceSession(),audio=createDanceAudio();let visible=false,busy=false,lastUi=0,lastCue=-1,generation=0;
 const get=()=>({...session.snapshot(performance.now()),stage:avatar.getDanceStage()});
 function stage(practice=false){avatar.setDanceStage(visible,practice);avatar.setDanceTarget(danceMotion(0));$('dance-labels').hidden=!visible||practice;}
 function open(){if(visible){$('dance-panel').scrollIntoView({block:'start'});return;}visible=true;$('dance-panel').hidden=false;document.body.classList.add('dance-on');stage();onProfileChange();update(performance.now(),true);$('dance-panel').scrollIntoView({block:'start',behavior:'smooth'});}
 function close(){generation++;busy=false;audio.stop();session.reset();visible=false;$('dance-panel').hidden=true;document.body.classList.remove('dance-on','dance-running','dance-practice');stage();onProfileChange();}
 async function begin(practice){
  const token=++generation;busy=true;audio.stop();session.reset();update(performance.now(),true);
  if($('dance-sound').checked&&!await audio.unlock()){$('dance-sound').checked=false;$('dance-audio-note').textContent='Audio no disponible · puedes jugar en silencio';}
  try{
   if(!practice&&!await ensureCamera())return;
   if(token!==generation)return;
   session.start(performance.now(),practice);stage(practice);lastCue=-1;
  }finally{if(token===generation){busy=false;update(performance.now(),true);}}
 }
 function update(now,force=false){
  if(!visible)return;
  const s=session.tick(now),targetTime=['arming','countdown','ready'].includes(s.state)?0:s.time;
  document.body.classList.toggle('dance-running',!['ready','finished'].includes(s.state));document.body.classList.toggle('dance-practice',s.practice);
  avatar.setDanceTarget(danceMotion(targetTime));audio.sync(s,$('dance-sound').checked);
  if(!force&&now-lastUi<80)return;lastUi=now;
  $('dance-score').textContent=String(s.score).padStart(5,'0');$('dance-combo').textContent=s.combo+'×';$('dance-time').textContent=clock(DURATION-s.time);
  $('dance-progress').value=s.progress*100;$('dance-progress').setAttribute('aria-valuetext',Math.round(s.progress*100)+'% de la rutina');
  $('dance-beats').style.setProperty('--beat',String((1+Math.cos(s.time/BEAT*Math.PI*2))/2));
  const playing=['playing','finishing'].includes(s.state);
  $('dance-feedback').textContent=s.practice?'Ensayo · sin puntuación':playing?s.feedback:s.state==='arming'?'Muestra hombros, caderas y brazos':s.state==='paused'?(s.reason==='body'?'Vuelve al encuadre · te esperamos':'Pausa'):s.state==='countdown'?'Prepárate…':s.state==='finished'?'¡Rutina terminada!':'Tu primera pista';
  $('dance-status').textContent=busy?'Preparando cámara y cuerpo…':s.state==='arming'?'Quédate visible un momento para empezar':s.state==='countdown'?'Empezamos en '+s.countdown:s.practice?'Mira al guía; aquí no se evalúan movimientos':playing?'Copia al guía como en un espejo':s.state==='paused'?'La música y el reloj están pausados':'Pulso Samurái · música original · 112 BPM';
  $('dance-countdown').hidden=s.state!=='countdown';$('dance-countdown').textContent=s.countdown||'';
  $('dance-play').disabled=busy;$('dance-preview').disabled=busy;
  $('dance-start-live').hidden=!s.practice||s.state==='finished';$('dance-start-live').disabled=busy;
  $('dance-play').textContent=s.state==='finished'?'Volver a jugar':'Jugar con cámara';
  $('dance-pause').hidden=!['arming','countdown','playing','preview','paused'].includes(s.state);
  $('dance-pause').textContent=s.state==='paused'?'Continuar':'Pausar';
  $('dance-results').hidden=s.state!=='finished';
  if(s.state==='finished'){
   $('dance-result-title').textContent=s.practice?'Ensayo terminado':'Tu resultado';
   $('dance-result-score').textContent=s.practice?'Ahora te toca':s.score+' puntos';
   $('dance-stars').textContent=s.practice?'':Array.from({length:5},(_,i)=>i<s.stars?'★':'☆').join(' ');
   $('dance-result-detail').textContent=s.practice?'Enciende la cámara y sigue la misma rutina.':'Mejor combo: '+s.bestCombo+' · '+s.judged+'/'+s.total+' ritmos con una medida válida. '+(s.judged<s.total*.5?'Seguimiento parcial: muestra más del cuerpo para otra ronda.':'¡Prueba otra ronda!');
  }
  const cue=s.cue;
  if(cue.index!==lastCue||force){
   lastCue=cue.index;$('dance-move').textContent=cue.move.label;$('dance-tip').textContent=cue.move.tip;
   $('dance-current-icon').innerHTML=pictogram(cue.move);
   $('dance-next').innerHTML=cue.next.map(move=>`<div class="dance-next-card">${pictogram(move)}<span>${move.label}</span></div>`).join('')||'<p>¡Último movimiento!</p>';
  }
 }
 $('dance-open').onclick=open;$('dance-close').onclick=close;
 $('dance-play').onclick=()=>begin(false);$('dance-preview').onclick=()=>begin(true);
 $('dance-start-live').onclick=()=>begin(false);
 $('dance-pause').onclick=()=>{const now=performance.now();if(session.state==='paused'){audio.unlock();session.resume(now);}else{session.pause(now);audio.stop();}update(now,true);};
 $('dance-sound').onchange=async()=>{if($('dance-sound').checked)await audio.unlock();else audio.stop();};
 document.addEventListener('visibilitychange',()=>{
  if(document.hidden){session.pause(performance.now(),'hidden');audio.stop();}
  else if(visible&&session.state==='paused'&&session.reason==='hidden'&&!session.practice)session.resume(performance.now());
 });
 return {get active(){return visible;},get practice(){return visible&&session.practice;},update,onPose:(m,capture,arrival)=>{if(visible)session.receive(m,capture,arrival);},getState:get,open,
  cameraStopped(){generation++;busy=false;audio.stop();session.reset();if(visible){stage();update(performance.now(),true);}},close};
}
