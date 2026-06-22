/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  Settings, 
  Database, 
  AlertCircle, 
  RefreshCw,
  Volume2,
  VolumeX,
  X,
  ArrowLeft,
  ArrowRight,
  Calendar,
  MapPin,
  ExternalLink,
  Lock,
  BookOpen,
  FileText,
  Radar,
  Compass,
  Globe,
  Info
} from 'lucide-react';
import Papa from 'papaparse';
import { jsPDF } from "jspdf";

// Media parser utility mapping Drive files & YouTube videos
interface MediaSource {
  type: 'image' | 'youtube' | 'generic_image' | 'unsupported';
  src: string;
}

const parseMediaColumn = (val: string): MediaSource => {
  const clean = String(val || '').trim();
  if (!clean) return { type: 'unsupported', src: '' };

  // Match YouTube URLs
  const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const ytMatch = clean.match(ytRegex);
  if (ytMatch && ytMatch[1]) {
    return {
      type: 'youtube',
      src: `https://www.youtube-nocookie.com/embed/${ytMatch[1]}`
    };
  }

  // Match Google Drive links
  const driveIdRegexes = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/
  ];

  for (const regex of driveIdRegexes) {
    const match = clean.match(regex);
    if (match && match[1]) {
      return {
        type: 'image',
        src: `/api/asset-proxy?id=${match[1]}`
      };
    }
  }

  // Generic direct web images
  if (clean.match(/\.(jpeg|jpg|gif|png|webp|svg)/i) || clean.startsWith('http')) {
    return {
      type: 'generic_image',
      src: clean
    };
  }

  return { type: 'unsupported', src: '' };
};

// Date helper to parse multiple Google Sheets date formats 
const parseSheetDate = (val: string): Date | null => {
  if (!val) return null;
  const clean = String(val).trim();
  
  const parsed = Date.parse(clean);
  if (!isNaN(parsed)) {
    return new Date(parsed);
  }
  
  const monthMap: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };
  const parts = clean.split(/[-/\s]+/);
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const monthStr = parts[1].toLowerCase().substring(0, 3);
    let year = parseInt(parts[2], 10);
    
    if (year < 100) {
      year += 2000;
    }
    if (monthMap[monthStr] !== undefined && !isNaN(day) && !isNaN(year)) {
      return new Date(year, monthMap[monthStr], day);
    }
  }
  return null;
};

// Auto-mask date formatting tool to assist DD/MM/YYYY typed input
const formatToDDMMYYYY = (val: string, previousVal: string): string => {
  if (val.length < previousVal.length) {
    return val; // Allow deletion cleanly
  }
  
  const digits = val.replace(/\D/g, '');
  let formatted = '';
  
  if (digits.length <= 2) {
    formatted = digits;
  } else if (digits.length <= 4) {
    formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`;
  } else {
    formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
  }
  
  return formatted;
};

// Convert custom typed DD/MM/YYYY date to system compatible YYYY-MM-DD
const parseInputDateToIso = (val: string): string => {
  const parts = val.split('/');
  if (parts.length === 3) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    if (!isNaN(d) && !isNaN(m) && !isNaN(y) && m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1000) {
      const year = String(y).padStart(4, '0');
      const month = String(m).padStart(2, '0');
      const day = String(d).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }
  return '';
};

const isRawDateComplete = (val: string): boolean => {
  const digits = val.replace(/\D/g, '');
  return digits.length === 8;
};

const isRawDateValid = (val: string): boolean => {
  if (!val) return true;
  const parts = val.split('/');
  if (parts.length !== 3) return false;
  const d = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const y = parseInt(parts[2], 10);
  if (isNaN(d) || isNaN(m) || isNaN(y)) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  if (y < 2016 || y > 2100) return false; // sheets data bounds
  const dateObj = new Date(y, m - 1, d);
  const earliestDate = new Date(2016, 7, 9); // 9-Aug-2016
  if (dateObj.getTime() < earliestDate.getTime()) return false;
  return dateObj.getFullYear() === y && dateObj.getMonth() === m - 1 && dateObj.getDate() === d;
};

// Earth calendar dates to AGT Stardate conversion helper
// Format: YYYY.DD.MM where YYYY = Earth year + 1716
const toAgtStardate = (date: Date | null): string => {
  if (!date) return '';
  const y = date.getFullYear() + 1716;
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}.${d}.${m}`;
};

// Domain name extractor for URLs inside References view
const getDisplayUrlLabel = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace('www.', '');
  } catch (e) {
    return 'Galactic Database Link';
  }
};

// Check if credit string has HTML tags (especially <a> anchors)
const isHtmlString = (str: string): boolean => {
  if (!str) return false;
  return /<[a-z][\s\S]*>/i.test(str);
};

// Image loader with custom loading spinner and reset
interface ImageLoaderProps {
  src: string;
  alt: string;
}

const ImageLoader = ({ src, alt }: ImageLoaderProps) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setError(false);
  }, [src]);

  return (
    <div className="relative w-full flex justify-center items-center min-h-[150px]">
      {!loaded && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/20 rounded-xl py-8 z-10">
          <img 
            src="/AGTicon.png" 
            alt="Loading" 
            className="w-10 h-10 object-contain animate-spin"
            referrerPolicy="no-referrer"
          />
          <span className="text-[10px] uppercase font-mono tracking-widest text-agt-orange/60">
            Fetching Image Archive...
          </span>
        </div>
      )}
      {!error ? (
        <img
          src={src}
          alt={alt}
          className={`w-full max-h-[380px] object-contain rounded-xl mx-auto transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0 absolute pointer-events-none'
          }`}
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
      ) : (
        <div className="text-center py-4 text-xs text-red-500 font-mono">
          [Image archive download error]
        </div>
      )}
    </div>
  );
};

// Color coding styles for Event Type tags
const getEventTypeStyle = (type: string): string => {
  const t = String(type || '').trim().toLowerCase();
  
  const PRESET_EVENT_TYPES: Record<string, string> = {
    'expansion': 'bg-blue-500/15 border-blue-500/40 text-blue-300',
    'conflict': 'bg-red-500/15 border-red-500/40 text-red-300',
    'discovery': 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
    'diplomacy': 'bg-violet-500/15 border-violet-500/40 text-violet-300',
    'technology': 'bg-amber-500/15 border-amber-500/40 text-amber-300',
    'colony': 'bg-teal-500/15 border-teal-500/40 text-teal-300',
    'migration': 'bg-pink-500/15 border-pink-500/40 text-pink-300',
    'political': 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300',
    'community event': 'bg-amber-600/15 border-amber-500/45 text-amber-300',
  };

  if (PRESET_EVENT_TYPES[t]) return PRESET_EVENT_TYPES[t];

  // Dynamic color selection by hashing type labels to scale support
  let hash = 0;
  for (let i = 0; i < t.length; i++) {
    hash = t.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    'bg-sky-500/15 border-sky-500/40 text-sky-300',
    'bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-300',
    'bg-orange-500/15 border-orange-500/40 text-orange-300',
    'bg-lime-500/15 border-lime-500/40 text-lime-300',
    'bg-purple-500/15 border-purple-500/40 text-purple-300',
    'bg-cyan-500/15 border-cyan-500/40 text-cyan-300',
  ];
  return colors[Math.abs(hash) % colors.length];
};

// Color coding styles for Significance tags with importance ranks
const SignificanceRanks: Record<string, number> = {
  'era': 6,
  'epic': 5,
  'major': 4,
  'minor': 3,
  'event detail': 2,
  'detail event': 2, // fallback
  'detail': 2, // fallback
  'low': 1,
  'trivial': 1, // fallback
  'insignificant': 0
};

const getSignificanceStyle = (sig: string): string => {
  const s = String(sig || '').trim().toLowerCase();
  switch (s) {
    case 'era':
      return 'bg-purple-500/25 border-purple-500/60 text-purple-200 font-extrabold shadow-[0_0_12px_rgba(168,85,247,0.3)] animate-pulse';
    case 'epic':
      return 'bg-red-500/20 border-red-500/50 text-red-200 font-bold';
    case 'major':
      return 'bg-amber-500/20 border-amber-500/50 text-amber-200 font-semibold';
    case 'minor':
      return 'bg-cyan-500/15 border-cyan-500/50 text-cyan-200';
    case 'event detail':
    case 'detail event':
    case 'detail':
      return 'bg-blue-500/15 border-blue-500/45 text-blue-200';
    case 'low':
    case 'trivial':
      return 'bg-slate-500/15 border-slate-500/45 text-slate-300';
    case 'insignificant':
    default:
      return 'bg-zinc-500/10 border-zinc-500/30 text-zinc-400';
  }
};

const getRowSecurityLevel = (row: any[]): number => {
  const cellVal = String(row[37] || '').trim();
  if (!cellVal) return 0;
  const val = cellVal.toLowerCase();
  if (val.includes('scc restricted') || val.includes('scc')) return 5;
  if (val.includes('slt restricted') || val.includes('slt')) return 4;
  if (val.includes('top secret') || val.includes('top')) return 3;
  if (val.includes('restricted')) return 2;
  if (val.includes('private')) return 1;
  return 0; // Public = 0
};

const getSecurityLevelInfo = (levelNum: number) => {
  const levels = [
    { label: "Public Record", color: "rgb(42, 255, 0)", hex: "#2AFF00" },
    { label: "Private Record", color: "rgb(0, 244, 255)", hex: "#00F4FF" },
    { label: "Restricted Record", color: "rgb(241, 152, 226)", hex: "#F198E2" },
    { label: "Top Secret", color: "rgb(253, 3, 3)", hex: "#FD0303" },
    { label: "SLT Restricted", color: "rgb(255, 147, 0)", hex: "#FF9300" },
    { label: "SCC Restricted", color: "rgb(50, 135, 240)", hex: "#3287F0" }
  ];
  return levels[levelNum] || levels[0];
};

const parseCoordinates = (coordStr: string) => {
  const clean = coordStr.replace(/[\[\]\(\)\s]/g, '').trim();
  const parts = clean.split(/[:\/-]/);
  if (parts.length >= 3) {
    const x = parseInt(parts[0], 16);
    const y = parseInt(parts[1], 16);
    const z = parseInt(parts[2], 16);
    const s = parts.length >= 4 ? parseInt(parts[3], 16) : 0;
    return {
      x: isNaN(x) ? 2047 : x,
      y: isNaN(y) ? 127 : y,
      z: isNaN(z) ? 2047 : z,
      s: isNaN(s) ? 0 : s,
      valid: !isNaN(x) && !isNaN(y) && !isNaN(z)
    };
  }
  return { x: 2047, y: 127, z: 2047, s: 0, valid: false };
};

const GalaxyMapPopup = ({
  coordinate,
  galaxy,
  onClose
}: {
  coordinate: string;
  galaxy: string;
  onClose: () => void;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const parsed = parseCoordinates(coordinate);
  
  const nx = (parsed.x - 2047) / 2048;
  const ny = (parsed.y - 127) / 128;
  const nz = (parsed.z - 2047) / 2048;
  
  const dx = parsed.x - 2047;
  const dy = parsed.y - 127;
  const dz = parsed.z - 2047;
  const distanceLY = Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz) * 400);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let animationId: number;
    let angle = 0;
    
    const starCount = 150;
    const stars: { x: number; y: number; s: number; alpha: number }[] = [];
    for (let i = 0; i < starCount; i++) {
      stars.push({
        x: Math.random() * 2 - 1,
        y: Math.random() * 2 - 1,
        s: Math.random() * 1.5 + 0.5,
        alpha: Math.random()
      });
    }

    const galaxyParticles: { r: number; theta: number; armOffset: number; size: number; baseColor: string }[] = [];
    const arms = 4;
    const particlesPerArm = 120;
    const colors = [
      'rgba(241, 152, 226, 0.4)',
      'rgba(0, 244, 255, 0.4)',
      'rgba(42, 255, 0, 0.4)',
      'rgba(255, 147, 0, 0.4)',
    ];
    for (let arm = 0; arm < arms; arm++) {
      const baseAngle = (arm * 2 * Math.PI) / arms;
      for (let i = 0; i < particlesPerArm; i++) {
        const ratio = i / particlesPerArm;
        const r = ratio * 0.9 + 0.05;
        const theta = baseAngle + r * 5.5 + (Math.random() - 0.5) * 0.35;
        galaxyParticles.push({
          r,
          theta,
          armOffset: (Math.random() - 0.5) * 0.08,
          size: Math.random() * 1.5 + 0.5,
          baseColor: colors[Math.floor(Math.random() * colors.length)]
        });
      }
    }

    const resizeAndRender = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      
      const width = rect.width;
      const height = rect.height;
      
      const render = () => {
        angle += 0.00525;
        
        ctx.fillStyle = '#050510';
        ctx.fillRect(0, 0, width, height);
        
        const cx = width / 2;
        const cy = height * 0.55;
        const rMax = Math.min(width, height) * 0.42;
        
        const pitch = 28 * Math.PI / 180;
        const cosP = Math.cos(pitch);
        const sinP = Math.sin(pitch);
        
        const project = (x3d: number, y3d: number, z3d: number) => {
          const cosY = Math.cos(angle);
          const sinY = Math.sin(angle);
          const rx = x3d * cosY - z3d * sinY;
          const rz = x3d * sinY + z3d * cosY;
          
          const px = rx;
          const py = y3d * cosP - rz * sinP;
          
          return {
            x: cx + px * rMax,
            y: cy - py * rMax,
            z: rz
          };
        };

        ctx.save();
        stars.forEach(s => {
          const screenX = cx + s.x * rMax * 1.5;
          const screenY = cy + s.y * rMax * 1.5;
          if (screenX >= 0 && screenX <= width && screenY >= 0 && screenY <= height) {
            const opacity = s.alpha * 0.3 + Math.abs(Math.sin(Date.now() / 1500 + s.x * 100)) * 0.5;
            ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
            ctx.fillRect(screenX, screenY, s.s, s.s);
          }
        });
        ctx.restore();

        ctx.strokeStyle = 'rgba(255, 5, 0, 0.12)';
        ctx.lineWidth = 1;
        const gridRings = [0.25, 0.5, 0.75, 1.0];
        gridRings.forEach(ringR => {
          ctx.beginPath();
          for (let step = 0; step <= 80; step++) {
            const rad = (step * 2 * Math.PI) / 80;
            const gx = Math.cos(rad) * ringR;
            const gz = Math.sin(rad) * ringR;
            const pt = project(gx, 0, gz);
            if (step === 0) {
              ctx.moveTo(pt.x, pt.y);
            } else {
              ctx.lineTo(pt.x, pt.y);
            }
          }
          ctx.stroke();
          
          const labelPt = project(ringR, 0, 0);
          ctx.fillStyle = 'rgba(255, 180, 81, 0.45)';
          ctx.font = '8px monospace';
          ctx.fillText(`${Math.round(ringR * 1000000)} LY`, labelPt.x + 3, labelPt.y - 3);
        });

        ctx.strokeStyle = 'rgba(255, 180, 81, 0.15)';
        ctx.beginPath();
        let ptA = project(-1, 0, 0);
        let ptB = project(1, 0, 0);
        ctx.moveTo(ptA.x, ptA.y);
        ctx.lineTo(ptB.x, ptB.y);
        ptA = project(0, 0, -1);
        ptB = project(0, 0, 1);
        ctx.moveTo(ptA.x, ptA.y);
        ctx.lineTo(ptB.x, ptB.y);
        ctx.stroke();

        galaxyParticles.forEach(p => {
          const x3d = Math.cos(p.theta) * p.r + p.armOffset;
          const z3d = Math.sin(p.theta) * p.r + p.armOffset;
          const y3d = (Math.sin(p.theta * 5) * 0.05) * (1 - p.r);
          
          const pt = project(x3d, y3d, z3d);
          
          ctx.fillStyle = p.baseColor;
          ctx.beginPath();
          const coreFactor = (1 - p.r) * 1.5 + 0.5;
          ctx.arc(pt.x, pt.y, p.size * coreFactor, 0, 2 * Math.PI);
          ctx.fill();
        });

        const corePt = project(0, 0, 0);
        const coreGrad = ctx.createRadialGradient(corePt.x, corePt.y, 0, corePt.x, corePt.y, rMax * 0.16);
        coreGrad.addColorStop(0, '#FFFFFF');
        coreGrad.addColorStop(0.2, 'rgba(255, 180, 81, 0.85)');
        coreGrad.addColorStop(0.5, 'rgba(255, 5, 0, 0.35)');
        coreGrad.addColorStop(1, 'rgba(255, 5, 0, 0)');
        
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(corePt.x, corePt.y, rMax * 0.16, 0, 2 * Math.PI);
        ctx.fill();

        const targetPt = project(nx, ny, nz);
        const groundPt = project(nx, 0, nz);

        ctx.strokeStyle = 'rgba(255, 5, 0, 0.6)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(groundPt.x, groundPt.y);
        ctx.lineTo(targetPt.x, targetPt.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(255, 180, 81, 0.8)';
        ctx.beginPath();
        ctx.arc(groundPt.x, groundPt.y, 3, 0, 2 * Math.PI);
        ctx.fill();

        const targetRadius = Math.sqrt(nx * nx + nz * nz);
        ctx.strokeStyle = 'rgba(255, 180, 81, 0.22)';
        ctx.beginPath();
        for (let step = 0; step <= 80; step++) {
          const rad = (step * 2 * Math.PI) / 80;
          const gx = Math.cos(rad) * targetRadius;
          const gz = Math.sin(rad) * targetRadius;
          const pt = project(gx, 0, gz);
          if (step === 0) {
            ctx.moveTo(pt.x, pt.y);
          } else {
            ctx.lineTo(pt.x, pt.y);
          }
        }
        ctx.stroke();

        const pulse = Math.sin(Date.now() / 180) * 0.45 + 0.55;
        
        ctx.strokeStyle = `rgba(255, 5, 0, ${0.4 + pulse * 0.6})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(targetPt.x, targetPt.y, 7 + pulse * 6, 0, 2 * Math.PI);
        ctx.stroke();

        ctx.strokeStyle = `rgba(255, 5, 0, 0.85)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(targetPt.x - 12, targetPt.y);
        ctx.lineTo(targetPt.x + 12, targetPt.y);
        ctx.moveTo(targetPt.x, targetPt.y - 12);
        ctx.lineTo(targetPt.x, targetPt.y + 12);
        ctx.stroke();

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(targetPt.x, targetPt.y, 3.5, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.font = 'bold 9px monospace';
        const tagText = `${parsed.x.toString(16).toUpperCase().padStart(4, '0')}:${parsed.y.toString(16).toUpperCase().padStart(4, '0')}:${parsed.z.toString(16).toUpperCase().padStart(4, '0')}`;
        ctx.fillText(tagText, targetPt.x + 15, targetPt.y - 4);
        
        ctx.fillStyle = 'rgba(255, 180, 81, 0.8)';
        ctx.font = '8px monospace';
        ctx.fillText(`Y: ${parsed.y} (Alt)`, targetPt.x + 15, targetPt.y + 6);

        animationId = requestAnimationFrame(render);
      };
      
      animationId = requestAnimationFrame(render);
    };

    resizeAndRender();
    window.addEventListener('resize', resizeAndRender);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resizeAndRender);
    };
  }, [nx, ny, nz, parsed.x, parsed.y, parsed.z]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div 
        onClick={onClose}
        className="absolute inset-0 bg-black/85 backdrop-blur-sm"
      />

      <div className="relative max-w-xl w-full bg-[#0d0d0d] border border-[#FF0500]/40 rounded-2xl shadow-[0_0_40px_rgba(255,5,0,0.3)] flex flex-col overflow-hidden z-10">
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#FF0500] to-transparent"></div>
        
        <div className="px-5 py-3.5 border-b border-[#FF0500]/20 bg-black/50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Radar className="w-4 h-4 text-[#FF0500] animate-pulse" />
            <span className="text-xs uppercase font-black tracking-[0.2em] text-white font-mono">
              AGT Mini NAVI
            </span>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 bg-red-950/40 hover:bg-red-500 hover:text-white text-[#FF0500] border border-red-500/20 rounded-md transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative h-[280px] sm:h-[350px] bg-gradient-to-b from-black to-red-950/10">
          <canvas 
            ref={canvasRef} 
            className="w-full h-full block"
          />
          <div className="absolute bottom-3 right-3 text-[8px] font-mono select-none px-2 py-0.5 bg-black/75 border border-[#FF0500]/20 text-[#FFB451]/60 rounded uppercase tracking-wider">
            ORBIT: 0.75x
          </div>
          <div className="absolute top-3 left-3 text-[8px] font-mono select-none text-red-500/40 uppercase tracking-wider">
            ADDR: {coordinate}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#FF0500]/20 bg-black/60 text-center font-mono text-[10px] sm:text-xs tracking-wider select-none leading-relaxed text-stone-300">
          PRIMARY GALAXY: <span className="font-bold text-white uppercase">{galaxy || 'Euclid'}</span>
          <span className="mx-2 text-red-500/50">•</span>
          DISTANCE TO CENTER: <span className="font-bold text-[#2AFF00]">{distanceLY.toLocaleString()} LY</span>
        </div>
      </div>
    </div>
  );
};

