/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, useRef } from 'react';
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
  BookOpen
} from 'lucide-react';
import Papa from 'papaparse';

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

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
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
  const [significanceFilter, setSignificanceFilter] = useState('ALL');
  const [significanceMatchType, setSignificanceMatchType] = useState<'exact' | 'threshold'>('threshold');
  const [activityFilter, setActivityFilter] = useState('ALL');
  const [civFilter, setCivFilter] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const autocompleteRef = useRef<HTMLDivElement>(null);

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
            const recordRows = results.data.slice(1);
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

  // Compute matching suggestions for the autocomplete
  const civSuggestions = useMemo(() => {
    const query = civFilter.trim().toLowerCase();
    if (!query || query === 'all') return [];
    return civilizationTagsList.filter(tag => 
      tag.toLowerCase().includes(query) && tag.toLowerCase() !== query
    );
  }, [civilizationTagsList, civFilter]);

  // Close suggestion dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node)) {
        setShowAutocomplete(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Pre-compiled list of records adhering to active filters
  const filteredRecords = useMemo(() => {
    // Only parse rows where Column G (index 6, Use of timeline) equals "Y"
    const timelineRows = data.filter(row => row[6] && row[6].trim().toUpperCase() === 'Y');

    return timelineRows.filter(row => {
      // 1. Date Range checking
      if (!checkEventDateMatches(row, startDate, endDate)) {
        return false;
      }

      // 2. Category selection check
      if (activityFilter !== 'ALL') {
        const type = String(row[17] || '').trim().toLowerCase();
        if (type !== activityFilter.toLowerCase()) {
          return false;
        }
      }

      // 3. Significance importance checking (equal or greater importance value, or exact match index)
      if (significanceFilter !== 'ALL') {
        const rowSig = String(row[7] || '').trim().toLowerCase();
        const filterSig = significanceFilter.toLowerCase();
        if (significanceMatchType === 'exact') {
          const filterRank = SignificanceRanks[filterSig] ?? -1;
          const currentRank = SignificanceRanks[rowSig] ?? -2;
          if (filterRank !== currentRank) {
            return false;
          }
        } else {
          const filterRank = SignificanceRanks[filterSig] ?? 0;
          const currentRank = SignificanceRanks[rowSig] ?? 0;
          if (currentRank < filterRank) {
            return false;
          }
        }
      }

      // 4. Civilization Tag checking
      const queryCiv = civFilter.trim().toLowerCase();
      if (queryCiv && queryCiv !== 'all') {
        const rowCivsStr = String(row[34] || '').trim().toLowerCase();
        if (!rowCivsStr.includes(queryCiv)) {
          return false;
        }
      }

      return true;
    });
  }, [data, startDate, endDate, activityFilter, significanceFilter, civFilter]);

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

      {/* Main Container screen */}
      <main className="max-w-5xl mx-auto px-6 py-12 flex-grow flex flex-col justify-center">
        <div className="w-full max-w-2xl mx-auto space-y-12">
          
          {/* Header Title Grid */}
          <div className="text-center space-y-4">
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="inline-flex items-center gap-3 px-4 py-1.5 bg-[#FF0500]/10 border border-[#FF0500]/30 rounded-full text-[10px] uppercase tracking-widest text-[#FFB451] font-mono mb-2"
            >
              <BookOpen className="w-3.5 h-3.5 text-red-500" />
              Historical Records Scanner
            </motion.div>
            <h2 className="text-4xl md:text-5xl font-light tracking-tight text-agt-orange">
              AGT History Archive
            </h2>
            <p className="text-agt-orange/60 text-xs uppercase tracking-[0.25em] font-medium max-w-md mx-auto">
              Historical Event Extractor
            </p>
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
                <input
                  type="text"
                  placeholder="DD/MM/YYYY"
                  maxLength={10}
                  value={rawStartDate}
                  onChange={(e) => setRawStartDate(formatToDDMMYYYY(e.target.value, rawStartDate))}
                  className={`w-full bg-[#1c1c1c] border focus:outline-none focus:ring-1 px-3.5 py-2.5 text-xs font-mono text-agt-orange rounded-xl ${
                    rawStartDate && !isRawDateValid(rawStartDate)
                      ? 'border-red-500 focus:border-red-500 focus:ring-red-500/30'
                      : isRawDateComplete(rawStartDate) && isRawDateValid(rawStartDate)
                      ? 'border-emerald-500/60 focus:border-emerald-500 focus:ring-emerald-500/30'
                      : 'border-[#FF0500]/40 hover:border-red-400 focus:border-[#FF0500] focus:ring-[#FF0500]/30'
                  }`}
                />
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
                <input
                  type="text"
                  placeholder="DD/MM/YYYY"
                  maxLength={10}
                  value={rawEndDate}
                  onChange={(e) => setRawEndDate(formatToDDMMYYYY(e.target.value, rawEndDate))}
                  className={`w-full bg-[#1c1c1c] border focus:outline-none focus:ring-1 px-3.5 py-2.5 text-xs font-mono text-agt-orange rounded-xl ${
                    rawEndDate && !isRawDateValid(rawEndDate)
                      ? 'border-red-500 focus:border-red-500 focus:ring-red-500/30'
                      : isRawDateComplete(rawEndDate) && isRawDateValid(rawEndDate)
                      ? 'border-emerald-500/60 focus:border-emerald-500 focus:ring-emerald-500/30'
                      : 'border-[#FF0500]/40 hover:border-red-400 focus:border-[#FF0500] focus:ring-[#FF0500]/30'
                  }`}
                />
              </div>

              {/* Event Category Selector */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase tracking-wider text-agt-orange/60 font-bold">
                  Event Category
                </label>
                <select
                  value={activityFilter}
                  onChange={(e) => setActivityFilter(e.target.value)}
                  className="w-full bg-[#1c1c1c] border border-[#FF0500]/40 hover:border-red-400 focus:border-[#FF0500] focus:outline-none focus:ring-1 focus:ring-[#FF0500] px-3.5 py-2.5 text-xs font-sans text-agt-orange rounded-xl cursor-pointer"
                >
                  <option value="ALL">ALL (Categories)</option>
                  {eventTypeList.map((type, idx) => (
                    <option key={idx} value={type}>{type}</option>
                  ))}
                </select>
              </div>

              {/* Event Significance Selector with Match Type toggle */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase tracking-wider text-agt-orange/60 font-bold">
                    Event Significance
                  </label>
                  
                  {/* Matching mode toggle controller */}
                  <div className="flex gap-1 bg-[#161616] p-0.5 border border-white/5 rounded-md text-[8px] uppercase tracking-wider font-mono">
                    <button
                      type="button"
                      onClick={() => setSignificanceMatchType('threshold')}
                      className={`py-0.5 px-1.5 rounded transition-all font-bold ${
                        significanceMatchType === 'threshold'
                          ? 'bg-red-600 text-white'
                          : 'text-agt-orange/40 hover:text-white'
                      }`}
                      title="Show selected significance and any more important/broader events"
                    >
                      Threshold &amp; Higher
                    </button>
                    <button
                      type="button"
                      onClick={() => setSignificanceMatchType('exact')}
                      className={`py-0.5 px-1.5 rounded transition-all font-bold ${
                        significanceMatchType === 'exact'
                          ? 'bg-red-600 text-white'
                          : 'text-agt-orange/40 hover:text-white'
                      }`}
                      title="Show only records having exactly the selected significance"
                    >
                      Exact Match
                    </button>
                  </div>
                </div>

                <select
                  value={significanceFilter}
                  onChange={(e) => setSignificanceFilter(e.target.value)}
                  className="w-full bg-[#1c1c1c] border border-[#FF0500]/40 hover:border-red-400 focus:border-[#FF0500] focus:outline-none focus:ring-1 focus:ring-[#FF0500] px-3.5 py-2.5 text-xs font-sans text-agt-orange rounded-xl cursor-pointer"
                >
                  <option value="ALL">ALL (Clearance level)</option>
                  {significanceMatchType === 'exact' ? (
                    <>
                      <option value="Era">Era Epochs Only</option>
                      <option value="Epic">Epic Events Only</option>
                      <option value="Major">Major Events Only</option>
                      <option value="Minor">Minor Events Only</option>
                      <option value="Event Detail">Event Details Only</option>
                      <option value="Low">Low Significance Only</option>
                      <option value="Insignificant">Insignificant Only</option>
                    </>
                  ) : (
                    <>
                      <option value="Era">Era Epochs Only</option>
                      <option value="Epic">Epic Events &amp; Higher</option>
                      <option value="Major">Major Events &amp; Higher</option>
                      <option value="Minor">Minor Events &amp; Higher</option>
                      <option value="Event Detail">Event Details &amp; Higher</option>
                      <option value="Low">Low Significance &amp; Higher</option>
                      <option value="Insignificant">Insignificant &amp; Higher</option>
                    </>
                  )}
                </select>
              </div>

              {/* Civilization Autocomplete Filter */}
              <div ref={autocompleteRef} className="flex flex-col gap-2 md:col-span-2 relative">
                <label className="text-[10px] uppercase tracking-wider text-agt-orange/60 font-bold flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5 text-red-500" />
                  Civilization Filter
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search by civilization tag (e.g. Gek, Vy'keen, Korvax - leave blank or 'ALL' for default)"
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
            </div>

            {/* Diagnostics Stats and Clear option */}
            <div className="pt-2 flex flex-wrap items-center justify-between gap-4 text-[10px] uppercase tracking-widest text-agt-orange/50">
              <div className="flex items-center gap-2">
                <span>Historical Records Available:</span>
                <span className="font-mono text-white bg-red-950/40 border border-[#FF0500]/20 px-2 py-0.5 rounded font-bold">
                  {loading ? '...' : sortedEvents.length}
                </span>
              </div>
              
              {/* Reset filter helpers */}
              {(rawStartDate || rawEndDate || activityFilter !== 'ALL' || significanceFilter !== 'ALL' || civFilter) && (
                <button
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                    setRawStartDate('');
                    setRawEndDate('');
                    setActivityFilter('ALL');
                    setSignificanceFilter('ALL');
                    setSignificanceMatchType('threshold');
                    setCivFilter('');
                  }}
                  className="px-4 py-1.5 bg-[#FF0500]/10 border border-[#FF0500] hover:bg-[#FF0500] hover:text-white transition-colors text-white font-bold text-[9px] uppercase tracking-wider rounded-lg cursor-pointer"
                >
                  Clear Scanner Filters
                </button>
              )}
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
                disabled
                className="flex-1 py-4 bg-transparent border-2 border-dashed border-[#FFB451]/20 text-[#FFB451]/30 rounded-full font-bold text-xs uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 cursor-pointer relative group"
                title="Archival telemetry system offline"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Download PDF Export</span>
                
                {/* Floating tooltip indicating this is intentionally dormant */}
                <div className="absolute opacity-0 group-hover:opacity-100 transition-opacity bottom-full mb-2 bg-[#050505] border border-agt-orange/30 text-agt-orange/70 text-[9px] font-bold text-center px-3 py-1.5 rounded-lg w-max shadow-xl pointer-events-none tracking-wider">
                  SYSTEM OFFLINE / EXPORT CORRUPTED OR DORMANT
                </div>
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
              className="relative max-w-md w-full bg-[#161616] border-2 border-[#FF0500] rounded-2xl overflow-hidden glass-card shadow-[0_15px_60px_rgba(255,5,0,0.25)] p-6 z-10"
            >
              <div className="flex items-center justify-between border-b border-[#FF0500]/30 pb-4 mb-6">
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

              <div className="space-y-6">
                {/* Font proportions scaling config */}
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-widest font-black text-agt-orange/50 block">
                    Desktop Frame Text Scale
                  </label>
                  <p className="text-[10px] text-agt-orange/30 italic">Scaling factor of typography inside widescreen environments.</p>
                  <select
                    value={fontScale}
                    onChange={(e) => setFontScale(e.target.value)}
                    className="w-full bg-[#1c1c1c] border border-[#FF0500]/40 focus:outline-none focus:ring-1 focus:ring-[#FF0500] px-3.5 py-2.5 text-xs text-agt-orange rounded-xl cursor-pointer"
                  >
                    <option value="1x">1.0x (Standard)</option>
                    <option value="1.5x">1.5x (Large)</option>
                    <option value="2x">2.0x (Very Large)</option>
                    <option value="2.5x">2.5x (Huge)</option>
                    <option value="3x">3.0x (Extreme)</option>
                  </select>
                </div>

                {/* Ambient music control loop */}
                <div className="pt-4 border-t border-white/5 space-y-3">
                  <h4 className="text-xs uppercase tracking-widest font-black text-agt-orange/50">Ambience Music System</h4>
                  <div className="flex items-center justify-between bg-black/30 p-3 rounded-xl border border-white/5">
                    <div className="text-[10px] uppercase tracking-widest text-agt-orange/30">AGT anthem (Instrumental)</div>
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
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  Chronology Archive Node
                </div>
                <div>
                  Index {currentEventIndex + 1} of {sortedEvents.length}
                </div>
              </div>

              {/* Central text and content element - with scroll capability built-in */}
              <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scrollbar">
                
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
                          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-sans text-agt-orange/50">
                            <MapPin className="w-3.5 h-3.5 text-[#FFB451]/60 shrink-0" />
                            <span>Location: {locationText}</span>
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
                                  <img
                                    src={media.src}
                                    alt={media.caption || `Alliance historical archives render ${mIdx + 1}`}
                                    className="w-full max-h-[380px] object-contain rounded-xl mx-auto"
                                    referrerPolicy="no-referrer"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).style.display = 'none';
                                    }}
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
    </div>
  );
}
