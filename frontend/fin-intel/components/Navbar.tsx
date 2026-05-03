"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, Menu, X, User, Settings, LogOut,
  Search, Bell, Bookmark, ChevronRight, TrendingUp,
  TrendingDown, BarChart2, Briefcase, Command, Plus, BellOff, CheckCircle2, Trash2
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase"; 
import { collection, onSnapshot, doc, addDoc, deleteDoc, query } from "firebase/firestore";
import toast from "react-hot-toast";

// ─────────────────────────────────────────────
// TYPES & CONSTANTS
// ─────────────────────────────────────────────
const NAV_LINKS = [
  { name: "Home", path: "/" },
  { name: "Dashboard", path: "/dashboard" },
  { name: "Compare", path: "/compare" },
  { name: "Portfolio", path: "/portfolio" },
];

// ─────────────────────────────────────────────
// MOCK DATA FALLBACKS
// ─────────────────────────────────────────────
const MOCK_WATCHLIST: FirestoreWatchlist[] = [
  { id: "mock1", symbol: "AAPL", name: "Apple Inc." },
  { id: "mock2", symbol: "RELIANCE.NS", name: "Reliance Ind." },
  { id: "mock3", symbol: "BTC", name: "Bitcoin" },
  { id: "mock4", symbol: "TSLA", name: "Tesla Inc." },
];

interface FirestoreWatchlist {
  id: string;
  symbol: string;
  name: string;
}

interface FirestoreHolding {
  id: string;
  symbol: string;
  quantity: number;
  price: number; 
}

// ─── CURRENCY LOGIC ──────────────────────────────────────────
const isIndianStock = (symbol: string) => symbol.endsWith(".NS") || symbol.endsWith(".BO");
const getNativeCurrency = (symbol: string) => isIndianStock(symbol) ? "INR" : "USD";

const fmtCurrency = (v: number, curr: "INR" | "USD") =>
  new Intl.NumberFormat(curr === "INR" ? "en-IN" : "en-US", { 
    style: "currency", currency: curr, maximumFractionDigits: 2 
  }).format(v);

function checkIsIndianMarketOpen(): boolean {
  const now = new Date();
  const ist = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 5.5 * 3600000);
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const t = ist.getHours() * 60 + ist.getMinutes();
  return t >= 555 && t <= 930;
}

// ─────────────────────────────────────────────
// CUSTOM HOOK: ALERTS
// ─────────────────────────────────────────────
export interface AlertItem {
  id?: string;
  symbol: string;
  target_price: number;
  condition: "above" | "below";
  note?: string;
  triggered: boolean;
  created_at: number;
}

