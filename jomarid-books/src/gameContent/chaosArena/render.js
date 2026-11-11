/* render.js - vykreslení Chaos Arény na canvas: podlaha, skály, pasti, nepřátelé, střely, hráči, HUD a závěrečná obrazovka.
   Kreslí se jen jeden pohled (pohled hráče u tohoto zařízení) na celou plochu a do rohu se přidá stav parťáka. Stav světa (P, E, Bu, EB, Pu, Ob, Tr, Pa, Rg, Tx...) je v sim.js;
   u hosta ho před každým snímkem naplní mp.js z obrazu od hostitele. Bez vlastní logiky hry. */
const S = { vol: 0.7, shake: 1, assist: 1 };         // hlasitost, otřesy, pomoc s mířením
let NAMES = ['Hráč 1', 'Hráč 2'];                    // jména hráčů (nastaví mp.js)
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
let CW, CH;
function rs() { const d = devicePixelRatio || 1; CW = cv.clientWidth; CH = cv.clientHeight; cv.width = CW * d; cv.height = CH * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
addEventListener('resize', rs); rs();

// ===== ZVUK (Web Audio) =====
let AC;
function initAudio() { if (!AC) try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* bez zvuku */ } }
audioBeep = function (f, d = 0.1, t = 'square', v = 0.04, sl = 0) {
  if (!AC || S.vol <= 0) return;
  const o = AC.createOscillator(), g = AC.createGain(), n = AC.currentTime;
  o.type = t; o.frequency.setValueAtTime(f, n); if (sl) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + sl), n + d);
  const vv = Math.max(0.0001, v * S.vol); g.gain.setValueAtTime(vv, n); g.gain.exponentialRampToValueAtTime(0.00005, n + d); o.connect(g).connect(AC.destination); o.start(); o.stop(n + d);
};

// ===== GRAFIKA: pomocné kreslicí funkce =====
function rrect(x,y,w,h,r){ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,r);else ctx.rect(x,y,w,h)}
function txt(t,x,y,sz,c='#fff',a='center'){ctx.font='bold '+sz+'px system-ui,sans-serif';ctx.textAlign=a;ctx.lineJoin='round';ctx.lineWidth=Math.max(3,sz/5);ctx.strokeStyle='rgba(5,8,25,.75)';ctx.strokeText(t,x,y);ctx.fillStyle=c;ctx.fillText(t,x,y)}
function poly(x,y,r,n,rot=0,wob=0,ph=0){ctx.beginPath();for(let i=0;i<n;i++){const a=rot+i/n*TAU,rr=r*(1+wob*Math.sin(a*3+ph));ctx[i?'lineTo':'moveTo'](x+Math.cos(a)*rr,y+Math.sin(a)*rr)}ctx.closePath()}
function star(x,y,r1,r2,n,rot=0){ctx.beginPath();for(let i=0;i<n*2;i++){const a=rot+i/(n*2)*TAU,rr=i%2?r2:r1;ctx[i?'lineTo':'moveTo'](x+Math.cos(a)*rr,y+Math.sin(a)*rr)}ctx.closePath()}
function heart(x,y,s,full,c){ctx.beginPath();ctx.moveTo(x,y+s*.35);ctx.bezierCurveTo(x-s,y-s*.4,x-s*.5,y-s,x,y-s*.35);ctx.bezierCurveTo(x+s*.5,y-s,x+s,y-s*.4,x,y+s*.35);ctx.closePath();ctx.fillStyle=full?c:'#ffffff22';ctx.fill();ctx.strokeStyle=full?'#fffa':'#fff3';ctx.lineWidth=1;ctx.stroke()}
// Záře: předrenderovaný radiální sprite, kreslený aditivně (rychlé, ale vypadá jako světlo)
const glowC={};
function glow(x,y,r,c,a=1){let g=glowC[c];if(!g){g=glowC[c]=document.createElement('canvas');g.width=g.height=64;const q=g.getContext('2d'),rg=q.createRadialGradient(32,32,0,32,32,32);rg.addColorStop(0,c);rg.addColorStop(.35,c+'77');rg.addColorStop(1,c+'00');q.fillStyle=rg;q.fillRect(0,0,64,64)}
 ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=a;ctx.drawImage(g,x-r,y-r,r*2,r*2);ctx.restore()}
