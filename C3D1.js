const $ = id => document.getElementById(id);
const SYNC = { on: ()=>{}, emit: ()=>{}, clear: ()=>{} }; // Mock SYNC if you don't have a real one

function hexA(hex, alpha) {
  if (!hex || !hex.startsWith('#')) return hex || 'rgba(0,0,0,0)';
  let c = hex.substring(1).split('');
  if (c.length === 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
  c = '0x' + c.join('');
  return `rgba(${(c>>16)&255}, ${(c>>8)&255}, ${c&255}, ${alpha})`;
}

const C3D = (() => {
  let data = null;
  let rotX = 0.25, rotY = 0, zoom = 1;
  let autoAng = 0, autoRot = true;
  let drag = false, prevMX = 0, prevMY = 0;
  let showLoops = true, showComp = true;
  let raf = null;
  let hlB0 = null, hlB1 = null;
  let eventsInited = false;
  let restoreTimer = null;
  let _savedAutoRot = true;
  let motionT = 0;

  // Cached 3D structural data for smoothness
  let centroid = { x: 0, y: 0, z: 0 };
  let splineBackbone = [];
  let splineLoops = [];

  const canvases = new Set();
  const pointCache = new WeakMap();

  // Helper for 3D Catmull-Rom Spline
  function catmullRom(t, p0, p1, p2, p3) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (
      (2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
  }

  function getPt(idx, arr) {
    return arr[Math.max(0, Math.min(arr.length - 1, idx))];
  }

  // Precompute smooth 3D structures based on biological polymer physics
  function build3DGeometry() {
    if (!data || !data.x.length) return;
    const { x, y, z, loops } = data;
    const n = x.length;

    // 1. Calculate Centroid for outward loop extrusion
    centroid = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < n; i++) {
      centroid.x += x[i]; centroid.y += y[i]; centroid.z += z[i];
    }
    centroid.x /= n; centroid.y /= n; centroid.z /= n;

    // 2. Build Smooth Chromatin Backbone (Splines)
    splineBackbone = [];
    const steps = 4; // Subdivisions for smoothness
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < steps; j++) {
        const t = j / steps;
        splineBackbone.push({
          x: catmullRom(t, getPt(i-1, x), getPt(i, x), getPt(i+1, x), getPt(i+2, x)),
          y: catmullRom(t, getPt(i-1, y), getPt(i, y), getPt(i+1, y), getPt(i+2, y)),
          z: catmullRom(t, getPt(i-1, z), getPt(i, z), getPt(i+1, z), getPt(i+2, z)),
          bin: i, t: t
        });
      }
    }
    splineBackbone.push({ x: x[n-1], y: y[n-1], z: z[n-1], bin: n-1, t: 0 });

    // 3. Build 3D Outward-Extruding Loops (EPI Sites)
    splineLoops = [];
    if (loops && loops.length) {
      loops.forEach(lp => {
        const ai = Math.min(lp.a, n - 1);
        const bi = Math.min(lp.b, n - 1);
        const score = lp.score || 0.5;

        const A = { x: x[ai], y: y[ai], z: z[ai] };
        const B = { x: x[bi], y: y[bi], z: z[bi] };
        const M = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, z: (A.z + B.z) / 2 };

        // Vector from center to midpoint (pushes EPI interaction loops to the periphery)
        const dx = M.x - centroid.x, dy = M.y - centroid.y, dz = M.z - centroid.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        const distAB = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
        
        // Intensity score maps to the bulge factor
        const bulge = distAB * (0.25 + score * 0.45); 
        const CP = { x: M.x + (dx / len) * bulge, y: M.y + (dy / len) * bulge, z: M.z + (dz / len) * bulge };

        const loopSteps = Math.max(8, Math.floor(distAB * 1.5));
        const lPts = [];
        // Quadratic 3D Bezier for the Loop
        for (let j = 0; j <= loopSteps; j++) {
          const t = j / loopSteps;
          const mt = 1 - t;
          lPts.push({
            x: mt * mt * A.x + 2 * mt * t * CP.x + t * t * B.x,
            y: mt * mt * A.y + 2 * mt * t * CP.y + t * t * B.y,
            z: mt * mt * A.z + 2 * mt * t * CP.z + t * t * B.z
          });
        }
        splineLoops.push({ lp, lPts, ai, bi, score });
      });
    }
  }

  function load(d) {
    data = d;
    const nl = d.loops?.length ?? 0;
    const nt = d.tad_boundaries?.length ?? 0;
    if ($('v3d-n-loops')) $('v3d-n-loops').textContent = nl;
    if ($('v3d-n-tads')) $('v3d-n-tads').textContent = nt;
    build3DGeometry();
    renderNow();
  }

  function reg(id) {
    const el = $(id); if (!el || canvases.has(el)) return;
    canvases.add(el);
    el.addEventListener('mousedown', e => {
      drag = true;
      if (restoreTimer) clearTimeout(restoreTimer);
      _savedAutoRot = autoRot;
      autoRot = false;
      sync3dControls();
      prevMX = e.clientX; prevMY = e.clientY; e.preventDefault();
    });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      zoom = Math.max(0.08, Math.min(50, zoom * (e.deltaY < 0 ? 1.15 : .87)));
      renderNow();
    }, { passive: false });
    el.addEventListener('mousemove', e => {
      if (!data) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const pts = pointCache.get(el);
      if (!pts) return;
      _handleHover((e.clientX - rect.left) * (el.width / rect.width), (e.clientY - rect.top) * (el.height / rect.height), pts);
    });
    el.addEventListener('mouseleave', () => {
      if(typeof SYNC !== 'undefined') SYNC.clear('v3d');
      hlB0 = hlB1 = null; 
      if(typeof clearMapHighlight !== 'undefined') {
        clearMapHighlight(); clearArcHighlight(); clearTableHighlight();
      }
    });
    if (!eventsInited) {
      eventsInited = true;
      window.addEventListener('mousemove', e => {
        if (!drag) return;
        rotY += (e.clientX - prevMX) * 0.008;
        autoAng = rotY;
        rotX = Math.max(-1.3, Math.min(1.3, rotX + (e.clientY - prevMY) * 0.008));
        prevMX = e.clientX; prevMY = e.clientY;
      });
      window.addEventListener('mouseup', () => {
        if (!drag) return;
        drag = false;
        if (restoreTimer) clearTimeout(restoreTimer);
        restoreTimer = setTimeout(() => { setAutoRot(_savedAutoRot); }, 1400);
      });
    }
  }

  function setHighlight(b0, b1) { hlB0 = b0; hlB1 = b1; }

  function _handleHover(mx, my, pts) {
    let best = null, bestD = 30;
    pts.forEach((p, i) => { const d = Math.hypot(p.px - mx, p.py - my); if (d < bestD) { bestD = d; best = i; } });
    if (best !== null) {
      const binReal = data.bin_map ? data.bin_map[best] : best;
      const b0 = Math.max(0, binReal - 5), b1 = binReal + 5;
      hlB0 = b0; hlB1 = b1;
      if(typeof SYNC !== 'undefined') SYNC.emit(b0, b1, 'v3d', { label: `3D ~bin ${binReal}` });
      if(typeof showMapHighlight !== 'undefined') {
        showMapHighlight(b0, b1); highlightArcSel(b0, b1); highlightTable(b0, b1);
      }
    } else {
      hlB0 = hlB1 = null; 
      if(typeof SYNC !== 'undefined') SYNC.clear('v3d'); 
      if(typeof clearMapHighlight !== 'undefined') {
        clearMapHighlight(); clearArcHighlight(); clearTableHighlight();
      }
    }
  }

  function proj(px, py, pz) {
    const cy = Math.cos(rotY), sy = Math.sin(rotY);
    const x1 = px * cy + pz * sy, z1 = -px * sy + pz * cy;
    const cx = Math.cos(rotX), sx = Math.sin(rotX);
    const y2 = py * cx - z1 * sx, z2 = py * sx + z1 * cx;
    const d = 22; const f = d / (d + z2 + 10);
    return { sx: x1 * f, sy: y2 * f, z: z2, f };
  }

  function drawBackdrop(ctx, W, H, light) {
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, W, H);
    if (light) {
      bg.addColorStop(0, 'rgba(244,248,252,.92)');
      bg.addColorStop(1, 'rgba(220,229,240,.98)');
    } else {
      bg.addColorStop(0, 'rgba(6,10,18,.78)');
      bg.addColorStop(1, 'rgba(2,4,10,.98)');
    }
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(
      W * (0.34 + Math.sin(motionT * 0.19) * 0.08), H * (0.28 + Math.cos(motionT * 0.16) * 0.06), 0,
      W * 0.46, H * 0.42, Math.max(W, H) * 0.7
    );
    glow.addColorStop(0, light ? 'rgba(36,113,163,.16)' : 'rgba(36,113,163,.16)');
    glow.addColorStop(0.5, light ? 'rgba(231,76,60,.05)' : 'rgba(231,76,60,.06)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  }

  function drawOn(canvas) {
    if (!data || !canvas) return;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight || canvas.parentElement?.clientHeight || 380;
    if (W < 4 || H < 4) return;
    canvas.width = W; canvas.height = H;

    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const light = document.documentElement.getAttribute('data-theme') === 'light';
    drawBackdrop(ctx, W, H, light);

    const { colors, ev } = data;
    const n = data.x.length;
    if (!n) return;

    const scale = Math.min(W, H) * 0.031 * zoom * (1 + Math.sin(motionT * 0.72) * 0.018);
    const OCX = W / 2 + Math.sin(motionT * 0.55) * Math.min(W, H) * 0.045;
    const OCY = H / 2 + Math.cos(motionT * 0.43) * Math.min(W, H) * 0.038;

    // Cache exact 2D projection for hover detection (using original bins)
    const pts = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = proj(data.x[i], data.y[i], data.z[i]);
      pts[i] = { px: OCX + p.sx * scale, py: OCY + p.sy * scale, z: p.z, f: p.f };
    }
    pointCache.set(canvas, pts);

    const renderList = []; // Unified array to depth-sort EVERY element

    // 1. Prepare Smooth Backbone Segments
    let prevP = null;
    for (let i = 0; i < splineBackbone.length; i++) {
      const cur = splineBackbone[i];
      const p = proj(cur.x, cur.y, cur.z);
      const currP = { px: OCX + p.sx * scale, py: OCY + p.sy * scale, z: p.z, f: p.f };
      
      if (prevP) {
        const binReal = data.bin_map ? data.bin_map[cur.bin] : cur.bin;
        const isHL = hlB0 != null && binReal >= hlB0 && binReal <= hlB1;
        const col = showComp ? (ev && ev[cur.bin] > 0.5 ? '#e74c3c' : '#2980b9') : (colors[cur.bin] || '#5dade2');
        renderList.push({
          type: 'backbone',
          z: (prevP.z + currP.z) * 0.5,
          p1: prevP, p2: currP,
          col, isHL
        });
      }
      prevP = currP;
    }

    // 2. Prepare TAD Boundaries
    if (data.tad_boundaries) {
      data.tad_boundaries.forEach(bi => {
        if (bi >= n) return;
        renderList.push({ type: 'tad', z: pts[bi].z, p: pts[bi] });
      });
    }

    // 3. Prepare EPI Loops
    if (showLoops && splineLoops.length) {
      splineLoops.forEach(loop => {
        let prevLp = null;
        const dynamicPulse = Math.abs(Math.sin(motionT * 2 + loop.score * 5));
        const activeAlpha = 0.4 + loop.score * 0.4 + dynamicPulse * 0.2;
        const color = loop.lp.color || '#ff3333';

        loop.lPts.forEach((pt) => {
          const p = proj(pt.x, pt.y, pt.z);
          const currLp = { px: OCX + p.sx * scale, py: OCY + p.sy * scale, z: p.z, f: p.f };
          if (prevLp) {
            renderList.push({
              type: 'loop',
              z: (prevLp.z + currLp.z) * 0.5,
              p1: prevLp, p2: currLp,
              color, alpha: activeAlpha, score: loop.score
            });
          }
          prevLp = currLp;
        });

        // Add loop anchors (EPI interaction bases)
        [pts[loop.ai], pts[loop.bi]].forEach(p => {
          if (!p) return;
          renderList.push({ type: 'anchor', z: p.z - 0.1, p, color, score: loop.score });
        });
      });
    }

    // Sort everything back-to-front for true 3D visual depth
    renderList.sort((a, b) => a.z - b.z);

    // RENDER PASS
    renderList.forEach(item => {
      if (item.type === 'backbone') {
        const avgF = (item.p1.f + item.p2.f) * 0.5;
        const alpha = item.isHL ? 1 : Math.max(0.2, 0.25 + avgF * 0.7);
        ctx.beginPath(); ctx.moveTo(item.p1.px, item.p1.py); ctx.lineTo(item.p2.px, item.p2.py);
        ctx.strokeStyle = (typeof hexA !== 'undefined') ? hexA(item.col, alpha) : item.col;
        ctx.lineWidth = item.isHL ? 4.5 : Math.max(0.8, 3.2 * avgF);
        ctx.stroke();

      } else if (item.type === 'loop') {
        const avgF = (item.p1.f + item.p2.f) * 0.5;
        ctx.beginPath(); ctx.moveTo(item.p1.px, item.p1.py); ctx.lineTo(item.p2.px, item.p2.py);
        ctx.strokeStyle = (typeof hexA !== 'undefined') ? hexA(item.color, item.alpha) : item.color;
        ctx.lineWidth = Math.max(1, (1.0 + item.score * 3.0) * avgF);
        ctx.stroke();

      } else if (item.type === 'tad') {
        ctx.beginPath(); ctx.arc(item.p.px, item.p.py, Math.max(2, 3.8 * item.p.f), 0, Math.PI * 2);
        ctx.fillStyle = (typeof hexA !== 'undefined') ? hexA('#22d3ee', 0.9) : '#22d3ee';
        ctx.fill();

      } else if (item.type === 'anchor') {
        const r = Math.max(1.5, 3.5 * item.p.f * Math.min(zoom, 2));
        const g = ctx.createRadialGradient(item.p.px, item.p.py, 0, item.p.px, item.p.py, r * 3);
        const rgbaC = (typeof hexA !== 'undefined') ? hexA(item.color, 1) : item.color;
        g.addColorStop(0, (typeof hexA !== 'undefined') ? hexA(item.color, 0.5 * item.score) : rgbaC);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        
        ctx.beginPath(); ctx.arc(item.p.px, item.p.py, r * 3, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
        ctx.beginPath(); ctx.arc(item.p.px, item.p.py, r, 0, Math.PI * 2); 
        ctx.fillStyle = (typeof hexA !== 'undefined') ? hexA(item.color, 0.95) : item.color; 
        ctx.fill();
      }
    });

    ctx.fillStyle = light ? 'rgba(31,41,55,.20)' : 'rgba(255,255,255,.16)';
    ctx.font = '9px JetBrains Mono,monospace'; ctx.textAlign = 'left';
    ctx.fillText(autoRot ? 'floating · drag · scroll zoom' : 'drag · scroll zoom', 7, H - 7);
  }

  function tick() {
    motionT += 0.014;
    if (autoRot && !drag) { autoAng += 0.0026; rotY = autoAng; }
    canvases.forEach(c => drawOn(c));
    raf = requestAnimationFrame(tick);
  }

  function renderNow() { canvases.forEach(c => drawOn(c)); }

  function start() {
    reg('viewer3d'); reg('viewer3d-mini');
    sync3dControls();
    if (!raf) tick();
    else renderNow();
  }

  function resetState() {
    rotX = 0.25; rotY = 0; zoom = 1; autoRot = true; autoAng = 0; _savedAutoRot = true; showLoops = true; showComp = true;
  }
  function resetView() { resetState(); renderNow(); sync3dControls(); }
  function zoomStep(factor) { zoom = Math.max(0.08, Math.min(50, zoom * factor)); renderNow(); }
  function setAutoRot(v) { autoRot = !!v; if (autoRot) autoAng = rotY; _savedAutoRot = autoRot; renderNow(); sync3dControls(); }
  function setShowLoops(v) { showLoops = !!v; renderNow(); sync3dControls(); }
  function setShowComp(v) { showComp = !!v; renderNow(); sync3dControls(); }

  return {
    load, reg, start, setHighlight, reset: resetView, zoomBy: zoomStep, renderNow, setAutoRot, setShowLoops, setShowComp,
    get showLoops() { return showLoops; },
    get showComp() { return showComp; },
    get autoRot() { return autoRot; },
    set autoRot(v) { setAutoRot(v); },
  };
})();

