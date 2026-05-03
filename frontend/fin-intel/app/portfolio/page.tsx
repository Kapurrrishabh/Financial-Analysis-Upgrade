"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wallet, TrendingUp, TrendingDown, PieChart, Activity,
  Plus, Search, Building2, ArrowUpRight, ArrowDownRight,
  RefreshCcw, ChevronRight, BarChart2, Layers, Eye, EyeOff, Lock, Briefcase, Trash2, DollarSign
} from "lucide-react";
import Link from "next/link";
import toast, { Toaster } from "react-hot-toast";

// ─── CUSTOM HOOKS & FIREBASE ─────────────────────────────────
import { useAuth } from "@/hooks/useAuth"; 
import { db } from "@/lib/firebase"; 
import { collection, onSnapshot, query, addDoc, deleteDoc, doc } from "firebase/firestore";

// ─── TYPES ───────────────────────────────────────────────────
interface FirestoreHolding {
  id: string;
  symbol: string;
  quantity: number;
  price: number; 
  current_price?: number; 
  companyName?: string;
}

interface PortfolioItem extends FirestoreHolding {
  pnl: number;
  pnl_percent: number;
  sentiment_score?: number; 
}

// ─── CURRENCY LOGIC ──────────────────────────────────────────
// TODO: Fetch this live from a currency API if needed
const USD_TO_INR = 83.50; 

const isIndianStock = (symbol: string) => symbol.endsWith(".NS") || symbol.endsWith(".BO");
const getNativeCurrency = (symbol: string) => isIndianStock(symbol) ? "INR" : "USD";

const convertCurrency = (value: number, from: "INR" | "USD", to: "INR" | "USD") => {
  if (from === to) return value;
  if (from === "USD" && to === "INR") return value * USD_TO_INR;
  if (from === "INR" && to === "USD") return value / USD_TO_INR;
  return value;
};

// ─── FORMATTERS ──────────────────────────────────────────────
const fmtCurrency = (v: number, curr: "INR" | "USD") =>
  new Intl.NumberFormat(curr === "INR" ? "en-IN" : "en-US", { 
    style: "currency", 
    currency: curr, 
    maximumFractionDigits: 2 
  }).format(v);

const fmtCompact = (v: number, curr: "INR" | "USD") =>
  new Intl.NumberFormat(curr === "INR" ? "en-IN" : "en-US", { 
    style: "currency", 
    currency: curr, 
    notation: "compact", 
    maximumFractionDigits: 1 
  }).format(v);