let BG=null,VX=0,VY=0,VW=0,VH=0;
function makeBG(){const c=document.createElement('canvas');c.width=WW;c.height=WH;const g=c.getContext('2d');
 const gr=g.createRadialGradient(WW/2,WH/2,100,WW/2,WH/2,1100);gr.addColorStop(0,'#262e63');gr.addColorStop(1,'#0f132b');g.fillStyle=gr;g.fillRect(0,0,WW,WH);
 g.strokeStyle='#ffffff12';g.lineWidth=2;const hr=60,hw=hr*1.732;
 for(let r=0;r*hr*1.5<WH+hr;r++)for(let q=0;q*hw<WW+hw;q++){const hx=q*hw+(r%2?hw/2:0),hy=r*hr*1.5;g.beginPath();for(let k=0;k<6;k++){const a=k/6*TAU+.5236;g.lineTo(hx+Math.cos(a)*hr,hy+Math.sin(a)*hr)}g.closePath();g.stroke()}
 for(let i=0;i<260;i++){g.fillStyle='rgba(120,150,255,'+Math.random()*.09+')';g.beginPath();g.arc(Math.random()*WW,Math.random()*WH,Math.random()*5+1,0,TAU);g.fill()}
 g.lineWidth=16;g.strokeStyle='#ff4d6d';g.strokeRect(0,0,WW,WH);g.lineWidth=4;g.strokeStyle='#ffd0d8';g.strokeRect(11,11,WW-22,WH-22);return c}
const off=(o,m=80)=>o.x<VX-m||o.x>VX+VW+m||o.y<VY-m||o.y>VY+VH+m;
// ===== VYKRESLENÍ =====
// ----- skály (krystaly) s fasetami a stínem -----
function drawRock(o){if(off(o,o.r+40))return;if(!o.v){o.v=[];for(let k=0;k<9;k++)o.v.push(.82+Math.random()*.3)}
 ctx.fillStyle='rgba(0,0,0,.35)';ctx.beginPath();ctx.ellipse(o.x+6,o.y+o.r*.9,o.r,o.r*.45,0,0,TAU);ctx.fill();
 const pts=o.v.map((m,k)=>{const a=k/9*TAU;return[o.x+Math.cos(a)*o.r*m,o.y+Math.sin(a)*o.r*m]});
 const g=ctx.createLinearGradient(o.x-o.r,o.y-o.r,o.x+o.r,o.y+o.r);g.addColorStop(0,o.m?'#7d6bc9':'#6b76c9');g.addColorStop(1,'#2b3066');
 ctx.fillStyle=g;ctx.beginPath();pts.forEach((p,k)=>ctx[k?'lineTo':'moveTo'](p[0],p[1]));ctx.closePath();ctx.fill();ctx.strokeStyle='#aab4ff';ctx.lineWidth=2;ctx.stroke();
 ctx.strokeStyle='#ffffff30';ctx.lineWidth=1.5;ctx.beginPath();pts.forEach((p,k)=>{if(k%2==0){ctx.moveTo(o.x,o.y);ctx.lineTo(p[0],p[1])}});ctx.stroke();
 ctx.fillStyle='#ffffff22';ctx.beginPath();ctx.moveTo(o.x,o.y);ctx.lineTo(pts[7][0],pts[7][1]);ctx.lineTo(pts[8][0],pts[8][1]);ctx.lineTo(pts[0][0],pts[0][1]);ctx.closePath();ctx.fill();
 if(o.m){glow(o.x,o.y,o.r*1.6,'#b197fc',.25)}}   // pohyblivé zdi mírně září