function updateCtrl(id, on) {
  const el = $(id); if (!el) return;
  el.textContent = on ? 'On' : 'Off';
  el.classList.toggle('on', on);
}
function sync3dControls() {
  updateCtrl('ctrl-rot', C3D.autoRot);
  updateCtrl('ctrl-loops', C3D.showLoops);
  updateCtrl('ctrl-comp', C3D.showComp);
}
function bind3dCtrl(id, handler) {
  const el = $(id); if (!el) return;
  el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); handler(); });
}

// Event Bindings
if(typeof $ !== 'undefined') {
  bind3dCtrl('ctrl-rot', () => C3D.setAutoRot(!C3D.autoRot));
  bind3dCtrl('ctrl-loops', () => C3D.setShowLoops(!C3D.showLoops));
  bind3dCtrl('ctrl-comp', () => C3D.setShowComp(!C3D.showComp));
  bind3dCtrl('ctrl-reset', () => C3D.reset());
  bind3dCtrl('ctrl-zin', () => C3D.zoomBy(1.35));
  bind3dCtrl('ctrl-zout', () => C3D.zoomBy(0.74));
}
if(typeof SYNC !== 'undefined') {
  SYNC.on('v3d', (b0, b1) => { if (b0 == null) { C3D.setHighlight(null, null); return; } C3D.setHighlight(b0, b1); });
}
