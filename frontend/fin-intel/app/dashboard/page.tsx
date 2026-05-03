"use client";

// ─────────────────────────────────────────────────────────────────────────────
//  FinIntel · Dashboard v4 — Premium Fintech Terminal
//  Aesthetic: Refined dark luxury — inspired by Bloomberg Terminal meets Linear
//  Font strategy: Geist Mono for data, Instrument Serif for hero numbers
// ─────────────────────────────────────────────────────────────────────────────

import {
  Suspense,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import PatternCard from "../../components/ui/PatternCard";
import DecisionPanel from "../../components/ui/DecisionPanel";
import { useRouter, useSearchParams } from "next/navigation";
import {
  motion,
  AnimatePresence,
  useSpring,
  useTransform,
} from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast, { Toaster } from "react-hot-toast";
import {
  Search,
  X,
  Star,
  Bell,
  BarChart2,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  ExternalLink,
  Plus,
  Trash2,
  AlertCircle,
  ChevronDown,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Globe,
  Clock,
  GitCompare,
  Briefcase,
  BellOff,
  CheckCircle2,
  Info,
  Minus,
  ShieldCheck,
  ShieldAlert,
  Newspaper,
  Sparkles,
  BookOpen,
  LogOut,
  Zap,
  Activity,
  MessageSquare,
  Target,
  PieChart,
  Layers,
  Filter,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  TrendingUp as TU,
  Lightbulb,
  Award,
  LayoutDashboard,
  FileText,
} from "lucide-react";
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Filler,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  User as FirebaseUser,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  collection,
  addDoc,
  deleteDoc,
  onSnapshot,
} from "firebase/firestore";

ChartJS.register(
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Filler,
  Legend,
);

// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE
// ─────────────────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};
const firebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig);
const firebaseAuth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const API = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
type View = "analysis" | "portfolio" | "alerts" | "compare" | "reports";
type Period = "1W" | "1M" | "3M" | "6M" | "1Y" | "ALL";
const PERIOD_DAYS: Record<Period, number> = {
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
  ALL: Infinity,
};
const PERIODS: Period[] = ["1W", "1M", "3M", "6M", "1Y", "ALL"];
const COMPARE_COLORS = ["#60a5fa", "#34d399", "#f59e0b", "#c084fc", "#fb7185"];
const POPULAR = [
  "AAPL",
  "NVDA",
  "MSFT",
  "TSLA",
  "RELIANCE.NS",
  "TCS.NS",
  "GOOGL",
  "INFY.NS",
];

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
interface SearchResult {
  symbol: string;
  name?: string;
  exchange?: string;
  type?: string;
}
interface NewsItem {
  id?: string | number;
  title: string;
  text?: string;
  url?: string;
  link?: string;
  source?: string;
  time?: string;
  date?: string;
  sentiment?: "bullish" | "bearish" | "neutral";
}
interface PricePoint {
  date: string;
  close: number;
}
interface PatternInfo {
  pattern?: string;
  confidence?: number;
  trend?: string;
  key_levels?: { support?: number | null; resistance?: number | null };
  lines?: {
    support?: Array<{ x: number; y: number }>;
    resistance?: Array<{ x: number; y: number }>;
  };
}
interface PredictionInfo {
  sequence?: number[];
  forecast_close?: number[];
  confidence?: { score?: number };
  future_dates?: string[];
}
interface StockData {
  symbol: string;
  name?: string;
  company_name?: string;
  sector?: string;
  industry?: string;
  website?: string;
  currency?: string;
  prices: PricePoint[];
  final_score: number;
  sentiment_score: number;
  risk_score?: number;
  technical_score: number;
  fundamental_score?: number;
  technical_signal?: string;
  decision?: string;
  explanation: string;
  pattern?: PatternInfo;
  prediction?: PredictionInfo;
  cached?: boolean;
  generated_at?: number;
  fundamentals: {
    roe?: number | null;
    debt_equity?: number | null;
    revenue_growth?: number | null;
    profit_margin?: number | null;
    market_cap?: number | null;
    pe_ratio?: number | null;
    eps?: number | null;
    beta?: number | null;
    dividend_yield?: number | null;
    avg_volume?: number | null;
    sector?: string | null;
    industry?: string | null;
    name?: string | null;
    website?: string | null;
    "52w_high"?: number | null;
    "52w_low"?: number | null;
  };
}
interface PortfolioHolding {
  id?: string;
  symbol: string;
  quantity: number;
  price: number;
  current_price?: number;
  pnl?: number;
  pnl_percent?: number;
  added_at?: number;
  companyName?: string;
}
interface AlertItem {
  id?: string;
  symbol: string;
  target_price: number;
  condition: "above" | "below";
  triggered?: boolean;
  created_at?: number;
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────
function cs(symbol: string, currency?: string | null): string {
  const s = symbol.toUpperCase();
  if (currency === "INR" || s.endsWith(".NS") || s.endsWith(".BO")) return "₹";
  if (currency === "EUR") return "€";
  if (currency === "GBP") return "£";
  return "$";
}
function fmtN(
  n: number | null | undefined,
  type = "num",
  pfx = "",
  dec = 2,
): string {
  if (n == null || isNaN(n) || !isFinite(n)) return "—";
  if (type === "large") {
    if (Math.abs(n) >= 1e12) return `${pfx}${(n / 1e12).toFixed(1)}T`;
    if (Math.abs(n) >= 1e9) return `${pfx}${(n / 1e9).toFixed(1)}B`;
    if (Math.abs(n) >= 1e6) return `${pfx}${(n / 1e6).toFixed(1)}M`;
    return `${pfx}${n.toLocaleString()}`;
  }
  if (type === "pct") return `${n > 0 ? "+" : ""}${n.toFixed(dec)}%`;
  return `${pfx}${n.toFixed(dec)}`;
}
function fmtDate(raw?: string): string {
  if (!raw) return "";
  try {
    const d = new Date(raw),
      h = Math.floor((Date.now() - d.getTime()) / 3_600_000);
    if (h < 1) return "Just now";
    if (h < 24) return `${h}h ago`;
    const dd = Math.floor(h / 24);
    if (dd < 7) return `${dd}d ago`;
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch {
    return raw;
  }
}
type SentimentValue = "bullish" | "bearish" | "neutral";
function normSentiment(s?: string | null): SentimentValue | undefined {
  if (!s) return undefined;
  const l = s.toLowerCase();
  if (l.includes("bull") || l === "positive") return "bullish";
  if (l.includes("bear") || l === "negative") return "bearish";
  if (l === "neutral") return "neutral";
  return undefined;
}
function useDebounce<T>(v: T, ms: number): T {
  const [dv, setDv] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setDv(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return dv;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE HOOKS
// ─────────────────────────────────────────────────────────────────────────────
function useFirebaseAuth() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const u = onAuthStateChanged(firebaseAuth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return u;
  }, []);
  const signIn = useCallback(async () => {
    try {
      await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
      toast.success("Welcome back!");
    } catch (e: any) {
      toast.error(e.message || "Sign in failed");
    }
  }, []);
  const signOutUser = useCallback(async () => {
    await signOut(firebaseAuth);
    toast.success("Signed out");
  }, []);
  return { user, loading, signIn, signOut: signOutUser };
}
function useWatchlist(uid?: string) {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    if (!uid) {
      setList([]);
      return;
    }
    return onSnapshot(doc(db, "users", uid), (s) => {
      if (s.exists()) setList(s.data().watchlist || []);
    });
  }, [uid]);
  const toggle = useCallback(
    async (sym: string) => {
      if (!uid) {
        toast.error("Sign in to use watchlist");
        return;
      }
      const ref = doc(db, "users", uid);
      const snap = await getDoc(ref);
      const cur: string[] = snap.exists() ? snap.data().watchlist || [] : [];
      if (cur.includes(sym)) {
        await setDoc(ref, { watchlist: arrayRemove(sym) }, { merge: true });
        toast.success(`Removed ${sym}`);
      } else {
        await setDoc(ref, { watchlist: arrayUnion(sym) }, { merge: true });
        toast.success(`Added ${sym}`);
      }
    },
    [uid],
  );
  return { list, toggle };
}
function useFirestorePortfolio(uid?: string) {
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!uid) {
      setHoldings([]);
      return;
    }
    setLoading(true);
    return onSnapshot(collection(db, "users", uid, "portfolio"), (s) => {
      setHoldings(
        s.docs.map((d) => ({ id: d.id, ...d.data() }) as PortfolioHolding),
      );
      setLoading(false);
    });
  }, [uid]);
  const add = useCallback(
    async (h: Omit<PortfolioHolding, "id">) => {
      if (!uid) {
        toast.error("Sign in first");
        return;
      }
      await addDoc(collection(db, "users", uid, "portfolio"), {
        ...h,
        added_at: Date.now(),
      });
      await fetch(`${API}/portfolio/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: h.symbol,
          quantity: h.quantity,
          price: h.price,
        }),
      }).catch(() => {});
    },
    [uid],
  );
  const remove = useCallback(
    async (id: string, symbol: string) => {
      if (!uid) return;
      await deleteDoc(doc(db, "users", uid, "portfolio", id));
      await fetch(`${API}/portfolio/remove/${symbol}`, {
        method: "DELETE",
      }).catch(() => {});
      toast.success(`Removed ${symbol}`);
    },
    [uid],
  );
  return { holdings, loading, add, remove };
}
function useFirestoreAlerts(uid?: string) {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!uid) {
      setAlerts([]);
      return;
    }
    setLoading(true);
    return onSnapshot(collection(db, "users", uid, "alerts"), (s) => {
      setAlerts(s.docs.map((d) => ({ id: d.id, ...d.data() }) as AlertItem));
      setLoading(false);
    });
  }, [uid]);
  const add = useCallback(
    async (a: Omit<AlertItem, "id">) => {
      if (!uid) {
        toast.error("Sign in first");
        return;
      }
      await addDoc(collection(db, "users", uid, "alerts"), {
        ...a,
        triggered: false,
        created_at: Date.now(),
      });
      toast.success(`Alert set for ${a.symbol}`);
    },
    [uid],
  );
  const remove = useCallback(
    async (id: string) => {
      if (!uid) return;
      await deleteDoc(doc(db, "users", uid, "alerts", id));
      toast.success("Alert removed");
    },
    [uid],
  );
  return { alerts, loading, add, remove };
}

// ─────────────────────────────────────────────────────────────────────────────
// MICRO-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

/** Animated skeleton shimmer */
const Sk = ({ className = "" }: { className?: string }) => (
  <div
    className={`relative overflow-hidden rounded-xl bg-[#ffffff08] ${className}`}
  >
    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
  </div>
);

/** Stock logo with initials fallback */
const Logo = ({ symbol, size = 9 }: { symbol: string; size?: number }) => {
  const [err, setErr] = useState(false);
  const clean = symbol.split(".")[0].split("-")[0].toLowerCase();
  const dim =
    size <= 7
      ? "w-7 h-7"
      : size <= 9
        ? "w-9 h-9"
        : size <= 10
          ? "w-10 h-10"
          : "w-12 h-12";
  if (err)
    return (
      <div
        className={`${dim} rounded-2xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-white/10 flex items-center justify-center text-[11px] font-black text-blue-400 shrink-0`}
      >
        {symbol.slice(0, 2).toUpperCase()}
      </div>
    );
  return (
    <img
      src={`https://logo.clearbit.com/${clean}.com`}
      alt={symbol}
      onError={() => setErr(true)}
      className={`${dim} rounded-2xl object-contain shrink-0 border border-white/[0.06] bg-white p-0.5`}
    />
  );
};

/** Pill tag */
const Tag = ({
  children,
  color = "slate",
}: {
  children: React.ReactNode;
  color?: string;
}) => {
  const c: Record<string, string> = {
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    red: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    slate: "bg-white/[0.04] text-gray-500 border-white/[0.07]",
  };
  return (
    <span
      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-widest whitespace-nowrap ${c[color] ?? c.slate}`}
    >
      {children}
    </span>
  );
};

const SentimentTag = ({ s }: { s?: string }) => {
  const n = normSentiment(s);
  if (!n) return null;
  const map = { bullish: "green", bearish: "red", neutral: "amber" } as const;
  return <Tag color={map[n]}>{n}</Tag>;
};

/** Animated progress bar */
const Bar = ({
  value,
  color = "bg-blue-500",
  h = "h-1",
}: {
  value: number;
  color?: string;
  h?: string;
}) => (
  <div className={`w-full bg-white/[0.04] ${h} rounded-full overflow-hidden`}>
    <motion.div
      initial={{ width: 0 }}
      animate={{ width: `${Math.max(0, Math.min(100, (value || 0) * 100))}%` }}
      transition={{ duration: 1, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={`${h} rounded-full ${color}`}
    />
  </div>
);

/** Mini sparkline SVG */
const Sparkline = ({ data, up }: { data: number[]; up: boolean }) => {
  if (!data?.length) return null;
  const max = Math.max(...data),
    min = Math.min(...data),
    range = max - min || 1;
  const pts = data
    .map(
      (d, i) =>
        `${(i / (data.length - 1)) * 100},${100 - ((d - min) / range) * 100}`,
    )
    .join(" ");
  const area = `M ${pts.split(" ").join(" L ")} L 100,100 L 0,100 Z`;
  const c = up ? "#34d399" : "#fb7185";
  return (
    <svg
      viewBox="0 0 100 100"
      className="w-16 h-8 overflow-visible"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={`sg-${up}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity="0.25" />
          <stop offset="100%" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${up})`} />
      <polyline
        points={pts}
        fill="none"
        stroke={c}
        strokeWidth="5"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

/** Circular score ring */
const ScoreRing = ({
  score,
  size = 80,
  stroke = 6,
  color,
}: {
  score: number;
  size?: number;
  stroke?: number;
  color: string;
}) => {
  const r = size / 2 - stroke,
    circ = 2 * Math.PI * r,
    offset = circ - circ * (score || 0);
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.05)"
        strokeWidth={stroke}
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1.2, ease: [0.25, 0.46, 0.45, 0.94] }}
      />
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS LOADER
// ─────────────────────────────────────────────────────────────────────────────
const AnalysisLoader = ({ symbol }: { symbol: string }) => {
  const steps = [
    "Fetching market data",
    "Running technical model",
    "Scoring news sentiment",
    "Analysing fundamentals",
    "Fusing AI signals",
  ];
  const icons = ["📡", "📊", "📰", "🏦", "🤖"];
  const [step, setStep] = useState(0);
  useEffect(() => {
    const ids = steps.map((_, i) =>
      setTimeout(() => setStep(i + 1), (i + 1) * 700),
    );
    return () => ids.forEach(clearTimeout);
  }, []);
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-10">
      <div className="relative">
        <div className="w-28 h-28 rounded-full border border-white/5 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border-2 border-t-blue-500/80 border-r-blue-500/20 border-b-transparent border-l-transparent animate-spin" />
          <div
            className="absolute inset-2 rounded-full border-2 border-t-transparent border-r-transparent border-b-indigo-400/60 border-l-indigo-400/20 animate-spin"
            style={{ animationDuration: "0.7s", animationDirection: "reverse" }}
          />
          <Logo symbol={symbol} size={10} />
        </div>
      </div>
      <div className="text-center">
        <p className="text-2xl font-black tracking-tight mb-1">
          Analysing <span className="text-blue-400">{symbol}</span>
        </p>
        <p className="text-[13px] text-gray-600 font-medium">
          Multi-model AI pipeline running…
        </p>
      </div>
      <div className="space-y-2.5 w-72">
        {steps.map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: i < step ? 1 : 0.2, x: 0 }}
            transition={{ delay: i * 0.12 }}
            className="flex items-center gap-3"
          >
            <span className="text-base">{icons[i]}</span>
            <span
              className={`text-[13px] font-semibold flex-1 ${i < step ? "text-white" : "text-gray-700"}`}
            >
              {s}
            </span>
            {i < step && (
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                <CheckCircle2 size={14} className="text-emerald-400" />
              </motion.div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// HERO SECTION  — Command-centre first fold
// ─────────────────────────────────────────────────────────────────────────────
function HeroSection({
  stock,
  news,
  onAddPortfolio,
  onToggleWatchlist,
  inWatchlist,
}: {
  stock: StockData;
  news: NewsItem[];
  onAddPortfolio: () => void;
  onToggleWatchlist: (s: string) => void;
  inWatchlist: boolean;
}) {
  const cur = stock.prices?.at(-1)?.close;
  const prev = stock.prices?.at(-2)?.close;
  const dayChg = cur && prev ? ((cur - prev) / prev) * 100 : null;
  const csym = cs(stock.symbol, stock.currency);
  const score = stock.final_score || 0;
  const decision =
    stock.decision || (score >= 0.68 ? "BUY" : score < 0.38 ? "SELL" : "HOLD");
  const isUp = dayChg != null ? dayChg >= 0 : score >= 0.5;
  const companyName =
    stock.name || stock.fundamentals.name || stock.company_name || stock.symbol;

  const sparkData = stock.prices?.slice(-20).map((p) => p.close) || [];
  const decColor = decision.includes("BUY")
    ? "text-emerald-400"
    : decision.includes("SELL")
      ? "text-rose-400"
      : "text-amber-400";
  const decBg = decision.includes("BUY")
    ? "from-emerald-500/10 to-emerald-500/5 border-emerald-500/15"
    : decision.includes("SELL")
      ? "from-rose-500/10 to-rose-500/5 border-rose-500/15"
      : "from-amber-500/10 to-amber-500/5 border-amber-500/15";
  const ringColor = decision.includes("BUY")
    ? "#34d399"
    : decision.includes("SELL")
      ? "#fb7185"
      : "#f59e0b";

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0e1117] to-[#0a0c10] border border-white/[0.06] p-8 mb-5">
      {/* ambient glow */}
      <div
        className={`absolute -top-20 -right-20 w-64 h-64 rounded-full blur-[80px] opacity-20 ${isUp ? "bg-emerald-500" : "bg-rose-500"}`}
      />
      <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full blur-[80px] opacity-10 bg-blue-500" />

      <div className="relative z-10">
        {/* Top row */}
        <div className="flex items-start justify-between gap-6 mb-8 flex-wrap">
          <div className="flex items-start gap-4">
            <Logo symbol={stock.symbol} size={12} />
            <div>
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <h1 className="text-3xl font-black tracking-tight">
                  {stock.symbol}
                </h1>
                <Tag color="slate">
                  {stock.sector || stock.fundamentals.sector || "Equity"}
                </Tag>
                {stock.cached && <Tag color="blue">⚡ Cached</Tag>}
              </div>
              <p className="text-gray-400 text-sm font-medium">
                {companyName !== stock.symbol ? companyName : ""}
              </p>
              {(stock.website || stock.fundamentals.website) && (
                <a
                  href={stock.website || stock.fundamentals.website!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-blue-400/60 hover:text-blue-400 flex items-center gap-1 mt-1 transition-colors w-fit"
                >
                  <Globe size={10} /> Website
                </a>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onAddPortfolio}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-500 font-bold text-sm transition-all shadow-lg shadow-blue-500/20"
            >
              <Plus size={14} /> Portfolio
            </button>
            <button
              onClick={() => onToggleWatchlist(stock.symbol)}
              className={`w-10 h-10 rounded-2xl border flex items-center justify-center transition-all ${inWatchlist ? "bg-yellow-500/10 border-yellow-500/20" : "bg-white/[0.04] border-white/[0.07] hover:border-white/20"}`}
            >
              <Star
                size={14}
                className={
                  inWatchlist
                    ? "text-yellow-400 fill-yellow-400"
                    : "text-gray-500"
                }
              />
            </button>
          </div>
        </div>

        {/* Price + verdict + sparkline */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-center">
          {/* Price block */}
          <div className="lg:col-span-2">
            <div className="flex items-end gap-4 mb-3">
              {cur != null && !isNaN(cur) && (
                <span
                  className="text-6xl font-black tracking-tight leading-none"
                  style={{ fontFeatureSettings: '"tnum"' }}
                >
                  {csym}
                  {cur.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              )}
              {dayChg != null && !isNaN(dayChg) && (
                <div
                  className={`flex items-center gap-1.5 text-xl font-black mb-1 ${isUp ? "text-emerald-400" : "text-rose-400"}`}
                >
                  {isUp ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                  {dayChg >= 0 ? "+" : ""}
                  {dayChg.toFixed(2)}%
                  <span className="text-[12px] text-gray-600 font-normal ml-1">
                    today
                  </span>
                </div>
              )}
            </div>

            {/* 52W range mini */}
            {stock.fundamentals["52w_low"] &&
              stock.fundamentals["52w_high"] &&
              cur && (
                <div className="mb-5">
                  <div className="flex items-center justify-between text-[11px] text-gray-600 mb-1.5">
                    <span>
                      52W Low {csym}
                      {stock.fundamentals["52w_low"]?.toFixed(2)}
                    </span>
                    <span>
                      52W High {csym}
                      {stock.fundamentals["52w_high"]?.toFixed(2)}
                    </span>
                  </div>
                  <div className="relative h-1.5 bg-white/[0.05] rounded-full">
                    <div className="absolute inset-0 bg-gradient-to-r from-rose-500/50 via-amber-500/50 to-emerald-500/50 rounded-full" />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full border-2 border-blue-500 shadow-md shadow-blue-500/40 z-10"
                      style={{
                        left: `${Math.max(0, Math.min(100, ((cur - (stock.fundamentals["52w_low"] || 0)) / ((stock.fundamentals["52w_high"] || 1) - (stock.fundamentals["52w_low"] || 0))) * 100))}%`,
                        transform: "translateY(-50%) translateX(-50%)",
                      }}
                    />
                  </div>
                </div>
              )}

            {/* Key stats strip */}
            <div className="grid grid-cols-4 gap-3">
              {[
                {
                  l: "Market Cap",
                  v: fmtN(stock.fundamentals.market_cap, "large", csym),
                },
                {
                  l: "P/E Ratio",
                  v: stock.fundamentals.pe_ratio
                    ? `${stock.fundamentals.pe_ratio.toFixed(1)}x`
                    : "—",
                },
                {
                  l: "EPS",
                  v: stock.fundamentals.eps
                    ? `${csym}${stock.fundamentals.eps.toFixed(2)}`
                    : "—",
                },
                {
                  l: "Beta",
                  v: stock.fundamentals.beta?.toFixed(2) || "—",
                  c: stock.fundamentals.beta
                    ? stock.fundamentals.beta > 1.5
                      ? "text-rose-400"
                      : stock.fundamentals.beta < 0.8
                        ? "text-emerald-400"
                        : "text-amber-400"
                    : "text-gray-400",
                },
              ].map((s) => (
                <div
                  key={s.l}
                  className="bg-white/[0.03] border border-white/[0.05] rounded-xl p-2.5"
                >
                  <p className="text-[9px] text-gray-600 uppercase font-bold tracking-widest mb-1">
                    {s.l}
                  </p>
                  <p
                    className={`text-sm font-black ${(s as any).c || "text-white"}`}
                  >
                    {s.v}
                  </p>
                </div>
              ))}
            </div>
            {/* Predictions (moved here): short/long/overall */}
            <div className="mt-4">
              <DecisionPanel decision={stock.decision_details} />
            </div>
          </div>

          {/* AI Verdict + confidence ring */}
          <div
            className={`flex flex-col items-center gap-4 p-6 rounded-2xl bg-gradient-to-b ${decBg} border`}
          >
            <div className="relative">
              <ScoreRing
                score={score}
                size={100}
                stroke={7}
                color={ringColor}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                  Score
                </span>
                <span className="text-2xl font-black">
                  {(score * 100).toFixed(0)}
                </span>
              </div>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">
                AI Decision
              </p>
              <p className={`text-3xl font-black ${decColor}`}>
                {decision.split(" ")[0]}
              </p>
              {decision.includes(" ") && (
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {decision.slice(decision.indexOf(" ") + 1)}
                </p>
              )}
            </div>
            <div className="w-full space-y-2 text-[11px]">
              {[
                {
                  l: "Technical",
                  v: stock.technical_score || 0,
                  c: "bg-blue-500",
                },
                {
                  l: "Sentiment",
                  v: stock.sentiment_score || 0,
                  c: "bg-emerald-500",
                },
                {
                  l: "Fundamental",
                  v: stock.fundamental_score || 0,
                  c: "bg-purple-500",
                },
              ].map((s) => (
                <div key={s.l}>
                  <div className="flex justify-between text-gray-500 mb-1">
                    <span>{s.l}</span>
                    <span className="text-white font-bold">
                      {(s.v * 100).toFixed(0)}%
                    </span>
                  </div>
                  <Bar value={s.v} color={s.c} h="h-1" />
                </div>
              ))}
            </div>

            <PatternCard pattern={stock.pattern} prediction={stock.prediction} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICE CHART
// ─────────────────────────────────────────────────────────────────────────────
function PriceChart({
  data,
  symbol,
  csym,
  pattern,
  prediction,
}: {
  data: PricePoint[];
  symbol: string;
  csym: string;
  pattern?: PatternInfo;
  prediction?: PredictionInfo;
}) {
  const [period, setPeriod] = useState<Period>("3M");

  const filtered = useMemo(() => {
    if (!data?.length) return [];
    if (period === "ALL") return data;
    const cut = new Date();
    cut.setDate(cut.getDate() - PERIOD_DAYS[period]);
    return data.filter((d) => new Date(d.date) >= cut);
  }, [data, period]);

  const { isUp, chgPct } = useMemo(() => {
    if (filtered.length < 2) return { isUp: true, chgPct: 0 };
    const f = filtered[0].close;
    const l = filtered.at(-1)!.close;
    return { isUp: l >= f, chgPct: ((l - f) / f) * 100 };
  }, [filtered]);

  if (!data?.length)
    return (
      <div className="bg-[#0a0c10] border border-white/[0.06] rounded-2xl h-64 flex items-center justify-center text-gray-700 text-sm">
        No price data
      </div>
    );

  const lc = isUp ? "#34d399" : "#fb7185";
  const histLabels = filtered.map((d) =>
    new Date(d.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  );

  const forecastValues = (prediction?.forecast_close || []).filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n),
  );
  const forecastDates = prediction?.future_dates || [];
  const futureLabels = forecastValues.map((_, idx) => {
    const raw = forecastDates[idx];
    if (raw) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      }
    }
    return `F+${idx + 1}`;
  });

  const labels = [...histLabels, ...futureLabels];
  const historySeries = [
    ...filtered.map((d) => d.close),
    ...Array(forecastValues.length).fill(null),
  ];

  const lastClose = filtered.at(-1)?.close;
  const forecastSeries =
    forecastValues.length > 0 && typeof lastClose === "number"
      ? [
          ...Array(Math.max(filtered.length - 1, 0)).fill(null),
          lastClose,
          ...forecastValues,
        ]
      : [];

  // Helper: compute line series from trendline coordinates
  const computeLineSeries = (
    lineCoords?: Array<{ x: number; y: number }>,
    totalLength?: number,
    startIndex = 0,
  ): number[] => {
    if (!lineCoords || !Array.isArray(lineCoords) || lineCoords.length < 2 || !totalLength) {
      return [];
    }
    const first = lineCoords[0];
    const last = lineCoords[lineCoords.length - 1];
    if (first.x === last.x) return [];
    
    // Fit line through two points: y = mx + b
    const m = (last.y - first.y) / (last.x - first.x);
    const b = first.y - m * first.x;
    
    // Compute y value for each chart index mapped to the source series index
    return Array.from({ length: totalLength }, (_, i) => m * (startIndex + i) + b);
  };

  const visibleStartIndex = Math.max(data.length - filtered.length, 0);

  const supportSeries = pattern?.lines?.support
    ? computeLineSeries(pattern.lines.support, labels.length, visibleStartIndex)
    : [];

  const resistanceSeries = pattern?.lines?.resistance
    ? computeLineSeries(pattern.lines.resistance, labels.length, visibleStartIndex)
    : [];

  const cd = {
    labels,
    datasets: [
      {
        label: "Price",
        data: historySeries,
        borderColor: lc,
        backgroundColor: (ctx: any) => {
          const g = ctx.chart.canvas
            .getContext("2d")
            .createLinearGradient(0, 0, 0, 280);
          g.addColorStop(
            0,
            isUp ? "rgba(52,211,153,0.15)" : "rgba(251,113,133,0.15)",
          );
          g.addColorStop(1, "rgba(0,0,0,0)");
          return g;
        },
        fill: true,
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: lc,
        pointHoverBorderColor: "#fff",
        pointHoverBorderWidth: 2,
      },
      ...(forecastSeries.length
        ? [
            {
              label: "Forecast",
              data: forecastSeries,
              borderColor: "#f59e0b",
              backgroundColor: "rgba(0,0,0,0)",
              fill: false,
              borderWidth: 2,
              borderDash: [6, 5],
              tension: 0.25,
              pointRadius: (ctx: any) =>
                ctx.dataIndex >= filtered.length - 1 ? 2.5 : 0,
              pointHoverRadius: 4,
              pointHoverBackgroundColor: "#f59e0b",
              pointHoverBorderColor: "#fff",
              pointHoverBorderWidth: 1,
            },
          ]
        : []),
      ...(supportSeries.length
        ? [
            {
              label: "Support",
              data: supportSeries,
              borderColor: "rgba(96,165,250,0.8)",
              backgroundColor: "rgba(0,0,0,0)",
              fill: false,
              borderWidth: 1.4,
              borderDash: [3, 3],
              tension: 0,
              pointRadius: 0,
            },
          ]
        : []),
      ...(resistanceSeries.length
        ? [
            {
              label: "Resistance",
              data: resistanceSeries,
              borderColor: "rgba(251,113,133,0.85)",
              backgroundColor: "rgba(0,0,0,0)",
              fill: false,
              borderWidth: 1.4,
              borderDash: [3, 3],
              tension: 0,
              pointRadius: 0,
            },
          ]
        : []),
    ],
  };

  return (
    <div className="bg-[#0a0c10] border border-white/[0.06] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <p className="text-[10px] text-gray-600 uppercase font-semibold tracking-wider">
            {symbol} Price History
          </p>
          {filtered.length > 0 && (
            <div className="flex items-baseline gap-2 mt-0.5">
              <span
                className="text-xl font-black"
                style={{ fontFeatureSettings: '"tnum"' }}
              >
                {csym}
                {filtered
                  .at(-1)!
                  .close.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
              <span
                className={`flex items-center gap-1 text-sm font-bold ${isUp ? "text-emerald-400" : "text-rose-400"}`}
              >
                {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {chgPct >= 0 ? "+" : ""}
                {chgPct.toFixed(2)}%
                <span className="text-gray-600 text-[11px] font-normal">
                  ({period})
                </span>
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.05] rounded-xl p-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all ${period === p ? "bg-white/10 text-white" : "text-gray-600 hover:text-gray-300"}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px]">
        <span className="px-2 py-0.5 rounded-full bg-white/[0.03] border border-white/[0.06] text-gray-400">
          Price
        </span>
        {forecastSeries.length > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-300">
            Transformer Forecast ({forecastValues.length}d)
          </span>
        )}
        {supportSeries.length > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/25 text-blue-300">
            Support
          </span>
        )}
        {resistanceSeries.length > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/25 text-rose-300">
            Resistance
          </span>
        )}
      </div>
      <div style={{ height: 260 }}>
        <Line
          data={cd}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: "#0f1117",
                borderColor: "rgba(255,255,255,0.08)",
                borderWidth: 1,
                padding: 12,
                titleColor: "#6b7280",
                bodyColor: "#fff",
                displayColors: false,
                callbacks: {
                  title: (i: any[]) => i[0]?.label,
                  label: (i: any) =>
                    `${csym}${i.parsed.y >= 1000 ? i.parsed.y.toLocaleString("en-US", { minimumFractionDigits: 2 }) : i.parsed.y.toFixed(2)}`,
                },
              },
            },
            scales: {
              x: {
                grid: { display: false },
                border: { display: false },
                ticks: {
                  color: "#374151",
                  maxTicksLimit: 7,
                  font: { size: 10 },
                  maxRotation: 0,
                },
              },
              y: {
                grid: { color: "rgba(255,255,255,0.025)" },
                border: { display: false },
                position: "right",
                ticks: {
                  color: "#374151",
                  font: { size: 10 },
                  callback: (v: any) =>
                    v >= 1000
                      ? `${csym}${(v / 1000).toFixed(1)}k`
                      : `${csym}${v}`,
                },
              },
            },
            interaction: { mode: "index", intersect: false },
          }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNDAMENTALS GRID
// ─────────────────────────────────────────────────────────────────────────────
function FundamentalsGrid({
  data,
  csym,
}: {
  data: StockData["fundamentals"];
  csym: string;
}) {
  const getColor = (v: number, type: string) => {
    if (isNaN(v)) return "text-gray-400";
    if (type === "debt")
      return v < 1
        ? "text-emerald-400"
        : v < 2
          ? "text-amber-400"
          : "text-rose-400";
    if (type === "beta")
      return v < 0.8
        ? "text-emerald-400"
        : v < 1.5
          ? "text-amber-400"
          : "text-rose-400";
    if (type === "pe")
      return v < 20
        ? "text-emerald-400"
        : v < 35
          ? "text-amber-400"
          : "text-rose-400";
    return v > 15
      ? "text-emerald-400"
      : v > 5
        ? "text-amber-400"
        : v > 0
          ? "text-gray-300"
          : "text-rose-400";
  };
  const metrics = [
    {
      l: "ROE",
      v: data.roe,
      s: "%",
      t: "roe",
      tip: "Return on Equity. >15% is healthy.",
    },
    {
      l: "Debt / Equity",
      v: data.debt_equity,
      s: "x",
      t: "debt",
      tip: "Leverage ratio. <1 is ideal.",
    },
    {
      l: "Rev. Growth",
      v: data.revenue_growth,
      s: "%",
      t: "growth",
      tip: "YoY revenue growth rate.",
    },
    {
      l: "Net Margin",
      v: data.profit_margin,
      s: "%",
      t: "margin",
      tip: "Net income as % of revenue.",
    },
    {
      l: "P/E",
      v: data.pe_ratio,
      s: "x",
      t: "pe",
      tip: "Price-to-Earnings ratio.",
    },
    {
      l: "EPS",
      v: data.eps,
      p: csym,
      t: "eps",
      tip: "Earnings per share (TTM).",
    },
    {
      l: "Beta",
      v: data.beta,
      s: "",
      t: "beta",
      tip: ">1 = more volatile than market.",
    },
    {
      l: "Div. Yield",
      v: data.dividend_yield != null ? data.dividend_yield * 100 : null,
      s: "%",
      t: "div",
      tip: "Annual dividend as % of price.",
    },
  ];
  if (!metrics.some((m) => m.v != null)) return null;
  return (
    <div className="bg-[#0a0c10] border border-white/[0.06] rounded-2xl p-5">
      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-4 flex items-center gap-2">
        <PieChart size={11} className="text-purple-400" /> Fundamentals
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {metrics.map((m, i) => (
          <motion.div
            key={m.l}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            title={m.tip}
            className="group p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.05] hover:border-white/[0.08] transition-all cursor-help"
          >
            <p className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider mb-1.5">
              {m.l}
            </p>
            <p
              className={`text-base font-black ${m.v != null && !isNaN(m.v) ? getColor(m.v, m.t) : "text-gray-700"}`}
            >
              {m.v != null && !isNaN(m.v)
                ? `${(m as any).p ?? ""} ${m.v.toFixed(2)}${m.s ?? ""}`
                : "—"}
            </p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI NARRATIVE FEED  — "Why is this stock moving?"
// ─────────────────────────────────────────────────────────────────────────────
function NarrativeFeed({
  news,
  stock,
}: {
  news: NewsItem[];
  stock: StockData;
}) {
  const items = useMemo(() => {
    const out: {
      icon: string;
      title: string;
      body: string;
      tag: string;
      tagColor: string;
      time?: string;
    }[] = [];
    const signal = (
      stock.technical_signal ||
      stock.decision ||
      "HOLD"
    ).toUpperCase();
    const sent = stock.sentiment_score || 0.5;

    news.slice(0, 4).forEach((n) => {
      const s = normSentiment(n.sentiment);
      out.push({
        icon: s === "bullish" ? "📈" : s === "bearish" ? "📉" : "📰",
        title: n.title,
        body: n.text?.slice(0, 140) || "",
        tag: s === "bullish" ? "Catalyst" : s === "bearish" ? "Risk" : "News",
        tagColor: s === "bullish" ? "green" : s === "bearish" ? "red" : "blue",
        time: fmtDate(n.date || n.time),
      });
    });

    if (signal.includes("BUY"))
      out.push({
        icon: "⚡",
        title: "Bullish Technical Momentum",
        body: "MA crossover confirmed — price is trading above key moving averages with positive RSI divergence.",
        tag: "Technical",
        tagColor: "blue",
      });
    else if (signal.includes("SELL"))
      out.push({
        icon: "⚠️",
        title: "Bearish Technical Pressure",
        body: "Price below key support levels. Oscillators show negative momentum.",
        tag: "Technical",
        tagColor: "red",
      });

    if (sent > 0.7)
      out.push({
        icon: "🔥",
        title: "Positive Sentiment Surge",
        body: "High volume of positive news coverage driving bullish investor sentiment around this stock.",
        tag: "Sentiment",
        tagColor: "amber",
      });
    else if (sent < 0.3)
      out.push({
        icon: "❄️",
        title: "Negative Sentiment Pressure",
        body: "Negative news flow weighing on investor confidence and short-term price action.",
        tag: "Sentiment",
        tagColor: "red",
      });

    const f = stock.fundamentals;
    if (f.roe && f.roe > 20)
      out.push({
        icon: "💎",
        title: `Strong ROE of ${f.roe.toFixed(1)}%`,
        body: "Efficient capital utilisation well above sector average signals strong management quality.",
        tag: "Fundamental",
        tagColor: "purple",
      });
    return out.slice(0, 6);
  }, [news, stock]);

  if (!items.length) return null;
  return (
    <div className="bg-[#0a0c10] border border-white/[0.06] rounded-2xl p-5">
      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-4 flex items-center gap-2">
        <Lightbulb size={11} className="text-amber-400" /> Why is {stock.symbol}{" "}
        moving?
      </p>
      <div className="space-y-2.5">
        {items.map((item, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06 }}
            className="flex gap-3 p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] hover:border-white/[0.07] transition-all group"
          >
            <span className="text-lg shrink-0 mt-0.5">{item.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-white mb-0.5 leading-snug line-clamp-1">
                {item.title}
              </p>
              {item.body && (
                <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-2">
                  {item.body}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <Tag color={item.tagColor as any}>{item.tag}</Tag>
              {item.time && (
                <span className="text-[10px] text-gray-700">{item.time}</span>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NEWS PANEL  — tabbed, impact-scored
// ─────────────────────────────────────────────────────────────────────────────
function NewsPanel({
  news,
  sentimentScore,
}: {
  news: NewsItem[];
  sentimentScore?: number;
}) {
  const [tab, setTab] = useState<"latest" | "impactful">("latest");
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(() => {
    if (tab === "impactful") {
      return [...news].sort((a, b) => {
        const sa = normSentiment(a.sentiment),
          sb = normSentiment(b.sentiment);
        const w = (s?: SentimentValue) =>
          s === "bullish" ? 3 : s === "bearish" ? 2 : 1;
        return w(sb) - w(sa);
      });
    }
    return news;
  }, [news, tab]);

  const shown = expanded ? sorted : sorted.slice(0, 5);

  return (
    <div className="bg-[#0a0c10] border border-white/[0.06] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest flex items-center gap-1.5">
            <Newspaper size={11} className="text-blue-400" /> Related News
          </p>
          {sentimentScore != null && (
            <span
              className={`text-[10px] font-bold ${sentimentScore > 0.6 ? "text-emerald-400" : sentimentScore < 0.4 ? "text-rose-400" : "text-amber-400"}`}
            >
              {(sentimentScore * 100).toFixed(0)}%{" "}
              {sentimentScore > 0.6
                ? "Positive"
                : sentimentScore < 0.4
                  ? "Negative"
                  : "Neutral"}
            </span>
          )}
        </div>
        <div className="flex gap-1 bg-white/[0.03] border border-white/[0.05] rounded-xl p-0.5">
          {(["latest", "impactful"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold capitalize transition-all ${tab === t ? "bg-white/10 text-white" : "text-gray-600 hover:text-gray-300"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {!news.length ? (
        <p className="text-gray-700 text-xs text-center py-8">
          No recent headlines.
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map((n, i) => {
            const href =
              n.url?.trim() ||
              `https://www.google.com/search?tbm=nws&q=${encodeURIComponent(n.title)}`;
            const s = normSentiment(n.sentiment);
            return (
              <a
                key={n.id ?? i}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex gap-3 p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.05] hover:border-white/[0.08] transition-all"
              >
                {/* Sentiment indicator bar */}
                <div
                  className={`w-0.5 rounded-full shrink-0 self-stretch ${s === "bullish" ? "bg-emerald-500" : s === "bearish" ? "bg-rose-500" : "bg-gray-700"}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    {n.source && (
                      <span className="text-[10px] font-bold text-blue-400/70">
                        {n.source}
                      </span>
                    )}
                    <SentimentTag s={n.sentiment} />
                    {fmtDate(n.date || n.time) && (
                      <span className="text-[10px] text-gray-700 ml-auto">
                        {fmtDate(n.date || n.time)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-gray-300 group-hover:text-white transition-colors leading-snug line-clamp-2">
                    {n.title}
                  </p>
                  {n.text && n.text !== n.title && (
                    <p className="text-[11px] text-gray-600 mt-0.5 line-clamp-1">
                      {n.text.slice(0, 120)}
                    </p>
                  )}
                </div>
                <ExternalLink
                  size={11}
                  className="text-gray-700 group-hover:text-blue-400 transition-colors mt-1 shrink-0"
                />
              </a>
            );
          })}
        </div>
      )}

      {news.length > 5 && (
        <button
          onClick={() => setExpanded((p) => !p)}
          className="w-full mt-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] text-[11px] font-bold text-gray-600 hover:text-white hover:bg-white/[0.04] transition-all flex items-center justify-center gap-1.5"
        >
          <ChevronDown
            size={12}
            className={`transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          {expanded ? "Show less" : `${news.length - 5} more headlines`}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DETAILED REPORT  — scrollable storytelling
// ─────────────────────────────────────────────────────────────────────────────
function DetailedReport({ stock }: { stock: StockData }) {
  const [open, setOpen] = useState(false);
  const csym = cs(stock.symbol, stock.currency);
  const score = stock.final_score || 0;
  const decision =
    stock.decision || (score >= 0.68 ? "BUY" : score < 0.38 ? "SELL" : "HOLD");
  const decColor = decision.includes("BUY")
    ? "text-emerald-400"
    : decision.includes("SELL")
      ? "text-rose-400"
      : "text-amber-400";
  const decBorder = decision.includes("BUY")
    ? "border-emerald-500/20"
    : decision.includes("SELL")
      ? "border-rose-500/20"
      : "border-amber-500/20";
  const decBg = decision.includes("BUY")
    ? "bg-emerald-500/5"
    : decision.includes("SELL")
      ? "bg-rose-500/5"
      : "bg-amber-500/5";

  const sections = [
    {
      icon: "⚡",
      title: "Technical Analysis",
      score: stock.technical_score || 0,
      color: "bg-blue-500",
      body:
        `Signal: ${stock.technical_signal || "HOLD"} · Score: ${((stock.technical_score || 0) * 100).toFixed(0)}%\n` +
        (stock.technical_score > 0.65
          ? "Momentum indicators are constructive. Moving average crossovers suggest near-term upside with RSI in a healthy range."
          : stock.technical_score < 0.35
            ? "Technical structure is deteriorating. Price has broken key support levels and oscillators signal continued bearish pressure."
            : "Mixed signals. Consolidating within range — watch for decisive break above resistance to confirm trend direction."),
    },
    {
      icon: "📰",
      title: "Sentiment Analysis",
      score: stock.sentiment_score || 0,
      color: "bg-emerald-500",
      body:
        `Score: ${((stock.sentiment_score || 0) * 100).toFixed(0)}%\n` +
        (stock.sentiment_score > 0.6
          ? "Recent news coverage is predominantly positive with multiple catalysts. Analyst commentary and social sentiment appear supportive."
          : stock.sentiment_score < 0.4
            ? "News flow has turned negative with risk-related headlines dominating. Investor confidence appears to be weakening."
            : "Neutral news backdrop. No major catalysts identified — stock is trading on fundamentals without significant narrative pressure."),
    },
    {
      icon: "🏦",
      title: "Fundamental Analysis",
      score: stock.fundamental_score || 0,
      color: "bg-purple-500",
      body:
        `Score: ${((stock.fundamental_score || 0) * 100).toFixed(0)}%\n` +
        (stock.fundamentals.roe
          ? `ROE ${stock.fundamentals.roe.toFixed(1)}% ${stock.fundamentals.roe > 15 ? "— strong capital efficiency." : "— below benchmark."} `
          : "") +
        (stock.fundamentals.debt_equity
          ? `D/E ratio ${stock.fundamentals.debt_equity.toFixed(2)}x ${stock.fundamentals.debt_equity < 1 ? "signals conservative leverage." : "warrants monitoring."} `
          : "") +
        (stock.fundamentals.profit_margin
          ? `Net margin at ${stock.fundamentals.profit_margin.toFixed(1)}%.`
          : ""),
    },
    {
      icon: "🎯",
      title: "Final Verdict",
      score: score,
      color: decision.includes("BUY")
        ? "bg-emerald-500"
        : decision.includes("SELL")
          ? "bg-rose-500"
          : "bg-amber-500",
      body:
        `Decision: ${decision} · Confidence: ${(score * 100).toFixed(0)}%\n` +
        (stock.explanation ||
          "The AI pipeline has fused technical, fundamental, and sentiment signals. Trade sizing should reflect individual risk tolerance. This is not financial advice."),
    },
  ];

  return (
    <div className="bg-[#0a0c10] border border-white/[0.06] rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <BookOpen size={14} className="text-blue-400" />
          <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">
            Full Analysis Report
          </p>
        </div>
        <ChevronDown
          size={14}
          className={`text-gray-600 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-6 space-y-4 border-t border-white/[0.04]">
              {/* Verdict banner */}
              <div
                className={`mt-5 flex items-center gap-4 p-5 rounded-2xl border ${decBorder} ${decBg}`}
              >
                <div className="text-3xl">
                  {decision.includes("BUY")
                    ? "📈"
                    : decision.includes("SELL")
                      ? "📉"
                      : "➡️"}
                </div>
                <div className="flex-1">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-0.5">
                    AI Verdict
                  </p>
                  <p className={`text-3xl font-black ${decColor}`}>
                    {decision.split(" ")[0]}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-0.5">
                    Confidence
                  </p>
                  <p className="text-3xl font-black">
                    {(score * 100).toFixed(0)}%
                  </p>
                </div>
              </div>
              {/* Decision Summary */}
              <div className="mt-4">
                <DecisionPanel decision={stock.decision_details} />
              </div>
              {/* Sections */}
              {sections.map((s, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.07 }}
                  className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.04]"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-lg">{s.icon}</span>
                    <p className="text-sm font-black text-white flex-1">
                      {s.title}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500">
                        {(s.score * 100).toFixed(0)}%
                      </span>
                      <div className="w-16 h-1 bg-white/[0.05] rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${s.score * 100}%` }}
                          transition={{ duration: 0.8, delay: 0.2 }}
                          className={`h-full rounded-full ${s.color}`}
                        />
                      </div>
                    </div>
                  </div>
                  {s.body.split("\n").map((line, j) => (
                    <p
                      key={j}
                      className="text-xs text-gray-400 leading-relaxed"
                    >
                      {line}
                    </p>
                  ))}
                </motion.div>
              ))}
              <p className="text-[10px] text-gray-700 pt-2 border-t border-white/[0.04]">
                ⚠️ AI-generated report for informational purposes only. Not
                financial advice. Always conduct independent research.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD TO PORTFOLIO MODAL
// ─────────────────────────────────────────────────────────────────────────────
function AddPortfolioModal({
  symbol,
  currentPrice,
  companyName,
  onClose,
  onAdd,
}: {
  symbol: string;
  currentPrice?: number;
  companyName?: string;
  onClose: () => void;
  onAdd: (h: Omit<PortfolioHolding, "id">) => Promise<void>;
}) {
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState(currentPrice?.toFixed(2) || "");
  const [adding, setAdding] = useState(false);
  const total = parseFloat(qty) * parseFloat(price);
  const csym = cs(symbol);

  const handleAdd = async () => {
    if (
      !qty ||
      !price ||
      isNaN(+qty) ||
      isNaN(+price) ||
      +qty <= 0 ||
      +price <= 0
    ) {
      toast.error("Enter valid values");
      return;
    }
    setAdding(true);
    try {
      await onAdd({
        symbol: symbol.toUpperCase(),
        quantity: +qty,
        price: +price,
        companyName: companyName || symbol,
        current_price: currentPrice || +price,
      });
      toast.success(`${symbol} added!`);
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed");
    }
    setAdding(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 backdrop-blur-xl z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 35 }}
        className="bg-[#0e1117] border border-white/[0.08] rounded-3xl p-6 max-w-md w-full shadow-[0_40px_80px_rgba(0,0,0,0.9)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Logo symbol={symbol} size={10} />
            <div>
              <h3 className="font-black text-lg">{symbol}</h3>
              {companyName && (
                <p className="text-xs text-gray-500">{companyName}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center text-gray-500 hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { l: "Quantity", v: qty, s: setQty },
              { l: "Buy Price", v: price, s: setPrice },
            ].map((f) => (
              <div key={f.l}>
                <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block mb-1.5">
                  {f.l}
                </label>
                <input
                  type="number"
                  value={f.v}
                  onChange={(e) => f.s(e.target.value)}
                  min="0.001"
                  step="any"
                  className="w-full bg-white/[0.04] border border-white/[0.07] rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-blue-500/40 transition-colors"
                />
              </div>
            ))}
          </div>
          {!isNaN(total) && total > 0 && (
            <div className="p-3.5 rounded-xl bg-blue-500/[0.06] border border-blue-500/15">
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-0.5">
                Total Cost
              </p>
              <p className="text-2xl font-black text-blue-400">
                {csym}
                {total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </p>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleAdd}
              disabled={adding}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 hover:opacity-90 disabled:opacity-50 font-black text-sm transition-all shadow-lg shadow-blue-500/20"
            >
              {adding ? "Adding…" : "Add to Portfolio"}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.07] font-bold text-sm text-gray-500 hover:text-white transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STOCK ANALYSIS  — main tab
// ─────────────────────────────────────────────────────────────────────────────
function StockAnalysis({
  symbol,
  user,
  watchlist,
  onAddToPortfolio,
  onToggleWatchlist,
}: {
  symbol: string;
  user: FirebaseUser | null;
  watchlist: string[];
  onAddToPortfolio: (h: Omit<PortfolioHolding, "id">) => Promise<void>;
  onToggleWatchlist: (s: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const qc = useQueryClient();

  const {
    data: stock,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<StockData>({
    queryKey: ["stock", symbol],
    queryFn: async () => {
      const r = await fetch(`${API}/stock/${encodeURIComponent(symbol)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  const { data: newsRaw } = useQuery<NewsItem[]>({
    queryKey: ["news", symbol],
    queryFn: async () => {
      const r = await fetch(`${API}/news/${encodeURIComponent(symbol)}`);
      const j = await r.json();
      return (j.news || []).map((n: NewsItem, i: number) => ({
        ...n,
        id: n.id ?? i,
        time: fmtDate(n.date || n.time),
        sentiment: normSentiment(n.sentiment),
      }));
    },
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading) return <AnalysisLoader symbol={symbol} />;
  if (isError || !stock)
    return (
      <div className="p-6 bg-rose-500/[0.06] border border-rose-500/15 rounded-2xl flex items-start gap-3">
        <AlertCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
        <div>
          <p className="font-black text-rose-400 text-sm">
            Analysis failed for {symbol}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Symbol may be invalid or data provider is unavailable.
          </p>
          <button
            onClick={() => refetch()}
            className="mt-2 text-xs text-blue-400 flex items-center gap-1 hover:text-blue-300 transition-colors"
          >
            <RefreshCw size={10} />
            Retry
          </button>
        </div>
      </div>
    );

  const cur = stock.prices?.at(-1)?.close;
  const csym = cs(symbol, stock.currency);
  const news: NewsItem[] = newsRaw || [];

  return (
    <div className="space-y-4">
      <HeroSection
        stock={stock}
        news={news}
        onAddPortfolio={() =>
          user ? setShowAdd(true) : toast.error("Sign in first")
        }
        onToggleWatchlist={onToggleWatchlist}
        inWatchlist={watchlist.includes(symbol)}
      />
      <NarrativeFeed news={news} stock={stock} />
      <PriceChart
        data={stock.prices}
        symbol={symbol}
        csym={csym}
        pattern={stock.pattern}
        prediction={stock.prediction}
      />
      <NewsPanel news={news} sentimentScore={stock.sentiment_score} />
      <FundamentalsGrid data={stock.fundamentals} csym={csym} />
      <DetailedReport stock={stock} />
      {/* Final structured decision summary */}
      {stock.decision_details && (
        <div className="bg-[#0a0c10] border border-white/[0.06] rounded-2xl p-4">
          <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-2">Decision Summary</p>
          <div className="flex items-center gap-4">
            <div className="flex-1 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <p className="text-xs text-gray-400">SHORT TERM</p>
              <p className="font-black text-sm">{stock.decision_details.short_term?.decision || "HOLD"}</p>
              <p className="text-[11px] text-gray-500">{stock.decision_details.short_term?.confidence ?? "-"}%</p>
            </div>
            <div className="flex-1 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <p className="text-xs text-gray-400">LONG TERM</p>
              <p className="font-black text-sm">{stock.decision_details.long_term?.decision || "HOLD"}</p>
              <p className="text-[11px] text-gray-500">{stock.decision_details.long_term?.confidence ?? "-"}%</p>
            </div>
            <div className="flex-1 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <p className="text-xs text-gray-400">OVERALL</p>
              <p className="font-black text-sm">{stock.decision_details.overall?.decision || "HOLD"}</p>
              <p className="text-[11px] text-gray-500">{stock.decision_details.overall?.confidence ?? "-"}%</p>
            </div>
          </div>
        </div>
      )}
      <AnimatePresence>
        {showAdd && (
          <AddPortfolioModal
            symbol={symbol}
            currentPrice={cur}
            companyName={stock.name || stock.fundamentals.name || undefined}
            onClose={() => setShowAdd(false)}
            onAdd={onAddToPortfolio}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO VIEW
// ─────────────────────────────────────────────────────────────────────────────
function PortfolioView({
  user,
  portfolio,
  onSelectSymbol,
}: {
  user: FirebaseUser | null;
  portfolio: ReturnType<typeof useFirestorePortfolio>;
  onSelectSymbol: (s: string) => void;
}) {
  const { holdings, loading, remove } = portfolio;
  const [showAdd, setShowAdd] = useState(false);
  const [nSym, setNSym] = useState("");
  const [nQty, setNQty] = useState("");
  const [nPrc, setNPrc] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (
      !nSym.trim() ||
      !nQty ||
      !nPrc ||
      isNaN(+nQty) ||
      isNaN(+nPrc) ||
      +nQty <= 0 ||
      +nPrc <= 0
    ) {
      toast.error("All fields required");
      return;
    }
    setAdding(true);
    try {
      await portfolio.add({
        symbol: nSym.trim().toUpperCase(),
        quantity: +nQty,
        price: +nPrc,
        companyName: nSym.toUpperCase(),
      });
      setNSym("");
      setNQty("");
      setNPrc("");
      setShowAdd(false);
    } catch (e: any) {
      toast.error(e.message || "Failed");
    }
    setAdding(false);
  };

  const summary = useMemo(() => {
    if (!holdings.length) return null;
    const inv = holdings.reduce((s, h) => s + h.price * h.quantity, 0);
    const cur = holdings.reduce(
      (s, h) => s + (h.current_price || h.price) * h.quantity,
      0,
    );
    const pnl = cur - inv;
    return { inv, cur, pnl, pct: (pnl / inv) * 100 };
  }, [holdings]);

  if (!user)
    return (
      <div className="py-24 text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mx-auto">
          <Briefcase size={24} className="text-gray-600" />
        </div>
        <p className="text-gray-500">Sign in to track your portfolio</p>
      </div>
    );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Briefcase size={16} className="text-blue-400" />
          <h2 className="font-black text-lg">Portfolio</h2>
          <span className="text-xs bg-white/[0.05] text-gray-500 px-2 py-0.5 rounded-full">
            {holdings.length}
          </span>
        </div>
        <button
          onClick={() => setShowAdd((p) => !p)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold text-xs transition-all"
        >
          <Plus size={13} /> Add Position
        </button>
      </div>
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-[#0a0c10] border border-blue-500/15 rounded-2xl p-5 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    l: "Symbol",
                    v: nSym,
                    s: (v: string) => setNSym(v.toUpperCase()),
                    ph: "AAPL",
                  },
                  { l: "Qty", v: nQty, s: setNQty, ph: "10" },
                  { l: "Price", v: nPrc, s: setNPrc, ph: "150.00" },
                ].map((f) => (
                  <div key={f.l}>
                    <label className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider block mb-1.5">
                      {f.l}
                    </label>
                    <input
                      value={f.v}
                      onChange={(e) => f.s(e.target.value)}
                      placeholder={f.ph}
                      type={f.l !== "Symbol" ? "number" : "text"}
                      className="w-full bg-white/[0.04] border border-white/[0.07] rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-blue-500/40 placeholder-gray-700 transition-colors"
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAdd}
                  disabled={adding}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-bold text-sm"
                >
                  {adding ? "Adding…" : "Add"}
                </button>
                <button
                  onClick={() => setShowAdd(false)}
                  className="px-5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.07] font-bold text-sm text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Sk key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : holdings.length === 0 ? (
        <div className="py-20 text-center space-y-3">
          <Briefcase size={32} className="text-gray-700 mx-auto" />
          <p className="text-gray-600 text-sm">No positions yet</p>
        </div>
      ) : (
        <>
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {
                  l: "Invested",
                  v: `$${summary.inv.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
                  c: "text-white",
                },
                {
                  l: "Current",
                  v: `$${summary.cur.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
                  c: "text-white",
                },
                {
                  l: "Total P&L",
                  v: `${summary.pnl >= 0 ? "+" : "-"}$${Math.abs(summary.pnl).toFixed(2)}`,
                  c: summary.pnl >= 0 ? "text-emerald-400" : "text-rose-400",
                },
                {
                  l: "Return",
                  v: `${summary.pct >= 0 ? "+" : ""}${summary.pct.toFixed(2)}%`,
                  c: summary.pct >= 0 ? "text-emerald-400" : "text-rose-400",
                },
              ].map((c) => (
                <div
                  key={c.l}
                  className="bg-[#0a0c10] border border-white/[0.06] rounded-2xl p-4"
                >
                  <p className="text-[10px] text-gray-600 uppercase font-semibold tracking-wider mb-1">
                    {c.l}
                  </p>
                  <p className={`text-xl font-black ${c.c}`}>{c.v}</p>
                </div>
              ))}
            </div>
          )}
          <div className="bg-[#0a0c10] border border-white/[0.06] rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.05]">
                    {[
                      "",
                      "Symbol",
                      "Qty",
                      "Cost",
                      "Current",
                      "Invested",
                      "P&L",
                      "Return",
                      "",
                    ].map((h, i) => (
                      <th
                        key={i}
                        className="px-4 py-3 text-left text-[10px] text-gray-600 uppercase tracking-wider font-semibold whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h, i) => {
                    const cS = cs(h.symbol);
                    const cur = h.current_price || h.price;
                    const inv = h.price * h.quantity;
                    const curV = cur * h.quantity;
                    const pnl = curV - inv;
                    const pct = (pnl / inv) * 100;
                    return (
                      <tr
                        key={h.id || i}
                        className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors group"
                      >
                        <td className="px-3 py-3">
                          <Logo symbol={h.symbol} size={7} />
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => onSelectSymbol(h.symbol)}
                            className="font-black text-blue-400 hover:text-blue-300"
                          >
                            {h.symbol}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {h.quantity}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {cS}
                          {h.price.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 font-bold text-xs">
                          {cS}
                          {cur.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {cS}
                          {inv.toFixed(2)}
                        </td>
                        <td
                          className={`px-4 py-3 font-black text-xs ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                        >
                          {pnl >= 0 ? "+" : "-"}
                          {cS}
                          {Math.abs(pnl).toFixed(2)}
                        </td>
                        <td
                          className={`px-4 py-3 text-xs font-black ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                        >
                          {pct >= 0 ? "+" : ""}
                          {pct.toFixed(2)}%
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => h.id && remove(h.id, h.symbol)}
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-gray-700 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                          >
                            <Trash2 size={11} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ALERTS VIEW
// ─────────────────────────────────────────────────────────────────────────────
function AlertsView({
  user,
  alertsStore,
  onSelectSymbol,
}: {
  user: FirebaseUser | null;
  alertsStore: ReturnType<typeof useFirestoreAlerts>;
  onSelectSymbol: (s: string) => void;
}) {
  const { alerts, loading, add, remove } = alertsStore;
  const [showAdd, setShowAdd] = useState(false);
  const [sym, setSym] = useState("");
  const [price, setPrice] = useState("");
  const [cond, setCond] = useState<"above" | "below">("above");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "triggered">("all");

  const handleAdd = async () => {
    if (!sym.trim() || !price || isNaN(+price) || +price <= 0) {
      toast.error("Enter valid symbol and price");
      return;
    }
    setAdding(true);
    try {
      await add({
        symbol: sym.trim().toUpperCase(),
        target_price: +price,
        condition: cond,
        note,
      });
      setShowAdd(false);
      setSym("");
      setPrice("");
      setNote("");
    } catch (e: any) {
      toast.error(e.message || "Failed");
    }
    setAdding(false);
  };

  const shown =
    filter === "active"
      ? alerts.filter((a) => !a.triggered)
      : filter === "triggered"
        ? alerts.filter((a) => a.triggered)
        : alerts;

  if (!user)
    return (
      <div className="py-24 text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mx-auto">
          <Bell size={24} className="text-gray-600" />
        </div>
        <p className="text-gray-500">Sign in to create price alerts</p>
      </div>
    );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-amber-400" />
          <h2 className="font-black text-lg">Alerts</h2>
          <span className="text-xs bg-white/[0.05] text-gray-500 px-2 py-0.5 rounded-full">
            {alerts.length}
          </span>
        </div>
        <button
          onClick={() => setShowAdd((p) => !p)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/80 hover:bg-amber-500 text-black font-bold text-xs transition-all"
        >
          <Plus size={13} /> New Alert
        </button>
      </div>
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-[#0a0c10] border border-amber-500/15 rounded-2xl p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block mb-1.5">
                    Symbol
                  </label>
                  <input
                    value={sym}
                    onChange={(e) => setSym(e.target.value.toUpperCase())}
                    placeholder="AAPL"
                    className="w-full bg-white/[0.04] border border-white/[0.07] rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-amber-500/30 placeholder-gray-700 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block mb-1.5">
                    Condition
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(["above", "below"] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => setCond(c)}
                        className={`py-2.5 rounded-xl text-xs font-bold transition-all ${cond === c ? (c === "above" ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" : "bg-rose-500/15 text-rose-400 border border-rose-500/25") : "bg-white/[0.03] text-gray-600 border border-white/[0.06]"}`}
                      >
                        {c === "above" ? "↑ Above" : "↓ Below"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block mb-1.5">
                    Target Price
                  </label>
                  <input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="200.00"
                    className="w-full bg-white/[0.04] border border-white/[0.07] rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-amber-500/30 placeholder-gray-700"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAdd}
                  disabled={adding}
                  className="px-5 py-2.5 rounded-xl bg-amber-500/80 hover:bg-amber-500 text-black disabled:opacity-50 font-bold text-sm"
                >
                  {adding ? "Creating…" : "Create Alert"}
                </button>
                <button
                  onClick={() => setShowAdd(false)}
                  className="px-5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.07] font-bold text-sm text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex gap-1.5">
        {(["all", "active", "triggered"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3.5 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all ${filter === f ? "bg-amber-500/10 text-amber-400 border border-amber-500/15" : "text-gray-600 border border-transparent hover:border-white/[0.08]"}`}
          >
            {f} (
            {f === "all"
              ? alerts.length
              : f === "active"
                ? alerts.filter((a) => !a.triggered).length
                : alerts.filter((a) => a.triggered).length}
            )
          </button>
        ))}
      </div>
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Sk key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="py-20 text-center">
          <BellOff size={28} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-600 text-sm">No alerts</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <AnimatePresence>
            {shown.map((alert, i) => (
              <motion.div
                key={alert.id || i}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: i * 0.03 }}
                className={`group flex items-center gap-4 p-4 rounded-2xl border transition-all ${alert.triggered ? "bg-emerald-500/[0.04] border-emerald-500/10" : "bg-[#0a0c10] border-white/[0.05] hover:border-white/[0.09]"}`}
              >
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${alert.triggered ? "bg-emerald-500/15" : alert.condition === "above" ? "bg-emerald-500/10" : "bg-rose-500/10"}`}
                >
                  {alert.triggered ? (
                    <CheckCircle2 size={16} className="text-emerald-400" />
                  ) : alert.condition === "above" ? (
                    <TrendingUp size={16} className="text-emerald-400" />
                  ) : (
                    <TrendingDown size={16} className="text-rose-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => onSelectSymbol(alert.symbol)}
                      className="font-black text-white hover:text-blue-400 text-sm"
                    >
                      {alert.symbol}
                    </button>
                    <span
                      className={`text-xs font-bold ${alert.condition === "above" ? "text-emerald-400" : "text-rose-400"}`}
                    >
                      {alert.condition} ${alert.target_price.toFixed(2)}
                    </span>
                    {alert.triggered && <Tag color="green">✓ Triggered</Tag>}
                  </div>
                  {alert.note && (
                    <p className="text-[10px] text-gray-600 mt-0.5">
                      {alert.note}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => alert.id && remove(alert.id)}
                  className="opacity-0 group-hover:opacity-100 p-2 rounded-xl text-gray-700 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                >
                  <Trash2 size={12} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPARE VIEW
// ─────────────────────────────────────────────────────────────────────────────
function CompareView({ initialSymbols = [] }: { initialSymbols?: string[] }) {
  const [symbols, setSymbols] = useState<string[]>(initialSymbols);
  const [input, setInput] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (input.length < 1) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`${API}/search/${encodeURIComponent(input)}`);
        setResults((await r.json()).slice(0, 5));
      } catch {
        setResults([]);
      }
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  const addSym = (s: string) => {
    const u = s.trim().toUpperCase();
    if (!u || symbols.includes(u) || symbols.length >= 4) return;
    setSymbols((p) => [...p, u]);
    setInput("");
    setResults([]);
  };

  const { data: stocks = [], isLoading } = useQuery<StockData[]>({
    queryKey: ["compare", symbols.join(",")],
    queryFn: async () => {
      if (symbols.length < 2) return [];
      const res = await Promise.allSettled(
        symbols.map((sym) =>
          fetch(`${API}/stock/${encodeURIComponent(sym)}`).then((r) =>
            r.ok ? r.json() : Promise.reject(),
          ),
        ),
      );
      return res
        .map((r, i) =>
          r.status === "fulfilled" ? { ...r.value, symbol: symbols[i] } : null,
        )
        .filter(Boolean) as StockData[];
    },
    enabled: symbols.length >= 2,
    staleTime: 5 * 60 * 1000,
  });

  const allDates = useMemo(
    () =>
      Array.from(
        new Set(stocks.flatMap((s) => (s.prices || []).map((p) => p.date))),
      )
        .sort()
        .slice(-90),
    [stocks],
  );

  const chartData = {
    labels: allDates.map((d) =>
      new Date(d).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    ),
    datasets: stocks.map((s, i) => {
      const base = s.prices?.[0]?.close || 1;
      const map = Object.fromEntries(
        (s.prices || []).map((p) => [p.date, ((p.close - base) / base) * 100]),
      );
      return {
        label: s.symbol,
        data: allDates.map((d) => map[d] ?? null),
        borderColor: COMPARE_COLORS[i % COMPARE_COLORS.length],
        backgroundColor: "transparent",
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 0,
        spanGaps: true,
      };
    }),
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <GitCompare size={16} className="text-purple-400" />
        <h2 className="font-black text-lg">Compare</h2>
      </div>
      <div className="flex items-center gap-2 flex-wrap bg-[#0a0c10] border border-white/[0.06] rounded-2xl p-3">
        {symbols.map((s, i) => (
          <div
            key={s}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black border"
            style={{
              borderColor: COMPARE_COLORS[i % COMPARE_COLORS.length] + "40",
              backgroundColor: COMPARE_COLORS[i % COMPARE_COLORS.length] + "15",
              color: COMPARE_COLORS[i % COMPARE_COLORS.length],
            }}
          >
            <Logo symbol={s} size={6} />
            {s}
            <button
              onClick={() => setSymbols((p) => p.filter((x) => x !== s))}
              className="opacity-70 hover:opacity-100"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        {symbols.length < 4 && (
          <div className="relative">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.07]">
              <Search size={11} className="text-gray-600" />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && input.trim()) addSym(input);
                }}
                placeholder="Add…"
                className="bg-transparent text-xs outline-none text-white placeholder-gray-600 w-16"
              />
              {searching && (
                <RefreshCw size={10} className="animate-spin text-blue-400" />
              )}
            </div>
            {results.length > 0 && (
              <div className="absolute top-full mt-1 left-0 w-52 bg-[#111] border border-white/[0.07] rounded-xl overflow-hidden shadow-2xl z-50">
                {results.map((s) => (
                  <button
                    key={s.symbol}
                    onClick={() => addSym(s.symbol)}
                    className="w-full text-left px-3 py-2.5 hover:bg-white/[0.05] text-xs flex items-center gap-2 transition-colors"
                  >
                    <Plus size={10} className="text-blue-400 shrink-0" />
                    <span className="font-black text-white">{s.symbol}</span>
                    <span className="text-gray-600 truncate">{s.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <span className="text-[10px] text-gray-700 ml-auto">Max 4 assets</span>
      </div>
      {symbols.length < 2 ? (
        <div className="py-16 text-center">
          <p className="text-gray-600 text-sm">
            Add at least 2 symbols to compare
          </p>
        </div>
      ) : isLoading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <Sk key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <>
          {stocks.length >= 2 && (
            <div className="bg-[#0a0c10] border border-white/[0.06] rounded-2xl p-5">
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">
                Relative Performance (90D)
              </p>
              <p className="text-[10px] text-gray-700 mb-4">
                % return from period start
              </p>
              <div style={{ height: 240 }}>
                <Line
                  data={chartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        display: true,
                        labels: {
                          color: "#6b7280",
                          font: { size: 11 },
                          boxWidth: 10,
                          padding: 14,
                        },
                      },
                      tooltip: {
                        backgroundColor: "#0f1117",
                        borderColor: "rgba(255,255,255,0.07)",
                        borderWidth: 1,
                        padding: 10,
                        titleColor: "#9ca3af",
                        bodyColor: "#fff",
                        callbacks: {
                          label: (ctx: any) =>
                            ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2) ?? "—"}%`,
                        },
                      },
                    },
                    scales: {
                      x: {
                        grid: { display: false },
                        ticks: {
                          color: "#374151",
                          maxTicksLimit: 6,
                          font: { size: 10 },
                        },
                      },
                      y: {
                        grid: { color: "rgba(255,255,255,0.025)" },
                        ticks: {
                          color: "#374151",
                          font: { size: 10 },
                          callback: (v: any) => `${Number(v).toFixed(0)}%`,
                        },
                      },
                    },
                    interaction: { mode: "index", intersect: false },
                  }}
                />
              </div>
            </div>
          )}
          <div className="bg-[#0a0c10] border border-white/[0.06] rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.05]">
                    <th className="text-left px-5 py-4 text-[10px] text-gray-600 uppercase tracking-wider font-semibold w-28">
                      Metric
                    </th>
                    {stocks.map((s, i) => (
                      <th key={s.symbol} className="px-5 py-4 text-center">
                        <div className="flex flex-col items-center gap-1.5">
                          <Logo symbol={s.symbol} size={8} />
                          <span
                            className="text-sm font-black"
                            style={{
                              color: COMPARE_COLORS[i % COMPARE_COLORS.length],
                            }}
                          >
                            {s.symbol}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      k: "final_score",
                      l: "AI Score",
                      fmt: (v: number) => `${(v * 100).toFixed(0)}%`,
                      hi: (v: number) =>
                        v >= 0.68
                          ? "text-emerald-400"
                          : v < 0.38
                            ? "text-rose-400"
                            : "text-amber-400",
                    },
                    {
                      k: "sentiment_score",
                      l: "Sentiment",
                      fmt: (v: number) => `${(v * 100).toFixed(0)}%`,
                      hi: (v: number) =>
                        v > 0.6
                          ? "text-emerald-400"
                          : v < 0.4
                            ? "text-rose-400"
                            : "text-amber-400",
                    },
                    {
                      k: "technical_score",
                      l: "Technical",
                      fmt: (v: number) => `${(v * 100).toFixed(0)}%`,
                      hi: (v: number) =>
                        v > 0.6
                          ? "text-emerald-400"
                          : v < 0.4
                            ? "text-rose-400"
                            : "text-amber-400",
                    },
                  ].map((m) => (
                    <tr
                      key={m.k}
                      className="border-b border-white/[0.03] hover:bg-white/[0.02]"
                    >
                      <td className="px-5 py-3.5 text-[11px] text-gray-500 font-semibold">
                        {m.l}
                      </td>
                      {stocks.map((s) => {
                        const raw = (s as any)[m.k];
                        return (
                          <td
                            key={s.symbol}
                            className={`px-5 py-3.5 text-center text-sm font-black ${raw != null ? m.hi(raw) : "text-gray-700"}`}
                          >
                            {raw != null ? m.fmt(raw) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {[
                    {
                      k: "pe_ratio",
                      l: "P/E",
                      fmt: (v: number) => `${v.toFixed(1)}x`,
                      hi: (v: number) =>
                        v < 20
                          ? "text-emerald-400"
                          : v < 35
                            ? "text-amber-400"
                            : "text-rose-400",
                    },
                    {
                      k: "beta",
                      l: "Beta",
                      fmt: (v: number) => v.toFixed(2),
                      hi: (v: number) =>
                        v < 0.8
                          ? "text-emerald-400"
                          : v < 1.5
                            ? "text-amber-400"
                            : "text-rose-400",
                    },
                    {
                      k: "profit_margin",
                      l: "Net Margin",
                      fmt: (v: number) => `${v.toFixed(1)}%`,
                      hi: (v: number) =>
                        v > 15
                          ? "text-emerald-400"
                          : v > 0
                            ? "text-amber-400"
                            : "text-rose-400",
                    },
                    {
                      k: "roe",
                      l: "ROE",
                      fmt: (v: number) => `${v.toFixed(1)}%`,
                      hi: (v: number) =>
                        v > 15 ? "text-emerald-400" : "text-amber-400",
                    },
                  ].map((m) => (
                    <tr
                      key={m.k}
                      className="border-b border-white/[0.03] hover:bg-white/[0.02]"
                    >
                      <td className="px-5 py-3.5 text-[11px] text-gray-500 font-semibold">
                        {m.l}
                      </td>
                      {stocks.map((s) => {
                        const raw = (s.fundamentals as any)?.[m.k];
                        return (
                          <td
                            key={s.symbol}
                            className={`px-5 py-3.5 text-center text-sm font-black ${raw != null ? m.hi(raw) : "text-gray-700"}`}
                          >
                            {raw != null ? m.fmt(raw) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH BAR
// ─────────────────────────────────────────────────────────────────────────────
function SearchBar({ onSelect }: { onSelect: (s: string) => void }) {
  const [input, setInput] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(-1);
  const ref = useRef<HTMLInputElement>(null);
  const debouncedInput = useDebounce(input, 320);

  useEffect(() => {
    if (debouncedInput.length < 1) {
      setResults([]);
      return;
    }
    setLoading(true);
    fetch(`${API}/search/${encodeURIComponent(debouncedInput)}`)
      .then((r) => r.json())
      .then((d) => {
        setResults(Array.isArray(d) ? d : []);
        setOpen(true);
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [debouncedInput]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        ref.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
        setInput("");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const handleSelect = (sym: string) => {
    const s = sym.trim().toUpperCase();
    if (!s) return;
    setInput("");
    setOpen(false);
    setIdx(-1);
    onSelect(s);
  };
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (results[idx]) handleSelect(results[idx].symbol);
      else if (input.trim()) handleSelect(input.trim());
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((p) => (p + 1) % Math.max(results.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((p) => (p <= 0 ? results.length - 1 : p - 1));
    }
  };

  return (
    <>
      {open && input && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => {
            setOpen(false);
            setInput("");
          }}
        />
      )}
      <div className="relative z-50 w-full max-w-2xl">
        <div
          className={`flex items-center gap-2 p-1.5 rounded-2xl bg-[#0e1117] border transition-all duration-300 ${open && input ? "border-blue-500/40 shadow-[0_0_40px_rgba(59,130,246,0.1)]" : "border-white/[0.07]"}`}
        >
          <div className="ml-3">
            {loading ? (
              <RefreshCw size={14} className="text-blue-400 animate-spin" />
            ) : (
              <Search
                size={14}
                className={open ? "text-blue-400" : "text-gray-600"}
              />
            )}
          </div>
          <input
            ref={ref}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setIdx(-1);
              if (e.target.value) setOpen(true);
            }}
            onKeyDown={handleKey}
            onFocus={() => setOpen(true)}
            placeholder="Search symbol… ⌘K"
            className="flex-1 bg-transparent px-2 py-2.5 outline-none text-white text-sm placeholder-gray-700 font-medium"
            autoComplete="off"
          />
          {input && (
            <button
              onClick={() => {
                setInput("");
                ref.current?.focus();
              }}
              className="mr-1 text-gray-600 hover:text-white transition-colors"
            >
              <X size={12} />
            </button>
          )}
          <button
            onClick={() => input.trim() && handleSelect(input.trim())}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 font-bold text-sm hover:opacity-90 active:scale-95 transition-all flex items-center gap-1.5 whitespace-nowrap text-white"
          >
            Analyze <ArrowRight size={12} />
          </button>
        </div>
        <AnimatePresence>
          {open && input && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
              className="absolute w-full mt-2 bg-[#0e1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-[0_40px_80px_rgba(0,0,0,0.7)] max-h-80 overflow-y-auto z-50"
            >
              {loading && (
                <div className="p-6 flex flex-col items-center gap-2 text-gray-600">
                  <RefreshCw size={16} className="animate-spin text-blue-500" />
                  <span className="text-xs">Scanning…</span>
                </div>
              )}
              {!loading && results.length === 0 && (
                <div className="p-6 text-center text-gray-600 text-xs">
                  No results — press Enter to analyse &ldquo;{input}&rdquo;
                </div>
              )}
              {results.map((item, i) => (
                <div
                  key={`${item.symbol}-${i}`}
                  onClick={() => handleSelect(item.symbol)}
                  onMouseEnter={() => setIdx(i)}
                  className={`px-4 py-3 cursor-pointer flex items-center justify-between border-l-2 transition-all ${i === idx ? "bg-white/[0.05] border-blue-500" : "border-transparent hover:bg-white/[0.02]"}`}
                >
                  <div className="flex items-center gap-3">
                    <Logo symbol={item.symbol} size={8} />
                    <div>
                      <p className="font-black text-sm text-white">
                        {item.symbol}
                      </p>
                      <p className="text-xs text-gray-600 truncate max-w-[180px]">
                        {item.name}
                      </p>
                    </div>
                  </div>
                  <Tag color="slate">{item.type || "EQUITY"}</Tag>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LEFT WATCHLIST SIDEBAR
// ─────────────────────────────────────────────────────────────────────────────
function WatchlistSidebar({
  watchlist,
  onSelect,
  onRemove,
  activeSymbol,
}: {
  watchlist: string[];
  onSelect: (s: string) => void;
  onRemove: (s: string) => void;
  activeSymbol: string | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (!watchlist.length) return null;
  return (
    <div
      className={`transition-all duration-300 ${collapsed ? "w-12" : "w-48"} shrink-0 hidden xl:block`}
    >
      <div className="sticky top-[88px] bg-[#0a0c10] border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-white/[0.05]">
          {!collapsed && (
            <div className="flex items-center gap-1.5">
              <Star size={10} className="text-yellow-400 fill-yellow-400" />
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">
                Watchlist
              </p>
            </div>
          )}
          <button
            onClick={() => setCollapsed((p) => !p)}
            className="p-1 rounded-lg text-gray-600 hover:text-white transition-colors ml-auto"
          >
            {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
          </button>
        </div>
        <div className="py-1">
          {watchlist.slice(0, 10).map((sym) => (
            <div
              key={sym}
              className={`group flex items-center px-2 py-2 hover:bg-white/[0.04] transition-colors cursor-pointer ${activeSymbol === sym ? "bg-blue-500/10" : ""}`}
              onClick={() => onSelect(sym)}
            >
              <Logo symbol={sym} size={7} />
              {!collapsed && (
                <div className="flex-1 min-w-0 ml-2">
                  <p className="text-xs font-bold text-gray-300 group-hover:text-white truncate">
                    {sym}
                  </p>
                </div>
              )}
              {!collapsed && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(sym);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-700 hover:text-rose-400 transition-all"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EMPTY STATE
// ─────────────────────────────────────────────────────────────────────────────
function EmptyState({
  watchlist,
  onSelect,
  onRemove,
}: {
  watchlist: string[];
  onSelect: (s: string) => void;
  onRemove: (s: string) => void;
}) {
  return (
    <div className="py-16 space-y-12">
      <div className="text-center space-y-4">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-blue-500/20 flex items-center justify-center mx-auto"
        >
          <BarChart2 size={32} className="text-blue-400" />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <h1 className="text-4xl font-black tracking-tight mb-2">
            Market Intelligence
          </h1>
          <p className="text-gray-600 max-w-sm mx-auto text-sm leading-relaxed">
            Search any stock, crypto, or index for AI-powered analysis, live
            sentiment, and actionable signals.
          </p>
        </motion.div>
      </div>
      {watchlist.length > 0 && (
        <section>
          <p className="text-[10px] text-gray-600 uppercase font-bold tracking-widest mb-4 flex items-center gap-2">
            <Star size={10} className="text-yellow-400 fill-yellow-400" />{" "}
            Watchlist
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {watchlist.map((sym, i) => (
              <motion.div
                key={sym}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => onSelect(sym)}
                className="group p-4 rounded-2xl bg-[#0a0c10] border border-white/[0.05] hover:border-blue-500/20 cursor-pointer flex items-center gap-3 transition-all hover:bg-[#0e1117]"
              >
                <Logo symbol={sym} size={9} />
                <div className="flex-1 min-w-0">
                  <p className="font-black text-sm">{sym}</p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(sym);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-700 hover:text-rose-400 transition-all"
                >
                  <X size={11} />
                </button>
              </motion.div>
            ))}
          </div>
        </section>
      )}
      <section>
        <p className="text-[10px] text-gray-600 uppercase font-bold tracking-widest mb-4">
          Popular
        </p>
        <div className="flex flex-wrap gap-2">
          {POPULAR.map((sym, i) => (
            <motion.button
              key={sym}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => onSelect(sym)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.03] border border-white/[0.05] hover:border-blue-500/25 hover:bg-blue-500/[0.06] text-sm font-bold text-gray-400 hover:text-white transition-all"
            >
              <Logo symbol={sym} size={6} />
              {sym}
            </motion.button>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS VIEW  — scrollable storytelling format
// ─────────────────────────────────────────────────────────────────────────────
function ReportsView({
  symbol,
  onSelectSymbol,
}: {
  symbol: string | null;
  onSelectSymbol: (s: string) => void;
}) {
  const [input, setInput] = useState(symbol || "");

  const {
    data: stock,
    isLoading,
    isError,
  } = useQuery<StockData>({
    queryKey: ["stock", symbol],
    queryFn: async () => {
      const r = await fetch(`${API}/stock/${encodeURIComponent(symbol!)}`);
      if (!r.ok) throw new Error("HTTP error");
      return r.json();
    },
    enabled: !!symbol,
    staleTime: 5 * 60 * 1000,
  });
  const { data: newsRaw = [] } = useQuery<NewsItem[]>({
    queryKey: ["news", symbol],
    queryFn: async () => {
      const r = await fetch(`${API}/news/${encodeURIComponent(symbol!)}`);
      const j = await r.json();
      return (j.news || []).map((n: NewsItem, i: number) => ({
        ...n,
        id: n.id ?? i,
        time: fmtDate(n.date || n.time),
        sentiment: normSentiment(n.sentiment),
      }));
    },
    enabled: !!symbol,
    staleTime: 10 * 60 * 1000,
  });

  if (!symbol)
    return (
      <div className="py-24 text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mx-auto">
          <FileText size={24} className="text-gray-600" />
        </div>
        <div>
          <p className="text-gray-400 font-bold mb-2">Generate a full report</p>
          <p className="text-gray-600 text-sm">
            Search a stock first, then visit Reports
          </p>
        </div>
        <div className="flex items-center gap-2 max-w-xs mx-auto">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim())
                onSelectSymbol(input.trim());
            }}
            placeholder="Enter symbol…"
            className="flex-1 bg-white/[0.04] border border-white/[0.07] rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-blue-500/40 placeholder-gray-700 font-mono"
          />
          <button
            onClick={() => input.trim() && onSelectSymbol(input.trim())}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold text-sm transition-all"
          >
            Go
          </button>
        </div>
      </div>
    );

  if (isLoading) return <AnalysisLoader symbol={symbol} />;
  if (isError || !stock)
    return (
      <div className="py-16 text-center space-y-3">
        <AlertCircle size={28} className="text-rose-400 mx-auto" />
        <p className="text-gray-500">Could not load report for {symbol}</p>
        <button
          onClick={() => onSelectSymbol(symbol)}
          className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mx-auto"
        >
          <RefreshCw size={10} />
          Retry
        </button>
      </div>
    );

  const csym = cs(symbol, stock.currency);
  const score = stock.final_score || 0;
  const decision =
    stock.decision || (score >= 0.68 ? "BUY" : score < 0.38 ? "SELL" : "HOLD");
  const decColor = decision.includes("BUY")
    ? "text-emerald-400"
    : decision.includes("SELL")
      ? "text-rose-400"
      : "text-amber-400";
  const decBg = decision.includes("BUY")
    ? "from-emerald-500/10"
    : decision.includes("SELL")
      ? "from-rose-500/10"
      : "from-amber-500/10";
  const cur = stock.prices?.at(-1)?.close;
  const prev = stock.prices?.at(-2)?.close;
  const dayChg = cur && prev ? ((cur - prev) / prev) * 100 : null;
  const companyName =
    stock.name || stock.fundamentals.name || stock.company_name || symbol;
  const news: NewsItem[] = newsRaw || [];

  const reportSections = [
    {
      id: "overview",
      icon: "🏢",
      title: "Company Overview",
      content: (
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <Logo symbol={symbol} size={12} />
            <div>
              <h3 className="text-xl font-black">
                {companyName !== symbol ? companyName : symbol}
              </h3>
              <p className="text-gray-500 text-sm">
                {stock.sector || stock.fundamentals.sector || "Equity"} ·{" "}
                {stock.industry || stock.fundamentals.industry || ""}
              </p>
              {cur && (
                <p className="text-2xl font-black mt-2">
                  {csym}
                  {cur.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  {dayChg != null && (
                    <span
                      className={`text-base ml-2 ${dayChg >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                    >
                      {dayChg >= 0 ? "+" : ""}
                      {dayChg.toFixed(2)}%
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                l: "Market Cap",
                v: fmtN(stock.fundamentals.market_cap, "large", csym),
              },
              {
                l: "P/E Ratio",
                v: stock.fundamentals.pe_ratio
                  ? `${stock.fundamentals.pe_ratio.toFixed(1)}x`
                  : "—",
              },
              {
                l: "EPS (TTM)",
                v: stock.fundamentals.eps
                  ? `${csym}${stock.fundamentals.eps.toFixed(2)}`
                  : "—",
              },
              {
                l: "Avg Volume",
                v: fmtN(stock.fundamentals.avg_volume, "large"),
              },
            ].map((s) => (
              <div
                key={s.l}
                className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]"
              >
                <p className="text-[10px] text-gray-600 uppercase font-bold tracking-wider mb-1">
                  {s.l}
                </p>
                <p className="text-sm font-black">{s.v}</p>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: "technical",
      icon: "⚡",
      title: "Technical Analysis",
      content: (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <ScoreRing
                score={stock.technical_score || 0}
                size={72}
                stroke={5}
                color="#60a5fa"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-black">
                  {((stock.technical_score || 0) * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">
                Technical Signal
              </p>
              <p
                className={`text-2xl font-black ${(stock.technical_signal || "HOLD").includes("BUY") ? "text-emerald-400" : (stock.technical_signal || "HOLD").includes("SELL") ? "text-rose-400" : "text-amber-400"}`}
              >
                {stock.technical_signal || "HOLD"}
              </p>
            </div>
          </div>
          <p className="text-sm text-gray-400 leading-relaxed">
            {stock.technical_score > 0.65
              ? "Momentum indicators are constructive. Moving average crossovers suggest near-term upside, with RSI in a healthy range indicating room before overbought territory. Institutional buying patterns suggest accumulation."
              : stock.technical_score < 0.35
                ? "Technical structure is deteriorating. Price has broken key support levels and oscillators show negative momentum. Volume analysis suggests distribution rather than accumulation."
                : "Mixed technical signals. The stock is consolidating within a defined range. A decisive break above resistance with volume confirmation would validate a bullish case. Risk management is key at current levels."}
          </p>
          {stock.prices?.length > 0 && (
            <PriceChart
              data={stock.prices}
              symbol={symbol}
              csym={csym}
              pattern={stock.pattern}
              prediction={stock.prediction}
            />
          )}

          {/* Pattern & Forecast summary */}
          <PatternCard pattern={stock.pattern} prediction={stock.prediction} />
        </div>
      ),
    },
    {
      id: "sentiment",
      icon: "📰",
      title: "Sentiment Analysis",
      content: (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <ScoreRing
                score={stock.sentiment_score || 0}
                size={72}
                stroke={5}
                color="#34d399"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-black">
                  {((stock.sentiment_score || 0) * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">
                Sentiment Verdict
              </p>
              <p
                className={`text-2xl font-black ${stock.sentiment_score > 0.6 ? "text-emerald-400" : stock.sentiment_score < 0.4 ? "text-rose-400" : "text-amber-400"}`}
              >
                {stock.sentiment_score > 0.6
                  ? "Positive"
                  : stock.sentiment_score < 0.4
                    ? "Negative"
                    : "Neutral"}
              </p>
            </div>
          </div>
          <p className="text-sm text-gray-400 leading-relaxed">
            {stock.sentiment_score > 0.6
              ? "Recent news coverage is predominantly positive with multiple catalysts. Analyst commentary and social media sentiment appear supportive of the current price action. News volume is elevated, indicating growing investor interest."
              : stock.sentiment_score < 0.4
                ? "News flow has turned negative with risk-related headlines dominating the narrative. Investor confidence appears to be weakening based on volume and tone of recent coverage. Short-seller activity may be increasing."
                : "The news backdrop is relatively neutral with no major catalysts identified. The stock is trading primarily on fundamentals and technical factors without significant external narrative pressure."}
          </p>
          {news.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] text-gray-600 uppercase font-bold tracking-wider">
                Recent Headlines ({news.length})
              </p>
              {news.slice(0, 5).map((n, i) => {
                const href =
                  n.url?.trim() ||
                  `https://www.google.com/search?tbm=nws&q=${encodeURIComponent(n.title)}`;
                return (
                  <a
                    key={i}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex gap-2.5 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-all"
                  >
                    <div
                      className={`w-0.5 rounded-full shrink-0 self-stretch ${normSentiment(n.sentiment) === "bullish" ? "bg-emerald-500" : normSentiment(n.sentiment) === "bearish" ? "bg-rose-500" : "bg-gray-700"}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        {n.source && (
                          <span className="text-[10px] font-bold text-blue-400/70">
                            {n.source}
                          </span>
                        )}
                        <SentimentTag s={n.sentiment} />
                        {n.time && (
                          <span className="text-[10px] text-gray-700 ml-auto">
                            {n.time}
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-semibold text-gray-300 group-hover:text-white transition-colors line-clamp-2 leading-snug">
                        {n.title}
                      </p>
                    </div>
                    <ExternalLink
                      size={10}
                      className="text-gray-700 group-hover:text-blue-400 shrink-0 mt-1"
                    />
                  </a>
                );
              })}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "fundamental",
      icon: "🏦",
      title: "Fundamental Analysis",
      content: (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <ScoreRing
                score={stock.fundamental_score || 0}
                size={72}
                stroke={5}
                color="#c084fc"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-black">
                  {((stock.fundamental_score || 0) * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">
                Fundamental Health
              </p>
              <p
                className={`text-2xl font-black ${(stock.fundamental_score || 0) > 0.65 ? "text-emerald-400" : (stock.fundamental_score || 0) < 0.35 ? "text-rose-400" : "text-amber-400"}`}
              >
                {(stock.fundamental_score || 0) > 0.65
                  ? "Strong"
                  : (stock.fundamental_score || 0) < 0.35
                    ? "Weak"
                    : "Moderate"}
              </p>
            </div>
          </div>
          <p className="text-sm text-gray-400 leading-relaxed">
            {(stock.fundamentals.roe
              ? `Return on Equity of ${stock.fundamentals.roe.toFixed(1)}% ${stock.fundamentals.roe > 15 ? "signals efficient capital allocation well above the sector benchmark — management is creating value for shareholders." : "falls below sector benchmark, suggesting room for improvement in capital efficiency."} `
              : "") +
              (stock.fundamentals.debt_equity
                ? `Debt-to-Equity ratio of ${stock.fundamentals.debt_equity.toFixed(2)}x ${stock.fundamentals.debt_equity < 1 ? "reflects a conservatively levered balance sheet with ample financial flexibility." : "indicates elevated leverage that warrants monitoring in a rising rate environment."} `
                : "")}
          </p>
          <FundamentalsGrid data={stock.fundamentals} csym={csym} />
        </div>
      ),
    },
    {
      id: "verdict",
      icon: "🎯",
      title: "Final AI Verdict",
      content: (
        <div className="space-y-5">
          <div
            className={`flex items-center gap-5 p-6 rounded-2xl bg-gradient-to-br ${decBg} to-transparent border ${decision.includes("BUY") ? "border-emerald-500/20" : decision.includes("SELL") ? "border-rose-500/20" : "border-amber-500/20"}`}
          >
            <div className="text-5xl">
              {decision.includes("BUY")
                ? "📈"
                : decision.includes("SELL")
                  ? "📉"
                  : "➡️"}
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1">
                AI Verdict
              </p>
              <p className={`text-4xl font-black ${decColor}`}>
                {decision.split(" ")[0]}
              </p>
              {decision.includes(" ") && (
                <p className="text-sm text-gray-500 mt-0.5">
                  {decision.slice(decision.indexOf(" ") + 1)}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1">
                Confidence
              </p>
              <p className="text-4xl font-black">{(score * 100).toFixed(0)}%</p>
            </div>
          </div>
          <div className="space-y-3">
            {[
              {
                l: "Technical Score",
                v: stock.technical_score || 0,
                c: "bg-blue-500",
              },
              {
                l: "Sentiment Score",
                v: stock.sentiment_score || 0,
                c: "bg-emerald-500",
              },
              {
                l: "Fundamental Score",
                v: stock.fundamental_score || 0,
                c: "bg-purple-500",
              },
              {
                l: "Overall Score",
                v: score,
                c: decision.includes("BUY")
                  ? "bg-emerald-500"
                  : decision.includes("SELL")
                    ? "bg-rose-500"
                    : "bg-amber-500",
              },
            ].map((s) => (
              <div key={s.l} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-36 shrink-0">
                  {s.l}
                </span>
                <div className="flex-1">
                  <Bar value={s.v} color={s.c} h="h-2" />
                </div>
                <span className="text-xs font-black text-white w-10 text-right">
                  {(s.v * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
          {stock.explanation && (
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.04]">
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
                <Sparkles size={10} className="text-blue-400" /> AI Summary
              </p>
              <div className="space-y-1.5">
                {stock.explanation
                  .split("\n")
                  .filter(Boolean)
                  .map((l, i) => (
                    <p
                      key={i}
                      className="text-xs text-gray-400 leading-relaxed"
                    >
                      {l}
                    </p>
                  ))}
              </div>
            </div>
          )}
          <p className="text-[11px] text-gray-700 border-t border-white/[0.04] pt-4">
            ⚠️ This report is AI-generated and for informational purposes only.
            It does not constitute financial advice. Past performance is not
            indicative of future results. Always conduct independent research
            before making investment decisions.
          </p>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-blue-400" />
          <h2 className="font-black text-lg">Report · {symbol}</h2>
        </div>
        <p className="text-[10px] text-gray-600">
          {stock.generated_at
            ? `Generated ${new Date(stock.generated_at * 1000).toLocaleString()}`
            : ""}
        </p>
      </div>
      {reportSections.map((sec, i) => (
        <motion.div
          key={sec.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08 }}
          className="bg-[#0a0c10] border border-white/[0.06] rounded-2xl overflow-hidden"
        >
          <div className="flex items-center gap-3 p-5 border-b border-white/[0.04]">
            <span className="text-xl">{sec.icon}</span>
            <h3 className="font-black text-base">{sec.title}</h3>
          </div>
          <div className="p-5">{sec.content}</div>
        </motion.div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RIGHT SIDEBAR  — live market news
// ─────────────────────────────────────────────────────────────────────────────
function RightSidebar({
  symbol,
  user,
  signIn,
}: {
  symbol: string | null;
  user: FirebaseUser | null;
  signIn: () => void;
}) {
  const { data, isLoading } = useQuery<NewsItem[]>({
    queryKey: ["news", symbol || "MARKET"],
    queryFn: async () => {
      const endpoint = symbol
        ? `${API}/news/${encodeURIComponent(symbol)}`
        : `${API}/news/market`;
      const r = await fetch(endpoint);
      const j = await r.json();
      return (j.news || []).map((n: NewsItem, i: number) => ({
        ...n,
        id: n.id ?? i,
        time: fmtDate(n.date || n.time),
        sentiment: normSentiment(n.sentiment),
      }));
    },
    staleTime: 10 * 60 * 1000,
  });
  const news = data || [];

  return (
    <aside className="space-y-4">
      {/* Live news */}
      <div className="bg-[#0a0c10] border border-white/[0.06] rounded-2xl p-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest flex items-center gap-1.5">
            <Newspaper size={10} className="text-blue-400" />{" "}
            {symbol ? `${symbol} News` : "Market News"}
          </p>
          <div className="flex items-center gap-1 text-[10px] text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />{" "}
            Live
          </div>
        </div>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <Sk key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : news.length > 0 ? (
          <div className="space-y-3">
            {news.slice(0, 7).map((n, i) => {
              const href =
                n.url?.trim() ||
                `https://www.google.com/search?tbm=nws&q=${encodeURIComponent(n.title)}`;
              return (
                <a
                  key={n.id ?? i}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block pl-3 border-l-2 border-transparent hover:border-blue-500 transition-all py-0.5"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {normSentiment(n.sentiment) && (
                      <SentimentTag s={n.sentiment} />
                    )}
                    {n.source && (
                      <span className="text-[10px] text-gray-700">
                        {n.source}
                      </span>
                    )}
                    {n.time && (
                      <span className="text-[10px] text-gray-700 ml-auto">
                        {n.time}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-semibold text-gray-400 group-hover:text-white leading-snug line-clamp-2 transition-colors">
                    {n.title}
                  </p>
                </a>
              );
            })}
          </div>
        ) : (
          <p className="text-gray-700 text-xs text-center py-6">
            No recent headlines.
          </p>
        )}
      </div>

      {/* Sign-in nudge */}
      {!user && (
        <div className="bg-gradient-to-br from-blue-900/20 to-indigo-900/10 border border-blue-500/10 rounded-2xl p-4 text-center space-y-2.5">
          <div className="text-2xl">🔐</div>
          <p className="text-xs font-black text-white">Unlock all features</p>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Portfolio tracking, price alerts, and watchlist sync across devices.
          </p>
          <button
            onClick={signIn}
            className="mt-1 w-full py-2.5 rounded-xl bg-white text-black text-xs font-black hover:bg-gray-100 transition-all"
          >
            Sign in with Google
          </button>
        </div>
      )}
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DASHBOARD PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#080b10] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full border-2 border-t-blue-500 border-white/[0.05] animate-spin" />
            <p className="text-gray-600 text-sm">Loading dashboard…</p>
          </div>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>("analysis");
  const [activeSymbol, setActiveSymbol] = useState<string | null>(
    searchParams.get("symbol") || null,
  );
  const [compareSyms, setCompareSyms] = useState<string[]>([]);
  const [lastUpdated, setLastUpdated] = useState("");
  const qc = useQueryClient();

  const { user, loading: authLoading, signIn, signOut } = useFirebaseAuth();
  const { list: watchlist, toggle: toggleWatchlist } = useWatchlist(user?.uid);
  const portfolio = useFirestorePortfolio(user?.uid);
  const alertsStore = useFirestoreAlerts(user?.uid);

  useEffect(() => {
    try {
      const last = localStorage.getItem("lastStock");
      if (!searchParams.get("symbol") && last) setActiveSymbol(last);
    } catch {}
    setLastUpdated(new Date().toLocaleTimeString());
  }, []);

  useEffect(() => {
    if (activeSymbol) {
      try {
        localStorage.setItem("lastStock", activeSymbol);
      } catch {}
      setLastUpdated(new Date().toLocaleTimeString());
    }
  }, [activeSymbol]);

  const handleSelect = useCallback((sym: string) => {
    setActiveSymbol(sym.trim().toUpperCase());
    setView("analysis");
  }, []);

  const handleRefresh = useCallback(async () => {
    if (!activeSymbol) return;
    const t = toast.loading("Refreshing…");
    await qc.invalidateQueries({ queryKey: ["stock", activeSymbol] });
    await qc.invalidateQueries({ queryKey: ["news", activeSymbol] });
    setLastUpdated(new Date().toLocaleTimeString());
    toast.success("Refreshed", { id: t });
  }, [activeSymbol, qc]);

  const openCompare = useCallback((sym: string) => {
    setCompareSyms(sym ? [sym] : []);
    setView("compare");
  }, []);

  const navItems: {
    id: View;
    icon: React.ReactNode;
    label: string;
    badge?: number;
  }[] = [
    { id: "analysis", icon: <BarChart2 size={13} />, label: "Analysis" },
    {
      id: "portfolio",
      icon: <Briefcase size={13} />,
      label: "Portfolio",
      badge: portfolio.holdings.length || undefined,
    },
    {
      id: "alerts",
      icon: <Bell size={13} />,
      label: "Alerts",
      badge: alertsStore.alerts.length || undefined,
    },
    { id: "compare", icon: <GitCompare size={13} />, label: "Compare" },
    { id: "reports", icon: <FileText size={13} />, label: "Reports" },
  ];

  const accentMap: Record<View, string> = {
    analysis: "border-blue-500 text-blue-400",
    portfolio: "border-emerald-500 text-emerald-400",
    alerts: "border-amber-500 text-amber-400",
    compare: "border-purple-500 text-purple-400",
    reports: "border-indigo-500 text-indigo-400",
  };

  return (
    <main className="min-h-screen bg-[#080b10] text-white overflow-x-hidden">
      <style>{`
        @keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
        .scrollbar-hide::-webkit-scrollbar{display:none}
        .scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none}
        * { font-family: 'GeistMono', 'JetBrains Mono', ui-monospace, monospace; }
        h1,h2,h3,.font-black { font-family: 'Geist', 'Inter', system-ui, sans-serif; }
      `}</style>

      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "#0e1117",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "14px",
            fontSize: "13px",
            fontWeight: 600,
          },
          success: { iconTheme: { primary: "#34d399", secondary: "#0e1117" } },
          error: { iconTheme: { primary: "#fb7185", secondary: "#0e1117" } },
        }}
      />

      {/* Ambient background */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <div className="absolute top-0 left-0 w-[600px] h-[600px] rounded-full bg-blue-600/[0.03] blur-[150px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-indigo-600/[0.03] blur-[120px]" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(rgba(255,255,255,0.015) 1px,transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
      </div>

      {/* ── TOP NAV ── */}
      <header className="sticky top-15 z-50 bg-[#080b10]/95 backdrop-blur-xl border-b border-white/[0.05]">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6">
          {/* Top row: logo + search + auth */}
          <div className="flex items-center gap-4 py-3">
            {/* Logo mark */}
            {/* <div className="flex items-center gap-2 shrink-0">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <Activity size={14} className="text-white"/>
              </div>
              <span className="font-black text-sm tracking-tight hidden sm:block">FinIntel</span>
            </div> */}

            {/* Search */}
            {/* <div className="flex-1 flex justify-center">
              <SearchBar onSelect={handleSelect}/>
            </div> */}

            {/* Right actions */}
            {/* <div className="flex items-center gap-2 shrink-0">
              {activeSymbol && view === "analysis" && (
                <>
                  <button
                    onClick={handleRefresh}
                    title="Refresh"
                    className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-gray-500 hover:text-white transition-all"
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button
                    onClick={() => toggleWatchlist(activeSymbol)}
                    title="Watchlist"
                    className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center transition-all"
                  >
                    <Star
                      size={13}
                      className={
                        watchlist.includes(activeSymbol)
                          ? "text-yellow-400 fill-yellow-400"
                          : "text-gray-500 hover:text-white"
                      }
                    />
                  </button>
                  <button
                    onClick={() => openCompare(activeSymbol)}
                    className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-500/10 border border-purple-500/15 text-purple-400 hover:bg-purple-500/15 font-bold text-xs transition-all"
                  >
                    <GitCompare size={11} /> Compare
                  </button>
                </>
              )}

              {authLoading ? (
                <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
                  <RefreshCw size={12} className="text-gray-600 animate-spin" />
                </div>
              ) : user ? (
                <div className="flex items-center gap-2">
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt=""
                      className="w-8 h-8 rounded-full border border-white/10 object-cover"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-xs font-black text-blue-400">
                      {user.displayName?.charAt(0) || "U"}
                    </div>
                  )}
                  <button
                    onClick={signOut}
                    className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-gray-600 hover:text-rose-400 transition-all"
                  >
                    <LogOut size={12} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={signIn}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white text-black font-black text-xs hover:bg-gray-100 transition-all"
                >
                  Sign in
                </button>
              )}
            </div> */}
          </div>

          {/* Nav tabs */}
          <div className="flex items-center -mb-px overflow-x-auto scrollbar-hide">
            {navItems.map((n) => (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-black whitespace-nowrap transition-all border-b-2 relative ${view === n.id ? accentMap[n.id] : "text-gray-600 border-transparent hover:text-gray-400"}`}
              >
                {n.icon}
                {n.label}
                {n.badge != null && n.badge > 0 && (
                  <span
                    className={`ml-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-black ${n.id === "portfolio" ? "bg-emerald-500/20 text-emerald-400" : n.id === "alerts" ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"}`}
                  >
                    {n.badge}
                  </span>
                )}
              </button>
            ))}
            {activeSymbol && view === "analysis" && (
              <div className="ml-auto pb-2.5 flex items-center gap-1.5 text-[10px] text-gray-700 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />{" "}
                LIVE · {lastUpdated}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── CONTENT ── */}
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-22 flex gap-5">
        {/* Left watchlist sidebar (xl+ only) */}
        <WatchlistSidebar
          watchlist={watchlist}
          onSelect={handleSelect}
          onRemove={toggleWatchlist}
          activeSymbol={activeSymbol}
        />

        {/* Main panel */}
        <div className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            {view === "analysis" && (
              <motion.div
                key="analysis"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {!activeSymbol ? (
                  <EmptyState
                    watchlist={watchlist}
                    onSelect={handleSelect}
                    onRemove={toggleWatchlist}
                  />
                ) : (
                  <StockAnalysis
                    symbol={activeSymbol}
                    user={user}
                    watchlist={watchlist}
                    onAddToPortfolio={portfolio.add}
                    onToggleWatchlist={toggleWatchlist}
                  />
                )}
              </motion.div>
            )}
            {view === "portfolio" && (
              <motion.div
                key="portfolio"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <PortfolioView
                  user={user}
                  portfolio={portfolio}
                  onSelectSymbol={(sym) => {
                    handleSelect(sym);
                  }}
                />
              </motion.div>
            )}
            {view === "alerts" && (
              <motion.div
                key="alerts"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <AlertsView
                  user={user}
                  alertsStore={alertsStore}
                  onSelectSymbol={(sym) => {
                    handleSelect(sym);
                  }}
                />
              </motion.div>
            )}
            {view === "compare" && (
              <motion.div
                key="compare"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <CompareView initialSymbols={compareSyms} />
              </motion.div>
            )}
            {view === "reports" && (
              <motion.div
                key="reports"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <ReportsView
                  symbol={activeSymbol}
                  onSelectSymbol={(sym) => {
                    handleSelect(sym);
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right sidebar */}
        <div className="w-64 shrink-0 hidden lg:block">
          <div className="sticky top-[88px]">
            <RightSidebar symbol={activeSymbol} user={user} signIn={signIn} />
          </div>
        </div>
      </div>
    </main>
  );
}