// ----- pasti: ozubené kolo -> varování -> bodáky -----
function drawTrap(t){if(off(t,100))return;const ph=(gt+t.ph)%3.2,act=ph>2.2,warn=ph>1.6&&!act;
 ctx.fillStyle='#161a3a';poly(t.x,t.y,t.r,10,gt*(act?3:.3));ctx.fill();ctx.strokeStyle=act?'#ff4d4d':warn?'#ffb347':'#4a52a0';ctx.lineWidth=3;ctx.stroke();
 if(warn)glow(t.x,t.y,t.r*2,'#ff6b3d',.5+.5*Math.sin(ph*30));
 if(act){glow(t.x,t.y,t.r*2.4,'#ff3b3b',.9);ctx.fillStyle='#ffe3e3';for(let k=0;k<8;k++){const a=k/8*TAU+gt;ctx.beginPath();ctx.moveTo(t.x+Math.cos(a-.15)*14,t.y+Math.sin(a-.15)*14);ctx.lineTo(t.x+Math.cos(a)*t.r*1.1,t.y+Math.sin(a)*t.r*1.1);ctx.lineTo(t.x+Math.cos(a+.15)*14,t.y+Math.sin(a+.15)*14);ctx.fill()}}
 else{ctx.fillStyle='#2c3170';poly(t.x,t.y,t.r*.45,6);ctx.fill()}}
// ----- power-upy: rotující šestiúhelník se září -----
function drawPow(u){if(off(u))return;const col={R:'#ffd43b',S:'#4dd2ff',B:'#ff922b',H:'#ff6b81'}[u.t],tm=performance.now()/1000,bob=Math.sin(tm*4+u.x)*3;
 ctx.globalAlpha=u.life<3&&Math.floor(u.life*6)%2?.35:1;glow(u.x,u.y+bob,48,col,.85);
 ctx.fillStyle='#0d1030dd';poly(u.x,u.y+bob,19,6,tm*1.5);ctx.fill();ctx.strokeStyle=col;ctx.lineWidth=3;ctx.stroke();poly(u.x,u.y+bob,12,6,-tm*2);ctx.lineWidth=1.5;ctx.stroke();
 txt(u.t,u.x,u.y+bob+6,16,col);ctx.globalAlpha=1}
