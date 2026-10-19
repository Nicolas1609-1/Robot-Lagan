import test from 'node:test';
import assert from 'node:assert/strict';
import {JumpDetector} from '../../src/jump.js';
const visible=new Set([11,12,23,24,27,28]);
function pose({height=0,crouch=0,left=0,right=0,scale=1}={}){
 const points=Array.from({length:33},()=>({x:.5,y:.5}));
 for(const [a,b,y,width] of [[11,12,.3+crouch,.12],[23,24,.55+crouch,.08],[27,28,.9,.08]]){
  points[a]={x:.5-width*scale,y:.9+(y-.9)*scale-height};
  points[b]={x:.5+width*scale,y:.9+(y-.9)*scale-height};
 }
 points[27].y-=left;points[28].y-=right;return points;
}
const ready=()=>{const detector=new JumpDetector();for(let t=0;t<=400;t+=50)detector.update(pose(),visible,t);return detector;};
test('el salto levanta el robot, cuenta una sola vez y termina al aterrizar',()=>{
 const d=ready();
 for(let t=450;t<=900;t+=50)d.update(pose({height:.09}),visible,t);
 assert.equal(d.count,1);assert.equal(d.active,true);assert.ok(d.height>.25);
 for(let t=950;t<=1150;t+=50)d.update(pose(),visible,t);
 assert.equal(d.active,false);assert.equal(d.height,0);assert.equal(d.count,1);
 for(let t=1400;t<=1650;t+=50)d.update(pose({height:.1}),visible,t);
 assert.equal(d.count,2);
});
test('agacharse, ponerse de pie y levantar sólo una pierna no cuentan como salto',()=>{
 const d=ready();
 for(let t=450;t<=750;t+=50)d.update(pose({crouch:.1}),visible,t);
 for(let t=800;t<=950;t+=50)d.update(pose(),visible,t);
 for(let t=1000;t<=1300;t+=50)d.update(pose({left:.15}),visible,t);
 assert.equal(d.count,0);assert.equal(d.height,0);
});
test('subir los pies sentado sin subir las caderas no eleva el robot',()=>{
 const d=ready();
 for(let t=450;t<=900;t+=50)d.update(pose({left:.15,right:.15}),visible,t);
 assert.equal(d.count,0);assert.equal(d.height,0);
});
test('un punto disparado aislado y cambiar de distancia no producen un salto',()=>{
 const d=ready();d.update(pose({height:.2}),visible,450);d.update(pose(),visible,500);
 for(let t=550;t<=1100;t+=50)d.update(pose({scale:.7}),visible,t);
 assert.equal(d.count,0);assert.equal(d.height,0);
});
test('un salto después de agacharse se reconoce aunque no supere la altura inicial de las caderas',()=>{
 const d=ready();for(let t=450;t<=700;t+=50)d.update(pose({crouch:.12}),visible,t);
 d.update(pose({crouch:.08,height:.035}),visible,750);
 for(let t=800;t<=950;t+=50)d.update(pose({crouch:.08,height:.08}),visible,t);
 assert.equal(d.count,1);assert.equal(d.active,true);
});
test('perder los pies mantiene brevemente el salto y después vuelve sin aumentar su altura',()=>{
 const d=ready();for(let t=450;t<=650;t+=50)d.update(pose({height:.1}),visible,t);
 const height=d.height;d.update([],new Set(),750);assert.equal(d.height,height);
 for(let t=850;t<=1700;t+=50)d.update([],new Set(),t);
 assert.equal(d.height,0);assert.equal(d.active,false);assert.equal(d.count,1);
 d.update(pose(),visible,1750);assert.equal(d.count,1);
});
test('la calibración necesita pies estables y funciona a ocho fotogramas por segundo',()=>{
 const d=new JumpDetector();for(let i=0;i<4;i++)d.update(pose(),visible,i*125);
 d.update(pose({height:.09}),visible,500);d.update(pose({height:.11}),visible,625);
 assert.equal(d.count,1);assert.equal(d.active,true);
});
test('la perspectiva no confunde un pie más adelantado con un salto',()=>{
 const d=new JumpDetector(),standing=pose();standing[27].y-=.12;
 for(let t=0;t<=400;t+=50)d.update(standing,visible,t);
 assert.equal(d.state,'grounded');
 const one=structuredClone(standing);one[28].y-=.12;
 for(let t=450;t<=800;t+=50)d.update(one,visible,t);
 assert.equal(d.count,0);assert.equal(d.height,0);
 const airborne=structuredClone(standing);for(const p of airborne)p.y-=.09;
 for(let t=850;t<=1050;t+=50)d.update(airborne,visible,t);
 assert.equal(d.count,1);
});