// ─── SENTIMENT ───────────────────────────────────────────────
function getSentiment(v?: number): { label: string; cls: string; dot: string } {
  if (v === undefined) return { label: "Neutral", cls: "text-gray-500 bg-gray-500/10 border-gray-500/20", dot: "bg-gray-500" };
  if (v > 0.6) return { label: "Bullish", cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-400" };
  if (v < 0.4) return { label: "Bearish", cls: "text-rose-400 bg-rose-500/10 border-rose-500/20", dot: "bg-rose-400" };
  return { label: "Neutral", cls: "text-amber-400 bg-amber-500/10 border-amber-500/20", dot: "bg-amber-400" };
}

// ─── MINI SPARKLINE ──────────────────────────────────────────
function Sparkline({ positive }: { positive: boolean }) {
  const pts = positive
    ? "0,20 10,18 20,15 30,16 40,12 50,10 60,8 70,9 80,5 90,4 100,2"
    : "0,2 10,4 20,5 30,4 40,8 50,10 60,12 70,11 80,15 90,17 100,20";
  const color = positive ? "#34d399" : "#f87171";
  return (
    <svg viewBox="0 0 100 22" className="w-20 h-6" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sg-${positive}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,22 ${pts} 100,22`} fill={`url(#sg-${positive})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── ALLOCATION BAR ──────────────────────────────────────────
function AllocationBar({ items }: { items: { symbol: string; value: number; color: string }[] }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
      {items.map((item) => (
        <motion.div
          key={item.symbol}
          initial={{ flex: 0 }}
          animate={{ flex: item.value / total }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          style={{ backgroundColor: item.color }}
        />
      ))}
    </div>
  );
}

// ─── COMPANY AVATAR ──────────────────────────────────────────
function CompanyAvatar({ symbol, size = "md" }: { symbol: string; size?: "sm" | "md" }) {
  const [err, setErr] = useState(false);
  const clean = symbol.split(".")[0];
  const dim = size === "sm" ? "w-8 h-8 text-xs" : "w-11 h-11 text-sm";
  if (err)
    return (
      <div className={`${dim} rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center font-bold text-white shrink-0`}>
        {clean[0]}
      </div>
    );
  return (
    <img
      src={`https://logo.clearbit.com/${clean.toLowerCase()}.com`}
      alt={symbol}
      onError={() => setErr(true)}
      className={`${dim} rounded-xl object-cover bg-white/5 border border-white/5 shrink-0`}
    />
  );
}

// ─── METRIC CARD ─────────────────────────────────────────────
function MetricCard({
  icon, label, value, sub, accent, delay = 0,
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent?: "green" | "red" | "blue"; delay?: number;
}) {
  const accents = {
    green: { bar: "from-emerald-500 to-emerald-400", glow: "shadow-emerald-500/10", text: "text-emerald-400" },
    red: { bar: "from-rose-500 to-rose-400", glow: "shadow-rose-500/10", text: "text-rose-400" },
    blue: { bar: "from-blue-500 to-cyan-400", glow: "shadow-blue-500/10", text: "text-blue-400" },
  };
  const a = accent ? accents[accent] : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: "easeOut" }}
      className={`relative bg-[#0d0d14] border border-white/[0.06] rounded-2xl p-5 overflow-hidden ${a ? `shadow-lg ${a.glow}` : ""}`}
    >
      {a && (
        <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r ${a.bar} opacity-60`} />
      )}
      <div className="flex items-center gap-2 text-gray-500 text-xs font-medium mb-3 uppercase tracking-widest">
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-bold tracking-tight ${a ? a.text : "text-white"}`}>{value}</div>
      {sub && <div className="text-xs text-gray-600 mt-1 font-mono">{sub}</div>}
    </motion.div>
  );
}

// ─── HOLDING ROW ─────────────────────────────────────────────
const PALETTE = ["#3b82f6", "#06b6d4", "#8b5cf6", "#f59e0b", "#10b981", "#ec4899", "#f97316"];

function HoldingRow({ stock, idx, totalBaseValue, baseCurrency, hideValues, onRemove }: {
  stock: PortfolioItem; idx: number; totalBaseValue: number; baseCurrency: "INR" | "USD"; hideValues: boolean; onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  
  // Calculations in NATIVE currency for display
  const nativeCurrency = getNativeCurrency(stock.symbol);
  const current_price = stock.current_price || stock.price; 
  const nativeInvested = stock.price * stock.quantity;
  const nativeCurrent = current_price * stock.quantity;
  const nativePnlAbs = nativeCurrent - nativeInvested;
  
  // Percentages and allocations 
  const pnlPct = stock.pnl_percent;
  const isUp = pnlPct >= 0;
  
  // Allocation weight requires BASE currency calculation
  const baseCurrentValue = convertCurrency(nativeCurrent, nativeCurrency, baseCurrency);
  const alloc = totalBaseValue > 0 ? (baseCurrentValue / totalBaseValue) * 100 : 0;
  
  const sentiment = getSentiment(stock.sentiment_score);
  const color = PALETTE[idx % PALETTE.length];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.06, duration: 0.4, ease: "easeOut" }}
      className="group relative"
    >
      <div
        className="relative bg-[#0d0d14] border border-white/[0.06] rounded-2xl overflow-hidden cursor-pointer hover:border-white/[0.12] transition-all duration-200 pr-10"
        onClick={() => setExpanded((p) => !p)}
      >
        <div
          className="absolute left-0 top-0 bottom-0 w-[3px] transition-opacity opacity-40 group-hover:opacity-80"
          style={{ backgroundColor: color }}
        />

        <div className="flex items-center gap-4 px-5 py-4 pl-6">
          <CompanyAvatar symbol={stock.symbol} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-bold text-white text-[15px]">{stock.symbol}</span>
              <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border flex items-center gap-1 ${sentiment.cls}`}>
                <span className={`w-1 h-1 rounded-full ${sentiment.dot}`} />
                {sentiment.label}
              </span>
            </div>
            <div className="text-xs text-gray-600 font-mono">
              {stock.quantity} units · avg {hideValues ? "••••" : fmtCurrency(stock.price, nativeCurrency)}
            </div>
          </div>

          <div className="hidden sm:block shrink-0">
            <Sparkline positive={isUp} />
          </div>

          <div className="hidden md:block text-right shrink-0 min-w-[90px]">
            <div className="text-sm font-mono text-gray-300">{hideValues ? "••••" : fmtCurrency(current_price, nativeCurrency)}</div>
            <div className="text-[10px] text-gray-600">market price</div>
          </div>

          <div className="hidden lg:block text-right shrink-0 min-w-[100px]">
            <div className="text-sm font-semibold text-gray-200">{hideValues ? "••••" : fmtCompact(nativeCurrent, nativeCurrency)}</div>
            <div className="text-[10px] text-gray-600">{alloc.toFixed(1)}% of alloc</div>
          </div>

          <div className="text-right shrink-0 min-w-[90px]">
            <div className={`text-base font-bold flex items-center justify-end gap-0.5 ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
              {isUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
              {hideValues ? "••" : `${isUp ? "+" : ""}${pnlPct.toFixed(2)}%`}
            </div>
            <div className={`text-[11px] font-mono ${isUp ? "text-emerald-600" : "text-rose-600"}`}>
              {hideValues ? "••••" : `${isUp ? "+" : ""}${fmtCurrency(nativePnlAbs, nativeCurrency)}`}
            </div>
          </div>

          <ChevronRight
            size={14}
            className={`text-gray-700 transition-transform duration-200 shrink-0 ${expanded ? "rotate-90" : ""}`}
          />
        </div>

        <div className="px-6 pb-3">
          <div className="h-px bg-white/[0.04] rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${alloc}%` }}
              transition={{ duration: 0.9, delay: idx * 0.06, ease: "easeOut" }}
              className="h-full rounded-full"
              style={{ backgroundColor: color }}
            />
          </div>
        </div>
      </div>

      {/* Delete Action (Visible on Hover) */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(stock.id); }}
        className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-2 rounded-xl text-gray-600 hover:text-rose-400 hover:bg-rose-500/10 transition-all z-10"
        title="Remove Position"
      >
        <Trash2 size={16} />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-1 pt-2 pb-1">
              {[
                { label: "Avg Buy Price", value: fmtCurrency(stock.price, nativeCurrency) },
                { label: "Current Price", value: fmtCurrency(current_price, nativeCurrency) },
                { label: "Invested", value: fmtCurrency(nativeInvested, nativeCurrency) },
                { label: "Current Value", value: fmtCurrency(nativeCurrent, nativeCurrency) },
              ].map((d) => (
                <div key={d.label} className="bg-[#0d0d14] border border-white/[0.05] rounded-xl px-4 py-3">
                  <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">{d.label}</div>
                  <div className="text-sm font-mono font-semibold text-gray-300">
                    {hideValues ? "••••" : d.value}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── SKELETON ────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[76px] bg-white/[0.03] rounded-2xl animate-pulse border border-white/[0.04]" />
      ))}
    </div>
  );
}