// ----- nepřátelé: každý typ má vlastní tvar -----
function drawEnemy(e){if(off(e,e.r+40))return;const tm=performance.now()/1000,r=e.r,k=e.k,fl=e.hit>0||(e.windup>0&&Math.floor(e.windup*20)%2),ph=tm*5+e.x*.01,ang=Math.atan2(e.dy||0,e.dx||1);
 ctx.fillStyle='rgba(0,0,0,.3)';ctx.beginPath();ctx.ellipse(e.x+4,e.y+r*.8,r,r*.4,0,0,TAU);ctx.fill();glow(e.x,e.y,r*2.6,e.c,.35);
 const body=fl?'#fff':e.c;ctx.fillStyle=body;ctx.strokeStyle='#ffffffaa';ctx.lineWidth=2;
 if(k=='fast'){ctx.save();ctx.translate(e.x,e.y);ctx.rotate(ang);ctx.beginPath();ctx.moveTo(r*1.6,0);ctx.lineTo(-r,r*1.05);ctx.lineTo(-r*.35,0);ctx.lineTo(-r,-r*1.05);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore()}
 else if(k=='tank'){star(e.x,e.y,r*1.2,r*.95,8,tm*.5);ctx.fill();ctx.stroke();ctx.fillStyle='#0009';poly(e.x,e.y,r*.7,8,tm*.5);ctx.fill();ctx.fillStyle=body;poly(e.x,e.y,r*.42,6,-tm);ctx.fill()}
 else if(k=='boss'){star(e.x,e.y,r*1.45,r*1.0,10,tm*.6);ctx.fill();ctx.stroke();ctx.fillStyle='#1a1038';poly(e.x,e.y,r*.85,10,-tm*.4);ctx.fill();ctx.fillStyle=body;poly(e.x,e.y,r*.6,6,tm);ctx.fill();
  for(let n=0;n<3;n++){const a=tm*2+n*2.094;glow(e.x+Math.cos(a)*r*1.7,e.y+Math.sin(a)*r*1.7,22,'#e599f7',.9)}}
 else if(k=='shoot'){poly(e.x,e.y,r,5,ang);ctx.fill();ctx.stroke();ctx.save();ctx.translate(e.x,e.y);ctx.rotate(ang);ctx.fillStyle='#0009';ctx.fillRect(r*.4,-r*.22,r*1.1,r*.44);ctx.restore()}
 else if(k=='split'){[-1,1].forEach(sg=>{ctx.beginPath();ctx.arc(e.x+sg*r*.45,e.y,r*.72*(1+.06*Math.sin(ph+sg)),0,TAU);ctx.fill();ctx.stroke()})}
 else{poly(e.x,e.y,r,12,0,.09,ph);ctx.fill();ctx.stroke()}
 const ex=(e.dx||0)*r*.22,ey=(e.dy||0)*r*.22,er=r*.25;
 if(k=='tank'){ctx.fillStyle='#ff3b3b';ctx.beginPath();ctx.arc(e.x+ex,e.y+ey,r*.2,0,TAU);ctx.fill();glow(e.x+ex,e.y+ey,r*.8,'#ff3b3b',.8)}
 else{ctx.fillStyle='#fff';[-1,1].forEach(sg=>{ctx.beginPath();ctx.arc(e.x+sg*r*.33+ex,e.y-r*.15+ey,er,0,TAU);ctx.fill()});ctx.fillStyle=k=='boss'?'#e00':'#000';[-1,1].forEach(sg=>{ctx.beginPath();ctx.arc(e.x+sg*r*.33+ex*2.2,e.y-r*.15+ey*2.2,er*.45,0,TAU);ctx.fill()})}
 if(e.stun>0){ctx.strokeStyle='#7df9ff';ctx.lineWidth=3;ctx.setLineDash([6,5]);ctx.lineDashOffset=-tm*40;ctx.beginPath();ctx.arc(e.x,e.y,r+8,0,TAU);ctx.stroke();ctx.setLineDash([]);glow(e.x,e.y,r*2.5,'#7df9ff',.5)}
 if(e.windup>0){ctx.strokeStyle='#ff4d4d';ctx.lineWidth=3;ctx.beginPath();ctx.arc(e.x,e.y,r+8+Math.sin(tm*25)*3,0,TAU);ctx.stroke()}
 if(e.hp<e.mhp||e.boss){const bw=e.boss?90:r*2;rrect(e.x-bw/2,e.y-r*(e.boss?1.6:1.3)-8,bw,6,3);ctx.fillStyle='#000a';ctx.fill();rrect(e.x-bw/2+1,e.y-r*(e.boss?1.6:1.3)-7,(bw-2)*Math.max(0,e.hp/e.mhp),4,2);ctx.fillStyle=e.boss?'#ff6bd6':'#ff6b6b';ctx.fill()}}
// ----- střely: záře + jádro + šmouha; raketa má tělo a ploutve -----
function drawBullet(b){if(off(b))return;glow(b.x,b.y,b.rk?32:b.big?26:16,b.c,.9);
 ctx.strokeStyle=b.c;ctx.lineWidth=b.rk?5:3;ctx.globalAlpha=.6;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-b.vx*.05,b.y-b.vy*.05);ctx.stroke();ctx.globalAlpha=1;
 if(b.rk){ctx.save();ctx.translate(b.x,b.y);ctx.rotate(Math.atan2(b.vy,b.vx));ctx.fillStyle='#dfe3ee';ctx.fillRect(-9,-3.5,16,7);ctx.fillStyle='#ff922b';ctx.beginPath();ctx.moveTo(7,-3.5);ctx.lineTo(14,0);ctx.lineTo(7,3.5);ctx.fill();
  ctx.fillStyle='#ff5a3d';ctx.beginPath();ctx.moveTo(-9,-3.5);ctx.lineTo(-14,-9);ctx.lineTo(-4,-3.5);ctx.moveTo(-9,3.5);ctx.lineTo(-14,9);ctx.lineTo(-4,3.5);ctx.fill();ctx.restore()}
 else{ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(b.x,b.y,b.big?5:3,0,TAU);ctx.fill()}}
