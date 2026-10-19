const clip=(x,a,b)=>Math.min(b,Math.max(a,x));
const usable=(p,visible,i)=>visible.has(i)&&p[i]&&[p[i].x,p[i].y].every(Number.isFinite);
const FOOT_POINTS=[[27,29,31],[28,30,32]];

// El suelo se mide en la imagen: los puntos 3D son relativos a las caderas.
export class JumpDetector{
 constructor(){this.reset();}
 reset(keepCount=false){
  const count=keepCount?this.count||0:0;
  Object.assign(this,{floor:null,calibration:[],pending:0,contact:0,active:false,count,height:0,
   state:'waiting',reason:'calibrating',lastTime:null,lastValid:null,lastHip:null,lastRise:0,
   hipSpeed:0,groundHip:null,referenceSpan:null,cooldown:-Infinity,footHistory:[null,null]});
 }
 snapshot(){return {state:this.state,active:this.active,height:this.height,count:this.count,
  calibrated:this.floor!==null,calibration:this.floor?1:Math.min(1,this.calibration.length/3),reason:this.reason};}
 missing(now,dt,reason){
  this.pending=0;this.reason=reason;
  if(now-(this.lastValid??-Infinity)>250){this.height*=Math.exp(-dt*10);if(this.height<.008)this.height=0;}
  if(now-(this.lastValid??-Infinity)>600){this.active=false;this.state='waiting';this.calibration=[];this.lastHip=null;this.hipSpeed=0;}
  return this.snapshot();
 }
 update(p,visible,now){
  if(!Number.isFinite(now)||this.lastTime!==null&&now<=this.lastTime)return this.snapshot();
  const dt=clip(this.lastTime===null?.04:(now-this.lastTime)/1000,.008,.5);this.lastTime=now;
  if(![23,24].every(i=>usable(p,visible,i)))return this.missing(now,dt,'hips_missing');
  const hips=(p[23].y+p[24].y)/2;
  const hasShoulders=[11,12].every(i=>usable(p,visible,i));
  const shoulders=hasShoulders?(p[11].y+p[12].y)/2:null;
  const span=hasShoulders?Math.hypot(hips-shoulders,(p[23].x+p[24].x-p[11].x-p[12].x)/2):this.referenceSpan;
  if(!(span>.06))return this.missing(now,dt,'shoulders_missing');
  const feet=FOOT_POINTS.map(ids=>ids.filter(i=>usable(p,visible,i)));

  if(!this.floor){
   if(!hasShoulders||feet.some(ids=>!ids.length))return this.missing(now,dt,'feet_missing');
   const anchors=feet.map(ids=>Math.max(...ids.map(i=>p[i].y))),last=this.calibration.at(-1);
   if(last&&(anchors.some((y,i)=>Math.abs(y-last.anchors[i])>span*.09)||Math.abs(hips-last.hips)>span*.09))this.calibration=[];
   this.calibration.push({anchors,hips,points:Object.fromEntries(feet.flat().map(i=>[i,p[i].y]))});
   this.reason='calibrating';this.lastHip=hips;
   if(this.calibration.length<3)return this.snapshot();
   this.floor={};
   for(const i of feet.flat()){
    const samples=this.calibration.map(s=>s.points[i]).filter(Number.isFinite);
    this.floor[i]=samples.reduce((s,y)=>s+y,0)/samples.length;
   }
   this.groundHip=hips;this.referenceSpan=span;this.state='grounded';
  }

  const gap=this.lastValid===null?0:now-this.lastValid;
  const hipStep=this.lastHip===null?0:(this.lastHip-hips)/span;
  const measureDt=gap?clip(gap/1000,.008,.5):dt;
  const speed=gap>500?0:hipStep/measureDt,previousSpeed=this.hipSpeed,previousRise=this.lastRise;
  const footRise=feet.map((ids,side)=>{
   const rises=ids.filter(i=>Number.isFinite(this.floor[i])).map(i=>(this.floor[i]-p[i].y)/span);
   if(rises.length)return Math.min(...rises);
   const old=this.footHistory[side];
   // Una oclusión breve durante un despegue observado no cancela el salto.
   if((this.active||this.pending)&&old&&now-old.time<180)return clip(old.rise+(old.hips-hips)/span,-.2,1.2);
   return null;
  });
  if(footRise.some(r=>r===null))return this.missing(now,dt,'feet_missing');
  const rise=Math.min(...footRise),hipRise=(this.groundHip-hips)/span,scale=span/this.referenceSpan;
  if(Math.abs(speed)>9||Math.abs(rise-previousRise)/measureDt>12){this.reason='unstable';this.pending=0;return this.snapshot();}
  this.lastValid=now;this.lastHip=hips;this.hipSpeed=speed;this.lastRise=rise;this.reason='ready';
  feet.forEach((ids,side)=>{if(ids.some(i=>Number.isFinite(this.floor[i])))this.footHistory[side]={rise:footRise[side],hips,time:now};});
  const plausibleScale=scale>.7&&scale<1.4;
  const takingOff=rise>.055&&(hipRise>.03||speed>.4)&&plausibleScale;
  if(!this.active){
   this.pending=takingOff&&now>this.cooldown&&gap<500?this.pending+1:0;
   const trajectory=this.pending===1&&previousRise>.025&&previousSpeed>.2&&rise>.09;
   if(this.pending>=2||trajectory){this.active=true;this.count++;this.contact=0;this.state='airborne';}
   else{
    this.height=this.pending?clip(rise*.8,0,.95):0;this.state=this.pending?'takeoff':'grounded';
    if(!this.pending&&rise<.04){
     for(const ids of feet)for(const i of ids){
      if(this.floor[i]===undefined)this.floor[i]=p[i].y;
      else if((this.floor[i]-p[i].y)/span<.04||!plausibleScale)this.floor[i]+=(p[i].y-this.floor[i])*(1-Math.exp(-dt*2));
     }
     this.groundHip=hips;this.referenceSpan+=(span-this.referenceSpan)*(1-Math.exp(-dt*4));
    }
   }
  }
  if(this.active){
   this.height=clip(rise*.8,0,.95);this.state=speed<-.2?'landing':'airborne';
   this.contact=rise<.035?this.contact+1:0;
   if(this.contact>=2){this.active=false;this.height=0;this.pending=0;this.cooldown=now+140;this.state='grounded';this.groundHip=hips;this.referenceSpan=span;}
  }
  return this.snapshot();
 }
}
