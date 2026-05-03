"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, Bookmark, Clock, TrendingUp, TrendingDown,
  BarChart2, Settings, ChevronRight, Star, X,
  Activity, Award, Target, Zap, LogOut, Edit3, Trash2
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot, query, deleteDoc, doc } from "firebase/firestore";
import toast from "react-hot-toast";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
interface FirestoreWatchlist { id: string; symbol: string; name: string; }
interface FirestoreHolding { id: string; symbol: string; quantity: number; price: number; }
interface FirestoreAlert { id: string; triggered: boolean; }
interface RecentSearch { symbol: string; timestamp: string; }
interface ActivityItem { id: string; type: "view" | "alert" | "compare"; symbol: string; desc: string; time: string; }

// ─── CURRENCY LOGIC ──────────────────────────────────────────
const isIndianStock = (symbol: string) => symbol.endsWith(".NS") || symbol.endsWith(".BO");
const getNativeCurrency = (symbol: string) => isIndianStock(symbol) ? "INR" : "USD";

const fmtCurrency = (v: number, curr: "INR" | "USD") =>
  new Intl.NumberFormat(curr === "INR" ? "en-IN" : "en-US", { 
    style: "currency", currency: curr, maximumFractionDigits: 2 
  }).format(v);

// ─────────────────────────────────────────────
// MOCK DATA (FALLBACKS)
// ─────────────────────────────────────────────
const MOCK_WATCHLIST = [
  { symbol: "AAPL", name: "Apple Inc.", price: "$173.50", change: "+0.8%", isUp: true },
  { symbol: "NVDA", name: "NVIDIA Corp", price: "$880.00", change: "+4.2%", isUp: true },
  { symbol: "RELIANCE.NS", name: "Reliance Ind.", price: "₹2,950", change: "+1.5%", isUp: true },
];

const MOCK_RECENT: RecentSearch[] = [
  { symbol: "NVDA", timestamp: "2h ago" },
  { symbol: "AAPL", timestamp: "4h ago" },
  { symbol: "BTC", timestamp: "Yesterday" },
  { symbol: "RELIANCE.NS", timestamp: "2 days ago" },
];

const MOCK_ACTIVITY: ActivityItem[] = [
  { id: "1", type: "view", symbol: "NVDA", desc: "Viewed NVIDIA Corp analysis", time: "2h ago" },
  { id: "2", type: "alert", symbol: "TSLA", desc: "Price alert triggered at $180", time: "4h ago" },
  { id: "3", type: "compare", symbol: "AAPL vs MSFT", desc: "Compared Apple vs Microsoft", time: "Yesterday" },
];

const TABS = ["Overview", "Watchlist", "Recent", "Activity"] as const;
type Tab = typeof TABS[number];

// ─────────────────────────────────────────────
// AVATAR
// ─────────────────────────────────────────────
const Avatar = ({ user, size = 80 }: { user: { displayName?: string | null; email?: string | null; photoURL?: string | null }; size?: number }) => {
  const [err, setErr] = useState(false);
  const initials = (user.displayName || user.email || "U").slice(0, 2).toUpperCase();
  const colors = ["from-blue-600 to-cyan-500", "from-violet-600 to-blue-500", "from-emerald-600 to-teal-500"];
  const ci = initials.charCodeAt(0) % colors.length;
  if (user.photoURL && !err) return <img src={user.photoURL} alt="Avatar" width={size} height={size} className="rounded-2xl object-cover" style={{ width: size, height: size }} onError={() => setErr(true)} />;
  return <div className={`rounded-2xl bg-gradient-to-br ${colors[ci]} flex items-center justify-center font-black text-white shadow-lg`} style={{ width: size, height: size, fontSize: size * 0.32 }}>{initials}</div>;
};

// ─────────────────────────────────────────────
// STAT CARD
// ─────────────────────────────────────────────
const StatCard = ({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) => (
  <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 flex flex-col gap-2">
    <div className={`w-8 h-8 rounded-xl ${color} flex items-center justify-center`}>{icon}</div>
    <div>
      <p className="text-xl font-black text-white">{value}</p>
      <p className="text-xs text-gray-500 font-medium mt-0.5">{label}</p>
    </div>
  </div>
);

// ─────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────
export default function ProfilePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#060606] flex items-center justify-center pt-20">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
        </div>
      </div>
    }>
      <ProfileContent />
    </Suspense>
  );
}

function ProfileContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  
  // Dynamic Data State
  const [watchlist, setWatchlist] = useState<FirestoreWatchlist[]>([]);
  const [holdings, setHoldings] = useState<FirestoreHolding[]>([]);
  const [alerts, setAlerts] = useState<FirestoreAlert[]>([]);
  const [livePrices, setLivePrices] = useState<Record<string, any>>({});
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "watchlist") setActiveTab("Watchlist");
  }, [searchParams]);

  // ─── FIRESTORE LISTENERS ───
  useEffect(() => {
    if (!user) {
      setDataLoaded(true);
      return;
    }

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

    const unsubAlerts = onSnapshot(collection(db, "users", user.uid, "alerts"), (snap) => {
      const data: FirestoreAlert[] = [];
      snap.forEach(doc => data.push({ id: doc.id, ...doc.data() } as FirestoreAlert));
      setAlerts(data);
    });

    // Short timeout to prevent mock data flash if DB loads quickly
    const timer = setTimeout(() => setDataLoaded(true), 500);

    return () => { unsubWatchlist(); unsubPortfolio(); unsubAlerts(); clearTimeout(timer); };
  }, [user]);

  // ─── LIVE PRICE POLLING ───
  useEffect(() => {
    if (!user || !dataLoaded) return;
    const allSymbols = Array.from(new Set([...watchlist.map(w => w.symbol), ...holdings.map(h => h.symbol)]));
    if (allSymbols.length === 0) return;

    const fetchPrices = async () => {
      // MOCK LIVE POLLING (Replace with backend API)
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
  }, [watchlist, holdings, user, dataLoaded]);

  // ─── DERIVED STATS ───
  const activeAlertsCount = alerts.filter(a => !a.triggered).length;
  
  const portfolioReturn = useMemo(() => {
    if (holdings.length === 0) return 0;
    let invested = 0, current = 0;
    holdings.forEach(h => {
      // Assuming naive normalization for high-level percentage calculation
      const liveData = livePrices[h.symbol];
      const livePrice = liveData ? liveData.price : h.price;
      invested += h.price * h.quantity;
      current += livePrice * h.quantity;
    });
    return invested > 0 ? ((current - invested) / invested) * 100 : 0;
  }, [holdings, livePrices]);

  const handleSignOut = async () => {
    await signOut(auth);
    toast.success("Signed out");
    router.push("/login");
  };

  const removeFromWatchlist = async (id: string, sym: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, "users", user.uid, "watchlist", id));
      toast.success(`Removed ${sym}`);
    } catch (e) {
      toast.error("Failed to remove item");
    }
  };

  if (loading || !dataLoaded) return (
    <div className="min-h-screen bg-[#060606] flex items-center justify-center pt-20">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
        <p className="text-gray-500 text-sm">Loading profile…</p>
      </div>
    </div>
  );

  if (!user) { router.push("/login"); return null; }

  const activityIcon = (type: string) => ({ view: <BarChart2 size={14} />, alert: <Zap size={14} />, compare: <Activity size={14} /> }[type] || <Activity size={14} />);
  const activityColor = (type: string) => ({ view: "bg-blue-500/15 text-blue-400", alert: "bg-amber-500/15 text-amber-400", compare: "bg-violet-500/15 text-violet-400" }[type] || "bg-gray-500/15 text-gray-400");

  return (
    <main className="min-h-screen bg-[#060606] text-white pt-28 pb-16">
      <style>{`.scrollbar-hide::-webkit-scrollbar{display:none}.scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none}`}</style>

      {/* Background */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-900/15 blur-[120px] rounded-full" />
        <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-indigo-900/10 blur-[100px] rounded-full" />
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6">

        {/* Profile Header */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-white/[0.04] to-white/[0.01] border border-white/[0.08] rounded-3xl p-6 sm:p-8 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
            <div className="relative flex-shrink-0">
              <Avatar user={user} size={88} />
              <button className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-blue-600 border-2 border-[#060606] flex items-center justify-center hover:bg-blue-500 transition-colors">
                <Edit3 size={11} className="text-white" />
              </button>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-black tracking-tight">{user.displayName || "Investor"}</h1>
                  <p className="text-gray-400 text-sm mt-0.5">{user.email}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/25 px-2.5 py-1 rounded-full uppercase tracking-wider">Member</span>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => router.push("/settings")}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.05] border border-white/[0.08] text-sm font-semibold text-gray-300 hover:bg-white/[0.08] hover:text-white transition-all">
                    <Settings size={15} /> Settings
                  </button>
                  <button onClick={handleSignOut}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-sm font-semibold text-rose-400 hover:bg-rose-500/15 transition-all">
                    <LogOut size={15} /> Sign Out
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            <StatCard icon={<Bookmark size={16} className="text-blue-400" />} label="Watchlist" value={String(watchlist.length)} color="bg-blue-500/15" />
            <StatCard icon={<Target size={16} className="text-amber-400" />} label="Active Alerts" value={String(activeAlertsCount)} color="bg-amber-500/15" />
            <StatCard icon={<Award size={16} className="text-emerald-400" />} label="Portfolio Gain" value={`${portfolioReturn >= 0 ? "+" : ""}${portfolioReturn.toFixed(1)}%`} color="bg-emerald-500/15" />
            <StatCard icon={<TrendingUp size={16} className="text-violet-400" />} label="Stocks Tracked" value={String(new Set([...watchlist.map(w=>w.symbol), ...holdings.map(h=>h.symbol)]).size)} color="bg-violet-500/15" />
          </div>
        </motion.div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-white/[0.03] border border-white/[0.06] rounded-2xl mb-6 overflow-x-auto scrollbar-hide">
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 min-w-[100px] py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab === tab ? "bg-white/[0.09] text-white shadow-sm" : "text-gray-500 hover:text-gray-300"}`}>
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>

            {/* OVERVIEW */}
            {activeTab === "Overview" && (
              <div className="space-y-4">
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5">
                  <h2 className="font-bold text-base mb-4 flex items-center gap-2"><Star size={16} className="text-yellow-400 fill-yellow-400" /> Pinned Watchlist</h2>
                  <div className="grid sm:grid-cols-2 gap-2">
                    
                    {/* Fallback to Mock Data if DB is empty */}
                    {(watchlist.length > 0 ? watchlist : MOCK_WATCHLIST.map((m, i) => ({ id: `mock${i}`, ...m }))).slice(0, 4).map((item: any) => {
                      const liveData = livePrices[item.symbol] || { price: item.price || 150, changeStr: item.change || "+0%", isUp: item.isUp ?? true };
                      const curr = getNativeCurrency(item.symbol);
                      const displayPrice = typeof liveData.price === 'number' ? fmtCurrency(liveData.price, curr) : liveData.price;

                      return (
                        <button key={item.symbol} onClick={() => router.push(`/dashboard?symbol=${item.symbol}`)}
                          className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.05] hover:border-white/10 transition-all group text-left">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/[0.07] flex items-center justify-center text-[10px] font-black text-blue-400">
                              {item.symbol.slice(0, 2)}
                            </div>
                            <div>
                              <p className="text-sm font-bold">{item.symbol}</p>
                              <p className="text-[11px] text-gray-500 truncate max-w-[100px]">{item.name || "Tracked Asset"}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold">{displayPrice}</p>
                            <p className={`text-xs font-semibold flex items-center justify-end gap-0.5 ${liveData.isUp ? "text-emerald-400" : "text-rose-400"}`}>
                              {liveData.isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />} {liveData.changeStr}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  
                  {watchlist.length === 0 && (
                    <p className="text-xs text-gray-500 mt-4 text-center">Showing sample data. Add assets to your watchlist to see them here.</p>
                  )}

                  <button onClick={() => setActiveTab("Watchlist")} className="mt-3 w-full py-2.5 rounded-xl text-xs font-semibold text-gray-500 hover:text-white hover:bg-white/[0.04] transition-colors flex items-center justify-center gap-1.5">
                    View All {watchlist.length > 0 ? watchlist.length : ""} <ChevronRight size={13} />
                  </button>
                </div>

                {/* Keep mock recent activity for now as it usually requires a complex backend logging system */}
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5">
                  <h2 className="font-bold text-base mb-4 flex items-center gap-2"><Clock size={16} className="text-gray-400" /> Recent Activity</h2>
                  <div className="space-y-2">
                    {MOCK_ACTIVITY.slice(0, 3).map(act => (
                      <div key={act.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.03] transition-colors">
                        <div className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 ${activityColor(act.type)}`}>{activityIcon(act.type)}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-200 truncate">{act.desc}</p>
                          <p className="text-[10px] text-gray-600">{act.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* WATCHLIST */}
            {activeTab === "Watchlist" && (
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
                  <h2 className="font-bold flex items-center gap-2"><Bookmark size={15} className="text-blue-400" /> Saved Stocks</h2>
                  <span className="text-xs text-gray-500">{watchlist.length} assets</span>
                </div>
                
                {watchlist.length === 0 ? (
                  <div className="py-16 text-center flex flex-col items-center">
                    <Bookmark size={24} className="text-gray-600 mb-3" />
                    <p className="text-gray-400 font-medium">Your watchlist is empty.</p>
                    <p className="text-xs text-gray-500 mt-1">Search for assets and star them to track prices.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.04]">
                    {watchlist.map(item => {
                      const liveData = livePrices[item.symbol] || { price: 0, changeStr: "...", isUp: true };
                      const curr = getNativeCurrency(item.symbol);
                      
                      return (
                        <div key={item.symbol} className="flex items-center justify-between px-5 py-4 hover:bg-white/[0.03] transition-colors group">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/[0.07] flex items-center justify-center text-xs font-black text-blue-400">
                              {item.symbol.slice(0, 2)}
                            </div>
                            <div>
                              <p className="font-bold">{item.symbol}</p>
                              <p className="text-xs text-gray-500">{item.name}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right hidden sm:block">
                              <p className="font-bold text-sm">{livePrices[item.symbol] ? fmtCurrency(liveData.price, curr) : "Loading..."}</p>
                              <p className={`text-xs font-semibold flex items-center justify-end gap-0.5 ${liveData.isUp ? "text-emerald-400" : "text-rose-400"}`}>
                                {liveData.isUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />} {liveData.changeStr}
                              </p>
                            </div>
                            <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => router.push(`/dashboard?symbol=${item.symbol}`)}
                                className="p-2 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors">
                                <BarChart2 size={14} />
                              </button>
                              <button onClick={() => removeFromWatchlist(item.id, item.symbol)}
                                className="p-2 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* RECENT SEARCHES (Kept static mock for UI layout purposes) */}
            {activeTab === "Recent" && (
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
                  <h2 className="font-bold flex items-center gap-2"><Clock size={15} className="text-gray-400" /> Recent Searches</h2>
                  <button className="text-xs text-gray-500 hover:text-white transition-colors">Clear all</button>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {MOCK_RECENT.map((item, i) => (
                    <div key={i} className="flex items-center justify-between px-5 py-4 hover:bg-white/[0.03] transition-colors group cursor-pointer" onClick={() => router.push(`/dashboard?symbol=${item.symbol}`)}>
                      <div className="flex items-center gap-3">
                        <Clock size={14} className="text-gray-600" />
                        <span className="font-bold text-sm">{item.symbol}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-600">{item.timestamp}</span>
                        <ChevronRight size={14} className="text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ACTIVITY (Kept static mock for UI layout purposes) */}
            {activeTab === "Activity" && (
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-white/[0.06]">
                  <h2 className="font-bold flex items-center gap-2"><Activity size={15} className="text-blue-400" /> Activity Log</h2>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {MOCK_ACTIVITY.map(act => (
                    <div key={act.id} className="flex items-start gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${activityColor(act.type)}`}>{activityIcon(act.type)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-200">{act.desc}</p>
                        <p className="text-xs text-gray-600 mt-0.5">{act.symbol} · {act.time}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  );
}