// ----- hráči: tvar a zbraň podle třídy -----
function drawPlayer(q,j){const c=COLS[j],k=q.cl.k,tm=performance.now()/1000,a=Math.atan2(q.ay,q.ax),r=16;
 ctx.globalAlpha=q.inv>0&&Math.floor(q.inv*12)%2?.4:1;ctx.fillStyle='rgba(0,0,0,.35)';ctx.beginPath();ctx.ellipse(q.x+4,q.y+r*.9,r,r*.45,0,0,TAU);ctx.fill();
 if(q.down){ctx.fillStyle='#555';poly(q.x,q.y,r,8);ctx.fill();ctx.strokeStyle='#999';ctx.lineWidth=2;ctx.stroke();txt('Oživ mě!',q.x,q.y-26,14);
  if(q.rev>0){ctx.strokeStyle='#69db7c';ctx.lineWidth=5;ctx.beginPath();ctx.arc(q.x,q.y,24,-1.57,-1.57+q.rev/1.2*TAU);ctx.stroke()}ctx.globalAlpha=1;return}
 glow(q.x,q.y,52,c,.45);if(Math.hypot(q.vx,q.vy)>40)glow(q.x-Math.cos(a)*14,q.y-Math.sin(a)*14,22,'#ffd8a0',.55);
 if(k=='emp'||k=='heal'){const em=k=='emp';ctx.strokeStyle=em?(q.cd<=0?'rgba(125,249,255,.6)':'rgba(125,249,255,.2)'):((q.hc||0)<1?'rgba(157,255,176,.6)':'rgba(157,255,176,.2)');ctx.lineWidth=2;ctx.setLineDash([8,8]);ctx.lineDashOffset=-tm*20;ctx.beginPath();ctx.arc(q.x,q.y,em?150:220,0,TAU);ctx.stroke();ctx.setLineDash([])}
 ctx.strokeStyle=c+'55';ctx.lineWidth=1.5;ctx.setLineDash([4,8]);ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(q.x+q.ax*130,q.y+q.ay*130);ctx.stroke();ctx.setLineDash([]);
 ctx.save();ctx.translate(q.x,q.y);ctx.rotate(a);ctx.fillStyle='#cfd6ff';
 if(k=='gun'){ctx.fillRect(8,-3,18,6);ctx.fillStyle=c;ctx.fillRect(22,-4,5,8)}
 else if(k=='emp'){ctx.strokeStyle='#7df9ff';ctx.lineWidth=3;[0,1,2].forEach(n=>{ctx.beginPath();ctx.arc(14+n*5,0,5+n*2,-1,1);ctx.stroke()})}
 else if(k=='heal'){ctx.fillRect(8,-2,12,4);ctx.fillStyle='#9dffb0';ctx.beginPath();ctx.arc(22,0,5,0,TAU);ctx.fill()}
 else if(k=='tank'){ctx.fillRect(6,-9,12,6);ctx.fillRect(6,3,12,6);ctx.fillRect(6,-3,16,6)}
 else{ctx.fillStyle='#8a6a4a';ctx.fillRect(2,-7,28,14);ctx.fillStyle='#ff922b';ctx.fillRect(28,-8,4,16);ctx.fillStyle='#222';ctx.fillRect(4,-3,24,6)}
 const g=ctx.createRadialGradient(-5,-5,2,0,0,r+2);g.addColorStop(0,'#fff');g.addColorStop(.4,c);g.addColorStop(1,c);ctx.fillStyle=g;ctx.strokeStyle='#fff';ctx.lineWidth=2.5;
 poly(0,0,k=='tank'?19:r,{gun:6,emp:8,heal:12,tank:4,rkt:5}[k],k=='tank'?.785:0);ctx.fill();ctx.stroke();
 if(k=='tank'){ctx.strokeStyle='#ffa94d';ctx.lineWidth=3;ctx.setLineDash([4,4]);ctx.beginPath();ctx.arc(0,0,26,0,TAU);ctx.stroke();ctx.setLineDash([])}
 ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(5,0,4.5,0,TAU);ctx.fill();ctx.fillStyle='#111';ctx.beginPath();ctx.arc(6.5,0,2,0,TAU);ctx.fill();ctx.restore();
 if(k=='heal'){ctx.fillStyle='#fff';ctx.fillRect(q.x-1.5,q.y-8,3,16);ctx.fillRect(q.x-8,q.y-1.5,16,3)}
 if(q.shield){glow(q.x,q.y,46,'#4dd2ff',.6);poly(q.x,q.y,25,6,tm*2);ctx.strokeStyle='#4dd2ff';ctx.lineWidth=3;ctx.stroke()}
 ctx.globalAlpha=1;rrect(q.x-36,q.y+22,72,15,7);ctx.fillStyle='#0a0d24bb';ctx.fill();txt('P'+(j+1)+' '+q.cl.n,q.x,q.y+34,11,c)}