const SingleTimelineEventDetailModal = ({
  event,
  onClose,
  onOpenMap
}: {
  event: string[];
  onClose: () => void;
  onOpenMap?: (coord: string, gal: string) => void;
}) => {
  const getEventStartDateLocal = (row: string[]): Date | null => {
    const dStr = row[18];
    const mStr = row[19];
    const yStr = row[20];
    if (dStr && mStr && yStr) {
      const day = parseInt(dStr.trim(), 10);
      const month = parseInt(mStr.trim(), 10);
      const year = parseInt(yStr.trim(), 10);
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        return new Date(year, month - 1, day);
      }
    }
    return parseSheetDate(row[0]);
  };

  const getEventEndDateLocal = (row: string[]): Date | null => {
    const dStr = row[21];
    const mStr = row[22];
    const yStr = row[23];
    if (dStr && mStr && yStr) {
      const day = parseInt(dStr.trim(), 10);
      const month = parseInt(mStr.trim(), 10);
      const year = parseInt(yStr.trim(), 10);
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        return new Date(year, month - 1, day);
      }
    }
    if (row[2] && row[2].trim()) {
      return parseSheetDate(row[2]);
    }
    return getEventStartDateLocal(row);
  };

  const toAgtStardateLocal = (d: Date | null): string => {
    if (!d) return '';
    const epoch = new Date(2016, 7, 8); // 8th August 2016 is Stardate 0.0
    const diffTime = d.getTime() - epoch.getTime();
    const diffDays = diffTime / (1000 * 60 * 60 * 24);
    return diffDays.toFixed(2);
  };

  const isEraEvent = useMemo(() => {
    const isEraFlag = String(event[33] || '').trim().toLowerCase() === 'y';
    const isEraSig = String(event[7] || '').trim().toLowerCase() === 'era';
    return isEraFlag || isEraSig;
  }, [event]);

  const activeEventCivTags = useMemo(() => {
    const civStr = String(event[34] || '').trim();
    if (!civStr) return [];
    return civStr.split(/[,;]+/).map(t => t.trim()).filter(Boolean);
  }, [event]);

  const startStardate = useMemo(() => {
    const colB = String(event[1] || '').trim();
    if (colB) return colB;
    return toAgtStardateLocal(getEventStartDateLocal(event));
  }, [event]);

  const endStardate = useMemo(() => {
    const dEnd = getEventEndDateLocal(event);
    const dStart = getEventStartDateLocal(event);
    if (!dEnd) return '';
    if (dStart && dEnd && dStart.getTime() === dEnd.getTime()) {
      return ''; // single day event
    }
    return toAgtStardateLocal(dEnd);
  }, [event]);

  const agtStardateRangeString = useMemo(() => {
    if (!startStardate) return '';
    if (endStardate) {
        return `${startStardate} - ${endStardate}`;
    }
    return startStardate;
  }, [startStardate, endStardate]);

  const locationText = useMemo(() => {
    const system = String(event[8] || '').trim();
    const region = String(event[9] || '').trim();
    const galaxy = String(event[10] || '').trim();

    const parts = [];
    if (system) parts.push(system);
    if (region) parts.push(region);
    if (galaxy) parts.push(galaxy);

    return parts.join(', ');
  }, [event]);

  const activeMediaList = useMemo(() => {
    const mediaSlots = [
      { urlIdx: 24, creditIdx: 25, captionIdx: 26 },
      { urlIdx: 27, creditIdx: 28, captionIdx: 29 },
      { urlIdx: 30, creditIdx: 31, captionIdx: 32 }
    ];

    const results = [];
    for (const slot of mediaSlots) {
      const urlVal = String(event[slot.urlIdx] || '').trim();
      if (urlVal) {
        const parsed = parseMediaColumn(urlVal);
        if (parsed.type !== 'unsupported' && parsed.src) {
          results.push({
            ...parsed,
            credit: String(event[slot.creditIdx] || '').trim(),
            caption: String(event[slot.captionIdx] || '').trim()
          });
        }
      }
    }
    return results;
  }, [event]);

  const referenceUrlsList = useMemo(() => {
    const references: string[] = [];
    for (let i = 11; i <= 16; i++) {
      const val = String(event[i] || '').trim();
      if (val && (val.startsWith('http') || val.startsWith('www.'))) {
        references.push(val);
      }
    }
    return references;
  }, [event]);

  const getDisplayUrlLabel = (rawUrl: string): string => {
    try {
      const parsed = new URL(rawUrl);
      let hostname = parsed.hostname.replace('www.', '');
      if (hostname.length > 25) {
        hostname = hostname.substring(0, 22) + '...';
      }
      return hostname + parsed.pathname.substring(0, 10);
    } catch {
      return 'EXTERNAL ARCHIVE LINK';
    }
  };

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center p-4">
      {/* Dark glass backdrop layout */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/95 backdrop-blur-md"
      />

      {/* Content card popup */}
      <motion.div 
        initial={{ scale: 0.9, y: 30, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.9, y: 30, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 220 }}
        className="relative max-w-3xl w-full max-h-[90vh] bg-[#0c0c0c]/95 border-2 border-agt-orange/30 rounded-2xl shadow-[0_0_50px_rgba(255,180,81,0.15)] flex flex-col z-[110] overflow-hidden"
      >
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-[#FFB451] to-transparent"></div>

        {/* Close Button element */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-red-950/40 hover:bg-red-500 hover:text-white text-[#FF0500] border border-red-500/30 rounded-lg transition-all cursor-pointer z-[120]"
          title="Exit Detail View"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Popup Header */}
        <div className="px-6 py-4 border-b border-agt-orange/15 bg-black/40 flex items-center justify-between text-[10px] tracking-widest font-mono uppercase text-[#FFB451]/50">
          <div className="flex items-center gap-1.5 font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Chronology Archive Node [Timeline Selection]
          </div>
          {/* Security Clearance Badge */}
          <div 
            style={{ 
              color: getSecurityLevelInfo(getRowSecurityLevel(event)).color, 
              borderColor: getSecurityLevelInfo(getRowSecurityLevel(event)).color 
            }}
            className="mr-12 px-2.5 py-1 rounded-lg border text-[10px] font-bold font-mono tracking-wider bg-black/40"
          >
            {getSecurityLevelInfo(getRowSecurityLevel(event)).label}
          </div>
        </div>

        {/* Central text and content element - with scroll capability built-in */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scrollbar">
          
          {/* ERA Event Layout */}
          {isEraEvent ? (
            <div className="space-y-6">
              {/* Title line */}
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold tracking-[0.3em] text-purple-400">Archival Era Transition</span>
                <h3 className="text-3xl md:text-4xl font-light text-purple-200 tracking-tight leading-none uppercase pr-8">
                  {event[3] || 'Untitled Era Event'}
                </h3>
              </div>

              {/* Subtitle Line (Description) */}
              <p className="text-lg text-agt-orange leading-relaxed font-serif border-l-2 border-purple-500/40 pl-4 py-1 whitespace-pre-line">
                {event[4] || 'Era historical metadata body.'}
              </p>

              {/* AGT Stardate Range */}
              {agtStardateRangeString && (
                <div className="flex items-center gap-2 text-xs font-mono text-purple-300">
                  <span className="text-purple-400 font-bold uppercase tracking-wider">Epoch Stardate:</span>
                  <span>{agtStardateRangeString}</span>
                </div>
              )}
            </div>
          ) : (
            /* Standard (Non-Era) Event Layout */
            <div className="space-y-4">
              {/* Title Line */}
              <h3 className="text-2xl md:text-3xl font-semibold text-white tracking-tight leading-snug uppercase pr-8">
                {event[3] || 'Untitled Record Log'}
              </h3>

              {/* AGT Stardate Range */}
              {agtStardateRangeString && (
                <div className="flex items-center gap-2 text-xs font-mono text-agt-orange/65 border-b border-agt-orange/10 pb-2">
                  <span className="text-[#FF0500] font-bold uppercase tracking-wider">AGT Stardate:</span>
                  <span>{agtStardateRangeString}</span>
                </div>
              )}

              {/* Event Location Line (If available) */}
              {locationText && (
                <div 
                  onClick={() => {
                    const coord = event[35] ? String(event[35]).trim() : '';
                    const gal = event[10] ? String(event[10]).trim() : '';
                    if (coord && onOpenMap) {
                      onOpenMap(coord, gal);
                    }
                  }}
                  className={`flex items-center gap-2 text-[10px] uppercase tracking-wider font-sans text-agt-orange/50 ${
                    (event[35] && String(event[35]).trim()) ? 'cursor-pointer hover:text-[#ff3330] hover:scale-[1.01] transition-all group' : ''
                  }`}
                >
                  <MapPin className={`w-3.5 h-3.5 text-[#FFB451]/60 shrink-0 ${
                    (event[35] && String(event[35]).trim()) ? 'group-hover:text-[#FF0500] animate-pulse' : ''
                  }`} />
                  <span>
                    Location: {locationText}
                    {event[35] && String(event[35]).trim() && (
                      <span className="ml-2 text-[8px] tracking-widest text-[#FF0500] bg-[#FF0500]/10 px-1.5 py-0.5 rounded border border-[#FF0500]/20 font-mono">
                        {String(event[35]).trim()}
                      </span>
                    )}
                  </span>
                </div>
              )}

              {/* Event description */}
              <div className="text-sm md:text-base text-agt-orange/90 leading-relaxed pt-2">
                <p className="inline whitespace-pre-line">
                  {event[4] || 'No event description is recorded for this entry.'}
                </p>
                {event[5] && (
                  <span className="whitespace-nowrap italic text-[#FFB451]/60 font-sans">
                    {" "}&mdash; <span className="font-semibold underline decoration-[#FF0500]/30">{event[5]}</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Media Block Placement from Column Y, AB, AE sequentially */}
          {activeMediaList.length > 0 && (
            <div className="space-y-6">
              {activeMediaList.map((media, mIdx) => (
                <div key={mIdx} className="space-y-2 border border-white/5 bg-black/20 rounded-xl p-3">
                  <div className="overflow-hidden rounded-xl border border-agt-orange/20 bg-black/40 shadow-inner flex justify-center items-center relative group">
                    {media.type === 'youtube' ? (
                      <div className="w-full relative">
                        <iframe
                          src={`${media.src}?enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
                          className="w-full aspect-video rounded-xl"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          referrerPolicy="strict-origin-when-cross-origin"
                        />
                        <a 
                          href={media.src.replace('/embed/', '/watch?v=')} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="absolute top-2 right-2 p-1.5 bg-black/80 hover:bg-red-500 hover:text-white text-white rounded-md text-[9px] uppercase font-mono transition-colors flex items-center gap-1 border border-white/10"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Watch Video</span>
                        </a>
                      </div>
                    ) : (
                      <a
                        href={media.src}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full block hover:scale-[1.005] active:scale-[0.995] transition-transform relative cursor-pointer"
                        title="Click to view full screen in a new tab"
                      >
                        <ImageLoader
                          src={media.src}
                          alt={media.caption || `Alliance historical archives render ${mIdx + 1}`}
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between pointer-events-none rounded-b-xl">
                          <span className="text-[10px] text-agt-orange/80 uppercase font-mono tracking-wider flex items-center gap-1">
                            <ExternalLink className="w-3 h-3 text-red-500" />
                            Open Image Full Screen
                          </span>
                        </div>
                      </a>
                    )}
                  </div>
                  
                  {/* Caption and Credits directly below */}
                  {(media.caption || media.credit) && (
                    <div className="px-2 py-1 text-center space-y-1">
                      {media.caption && (
                        <p className="text-xs text-agt-orange/80 font-sans tracking-wide">
                          {media.caption}
                        </p>
                      )}
                      {media.credit && (
                        <p className="text-[10px] text-[#FF0500] italic font-mono uppercase tracking-widest">
                          ARCHIVE CREDIT:{' '}
                          {isHtmlString(media.credit) ? (
                            <span 
                              className="inline [&_a]:underline [&_a]:text-red-500 [&_a]:hover:text-white [&_a]:transition-colors cursor-pointer"
                              dangerouslySetInnerHTML={{ __html: media.credit }}
                            />
                          ) : (
                            media.credit
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* External References link lists */}
          {referenceUrlsList.length > 0 && (
            <div className="pt-4 border-t border-white/5 space-y-3">
              <h4 className="text-[10px] uppercase font-bold tracking-widest text-[#FFB451]/40 flex items-center gap-1">
                <ExternalLink className="w-3 h-3 text-red-500" />
                ARCHIVAL REFERENCES
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] uppercase tracking-wider font-mono">
                {referenceUrlsList.map((url, index) => (
                  <a
                    key={index}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 border border-agt-orange/15 bg-black/30 hover:bg-[#FF0500]/15 hover:border-[#FF0500] hover:text-white transition-all rounded-lg flex items-center justify-between group"
                  >
                    <span className="truncate pr-4">{getDisplayUrlLabel(url)}</span>
                    <ExternalLink className="w-3 h-3 shrink-0 text-red-500 group-hover:text-white" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Civilization Tags Block */}
          {activeEventCivTags.length > 0 && (
            <div className="pt-4 border-t border-white/5 space-y-2">
              <h4 className="text-[10px] uppercase font-bold tracking-widest text-[#FFB451]/40 flex items-center gap-1.5 font-mono">
                <Search className="w-3 h-3 text-red-500" />
                CIVILIZATIONS
              </h4>
              <div className="flex flex-wrap gap-2 pt-1">
                {activeEventCivTags.map((tag, idx) => (
                  <span 
                    key={idx}
                    className="px-2.5 py-1 bg-red-950/30 border border-red-500/20 text-agt-orange/90 rounded-lg text-xs font-mono tracking-wide"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Popup controls footer row */}
        <div className="px-6 py-5 border-t border-agt-orange/15 bg-black/60 flex items-center justify-between min-h-[64px] relative">
          
          {/* Bottom Left Corner: Significance badge */}
          <div className="flex items-center">
            <div className={`px-2.5 py-1 text-[9px] uppercase tracking-[0.15em] rounded-full border ${getSignificanceStyle(event[7] || '')}`}>
              {event[7] || 'Insignificant'}
            </div>
          </div>

          {/* Close button at center/right */}
          <div>
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-[#FF0500]/20 border border-[#FF0500] hover:bg-[#FF0500] hover:text-white transition-colors text-white font-bold text-[10px] uppercase tracking-wider rounded-lg cursor-pointer"
            >
              Close Record
            </button>
          </div>

          {/* Bottom Right Corner: Event type badge */}
          <div className="flex items-center">
            <div className={`px-2.5 py-1 text-[9px] uppercase tracking-[0.15em] rounded-full border ${getEventTypeStyle(event[17] || 'Trivial')}`}>
              {event[17] || 'Log Record'}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

// Helper functions for security, cookies, and decrypter
const setCookie = (name: string, value: string, days = 365) => {
  const d = new Date();
  d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
  const expires = "expires=" + d.toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)};${expires};path=/;SameSite=Lax`;
};

const getCookie = (name: string): string => {
  const cname = name + "=";
  const decodedCookie = decodeURIComponent(document.cookie);
  const ca = decodedCookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') {
      c = c.substring(1);
    }
    if (c.indexOf(cname) === 0) {
      return c.substring(cname.length, c.length);
    }
  }
  return "";
};

const deleteCookie = (name: string) => {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax`;
};

const decodeXOR = (encodedText: string): string => {
  const key = 969; 
  let decoded = ""; 
  for (let i = 0; i < encodedText.length; i++) { 
    let charCode = encodedText.charCodeAt(i); 
    let originalCharCode = charCode ^ key; // XOR again to reverse
    decoded += String.fromCharCode(originalCharCode); 
  } 
  return decoded; 
};

const SIGNIFICANCE_LEVELS = [
  { id: 'era', label: 'Era' },
  { id: 'epic', label: 'Epic' },
  { id: 'major', label: 'Major' },
  { id: 'minor', label: 'Minor' },
  { id: 'event detail', label: 'Event Detail' },
  { id: 'low', label: 'Low' },
  { id: 'insignificant', label: 'Insignificant' }
];

const normalizeRowSignificance = (sig: string): string => {
  const s = String(sig || '').trim().toLowerCase();
  if (s === 'detail event' || s === 'detail') return 'event detail';
  if (s === 'trivial') return 'low';
  return s;
};

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  
  // Security levels and registration
  const [savedTravellerName, setSavedTravellerName] = useState(() => getCookie('agt_traveller_name'));
  const [savedTravellerId, setSavedTravellerId] = useState(() => getCookie('agt_traveller_id'));
  const [savedSecurityLevel, setSavedSecurityLevel] = useState<number>(() => {
    const s = getCookie('agt_security_level');
    return s ? parseInt(s, 10) : 0;
  });

  // Verification UI inputs inside settings
  const [travellerNameInput, setTravellerNameInput] = useState(() => getCookie('agt_traveller_name'));
  const [travellerIdInput, setTravellerIdInput] = useState(() => getCookie('agt_traveller_id'));
  
  const [verifyError, setVerifyError] = useState<React.ReactNode>('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [popupMessage, setPopupMessage] = useState('');
  const [pdfBlockedMessage, setPdfBlockedMessage] = useState('');

  const verifyCredentials = async (inputName: string, inputId: string) => {
    setVerifyError('');
    
    if (!inputName.trim() || !inputId.trim()) {
      setVerifyError('Please enter both Traveller Name and ID.');
      return;
    }
    
    // Alphanumeric format check for traveller ID format: ########-????-####
    const idRegex = /^\d{8}-[A-Za-z0-9]{4}-\d{4}$/;
    if (!idRegex.test(inputId.trim())) {
      setVerifyError('Invalid AGT Traveller ID format. Must be like ########-????-####');
      return;
    }

    try {
      setIsVerifying(true);
      const url = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSOZq3Cl2e0aNqzXdLRe63HuM7PlqGH3HnS_-0x6P_CYnGDJlK5QvI-YjU0lNaOgLyp3uoktS4WIXyK/pub?gid=505079663&single=true&output=tsv";
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("Network response was not OK");
      }
      const tsvText = await res.text();
      // Parse TSV rows:
      const rows = tsvText.split('\n').map(line => line.split('\t').map(cell => cell.trim()));
      
      let matchedRow: string[] | null = null;
      for (const row of rows) {
        if (row[0] && row[0].toLowerCase() === inputName.trim().toLowerCase()) {
          matchedRow = row;
          break;
        }
      }
      
      if (!matchedRow) {
        handleVerificationFailure();
        return;
      }
      
      const encodedId = matchedRow[1] || '';
      const decodedId = decodeXOR(encodedId);
      
      const nameMatches = matchedRow[0].toLowerCase() === inputName.trim().toLowerCase();
      const idMatches = decodedId.trim().toLowerCase() === inputId.trim().toLowerCase();
      
      if (!nameMatches || !idMatches) {
        handleVerificationFailure();
        return;
      }
      
      const secNameStr = matchedRow[2] || 'Public';
      
      const normalized = secNameStr.toLowerCase().trim();
      let secLevelNum = 0;
      if (/^\d+$/.test(normalized)) {
        secLevelNum = parseInt(normalized, 10);
      } else if (normalized.includes('scc')) {
        secLevelNum = 5;
      } else if (normalized.includes('slt')) {
        secLevelNum = 4;
      } else if (normalized.includes('top')) {
        secLevelNum = 3;
      } else if (normalized.includes('restricted')) {
        secLevelNum = 2;
      } else if (normalized.includes('private')) {
        secLevelNum = 1;
      } else {
        const numMatch = normalized.match(/\d+/);
        if (numMatch) {
          secLevelNum = parseInt(numMatch[0], 10);
        }
      }
      secLevelNum = Math.min(Math.max(secLevelNum, 0), 5);
      
      // Save to cookies
      setCookie('agt_traveller_name', matchedRow[0]);
      setCookie('agt_traveller_id', decodedId.trim());
      setCookie('agt_security_level', String(secLevelNum));
      
      const checkName = getCookie('agt_traveller_name');
      const checkId = getCookie('agt_traveller_id');
      const checkLevel = getCookie('agt_security_level');
      
      if (checkName === matchedRow[0] && checkId === decodedId.trim() && checkLevel === String(secLevelNum)) {
        setSavedTravellerName(matchedRow[0]);
        setSavedTravellerId(decodedId.trim());
        setSavedSecurityLevel(secLevelNum);
        
        setPopupMessage("Verification successful, setting saved");
      } else {
        setPopupMessage("Verification successful, setting save error");
      }
      
    } catch (err) {
      console.error(err);
      setPopupMessage("Verification unsuccessful");
      setVerifyError("Network error contacting verification server.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleVerificationFailure = () => {
    setIsVerifying(false);
    setPopupMessage("Verification unsuccessful");
    setVerifyError(
      <span>
        Traveller Name and ID and does not match, Please consult{" "}
        <a 
          href="https://www.nms-agt.com/support/traveller-id" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-[#FF0500] underline font-bold hover:text-[#ff3c39]"
        >
          AGT Support
        </a>
      </span>
    );
  };

  const handleClearCredentials = () => {
    deleteCookie('agt_traveller_name');
    deleteCookie('agt_traveller_id');
    deleteCookie('agt_security_level');

    const checkName = getCookie('agt_traveller_name');
    if (!checkName) {
      setSavedTravellerName('');
      setSavedTravellerId('');
      setSavedSecurityLevel(0);
      setTravellerNameInput('');
      setTravellerIdInput('');
      setVerifyError('');
      setPopupMessage('Clearing successful');
    } else {
      setPopupMessage('Clearing failed');
    }
  };
  const [audioEnabled, setAudioEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('agt_audio_enabled');
    return saved === null ? false : saved === 'true'; // Muted by default
  });
  
  const audioRef = useRef<HTMLAudioElement>(null);

  // Font scale scaling states
  const [fontScale, setFontScale] = useState<string>(() => {
    return localStorage.getItem('agt_font_scale') || '1x';
  });

  // Check if we are in desktop screen widths to apply dynamic scaling
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const checkDesktopWidth = () => setIsDesktop(window.innerWidth >= 768);
    checkDesktopWidth();
    window.addEventListener('resize', checkDesktopWidth);
    return () => window.removeEventListener('resize', checkDesktopWidth);
  }, []);

  // Set html element font-size scaling
  useEffect(() => {
    const scaleValues: Record<string, number> = {
      '1x': 1.0,
      '1.25x': 1.25,
      '1.5x': 1.5,
      '2x': 2.0,
      '2.5x': 2.5,
      '3x': 3.0
    };
    const factor = scaleValues[fontScale] || 1.0;
    if (isDesktop) {
      document.documentElement.style.fontSize = `${factor * 16}px`;
    } else {
      document.documentElement.style.fontSize = ''; // fallback
    }
  }, [fontScale, isDesktop]);

  // Filters inputs
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rawStartDate, setRawStartDate] = useState('');
  const [rawEndDate, setRawEndDate] = useState('');
  const [searchWord, setSearchWord] = useState('');
  const [selectedSignificance, setSelectedSignificance] = useState<string[]>(() => [
    'era',
    'epic',
    'major',
    'minor',
    'event detail'
  ]);
  const [selectedCategories, setSelectedCategories] = useState<string[] | null>(null);
  const [travellerFilter, setTravellerFilter] = useState('');
  const [civFilter, setCivFilter] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const autocompleteRef = useRef<HTMLDivElement>(null);

  // Location filters
  const [filterByLocation, setFilterByLocation] = useState(false);
  const [omitPublicRecords, setOmitPublicRecords] = useState(false);
  const [omitPrivateRecords, setOmitPrivateRecords] = useState(false);
  const [systemFilter, setSystemFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [galaxyFilter, setGalaxyFilter] = useState('');
  const [showSystemAutocomplete, setShowSystemAutocomplete] = useState(false);
  const [showRegionAutocomplete, setShowRegionAutocomplete] = useState(false);
  const [showGalaxyAutocomplete, setShowGalaxyAutocomplete] = useState(false);

  const systemAutocompleteRef = useRef<HTMLDivElement>(null);
  const regionAutocompleteRef = useRef<HTMLDivElement>(null);
  const galaxyAutocompleteRef = useRef<HTMLDivElement>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const startDatePickerRef = useRef<HTMLInputElement>(null);
  const endDatePickerRef = useRef<HTMLInputElement>(null);

  // Major Timeline state managers
  const [showMajorTimeline, setShowMajorTimeline] = useState(false);
  const [selectedTimelineEvent, setSelectedTimelineEvent] = useState<string[] | null>(null);
  const [activeMapCoordinate, setActiveMapCoordinate] = useState<{ coordinate: string; galaxy: string } | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);

  // Sync custom formatted dates
  useEffect(() => {
    const isoStart = parseInputDateToIso(rawStartDate);
    setStartDate(isoStart);
  }, [rawStartDate]);

  useEffect(() => {
    const isoEnd = parseInputDateToIso(rawEndDate);
    setEndDate(isoEnd);
  }, [rawEndDate]);

  // Fetch / parsed raw dataset from published remote Google sheet
  const [data, setData] = useState<string[][]>([]); // Row array containing strings
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Transition controller for spinning logo loader
  const [showExtractAnim, setShowExtractAnim] = useState(false);
  
  // Custom fullscreen story popup controllers
  const [isStoryActive, setIsStoryActive] = useState(false);
  const [currentEventIndex, setCurrentEventIndex] = useState(0);

  // Scroll popup details to top when event index navigates
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [currentEventIndex]);

  // Maximum allowed system date (today) in YYYY-MM-DD
  const todayDateStr = useMemo(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, []);

  // Fetch galactic archives on component mount
  useEffect(() => {
    fetchData();

    // Manual font loading reinforcement from public/NMSFuturaProBook_Kerned.ttf
    const font = new FontFace('CustomFont', 'url(/NMSFuturaProBook_Kerned.ttf)');
    font.load().then((loadedFont) => {
      // @ts-ignore
      document.fonts.add(loadedFont);
      document.documentElement.style.fontFamily = '"CustomFont", "Inter", sans-serif';
    }).catch(err => {
      console.warn('Custom font load failed, falling back to Inter:', err);
    });
  }, []);

  // Background Audio Management
  useEffect(() => {
    const handleFirstUserClick = () => {
      if (audioEnabled && audioRef.current) {
        audioRef.current.volume = 0.35;
        audioRef.current.play().catch(() => {});
      }
      window.removeEventListener('mousedown', handleFirstUserClick);
      window.removeEventListener('keydown', handleFirstUserClick);
      window.removeEventListener('touchstart', handleFirstUserClick);
    };

    window.addEventListener('mousedown', handleFirstUserClick);
    window.addEventListener('keydown', handleFirstUserClick);
    window.addEventListener('touchstart', handleFirstUserClick);

    return () => {
      window.removeEventListener('mousedown', handleFirstUserClick);
      window.removeEventListener('keydown', handleFirstUserClick);
      window.removeEventListener('touchstart', handleFirstUserClick);
    };
  }, [audioEnabled]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = 0.35;
      if (audioEnabled) {
        audioRef.current.play().catch(() => {});
      } else {
        audioRef.current.pause();
      }
    }
    localStorage.setItem('agt_audio_enabled', String(audioEnabled));
  }, [audioEnabled]);

  const handleManualPlay = () => {
    if (audioEnabled && audioRef.current && audioRef.current.paused) {
      audioRef.current.play().catch(() => {});
    }
  };

  useEffect(() => {
    localStorage.setItem('agt_font_scale', fontScale);
  }, [fontScale]);

  // PapaParse data loader from the specified Alliance sheets records:
  const fetchData = async () => {
    setLoading(true);
    setError(null);

    const sheetUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSF6SX-UXZi-6lC6KEXSuVoPmZ-SZA_Afcv1Q-rulbM_sODlv9sAciF7EyxXEtZ-YNTQB_Ow1yo51I2/pub?gid=0&single=true&output=csv';

    try {
      const response = await fetch(sheetUrl);
      if (!response.ok) {
        throw new Error('Could not establish contact with Galactic Core Records database.');
      }
      
      const csvText = await response.text();
      
      Papa.parse<string[]>(csvText, {
        header: false,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.data && results.data.length > 1) {
            // results.data[0] describes the column headers. We skip it, keeping actual events.
            const recordRows = results.data.slice(1).filter(row => row && row[0] && row[0].trim() !== '');
            setData(recordRows);
          } else {
            setError('Decoder warning: the retrieved historical database is empty.');
          }
          setLoading(false);
        },
        error: (err: any) => {
          setError(`Data telemetry parser error: ${err.message}`);
          setLoading(false);
        }
      });
    } catch (err: any) {
      setError(err.message || 'Operation failed');
      setLoading(false);
    }
  };

  // Extract dates from columns
  const getEventStartDate = (row: string[]): Date | null => {
    const dStr = row[18];
    const mStr = row[19];
    const yStr = row[20];
    if (dStr && mStr && yStr) {
      const day = parseInt(dStr.trim(), 10);
      const month = parseInt(mStr.trim(), 10);
      const year = parseInt(yStr.trim(), 10);
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        return new Date(year, month - 1, day);
      }
    }
    return parseSheetDate(row[0]);
  };

  const getEventEndDate = (row: string[]): Date | null => {
    const dStr = row[21];
    const mStr = row[22];
    const yStr = row[23];
    if (dStr && mStr && yStr) {
      const day = parseInt(dStr.trim(), 10);
      const month = parseInt(mStr.trim(), 10);
      const year = parseInt(yStr.trim(), 10);
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        return new Date(year, month - 1, day);
      }
    }
    if (row[2] && row[2].trim()) {
      return parseSheetDate(row[2]);
    }
    return getEventStartDate(row);
  };

  const checkEventDateMatches = (row: string[], filterStart: string, filterEnd: string): boolean => {
    const startObj = getEventStartDate(row);
    if (!startObj) return true; // keep on date parse failure to preserve timeline consistency

    if (filterStart) {
      const boundaryStart = new Date(filterStart + "T00:00:00");
      if (startObj.getTime() < boundaryStart.getTime()) {
        return false;
      }
    }
    if (filterEnd) {
      const boundaryEnd = new Date(filterEnd + "T23:59:59");
      if (startObj.getTime() > boundaryEnd.getTime()) {
        return false;
      }
    }
    return true;
  };

  // Dynamically extract and catalog unique category items (Column R - index 17) for dropdown list
  const eventTypeList = useMemo(() => {
    const typesSet = new Set<string>();
    data.forEach(row => {
      if (row[6] && row[6].trim().toUpperCase() === 'Y') {
        const typeStr = String(row[17] || '').trim();
        if (typeStr) typesSet.add(typeStr);
      }
    });
    // Add custom "Community Event" category as well
    typesSet.add("Community Event");
    return Array.from(typesSet).sort();
  }, [data]);

  // Dynamically extract and catalog unique civilization tags (Column AI - index 34)
  const civilizationTagsList = useMemo(() => {
    const tagsSet = new Set<string>();
    data.forEach(row => {
      if (row[6] && row[6].trim().toUpperCase() === 'Y') {
        const civStr = String(row[34] || '').trim();
        if (civStr) {
          const tags = civStr.split(/[,;]+/).map(t => t.trim()).filter(Boolean);
          tags.forEach(tag => tagsSet.add(tag));
        }
      }
    });
    return Array.from(tagsSet).sort();
  }, [data]);

  // Dynamically extract and catalog unique Systems (Column I - index 8)
  const systemsList = useMemo(() => {
    const valuesSet = new Set<string>();
    data.forEach(row => {
      if (row[6] && row[6].trim().toUpperCase() === 'Y') {
        const val = String(row[8] || '').trim();
        if (val) valuesSet.add(val);
      }
    });
    return Array.from(valuesSet).sort();
  }, [data]);

  // Dynamically extract and catalog unique Regions (Column J - index 9)
  const regionsList = useMemo(() => {
    const valuesSet = new Set<string>();
    data.forEach(row => {
      if (row[6] && row[6].trim().toUpperCase() === 'Y') {
        const val = String(row[9] || '').trim();
        if (val) valuesSet.add(val);
      }
    });
    return Array.from(valuesSet).sort();
  }, [data]);

  // Dynamically extract and catalog unique Galaxies (Column K - index 10)
  const galaxiesList = useMemo(() => {
    const valuesSet = new Set<string>();
    data.forEach(row => {
      if (row[6] && row[6].trim().toUpperCase() === 'Y') {
        const val = String(row[10] || '').trim();
        if (val) valuesSet.add(val);
      }
    });
    return Array.from(valuesSet).sort();
  }, [data]);

  // Compute matching suggestions for the autocomplete
  const civSuggestions = useMemo(() => {
    let query = civFilter.trim().toLowerCase();
    if (query === 'agt') {
      query = 'alliance of galactic travellers';
    }
    if (!query || query === 'all') return [];
    return civilizationTagsList.filter(tag => 
      tag.toLowerCase().includes(query) && tag.toLowerCase() !== query
    );
  }, [civilizationTagsList, civFilter]);

  const systemSuggestions = useMemo(() => {
    const query = systemFilter.trim().toLowerCase();
    if (!query) return [];
    return systemsList.filter(val => 
      val.toLowerCase().includes(query) && val.toLowerCase() !== query
    );
  }, [systemsList, systemFilter]);

  const regionSuggestions = useMemo(() => {
    const query = regionFilter.trim().toLowerCase();
    if (!query) return [];
    return regionsList.filter(val => 
      val.toLowerCase().includes(query) && val.toLowerCase() !== query
    );
  }, [regionsList, regionFilter]);

  const galaxySuggestions = useMemo(() => {
    const query = galaxyFilter.trim().toLowerCase();
    if (!query) return [];
    return galaxiesList.filter(val => 
      val.toLowerCase().includes(query) && val.toLowerCase() !== query
    );
  }, [galaxiesList, galaxyFilter]);

  // Close suggestion dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (autocompleteRef.current && !autocompleteRef.current.contains(target)) {
        setShowAutocomplete(false);
      }
      if (systemAutocompleteRef.current && !systemAutocompleteRef.current.contains(target)) {
        setShowSystemAutocomplete(false);
      }
      if (regionAutocompleteRef.current && !regionAutocompleteRef.current.contains(target)) {
        setShowRegionAutocomplete(false);
      }
      if (galaxyAutocompleteRef.current && !galaxyAutocompleteRef.current.contains(target)) {
        setShowGalaxyAutocomplete(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Pre-compiled list of records adhering to active filters and classified omitted count
  const { filteredRecords, classifiedOmittedCount } = useMemo(() => {
    // Only parse rows where Column G (index 6, Use of timeline) equals "Y"
    const timelineRows = data.filter(row => row[6] && row[6].trim().toUpperCase() === 'Y');
    const maxAllowedSecurity = (savedTravellerName && savedTravellerId) ? savedSecurityLevel : 0;

    let omittedCount = 0;
    const filtered = [];

    for (const row of timelineRows) {
      // 1. Date Range checking
      if (!checkEventDateMatches(row, startDate, endDate)) {
        continue;
      }

      // 1.5. Search word matching
      if (searchWord.trim()) {
        const query = searchWord.toLowerCase().trim();
        const matched = row.some(cell => cell != null && String(cell).toLowerCase().includes(query));
        if (!matched) {
          continue;
        }
      }

      // 2. Category selection checking
      const type = String(row[17] || '').trim().toLowerCase();
      const currentActiveCategories = selectedCategories === null ? eventTypeList : selectedCategories;
      const lowerActiveCategories = currentActiveCategories.map(cat => cat.toLowerCase());
      if (!lowerActiveCategories.includes(type)) {
        continue;
      }

      // 3. Significance level checkbox list checking
      const rowSigNormalized = normalizeRowSignificance(row[7]);
      if (!selectedSignificance.includes(rowSigNormalized)) {
        continue;
      }

      // 4. Civilization Tag checking
      let queryCiv = civFilter.trim().toLowerCase();
      if (queryCiv === 'agt') {
        queryCiv = 'alliance of galactic travellers';
      }
      let civMatches = true;
      if (queryCiv && queryCiv !== 'all') {
        const rowCivsStr = String(row[34] || '').trim().toLowerCase();
        if (!rowCivsStr.includes(queryCiv)) {
          civMatches = false;
        }
      }
      if (!civMatches) {
        continue;
      }

      // 5. Named Traveller(s) checking
      const queryTraveller = travellerFilter.trim().toLowerCase();
      let travellerMatches = true;
      if (queryTraveller) {
        const rowTravellerStr = String(row[5] || '').trim().toLowerCase();
        const parts = rowTravellerStr.split(',').map(p => p.trim()).filter(Boolean);
        if (parts.length > 0) {
          const matches = parts.some(part => part.includes(queryTraveller));
          if (!matches) {
            travellerMatches = false;
          }
        } else {
          travellerMatches = false;
        }
      }
      if (!travellerMatches) {
        continue;
      }

      // 6. Location checking if Filter By Location is enabled
      let locationMatches = true;
      if (filterByLocation) {
        if (systemFilter.trim()) {
          const rowSystem = String(row[8] || '').trim().toLowerCase();
          if (!rowSystem.includes(systemFilter.trim().toLowerCase())) {
            locationMatches = false;
          }
        }
        if (regionFilter.trim()) {
          const rowRegion = String(row[9] || '').trim().toLowerCase();
          if (!rowRegion.includes(regionFilter.trim().toLowerCase())) {
            locationMatches = false;
          }
        }
        if (galaxyFilter.trim()) {
          const rowGalaxy = String(row[10] || '').trim().toLowerCase();
          if (!rowGalaxy.includes(galaxyFilter.trim().toLowerCase())) {
            locationMatches = false;
          }
        }
      }
      if (!locationMatches) {
        continue;
      }

      const rowSec = getRowSecurityLevel(row);

      // check if it meets everything but is above security level
      if (rowSec > maxAllowedSecurity) {
        omittedCount++;
        continue;
      }

      // 7. Omit Public / Private check (only applicable if verified)
      if (savedTravellerName && savedTravellerId) {
        if (omitPublicRecords && rowSec === 0) {
          continue;
        }
        if (omitPrivateRecords && rowSec > 0) {
          continue;
        }
      }

      filtered.push(row);
    }

    return {
      filteredRecords: filtered,
      classifiedOmittedCount: omittedCount
    };
  }, [
    data, 
    startDate, 
    endDate, 
    selectedCategories, 
    selectedSignificance, 
    civFilter, 
    travellerFilter, 
    eventTypeList, 
    filterByLocation, 
    systemFilter, 
    regionFilter, 
    galaxyFilter, 
    savedTravellerName, 
    savedTravellerId, 
    savedSecurityLevel, 
    searchWord,
    omitPublicRecords,
    omitPrivateRecords
  ]);

  // Sorted events chronologically (earliest to latest format)
  const sortedEvents = useMemo(() => {
    const events = [...filteredRecords];
    events.sort((a, b) => {
      const dateA = getEventStartDate(a);
      const dateB = getEventStartDate(b);
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateA.getTime() - dateB.getTime();
    });
    return events;
  }, [filteredRecords]);

  // Major Timeline Events: uses all user-configured filters in sortedEvents
  const timelineEvents = sortedEvents;

  // Format a Date into DD-MMM-YYYY format
  const formatDdMmmYyyy = (date: Date): string => {
    const day = String(date.getDate()).padStart(2, '0');
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mmm = months[date.getMonth()];
    const yyyy = date.getFullYear();
    return `${day}-${mmm}-${yyyy}`;
  };

  // Load local images helper for PDF adding
  const loadPdfImage = (src: string): Promise<HTMLImageElement | null> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.warn("Failed to load PDF image asset:", src);
        resolve(null);
      };
      img.src = src;
    });
  };

  const handleGeneratePDF = async () => {
    const cookieName = getCookie('agt_traveller_name');
    const cookieId = getCookie('agt_traveller_id');
    
    if (!cookieName || !cookieId) {
      setPdfBlockedMessage("PDF Report is only available to registered AGT Travellers. Enter your credentials in the setting menu");
      return;
    }

    if (timelineEvents.length === 0) return;
    setPdfExporting(true);

    try {
      // Load logo, lore book, mini icon, sword, and politics images in parallel to optimize
      const [officialLogoImg, loreBookImg, miniLogoImg, swordImg, politicsImg] = await Promise.all([
        loadPdfImage('/AgtOfficialLogo.png'),
        loadPdfImage('/Lore Book-tx.png'),
        loadPdfImage('/AGTicon.png'),
        loadPdfImage('/sword-tx.png'),
        loadPdfImage('/politics-pp-tx.png')
      ]);

      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      });

      const now = new Date();
      const pad = (num: number) => String(num).padStart(2, '0');
      const systemDateTimeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      const filename = `AGT Timeline - ${systemDateTimeStr}.pdf`;

      let periodText = "All";
      if (!startDate && !endDate) {
        periodText = "All";
      } else {
        const startDisp = startDate ? toAgtStardate(startDate) : toAgtStardate(now);
        const endDisp = endDate ? toAgtStardate(endDate) : toAgtStardate(now);
        periodText = `${startDisp} - ${endDisp}`;
      }

      let civDisplayVal = civFilter && civFilter.trim() !== '' && civFilter.toLowerCase() !== 'all' ? civFilter : "All";
      if (civDisplayVal.trim().toLowerCase() === 'agt') {
        civDisplayVal = "Alliance of Galactic Travellers";
      }
      let catDisplay = "All";
      if (selectedCategories !== null && selectedCategories.length !== eventTypeList.length) {
        if (selectedCategories.length === 0) {
          catDisplay = "None";
        } else {
          catDisplay = selectedCategories.join(', ');
        }
      }
      const dateOfReportStr = formatDdMmmYyyy(now);

      // COVER PAGE
      doc.setFillColor(12, 12, 12); // #0c0c0c
      doc.rect(0, 0, 210, 297, "F");

      // 20% from top of page is 59.4 mm
      const logoY = 297 * 0.20;
      if (officialLogoImg) {
        const w = 32;
        const h = 32;
        const x = (210 - w) / 2;
        doc.addImage(officialLogoImg, 'PNG', x, logoY, w, h);
      }

      // Report title text "AGT Timeline Report"
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(22);
      doc.setTextColor(255, 180, 81); // #FFB451 (Gold)
      doc.text("AGT Timeline Report", 105, logoY + 45, { align: "center" });

      // Filter criteria lines (separate horizontally centered lines)
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(226, 85, 48); // #E25530 (Orange)

      let startY = logoY + 60;
      const lineSpacing = 8;

      doc.text(`Timeline Period: ${periodText}`, 105, startY, { align: "center" });
      startY += lineSpacing;
      doc.text(`Civilization: ${civDisplayVal}`, 105, startY, { align: "center" });
      startY += lineSpacing;
      doc.text(`Category Filter: ${catDisplay}`, 105, startY, { align: "center" });
      
      if (filterByLocation) {
        if (systemFilter.trim()) {
          startY += lineSpacing;
          doc.text(`System Filter: ${systemFilter.trim()}`, 105, startY, { align: "center" });
        }
        if (regionFilter.trim()) {
          startY += lineSpacing;
          doc.text(`Region Filter: ${regionFilter.trim()}`, 105, startY, { align: "center" });
        }
        if (galaxyFilter.trim()) {
          startY += lineSpacing;
          doc.text(`Galaxy Filter: ${galaxyFilter.trim()}`, 105, startY, { align: "center" });
        }
      }

      startY += lineSpacing;
      doc.text(`Date of Report: ${dateOfReportStr}`, 105, startY, { align: "center" });

      // Display "Lore Book-tx.png" below these lines
      const loreY = startY + 20;
      if (loreBookImg) {
        const w = 24;
        const h = 24;
        const x = (210 - w) / 2;
        doc.addImage(loreBookImg, 'PNG', x, loreY, w, h);
      }

      // SUBSEQUENT PAGES: VERTICAL TIMELINE OF THE MATCHING EVENTS
      const startNewPage = () => {
        doc.addPage();
        doc.setFillColor(12, 12, 12);
        doc.rect(0, 0, 210, 297, "F");

        // Draw vertical timeline line
        doc.setDrawColor(255, 5, 0); // FF0500
        doc.setLineWidth(0.5);
        doc.line(45, 25, 45, 275);
      };

      startNewPage();
      let currentY = 30;

      for (const event of timelineEvents) {
        const titleText = event[3] || 'Untitled Event';
        const dateText = event[1] || event[0] || 'Unknown Date';
        const category = String(event[17] || '').trim().toLowerCase();
        const sig = String(event[7] || '').trim().toLowerCase();
        const civStr = String(event[34] || '').trim();
        const civTags = civStr.split(/[,;]+/).map(t => t.trim()).filter(Boolean);
        
        const hasTargetCiv = civTags.some(tag => {
          const tLower = tag.toLowerCase();
          return tLower === "alliance of galactic travellers" || tLower.endsWith("travellers foundation");
        });

        // Determine matching colors from screen template
        let fillColor = [12, 12, 12]; // #0c0c0c
        let borderColor = [226, 85, 48]; // #E25530
        let textColor = [255, 180, 81]; // #FFB451

        if (sig === 'era') {
          fillColor = [82, 192, 219]; // #52c0db
          borderColor = [82, 192, 219];
          textColor = [0, 0, 0];
        } else if (sig === 'epic' && hasTargetCiv) {
          fillColor = [255, 180, 81]; // #FFB451
          borderColor = [255, 180, 81];
          textColor = [0, 0, 0];
        } else if (sig === 'major' && hasTargetCiv) {
          fillColor = [226, 85, 48]; // #E25530
          borderColor = [226, 85, 48];
          textColor = [0, 0, 0];
        }

        // Determine custom category icon
        let categoryImg: HTMLImageElement | null = null;
        if (category === 'military') {
          categoryImg = swordImg;
        } else if (category === 'political') {
          categoryImg = politicsImg;
        }
        const hasIcon = !!categoryImg;

        const boxStartX = hasIcon ? 56 : 49;
        const boxWidth = hasIcon ? 134 : 141;
        const textWidth = hasIcon ? 124 : 131;

        doc.setFont("Helvetica", "bold");
        doc.setFontSize(10);
        const lines = doc.splitTextToSize(titleText, textWidth);
        const boxHeight = Math.max(10.5, 6 + (lines.length * 4.5));

        if (currentY + boxHeight > 270) {
          startNewPage();
          currentY = 30;
        }

        // Draw event box inside page starting after the icon if present
        doc.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
        doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
        doc.setLineWidth(0.4);
        doc.roundedRect(boxStartX, currentY, boxWidth, boxHeight, 2, 2, "FD");

        // Print category icon if present, vertically centered outside/before the box
        if (hasIcon && categoryImg) {
          const iconW = 4.5;
          const iconH = 4.5;
          const iconX = 49.5;
          const iconY = currentY + (boxHeight - iconH) / 2;
          doc.addImage(categoryImg, 'PNG', iconX, iconY, iconW, iconH);
        }

        // Print title text in the designated text color
        doc.setTextColor(textColor[0], textColor[1], textColor[2]);
        let textY = currentY + 5;
        const textStartX = boxStartX + 5;
        lines.forEach((line: string) => {
          doc.text(line, textStartX, textY);
          textY += 4.5;
        });

        // Draw event date aligned right on the left of timeline line
        const centerY = currentY + (boxHeight / 2);
        doc.setFont("Helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(255, 180, 81); // FFB451
        doc.text(dateText, 41, centerY + 1, { align: "right" });

        // Draw notch circle on the vertical timeline line (FF0500)
        doc.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
        doc.setDrawColor(255, 5, 0); // FF0500
        doc.setLineWidth(0.6);
        doc.circle(45, centerY, 1.5, "FD");

        currentY += boxHeight + 6;
      }

      // Apply header and footer to every page after the cover page
      const pageCount = doc.getNumberOfPages();
      for (let i = 2; i <= pageCount; i++) {
        doc.setPage(i);

        // Header logo
        if (miniLogoImg) {
          doc.addImage(miniLogoImg, 'PNG', 20, 10, 8, 8);
        }

        // Header left text
        doc.setFont("Helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(255, 180, 81); // #FFB451
        doc.text("AGT Timeline Report", 30, 15);

        // Header right page number
        doc.setFont("Helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(150, 150, 150);
        doc.text(`${i}`, 190, 15, { align: "right" });

        // Header separator line
        doc.setDrawColor(255, 5, 0); // FF0500
        doc.setLineWidth(0.3);
        doc.line(20, 19, 190, 19);

        // Footer header divider
        doc.setDrawColor(50, 50, 50);
        doc.setLineWidth(0.2);
        doc.line(20, 280, 190, 280);

        // Footer text: "Report Created on:" followed by system formatted date & time
        doc.setFont("Helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(`Report Created on: ${dateOfReportStr}`, 20, 285);
      }

      // Keep screen loader spinning for at least 1 second for pristine visuals
      await new Promise(r => setTimeout(r, 1000));

      doc.save(filename);
    } catch (e) {
      console.error("PDF generation failed:", e);
    } finally {
      setPdfExporting(false);
    }
  };

  // Activate the discovery scene
  const handleTriggerStory = () => {
    setShowExtractAnim(true);
    setTimeout(() => {
      setShowExtractAnim(false);
      setCurrentEventIndex(0);
      setIsStoryActive(true);
    }, 1500);
  };

  // Key Event handlers for Story View navigation
  useEffect(() => {
    const handleNavigationKeys = (e: KeyboardEvent) => {
      if (!isStoryActive || sortedEvents.length === 0) return;
      if (e.key === 'ArrowLeft' && currentEventIndex > 0) {
        setCurrentEventIndex(prev => prev - 1);
      } else if (e.key === 'ArrowRight' && currentEventIndex < sortedEvents.length - 1) {
        setCurrentEventIndex(prev => prev + 1);
      } else if (e.key === 'Escape') {
        setIsStoryActive(false);
      }
    };
    window.addEventListener('keydown', handleNavigationKeys);
    return () => window.removeEventListener('keydown', handleNavigationKeys);
  }, [isStoryActive, currentEventIndex, sortedEvents]);

  // Parse the active event parameters safely
  const activeEvent = sortedEvents[currentEventIndex];

  const activeEventCivTags = useMemo(() => {
    if (!activeEvent) return [];
    const civStr = String(activeEvent[34] || '').trim();
    if (!civStr) return [];
    return civStr.split(/[,;]+/).map(t => t.trim()).filter(Boolean);
  }, [activeEvent]);

  // Derive Era layout classification
  // Era check: start of a major era flag in Column AH (index 33) == "Y", or Significance (Column H - index 7) == "Era"
  const isEraEvent = useMemo(() => {
    if (!activeEvent) return false;
    const isEraFlag = String(activeEvent[33] || '').trim().toLowerCase() === 'y';
    const isEraSig = String(activeEvent[7] || '').trim().toLowerCase() === 'era';
    return isEraFlag || isEraSig;
  }, [activeEvent]);

  // Custom formats for stardates for current selected story event
  const startStardate = useMemo(() => {
    if (!activeEvent) return '';
    const colB = String(activeEvent[1] || '').trim();
    if (colB) return colB;
    return toAgtStardate(getEventStartDate(activeEvent));
  }, [activeEvent]);

  const endStardate = useMemo(() => {
    if (!activeEvent) return '';
    const dEnd = getEventEndDate(activeEvent);
    const dStart = getEventStartDate(activeEvent);
    if (!dEnd) return '';
    if (dStart && dEnd && dStart.getTime() === dEnd.getTime()) {
      return ''; // single day event
    }
    return toAgtStardate(dEnd);
  }, [activeEvent]);

  const agtStardateRangeString = useMemo(() => {
    if (!startStardate) return '';
    if (endStardate) {
        return `${startStardate} - ${endStardate}`;
    }
    return startStardate;
  }, [startStardate, endStardate]);

  // Format locations for selected event
  const locationText = useMemo(() => {
    if (!activeEvent) return '';
    const system = String(activeEvent[8] || '').trim();
    const region = String(activeEvent[9] || '').trim();
    const galaxy = String(activeEvent[10] || '').trim();

    const parts = [];
    if (system) parts.push(system);
    if (region) parts.push(region);
    if (galaxy) parts.push(galaxy);

    return parts.join(', ');
  }, [activeEvent]);

  // Media elements parser for active selected story event (slots 1, 2, and 3)
  const activeMediaList = useMemo(() => {
    if (!activeEvent) return [];
    
    // Sloting parameters:
    // Slot 1: URL Y (index 24), Credit Z (index 25), Caption AA (index 26)
    // Slot 2: URL AB (index 27), Credit AC (index 28), Caption AD (index 29)
    // Slot 3: URL AE (index 30), Credit AF (index 31), Caption AG (index 32)
    const mediaSlots = [
      { urlIdx: 24, creditIdx: 25, captionIdx: 26 },
      { urlIdx: 27, creditIdx: 28, captionIdx: 29 },
      { urlIdx: 30, creditIdx: 31, captionIdx: 32 }
    ];

    const results = [];
    for (const slot of mediaSlots) {
      const urlVal = String(activeEvent[slot.urlIdx] || '').trim();
      if (urlVal) {
        const parsed = parseMediaColumn(urlVal);
        if (parsed.type !== 'unsupported' && parsed.src) {
          results.push({
            ...parsed,
            credit: String(activeEvent[slot.creditIdx] || '').trim(),
            caption: String(activeEvent[slot.captionIdx] || '').trim()
          });
        }
      }
    }
    return results;
  }, [activeEvent]);

  // References list (L through Q columns - indexes 11 to 16)
  const referenceUrlsList = useMemo(() => {
    if (!activeEvent) return [];
    const references: string[] = [];
    for (let i = 11; i <= 16; i++) {
      const val = String(activeEvent[i] || '').trim();
      if (val && (val.startsWith('http') || val.startsWith('www.'))) {
        references.push(val);
      }
    }
    return references;
  }, [activeEvent]);

  return (
    <div 
      onMouseDown={handleManualPlay}
      onTouchStart={handleManualPlay}
      className="min-h-screen bg-[#0a0a0a] text-agt-orange font-sans selection:bg-agt-orange selection:text-black flex flex-col"
    >
      {/* Header section */}
      <header className="border-b border-[#FF0500] bg-black/40 backdrop-blur-md sticky top-0 z-[80]">
        <div className="max-w-5xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img 
              src="/api/asset-proxy?id=1h9HvAGeru6Vo7PiWdLbXmGogD8TySnnz" 
              alt="AGT Logo" 
              className="w-10 h-10 object-contain opacity-90"
              referrerPolicy="no-referrer"
              onError={(e) => {
                const imgElement = e.target as HTMLImageElement;
                imgElement.style.display = 'none';
                if (!imgElement.parentElement?.querySelector('.agt-fallback')) {
                  imgElement.parentElement?.insertAdjacentHTML('afterbegin', '<div class="agt-fallback w-10 h-10 bg-[#FFB451] rounded-sm flex items-center justify-center shrink-0"><span class="text-black font-bold text-[10px] tracking-tighter">AGT</span></div>');
                }
              }}
            />
            <div className="flex flex-col">
              <h1 className="font-bold text-xs tracking-[0.2em] uppercase text-agt-orange">Alliance of Galactic Travellers</h1>
              <span className="text-[9px] text-agt-orange uppercase tracking-[0.3em] font-bold">Galactic Chronology terminal</span>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="hidden md:block text-[9px] text-agt-orange/30 tracking-widest font-mono">
              RECORDS: <span className={
                loading ? 'text-yellow-500 font-bold' :
                data.length > 0 ? 'text-emerald-500 font-bold' : 
                'text-[#FF0500] font-bold'
              }>
                {loading ? 'DOWNLOADING' : data.length > 0 ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
            
            {savedTravellerName && savedTravellerId ? (
              <div 
                id="header-traveller-badge"
                style={{
                  color: getSecurityLevelInfo(savedSecurityLevel).color,
                  borderColor: getSecurityLevelInfo(savedSecurityLevel).color
                }}
                className="px-3 py-1 border rounded-lg text-xs font-bold font-mono tracking-wider"
              >
                {savedTravellerName.substring(0, 15)}
              </div>
            ) : (
              <div 
                id="header-traveller-badge"
                style={{
                  color: getSecurityLevelInfo(0).color,
                  borderColor: getSecurityLevelInfo(0).color
                }}
                className="px-3 py-1 border rounded-lg text-xs font-bold font-mono tracking-wider"
              >
                Public User
              </div>
            )}
            
            {/* Spinning Settings cog */}
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 border border-transparent rounded-lg transition-colors relative group cursor-pointer"
              title="Interface Options Settings"
            >
              <motion.div
                whileHover={{ rotate: 180 }}
                whileTap={{ rotate: 360, scale: 0.92 }}
                transition={{ type: "spring", stiffness: 180, damping: 12 }}
                className="flex items-center justify-center"
              >
                <Settings className="w-5 h-5 text-[#FF0500]" />
              </motion.div>
            </button>
          </div>
        </div>
      </header>

      {/* Contribute button placed after the header */}
      <div className="relative max-w-5xl mx-auto w-full px-6 shrink-0">
        <div className="absolute top-4 right-6 z-40">
          <button
            type="button"
            onClick={() => window.open("https://www.nms-agt.com/contribute", "_blank")}
            className="py-2 px-5 bg-[#FF0500] text-white hover:bg-[#ff3330] rounded-full font-black text-[10px] uppercase tracking-[0.2em] shadow-[0_2px_8px_rgba(255,5,0,0.3)] hover:shadow-[0_0_12px_rgba(255,5,0,0.5)] active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <ExternalLink className="w-3 h-3 text-white" />
            <span>Contribute</span>
          </button>
        </div>
      </div>

      {/* Main Container screen */}
      <main className="max-w-5xl mx-auto px-6 py-12 flex-grow flex flex-col justify-center">
        <div className="w-full max-w-2xl mx-auto space-y-12">
          
          {/* Header Title Grid */}
          <div className="text-center space-y-4">
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="flex justify-center"
            >
              <img
                src="/Lore Book-tx.png"
                alt="Lore Book"
                className="h-24 w-auto object-contain mb-2"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.target as HTMLImageElement).className = "hidden";
                }}
              />
            </motion.div>
            <h2 className="text-4xl md:text-5xl font-light tracking-tight text-agt-orange">
              Galactic Chronology Terminal
            </h2>
          </div>

          {/* Core filters scanner terminal */}
          <div className="w-full bg-[#121212]/95 border-2 border-[#FF0500]/70 rounded-2xl p-6 md:p-8 shadow-2xl space-y-6 relative overflow-hidden backdrop-blur-md">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-red-500 to-transparent"></div>
            
            <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-agt-orange/70 flex items-center gap-2 border-b border-[#FF0500]/20 pb-3">
              <Database className="w-3.5 h-3.5 text-[#FF0500]" />
              Select Historical Records
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Earth dates boundaries fields */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase tracking-wider text-agt-orange/60 font-bold flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-red-500" />
                    Earth Start Date (Optional)
                  </span>
                  {rawStartDate && !isRawDateValid(rawStartDate) && (
                    <span className="text-red-500 text-[9px] lowercase font-mono">(! invalid calendar date)</span>
                  )}
                  {isRawDateComplete(rawStartDate) && isRawDateValid(rawStartDate) && (
                    <span className="text-emerald-500 text-[9px] lowercase font-mono">(valid date locked)</span>
                  )}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="DD/MM/YYYY"
                    maxLength={10}
                    value={rawStartDate}
                    onChange={(e) => setRawStartDate(formatToDDMMYYYY(e.target.value, rawStartDate))}
                    className={`w-full bg-[#1c1c1c] border focus:outline-none focus:ring-1 pl-3.5 pr-10 py-2.5 text-xs font-mono text-agt-orange rounded-xl ${
                      rawStartDate && !isRawDateValid(rawStartDate)
                        ? 'border-red-500 focus:border-red-500 focus:ring-red-500/30'
                        : isRawDateComplete(rawStartDate) && isRawDateValid(rawStartDate)
                        ? 'border-emerald-500/60 focus:border-emerald-500 focus:ring-emerald-500/30'
                        : 'border-[#FF0500]/40 hover:border-red-400 focus:border-[#FF0500] focus:ring-[#FF0500]/30'
                    }`}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center">
                    <Calendar className="w-4 h-4 text-[#FF0500] pointer-events-none" />
                    <input
                      type="date"
                      value={parseInputDateToIso(rawStartDate)}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val) {
                          const parts = val.split('-');
                          if (parts.length === 3) {
                            setRawStartDate(`${parts[2]}/${parts[1]}/${parts[0]}`);
                          }
                        }
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full pointer-events-auto"
                      title="Choose from calendar"
                    />
                  </div>
                </div>
                <span className="text-[9px] text-[#FFB451]/60 italic mt-0.5 ml-1">
                  (Earliest date: 9-Aug-2016)
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase tracking-wider text-agt-orange/60 font-bold flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-red-500" />
                    Earth End Date (Optional)
                  </span>
                  {rawEndDate && !isRawDateValid(rawEndDate) && (
                    <span className="text-red-500 text-[9px] lowercase font-mono">(! invalid calendar date)</span>
                  )}
                  {isRawDateComplete(rawEndDate) && isRawDateValid(rawEndDate) && (
                    <span className="text-emerald-500 text-[9px] lowercase font-mono">(valid date locked)</span>
                  )}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="DD/MM/YYYY"
                    maxLength={10}
                    value={rawEndDate}
                    onChange={(e) => setRawEndDate(formatToDDMMYYYY(e.target.value, rawEndDate))}
                    className={`w-full bg-[#1c1c1c] border focus:outline-none focus:ring-1 pl-3.5 pr-10 py-2.5 text-xs font-mono text-agt-orange rounded-xl ${
                      rawEndDate && !isRawDateValid(rawEndDate)
                        ? 'border-red-500 focus:border-red-500 focus:ring-red-500/30'
                        : isRawDateComplete(rawEndDate) && isRawDateValid(rawEndDate)
                        ? 'border-emerald-500/60 focus:border-emerald-500 focus:ring-emerald-500/30'
                        : 'border-[#FF0500]/40 hover:border-red-400 focus:border-[#FF0500] focus:ring-[#FF0500]/30'
                    }`}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center">
                    <Calendar className="w-4 h-4 text-[#FF0500] pointer-events-none" />
                    <input
                      type="date"
                      value={parseInputDateToIso(rawEndDate)}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val) {
                          const parts = val.split('-');
                          if (parts.length === 3) {
                            setRawEndDate(`${parts[2]}/${parts[1]}/${parts[0]}`);
                          }
                        }
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full pointer-events-auto"
                      title="Choose from calendar"
                    />
                  </div>
                </div>
                <span className="text-[9px] text-[#FFB451]/60 italic mt-0.5 ml-1">
                  (Latest date: today)
                </span>
              </div>

              {/* Search Word Input (spanning full width md:col-span-2) */}
              <div className="flex flex-col gap-2 md:col-span-2">
                <label className="text-[10px] uppercase tracking-wider text-agt-orange/60 font-bold flex items-center gap-1.5 font-sans">
                  <Search className="w-3.5 h-3.5 text-red-500" />
                  Search Word
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search any fields containing this term..."
                    value={searchWord}
                    onChange={(e) => setSearchWord(e.target.value)}
                    className="w-full bg-[#1c1c1c] border border-[#FF0500]/40 hover:border-red-400 focus:border-[#FF0500] focus:outline-none focus:ring-1 focus:ring-[#FF0500] pl-3.5 pr-10 py-2.5 text-xs font-mono text-agt-orange rounded-xl placeholder:text-agt-orange/30"
                  />
                  {searchWord && (
                    <button
                      type="button"
                      onClick={() => setSearchWord('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-red-500 hover:text-white rounded-md bg-transparent cursor-pointer"
                      title="Clear search"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Civilization Autocomplete Filter */}
              <div ref={autocompleteRef} className="flex flex-col gap-2 relative">
                <label className="text-[10px] uppercase tracking-wider text-agt-orange/60 font-bold flex items-center gap-1.5 font-sans">
                  <Search className="w-3.5 h-3.5 text-red-500" />
                  Civilization Filter
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Civilization name, leave blank, or ALL"
                    value={civFilter}
                    onChange={(e) => {
                      setCivFilter(e.target.value);
                      setShowAutocomplete(true);
                    }}
                    onFocus={() => setShowAutocomplete(true)}
                    className="w-full bg-[#1c1c1c] border border-[#FF0500]/40 hover:border-red-400 focus:border-[#FF0500] focus:outline-none focus:ring-1 focus:ring-[#FF0500] pl-3.5 pr-10 py-2.5 text-xs font-mono text-agt-orange rounded-xl placeholder:text-agt-orange/30"
                  />
                  {civFilter && (
                    <button
                      type="button"
                      onClick={() => {
                        setCivFilter('');
                        setShowAutocomplete(false);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-red-500 hover:text-white rounded-md bg-transparent cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Floating Autocomplete dropdown of suggestions */}
                <AnimatePresence>
                  {showAutocomplete && civSuggestions.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="absolute left-0 right-0 top-full mt-1 bg-[#161616] border-2 border-[#FF0500] rounded-xl overflow-hidden shadow-2xl z-[90] max-h-48 overflow-y-auto custom-scrollbar"
                    >
                      {civSuggestions.map((tag, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setCivFilter(tag);
                            setShowAutocomplete(false);
                          }}
                          className="w-full text-left px-4 py-2.5 hover:bg-[#FF0500]/20 text-[#FFB451] text-xs font-mono border-b border-[#FF0500]/10 last:border-0 transition-colors cursor-pointer"
                        >
                          {tag}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Named Traveller(s) Filter */}
              <div className="flex flex-col gap-2 relative">
                <label className="text-[10px] uppercase tracking-wider text-agt-orange/60 font-bold flex items-center gap-1.5 font-sans">
                  <Search className="w-3.5 h-3.5 text-red-500" />
                  Named Traveller(s)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Enter traveller name(s) (e.g. Celab)"
                    value={travellerFilter}
                    onChange={(e) => setTravellerFilter(e.target.value)}
                    className="w-full bg-[#1c1c1c] border border-[#FF0500]/40 hover:border-red-400 focus:border-[#FF0500] focus:outline-none focus:ring-1 focus:ring-[#FF0500] pl-3.5 pr-10 py-2.5 text-xs font-mono text-agt-orange rounded-xl placeholder:text-agt-orange/30"
                  />
                  {travellerFilter && (
                    <button
                      type="button"
                      onClick={() => setTravellerFilter('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-red-500 hover:text-white rounded-md bg-transparent cursor-pointer"
                      title="Clear text"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Event Significance Selector (Checkboxes list) */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase tracking-wider text-agt-orange/60 font-bold font-sans">
                    Event Significance
                  </label>
                  <div className="flex items-center gap-1.5 text-[8.5px] uppercase tracking-wider font-mono">
                    <button
                      type="button"
                      onClick={() => setSelectedSignificance(SIGNIFICANCE_LEVELS.map(l => l.id))}
                      className="px-1.5 py-0.5 rounded border border-[#FF0500]/20 bg-red-950/20 text-[#FFB451] hover:text-white hover:bg-[#FF0500]/20 transition-colors cursor-pointer"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedSignificance([])}
                      className="px-1.5 py-0.5 rounded border border-[#FF0500]/20 bg-red-950/20 text-[#FFB451]/60 hover:text-white hover:bg-[#FF0500]/20 transition-colors cursor-pointer"
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="bg-[#1c1c1c] border border-[#FF0500]/40 rounded-xl p-3 h-[125px] overflow-y-auto space-y-2 custom-scrollbar shadow-inner">
                  {SIGNIFICANCE_LEVELS.map((level, idx) => {
                    const isSelected = selectedSignificance.includes(level.id);
                    return (
                      <label 
                        key={idx} 
                        className="flex items-center gap-2.5 text-xs text-agt-orange/90 hover:text-white cursor-pointer select-none font-sans transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            if (isSelected) {
                              setSelectedSignificance(selectedSignificance.filter(s => s !== level.id));
                            } else {
                              setSelectedSignificance([...selectedSignificance, level.id]);
                            }
                          }}
                          className="w-3.5 h-3.5 accent-[#FF0500] cursor-pointer bg-black/40 border border-[#FF0500]/40 rounded text-red-500 focus:ring-0 focus:ring-offset-0"
                        />
                        <span className="truncate">{level.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Record Category Selector */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase tracking-wider text-agt-orange/60 font-bold font-sans">
                    Record Category
                  </label>
                  <div className="flex items-center gap-1.5 text-[8.5px] uppercase tracking-wider font-mono">
                    <button
                      type="button"
                      onClick={() => setSelectedCategories(null)}
                      className="px-1.5 py-0.5 rounded border border-[#FF0500]/20 bg-red-950/20 text-[#FFB451] hover:text-white hover:bg-[#FF0500]/20 transition-colors cursor-pointer"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedCategories([])}
                      className="px-1.5 py-0.5 rounded border border-[#FF0500]/20 bg-red-950/20 text-[#FFB451]/60 hover:text-white hover:bg-[#FF0500]/20 transition-colors cursor-pointer"
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="bg-[#1c1c1c] border border-[#FF0500]/40 rounded-xl p-3 h-[125px] overflow-y-auto space-y-2 custom-scrollbar shadow-inner">
                  {eventTypeList.map((type, idx) => {
                    const isSelected = selectedCategories === null 
                      ? true 
                      : selectedCategories.includes(type);
                    return (
                      <label 
                        key={idx} 
                        className="flex items-center gap-2.5 text-xs text-agt-orange/90 hover:text-white cursor-pointer select-none font-sans transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            const currentList = selectedCategories === null ? [...eventTypeList] : [...selectedCategories];
                            if (isSelected) {
                              const newList = currentList.filter(c => c !== type);
                              setSelectedCategories(newList);
                            } else {
                              const newList = [...currentList, type];
                              if (newList.length === eventTypeList.length) {
                                setSelectedCategories(null);
                              } else {
                                setSelectedCategories(newList);
                              }
                            }
                          }}
                          className="w-3.5 h-3.5 accent-[#FF0500] cursor-pointer bg-black/40 border border-[#FF0500]/40 rounded text-red-500 focus:ring-0 focus:ring-offset-0"
                        />
                        <span className="truncate">{type}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Filter by Location checkbox toggle */}
              <div className="md:col-span-2 border-t border-[#FF0500]/20 pt-4 flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-6">
                  <label className="flex items-center gap-3 text-xs text-agt-orange hover:text-white cursor-pointer select-none font-bold uppercase tracking-wider font-sans">
                    <input
                      type="checkbox"
                      checked={filterByLocation}
                      onChange={(e) => setFilterByLocation(e.target.checked)}
                      className="w-4 h-4 accent-[#FF0500] cursor-pointer bg-black/40 border border-[#FF0500]/40 rounded text-red-500 focus:ring-0 focus:ring-offset-0"
                    />
                    <span>Filter by Location</span>
                  </label>

                  {savedTravellerName && savedTravellerId && (
                    <>
                      <label className="flex items-center gap-3 text-xs text-agt-orange hover:text-white cursor-pointer select-none font-bold uppercase tracking-wider font-sans">
                        <input
                          type="checkbox"
                          checked={omitPublicRecords}
                          onChange={(e) => {
                            const val = e.target.checked;
                            setOmitPublicRecords(val);
                            if (val) setOmitPrivateRecords(false);
                          }}
                          className="w-4 h-4 accent-[#FF0500] cursor-pointer bg-black/40 border border-[#FF0500]/40 rounded text-red-500 focus:ring-0 focus:ring-offset-0"
                        />
                        <span>Omit Public Records</span>
                      </label>

                      <label className="flex items-center gap-3 text-xs text-agt-orange hover:text-white cursor-pointer select-none font-bold uppercase tracking-wider font-sans">
                        <input
                          type="checkbox"
                          checked={omitPrivateRecords}
                          onChange={(e) => {
                            const val = e.target.checked;
                            setOmitPrivateRecords(val);
                            if (val) setOmitPublicRecords(false);
                          }}
                          className="w-4 h-4 accent-[#FF0500] cursor-pointer bg-black/40 border border-[#FF0500]/40 rounded text-red-500 focus:ring-0 focus:ring-offset-0"
                        />
                        <span>Omit Private Records</span>
                      </label>
                    </>
                  )}
                </div>
              </div>

              {/* Dynamic Location Filters conditional on checked state */}
              {filterByLocation && (
                <>
                  {/* System Grid Item */}
                  <div ref={systemAutocompleteRef} className="flex flex-col gap-2 relative">
                    <label className="text-[10px] uppercase tracking-wider text-agt-orange/60 font-bold flex items-center gap-1.5 font-sans">
                      <MapPin className="w-3.5 h-3.5 text-red-500" />
                      System Filter
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Search system name..."
                        value={systemFilter}
                        onChange={(e) => {
                          setSystemFilter(e.target.value);
                          setShowSystemAutocomplete(true);
                        }}
                        onFocus={() => setShowSystemAutocomplete(true)}
                        className="w-full bg-[#1c1c1c] border border-[#FF0500]/40 hover:border-red-400 focus:border-[#FF0500] focus:outline-none focus:ring-1 focus:ring-[#FF0500] pl-3.5 pr-10 py-2.5 text-xs font-mono text-agt-orange rounded-xl placeholder:text-agt-orange/30"
                      />
                      {systemFilter && (
                        <button
                          type="button"
                          onClick={() => {
                            setSystemFilter('');
                            setShowSystemAutocomplete(false);
                          }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-red-500 hover:text-white rounded-md bg-transparent cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {/* Predictive text suggestions drop-down */}
                    <AnimatePresence>
                      {showSystemAutocomplete && systemSuggestions.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -5 }}
                          className="absolute left-0 right-0 top-full mt-1 bg-[#161616] border-2 border-[#FF0500] rounded-xl overflow-hidden shadow-2xl z-[90] max-h-48 overflow-y-auto custom-scrollbar"
                        >
                          {systemSuggestions.map((tag, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setSystemFilter(tag);
                                setShowSystemAutocomplete(false);
                              }}
                              className="w-full text-left px-4 py-2.5 hover:bg-[#FF0500]/20 text-[#FFB451] text-xs font-mono border-b border-[#FF0500]/10 last:border-0 transition-colors cursor-pointer"
                            >
                              {tag}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Region Grid Item */}
                  <div ref={regionAutocompleteRef} className="flex flex-col gap-2 relative">
                    <label className="text-[10px] uppercase tracking-wider text-agt-orange/60 font-bold flex items-center gap-1.5 font-sans">
                      <MapPin className="w-3.5 h-3.5 text-red-500" />
                      Region Filter
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Search region name..."
                        value={regionFilter}
                        onChange={(e) => {
                          setRegionFilter(e.target.value);
                          setShowRegionAutocomplete(true);
                        }}
                        onFocus={() => setShowRegionAutocomplete(true)}
                        className="w-full bg-[#1c1c1c] border border-[#FF0500]/40 hover:border-red-400 focus:border-[#FF0500] focus:outline-none focus:ring-1 focus:ring-[#FF0500] pl-3.5 pr-10 py-2.5 text-xs font-mono text-agt-orange rounded-xl placeholder:text-agt-orange/30"
                      />
                      {regionFilter && (
                        <button
                          type="button"
                          onClick={() => {
                            setRegionFilter('');
                            setShowRegionAutocomplete(false);
                          }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-red-500 hover:text-white rounded-md bg-transparent cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {/* Predictive text suggestions drop-down */}
                    <AnimatePresence>
                      {showRegionAutocomplete && regionSuggestions.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -5 }}
                          className="absolute left-0 right-0 top-full mt-1 bg-[#161616] border-2 border-[#FF0500] rounded-xl overflow-hidden shadow-2xl z-[90] max-h-48 overflow-y-auto custom-scrollbar"
                        >
                          {regionSuggestions.map((tag, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setRegionFilter(tag);
                                setShowRegionAutocomplete(false);
                              }}
                              className="w-full text-left px-4 py-2.5 hover:bg-[#FF0500]/20 text-[#FFB451] text-xs font-mono border-b border-[#FF0500]/10 last:border-0 transition-colors cursor-pointer"
                            >
                              {tag}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Galaxy Grid Item */}
                  <div ref={galaxyAutocompleteRef} className="flex flex-col gap-2 relative md:col-span-2">
                    <label className="text-[10px] uppercase tracking-wider text-agt-orange/60 font-bold flex items-center gap-1.5 font-sans">
                      <MapPin className="w-3.5 h-3.5 text-red-500" />
                      Galaxy Filter
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Search galaxy name..."
                        value={galaxyFilter}
                        onChange={(e) => {
                          setGalaxyFilter(e.target.value);
                          setShowGalaxyAutocomplete(true);
                        }}
                        onFocus={() => setShowGalaxyAutocomplete(true)}
                        className="w-full bg-[#1c1c1c] border border-[#FF0500]/40 hover:border-red-400 focus:border-[#FF0500] focus:outline-none focus:ring-1 focus:ring-[#FF0500] pl-3.5 pr-10 py-2.5 text-xs font-mono text-agt-orange rounded-xl placeholder:text-agt-orange/30"
                      />
                      {galaxyFilter && (
                        <button
                          type="button"
                          onClick={() => {
                            setGalaxyFilter('');
                            setShowGalaxyAutocomplete(false);
                          }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-red-500 hover:text-white rounded-md bg-transparent cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {/* Predictive text suggestions drop-down */}
                    <AnimatePresence>
                      {showGalaxyAutocomplete && galaxySuggestions.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -5 }}
                          className="absolute left-0 right-0 top-full mt-1 bg-[#161616] border-2 border-[#FF0500] rounded-xl overflow-hidden shadow-2xl z-[90] max-h-48 overflow-y-auto custom-scrollbar"
                        >
                          {galaxySuggestions.map((tag, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setGalaxyFilter(tag);
                                setShowGalaxyAutocomplete(false);
                              }}
                              className="w-full text-left px-4 py-2.5 hover:bg-[#FF0500]/20 text-[#FFB451] text-xs font-mono border-b border-[#FF0500]/10 last:border-0 transition-colors cursor-pointer"
                            >
                              {tag}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              )}
            </div>

            {/* Diagnostics Stats and Clear option */}
            <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-[10px] uppercase tracking-widest text-[#FF0500]/70 border-t border-[#FF0500]/20 pt-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-agt-orange/50">Historical Records Available:</span>
                  <span className="font-mono text-white bg-red-950/40 border border-[#FF0500]/20 px-2 py-0.5 rounded font-bold">
                    {loading ? '...' : sortedEvents.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-agt-orange/50">Classified Records Omitted:</span>
                  <span className="font-mono text-white bg-red-950/40 border border-[#FF0500]/20 px-2 py-0.5 rounded font-bold">
                    {loading ? '...' : classifiedOmittedCount}
                  </span>
                </div>
              </div>
              
              <button
                type="button"
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                  setRawStartDate('');
                  setRawEndDate('');
                  setSearchWord('');
                  setSelectedCategories(null);
                  setSelectedSignificance(['era', 'epic', 'major', 'minor', 'event detail']);
                  setCivFilter('');
                  setTravellerFilter('');
                  setFilterByLocation(false);
                  setOmitPublicRecords(false);
                  setOmitPrivateRecords(false);
                  setSystemFilter('');
                  setRegionFilter('');
                  setGalaxyFilter('');
                }}
                className="px-4 py-1.5 bg-[#FF0500]/10 border border-[#FF0500]/50 hover:bg-[#FF0500] hover:text-white transition-colors text-white font-bold text-[9px] uppercase tracking-wider rounded-lg cursor-pointer flex items-center gap-1.5"
              >
                <X className="w-3 h-3 text-[#FF0500]" />
                <span>Reset All Filters</span>
              </button>
            </div>

            {/* Primary Action Buttons */}
            <div className="pt-4 border-t border-[#FF0500]/20 flex flex-col sm:flex-row gap-4">
              <button
                onClick={handleTriggerStory}
                disabled={loading || sortedEvents.length === 0}
                className="flex-1 py-4 bg-[#FF0500] text-white hover:bg-[#ff3330] disabled:opacity-30 disabled:pointer-events-none rounded-full font-black text-xs uppercase tracking-[0.2em] shadow-[0_4px_15px_rgba(255,5,0,0.3)] hover:shadow-[0_0_20px_rgba(255,5,0,0.5)] active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <BookOpen className="w-4 h-4" />
                    <span>Display History</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowMajorTimeline(true)}
                disabled={loading || timelineEvents.length === 0}
                className="flex-1 py-4 bg-[#FF0500] text-white hover:bg-[#ff3330] disabled:opacity-30 disabled:pointer-events-none rounded-full font-black text-xs uppercase tracking-[0.2em] shadow-[0_4px_15px_rgba(255,5,0,0.3)] hover:shadow-[0_0_20px_rgba(255,5,0,0.5)] active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Calendar className="w-4 h-4 text-white" />
                <span>Timeline</span>
              </button>

              <button
                type="button"
                onClick={handleGeneratePDF}
                disabled={loading || timelineEvents.length === 0}
                className="flex-1 py-4 bg-[#FF0500] text-white hover:bg-[#ff3330] disabled:opacity-30 disabled:pointer-events-none rounded-full font-black text-xs uppercase tracking-[0.2em] shadow-[0_4px_15px_rgba(255,5,0,0.3)] hover:shadow-[0_0_20px_rgba(255,5,0,0.5)] active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <FileText className="w-4 h-4 text-white" />
                <span>Major Timeline PDF</span>
              </button>
            </div>
          </div>

          {/* Core system alerts */}
          {error && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-3 px-6 py-4 bg-[#FF0500]/10 border-2 border-[#FF0500] text-agt-orange/90 rounded-2xl text-xs font-semibold tracking-wide"
            >
              <AlertCircle className="w-5 h-5 shrink-0 text-[#FF0500]" />
              <p>{error}</p>
            </motion.div>
          )}

        </div>
      </main>

      {/* FOOTER SECTION */}
      <footer className="bg-[#FFB451] mt-auto">
        <div className="max-w-5xl mx-auto px-6 py-12 flex flex-col items-center gap-6 text-black">
          <div className="flex flex-wrap justify-center items-center gap-y-2 text-[10px] uppercase tracking-[0.2em] font-bold">
            <a href="https://www.nms-agt.com" target="_blank" rel="noopener noreferrer" className="hover:opacity-60 transition-opacity">Home</a>
            <span className="ml-1 mr-2 text-black/40">|</span>
            <a href="https://www.nms-agt.com/about-the-agt" target="_blank" rel="noopener noreferrer" className="hover:opacity-60 transition-opacity">About</a>
            <span className="ml-1 mr-2 text-black/40">|</span>
            <a href="https://www.nms-agt.com/team" target="_blank" rel="noopener noreferrer" className="hover:opacity-60 transition-opacity">Team</a>
            <span className="ml-1 mr-2 text-black/40">|</span>
            <a href="https://www.nms-agt.com/contribute" target="_blank" rel="noopener noreferrer" className="hover:opacity-60 transition-opacity">Contribute</a>
            <span className="ml-1 mr-2 text-black/40">|</span>
            <a href="https://www.nms-agt.com/agt-galactic-archives" target="_blank" rel="noopener noreferrer" className="hover:opacity-60 transition-opacity">Galactic Archives</a>
            <span className="ml-1 mr-2 text-black/40">|</span>
            <a href="https://www.nms-agt.com/engage" target="_blank" rel="noopener noreferrer" className="hover:opacity-60 transition-opacity">Engage</a>
            <span className="ml-1 mr-2 text-black/40">|</span>
            <a href="https://www.nms-agt.com/agt-navi" target="_blank" rel="noopener noreferrer" className="hover:opacity-60 transition-opacity">AGT NAVI</a>
            <span className="ml-1 mr-2 text-black/40">|</span>
            <a href="https://www.nms-agt.com/terms" target="_blank" rel="noopener noreferrer" className="hover:opacity-60 transition-opacity">Terms</a>
            <span className="ml-1 mr-2 text-black/40">|</span>
            <a href="https://www.nms-agt.com/support" target="_blank" rel="noopener noreferrer" className="hover:opacity-60 transition-opacity">Support</a>
            <span className="ml-1 mr-2 text-black/40">|</span>
            <a href="https://www.nms-agt.com/terms/copyright" target="_blank" rel="noopener noreferrer" className="hover:opacity-60 transition-opacity">Copyright</a>
          </div>
          <p className="text-[9px] font-mono uppercase tracking-[0.3em] font-bold">&copy; 2026 Alliance of Galactic Travellers</p>
        </div>
      </footer>

      {/* AMBIENT MUSIC AUDIO SYSTEM */}
      <audio 
        ref={audioRef}
        src="/AGT%20Anthem%20(Instrumental).mp3"
        loop
        preload="auto"
      />

      {/* INTERACTIVE POPUP CONFIGURATION SETTINGS PANEL */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-black/85 backdrop-blur-sm"
            />
            
            <motion.div 
              initial={{ scale: 0.92, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 30 }}
              className="relative max-w-md w-full max-h-[85vh] md:max-h-[90vh] bg-[#161616] border-2 border-[#FF0500] rounded-2xl overflow-hidden glass-card shadow-[0_15px_60px_rgba(255,5,0,0.25)] p-6 z-10 flex flex-col"
            >
              <div className="flex items-center justify-between border-b border-[#FF0500]/30 pb-4 mb-6 shrink-0">
                <h3 className="text-sm uppercase tracking-widest font-black text-agt-orange flex items-center gap-2">
                  <Settings className="w-4 h-4 text-[#FF0500]" />
                  Configuration Settings
                </h3>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-1 px-3 bg-[#FF0500] hover:bg-[#ff3330] text-white text-[10px] uppercase font-bold tracking-widest rounded-md hover:scale-[1.03] active:scale-[0.97] transition-all cursor-pointer flex items-center gap-1 font-mono"
                >
                  <X className="w-3 h-3" />
                  <span>Done</span>
                </button>
              </div>

              <div className="space-y-6 overflow-y-auto pr-1 flex-1 custom-scrollbar min-h-0">
                {/* Font proportions scaling config */}
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-widest font-black text-agt-orange/50 block">
                    Desktop Text Scale
                  </label>
                  <select
                    value={fontScale}
                    onChange={(e) => setFontScale(e.target.value)}
                    className="w-full bg-[#1c1c1c] border border-[#FF0500]/40 focus:outline-none focus:ring-1 focus:ring-[#FF0500] px-3.5 py-2.5 text-xs text-agt-orange rounded-xl cursor-pointer"
                  >
                    <option value="1x">1.0x (Standard)</option>
                    <option value="1.25x">1.25x (Medium)</option>
                    <option value="1.5x">1.5x (Large)</option>
                    <option value="2x">2.0x (Very Large)</option>
                    <option value="2.5x">2.5x (Huge)</option>
                    <option value="3x">3.0x (Extreme)</option>
                  </select>
                </div>

                {/* Traveller Credentials Integration */}
                <div className="pt-4 border-t border-[#FF0500]/25 space-y-4">
                  <div>
                    <h4 className="text-xs uppercase tracking-widest font-black text-agt-orange block mb-1">
                      AGT Traveller Registration
                    </h4>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold tracking-wider text-agt-orange/60 block">
                        Traveller Name
                      </label>
                      <input
                        type="text"
                        placeholder="Alphanumeric, up to 42 characters"
                        value={travellerNameInput}
                        onChange={(e) => {
                          const clean = e.target.value.replace(/[^a-zA-Z0-9\s]/g, '').slice(0, 42);
                          setTravellerNameInput(clean);
                        }}
                        className="w-full bg-[#1c1c1c] border border-[#FF0500]/30 focus:outline-none focus:ring-1 focus:ring-[#FF0500] px-3.5 py-2 text-xs text-[#FFB451] rounded-xl font-mono placeholder-agt-orange/35"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold tracking-wider text-agt-orange/60 block">
                        AGT Traveller ID
                      </label>
                      <input
                        type="text"
                        placeholder="Format: ########-????-####"
                        value={travellerIdInput}
                        onChange={(e) => {
                          setTravellerIdInput(e.target.value.slice(0, 30));
                        }}
                        className="w-full bg-[#1c1c1c] border border-[#FF0500]/30 focus:outline-none focus:ring-1 focus:ring-[#FF0500] px-3.5 py-2 text-xs text-[#FFB451] rounded-xl font-mono placeholder-agt-orange/35"
                      />
                    </div>
                  </div>

                  {!savedTravellerName && !savedTravellerId && (
                    <div className="bg-black/30 border border-white/5 rounded-xl p-3 text-[10px]">
                      <div className="font-bold uppercase tracking-wider text-yellow-500/80">STATUS: PUBLIC PREVIEW</div>
                    </div>
                  )}

                  {verifyError && (
                    <div className="text-[10px] bg-red-950/30 border border-[#FF0500]/25 rounded-xl p-3 leading-relaxed text-red-400">
                      {verifyError}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => verifyCredentials(travellerNameInput, travellerIdInput)}
                      disabled={isVerifying}
                      className="flex-1 py-2.5 bg-[#FF0500] hover:bg-[#ff3330] disabled:opacity-50 text-white text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer text-center"
                    >
                      {isVerifying ? 'Verifying...' : 'Verify Clearance'}
                    </button>
                    
                    <button
                      type="button"
                      onClick={handleClearCredentials}
                      className="py-2.5 px-4 bg-black/40 border border-[#FF0500]/45 text-[#FF0500] hover:bg-[#FF0500] hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer text-center"
                    >
                      Reset
                    </button>
                  </div>

                  {savedTravellerName && savedTravellerId && (
                    <div className="flex items-center justify-between text-[10px] font-mono pt-3 border-t border-[#FF0500]/25">
                      <span className="text-white">Verified User: <span className="text-white font-bold">{savedTravellerName}</span></span>
                      <span>
                        <span className="text-[#FFB451]/70">Clearance: </span>
                        <span 
                          style={{ color: getSecurityLevelInfo(savedSecurityLevel).color }}
                          className="font-bold uppercase tracking-wider"
                        >
                          {getSecurityLevelInfo(savedSecurityLevel).label}
                        </span>
                      </span>
                    </div>
                  )}
                </div>

                {/* Ambient music control loop */}
                <div className="pt-4 border-t border-white/5 space-y-3">
                  <h4 className="text-xs uppercase tracking-widest font-black text-agt-orange/50">AGT Anthem</h4>
                  <div className="flex items-center justify-center bg-black/30 p-3 rounded-xl border border-white/5">
                    <button 
                      onClick={() => setAudioEnabled(!audioEnabled)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest font-bold transition-all cursor-pointer ${
                        audioEnabled 
                          ? 'bg-[#FF0500] text-white hover:bg-[#ff3330]' 
                          : 'bg-black/60 border border-[#FF0500] text-agt-orange/40 hover:bg-[#FF0500] hover:text-white'
                      }`}
                    >
                      {audioEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                      <span>{audioEnabled ? 'Active' : 'Muted'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DISCOVER HISTORICAL SCANNER ANIMATION */}
      <AnimatePresence>
        {showExtractAnim && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 backdrop-blur-md"
          >
            <div className="flex flex-col items-center justify-center space-y-6" style={{ perspective: 1000 }}>
              <motion.div
                initial={{ rotateY: 0, scale: 0.8 }}
                animate={{ rotateY: 360, scale: 1.1 }}
                exit={{ rotateY: 720, scale: 0.8, opacity: 0 }}
                transition={{ duration: 1.5, ease: "easeInOut" }}
                className="w-48 h-48 flex items-center justify-center"
              >
                <img 
                  src="/AgtOfficialLogo.png" 
                  alt="AGT Official Logo" 
                  className="w-40 h-40 object-contain drop-shadow-[0_0_35px_rgba(255,180,81,0.6)]"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    img.src = '/AGTicon.png';
                  }}
                />
              </motion.div>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: [0, 1, 1, 0], y: 0 }}
                transition={{ duration: 1.5, times: [0, 0.2, 0.8, 1] }}
                className="text-[#FFB451] text-xs tracking-[0.34em] uppercase font-bold text-center drop-shadow-[0_0_10px_rgba(255,180,81,0.4)] font-mono"
              >
                Discovering AGT History
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FULL SCREEN CHRONOLOGY STORY POPUP */}
      <AnimatePresence>
        {isStoryActive && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            {/* Dark glass backdrop layout */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsStoryActive(false)}
              className="absolute inset-0 bg-black/95 backdrop-blur-md"
            />

            {/* Content card popup */}
            <motion.div 
              initial={{ scale: 0.9, y: 30, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 30, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="relative max-w-3xl w-full max-h-[90vh] bg-[#0c0c0c]/95 border-2 border-agt-orange/30 rounded-2xl shadow-[0_0_50px_rgba(255,180,81,0.15)] flex flex-col z-10 overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-[#FFB451] to-transparent"></div>

              {/* Close Button element */}
              <button 
                onClick={() => setIsStoryActive(false)}
                className="absolute top-4 right-4 p-2 bg-red-950/40 hover:bg-red-500 hover:text-white text-[#FF0500] border border-red-500/30 rounded-lg transition-all cursor-pointer z-[120]"
                id="close-modal-btn"
                title="Exit Chronology"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Popup Header and counter index indicators */}
              <div className="px-6 py-4 border-b border-agt-orange/15 bg-black/40 flex items-center justify-between text-[10px] tracking-widest font-mono uppercase text-[#FFB451]/50">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    Chronology Archive Node
                  </span>
                  {activeEvent && (
                    <div 
                      style={{ 
                        color: getSecurityLevelInfo(getRowSecurityLevel(activeEvent)).color, 
                        borderColor: getSecurityLevelInfo(getRowSecurityLevel(activeEvent)).color 
                      }}
                      className="px-2 py-0.5 rounded-lg border text-[10px] font-bold font-mono tracking-wider bg-black/40"
                    >
                      {getSecurityLevelInfo(getRowSecurityLevel(activeEvent)).label}
                    </div>
                  )}
                </div>
                <div className="mr-12">
                  Index {currentEventIndex + 1} of {sortedEvents.length}
                </div>
              </div>

              {/* Central text and content element - with scroll capability built-in */}
              <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scrollbar">
                
                {sortedEvents.length === 0 ? (
                  <div className="py-20 flex flex-col items-center justify-center text-center space-y-4">
                    <Database className="w-12 h-12 text-agt-orange/25 animate-pulse" />
                    <h3 className="text-sm font-bold uppercase tracking-widest text-agt-orange">Sensor Coordinates Empty</h3>
                    <p className="text-xs text-agt-orange/50 max-w-sm">
                      No historical accounts matched these specifications in the timeline. Close coordinates scanner and adjust filters.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* ERA Event Layout */}
                    {isEraEvent ? (
                      <div className="space-y-6">
                        {/* Title line */}
                        <div className="space-y-1">
                          <span className="text-[10px] uppercase font-bold tracking-[0.3em] text-purple-400">Archival Era Transition</span>
                          <h3 className="text-3xl md:text-4xl font-light text-purple-200 tracking-tight leading-none uppercase pr-8">
                            {activeEvent[3] || 'Untitled Era Event'}
                          </h3>
                        </div>

                        {/* Subtitle Line (Description) */}
                        <p className="text-lg text-agt-orange leading-relaxed font-serif border-l-2 border-purple-500/40 pl-4 py-1 whitespace-pre-line">
                          {activeEvent[4] || 'Era historical metadata body.'}
                        </p>

                        {/* AGT Stardate Range */}
                        {agtStardateRangeString && (
                          <div className="flex items-center gap-2 text-xs font-mono text-purple-300">
                            <span className="text-purple-400 font-bold uppercase tracking-wider">Epoch Stardate:</span>
                            <span>{agtStardateRangeString}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Standard (Non-Era) Event Layout */
                      <div className="space-y-4">
                        {/* Title Line */}
                        <h3 className="text-2xl md:text-3xl font-semibold text-white tracking-tight leading-snug uppercase pr-8">
                          {activeEvent[3] || 'Untitled Record Log'}
                        </h3>

                        {/* AGT Stardate Range */}
                        {agtStardateRangeString && (
                          <div className="flex items-center gap-2 text-xs font-mono text-agt-orange/60 border-b border-agt-orange/10 pb-2">
                            <span className="text-[#FF0500] font-bold uppercase tracking-wider">AGT Stardate:</span>
                            <span>{agtStardateRangeString}</span>
                          </div>
                        )}

                        {/* Event Location Line (If available) */}
                        {locationText && (
                          <div 
                            onClick={() => {
                              const coord = activeEvent[35] ? String(activeEvent[35]).trim() : '';
                              const gal = activeEvent[10] ? String(activeEvent[10]).trim() : '';
                              if (coord) {
                                setActiveMapCoordinate({ coordinate: coord, galaxy: gal });
                              }
                            }}
                            className={`flex items-center gap-2 text-[10px] uppercase tracking-wider font-sans text-agt-orange/50 ${
                              (activeEvent[35] && String(activeEvent[35]).trim()) ? 'cursor-pointer hover:text-[#ff3330] hover:scale-[1.01] transition-all group' : ''
                            }`}
                          >
                            <MapPin className={`w-3.5 h-3.5 text-[#FFB451]/60 shrink-0 ${
                              (activeEvent[35] && String(activeEvent[35]).trim()) ? 'group-hover:text-[#FF0500] animate-pulse' : ''
                            }`} />
                            <span>
                              Location: {locationText}
                              {activeEvent[35] && String(activeEvent[35]).trim() && (
                                <span className="ml-2 text-[8px] tracking-widest text-[#FF0500] bg-[#FF0500]/10 px-1.5 py-0.5 rounded border border-[#FF0500]/20 font-mono">
                                  {String(activeEvent[35]).trim()}
                                </span>
                              )}
                            </span>
                          </div>
                        )}

                        {/* Event description with spacer and traveler italics */}
                        <div className="text-sm md:text-base text-agt-orange/90 leading-relaxed pt-2">
                          <p className="inline whitespace-pre-line">
                            {activeEvent[4] || 'No event description is recorded for this entry.'}
                          </p>
                          {activeEvent[5] && (
                            <span className="whitespace-nowrap italic text-[#FFB451]/60">
                              {" "}&mdash; <span className="font-semibold underline decoration-[#FF0500]/30">{activeEvent[5]}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Media Block Placement from Column Y, AB, AE sequentially */}
                    {activeMediaList.length > 0 && (
                      <div className="space-y-6">
                        {activeMediaList.map((media, mIdx) => (
                          <div key={mIdx} className="space-y-2 border border-white/5 bg-black/20 rounded-xl p-3">
                            <div className="overflow-hidden rounded-xl border border-agt-orange/20 bg-black/40 shadow-inner flex justify-center items-center relative group">
                              {media.type === 'youtube' ? (
                                <div className="w-full relative">
                                  <iframe
                                    src={`${media.src}?enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
                                    className="w-full aspect-video rounded-xl"
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                    allowFullScreen
                                    referrerPolicy="strict-origin-when-cross-origin"
                                  />
                                  <a 
                                    href={media.src.replace('/embed/', '/watch?v=')} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="absolute top-2 right-2 p-1.5 bg-black/80 hover:bg-red-500 hover:text-white text-white rounded-md text-[9px] uppercase font-mono transition-colors flex items-center gap-1 border border-white/10"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    <span>Watch Video</span>
                                  </a>
                                </div>
                              ) : (
                                <a
                                  href={media.src}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="w-full block hover:scale-[1.005] active:scale-[0.995] transition-transform relative cursor-pointer"
                                  title="Click to view full screen in a new tab"
                                >
                                  <ImageLoader
                                    src={media.src}
                                    alt={media.caption || `Alliance historical archives render ${mIdx + 1}`}
                                  />
                                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between pointer-events-none rounded-b-xl">
                                    <span className="text-[10px] text-agt-orange/80 uppercase font-mono tracking-wider flex items-center gap-1">
                                      <ExternalLink className="w-3 h-3 text-red-500" />
                                      Open Image Full Screen
                                    </span>
                                  </div>
                                </a>
                              )}
                            </div>
                            
                            {/* Caption and Credits directly below */}
                            {(media.caption || media.credit) && (
                              <div className="px-2 py-1 text-center space-y-1">
                                {media.caption && (
                                  <p className="text-xs text-agt-orange/80 font-sans tracking-wide">
                                    {media.caption}
                                  </p>
                                )}
                                {media.credit && (
                                  <p className="text-[10px] text-[#FF0500] italic font-mono uppercase tracking-widest">
                                    ARCHIVE CREDIT:{' '}
                                    {isHtmlString(media.credit) ? (
                                      <span 
                                        className="inline [&_a]:underline [&_a]:text-red-500 [&_a]:hover:text-white [&_a]:transition-colors cursor-pointer"
                                        dangerouslySetInnerHTML={{ __html: media.credit }}
                                      />
                                    ) : (
                                      media.credit
                                    )}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* External References link lists */}
                    {referenceUrlsList.length > 0 && (
                      <div className="pt-4 border-t border-white/5 space-y-3">
                        <h4 className="text-[10px] uppercase font-bold tracking-widest text-[#FFB451]/40 flex items-center gap-1">
                          <ExternalLink className="w-3 h-3 text-red-500" />
                          ARCHIVAL REFERENCES
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] uppercase tracking-wider font-mono">
                          {referenceUrlsList.map((url, index) => (
                            <a
                              key={index}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 border border-agt-orange/15 bg-black/30 hover:bg-[#FF0500]/15 hover:border-[#FF0500] hover:text-white transition-all rounded-lg flex items-center justify-between group"
                            >
                              <span className="truncate pr-4">{getDisplayUrlLabel(url)}</span>
                              <ExternalLink className="w-3 h-3 shrink-0 text-red-500 group-hover:text-white" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Civilization Tags Block */}
                    {activeEventCivTags.length > 0 && (
                      <div className="pt-4 border-t border-white/5 space-y-2">
                        <h4 className="text-[10px] uppercase font-bold tracking-widest text-[#FFB451]/40 flex items-center gap-1.5">
                          <Search className="w-3 h-3 text-red-500" />
                          CIVILIZATIONS
                        </h4>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {activeEventCivTags.map((tag, idx) => (
                            <span 
                              key={idx}
                              className="px-2.5 py-1 bg-red-950/30 border border-red-500/20 text-agt-orange/90 rounded-lg text-xs font-mono tracking-wide"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Popup controls footer row */}
              {sortedEvents.length > 0 && (
                <div className="px-6 py-5 border-t border-agt-orange/15 bg-black/60 flex items-center justify-between min-h-[64px] relative">
                  
                  {/* Bottom Left Corner: Significance badge */}
                  <div className="flex items-center">
                    <div className={`px-3 py-1 text-[9px] uppercase tracking-[0.15em] rounded-full border ${getSignificanceStyle(activeEvent?.[7] || '')}`}>
                      {activeEvent?.[7] || 'Insignificant'}
                    </div>
                  </div>

                  {/* Navigation arrows */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        if (currentEventIndex > 0) {
                          setCurrentEventIndex(prev => prev - 1);
                        }
                      }}
                      disabled={currentEventIndex === 0}
                      className="p-2.5 bg-black border border-[#FF0500]/40 hover:bg-[#FF0500] hover:text-white hover:border-[#FF0500] disabled:opacity-20 disabled:pointer-events-none rounded-xl text-[#FFB451] transition-all cursor-pointer shadow-md"
                      title="Back Chronological node"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (currentEventIndex < sortedEvents.length - 1) {
                          setCurrentEventIndex(prev => prev + 1);
                        }
                      }}
                      disabled={currentEventIndex === sortedEvents.length - 1}
                      className="p-2.5 bg-[#FF0500] hover:bg-[#ff3330] disabled:opacity-20 disabled:pointer-events-none rounded-xl text-white transition-all cursor-pointer shadow-md"
                      title="Forward Chronological node"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Bottom Right Corner: Event type badge */}
                  <div className="flex items-center">
                    <div className={`px-3 py-1 text-[9px] uppercase tracking-[0.15em] rounded-full border ${getEventTypeStyle(activeEvent?.[17] || 'Trivial')}`}>
                      {activeEvent?.[17] || 'Log Record'}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MAJOR TIMELINE MODAL */}
      <AnimatePresence>
        {showMajorTimeline && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMajorTimeline(false)}
              className="absolute inset-0 bg-black/95 backdrop-blur-md"
            />

            <motion.div 
              initial={{ scale: 0.92, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 30 }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="relative max-w-4xl w-full h-[85vh] bg-[#0c0c0c] border-2 border-[#FF0500] rounded-2xl flex flex-col z-10 overflow-hidden shadow-[0_0_50px_rgba(255,5,0,0.25)]"
            >
              {/* Highlight line top */}
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-[#E25530] to-transparent"></div>

              {/* Close Button element */}
              <button 
                onClick={() => setShowMajorTimeline(false)}
                className="absolute top-4 right-4 p-2 bg-red-950/40 hover:bg-red-500 hover:text-white text-[#FF0500] border border-red-500/30 rounded-lg transition-all cursor-pointer z-[120]"
                title="Close Timeline"
                id="close-major-timeline-btn"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Header */}
              <div className="px-6 py-4 border-b border-[#FF0500]/20 bg-black/40 flex items-center justify-between">
                <div>
                  <h3 className="text-xl md:text-2xl font-bold tracking-tight text-agt-orange uppercase">
                    Major Chronology Timeline
                  </h3>
                  <p className="text-[10px] tracking-widest font-mono uppercase text-[#FFB451]/50 mt-1">
                    Showing events matching filter criteria ({timelineEvents.length} records)
                  </p>
                </div>
              </div>

              {/* Vertical timeline scrolling content */}
              <div className="flex-1 overflow-y-auto p-6 md:p-10 custom-scrollbar bg-black/25">
                {timelineEvents.length === 0 ? (
                  <div className="py-20 flex flex-col items-center justify-center text-center space-y-4">
                    <Calendar className="w-12 h-12 text-[#FF0500]/40 animate-pulse" />
                    <h4 className="text-sm font-bold uppercase tracking-widest text-[#FFB451]">No Chronological Matches</h4>
                    <p className="text-xs text-agt-orange/50 max-w-sm">
                      Adjust your active search filters, date range, or significance levels to scan historical timeline records.
                    </p>
                  </div>
                ) : (
                  <div className="relative pl-6 sm:pl-10">
                    {/* The vertical timeline line itself in hardcoded hex color FF0500 */}
                    <div className="absolute left-[3px] sm:left-[19px] top-2 bottom-2 w-0.5 bg-[#FF0500]" />

                    <div className="space-y-8">
                      {timelineEvents.map((event, idx) => {
                        const dateText = event[1] || event[0] || 'Unknown Date';
                        const category = String(event[17] || '').trim().toLowerCase();
                        const sig = String(event[7] || '').trim().toLowerCase();
                        const civStr = String(event[34] || '').trim();
                        const civTags = civStr.split(/[,;]+/).map(t => t.trim()).filter(Boolean);
                        
                        const hasTargetCiv = civTags.some(tag => {
                          const tLower = tag.toLowerCase();
                          return tLower === "alliance of galactic travellers" || tLower.endsWith("travellers foundation");
                        });

                        let bgClass = "bg-transparent hover:bg-[#E25530]/5";
                        let borderClass = "border-[#E25530]";
                        let textClass = "text-[#FFB451]";
                        let badgeClass = "bg-black/40 border border-[#E25530]/30 text-[#FFB451]/60";

                        if (sig === 'era') {
                          bgClass = "bg-[#52c0db] hover:bg-[#52c0db]/90";
                          borderClass = "border-[#52c0db]";
                          textClass = "text-black";
                          badgeClass = "bg-black/15 border border-black/20 text-black/75";
                        } else if (sig === 'epic' && hasTargetCiv) {
                          bgClass = "bg-[#FFB451] hover:bg-[#FFB451]/90";
                          borderClass = "border-[#FFB451]";
                          textClass = "text-black";
                          badgeClass = "bg-black/15 border border-black/20 text-black/75";
                        } else if (sig === 'major' && hasTargetCiv) {
                          bgClass = "bg-[#E25530] hover:bg-[#E25530]/90";
                          borderClass = "border-[#E25530]";
                          textClass = "text-black";
                          badgeClass = "bg-black/15 border border-black/20 text-black/75";
                        }

                        return (
                          <div key={idx} className="relative group flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                            {/* Circle notch on the vertical red line */}
                            <div className="absolute -left-[27px] sm:-left-[25px] top-1.5 sm:top-auto w-3.5 h-3.5 rounded-full bg-[#0c0c0c] border-[3px] border-[#FF0500] group-hover:bg-[#FFB451] group-hover:border-[#E25530] transition-colors z-10" />

                            {/* Event Date alongside box */}
                            <div className="w-32 shrink-0 text-left sm:text-right font-mono text-xs font-semibold uppercase tracking-wider text-agt-orange/70 select-none">
                              {dateText}
                            </div>

                            {/* Preceding category icons */}
                            {category === 'military' && (
                              <img
                                src="/sword-tx.png"
                                alt="Military"
                                className="w-5 h-5 object-contain shrink-0"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).className = "hidden";
                                }}
                              />
                            )}
                            {category === 'political' && (
                              <img
                                src="/politics-pp-tx.png"
                                alt="Political"
                                className="w-5 h-5 object-contain shrink-0"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).className = "hidden";
                                }}
                              />
                            )}

                            {/* Timeline button box */}
                            <button
                              type="button"
                              onClick={() => setSelectedTimelineEvent(event)}
                              className={`text-left px-4 py-3 border-2 ${borderClass} ${bgClass} ${textClass} rounded-xl hover:scale-[1.01] transition-all cursor-pointer font-bold text-xs sm:text-sm tracking-wide max-w-xl w-full shadow-[0_2px_8px_rgba(226,85,48,0.1)] hover:shadow-[0_4px_16px_rgba(226,85,48,0.2)] flex items-center justify-between gap-4`}
                            >
                              <span className="truncate pr-2">{event[3] || 'Untitled Record'}</span>
                              <span className={`text-[8px] tracking-widest font-mono uppercase px-1.5 py-0.5 rounded-md shrink-0 ${badgeClass}`}>
                                {event[7]}
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-[#FF0500]/20 bg-black/60 flex items-center justify-between text-[10px] tracking-widest font-mono uppercase text-[#FFB451]/50">
                <span>Terminal Mode Online</span>
                <button
                  type="button"
                  onClick={() => setShowMajorTimeline(false)}
                  className="px-4 py-1.5 bg-[#FF0500]/10 border border-[#FF0500] hover:bg-[#FF0500] hover:text-white transition-colors text-white font-bold text-[10px] uppercase tracking-wider rounded-lg cursor-pointer animate-none"
                >
                  Close Timeline
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SINGLE EVENT DETAILS POPUP FROM TIMELINE */}
      <AnimatePresence>
        {selectedTimelineEvent && (
          <SingleTimelineEventDetailModal 
            event={selectedTimelineEvent}
            onClose={() => setSelectedTimelineEvent(null)}
            onOpenMap={(coord, gal) => setActiveMapCoordinate({ coordinate: coord, galaxy: gal })}
          />
        )}
      </AnimatePresence>

      {/* PDF EXPORT LOGO LOADING OVERLAY */}
      <AnimatePresence>
        {pdfExporting && (
          <div className="fixed inset-0 z-[150] flex flex-col items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />

            <motion.div 
              initial={{ scale: 0.92, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 30 }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="relative text-center space-y-6 z-10 p-8 max-w-sm bg-[#0c0c0c] border border-agt-orange/30 rounded-2xl flex flex-col items-center justify-center shadow-[0_0_50px_rgba(255,180,81,0.2)]"
            >
              <img 
                src="/AGTicon.png" 
                alt="AGT Icon Loading" 
                className="w-16 h-16 object-contain animate-spin-y" 
                referrerPolicy="no-referrer"
              />
              <div className="space-y-2">
                <h3 className="text-lg font-bold tracking-widest text-[#FFB451] uppercase">
                  Archival Synthesis
                </h3>
                <p className="text-[10px] tracking-widest font-mono uppercase text-[#E25530]/80">
                  Exporting Chronology Timeline...
                </p>
                <p className="text-[9px] font-mono text-gray-500 uppercase">
                  Please hold, finalizing historical documents
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* General Security Verification and Clear Notifications */}
      <AnimatePresence>
        {popupMessage && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPopupMessage('')}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative max-w-sm w-full bg-[#161616] border-2 border-agt-orange rounded-2xl p-6 z-10 text-center shadow-[0_15px_60px_rgba(255,180,81,0.25)]"
            >
              <div className="flex justify-center mb-4">
                <AlertCircle className={`w-10 h-10 ${popupMessage.toLowerCase().includes('successful') ? 'text-green-400' : 'text-[#FF0500]'}`} />
              </div>
              <h4 className="text-sm font-black uppercase tracking-widest text-[#FFB451] mb-2">Security Hub</h4>
              <p className="text-xs text-white/90 mb-5 leading-relaxed font-semibold">{popupMessage}</p>
              <button
                onClick={() => setPopupMessage('')}
                className="px-6 py-2 bg-agt-orange hover:bg-[#ffb451] text-black text-xs uppercase tracking-widest font-black rounded-lg transition-all cursor-pointer"
              >
                Continue
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* PDF Blocked / Access Restriction Notification */}
      <AnimatePresence>
        {pdfBlockedMessage && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPdfBlockedMessage('')}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative max-w-sm w-full bg-[#161616] border-2 border-[#FF0500] rounded-2xl p-6 z-10 text-center shadow-[0_15px_60px_rgba(255,5,0,0.35)]"
            >
              <div className="flex justify-center mb-4">
                <AlertCircle className="w-10 h-10 text-[#FF0500] animate-bounce" />
              </div>
              <h4 className="text-sm font-black uppercase tracking-widest text-agt-orange mb-3">Access Denied</h4>
              <p className="text-xs text-white/95 mb-5 leading-relaxed font-semibold">{pdfBlockedMessage}</p>
              <button
                onClick={() => setPdfBlockedMessage('')}
                className="px-6 py-2 bg-[#FF0500] hover:bg-[#ff3330] text-white text-xs uppercase tracking-widest font-black rounded-lg transition-all cursor-pointer"
              >
                Dismiss
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* GALAXY NAVIGATION MAP POPUP DETECTOR */}
      <AnimatePresence>
        {activeMapCoordinate && (
          <GalaxyMapPopup
            coordinate={activeMapCoordinate.coordinate}
            galaxy={activeMapCoordinate.galaxy}
            onClose={() => setActiveMapCoordinate(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
