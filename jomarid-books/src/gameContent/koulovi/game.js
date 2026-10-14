const W=540,H=960,F=750,DANGER=430,DROP_Y=330,AL=70,AR=470,BL=130,BR=410,TOP=500,NP=8;
const WS=[[AL,TOP,BL,F+16],[BL,F+16,BR,F+16],[BR,F+16,AR,TOP]];
const RAD=[24,29,35,41,48,56,65,74,83,92,100,108],COL=['#6ec6ff','#7ddc5a','#c76be0','#e8383d','#f58a3c','#f7e35a','#ffffff','#4de3d0','#ff7eb6','#2b2f5e','#3a3a4a','#161616','#111'],CV=[1,2,5,10,20,40,80,150,300,600,1200,2500],GL=['🪐','🌙','🔱'];
const PTS=[10,20,40,80,160,320,640,1280,2560,5120,10240,20480];
const $=id=>document.getElementById(id),cv=$('c'),ctx=cv.getContext('2d'),stage=$('stage');
const KEY='koulovi-kamosi-v1';
let S;try{S=JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){}
S=S||{best:0,games:0,merges:0,log:[]};S.bm=S.bm||{};S.mute=S.mute||0;S.coins=S.coins||0;S.disc=S.disc||0;S.inv=S.inv||{undo:1,shake:1,pop:1,hit:1};
const hasJb=()=>typeof window.jomaridBalance==='number';
window.onJomaridBalance=()=>{$('jbn').textContent=window.jomaridBalance;$('jb').classList.remove('hide')};
if(hasJb())window.onJomaridBalance();
// Zapíše nový nejlepší výsledek režimu a při rekordu (od 100 bodů, mimo Zen) požádá o odměnu; stejně se volá při odchodu do menu i na konci hry,
// takže rekord z přerušené hry o odměnu nepřijde.
const bump=(m,sc)=>{if(sc<=(S.bm[m]||0))return 0;S.bm[m]=sc;if(m!=='zen'&&sc>=100&&typeof jomaridReward==='function')jomaridReward('record',3);return 1};
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}};
function stats(){const d=new Date();d.setHours(0,0,0,0);const mx=t=>S.log.reduce((m,[ts,sc])=>ts>=t?Math.max(m,sc):m,0);
 $('sT').textContent=mx(d.getTime());$('sW').textContent=mx(Date.now()-6048e5);$('sA').textContent=S.best;$('sG').textContent=S.games;$('sM').textContent=S.merges;$('cn').textContent=S.coins;$('snd').textContent=S.mute?'🔇':'🔊';$('cont').classList.toggle('hide',!S.run);if(S.run)$('cont').textContent='Pokračovat · '+MODES.find(m=>m[0]===S.run.mode)[1]+' · '+S.run.score}
