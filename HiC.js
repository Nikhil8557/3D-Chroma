const C3D=(()=>{
  let data=null;
  let rotX=0.25,rotY=0,zoom=1;
  let autoAng=0,autoRot=true;
  let drag=false,prevMX=0,prevMY=0;
  let showLoops=true,showComp=true;
  let raf=null;
  let hlB0=null,hlB1=null;
  let eventsInited=false;
  let restoreTimer=null;
  let _savedAutoRot=true;
  let motionT=0;

  const canvases=new Set();
  const pointCache=new WeakMap();

  function load(d){
    data=d;
    const nl=d.loops?.length??0;
    const nt=d.tad_boundaries?.length??0;
    $('v3d-n-loops').textContent=nl;
    $('v3d-n-tads').textContent=nt;
    renderNow();
  }

  function reg(id){
    const el=$(id);if(!el||canvases.has(el))return;
    canvases.add(el);
    el.addEventListener('mousedown',e=>{
      drag=true;
      if(restoreTimer)clearTimeout(restoreTimer);
      _savedAutoRot=autoRot;
      autoRot=false;
      sync3dControls();
      prevMX=e.clientX;prevMY=e.clientY;e.preventDefault();
    });
    el.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(0.08,Math.min(50,zoom*(e.deltaY<0?1.15:.87)));renderNow();},{passive:false});
    el.addEventListener('mousemove',e=>{
      if(!data)return;
      const rect=el.getBoundingClientRect();
      if(rect.width<2||rect.height<2)return;
      const pts=pointCache.get(el);
      if(!pts)return;
      _handleHover((e.clientX-rect.left)*(el.width/rect.width),(e.clientY-rect.top)*(el.height/rect.height),pts);
    });
    el.addEventListener('mouseleave',()=>{SYNC.clear('v3d');hlB0=hlB1=null;clearMapHighlight();clearArcHighlight();clearTableHighlight();});
    if(!eventsInited){
      eventsInited=true;
      window.addEventListener('mousemove',e=>{
        if(!drag)return;
        rotY+=(e.clientX-prevMX)*0.008;
        autoAng=rotY;
        rotX=Math.max(-1.3,Math.min(1.3,rotX+(e.clientY-prevMY)*0.008));
        prevMX=e.clientX;prevMY=e.clientY;
      });
      window.addEventListener('mouseup',()=>{
        if(!drag)return;
        drag=false;
        if(restoreTimer)clearTimeout(restoreTimer);
        restoreTimer=setTimeout(()=>{setAutoRot(_savedAutoRot);},1400);
      });
    }
  }

  function setHighlight(b0,b1){hlB0=b0;hlB1=b1;}

  function _handleHover(mx,my,pts){
    let best=null,bestD=30;
    pts.forEach((p,i)=>{const d=Math.hypot(p.px-mx,p.py-my);if(d<bestD){bestD=d;best=i;}});
    if(best!==null){
      const binReal=data.bin_map?data.bin_map[best]:best;
      const b0=Math.max(0,binReal-5),b1=binReal+5;
      hlB0=b0;hlB1=b1;
      SYNC.emit(b0,b1,'v3d',{label:`3D ~bin ${binReal}`});
      showMapHighlight(b0,b1);highlightArcSel(b0,b1);highlightTable(b0,b1);
    }else{
      hlB0=hlB1=null;SYNC.clear('v3d');clearMapHighlight();clearArcHighlight();clearTableHighlight();
    }
  }

  function proj(px,py,pz){
    const cy=Math.cos(rotY),sy=Math.sin(rotY);
    const x1=px*cy+pz*sy,z1=-px*sy+pz*cy;
    const cx=Math.cos(rotX),sx=Math.sin(rotX);
    const y2=py*cx-z1*sx,z2=py*sx+z1*cx;
    const d=18; const f=d/(d+z2+10);
    return{sx:x1*f,sy:y2*f,z:z2,f};
  }

  function drawBackdrop(ctx,W,H,light){
    ctx.clearRect(0,0,W,H);
    const bg=ctx.createLinearGradient(0,0,W,H);
    if(light){
      bg.addColorStop(0,'rgba(244,248,252,.92)');
      bg.addColorStop(1,'rgba(220,229,240,.98)');
    }else{
      bg.addColorStop(0,'rgba(6,10,18,.78)');
      bg.addColorStop(1,'rgba(2,4,10,.98)');
    }
    ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);

    const glow=ctx.createRadialGradient(
      W*(0.34+Math.sin(motionT*0.19)*0.08),
      H*(0.28+Math.cos(motionT*0.16)*0.06),
      0,
      W*0.46,
      H*0.42,
      Math.max(W,H)*0.7
    );
    glow.addColorStop(0,light?'rgba(36,113,163,.16)':'rgba(36,113,163,.16)');
    glow.addColorStop(0.5,light?'rgba(231,76,60,.05)':'rgba(231,76,60,.06)');
    glow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);
  }

  function drawOn(canvas){
    if(!data||!canvas)return;
    const W=canvas.offsetWidth;
    const H=canvas.offsetHeight||canvas.parentElement?.clientHeight||380;
    if(W<4||H<4)return;
    canvas.width=W;canvas.height=H;

    const ctx=canvas.getContext('2d');
    const light=document.documentElement.getAttribute('data-theme')==='light';
    drawBackdrop(ctx,W,H,light);

    const{x,y,z,colors,loops,ev}=data;
    const n=x.length;
    if(!n)return;

    const scale=Math.min(W,H)*0.031*zoom*(1+Math.sin(motionT*0.72)*0.018);
    const OCX=W/2+Math.sin(motionT*0.55)*Math.min(W,H)*0.045;
    const OCY=H/2+Math.cos(motionT*0.43)*Math.min(W,H)*0.038;

    const pts=new Array(n);
    for(let i=0;i<n;i++){
      const p=proj(x[i],y[i],z[i]);
      pts[i]={px:OCX+p.sx*scale,py:OCY+p.sy*scale,z:p.z,f:p.f};
    }
    pointCache.set(canvas,pts);

    const segOrder=[];
    for(let i=1;i<n;i++)segOrder.push({i,z:(pts[i-1].z+pts[i].z)*.5});
    segOrder.sort((a,b)=>a.z-b.z);

    segOrder.forEach(({i})=>{
      const a=pts[i-1],b=pts[i];
      const avgF=(a.f+b.f)*.5;
      const col=showComp?(ev&&ev[i-1]>0.5?'#e74c3c':'#2980b9'):(colors[i-1]||'#5dade2');
      const binReal=data.bin_map?data.bin_map[i]:i;
      const isHL=hlB0!=null&&binReal>=hlB0&&binReal<=hlB1;
      const alpha=isHL?1:Math.max(0.15,0.20+avgF*0.68);
      ctx.beginPath();ctx.moveTo(a.px,a.py);ctx.lineTo(b.px,b.py);
      ctx.strokeStyle=hexA(col,alpha);
      ctx.lineWidth=isHL?3.6:Math.max(0.7,2.4*avgF);
      ctx.stroke();
    });

    if(data.tad_boundaries){
      data.tad_boundaries.forEach(bi=>{
        if(bi>=n)return;
        const p=pts[bi];
        ctx.beginPath();ctx.arc(p.px,p.py,Math.max(1.6,3.2*p.f),0,Math.PI*2);
        ctx.fillStyle=hexA('#22d3ee',0.85);ctx.fill();
      });
    }

    if(showLoops&&loops&&loops.length){
      const ls=[...loops].map(lp=>{
        const ai=Math.min(lp.a,n-1),bi2=Math.min(lp.b,n-1);
        return{lp,ai,bi2,avgZ:((pts[ai]?.z||0)+(pts[bi2]?.z||0))*.5};
      }).sort((a,b)=>a.avgZ-b.avgZ);

      ls.forEach(({lp,ai,bi2})=>{
        const pA=pts[ai],pB=pts[bi2];if(!pA||!pB)return;
        const score=lp.score||0.7;
        const col=lp.color||'#ff3333';
        const mx3=(x[ai]+x[bi2])/2,my3=(y[ai]+y[bi2])/2+2.0+score*2.0,mz3=(z[ai]+z[bi2])/2;
        const cp=proj(mx3,my3,mz3);
        const cpPX=OCX+cp.sx*scale,cpPY=OCY+cp.sy*scale;

        ctx.beginPath();ctx.moveTo(pA.px,pA.py);
        ctx.quadraticCurveTo(cpPX,cpPY,pB.px,pB.py);
        ctx.strokeStyle=hexA(col,0.44+score*0.40);
        ctx.lineWidth=0.8+score*2.6;ctx.stroke();

        [pA,pB].forEach(p=>{
          const r=Math.max(1.5,3*p.f*Math.min(zoom,2));
          const g=ctx.createRadialGradient(p.px,p.py,0,p.px,p.py,r*4.2);
          g.addColorStop(0,hexA(col,0.34*score));g.addColorStop(1,hexA(col,0));
          ctx.beginPath();ctx.arc(p.px,p.py,r*4.2,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();
          ctx.beginPath();ctx.arc(p.px,p.py,r,0,Math.PI*2);ctx.fillStyle=hexA(col,0.95);ctx.fill();
        });
      });
    }

    ctx.fillStyle=light?'rgba(31,41,55,.20)':'rgba(255,255,255,.16)';
    ctx.font='9px JetBrains Mono,monospace';ctx.textAlign='left';
    ctx.fillText(autoRot?'floating · drag · scroll zoom':'drag · scroll zoom',7,H-7);
  }

  function tick(){
    motionT+=0.014;
    if(autoRot&&!drag){autoAng+=0.0026;rotY=autoAng;}
    canvases.forEach(c=>drawOn(c));
    raf=requestAnimationFrame(tick);
  }

  function renderNow(){canvases.forEach(c=>drawOn(c));}

  function start(){
    reg('viewer3d');reg('viewer3d-mini');
    sync3dControls();
    if(!raf)tick();
    else renderNow();
  }

  function resetState(){
    rotX=0.25;rotY=0;zoom=1;autoRot=true;autoAng=0;_savedAutoRot=true;showLoops=true;showComp=true;
  }
  function resetView(){resetState();renderNow();sync3dControls();}
  function zoomStep(factor){zoom=Math.max(0.08,Math.min(50,zoom*factor));renderNow();}
  function setAutoRot(v){autoRot=!!v;if(autoRot)autoAng=rotY;_savedAutoRot=autoRot;renderNow();sync3dControls();}
  function setShowLoops(v){showLoops=!!v;renderNow();sync3dControls();}
  function setShowComp(v){showComp=!!v;renderNow();sync3dControls();}

  return{load,reg,start,setHighlight,reset:resetView,zoomBy:zoomStep,renderNow,setAutoRot,setShowLoops,setShowComp,
    get showLoops(){return showLoops;},
    get showComp(){return showComp;},
    get autoRot(){return autoRot;},
    set autoRot(v){setAutoRot(v);},
  };})();

function updateCtrl(id,on){
  const el=$(id);if(!el)return;
  el.textContent=on?'On':'Off';
  el.classList.toggle('on',on);
}
function sync3dControls(){
  updateCtrl('ctrl-rot',C3D.autoRot);
  updateCtrl('ctrl-loops',C3D.showLoops);
  updateCtrl('ctrl-comp',C3D.showComp);
}
function bind3dCtrl(id,handler){
  const el=$(id);if(!el)return;
  el.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();handler();});
}
bind3dCtrl('ctrl-rot',()=>C3D.setAutoRot(!C3D.autoRot));
bind3dCtrl('ctrl-loops',()=>C3D.setShowLoops(!C3D.showLoops));
bind3dCtrl('ctrl-comp',()=>C3D.setShowComp(!C3D.showComp));
bind3dCtrl('ctrl-reset',()=>C3D.reset());
bind3dCtrl('ctrl-zin',()=>C3D.zoomBy(1.35));
bind3dCtrl('ctrl-zout',()=>C3D.zoomBy(0.74));
SYNC.on('v3d',(b0,b1)=>{if(b0==null){C3D.setHighlight(null,null);return;}C3D.setHighlight(b0,b1);});