function useFirestoreAlerts(uid?: string) {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!uid) { setAlerts([]); return; }
    setLoading(true);
    const q = query(collection(db, "users", uid, "alerts"));
    return onSnapshot(q, (s) => {
      setAlerts(s.docs.map((d) => ({ id: d.id, ...d.data() }) as AlertItem));
      setLoading(false);
    });
  }, [uid]);

  const add = useCallback(
    async (a: Omit<AlertItem, "id" | "triggered" | "created_at">) => {
      if (!uid) { toast.error("Sign in first"); return; }
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

// ─────────────────────────────────────────────
// AVATAR COMPONENT
// ─────────────────────────────────────────────
const Avatar = ({ user, size = 32 }: { user: { displayName?: string | null; email?: string | null; photoURL?: string | null }; size?: number }) => {
  const [imgError, setImgError] = useState(false);
  const initials = (user.displayName || user.email || "U").slice(0, 2).toUpperCase();

  if (user.photoURL && !imgError) {
    return (
      <img
        src={user.photoURL}
        alt="Avatar"
        width={size} height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
        onError={() => setImgError(true)}
      />
    );
  }

  const colors = ["from-blue-600 to-cyan-500", "from-violet-600 to-blue-500", "from-emerald-600 to-teal-500"];
  const colorIdx = initials.charCodeAt(0) % colors.length;
  return (
    <div
      className={`rounded-full bg-gradient-to-br ${colors[colorIdx]} flex items-center justify-center font-bold text-white`}
      style={{ width: size, height: size, fontSize: size * 0.35 }}
    >
      {initials}
    </div>
  );
};

// ─────────────────────────────────────────────
// GLOBAL SEARCH COMMAND PALETTE
// ─────────────────────────────────────────────
const CommandPalette = ({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (sym: string) => void }) => {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (open) { setQuery(""); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  const quickLinks = [
    { label: "Dashboard", path: "/dashboard", icon: <BarChart2 size={16} /> },
    { label: "Portfolio", path: "/portfolio", icon: <Briefcase size={16} /> },
    { label: "Compare Stocks", path: "/compare", icon: <TrendingUp size={16} /> },
    { label: "Profile & Settings", path: "/profile", icon: <User size={16} /> },
  ];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-md z-[900]" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -12 }}
            transition={{ type: "spring", stiffness: 500, damping: 40 }}
            className="fixed top-[18%] left-1/2 -translate-x-1/2 w-full max-w-xl z-[900] px-4"
          >
            <div className="bg-[#0c0c0c] border border-white/10 rounded-2xl shadow-[0_40px_100px_rgba(0,0,0,0.7)] overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06]">
                <Search size={18} className="text-blue-400 flex-shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === "Enter" && query.trim()) { onNavigate(query.trim()); onClose(); } if (e.key === "Escape") onClose(); }}
                  placeholder="Search stocks, crypto, indices…"
                  className="flex-1 bg-transparent text-white text-base outline-none placeholder-gray-600 font-medium"
                />
                {query && <button onClick={() => setQuery("")} className="text-gray-600 hover:text-white transition-colors"><X size={16} /></button>}
                <kbd className="hidden sm:flex items-center gap-1 text-[10px] text-gray-600 bg-white/5 border border-white/10 px-2 py-1 rounded-lg font-mono">ESC</kbd>
              </div>

              {!query && (
                <div className="p-3">
                  <p className="text-[10px] text-gray-600 font-semibold uppercase tracking-widest px-3 mb-2">Quick Navigate</p>
                  {quickLinks.map(link => (
                    <button key={link.path} onClick={() => { router.push(link.path); onClose(); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.04] transition-colors text-gray-300 hover:text-white text-sm">
                      <span className="text-gray-500">{link.icon}</span> {link.label}
                      <ChevronRight size={14} className="ml-auto text-gray-700" />
                    </button>
                  ))}
                </div>
              )}

              {query && (
                <div className="p-3">
                  <button
                    onClick={() => { onNavigate(query); onClose(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/15 transition-colors text-sm font-semibold"
                  >
                    <BarChart2 size={16} /> Analyze <span className="font-black">{query}</span>
                    <ChevronRight size={14} className="ml-auto" />
                  </button>
                </div>
              )}

              <div className="px-5 py-3 border-t border-white/[0.05] flex items-center gap-4 text-[10px] text-gray-600">
                <span className="flex items-center gap-1.5"><kbd className="bg-white/5 border border-white/10 px-1.5 py-0.5 rounded font-mono">↵</kbd> Analyze</span>
                <span className="flex items-center gap-1.5"><kbd className="bg-white/5 border border-white/10 px-1.5 py-0.5 rounded font-mono">ESC</kbd> Close</span>
                <span className="flex items-center gap-1.5 ml-auto"><kbd className="bg-white/5 border border-white/10 px-1.5 py-0.5 rounded font-mono">/</kbd> Open anywhere</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

// ─────────────────────────────────────────────
// WATCHLIST PANEL
// ─────────────────────────────────────────────
const WatchlistPanel = ({ open, watchlist, livePrices }: { open: boolean, watchlist: FirestoreWatchlist[], livePrices: Record<string, any> }) => {
  const router = useRouter();
  
  // Fallback to mock data if Firestore is empty for testing UI
  const displayList = watchlist.length > 0 ? watchlist : MOCK_WATCHLIST;

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 400, damping: 35 }}
          className="absolute right-0 mt-3 w-72 bg-[#0c0c0c] border border-white/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] overflow-hidden z-[900]">
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
            <span className="text-sm font-bold">Watchlist</span>
            <button onClick={() => router.push("/profile?tab=watchlist")} className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1">
              Manage <ChevronRight size={11} />
            </button>
          </div>
          <div className="py-1 max-h-72 overflow-y-auto">
            {displayList.map((item, index) => {
              // Provide an immediate visual fallback for mock data before live polling catches up
              const fallbackPrice = 150 + (index * 45);
              const liveData = livePrices[item.symbol] || { price: fallbackPrice, changeStr: "+1.24%", isUp: true };
              const curr = getNativeCurrency(item.symbol);
              
              return (
                <button key={item.symbol} onClick={() => router.push(`/dashboard?symbol=${item.symbol}`)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.04] transition-colors group">
                  <div className="flex items-center gap-3 text-left">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-white/[0.07] to-white/[0.02] border border-white/[0.07] flex items-center justify-center text-[9px] font-bold text-blue-400">
                      {item.symbol.slice(0, 2)}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white">{item.symbol}</p>
                      <p className="text-[10px] text-gray-500 truncate max-w-[90px]">{item.name}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-white">{fmtCurrency(liveData.price, curr)}</p>
                    <p className={`text-[10px] font-medium flex items-center justify-end gap-0.5 ${liveData.isUp ? "text-emerald-400" : "text-rose-400"}`}>
                      {liveData.isUp ? <TrendingUp size={9} /> : <TrendingDown size={9} />} {liveData.changeStr}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
          <div className="px-4 py-3 border-t border-white/[0.06]">
            <button onClick={() => router.push("/dashboard")} className="w-full py-2 rounded-xl text-xs font-semibold bg-blue-500/10 text-blue-400 hover:bg-blue-500/15 border border-blue-500/20 transition-colors">
              Open Full Dashboard
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ─────────────────────────────────────────────
// ALERTS PANEL (Replaces NotificationsPanel)
// ─────────────────────────────────────────────
const AlertsPanel = ({ 
  open, 
  alertsStore, 
  onSelectSymbol 
}: { 
  open: boolean; 
  alertsStore: ReturnType<typeof useFirestoreAlerts>; 
  onSelectSymbol: (sym: string) => void; 
}) => {
  const { alerts, loading, add, remove } = alertsStore;
  const [showAdd, setShowAdd] = useState(false);
  const [sym, setSym] = useState("");
  const [price, setPrice] = useState("");
  const [cond, setCond] = useState<"above" | "below">("above");
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "triggered">("all");

  const handleAdd = async () => {
    if (!sym.trim() || !price || isNaN(+price) || +price <= 0) {
      toast.error("Enter a valid symbol and price");
      return;
    }
    setAdding(true);
    try {
      await add({ symbol: sym.trim().toUpperCase(), target_price: +price, condition: cond });
      setShowAdd(false);
      setSym(""); setPrice("");
    } catch (e: any) {
      toast.error(e.message || "Failed to set alert");
    }
    setAdding(false);
  };

  const shown = filter === "active" ? alerts.filter((a) => !a.triggered) 
              : filter === "triggered" ? alerts.filter((a) => a.triggered) 
              : alerts;

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 400, damping: 35 }}
          className="absolute right-0 mt-3 w-96 bg-[#0c0c0c] border border-white/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] overflow-hidden z-[900]">
          
          {/* Header */}
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">Price Alerts</span>
              <span className="text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-full">
                {alerts.length}
              </span>
            </div>
            <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-1 text-[11px] font-bold text-amber-400 hover:text-amber-300 transition-colors">
              <Plus size={12} /> New
            </button>
          </div>

          {/* Add Alert Form Dropdown */}
          <AnimatePresence>
            {showAdd && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="p-4 bg-black/40 border-b border-white/[0.06] space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[9px] text-gray-500 font-bold uppercase tracking-wider block mb-1">Symbol</label>
                      <input value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} placeholder="AAPL" className="w-full bg-white/[0.04] border border-white/[0.07] rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-amber-500/40" />
                    </div>
                    <div>
                      <label className="text-[9px] text-gray-500 font-bold uppercase tracking-wider block mb-1">Target Price</label>
                      <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="150.00" className="w-full bg-white/[0.04] border border-white/[0.07] rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-amber-500/40" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(["above", "below"] as const).map((c) => (
                      <button key={c} onClick={() => setCond(c)} className={`py-1.5 rounded-lg text-[10px] font-bold transition-all ${cond === c ? (c === "above" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" : "bg-rose-500/15 text-rose-400 border-rose-500/25") : "bg-white/[0.03] text-gray-500 border border-white/[0.06]"}`}>
                        {c === "above" ? "↑ Above" : "↓ Below"}
                      </button>
                    ))}
                  </div>
                  <button onClick={handleAdd} disabled={adding} className="w-full py-2 rounded-lg bg-amber-500/80 hover:bg-amber-500 text-black disabled:opacity-50 font-bold text-xs mt-1 transition-colors">
                    {adding ? "Creating…" : "Save Alert"}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Filters */}
          <div className="px-3 py-2 border-b border-white/[0.04] flex gap-1 bg-[#0a0c10]">
            {(["all", "active", "triggered"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${filter === f ? "bg-amber-500/10 text-amber-400" : "text-gray-500 hover:text-gray-300"}`}>
                {f}
              </button>
            ))}
          </div>

          {/* Alert List */}
          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <div className="px-4 py-6 text-center text-xs text-gray-500 animate-pulse">Loading alerts...</div>
            ) : shown.length === 0 ? (
              <div className="px-4 py-8 flex flex-col items-center text-center">
                <BellOff size={24} className="text-gray-700 mb-2" />
                <p className="text-xs text-gray-500">No alerts found</p>
              </div>
            ) : (
              shown.map((alert) => (
                <div key={alert.id} className={`group flex items-center justify-between px-4 py-3 border-b border-white/[0.04] transition-colors ${alert.triggered ? "bg-emerald-500/[0.03]" : "hover:bg-white/[0.02]"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${alert.triggered ? "bg-emerald-500/15" : alert.condition === "above" ? "bg-emerald-500/10" : "bg-rose-500/10"}`}>
                      {alert.triggered ? <CheckCircle2 size={14} className="text-emerald-400" /> : alert.condition === "above" ? <TrendingUp size={14} className="text-emerald-400" /> : <TrendingDown size={14} className="text-rose-400" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => onSelectSymbol(alert.symbol)} className="text-sm font-bold text-white hover:text-blue-400 transition-colors">{alert.symbol}</button>
                        {alert.triggered && <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full">Triggered</span>}
                      </div>
                      <p className={`text-[10px] font-semibold mt-0.5 ${alert.condition === "above" ? "text-emerald-400" : "text-rose-400"}`}>
                        {alert.condition} {alert.target_price.toFixed(2)}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => alert.id && remove(alert.id)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-gray-600 hover:text-rose-400 hover:bg-rose-500/10 transition-all">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ─────────────────────────────────────────────
// PROFILE DROPDOWN
// ─────────────────────────────────────────────
const ProfileDropdown = ({ open, user, stats, onClose }: {
  open: boolean;
  user: { displayName?: string | null; email?: string | null; photoURL?: string | null };
  stats: { totalValue: number; totalPnlPct: number; alerts: number };
  onClose: () => void;
}) => {
  const router = useRouter();

  const navigate = (path: string) => { router.push(path); onClose(); };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      toast.success("Signed out successfully");
      router.push("/login");
      onClose();
    } catch {
      toast.error("Sign out failed");
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 400, damping: 35 }}
          className="absolute right-0 mt-3 w-68 bg-[#0c0c0c] border border-white/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] overflow-hidden z-[900]" style={{ width: 272 }}>

          {/* User Header */}
          <div className="p-4 bg-gradient-to-b from-white/[0.04] to-transparent border-b border-white/[0.06]">
            <div className="flex items-center gap-3 mb-3">
              <Avatar user={user} size={40} />
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">{user.displayName || "Investor"}</p>
                <p className="text-[11px] text-gray-500 truncate">{user.email}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Value", value: fmtCurrency(stats.totalValue, "USD"), color: "text-blue-400" }, 
                { label: "Alerts", value: stats.alerts.toString(), color: "text-amber-400" }, 
                { label: "Return", value: `${stats.totalPnlPct > 0 ? "+" : ""}${stats.totalPnlPct.toFixed(1)}%`, color: stats.totalPnlPct >= 0 ? "text-emerald-400" : "text-rose-400" }
              ].map(stat => (
                <div key={stat.label} className="bg-black/40 rounded-xl p-2 text-center border border-white/[0.04]">
                  <p className={`text-xs font-bold truncate ${stat.color}`}>{stat.value}</p>
                  <p className="text-[9px] text-gray-600 uppercase tracking-wider mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="p-2">
            {[
              { icon: <User size={15} />, label: "My Profile", path: "/profile" },
              { icon: <Bookmark size={15} />, label: "Watchlist", path: "/profile?tab=watchlist" },
              { icon: <Briefcase size={15} />, label: "Portfolio", path: "/portfolio" },
              { icon: <Settings size={15} />, label: "Preferences", path: "/settings" },
            ].map(item => (
              <button key={item.path} onClick={() => navigate(item.path)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-gray-400 hover:text-white hover:bg-white/[0.04] rounded-xl transition-all group">
                <div className="flex items-center gap-3">
                  <span className="group-hover:text-blue-400 transition-colors">{item.icon}</span>
                  {item.label}
                </div>
                <ChevronRight size={13} className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600" />
              </button>
            ))}
          </div>

          <div className="p-2 border-t border-white/[0.06]">
            <button onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all">
              <LogOut size={15} /> Sign Out
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ─────────────────────────────────────────────
// MOBILE MENU
// ─────────────────────────────────────────────
const MobileMenu = ({ open, onClose, user, pathname, watchlist, livePrices }: {
  open: boolean; onClose: () => void;
  user: { displayName?: string | null; email?: string | null; photoURL?: string | null } | null;
  pathname: string;
  watchlist: FirestoreWatchlist[];
  livePrices: Record<string, any>;
}) => {
  const router = useRouter();

  const navigate = (path: string) => { router.push(path); onClose(); };

  const handleSignOut = async () => {
    try { await signOut(auth); toast.success("Signed out"); router.push("/login"); onClose(); }
    catch { toast.error("Sign out failed"); }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-md z-[900]" onClick={onClose} />
          <motion.div
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            className="fixed top-0 right-0 bottom-0 w-[88vw] max-w-sm bg-[#080808] border-l border-white/[0.07] z-[900] flex flex-col overflow-hidden"
          >
            <div className="px-6 pt-8 pb-5 border-b border-white/[0.06]">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center">
                    <Activity size={14} className="text-white" />
                  </div>
                  <span className="font-bold text-white">FinIntel</span>
                </div>
                <button onClick={onClose} className="p-2 rounded-xl bg-white/[0.05] border border-white/[0.07] text-gray-400 hover:text-white transition-colors">
                  <X size={18} />
                </button>
              </div>

              {user ? (
                <div className="flex items-center gap-4 bg-gradient-to-r from-white/[0.05] to-transparent p-4 rounded-2xl border border-white/[0.07]">
                  <Avatar user={user} size={48} />
                  <div className="min-w-0">
                    <p className="font-bold text-white truncate">{user.displayName || "Investor"}</p>
                    <p className="text-xs text-gray-500 truncate">{user.email}</p>
                    <button onClick={() => navigate("/profile")} className="text-[11px] text-blue-400 mt-1 flex items-center gap-1">
                      View Profile <ChevronRight size={11} />
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => navigate("/login")} className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 font-bold text-white text-sm">
                  Log In / Register
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6">
              <div>
                <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-2 mb-2">Navigate</p>
                <div className="space-y-1">
                  {NAV_LINKS.map(link => (
                    <button key={link.path} onClick={() => navigate(link.path)}
                      className={`w-full text-left px-4 py-3 rounded-xl font-semibold text-sm transition-all ${pathname === link.path ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" : "text-gray-300 hover:bg-white/[0.04] hover:text-white"}`}>
                      {link.name}
                    </button>
                  ))}
                </div>
              </div>

              {user && (
                <div>
                  <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-2 mb-2">Account</p>
                  <div className="space-y-1">
                    {[
                      { icon: <Bookmark size={16} />, label: "Watchlist", path: "/profile?tab=watchlist" },
                      { icon: <Briefcase size={16} />, label: "Portfolio", path: "/portfolio" },
                      { icon: <Settings size={16} />, label: "Preferences", path: "/settings" },
                    ].map(item => (
                      <button key={item.path} onClick={() => navigate(item.path)}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-gray-300 hover:bg-white/[0.04] hover:text-white transition-all">
                        <span className="text-gray-500">{item.icon}</span> {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Watchlist preview */}
              {user && (
                <div>
                  <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-2 mb-2">Quick Watchlist</p>
                  <div className="space-y-1">
                    {(watchlist.length > 0 ? watchlist : MOCK_WATCHLIST).slice(0, 3).map((item, index) => {
                      const fallbackPrice = 150 + (index * 45);
                      const liveData = livePrices[item.symbol] || { price: fallbackPrice, changeStr: "+1.24%", isUp: true };
                      return (
                        <button key={item.symbol} onClick={() => navigate(`/dashboard?symbol=${item.symbol}`)}
                          className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl hover:bg-white/[0.04] transition-colors">
                          <span className="text-sm font-bold text-white">{item.symbol}</span>
                          <span className={`text-xs font-semibold ${liveData.isUp ? "text-emerald-400" : "text-rose-400"}`}>{liveData.changeStr}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {user && (
              <div className="px-4 pb-6 pt-3 border-t border-white/[0.06]">
                <button onClick={handleSignOut}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 transition-all">
                  <LogOut size={16} /> Sign Out
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

// ─────────────────────────────────────────────
// MAIN NAVBAR
// ─────────────────────────────────────────────
export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useAuth();

  // UI State
  const [isScrolled, setIsScrolled] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  // Dynamic Data State
  const [watchlist, setWatchlist] = useState<FirestoreWatchlist[]>([]);
  const [holdings, setHoldings] = useState<FirestoreHolding[]>([]);
  const [livePrices, setLivePrices] = useState<Record<string, any>>({});
  
  // Custom Hook specifically for Alerts
  const alertsStore = useFirestoreAlerts(user?.uid);

  const profileRef = useRef<HTMLDivElement>(null);
  const alertsRef = useRef<HTMLDivElement>(null);
  const watchlistRef = useRef<HTMLDivElement>(null);

  // ─── FIRESTORE LISTENERS (Portfolio & Watchlist) ───
  useEffect(() => {
    if (!user) return;

    const unsubWatchlist = onSnapshot(collection(db, "users", user.uid, "watchlist"), (snap) => {
      const data: FirestoreWatchlist[] = [];
      snap.forEach(doc => data.push({ id: doc.id, ...doc.data() } as FirestoreWatchlist));
      setWatchlist(data);
    });

    const unsubPortfolio = onSnapshot(collection(db, "users", user.uid, "portfolio"), (snap) => {
      const data: FirestoreHolding[] = [];
      snap.forEach(doc => data.push({ id: doc.id, ...doc.data() } as FirestoreHolding));
      setHoldings(data);
    });

    return () => { unsubWatchlist(); unsubPortfolio(); };
  }, [user]);

  // ─── LIVE PRICE POLLING ───
  useEffect(() => {
    if (!user) return;
    const allSymbols = Array.from(new Set([...watchlist.map(w => w.symbol), ...holdings.map(h => h.symbol)]));
    if (allSymbols.length === 0) return;

    const fetchPrices = async () => {
      // TODO: Replace with your actual backend Scraper/API logic
      const mockPrices: Record<string, any> = {};
      allSymbols.forEach(sym => {
        const currentPrice = Math.random() * 5000 + 100;
        const isUp = Math.random() > 0.5;
        mockPrices[sym] = {
          price: currentPrice,
          changeStr: `${isUp ? "+" : "-"}${(Math.random() * 5).toFixed(2)}%`,
          isUp
        };
      });
      setLivePrices(prev => ({ ...prev, ...mockPrices }));
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 15000);
    return () => clearInterval(interval);
  }, [watchlist, holdings, user]);

  // ─── DERIVED STATS ───
  // Calculate Triggered alerts for the Red Notification Badge
  const triggeredAlertCount = alertsStore.alerts.filter(a => a.triggered).length;
  
  const profileStats = useMemo(() => {
    let invested = 0, current = 0;
    holdings.forEach(h => {
      const liveData = livePrices[h.symbol];
      const livePrice = liveData ? liveData.price : h.price;
      invested += h.price * h.quantity;
      current += livePrice * h.quantity;
    });
    const pnl = current - invested;
    const totalPnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
    
    return {
      totalValue: current,
      totalPnlPct,
      alerts: alertsStore.alerts.length // Total Alerts count for dropdown stats
    };
  }, [holdings, livePrices, alertsStore.alerts]);

  // ─── UI EFFECTS ───
  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMarketOpen(checkIsIndianMarketOpen());
    const id = setInterval(() => setMarketOpen(checkIsIndianMarketOpen()), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setProfileOpen(false); setAlertsOpen(false); setWatchlistOpen(false); setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(tag)) { e.preventDefault(); setCommandOpen(true); }
      if (e.key === "Escape") { setCommandOpen(false); setProfileOpen(false); setAlertsOpen(false); setWatchlistOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
      if (alertsRef.current && !alertsRef.current.contains(e.target as Node)) setAlertsOpen(false);
      if (watchlistRef.current && !watchlistRef.current.contains(e.target as Node)) setWatchlistOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const closeAll = useCallback(() => { setProfileOpen(false); setAlertsOpen(false); setWatchlistOpen(false); }, []);
  const handleNavigate = useCallback((sym: string) => { router.push(`/dashboard?symbol=${sym}`); }, [router]);
  const isHome = pathname === "/";

  return (
    <>
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onNavigate={handleNavigate} />

      <header className={`fixed inset-x-0 z-[900] flex justify-center px-4 md:px-6 transition-all duration-500 ${isHome && !isScrolled ? "top-10" : "top-3"}`}>
        <div className={`w-full max-w-7xl flex items-center justify-between transition-all duration-300 rounded-2xl ${
          isScrolled
            ? "bg-[#080808]/85 backdrop-blur-2xl border border-white/[0.09] px-5 py-3 shadow-[0_12px_50px_rgba(0,0,0,0.6)]"
            : "bg-transparent border border-transparent px-3 py-4"
        }`}>

          {/* Logo + Market Status */}
          <div className="flex items-center gap-4">
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={() => router.push("/")}
              className="flex items-center gap-2.5 group focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-xl">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center shadow-[0_0_14px_rgba(59,130,246,0.4)] group-hover:shadow-[0_0_22px_rgba(59,130,246,0.6)] transition-shadow">
                <Activity size={17} className="text-white" />
              </div>
              <span className="text-xl font-black text-white tracking-tight">FinIntel</span>
            </motion.button>

            <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.07]">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${marketOpen ? "bg-emerald-400 animate-pulse" : "bg-gray-600"}`} />
              <span className="text-[11px] font-semibold text-gray-400">{marketOpen ? "NSE Open" : "Market Closed"}</span>
            </div>
          </div>

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-0.5 p-1 rounded-full bg-white/[0.03] border border-white/[0.06]">
            {NAV_LINKS.map(link => {
              const active = pathname === link.path;
              return (
                <button key={link.path} onClick={() => router.push(link.path)}
                  className={`relative px-4 py-2 rounded-full text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${active ? "text-white" : "text-gray-500 hover:text-gray-200"}`}>
                  {active && (
                    <motion.div layoutId="nav-pill" className="absolute inset-0 bg-white/[0.09] rounded-full"
                      transition={{ type: "spring", stiffness: 350, damping: 32 }} />
                  )}
                  <span className="relative z-[901]">{link.name}</span>
                </button>
              );
            })}
          </nav>

          {/* Right controls */}
          <div className="hidden md:flex items-center gap-2">
            {/* Search trigger */}
            <button onClick={() => setCommandOpen(true)}
              className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/[0.07] text-gray-500 hover:text-gray-300 hover:bg-white/[0.07] hover:border-white/[0.12] transition-all group focus-visible:ring-2 focus-visible:ring-blue-500 outline-none">
              <Search size={15} className="group-hover:text-blue-400 transition-colors" />
              <span className="text-xs">Search</span>
              <div className="flex items-center gap-0.5">
                <kbd className="text-[10px] bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 rounded-md font-mono text-gray-600">/</kbd>
              </div>
            </button>

            {user ? (
              <div className="flex items-center gap-2">
                {/* Watchlist */}
                <div className="relative" ref={watchlistRef}>
                  <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                    onClick={() => { closeAll(); setWatchlistOpen(v => !v); }}
                    className={`p-2.5 rounded-xl border transition-all focus-visible:ring-2 focus-visible:ring-blue-500 outline-none ${watchlistOpen ? "bg-blue-500/10 border-blue-500/30 text-blue-400" : "bg-white/[0.04] border-white/[0.07] text-gray-400 hover:bg-white/[0.08] hover:text-white"}`}>
                    <Bookmark size={17} />
                  </motion.button>
                  <WatchlistPanel open={watchlistOpen} watchlist={watchlist} livePrices={livePrices} />
                </div>

                {/* Alerts (Replaced Notifications) */}
                <div className="relative" ref={alertsRef}>
                  <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                    onClick={() => { closeAll(); setAlertsOpen(v => !v); }}
                    className={`relative p-2.5 rounded-xl border transition-all focus-visible:ring-2 focus-visible:ring-blue-500 outline-none ${alertsOpen ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-white/[0.04] border-white/[0.07] text-gray-400 hover:bg-white/[0.08] hover:text-white"}`}>
                    <Bell size={17} />
                    {triggeredAlertCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 rounded-full border-2 border-[#080808] text-[9px] font-bold flex items-center justify-center text-white">
                        {triggeredAlertCount}
                      </span>
                    )}
                  </motion.button>
                  <AlertsPanel open={alertsOpen} alertsStore={alertsStore} onSelectSymbol={handleNavigate} />
                </div>

                {/* Profile */}
                <div className="relative" ref={profileRef}>
                  {loading ? (
                    <div className="w-32 h-9 rounded-full bg-white/[0.06] animate-pulse" />
                  ) : (
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                      onClick={() => { closeAll(); setProfileOpen(v => !v); }}
                      className={`flex items-center gap-2.5 pl-3 pr-1.5 py-1 rounded-full border transition-all focus-visible:ring-2 focus-visible:ring-blue-500 outline-none ${profileOpen ? "bg-white/[0.08] border-white/20" : "bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.07] hover:border-white/15"}`}>
                      <span className="text-sm text-gray-200 font-semibold hidden lg:block max-w-[80px] truncate">
                        {user.displayName?.split(" ")[0] || user.email?.split("@")[0]}
                      </span>
                      <Avatar user={user} size={30} />
                    </motion.button>
                  )}
                  {!loading && user && <ProfileDropdown open={profileOpen} user={user} stats={profileStats} onClose={() => setProfileOpen(false)} />}
                </div>
              </div>
            ) : loading ? (
              <div className="w-28 h-9 rounded-xl bg-white/[0.06] animate-pulse" />
            ) : (
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => router.push("/login")}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-sm font-bold text-white shadow-[0_0_14px_rgba(59,130,246,0.3)] hover:shadow-[0_0_24px_rgba(59,130,246,0.5)] transition-all">
                Access Terminal
              </motion.button>
            )}
          </div>

          {/* Mobile hamburger */}
          <button onClick={() => setMobileMenuOpen(true)}
            className="md:hidden p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.07] text-gray-400 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 outline-none">
            <Menu size={20} />
          </button>
        </div>
      </header>

      <MobileMenu open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} user={user} pathname={pathname} watchlist={watchlist} livePrices={livePrices} />

      {/* Keyboard hint */}
      <AnimatePresence>
        {!commandOpen && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: 2 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[900] hidden md:flex items-center gap-2 bg-[#0c0c0c]/90 border border-white/[0.08] px-4 py-2 rounded-full text-[11px] text-gray-500 backdrop-blur-xl pointer-events-none">
            <Command size={11} /> Press <kbd className="font-mono bg-white/[0.07] px-1.5 py-0.5 rounded border border-white/10">/</kbd> to search
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}