$('mas').innerHTML=[3,4,5,6,2].map(t=>{const s=[50,60,70,80,55][t%5];return `<div class="b" style="width:${s/16}em;height:${s/16}em;background:${COL[t]};animation-delay:${t*.2}s"><span style="left:14%"></span><span style="right:14%"></span></div>`}).join('');
function fit(){const w=document.body.clientWidth,h=document.body.clientHeight,k=Math.min(w/W,h/H);stage.style.width=W*k+'px';stage.style.height=H*k+'px';stage.style.fontSize=k*16+'px'}
addEventListener('resize',fit);fit();
// prerender
const bg=document.createElement('canvas');bg.width=W;bg.height=H;{const x=bg.getContext('2d');x.fillStyle='#e6e4df';x.fillRect(0,0,W,H);x.strokeStyle='#d4d1ca';x.lineWidth=2;for(let i=0;i<=W;i+=40){x.beginPath();x.moveTo(i,0);x.lineTo(i,H);x.stroke()}for(let i=0;i<=H;i+=40){x.beginPath();x.moveTo(0,i);x.lineTo(W,i);x.stroke()}}
const pc=document.createElement('canvas');pc.width=pc.height=14;{const p=pc.getContext('2d');p.fillStyle='#111';p.fillRect(0,0,14,14);p.strokeStyle='#fff';p.lineWidth=3;p.beginPath();p.moveTo(0,14);p.lineTo(14,0);p.stroke()}
const pat=ctx.createPattern(pc,'repeat');
// state
let st='menu',g,acc=0,last=0;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rnd=m=>{const a=m==='chaos'?[0,1,1,2,2,3,4,5]:[0,0,0,1,1,2,3];return a[Math.random()*a.length|0]};
// Zlatá koule: vzácný bonus jako v ostatních hrách (vzácná bonusová mince, krystal, zlaté kliknutí). Spojíš ji jako každou jinou a za to dostaneš 🔶 i 🪙.
// Jen mimo Zen, nejvýš GOLD.max za hru a vždy jen jedna naráz (držená, další nebo v misce).
const GOLD={p:.04,max:3,jc:4,coins:25};
const goldRoll=()=>g.mode!=='zen'&&g.gn<GOLD.max&&!g.cG&&!g.nG&&!g.balls.some(b=>b.gold)&&Math.random()<GOLD.p?(g.gn++,1):0;
function snd(f,d=.12,ty='sine',v=.08){try{if(S.mute)return;window.ac=window.ac||new(window.AudioContext||window.webkitAudioContext)();const a=window.ac,o=a.createOscillator(),gn=a.createGain();o.type=ty;o.frequency.value=f;gn.gain.setValueAtTime(v,a.currentTime);gn.gain.exponentialRampToValueAtTime(.001,a.currentTime+d);o.connect(gn);gn.connect(a.destination);o.start();o.stop(a.currentTime+d)}catch(e){}}
const SUB=5,GR=.096,KR=3.8,KS=2.2,KO=1.4,CD=.07,KP=6,KM=.004,COR=.5,ch=g=>2*Math.sin(g*Math.PI/NP),SP=[];
for(let i=0;i<NP;i++){SP.push([i,(i+1)%NP,KR,ch(1)],[i,(i+2)%NP,KS,ch(2)]);if(i<NP/2)SP.push([i,i+NP/2,KO,2])}
const mk=(x,y,t,k=1)=>{const r=RAD[t],R=r/1.8,b={x,y,vx:0,vy:0,t,r,R,pr:R*.8,m:(r/30)**2,rr:r,age:0,ph:Math.random()*6.3,A0:.5*NP*R*R*Math.sin(6.2832/NP),P:[]};for(let i=0;i<NP;i++){const a=i/NP*6.2832;b.P.push({x:x+Math.cos(a)*R*k,y:y+Math.sin(a)*R*k,vx:0,vy:0})}return b};
const cl=b=>({...b,P:b.P.map(p=>({...p}))});
const bowl={sq:0,vs:0,r:0,vr:0},kick=p=>{bowl.vs+=p*.004;bowl.vr+=(Math.random()-.5)*p*.003};
function soft(b){const P=b.P,R=b.R;
 for(const[i,j,k,c]of SP){const p=P[i],q=P[j],dx=q.x-p.x,dy=q.y-p.y,d=Math.hypot(dx,dy)||.01,ux=dx/d,uy=dy/d,a=k*(d/(R*c)-1)+CD*((q.vx-p.vx)*ux+(q.vy-p.vy)*uy);p.vx+=ux*a;p.vy+=uy*a;q.vx-=ux*a;q.vy-=uy*a}
 let A=0;for(let i=0;i<NP;i++){const p=P[i],q=P[(i+1)%NP];A+=p.x*q.y-q.x*p.y}A=Math.max(A/2,b.A0*.25);const pf=KP*(b.A0/A-1)*.5;
 for(let i=0;i<NP;i++){const p=P[i],q=P[(i+1)%NP],ex=q.x-p.x,ey=q.y-p.y,l=Math.hypot(ex,ey)||.01,f=pf*l/(R*ch(1)),nx=ey/l*f,ny=-ex/l*f;p.vx+=nx;p.vy+=ny;q.vx+=nx;q.vy+=ny}
 for(let i=0;i<NP;i++){const p=P[i],a=i/NP*6.2832;p.vx+=(b.x+Math.cos(a)*R-p.x)*KM;p.vy+=(b.y+Math.sin(a)*R-p.y)*KM+GR;p.vx*=.997;p.vy*=.997;const s=Math.hypot(p.vx,p.vy);if(s>12){p.vx*=12/s;p.vy*=12/s}}
 if(Math.random()<.002){const p=P[Math.random()*NP|0];p.vx+=(Math.random()-.5)*2;p.vy+=(Math.random()-.5)*2}
 for(const p of P){p.x+=p.vx;p.y+=p.vy}}
