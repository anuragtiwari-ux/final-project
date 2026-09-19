import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import {
  BatteryMedium, Gauge, IndianRupee, Sun, ShieldCheck, AlertTriangle, Recycle,
  SlidersHorizontal, Zap, ScanLine, CheckCircle2, FlaskConical, Wifi, WifiOff,
} from "lucide-react";

// API base URL — set VITE_API_URL in Netlify's environment variables to your
// deployed Flask backend (e.g. https://your-app.onrender.com). Falls back to
// localhost for local development.
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

// ---------------------------------------------------------------------------
// PRESETS
// ---------------------------------------------------------------------------
const PRESETS = {
  custom: null,
  erickshaw: { label: "3-yr E-Rickshaw (heavy daily use)", ageMonths: 36, cycles: 1400, avgDoD: 85, cRate: 1.6, avgTemp: 34, capacityKwh: 6, originalCostPerKwh: 9000 },
  hatchback: { label: "1.5-yr Hatchback EV (moderate use)", ageMonths: 18, cycles: 320, avgDoD: 55, cRate: 0.8, avgTemp: 28, capacityKwh: 30, originalCostPerKwh: 9500 },
  scooter: { label: "5-yr Electric Scooter (aged, hot climate)", ageMonths: 60, cycles: 1100, avgDoD: 75, cRate: 1.2, avgTemp: 36, capacityKwh: 2.5, originalCostPerKwh: 8500 },
};

// ---------------------------------------------------------------------------
// LOCAL FALLBACK MODEL — identical formula to the backend's /predict/demo,
// so the site works standalone even before a backend is deployed, and so
// the UI never blocks on network latency.
// ---------------------------------------------------------------------------
function computeSOH({ ageMonths, cycles, avgDoD, cRate, avgTemp }, cycleOverride) {
  const c = cycleOverride ?? cycles;
  const tempStress = Math.exp((avgTemp - 25) / 18);
  const dodStress = 1 + (avgDoD / 100 - 0.5) * 0.7;
  const cRateStress = 1 + Math.max(0, cRate - 1) * 0.18;
  const cycleFade = 2.1 * Math.sqrt(c) * tempStress * dodStress * cRateStress * 0.01;
  const calendarFade = 0.09 * ageMonths * tempStress * 0.6;
  return Math.max(30, Math.min(100, 100 - cycleFade - calendarFade));
}
function estimateRUL(inputs) {
  const step = 50;
  let c = inputs.cycles, soh = computeSOH(inputs, c), guard = 0;
  if (soh <= 80) return 0;
  while (soh > 80 && guard < 400) { c += step; soh = computeSOH(inputs, c); guard++; }
  return Math.max(0, c - inputs.cycles);
}
function buildCurve(inputs) {
  const points = [];
  const maxCycles = inputs.cycles + 2200;
  const step = Math.max(50, Math.round(maxCycles / 40));
  for (let c = 0; c <= maxCycles; c += step) points.push({ cycle: c, soh: Number(computeSOH(inputs, c).toFixed(1)) });
  return points;
}
function classify(soh) {
  if (soh >= 90) return { label: "Excellent", sub: "Prime resale grade", color: "var(--teal)", glow: "var(--teal-glow)", icon: ShieldCheck };
  if (soh >= 80) return { label: "Good", sub: "Resale eligible", color: "var(--teal)", glow: "var(--teal-glow)", icon: ShieldCheck };
  if (soh >= 70) return { label: "Fair", sub: "Second-life candidate — solar storage", color: "var(--amber)", glow: "var(--amber-glow)", icon: Sun };
  return { label: "Poor", sub: "Below reuse threshold — recycle", color: "var(--red)", glow: "var(--red-glow)", icon: Recycle };
}
function formatINR(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }

