import React, { useEffect, useRef, useState, useMemo } from 'react';
import { ChromatinData, Point3D, ProjectedPoint } from '../types';
import { Maximize2, RotateCcw, ZoomIn, ZoomOut, Play, Pause, Layers, Link as LinkIcon } from 'lucide-react';

interface ChromatinViewerProps {
  data: ChromatinData;
}

const HEX_A = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Catmull-Rom interpolation
function getSplinePoint(p0: Point3D, p1: Point3D, p2: Point3D, p3: Point3D, t: number): Point3D {
  const t2 = t * t;
  const t3 = t2 * t;
  const f1 = -0.5 * t3 + t2 - 0.5 * t;
  const f2 = 1.5 * t3 - 2.5 * t2 + 1.0;
  const f3 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
  const f4 = 0.5 * t3 - 0.5 * t2;

  return {
    x: p0.x * f1 + p1.x * f2 + p2.x * f3 + p3.x * f4,
    y: p0.y * f1 + p1.y * f2 + p2.y * f3 + p3.y * f4,
    z: p0.z * f1 + p1.z * f2 + p2.z * f3 + p3.z * f4,
  };
}

export const ChromatinViewer: React.FC<ChromatinViewerProps> = ({ data }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [rotX, setRotX] = useState(0.25);
  const [rotY, setRotY] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [autoRot, setAutoRot] = useState(true);
  const [showLoops, setShowLoops] = useState(true);
  const [showBeads, setShowBeads] = useState(true);
  
  const stateRef = useRef({ rotX, rotY, zoom, autoRot, motionT: 0 });

  // Sync state to ref for access in animation frame
  useEffect(() => {
    stateRef.current = { rotX, rotY, zoom, autoRot, motionT: stateRef.current.motionT };
  }, [rotX, rotY, zoom, autoRot]);

  // Handle Dragging
  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const onMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    lastMousePos.current = { x: e.clientX, y: e.clientY };
    setAutoRot(false);
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setRotY(y => y + dx * 0.008);
      setRotX(x => Math.max(-1.5, Math.min(1.5, x + dy * 0.008)));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDragging.current = false;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Subdivide backbone for splines
  const splinePoints = useMemo(() => {
    const points: Point3D[] = [];
    const sourcePoints: Point3D[] = data.x.map((x, i) => ({ x, y: data.y[i], z: data.z[i] }));
    const n = sourcePoints.length;
    if (n < 4) return sourcePoints;

    const subdivisions = 6;
    for (let i = 0; i < n - 1; i++) {
      const p0 = sourcePoints[Math.max(0, i - 1)];
      const p1 = sourcePoints[i];
      const p2 = sourcePoints[i + 1];
      const p3 = sourcePoints[Math.min(n - 1, i + 2)];

      for (let s = 0; s < subdivisions; s++) {
        points.push(getSplinePoint(p0, p1, p2, p3, s / subdivisions));
      }
    }
    points.push(sourcePoints[n - 1]);
    return points;
  }, [data]);

  // Main Draw Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId: number;

    const render = () => {
      const { rotX: rX, rotY: rY, zoom: zM, autoRot: aR, motionT } = stateRef.current;
      
      // Update auto-rotation
      if (aR) {
        stateRef.current.rotY += 0.003;
        setRotY(stateRef.current.rotY);
      }
      stateRef.current.motionT += 0.016;

      const W = canvas.width = containerRef.current?.offsetWidth || 800;
      const H = canvas.height = containerRef.current?.offsetHeight || 600;
      
      ctx.clearRect(0, 0, W, H);
      
      // Background Gradient
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#0f172a');
      bg.addColorStop(1, '#020617');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Distant glow
      const glow = ctx.createRadialGradient(W*0.5, H*0.5, 0, W*0.5, H*0.5, Math.max(W,H)*0.8);
      glow.addColorStop(0, 'rgba(30, 58, 138, 0.2)');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      // Projection Helpers
      const proj = (p: Point3D) => {
        const cy = Math.cos(stateRef.current.rotY), sy = Math.sin(stateRef.current.rotY);
        const x1 = p.x * cy + p.z * sy, z1 = -p.x * sy + p.z * cy;
        const cx = Math.cos(stateRef.current.rotX), sx = Math.sin(stateRef.current.rotX);
        const y2 = p.y * cx - z1 * sx, z2 = p.y * sx + z1 * cx;
        const dist = 30;
        const f = dist / (dist + z2 + 20);
        const scale = Math.min(W, H) * 0.03 * zM;
        return {
          px: W / 2 + x1 * f * scale,
          py: H / 2 + y2 * f * scale,
          z: z2,
          f
        };
      };

      const pts = splinePoints.map(p => proj(p));
      const n = pts.length;

      // Draw Backbone with Tubes
      for (let i = 1; i < n; i++) {
        const a = pts[i-1], b = pts[i];
        const avgZ = (a.z + b.z) / 2;
        const alpha = Math.max(0.1, Math.min(1, (30 - avgZ) / 40)); // Depth fog
        
        // Map spline index back to original color index
        const originalIdx = Math.floor((i / n) * data.x.length);
        const color = data.colors[originalIdx] || '#ffffff';

        // Tube Pass 1: Outer Glow
        ctx.beginPath();
        ctx.moveTo(a.px, a.py);
        ctx.lineTo(b.px, b.py);
        ctx.strokeStyle = HEX_A(color, alpha * 0.3);
        ctx.lineWidth = Math.max(1, 8 * a.f);
        ctx.stroke();

        // Tube Pass 2: Main Body
        ctx.beginPath();
        ctx.moveTo(a.px, a.py);
        ctx.lineTo(b.px, b.py);
        ctx.strokeStyle = HEX_A(color, alpha);
        ctx.lineWidth = Math.max(0.5, 3 * a.f);
        ctx.stroke();

        // Tube Pass 3: Specular Highlight
        ctx.beginPath();
        ctx.moveTo(a.px - 0.5 * a.f, a.py - 0.5 * a.f);
        ctx.lineTo(b.px - 0.5 * a.f, b.py - 0.5 * a.f);
        ctx.strokeStyle = HEX_A('#ffffff', alpha * 0.8);
        ctx.lineWidth = Math.max(0.2, 1 * a.f);
        ctx.stroke();
      }

      // Draw Beads (Nucleosomes)
      if (showBeads) {
        data.x.forEach((_, i) => {
          const p = proj({ x: data.x[i], y: data.y[i], z: data.z[i] });
          const alpha = Math.max(0.1, (30 - p.z) / 40);
          const r = Math.max(2, 6 * p.f);
          
          const grad = ctx.createRadialGradient(p.px - r*0.3, p.py - r*0.3, 0, p.px, p.py, r);
          grad.addColorStop(0, '#fff');
          grad.addColorStop(0.2, data.colors[i]);
          grad.addColorStop(1, '#000');
          
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.globalAlpha = 1;
        });
      }

      // Draw Loops
      if (showLoops && data.loops) {
        data.loops.forEach(loop => {
          const pA = proj({ x: data.x[loop.a], y: data.y[loop.a], z: data.z[loop.a] });
          const pB = proj({ x: data.x[loop.b], y: data.y[loop.b], z: data.z[loop.b] });
          
          const midX = (data.x[loop.a] + data.x[loop.b]) / 2;
          const midY = (data.y[loop.a] + data.y[loop.b]) / 2 - 10 * loop.score;
          const midZ = (data.z[loop.a] + data.z[loop.b]) / 2;
          const cp = proj({ x: midX, y: midY, z: midZ });

          const color = loop.color || '#ff3366';
          const alpha = Math.max(0.1, (30 - (pA.z+pB.z)/2) / 40) * loop.score;

          // Loop Glow
          ctx.beginPath();
          ctx.moveTo(pA.px, pA.py);
          ctx.quadraticCurveTo(cp.px, cp.py, pB.px, pB.py);
          ctx.strokeStyle = HEX_A(color, alpha * 0.4);
          ctx.lineWidth = 4 * loop.score;
          ctx.stroke();

          // Loop Core
          ctx.beginPath();
          ctx.moveTo(pA.px, pA.py);
          ctx.quadraticCurveTo(cp.px, cp.py, pB.px, pB.py);
          ctx.strokeStyle = HEX_A(color, alpha * 0.9);
          ctx.lineWidth = 1.5 * loop.score;
          ctx.stroke();
          
          // Halos at anchor points
          [pA, pB].forEach(p => {
             const r = 8 * p.f * loop.score;
             const hGrad = ctx.createRadialGradient(p.px, p.py, 0, p.px, p.py, r);
             hGrad.addColorStop(0, HEX_A(color, 0.4 * alpha));
             hGrad.addColorStop(1, 'transparent');
             ctx.fillStyle = hGrad;
             ctx.beginPath();
             ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
             ctx.fill();
          });
        });
      }

      rafId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(rafId);
  }, [splinePoints, data, showLoops, showBeads]);

  return (
    <div ref={containerRef} className="relative w-full h-full bg-slate-950 overflow-hidden group">
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />
      
      {/* Overlay Controls */}
      <div className="absolute top-6 left-6 flex flex-col gap-3">
        <div className="bg-slate-900/80 backdrop-blur-md p-4 rounded-2xl border border-slate-700/50 shadow-2xl">
          <h2 className="text-slate-100 font-bold text-lg mb-1 flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-400" />
            3D Structure
          </h2>
          <p className="text-slate-400 text-xs font-mono">
            {data.x.length} bins · {data.tad_boundaries?.length || 0} TADs
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <ControlButton active={autoRot} onClick={() => setAutoRot(!autoRot)}>
            {autoRot ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {autoRot ? 'Auto-Rotate' : 'Paused'}
          </ControlButton>
          <ControlButton active={showLoops} onClick={() => setShowLoops(!showLoops)}>
            <LinkIcon className="w-4 h-4" />
            Loops
          </ControlButton>
          <ControlButton active={showBeads} onClick={() => setShowBeads(!showBeads)}>
            <Layers className="w-4 h-4" />
            Beads
          </ControlButton>
        </div>
      </div>

      <div className="absolute bottom-6 right-6 flex flex-col gap-2">
        <ScaleButton onClick={() => setZoom(z => Math.min(5, z * 1.2))}><ZoomIn className="w-5 h-5" /></ScaleButton>
        <ScaleButton onClick={() => setZoom(z => Math.max(0.1, z / 1.2))}><ZoomOut className="w-5 h-5" /></ScaleButton>
        <ScaleButton onClick={() => { setRotX(0.25); setRotY(0); setZoom(1); }}><RotateCcw className="w-5 h-5" /></ScaleButton>
      </div>

      <div className="absolute bottom-6 left-6 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500">
        <div className="text-slate-500 text-[10px] font-mono flex flex-col gap-1">
          <p>BACKBONE: Catmull-Rom Spline</p>
          <p>SHADING: 3-Pass Tube Tech</p>
          <p>DEPTH: Linear Fog Falloff</p>
        </div>
      </div>
    </div>
  );
};

const ControlButton: React.FC<{ active: boolean, onClick: () => void, children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-300 border ${
      active 
        ? 'bg-blue-500/20 text-blue-300 border-blue-500/50 shadow-[0_0_15px_-3px_rgba(59,130,246,0.3)]' 
        : 'bg-slate-900/60 text-slate-400 border-slate-700/50 hover:bg-slate-800'
    }`}
  >
    {children}
  </button>
);

const ScaleButton: React.FC<{ onClick: () => void, children: React.ReactNode }> = ({ onClick, children }) => (
  <button
    onClick={onClick}
    className="p-3 rounded-xl bg-slate-900/80 backdrop-blur-md border border-slate-700/50 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-all shadow-xl"
  >
    {children}
  </button>
);