function wall(p,rad,x0,y0,x1,y1,b){const dx=x1-x0,dy=y1-y0,t=clamp(((p.x-x0)*dx+(p.y-y0)*dy)/(dx*dx+dy*dy),0,1),ex=p.x-x0-dx*t,ey=p.y-y0-dy*t,d=Math.hypot(ex,ey)||.01,m=rad+16;
 if(d<m){const nx=ex/d,ny=ey/d,vn=p.vx*nx+p.vy*ny;p.x+=nx*(m-d);p.y+=ny*(m-d);if(vn<0){p.vx-=vn*nx*1.05;p.vy-=vn*ny*1.05;const vt=p.vx*-ny+p.vy*nx;p.vx-=-ny*vt*.1;p.vy-=nx*vt*.1;if(vn<-2.5)kick(-vn*b.r*.004)}}}
function coll(a,b){const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),m=a.r+b.r;if(d>m*1.3)return;
 if(a.t===b.t&&a.t<11&&d>m*.95){const f=.012/d;for(const p of a.P){p.vx+=dx*f;p.vy+=dy*f}for(const p of b.P){p.vx-=dx*f;p.vy-=dy*f}}
 const ia=1/a.m,ib=1/b.m,wa=ia/(ia+ib),wb=1-wa,rr=a.pr+b.pr;
 for(const p of a.P)for(const q of b.P){const ex=q.x-p.x,ey=q.y-p.y,e2=ex*ex+ey*ey;if(e2<rr*rr){const e=Math.sqrt(e2)||.01,nx=ex/e,ny=ey/e,ov=(rr-e)*COR;p.x-=nx*ov*wa;p.y-=ny*ov*wa;q.x+=nx*ov*wb;q.y+=ny*ov*wb;const vn=(q.vx-p.vx)*nx+(q.vy-p.vy)*ny;if(vn<0){const j=-1.1*vn/(ia+ib);p.vx-=j*ia*nx;p.vy-=j*ia*ny;q.vx+=j*ib*nx;q.vy+=j*ib*ny}}}}
function cm(b){let x=0,y=0,vx=0,vy=0;for(const p of b.P){x+=p.x;y+=p.y;vx+=p.vx;vy+=p.vy}b.x=x/NP;b.y=y/NP;b.vx=vx/NP;b.vy=vy/NP;let r=0;for(const p of b.P)r+=Math.hypot(p.x-b.x,p.y-b.y);b.rr=r/NP+b.pr*.92}
function start(m='classic'){g={mode:m,f:0,cT:999,cb:0,t:5400,left:30,balls:[],score:0,cur:rnd(m),next:rnd(m),cG:0,nG:0,gn:0,gr:0,aimX:W/2,aiming:false,cool:0,overT:0,merges:0,snap:null,pp:[],pt:[],disc:null,tgt:false,gain:null};st='play';$('modes').classList.add('hide');$('menu').classList.add('hide');$('over').classList.add('hide')}
function finish(nat){if(st==='over')return;S.run=null;const v=g.balls.reduce((s,b)=>s+CV[b.t],0);if(g.gain==null){g.gain=g.mode==='zen'?0:nat?v:v>>2;S.coins+=g.gain}st='over';snd(120,.5,'sawtooth',.07);$('oT').textContent=g.cashed?'Vybráno!':g.mode==='time'?'Čas vypršel!':g.mode==='drops'?'Hody došly!':'Koule vypadla!';if(g.score>0){S.log.push([Date.now(),g.score]);S.log=S.log.slice(-200)}const nb=bump(g.mode,g.score);S.best=Math.max(S.best,g.score);S.games++;S.merges+=g.merges;save();
 $('oS').textContent=g.score;$('oB').textContent=(nb?'Nový rekord! ':'')+(g.mode==='zen'?'':'+'+g.gain+' 🪙'+(g.gain<v?' (ze '+v+')':''));$('over').classList.remove('hide')}
