import test from 'node:test';
import assert from 'node:assert/strict';
import {DanceSession,danceMotion,compareDancePose,cueAt,DURATION,BEAT,BEATS} from '../../src/dance.js';

function playing(){
 const game=new DanceSession();game.start(0);
 for(const t of [0,150,300])game.receive(danceMotion(0),t,t);
 const start=300+BEAT*4000;
 for(let t=450;t<start;t+=150)game.receive(danceMotion(0),t,t);
 game.tick(start);
 assert.equal(game.state,'playing');return {game,start};
}
test('la rutina dura 64 ritmos y todas sus direcciones son finitas y unitarias',()=>{
 assert.equal(DURATION,BEATS*BEAT);assert.equal(cueAt(DURATION).index,15);
 for(let t=0;t<DURATION;t+=.03){
  const m=danceMotion(t);for(const d of Object.values(m.directions))assert.ok(Math.abs(Math.hypot(...d)-1)<1e-9);
  const score=compareDancePose(m,m);assert.equal(score.valid,true);assert.ok(score.accuracy>.9999);
 }
});
test('copiar la rutina puntúa; brazos incorrectos no reciben un perfecto',()=>{
 const {game,start}=playing();
 for(let beat=0;beat<BEATS;beat++){
  const t=(beat+.5)*BEAT,wall=start+t*1000;
  game.tick(wall);game.receive(danceMotion(t),wall,wall);game.tick(wall+50);
 }
 game.tick(start+DURATION*1000);game.tick(start+(DURATION+1)*1000);
 assert.equal(game.state,'finished');assert.equal(game.results.filter(Boolean).length,64);assert.equal(Math.round(game.points),10000);
 const wrong=danceMotion(3);wrong.directions={...wrong.directions,left_upper:[0,-1,0],right_upper:[0,-1,0],left_fore:[0,-1,0],right_fore:[0,-1,0]};
 assert.ok(compareDancePose(wrong,danceMotion(3)).accuracy<.63);
});
test('la sentadilla exige flexión de rodillas y un cuerpo parcial no da cobertura completa',()=>{
 const target=danceMotion(BEAT*26),standing={...target,knees:{left:180,right:180}};
 assert.ok(compareDancePose(standing,target).accuracy<.63);
 const upper=danceMotion(3);upper.visible=new Set([11,12,13,14,15,16,23,24]);
 const result=compareDancePose(upper,danceMotion(3));assert.equal(result.valid,true);assert.ok(result.coverage<.85);
});
test('sin cuerpo, con medidas antiguas o durante el ensayo nunca se inventan puntos',()=>{
 const {game,start}=playing();
 for(let i=0;i<10;i++)game.receive({...danceMotion(0),bodyVisible:false},start+i*40,start+i*40);
 game.receive(danceMotion(0),start+500,start+1500);assert.equal(game.pending.size,0);
 const preview=new DanceSession();preview.start(0,true);
 for(let i=0;i<70;i++){preview.receive(danceMotion(i*BEAT),i*BEAT*1000,i*BEAT*1000);preview.tick(i*BEAT*1000);}
 assert.equal(preview.state,'finished');assert.equal(preview.points,0);assert.equal(preview.results.length,0);
});
test('perder cuerpo pausa música y reloj; regresar exige estabilidad y nueva cuenta atrás',()=>{
 const {game,start}=playing();
 game.tick(start+800);game.tick(start+1500);assert.equal(game.state,'paused');const held=game.snapshot(start+1500).time;
 assert.equal(game.snapshot(start+5000).time,held);
 for(const t of [start+5100,start+5250,start+5400])game.receive(danceMotion(0),t,t);
 assert.equal(game.state,'countdown');
 for(let t=start+5500;t<start+7500;t+=150)game.receive(danceMotion(0),t,t);
 game.tick(start+5400+BEAT*4000);assert.equal(game.state,'playing');
 assert.ok(Math.abs(game.time(start+5400+BEAT*4000)-held)<1e-8);
 const before=game.pending.size;game.receive(danceMotion(0),start+100,start+7600);assert.equal(game.pending.size,before);
});
test('la pausa manual no se reanuda sola y una vista oculta conserva el progreso',()=>{
 const {game,start}=playing();game.pause(start+500,'manual');
 for(const t of [start+800,start+1000,start+1200])game.receive(danceMotion(0),t,t);
 assert.equal(game.state,'paused');assert.equal(game.snapshot(start+8000).time,.5);
 game.resume(start+8000);assert.equal(game.state,'arming');
});
test('la puntuación usa captura y tolera medidas a cinco muestras/s con demora',()=>{
 const {game,start}=playing();let now=start;
 for(let t=.1;t<DURATION-.6;t+=.2){
  now=start+t*1000+180;game.tick(now);game.receive(danceMotion(t),start+t*1000,now);
 }
 game.tick(start+DURATION*1000);game.tick(start+(DURATION+1)*1000);
 assert.equal(game.state,'finished');assert.ok(game.results.filter(Boolean).length>55);assert.ok(game.points>8500);
});