// ─── MAIN PAGE ───────────────────────────────────────────────
export default function Portfolio() {
  // 1. Auth & Base State
  const { user, loading: authLoading } = useAuth();
  const [baseCurrency, setBaseCurrency] = useState<"INR" | "USD">("INR");
  
  // 2. Data State
  const [holdings, setHoldings] = useState<FirestoreHolding[]>([]);
  const [loadingHoldings, setLoadingHoldings] = useState(true);
  
  // 3. UI State
  const [hideValues, setHideValues] = useState(false);
  const [sortBy, setSortBy] = useState<"value" | "pnl" | "alloc">("value");

  // 4. Add Form State
  const [showAdd, setShowAdd] = useState(false);
  const [nSym, setNSym] = useState("");
  const [nQty, setNQty] = useState("");
  const [nPrc, setNPrc] = useState("");
  const [adding, setAdding] = useState(false);

  // ─── EFFECT: AUTH TOAST ────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !user) {
      toast.error("Please log in to view your personalized portfolio.", {
        style: { background: '#1e1e2d', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }
      });
      setLoadingHoldings(false);
    }
  }, [user, authLoading]);

  // ─── EFFECT: FIRESTORE REAL-TIME SYNC ──────────────────────
  useEffect(() => {
    if (!user) return;

    setLoadingHoldings(true);
    const portfolioRef = collection(db, "users", user.uid, "portfolio");
    const q = query(portfolioRef);

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedHoldings: FirestoreHolding[] = [];
      snapshot.forEach((doc) => {
        fetchedHoldings.push({ id: doc.id, ...doc.data() } as FirestoreHolding);
      });
      setHoldings(fetchedHoldings);
      setLoadingHoldings(false);
    }, (error) => {
      console.error("Firestore error:", error);
      toast.error("Failed to sync portfolio data.");
      setLoadingHoldings(false);
    });

    return () => unsubscribe();
  }, [user]);

  // ─── HANDLERS: ADD / REMOVE ────────────────────────────────
  const handleAdd = async () => {
    if (!user) return;
    if (!nSym.trim() || !nQty || !nPrc || isNaN(+nQty) || isNaN(+nPrc) || +nQty <= 0 || +nPrc <= 0) {
      toast.error("All fields required and must be valid numbers");
      return;
    }
    setAdding(true);
    try {
      await addDoc(collection(db, "users", user.uid, "portfolio"), {
        symbol: nSym.trim().toUpperCase(),
        quantity: +nQty,
        price: +nPrc,
        companyName: nSym.toUpperCase(),
      });
      toast.success("Position added");
      setNSym("");
      setNQty("");
      setNPrc("");
      setShowAdd(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to add position");
    }
    setAdding(false);
  };

  const handleRemove = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, "users", user.uid, "portfolio", id));
      toast.success("Position removed");
    } catch (error) {
      toast.error("Failed to remove position");
    }
  };

  // ─── MEMOIZED DATA MERGE ───────────────────────────────────
  const mergedData: PortfolioItem[] = useMemo(() => {
    return holdings.map(h => {
      const current_price = h.current_price || h.price; 
      const invested = h.price * h.quantity;
      const current_value = current_price * h.quantity;
      const pnl = current_value - invested;
      const pnl_percent = invested > 0 ? (pnl / invested) * 100 : 0;

      return {
        ...h,
        current_price,
        pnl,
        pnl_percent,
        sentiment_score: pnl_percent > 5 ? 0.8 : pnl_percent < -5 ? 0.2 : 0.5 
      };
    });
  }, [holdings]);

  // ─── CALCULATIONS (BASE CURRENCY NORMALIZED) ───────────────
  const metrics = useMemo(() => {
    let investedBase = 0, currentBase = 0;
    
    mergedData.forEach((s) => {
      const nativeCurrency = getNativeCurrency(s.symbol);
      const nativeInvested = s.price * s.quantity;
      const nativeCurrent = (s.current_price || s.price) * s.quantity;
      
      investedBase += convertCurrency(nativeInvested, nativeCurrency, baseCurrency);
      currentBase += convertCurrency(nativeCurrent, nativeCurrency, baseCurrency);
    });
    
    const pnlBase = currentBase - investedBase;
    const pnlPct = investedBase > 0 ? (pnlBase / investedBase) * 100 : 0;
    
    return { invested: investedBase, current: currentBase, pnl: pnlBase, pnlPct, up: pnlBase >= 0 };
  }, [mergedData, baseCurrency]);

  const sorted = useMemo(() => {
    return [...mergedData].sort((a, b) => {
      const currA = getNativeCurrency(a.symbol);
      const currB = getNativeCurrency(b.symbol);
      
      const valA = convertCurrency((a.current_price || a.price) * a.quantity, currA, baseCurrency);
      const valB = convertCurrency((b.current_price || b.price) * b.quantity, currB, baseCurrency);
      
      if (sortBy === "pnl") return b.pnl_percent - a.pnl_percent;
      if (sortBy === "alloc") return valB - valA;
      return valB - valA;
    });
  }, [mergedData, sortBy, baseCurrency]);

  const allocationItems = useMemo(() => 
    [...mergedData]
      .map(s => {
        const nativeCurrency = getNativeCurrency(s.symbol);
        const nativeVal = (s.current_price || s.price) * s.quantity;
        return {
          symbol: s.symbol,
          value: convertCurrency(nativeVal, nativeCurrency, baseCurrency),
        };
      })
      .sort((a, b) => b.value - a.value)
      .map((s, i) => ({
        ...s,
        color: PALETTE[i % PALETTE.length],
      })),
    [mergedData, baseCurrency]
  );

  const bestPerformer = useMemo(
    () => mergedData.length > 0 ? [...mergedData].sort((a, b) => b.pnl_percent - a.pnl_percent)[0] : null,
    [mergedData]
  );

  const isLoading = authLoading || loadingHoldings;

  return (
    <main className="min-h-screen bg-[#080810] text-white font-sans antialiased pb-24 selection:bg-blue-500/20">
      <Toaster position="bottom-right" />
      {/* Background */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-blue-600/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-cyan-600/5 rounded-full blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      <div className="max-w-5xl mx-auto px-4 md:px-6 pt-24">
        {/* ── HEADER ── */}
        <div className="flex items-start justify-between mb-10 gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <PieChart size={16} className="text-blue-400" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Portfolio</h1>
            </div>
            <p className="text-sm text-gray-600 ml-[42px]">Real-time asset performance and exposure</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* BASE CURRENCY TOGGLE */}
            <button
              onClick={() => setBaseCurrency(p => p === "INR" ? "USD" : "INR")}
              className="px-3 h-9 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] flex items-center justify-center text-gray-400 hover:text-white font-bold text-xs transition-all"
              title={`Switch dashboard currency (Currently ${baseCurrency})`}
            >
              {baseCurrency}
            </button>
            
            <button
              onClick={() => setHideValues((p) => !p)}
              className="w-9 h-9 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] flex items-center justify-center text-gray-500 hover:text-gray-300 transition-all"
              title={hideValues ? "Show values" : "Hide values"}
            >
              {hideValues ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            <button
              onClick={() => setShowAdd((p) => !p)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600/90 hover:bg-blue-500 text-white text-sm font-semibold transition-all shadow-lg shadow-blue-500/20"
            >
              <Plus size={14} /> Add Position
            </button>
          </div>
        </div>

        {/* ── AUTH GUARD / UNAUTHENTICATED STATE ── */}
        {!authLoading && !user && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-center py-24 border border-white/[0.05] rounded-2xl bg-white/[0.01]">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/15 flex items-center justify-center mx-auto mb-5">
              <Lock className="text-rose-400" size={26} />
            </div>
            <h3 className="text-lg font-bold mb-2">Authentication Required</h3>
            <p className="text-sm text-gray-500 max-w-sm mx-auto mb-7">
              Connect your account to sync your personal holdings across devices.
            </p>
            <Link href="/login" className="inline-flex items-center gap-2 bg-white text-black px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200 transition-all">
              Log In
            </Link>
          </motion.div>
        )}

        {/* ── ADD ASSET FORM (Animated Dropdown) ── */}
        {user && (
          <AnimatePresence>
            {showAdd && (
              <motion.div
                initial={{ height: 0, opacity: 0, marginBottom: 0 }}
                animate={{ height: "auto", opacity: 1, marginBottom: 24 }}
                exit={{ height: 0, opacity: 0, marginBottom: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-[#0a0c10] border border-blue-500/20 shadow-[0_0_30px_rgba(59,130,246,0.05)] rounded-2xl p-6 space-y-5">
                  <div className="flex items-center gap-2 text-blue-400 font-semibold mb-2">
                    <Plus size={16} /> Add New Holding
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                      { l: "Asset Symbol", v: nSym, s: (v: string) => setNSym(v.toUpperCase()), ph: "e.g., AAPL or RELIANCE.NS", t: "text" },
                      { l: "Quantity", v: nQty, s: setNQty, ph: "e.g., 10", t: "number" },
                      { l: "Average Buy Price", v: nPrc, s: setNPrc, ph: "e.g., 150.00", t: "number" },
                    ].map((f) => (
                      <div key={f.l}>
                        <label className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider block mb-2">
                          {f.l}
                        </label>
                        <input
                          value={f.v}
                          onChange={(e) => f.s(e.target.value)}
                          placeholder={f.ph}
                          type={f.t}
                          className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-3 text-white text-sm outline-none focus:bg-white/[0.05] focus:border-blue-500/40 placeholder-gray-700 transition-all"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={handleAdd}
                      disabled={adding}
                      className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-bold text-sm transition-all"
                    >
                      {adding ? "Adding…" : "Save Position"}
                    </button>
                    <button
                      onClick={() => setShowAdd(false)}
                      className="px-6 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.07] font-bold text-sm text-gray-400 hover:text-white transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {/* ── METRICS ── */}
        {user && !isLoading && mergedData.length > 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <MetricCard
                icon={<Wallet size={13} />}
                label={`Portfolio Value (${baseCurrency})`}
                value={hideValues ? "••••" : fmtCompact(metrics.current, baseCurrency)}
                sub={hideValues ? undefined : `Invested ${fmtCompact(metrics.invested, baseCurrency)}`}
                accent="blue"
              />
              <MetricCard
                icon={<Activity size={13} />}
                label="Total Return"
                value={hideValues ? "••" : `${metrics.up ? "+" : ""}${metrics.pnlPct.toFixed(2)}%`}
                sub={hideValues ? undefined : `${metrics.up ? "+" : ""}${fmtCurrency(metrics.pnl, baseCurrency)}`}
                accent={metrics.up ? "green" : "red"}
                delay={0.05}
              />
              <MetricCard
                icon={<Layers size={13} />}
                label="Holdings"
                value={`${mergedData.length}`}
                sub="assets tracked"
                delay={0.1}
              />
              <MetricCard
                icon={<BarChart2 size={13} />}
                label="Best Performer"
                value={bestPerformer?.symbol ?? "—"}
                sub={bestPerformer ? `+${bestPerformer.pnl_percent.toFixed(2)}%` : undefined}
                accent="green"
                delay={0.15}
              />
            </div>

            {/* Allocation bar */}
            <div className="bg-[#0d0d14] border border-white/[0.06] rounded-2xl px-5 py-4 mb-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-gray-600 uppercase tracking-widest font-medium">Allocation</span>
                <div className="flex items-center gap-3 flex-wrap justify-end">
                  {allocationItems.slice(0, 5).map((item) => (
                    <div key={item.symbol} className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-[10px] text-gray-500 font-medium">{item.symbol}</span>
                    </div>
                  ))}
                </div>
              </div>
              <AllocationBar items={allocationItems} />
            </div>
          </>
        )}

        {/* ── LOADING ── */}
        {isLoading && (
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-24 bg-white/[0.03] rounded-2xl animate-pulse border border-white/[0.04]" />
              ))}
            </div>
            <Skeleton />
          </div>
        )}

        {/* ── HOLDINGS ── */}
        {user && !isLoading && mergedData.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Holdings</h2>
              <div className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.06] rounded-xl p-1">
                {(["value", "pnl", "alloc"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSortBy(s)}
                    className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                      sortBy === s ? "bg-white/10 text-white" : "text-gray-600 hover:text-gray-400"
                    }`}
                  >
                    {s === "value" ? `Value (${baseCurrency})` : s === "pnl" ? "Return" : "Weight"}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2.5">
              {sorted.map((stock, i) => (
                <HoldingRow
                  key={`${stock.id}`}
                  stock={stock} 
                  idx={mergedData.indexOf(stock)}
                  totalBaseValue={metrics.current}
                  baseCurrency={baseCurrency}
                  hideValues={hideValues}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── EMPTY STATE ── */}
        {user && !isLoading && mergedData.length === 0 && !showAdd && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-center py-24 border border-white/[0.05] border-dashed rounded-2xl bg-white/[0.01] mt-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/15 flex items-center justify-center mx-auto mb-5">
              <Briefcase className="text-blue-400" size={26} />
            </div>
            <h3 className="text-lg font-bold mb-2">No holdings yet</h3>
            <p className="text-sm text-gray-500 max-w-sm mx-auto mb-7">
              Start tracking your investments to unlock real-time portfolio analytics.
            </p>
            <button 
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-lg shadow-blue-500/20"
            >
              <Plus size={16} /> Add First Position
            </button>
          </motion.div>
        )}
      </div>
    </main>
  );
}