function toMenu(){if(st==='play'){saveRun();S.best=Math.max(S.best,g.score);bump(g.mode,g.score);save()}st='menu';stats();$('over').classList.add('hide');$('menu').classList.remove('hide')}
const MODES=[['classic','Klasika','Prohraješ, když koule vypadne'],['time','Časovka','90 sekund na co nejvíc bodů'],['drops','30 hodů','Máš jen 30 koulí'],['chaos','Chaos','Větší koule a zemětřesení'],['zen','Zen','Bez prohry, spadlé koule zmizí']];
function modes(){$('ml').innerHTML=MODES.map(([k,n,d])=>`<button class='sec' data-m='${k}' style='display:block;width:100%;font-size:1.1em;margin:.35em 0;padding:.3em .6em;text-align:left'>${n} <span style='float:right'>🏆 ${S.bm[k]||0}</span><br><i style='font-size:.6em;font-style:normal;opacity:.9'>${d}</i></button>`).join('')}
$('ml').onclick=e=>{const k=(e.target.closest('button')||{dataset:{}}).dataset.m;if(k)start(k)};
$('play').onclick=()=>{$('menu').classList.add('hide');$('modes').classList.remove('hide');modes()};
$('mback').onclick=()=>{$('modes').classList.add('hide');$('menu').classList.remove('hide')};
$('snd').onclick=()=>{S.mute^=1;save();stats()};
$('again').onclick=()=>start(g.mode);$('cont').onclick=resume;addEventListener('pagehide',saveRun);document.addEventListener('visibilitychange',()=>{if(document.hidden)saveRun()});$('tomenu').onclick=toMenu;
const ITEMS=[['undo','↶ Zpět','Vrátí poslední tah',50],['shake','≋ Zatřes','Zatřese koulemi',40],['pop','✕ Smaž nejmenší','Odstraní nejmenší koule',80],['hit','◎ Zásah','Klepni na kouli a zmizí',100]];
function shop(){$('cn2').textContent=$('cn').textContent=S.coins;$('items').innerHTML=ITEMS.map(([k,n,d,p])=>`<div style='display:flex;justify-content:space-between;align-items:center;margin:.5em 0;font-size:1.2em'><span style='text-align:left'>${n} ×${S.inv[k]}<br><i style='font-size:.6em;font-style:normal;opacity:.85'>${d}</i></span><button class='sec' style='font-size:.9em;padding:.2em .7em' data-k='${k}' data-p='${p}'>${p} 🪙</button></div>`).join('')}
$('items').onclick=e=>{const k=e.target.dataset.k;if(!k)return;const p=+e.target.dataset.p;if(S.coins>=p){S.coins-=p;S.inv[k]++;save();shop()}};
$('shopb').onclick=()=>{$('menu').classList.add('hide');$('shop').classList.remove('hide');shop()};
$('shopx').onclick=()=>{$('shop').classList.add('hide');$('menu').classList.remove('hide');stats()};
function cashOut(){if(!g.balls.length)return;if(!(g.cc>g.f)){g.cc=g.f+150;return}const v=g.mode==='zen'?0:g.balls.reduce((s,b)=>s+CV[b.t],0);S.coins+=v;g.gain=v;g.cashed=1;finish()}
function fx(x,y,v,c){if(v)g.pp.push({x,y,v,l:50});for(let i=0;i<10;i++){const a=Math.random()*6.28,s=1+Math.random()*3;g.pt.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-1,l:30,c})}}
function saveRun(){if(st!=='play'||!(g.balls.length+g.score))return;S.run={mode:g.mode,score:g.score,cur:g.cur,next:g.next,cG:g.cG,nG:g.nG,gn:g.gn,gr:g.gr,merges:g.merges,f:g.f,t:g.t,left:g.left,balls:g.balls.map(b=>({t:b.t,ph:b.ph,gold:b.gold?1:0,P:b.P.map(p=>[+p.x.toFixed(1),+p.y.toFixed(1),+p.vx.toFixed(2),+p.vy.toFixed(2)])}))};save()}
function resume(){const r=S.run;if(!r)return;start(r.mode);Object.assign(g,{score:r.score,cur:r.cur,next:r.next,cG:r.cG|0,nG:r.nG|0,gn:r.gn|0,gr:r.gr|0,merges:r.merges,f:r.f,t:r.t,left:r.left});g.balls=r.balls.map(o=>{const b=mk(0,0,o.t);b.ph=o.ph;if(o.gold)b.gold=1;o.P.forEach((q,i)=>Object.assign(b.P[i],{x:q[0],y:q[1],vx:q[2],vy:q[3]}));cm(b);b.age=999;return b})}
function drop(){if(g.cool>0||(g.mode==='drops'&&g.left<=0))return;g.snap={balls:g.balls.map(cl),score:g.score,cur:g.cur,next:g.next,cG:g.cG,nG:g.nG,left:g.left,merges:g.merges,cb:g.cb,cT:g.cT};const r=RAD[g.cur],nb=mk(clamp(g.aimX,AL+r+6,AR-r-6),DROP_Y,g.cur);if(g.cG)nb.gold=1;g.balls.push(nb);g.cur=g.next;g.cG=g.nG;g.next=rnd(g.mode);g.nG=0;if(goldRoll()){g.nG=1;g.pp.push({x:W/2,y:300,v:0,l:90,s:'Zlatá koule je na řadě!',c:'#ffd92e'})}g.cool=35;g.left--;snd(260,.08,'triangle')}
function step(){g.cool--;g.f++;g.cT++;if(g.f%180===0)saveRun();const B=g.balls;if(g.mode==='time'&&--g.t<=0){finish(1);return}if(g.mode==='drops'&&g.left<=0&&g.cool<-150){finish(1);return}if(g.mode==='chaos'&&g.f%600===0){kick(40);g.pp.push({x:W/2,y:600,v:0,l:70,s:'ZEMĚTŘESENÍ!'});for(const b of B)for(const p of b.P){p.vy-=1+Math.random()*1.5;p.vx+=(Math.random()-.5)*3}}
 for(let s=0;s<SUB;s++){for(const b of B){soft(b);for(const p of b.P)for(const w of WS)wall(p,b.pr,...w,b)}
  for(let i=0;i<B.length;i++)for(let j=i+1;j<B.length;j++)coll(B[i],B[j]);for(const b of B)cm(b)}
 const mg=[];for(let i=0;i<B.length;i++)for(let j=i+1;j<B.length;j++){const a=B[i],b=B[j];if(!a.dead&&!b.dead&&a.t===b.t&&a.t<11&&Math.hypot(a.x-b.x,a.y-b.y)<(a.r+b.r)*1.02){a.dead=b.dead=1;mg.push([a,b])}}
 for(const[a,b]of mg){const n=mk((a.x+b.x)/2,(a.y+b.y)/2,a.t+1,1.2);for(const p of n.P){p.vx=(a.vx+b.vx)/2;p.vy=(a.vy+b.vy)/2}cm(n);n.age=999;kick(n.r*.2);g.cb=g.cT<100?g.cb+1:1;g.cT=0;const mu=Math.min(g.cb,5),pv=PTS[a.t]*mu;fx(n.x,n.y,pv,COL[n.t]);if(mu>1)g.pp[g.pp.length-1].s='+'+pv+' x'+mu;snd(330+n.t*55,.2,'sine',.1);navigator.vibrate&&navigator.vibrate(12);if(n.t>S.disc){S.disc=n.t;g.disc={t:n.t,l:150};if(g.mode!=='zen'){S.coins+=n.t*10;if(typeof jomaridReward==='function')jomaridReward('discover',2+(n.t>>2))}save()}if((a.gold||b.gold)&&g.mode!=='zen'&&g.gr<GOLD.max){g.gr++;S.coins+=GOLD.coins;g.pp.push({x:n.x,y:n.y-50,v:0,l:80,s:'+'+GOLD.jc+' 🔶',c:'#ffd92e'});if(typeof jomaridReward==='function')jomaridReward('golden_ball',GOLD.jc);save()}B.push(n);g.score+=pv;g.merges++}
 if(mg.length)g.balls=B.filter(b=>!b.dead);
 bowl.vs-=bowl.sq*.15;bowl.vs*=.9;bowl.sq+=bowl.vs;bowl.vr-=bowl.r*.12;bowl.vr*=.9;bowl.r+=bowl.vr;
 for(const p of g.pt){p.x+=p.vx;p.y+=p.vy;p.vy+=.1;p.l--}for(const p of g.pp){p.y-=1;p.l--}g.pt=g.pt.filter(p=>p.l>0);g.pp=g.pp.filter(p=>p.l>0);
 let danger=false;for(const b of g.balls){b.age++;if(b.y>F+40){if(g.mode==='zen')b.dead=1;else danger=true}}if(g.mode==='zen')g.balls=g.balls.filter(b=>!b.dead);
 g.overT=danger?g.overT+1:0;if(g.overT>45)finish();}