function useAnimatedNumber(target, duration = 700) {
  const [value, setValue] = useState(target);
  const prevRef = useRef(target);
  const rafRef = useRef(null);
  useEffect(() => {
    const start = prevRef.current;
    const startTime = performance.now();
    cancelAnimationFrame(rafRef.current);
    function tick(now) {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(start + (target - start) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick); else prevRef.current = target;
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return value;
}

function ParticleField() {
  const particles = useMemo(() => Array.from({ length: 22 }).map((_, i) => ({
    id: i, left: Math.random() * 100, size: 2 + Math.random() * 3,
    duration: 14 + Math.random() * 16, delay: -Math.random() * 20, drift: (Math.random() - 0.5) * 60,
  })), []);
  return (
    <div className="particle-field" aria-hidden="true">
      {particles.map((p) => (
        <span key={p.id} className="particle" style={{ left: `${p.left}%`, width: p.size, height: p.size, animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s`, "--drift": `${p.drift}px` }} />
      ))}
    </div>
  );
}

function SliderField({ label, unit, value, min, max, step, onChange, hint, index }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="field reveal" style={{ transitionDelay: `${0.35 + index * 0.06}s` }}>
      <div className="field-head"><label>{label}</label><span className="field-value">{value}<span className="field-unit">{unit}</span></span></div>
      <div className="slider-track-wrap">
        <div className="slider-fill" style={{ width: `${pct}%` }} />
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

function LiquidBatteryGauge({ soh, status, scanning }) {
  const animatedSoh = useAnimatedNumber(soh, 900);
  const fillHeight = Math.max(4, (animatedSoh / 100) * 86);
  const fillTop = 186 - fillHeight;
  const Icon = status.icon;
  return (
    <div className="gauge-wrap">
      <div className="gauge-glow-ring" style={{ "--glow": status.glow }} />
      <svg viewBox="0 0 120 200" className="gauge-svg" aria-hidden="true">
        <defs>
          <clipPath id="battClip"><rect x="18" y={fillTop} width="84" height={fillHeight} rx="8" /></clipPath>
          <linearGradient id="liquidGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={status.color} stopOpacity="0.55" />
            <stop offset="100%" stopColor={status.color} stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id="scanGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="45" y="6" width="30" height="10" rx="3" fill="var(--border)" />
        <rect x="10" y="18" width="100" height="176" rx="14" fill="var(--panel-2)" stroke="var(--border)" strokeWidth="2" />
        <g clipPath="url(#battClip)">
          <rect x="14" y={fillTop} width="92" height={fillHeight + 30} fill="url(#liquidGrad)" />
          <path className="wave wave-1" d="M0,10 C 15,2 35,18 50,10 C 65,2 85,18 100,10 C 115,2 135,18 150,10 L150,40 L0,40 Z" transform={`translate(-15, ${fillTop - 6})`} fill={status.color} opacity="0.55" />
          <path className="wave wave-2" d="M0,12 C 18,20 32,4 50,12 C 68,20 82,4 100,12 C 118,20 132,4 150,12 L150,40 L0,40 Z" transform={`translate(-15, ${fillTop - 4})`} fill={status.color} opacity="0.35" />
        </g>
        {scanning && <rect x="10" y="18" width="100" height="176" rx="14" fill="url(#scanGrad)" className="scan-sweep" />}
      </svg>
      <div className="gauge-readout">
        <div className="gauge-soh" style={{ color: status.color }}>{animatedSoh.toFixed(1)}<span className="gauge-pct">%</span></div>
        <div className="gauge-label">State of Health</div>
        <div className="status-pill" style={{ borderColor: status.color, color: status.color }}><Icon size={14} strokeWidth={2.4} />{status.label}</div>
      </div>
    </div>
  );
}

function RulRing({ rul, maxRul = 2000 }) {
  const animatedRul = useAnimatedNumber(rul, 900);
  const pct = Math.min(1, animatedRul / maxRul);
  const r = 30, circumference = 2 * Math.PI * r, offset = circumference * (1 - pct);
  return (
    <div className="rul-ring-wrap">
      <svg viewBox="0 0 72 72" className="rul-ring-svg">
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--border)" strokeWidth="5" />
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--teal)" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset} transform="rotate(-90 36 36)" className="rul-ring-progress" />
      </svg>
      <div className="rul-ring-value">{Math.round(animatedRul)}</div>
    </div>
  );
}

function AnimatedStat({ icon: Icon, value, label, isCurrency, delay }) {
  const numeric = typeof value === "number" ? value : null;
  const animated = useAnimatedNumber(numeric ?? 0, 800);
  return (
    <div className="stat-card reveal" style={{ transitionDelay: `${delay}s` }}>
      <div className="stat-icon"><Icon size={16} /></div>
      <div className="stat-value">{numeric !== null ? (isCurrency ? formatINR(animated) : Math.round(animated)) : value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MAIN APP
// ---------------------------------------------------------------------------
export default function App() {
  const [booted, setBooted] = useState(false);
  const [preset, setPreset] = useState("hatchback");
  const [inputs, setInputs] = useState(PRESETS.hatchback);
  const [scanning, setScanning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [apiStatus, setApiStatus] = useState("checking"); // checking | online | offline
  const [liveResult, setLiveResult] = useState(null);
  const [realModelResult, setRealModelResult] = useState(null);
  const [realModelLoading, setRealModelLoading] = useState(false);
  const scanTimeout = useRef(null);

  useEffect(() => { const t = setTimeout(() => setBooted(true), 1500); return () => clearTimeout(t); }, []);

  // Backend health check — retried periodically so the badge reflects reality
  // even if the backend cold-starts after the page has already loaded.
  useEffect(() => {
    let cancelled = false;
    async function ping() {
      try {
        const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(4000) });
        if (!cancelled) setApiStatus(res.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setApiStatus("offline");
      }
    }
    ping();
    const interval = setInterval(ping, 20000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!booted) return;
    setScanning(true);
    clearTimeout(scanTimeout.current);
    scanTimeout.current = setTimeout(() => setScanning(false), 600);
    return () => clearTimeout(scanTimeout.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, booted]);

  const update = (key) => (val) => { setLiveResult(null); setInputs((prev) => ({ ...prev, [key]: val })); };
  const applyPreset = (key) => { setPreset(key); setLiveResult(null); if (PRESETS[key]) setInputs(PRESETS[key]); };

  // Local instant computation — always available, used as the display value
  // unless a live API result has arrived for the current inputs.
  const localSoh = useMemo(() => computeSOH(inputs), [inputs]);
  const localRul = useMemo(() => estimateRUL(inputs), [inputs]);
  const curve = useMemo(() => buildCurve(inputs), [inputs]);

  const soh = liveResult?.soh ?? localSoh;
  const rul = liveResult?.rul_cycles_to_80pct ?? localRul;
  const status = classify(soh);

  const originalValue = inputs.capacityKwh * inputs.originalCostPerKwh;
  const resaleValue = liveResult?.resale_value_inr ?? (originalValue * (0.35 + (soh / 100) * 0.55));
  const secondLife = soh < 80 && soh >= 55
    ? { eligible: true, years: Math.max(2, Math.round(((soh - 50) / 5) * 1.1)) }
    : { eligible: false, years: 0 };

  const runDiagnostic = async () => {
    setAnalyzing(true);
    const minDelay = new Promise((r) => setTimeout(r, 900)); // let the scan animation read clearly
    try {
      const res = await fetch(`${API_URL}/predict/demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputs),
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = await res.json();
        await minDelay;
        setLiveResult(data);
        setApiStatus("online");
      } else {
        await minDelay;
        setApiStatus("offline");
      }
    } catch {
      await minDelay;
      setApiStatus("offline");
    } finally {
      setAnalyzing(false);
    }
  };

  const testRealModel = async () => {
    setRealModelLoading(true);
    setRealModelResult(null);
    try {
      const sampleRes = await fetch(`${API_URL}/battery/sample/B0018?cycle=${20 + Math.floor(Math.random() * 100)}`, { signal: AbortSignal.timeout(5000) });
      const sample = await sampleRes.json();
      const predRes = await fetch(`${API_URL}/predict/telemetry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sample),
        signal: AbortSignal.timeout(5000),
      });
      const pred = await predRes.json();
      setRealModelResult({ sample, pred });
      setApiStatus("online");
    } catch {
      setApiStatus("offline");
      setRealModelResult({ error: true });
    } finally {
      setRealModelLoading(false);
    }
  };

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        :root {
          --bg: #0c0f14; --panel: #151a22; --panel-2: #1c2330; --border: #2b323e;
          --text: #eef2f6; --text-muted: #8894a3;
          --teal: #22d3b8; --teal-glow: rgba(34,211,184,0.55);
          --amber: #f5a833; --amber-glow: rgba(245,168,51,0.55);
          --red: #ef5a72; --red-glow: rgba(239,90,114,0.55);
        }
        * { box-sizing: border-box; }
        .app { position: relative; background: var(--bg); color: var(--text); font-family: 'Space Grotesk', sans-serif; min-height: 100vh; padding: 28px 20px 60px; overflow: hidden; }
        .app::before {
          content: ""; position: fixed; inset: 0;
          background: radial-gradient(circle at 12% 8%, rgba(34,211,184,0.10), transparent 40%),
            radial-gradient(circle at 88% 85%, rgba(245,168,51,0.07), transparent 45%),
            repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0px, rgba(255,255,255,0.015) 1px, transparent 1px, transparent 42px),
            repeating-linear-gradient(90deg, rgba(255,255,255,0.015) 0px, rgba(255,255,255,0.015) 1px, transparent 1px, transparent 42px);
          pointer-events: none; z-index: 0;
        }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .particle-field { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
        .particle { position: absolute; bottom: -10px; border-radius: 50%; background: radial-gradient(circle, rgba(34,211,184,0.85), rgba(34,211,184,0)); animation-name: floatUp; animation-timing-function: linear; animation-iteration-count: infinite; opacity: 0; }
        @keyframes floatUp { 0% { transform: translate(0,0); opacity:0; } 8%{opacity:0.7;} 92%{opacity:0.5;} 100%{ transform: translate(var(--drift), -110vh); opacity:0; } }
        .boot-overlay { position: fixed; inset: 0; z-index: 50; background: var(--bg); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; transition: opacity .6s ease, visibility .6s ease; }
        .boot-overlay.hidden { opacity:0; visibility:hidden; pointer-events:none; }
        .boot-logo { width:64px; height:64px; border-radius:16px; background:var(--panel-2); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; color:var(--teal); animation: pulseLogo 1.4s ease-in-out infinite; }
        @keyframes pulseLogo { 0%,100%{box-shadow:0 0 0px rgba(34,211,184,0.4);} 50%{box-shadow:0 0 32px rgba(34,211,184,0.55);} }
        .boot-text { font-family:'IBM Plex Mono',monospace; font-size:12.5px; letter-spacing:0.14em; color:var(--text-muted); text-transform:uppercase; }
        .boot-bar-track { width:220px; height:3px; background:var(--panel-2); border-radius:4px; overflow:hidden; }
        .boot-bar-fill { height:100%; background:var(--teal); animation: bootFill 1.4s ease forwards; }
        @keyframes bootFill { from{width:0%;} to{width:100%;} }
        .reveal { opacity:0; transform: translateY(14px); transition: opacity .6s ease, transform .6s ease; }
        .booted .reveal { opacity:1; transform: translateY(0); }
        .header { position:relative; z-index:1; max-width:1180px; margin:0 auto 20px; display:flex; align-items:flex-start; justify-content:space-between; gap:20px; flex-wrap:wrap; border-bottom:1px solid var(--border); padding-bottom:20px; }
        .eyebrow { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:0.18em; color:var(--teal); text-transform:uppercase; margin-bottom:8px; display:flex; align-items:center; gap:8px; }
        .live-dot { width:7px; height:7px; border-radius:50%; background:var(--teal); animation: livePulse 1.8s ease-out infinite; }
        @keyframes livePulse { 0%{box-shadow:0 0 0 0 rgba(34,211,184,0.55);} 70%{box-shadow:0 0 0 8px rgba(34,211,184,0);} 100%{box-shadow:0 0 0 0 rgba(34,211,184,0);} }
        .title { font-size:26px; font-weight:700; letter-spacing:-0.01em; margin:0; }
        .subtitle { color:var(--text-muted); font-size:13.5px; margin-top:6px; max-width:460px; line-height:1.5; }
        .badge-row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
        .chip { font-family:'IBM Plex Mono',monospace; font-size:10.5px; letter-spacing:0.04em; color:var(--text-muted); border:1px solid var(--border); border-radius:100px; padding:6px 12px; display:flex; align-items:center; gap:6px; transition: border-color .3s, color .3s; }
        .chip:hover { border-color:var(--teal); color:var(--teal); }
        .api-badge { font-family:'IBM Plex Mono',monospace; font-size:10.5px; border-radius:100px; padding:6px 12px; display:flex; align-items:center; gap:6px; border:1px solid; }
        .api-badge.online { color: var(--teal); border-color: var(--teal); background: rgba(34,211,184,0.08); }
        .api-badge.offline { color: var(--text-muted); border-color: var(--border); background: rgba(255,255,255,0.02); }
        .api-badge.checking { color: var(--amber); border-color: var(--amber); background: rgba(245,168,51,0.08); }
        .top-strip-note { max-width:1180px; margin: 0 auto 20px; font-size:11.5px; color:var(--text-muted); position:relative; z-index:1; }
        .grid { position:relative; z-index:1; max-width:1180px; margin:0 auto; display:grid; grid-template-columns:340px 1fr; gap:20px; }
        @media (max-width:900px){ .grid{grid-template-columns:1fr;} }
        .panel { background:var(--panel); border:1px solid var(--border); border-radius:16px; padding:22px; position:relative; transition: border-color .3s, transform .3s; }
        .panel-title { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; letter-spacing:0.02em; margin-bottom:18px; color:var(--text); }
        .panel-title svg { color:var(--teal); }
        select.preset-select { width:100%; background:var(--panel-2); border:1px solid var(--border); color:var(--text); font-family:'Space Grotesk',sans-serif; font-size:13px; padding:10px 12px; border-radius:10px; margin-bottom:20px; cursor:pointer; transition:border-color .25s; }
        select.preset-select:hover { border-color:var(--teal); }
        .field { margin-bottom:18px; }
        .field-head { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px; }
        .field label { font-size:12.5px; color:var(--text-muted); }
        .field-value { font-family:'IBM Plex Mono',monospace; font-size:13px; color:var(--teal); }
        .field-unit { color:var(--text-muted); margin-left:2px; font-size:11px; }
        .field-hint { font-size:10.5px; color:#5c6674; margin-top:4px; }
        .slider-track-wrap { position:relative; height:4px; border-radius:4px; background:var(--panel-2); }
        .slider-fill { position:absolute; left:0; top:0; height:100%; border-radius:4px; background:linear-gradient(90deg,var(--teal),#5eead4); transition:width .15s ease; }
        input[type="range"] { -webkit-appearance:none; position:relative; width:100%; height:4px; background:transparent; outline:none; margin:0; }
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance:none; width:15px; height:15px; border-radius:50%; background:var(--teal); cursor:pointer; border:3px solid var(--bg); box-shadow:0 0 0 1px var(--teal),0 0 10px rgba(34,211,184,0.7); margin-top:-5.5px; position:relative; z-index:2; }
        .money-fields { display:flex; gap:10px; }
        .money-fields .field { flex:1; }
        input.num-input { width:100%; background:var(--panel-2); border:1px solid var(--border); color:var(--text); font-family:'IBM Plex Mono',monospace; font-size:13px; padding:9px 10px; border-radius:8px; transition:border-color .25s; }
        input.num-input:focus { border-color:var(--teal); outline:none; }
        .run-btn { width:100%; margin-top:4px; padding:12px 16px; border-radius:10px; border:none; background:linear-gradient(135deg,var(--teal),#17b8a0); color:#08110f; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:13.5px; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; box-shadow:0 8px 22px rgba(34,211,184,0.28); transition:transform .15s, box-shadow .15s; }
        .run-btn:hover { transform:translateY(-2px); box-shadow:0 12px 28px rgba(34,211,184,0.4); }
        .run-btn:disabled { opacity:0.7; cursor:progress; }
        .run-btn svg.spin { animation: spin 0.9s linear infinite; }
        @keyframes spin { from{transform:rotate(0deg);} to{transform:rotate(360deg);} }
        .secondary-btn { width:100%; margin-top:10px; padding:10px 14px; border-radius:10px; border:1px dashed var(--border); background:transparent; color:var(--text-muted); font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:12.5px; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; transition:border-color .2s, color .2s; }
        .secondary-btn:hover { border-color:var(--teal); color:var(--teal); }
        .real-model-result { margin-top:12px; padding:12px 14px; border-radius:10px; background:var(--panel-2); border:1px solid var(--border); font-size:11.5px; color:var(--text-muted); line-height:1.6; }
        .real-model-result b { color:var(--text); }
        .right-col { display:flex; flex-direction:column; gap:20px; }
        .top-row { display:grid; grid-template-columns:200px 1fr; gap:20px; }
        @media (max-width:640px){ .top-row{grid-template-columns:1fr;} }
        .gauge-wrap { position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; }
        .gauge-glow-ring { position:absolute; width:130px; height:130px; border-radius:50%; background:radial-gradient(circle,var(--glow),transparent 70%); filter:blur(6px); opacity:.55; animation: breathe 3.2s ease-in-out infinite; z-index:0; }
        @keyframes breathe { 0%,100%{transform:scale(.92);opacity:.4;} 50%{transform:scale(1.05);opacity:.65;} }
        .gauge-svg { width:90px; height:auto; position:relative; z-index:1; }
        .gauge-readout { text-align:center; position:relative; z-index:1; }
        .gauge-soh { font-size:30px; font-weight:700; line-height:1; font-variant-numeric:tabular-nums; }
        .gauge-pct { font-size:15px; opacity:.7; }
        .gauge-label { font-size:10.5px; color:var(--text-muted); letter-spacing:0.05em; text-transform:uppercase; margin-top:4px; }
        .status-pill { margin-top:10px; display:inline-flex; align-items:center; gap:5px; border:1px solid; border-radius:100px; padding:4px 11px; font-size:11px; font-weight:600; transition:border-color .4s, color .4s; }
        .wave { animation: waveMove 3.6s linear infinite; }
        .wave-2 { animation-duration:5s; animation-direction:reverse; }
        @keyframes waveMove { from{transform:translateX(-15px);} to{transform:translateX(-90px);} }
        .scan-sweep { animation: sweepDown .6s ease; }
        @keyframes sweepDown { from{transform:translateY(-176px);opacity:.9;} to{transform:translateY(176px);opacity:0;} }
        .stat-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
        @media (max-width:640px){ .stat-grid{grid-template-columns:1fr 1fr;} }
        .stat-card { background:var(--panel-2); border:1px solid var(--border); border-radius:12px; padding:14px 16px; transition:transform .25s, border-color .25s, box-shadow .25s; }
        .stat-card:hover { transform:translateY(-4px); border-color:var(--teal); box-shadow:0 10px 24px rgba(0,0,0,0.35); }
        .stat-icon { color:var(--teal); margin-bottom:8px; }
        .stat-value { font-family:'IBM Plex Mono',monospace; font-size:19px; font-weight:600; font-variant-numeric:tabular-nums; }
        .stat-label { font-size:11px; color:var(--text-muted); margin-top:4px; }
        .rul-ring-wrap { position:relative; width:72px; height:72px; margin:0 auto; }
        .rul-ring-svg { width:100%; height:100%; }
        .rul-ring-progress { transition: stroke-dashoffset .9s cubic-bezier(.22,1,.36,1); filter: drop-shadow(0 0 4px rgba(34,211,184,0.7)); }
        .rul-ring-value { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-family:'IBM Plex Mono',monospace; font-size:13px; font-weight:600; color:var(--teal); }
        .chart-panel .panel-title { margin-bottom:6px; }
        .chart-caption { font-size:11.5px; color:var(--text-muted); margin-bottom:14px; }
        .analyzing-overlay { position:absolute; inset:0; z-index:5; border-radius:16px; background:rgba(12,15,20,0.82); backdrop-filter:blur(2px); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; animation: fadeIn .25s ease; }
        @keyframes fadeIn { from{opacity:0;} to{opacity:1;} }
        .analyzing-scanline { position:absolute; left:0; right:0; height:2px; background:linear-gradient(90deg,transparent,var(--teal),transparent); box-shadow:0 0 14px var(--teal); animation: scanTravel 1.1s ease-in-out infinite; }
        @keyframes scanTravel { 0%{top:6%;} 50%{top:92%;} 100%{top:6%;} }
        .analyzing-text { font-family:'IBM Plex Mono',monospace; font-size:11.5px; letter-spacing:0.12em; color:var(--teal); text-transform:uppercase; }
        .cert { background:linear-gradient(160deg,var(--panel) 0%,var(--panel-2) 100%); border:1px solid var(--border); border-radius:16px; padding:24px; position:relative; overflow:hidden; }
        .cert::before { content:""; position:absolute; top:-60px; right:-60px; width:200px; height:200px; border-radius:50%; background:radial-gradient(circle,rgba(34,211,184,0.12),transparent 70%); }
        .cert::after { content:""; position:absolute; top:0; left:-60%; width:40%; height:100%; background:linear-gradient(120deg,transparent,rgba(255,255,255,0.06),transparent); animation: shine 5s ease-in-out infinite; }
        @keyframes shine { 0%{left:-60%;} 40%{left:130%;} 100%{left:130%;} }
        .cert-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; flex-wrap:wrap; gap:10px; }
        .cert-eyebrow { font-family:'IBM Plex Mono',monospace; font-size:10.5px; letter-spacing:0.14em; color:var(--text-muted); text-transform:uppercase; }
        .cert-title { font-size:18px; font-weight:700; margin-top:4px; }
        .seal { width:54px; height:54px; border-radius:50%; border:1.5px dashed var(--teal); display:flex; align-items:center; justify-content:center; color:var(--teal); flex-shrink:0; animation: sealSpin 12s linear infinite; }
        @keyframes sealSpin { from{transform:rotate(0deg);} to{transform:rotate(360deg);} }
        .cert-body { display:grid; grid-template-columns:1fr 1fr; gap:16px; position:relative; z-index:1; }
        @media (max-width:640px){ .cert-body{grid-template-columns:1fr;} }
        .cert-row { display:flex; justify-content:space-between; font-size:12.5px; padding:9px 0; border-bottom:1px solid var(--border); }
        .cert-row span:first-child { color:var(--text-muted); }
        .cert-row span:last-child { font-family:'IBM Plex Mono',monospace; }
        .reco { margin-top:18px; border-radius:12px; padding:14px 16px; font-size:12.5px; display:flex; gap:10px; align-items:flex-start; line-height:1.5; position:relative; z-index:1; }
        .footer-note { max-width:1180px; margin:24px auto 0; font-size:11px; color:var(--text-muted); text-align:center; position:relative; z-index:1; }
      `}</style>

      <ParticleField />

      <div className={`boot-overlay ${booted ? "hidden" : ""}`}>
        <div className="boot-logo"><BatteryMedium size={28} /></div>
        <div className="boot-text">Initializing Diagnostic Engine</div>
        <div className="boot-bar-track"><div className="boot-bar-fill" /></div>
      </div>

      <div className={booted ? "booted" : ""}>
        <div className="header reveal" style={{ transitionDelay: "0.05s" }}>
          <div>
            <div className="eyebrow"><span className="live-dot" />Battery Diagnostic Prototype — SIH Software Track</div>
            <h1 className="title">EV Battery Health &amp; Second-Life Predictor</h1>
            <p className="subtitle">
              Predicts State of Health and Remaining Useful Life from usage data, to give
              used-EV buyers a trustworthy battery certificate and flag batteries fit for
              solar-storage second life.
            </p>
          </div>
          <div className="badge-row">
            <span className="chip mono"><BatteryMedium size={12} /> SOH + RUL model</span>
            <span className="chip mono"><Sun size={12} /> Second-life routing</span>
            <span className={`api-badge mono ${apiStatus}`}>
              {apiStatus === "online" ? <Wifi size={12} /> : <WifiOff size={12} />}
              {apiStatus === "checking" ? "Connecting to API…" : apiStatus === "online" ? "Backend: Live" : "Backend: Offline preview"}
            </span>
          </div>
        </div>

        <div className="grid">
          <div className="panel reveal" style={{ transitionDelay: "0.15s" }}>
            <div className="panel-title"><SlidersHorizontal size={15} /> Battery Usage Profile</div>
            <select className="preset-select mono" value={preset} onChange={(e) => applyPreset(e.target.value)}>
              <option value="custom">Custom input</option>
              {Object.entries(PRESETS).filter(([k]) => k !== "custom").map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>

            <SliderField index={0} label="Battery age" unit="months" value={inputs.ageMonths} min={1} max={96} step={1} onChange={(v) => { setPreset("custom"); update("ageMonths")(v); }} />
            <SliderField index={1} label="Total charge cycles" unit="cycles" value={inputs.cycles} min={20} max={2500} step={10} onChange={(v) => { setPreset("custom"); update("cycles")(v); }} />
            <SliderField index={2} label="Avg. depth of discharge" unit="%" value={inputs.avgDoD} min={20} max={100} step={1} onChange={(v) => { setPreset("custom"); update("avgDoD")(v); }} hint="Higher DoD per cycle accelerates fade" />
            <SliderField index={3} label="Avg. charge rate" unit="C" value={inputs.cRate} min={0.3} max={3} step={0.1} onChange={(v) => { setPreset("custom"); update("cRate")(v); }} hint="Fast charging above 1C adds stress" />
            <SliderField index={4} label="Avg. operating temperature" unit="°C" value={inputs.avgTemp} min={10} max={48} step={1} onChange={(v) => { setPreset("custom"); update("avgTemp")(v); }} hint="Heat is the biggest driver of calendar aging" />

            <div className="money-fields reveal" style={{ transitionDelay: "0.7s" }}>
              <div className="field">
                <div className="field-head"><label>Pack capacity</label></div>
                <input className="num-input" type="number" value={inputs.capacityKwh} onChange={(e) => { setPreset("custom"); update("capacityKwh")(Number(e.target.value)); }} />
                <div className="field-hint">kWh, when new</div>
              </div>
              <div className="field">
                <div className="field-head"><label>Cost per kWh</label></div>
                <input className="num-input" type="number" value={inputs.originalCostPerKwh} onChange={(e) => { setPreset("custom"); update("originalCostPerKwh")(Number(e.target.value)); }} />
                <div className="field-hint">₹, original pack cost</div>
              </div>
            </div>

            <button className="run-btn reveal" style={{ transitionDelay: "0.78s" }} onClick={runDiagnostic} disabled={analyzing}>
              {analyzing ? <Zap size={16} className="spin" /> : <ScanLine size={16} />}
              {analyzing ? "Analyzing Telemetry..." : "Run Live Diagnostic"}
            </button>

            <button className="secondary-btn reveal" style={{ transitionDelay: "0.85s" }} onClick={testRealModel} disabled={realModelLoading}>
              <FlaskConical size={14} />
              {realModelLoading ? "Querying trained model…" : "Test real ML model on NASA sample"}
            </button>

            {realModelResult && !realModelResult.error && (
              <div className="real-model-result">
                Real NASA cycle <b>#{realModelResult.sample.cycle_number}</b> (battery B0018) — measured SOH was <b>{realModelResult.sample.soh.toFixed(1)}%</b>.
                <br />Trained RandomForest predicted: <b>{realModelResult.pred.soh}%</b> ({realModelResult.pred.classification.label}).
              </div>
            )}
            {realModelResult && realModelResult.error && (
              <div className="real-model-result">Couldn't reach the backend — deploy the Flask API and set VITE_API_URL to try this live.</div>
            )}
          </div>

          <div className="right-col">
            <div className="panel top-row reveal" style={{ transitionDelay: "0.25s" }}>
              {analyzing && (
                <div className="analyzing-overlay">
                  <div className="analyzing-scanline" />
                  <ScanLine size={22} color="var(--teal)" />
                  <div className="analyzing-text">Analyzing Battery Telemetry…</div>
                </div>
              )}
              <LiquidBatteryGauge soh={soh} status={status} scanning={scanning} />
              <div>
                <div className="panel-title" style={{ marginBottom: 14 }}><Gauge size={15} /> Diagnostic Summary</div>
                <div className="stat-grid">
                  <div className="stat-card">
                    <div className="stat-icon"><Gauge size={16} /></div>
                    <RulRing rul={rul} />
                    <div className="stat-label" style={{ marginTop: 6 }}>Cycles to 80% SOH (RUL)</div>
                  </div>
                  <AnimatedStat icon={IndianRupee} value={resaleValue} isCurrency label="Estimated resale value" delay={0.05} />
                  <div className="stat-card">
                    <div className="stat-icon">{secondLife.eligible ? <Sun size={16} /> : <AlertTriangle size={16} />}</div>
                    <div className="stat-value">{secondLife.eligible ? `~${secondLife.years} yrs` : status.label}</div>
                    <div className="stat-label">{secondLife.eligible ? "Solar second-life span" : status.sub}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="panel chart-panel reveal" style={{ transitionDelay: "0.35s" }}>
              <div className="panel-title"><BatteryMedium size={15} /> Projected Degradation Curve</div>
              <div className="chart-caption">Modeled capacity fade vs. cycle count, extrapolated from current usage stress factors. Dashed line marks the 80% second-life threshold.</div>
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={curve} margin={{ top: 5, right: 16, left: -10, bottom: 0 }}>
                  <defs>
                    <filter id="glowLine" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="3.2" result="blur" />
                      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  </defs>
                  <CartesianGrid stroke="#2b323e" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="cycle" stroke="#5c6674" fontSize={11} tickLine={false} axisLine={{ stroke: "#2b323e" }} />
                  <YAxis domain={[40, 100]} stroke="#5c6674" fontSize={11} tickLine={false} axisLine={{ stroke: "#2b323e" }} width={36} />
                  <Tooltip contentStyle={{ background: "#1c2330", border: "1px solid #2b323e", borderRadius: 10, fontSize: 12, fontFamily: "IBM Plex Mono, monospace" }} labelFormatter={(c) => `Cycle ${c}`} formatter={(v) => [`${v}%`, "SOH"]} />
                  <ReferenceLine y={80} stroke="#f5a833" strokeDasharray="5 4" />
                  <ReferenceLine x={inputs.cycles} stroke="#22d3b8" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="soh" stroke="#22d3b8" strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: "#22d3b8", stroke: "#0c0f14", strokeWidth: 2 }} filter="url(#glowLine)" isAnimationActive animationDuration={900} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="cert reveal" style={{ transitionDelay: "0.45s" }}>
              <div className="cert-head">
                <div><div className="cert-eyebrow">Battery Health Certificate</div><div className="cert-title">Diagnostic Report</div></div>
                <div className="seal"><ShieldCheck size={22} /></div>
              </div>
              <div className="cert-body">
                <div>
                  <div className="cert-row"><span>State of Health</span><span>{soh.toFixed(1)}%</span></div>
                  <div className="cert-row"><span>Remaining useful life</span><span>{Math.round(rul)} cycles</span></div>
                  <div className="cert-row"><span>Classification</span><span>{status.label}</span></div>
                  <div className="cert-row"><span>Cycles logged</span><span>{inputs.cycles}</span></div>
                </div>
                <div>
                  <div className="cert-row"><span>Battery age</span><span>{inputs.ageMonths} mo</span></div>
                  <div className="cert-row"><span>Pack capacity</span><span>{inputs.capacityKwh} kWh</span></div>
                  <div className="cert-row"><span>Est. resale value</span><span>{formatINR(resaleValue)}</span></div>
                  <div className="cert-row"><span>Original value</span><span>{formatINR(originalValue)}</span></div>
                </div>
              </div>
              <div className="reco" style={{
                background: secondLife.eligible ? "rgba(245,168,51,0.1)" : status.label === "Poor" ? "rgba(239,90,114,0.1)" : "rgba(34,211,184,0.1)",
                color: secondLife.eligible ? "var(--amber)" : status.label === "Poor" ? "var(--red)" : "var(--teal)",
              }}>
                {secondLife.eligible ? <Sun size={16} style={{ flexShrink: 0, marginTop: 1 }} /> : status.label === "Poor" ? <Recycle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> : <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} />}
                <span>
                  {secondLife.eligible
                    ? `Below EV-grade threshold but structurally sound — recommended for routing to stationary solar storage, with an estimated ${secondLife.years}-year second-life span at reduced load.`
                    : status.label === "Poor"
                    ? "Capacity has fallen below safe reuse thresholds. Recommended for certified recycling rather than resale or second-life deployment."
                    : "Battery is within healthy resale range. Certificate is suitable for listing on a used-EV marketplace to build buyer trust."}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="footer-note">SOH/RUL sliders run a physics-informed estimate; "Test real ML model" calls the trained RandomForest on genuine NASA cycling data.</div>
      </div>
    </div>
  );
}