// ----- jeden výřez (pohled hráče) + jeho HUD -----

// ----- HUD jednoho hráče (karta se jménem, skóre, životy a nabitím zbraně) -----
function drawHud(p, i, x, y) {
  rrect(x, y, 232, 72, 12); const hg = ctx.createLinearGradient(0, y, 0, y + 72); hg.addColorStop(0, '#1e2556ee'); hg.addColorStop(1, '#0b0e22ee'); ctx.fillStyle = hg; ctx.fill(); ctx.strokeStyle = COLS[i]; ctx.lineWidth = 2; ctx.stroke();
  glow(x + 30, y + 32, 34, COLS[i], 0.7); ctx.fillStyle = COLS[i]; ctx.beginPath(); ctx.arc(x + 30, y + 32, 17, 0, TAU); ctx.fill(); txt(p.cl.n[0], x + 30, y + 38, 17, '#111');
  txt(NAMES[i], x + 56, y + 22, 14, COLS[i], 'left'); txt('' + p.score, x + 224, y + 22, 17, '#fff', 'right');
  for (let k = 0; k < p.mhp; k++) heart(x + 62 + k * 17, y + 42, 8, k < p.hp, '#ff4d6d');
  const cdv = p.cl.k === 'heal' ? 1 - (p.hc || 0) / 4.5 : 1 - Math.max(0, p.cd) / p.cl.cd; rrect(x + 56, y + 54, 120, 6, 3); ctx.fillStyle = '#0009'; ctx.fill(); rrect(x + 56, y + 54, 120 * Math.max(0, Math.min(1, cdv)), 6, 3); ctx.fillStyle = cdv >= 1 ? '#69db7c' : COLS[i]; ctx.fill();
  if (p.rapid > 0) txt('⚡' + p.rapid.toFixed(0), x + 200, y + 60, 13, '#ffd43b'); if (p.shield) txt('🛡', x + 188, y + 42, 14);
}