function ability(k){if(st!=='play'||!S.inv[k])return;if(k==='hit'){if(g.balls.length)g.tgt=!g.tgt;return}
 if(k==='undo'){if(!g.snap)return;Object.assign(g,{balls:g.snap.balls,score:g.snap.score,cur:g.snap.cur,next:g.snap.next,cG:g.snap.cG,nG:g.snap.nG,left:g.snap.left,merges:g.snap.merges,cb:g.snap.cb,cT:g.snap.cT,snap:null,cool:0})}
 if(k==='shake')for(const b of g.balls){const ax=(Math.random()-.5)*8,ay=-3-Math.random()*4;for(const p of b.P){p.vx+=ax;p.vy+=ay}}
 if(k==='shake')kick(40);if(k==='pop'&&g.balls.length){const m=Math.min(...g.balls.map(b=>b.t));g.balls=g.balls.filter(b=>b.t!==m)}
 S.inv[k]--;save()}
const BTN=[['undo','↶'],['shake','≋'],['pop','✕'],['hit','◎']],BX=i=>24+i*88;
function pt(e){const r=cv.getBoundingClientRect();return[(e.clientX-r.left)/r.width*W,(e.clientY-r.top)/r.height*H]}
cv.addEventListener('pointerdown',e=>{if(st!=='play')return;if(g.disc){g.disc=null;return}const[x,y]=pt(e);
 if(y>880){BTN.forEach(([k],i)=>{if(x>BX(i)&&x<BX(i)+64)ability(k)});if(x>384)cashOut();return}
 if(x>430&&y<90){toMenu();return}
 if(g.tgt){const b=g.balls.find(b=>Math.hypot(b.x-x,b.y-y)<b.r);if(b){g.balls=g.balls.filter(q=>q!==b);fx(b.x,b.y,0,COL[b.t]);S.inv.hit--;save()}g.tgt=false;return}g.aiming=true;g.pid=e.pointerId;g.aimX=x;cv.setPointerCapture(e.pointerId)});
cv.addEventListener('pointermove',e=>{if(st==='play'&&g.aiming&&e.pointerId===g.pid)g.aimX=pt(e)[0]});
cv.addEventListener('pointerup',e=>{if(st==='play'&&g.aiming&&e.pointerId===g.pid){g.aimX=pt(e)[0];g.aiming=false;drop()}});
cv.addEventListener('pointercancel',e=>{if(g.aiming&&e.pointerId===g.pid)g.aiming=false});
// drawing
function rr(x,y,w,h,r,f){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=f;ctx.fill();ctx.lineWidth=4;ctx.strokeStyle='#111';ctx.stroke()}
function txt(s,x,y,sz,al='left',fill='#fff'){ctx.font=sz+"px 'Lilita One',Impact,sans-serif";ctx.textAlign=al;ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=sz/4;ctx.strokeStyle='#111';ctx.strokeText(s,x,y);ctx.fillStyle=fill;ctx.fillText(s,x,y)}
function ball(x,y,r,t,lx=0,ly=1,off,bl=1,gd){ctx.save();ctx.translate(x,y);ctx.beginPath();
 if(off){const P=off;const m=(p,q)=>[(p[0]+q[0])/2,(p[1]+q[1])/2];let s=m(P[NP-1],P[0]);ctx.moveTo(s[0],s[1]);for(let i=0;i<NP;i++){const e=m(P[i],P[(i+1)%NP]);ctx.quadraticCurveTo(P[i][0],P[i][1],e[0],e[1])}ctx.closePath()}else ctx.arc(0,0,r,0,7);
 ctx.fillStyle=COL[t];ctx.fill();ctx.lineWidth=Math.max(3,r*.12);ctx.strokeStyle='#111';ctx.stroke();
 if(gd){ctx.shadowColor='#ffd92e';ctx.shadowBlur=18+6*Math.sin(performance.now()/180);ctx.lineWidth=Math.max(4,r*.2);ctx.strokeStyle='#ffd92e';ctx.stroke();ctx.shadowBlur=0;ctx.strokeStyle='#111'}
 ctx.fillStyle='rgba(255,255,255,.5)';ctx.beginPath();ctx.ellipse(-r*.5,-r*.5,r*.2,r*.1,-.7,0,7);ctx.fill();
 if(t>8){if(t===12)txt('?',0,r*.05,r*1.2,'center');else{ctx.font=r*1.1+'px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff';ctx.fillText(GL[t-9],0,r*.05)}}else{
  for(const s of[-1,1]){const ex=s*r*.32,ey=-r*.12,er=r*.24;ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(ex,ey,er,er*bl,0,0,7);ctx.fill();ctx.lineWidth=Math.max(1.5,r*.05);ctx.stroke();
   ctx.fillStyle='#111';ctx.beginPath();ctx.ellipse(ex+clamp(lx,-1,1)*er*.4,ey+clamp(ly,-1,1)*er*.4,er*.5,er*.5*bl,0,0,7);ctx.fill()}
  ctx.lineWidth=Math.max(2,r*.06);ctx.beginPath();ctx.arc(0,r*.28,r*.14,.2,Math.PI-.2);ctx.stroke()}
 if(gd){ctx.font=Math.max(18,r*.8)+'px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('🔶',0,-r-Math.max(10,r*.35))}
 ctx.restore()}
function draw(){
 ctx.drawImage(bg,0,0);
 txt('Skóre: '+g.score,24,50,50,'left','#5be04a');txt('Rekord: '+Math.max(S.bm[g.mode]||0,g.score),24,100,34);if(g.mode==='time')txt(Math.ceil(Math.max(0,g.t)/60)+' s',500,100,36,'right','#ffd92e');if(g.mode==='drops')txt('Hody: '+g.left,500,100,34,'right','#ffd92e');if(g.cb>1&&g.cT<100)txt('Combo x'+Math.min(g.cb,5),W/2,250,40,'center','#ffd92e');
 
 BTN.forEach(([k,s],i)=>{const x=BX(i),on=S.inv[k]>0;rr(x,888,64,64,12,g.tgt&&k==='hit'?'#ffd92e':on?'#35d1c4':'#8a9a9a');txt(s,x+32,914,38,'center');txt(S.inv[k],x+52,942,22,'center')});
 if(hasJb())txt('🔶 '+window.jomaridBalance,500,152,30,'right','#ffd92e');txt('Další:',60,152,22,'center');rr(24,168,72,72,12,'#2f95ea');ball(60,204,Math.min(RAD[g.next],26),g.next,0,1,undefined,1,g.nG);rr(384,888,132,64,12,g.balls.length?'#ffd92e':'#8a9a9a');if(g.cc>g.f)txt('Jistě? Klepni znovu',450,920,17,'center');else if(g.mode==='zen')txt('Ukončit',450,920,28,'center');else{const v=g.balls.reduce((s,b)=>s+CV[b.t],0);txt('Cash Out',450,902,22,'center');txt('+'+v+' 🪙',450,923,24,'center');txt('pád: +'+(v>>2),450,944,16,'center','#fff3b0')}
 rr(430,22,90,48,12,'#8a5bd6');txt('Menu',475,47,26,'center');
 // bowl
 const sw=Math.sin(performance.now()/900)*.004,sq=clamp(bowl.sq,-.08,.08),wl=y=>AL+(y-TOP)/390*60,wr=y=>AR-(y-TOP)/390*60;ctx.save();ctx.translate(W/2,F);ctx.rotate(bowl.r+sw);ctx.scale(1+sq*.6,1-sq);ctx.translate(-W/2,-F);ctx.beginPath();ctx.moveTo(AL,TOP);ctx.lineTo(BL,F+16);ctx.lineTo(BR,F+16);ctx.lineTo(AR,TOP);ctx.lineJoin='round';ctx.lineCap='round';ctx.strokeStyle='#111';ctx.lineWidth=34;ctx.stroke();ctx.strokeStyle=pat;ctx.lineWidth=24;ctx.stroke();ctx.lineCap='butt';
 
 
 // aim + held ball
 const hr=RAD[g.cur],hx=clamp(g.aimX,AL+hr+6,AR-hr-6);
 if(st==='play'){ctx.globalAlpha=g.cool>0?.35:1;ctx.setLineDash([6,8]);ctx.strokeStyle='#999';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(hx,DROP_Y+hr);ctx.lineTo(hx,F);ctx.stroke();ctx.setLineDash([]);ball(hx,DROP_Y,hr,g.cur,0,1,undefined,1,g.cG);ctx.globalAlpha=1}
 const now=performance.now();for(const b of g.balls){const dx=hx-b.x,dy=DROP_Y-b.y,d=Math.hypot(dx,dy)||1,bl=((now/1000+b.ph*9)%4)<.14?.15:1;ball(b.x,b.y,b.rr,b.t,dx/d-b.vx*.12,dy/d-b.vy*.12,b.P.map(p=>{const ux=p.x-b.x,uy=p.y-b.y,l=Math.hypot(ux,uy)||1,k=(l+b.pr*.92)/l;return[ux*k,uy*k]}),bl,b.gold)}
 ctx.restore();// evolution bar
 rr(40,832,430,34,17,'#2f95ea');ctx.fillStyle='#2f95ea';ctx.beginPath();ctx.moveTo(470,818);ctx.lineTo(515,849);ctx.lineTo(470,880);ctx.fill();ctx.stroke();
 for(let i=0;i<12;i++)ball(48+i*37,849,7+i*.9,i<=S.disc?i:12,0,0);
 for(const p of g.pt){ctx.fillStyle=p.c;ctx.globalAlpha=p.l/30;ctx.beginPath();ctx.arc(p.x,p.y,4,0,7);ctx.fill()}ctx.globalAlpha=1;for(const p of g.pp)txt(p.s||'+'+p.v,p.x,p.y,p.s?30:34,'center',p.c);if(g.tgt)txt('Klepni na kouli',W/2,300,32,'center','#ffd92e');if(g.disc){ctx.fillStyle='rgba(0,0,0,.65)';ctx.fillRect(0,0,W,H);txt('Nová koule objevena!',W/2,280,44,'center');ball(W/2,500,110,g.disc.t);txt('Klepni pro pokračování',W/2,700,26,'center')}}
function loop(t){requestAnimationFrame(loop);const dt=Math.min(.05,(t-last)/1000||0);last=t;if(st==='menu')return;
 if(st==='play'){acc+=dt;while(acc>=1/60){if(g.disc){g.disc.l--;if(g.disc.l<1)g.disc=null}else step();acc-=1/60;if(st!=='play')break}}draw()}
g={balls:[],score:0,cur:0,next:0,aimX:W/2,cool:0,overT:0,ab:{}};stats();requestAnimationFrame(loop);