// ----- pohled hráče me (kamera na něj) a HUD obou hráčů -----
function drawView(me, mi, x, y, w, h) {
  const p = me, i = mi, s = Math.min(w / (w < 600 ? 520 : 760), h / 460), vw = w / s, vh = h / s, tm = performance.now() / 1000;   // na úzkém displeji (telefon) víc zblízka
  const hs = Math.min(1, (w - 24) / 488);          // karty obou hráčů se na úzkém displeji zmenší, ať se vejdou vedle sebe
  const cx = Math.max(0, Math.min(WW - vw, p.x - vw / 2)), cy = Math.max(0, Math.min(WH - vh, p.y - vh / 2)); VX = cx; VY = cy; VW = vw; VH = vh;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.translate(-cx + (Math.random() * 2 - 1) * shake * S.shake, -cy + (Math.random() * 2 - 1) * shake * S.shake);
  if (!BG) BG = makeBG(); ctx.drawImage(BG, 0, 0); if (mod.ice) { ctx.fillStyle = '#6ad0ff28'; ctx.fillRect(0, 0, WW, WH); }
  Tr.forEach(drawTrap); Ob.forEach(drawRock); Pu.forEach(drawPow); E.forEach(drawEnemy); Bu.forEach(drawBullet);
  EB.forEach(sh => { if (off(sh)) return; glow(sh.x, sh.y, 22, '#ff4d4d', 0.9); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sh.x, sh.y, 3.5, 0, TAU); ctx.fill(); });
  P.forEach(drawPlayer);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; Pa.forEach(a => { ctx.globalAlpha = Math.min(1, a.life * 2); ctx.fillStyle = a.c; ctx.beginPath(); ctx.arc(a.x, a.y, a.s * 0.8, 0, TAU); ctx.fill(); }); ctx.restore();
  Rg.forEach(r => { const rr = r.r * (1.3 - r.life); ctx.globalAlpha = Math.min(1, r.life * 3) * 0.25; ctx.fillStyle = r.c; ctx.beginPath(); ctx.arc(r.x, r.y, rr, 0, TAU); ctx.fill(); ctx.globalAlpha = Math.min(1, r.life * 3); ctx.strokeStyle = r.c; ctx.lineWidth = 5; ctx.stroke(); }); ctx.globalAlpha = 1;
  Tx.forEach(t => { ctx.globalAlpha = Math.min(1, t.life * 2); txt(t.t, t.x, t.y, 18, t.c); }); ctx.globalAlpha = 1;
  if (p.tg && !p.down && S.assist && p.cl.k !== 'emp') {
    const L = lead(p, p.tg), r = p.tg.r + 10; ctx.strokeStyle = COLS[i]; ctx.lineWidth = 2; ctx.setLineDash([10, 8]); ctx.lineDashOffset = -tm * 30; ctx.beginPath(); ctx.arc(L.x, L.y, r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    for (let n = 0; n < 4; n++) { const a = n * 1.5708 + tm; ctx.beginPath(); ctx.moveTo(L.x + Math.cos(a) * (r + 4), L.y + Math.sin(a) * (r + 4)); ctx.lineTo(L.x + Math.cos(a) * (r + 13), L.y + Math.sin(a) * (r + 13)); ctx.stroke(); }
  }
  ctx.restore();
  // vinětace, červený záblesk po zásahu a HUD
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const vg = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.35, x + w / 2, y + h / 2, Math.max(w, h) * 0.78); vg.addColorStop(0, '#0000'); vg.addColorStop(1, '#000000aa'); ctx.fillStyle = vg; ctx.fillRect(x, y, w, h);
  if (p.inv > 0.8 && !p.down) { ctx.fillStyle = 'rgba(255,40,60,' + (p.inv - 0.8) * 1.1 + ')'; ctx.fillRect(x, y, w, h); }
  ctx.save(); ctx.translate(x + 8, y + 8); ctx.scale(hs, hs); drawHud(p, i, 0, 0); ctx.restore();
  const q = P[1 - i];
  if (q) {
    ctx.save(); ctx.translate(x + w - 8 - 232 * hs, y + 8); ctx.scale(hs, hs); drawHud(q, 1 - i, 0, 0); ctx.restore();
    // šipka k parťákovi, když je mimo obraz
    const qx = (q.x - cx) * s, qy = (q.y - cy) * s;
    if (qx < 0 || qx > w || qy < 0 || qy > h) {
      const ax = Math.max(26, Math.min(w - 26, qx)), ay = Math.max(16 + 72 * hs + 30, Math.min(h - 26, qy)), a = Math.atan2(qy - h / 2, qx - w / 2);
      ctx.save(); ctx.translate(x + ax, y + ay); ctx.rotate(a); ctx.fillStyle = COLS[1 - i]; ctx.globalAlpha = q.down ? 0.9 : 0.75; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-10, -11); ctx.lineTo(-10, 11); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      if (q.down) txt('Oživ!', x + ax, y + ay - 18, 13, '#fff');
    }
  }
  ctx.restore();
}

// ----- celá scéna: pohled hráče me, horní lišta s vlnou, kombo a nápis nové vlny -----
function drawGame(me) {
  ctx.fillStyle = '#0f1226'; ctx.fillRect(0, 0, CW, CH);
  drawView(P[me], me, 0, 0, CW, CH);
  const m = CW / 2, narrow = CW < 600, ty = narrow ? Math.round(16 + 72 * Math.min(1, (CW - 24) / 488) + 4) : 2;   // úzký displej: lišta s vlnou pod kartami hráčů
  rrect(m - 150, ty, 300, 32, 16); ctx.fillStyle = '#0a0d24dd'; ctx.fill(); ctx.strokeStyle = '#ffffff40'; ctx.lineWidth = 1.5; ctx.stroke();
  txt('Vlna ' + wave + '/' + WIN_WAVE + ' · ' + mod.n + ' · zabito ' + teamKills, m, ty + 21, 13);
  if (combo >= 3) { const cm = 1 + Math.min(4, Math.floor(combo / 5)), cy = ty + 54; glow(m, cy - 4, 80, '#ffd43b', 0.5); txt('KOMBO ×' + cm + '  (' + combo + ')', m, cy, 18 + cm * 2, '#ffd43b'); rrect(m - 60, cy + 8, 120, 5, 2); ctx.fillStyle = '#0008'; ctx.fill(); rrect(m - 60, cy + 8, 120 * Math.max(0, comboT / 3), 5, 2); ctx.fillStyle = '#ffd43b'; ctx.fill(); }
  if (banner > 0) { ctx.globalAlpha = Math.min(1, banner); txt(!bossDone || wave % 3 === 0 ? 'BOSS VLNA ' + wave + '!' : 'VLNA ' + wave, m, CH / 2 - 10, Math.min(56, CW / 9), '#ffd43b'); txt(mod.n, m, CH / 2 + 34, 28); ctx.globalAlpha = 1; }
}

// ----- konec: výsledky týmu (výhra nebo prohra) -----
function drawResult(win, me, note) {
  drawGame(me); ctx.fillStyle = 'rgba(10,12,30,.88)'; ctx.fillRect(0, 0, CW, CH); const m = CW / 2, fs = Math.min(54, CW / 12);
  txt(win ? 'VÍTĚZSTVÍ – přežili jste ' + WIN_WAVE + ' vln' : 'KONEC HRY – vlna ' + wave, m, 80, fs, win ? '#69db7c' : '#ff6b81');
  const top = Math.max(...P.map(p => p.score)), fz = Math.min(24, CW / 28);
  txt('Hráč               Body      Zabití     Pády     Záchrany', m, 150, Math.min(18, CW / 38), '#9ab');
  P.forEach((p, i) => txt((p.score === top ? '👑 ' : '') + NAMES[i].slice(0, 12).padEnd(10) + String(p.score).padStart(6) + String(p.kills).padStart(9) + String(p.downs).padStart(9) + String(p.revives).padStart(10), m, 195 + i * 40, fz, COLS[i]));
  const mx = (k) => P.reduce((a, p, i) => p[k] > P[a][k] ? i : a, 0);
  txt('🏆 Nejvíc zabití: ' + NAMES[mx('kills')].slice(0, 12) + '   💀 Nejvíc padal: ' + NAMES[mx('downs')].slice(0, 12) + '   🩹 Zachránce: ' + NAMES[mx('revives')].slice(0, 12), m, 330, Math.min(18, CW / 40));
  txt(note || '', m, 380, 16, '#cde');
}
