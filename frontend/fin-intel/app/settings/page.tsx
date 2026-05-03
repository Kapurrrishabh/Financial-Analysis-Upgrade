"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";
import {
  Settings, Sun, Moon, Globe, DollarSign, Bell, Shield,
  ChevronLeft, Check, Save, TrendingUp, Eye, AlertCircle
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { db } from "@/lib/firebase"; 
import { doc, getDoc, setDoc } from "firebase/firestore";
import toast from "react-hot-toast";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
interface Prefs {
  theme: "dark" | "light" | "system";
  defaultMarket: "US" | "IN" | "GLOBAL";
  currency: "USD" | "INR" | "EUR" | "GBP";
  defaultSymbol: string;
  notifications: { priceAlerts: boolean; marketOpen: boolean; portfolioSummary: boolean; newsDigest: boolean; };
  privacy: { publicProfile: boolean; analyticsOpt: boolean; };
  display: { compactMode: boolean; showChangePct: boolean; animationsEnabled: boolean; };
}

const DEFAULT_PREFS: Prefs = {
  theme: "dark",
  defaultMarket: "IN",
  currency: "USD",
  defaultSymbol: "AAPL",
  notifications: { priceAlerts: true, marketOpen: true, portfolioSummary: false, newsDigest: true },
  privacy: { publicProfile: false, analyticsOpt: true },
  display: { compactMode: false, showChangePct: true, animationsEnabled: true },
};

const SECTIONS = ["Appearance", "Markets", "Notifications", "Display", "Privacy"] as const;
type Section = typeof SECTIONS[number];

// ─────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────
const Toggle = ({ value, onChange, label, desc }: { value: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) => (
  <div className="flex items-center justify-between py-3.5 border-b border-gray-200 dark:border-white/[0.04] last:border-0">
    <div className="flex-1 mr-4">
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-200">{label}</p>
      {desc && <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{desc}</p>}
    </div>
    <button onClick={() => onChange(!value)} className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-all duration-300 focus-visible:ring-2 focus-visible:ring-blue-500 outline-none ${value ? "bg-blue-600" : "bg-gray-300 dark:bg-white/[0.1]"}`}>
      <motion.div animate={{ x: value ? 22 : 2 }} transition={{ type: "spring", stiffness: 600, damping: 35 }}
        className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-md" />
    </button>
  </div>
);

const OptionGroup = ({ options, value, onChange }: { options: { value: string; label: string; desc?: string; flag?: string }[]; value: string; onChange: (v: string) => void }) => (
  <div className="grid gap-2">
    {options.map(opt => (
      <button key={opt.value} onClick={() => onChange(opt.value)}
        className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left ${
          value === opt.value 
            ? "bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30 text-blue-700 dark:text-blue-300" 
            : "bg-white dark:bg-white/[0.02] border-gray-200 dark:border-white/[0.06] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.05] hover:border-gray-300 dark:hover:border-white/10 hover:text-gray-900 dark:hover:text-gray-200"
        }`}>
        {opt.flag && <span className="text-xl">{opt.flag}</span>}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{opt.label}</p>
          {opt.desc && <p className="text-xs opacity-70 mt-0.5">{opt.desc}</p>}
        </div>
        <AnimatePresence>
          {value === opt.value && (
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
              className="w-5 h-5 rounded-full bg-blue-600 dark:bg-blue-500 flex items-center justify-center flex-shrink-0">
              <Check size={11} className="text-white" />
            </motion.div>
          )}
        </AnimatePresence>
      </button>
    ))}
  </div>
);

const SectionCard = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => (
  <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
    className="bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.06] shadow-sm dark:shadow-none rounded-2xl overflow-hidden">
    <div className="px-5 py-4 border-b border-gray-200 dark:border-white/[0.06] flex items-center gap-2.5">
      <span className="text-blue-500 dark:text-blue-400">{icon}</span>
      <h3 className="font-bold text-sm text-gray-900 dark:text-white">{title}</h3>
    </div>
    <div className="p-5">{children}</div>
  </motion.div>
);

// ─────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────
export default function SettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { theme, setTheme } = useTheme(); 
  
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [loadingData, setLoadingData] = useState(true);
  const [saved, setSaved] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("Appearance");
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // 1. Load from Main User Document in Firestore
  useEffect(() => {
    const fetchSettings = async () => {
      if (!user) return;
      try {
        const docRef = doc(db, "users", user.uid); // Points directly to the user document
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.preferences) {
            const mergedPrefs = { ...DEFAULT_PREFS, ...data.preferences };
            setPrefs(mergedPrefs);
            
            // Apply theme strictly on load
            if (mergedPrefs.theme && mergedPrefs.theme !== theme) {
              setTheme(mergedPrefs.theme);
            }
          }
        }
      } catch (error: any) {
        toast.error("Error loading settings: " + error.message);
      } finally {
        setLoadingData(false);
      }
    };

    if (!authLoading) {
      fetchSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]); // Excluded setTheme/theme to prevent infinite loops

  if (authLoading || loadingData) return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#060606] flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
    </div>
  );
  
  if (!user) { router.push("/login"); return null; }

  // State setters
  const set = <K extends keyof Prefs>(key: K, val: Prefs[K]) => setPrefs(p => ({ ...p, [key]: val }));
  const setNotif = (key: keyof Prefs["notifications"], val: boolean) => setPrefs(p => ({ ...p, notifications: { ...p.notifications, [key]: val } }));
  const setPrivacy = (key: keyof Prefs["privacy"], val: boolean) => setPrefs(p => ({ ...p, privacy: { ...p.privacy, [key]: val } }));
  const setDisplay = (key: keyof Prefs["display"], val: boolean) => setPrefs(p => ({ ...p, display: { ...p.display, [key]: val } }));

  // Handle Theme Change instantly
  const handleThemeChange = (newTheme: string) => {
    set("theme", newTheme as Prefs["theme"]);
    setTheme(newTheme); // Applies globally via next-themes instantly
  };

  // 2. Save explicitly to the User Document
  const handleSave = async () => {
    try {
      const userRef = doc(db, "users", user.uid);
      await setDoc(userRef, { preferences: prefs }, { merge: true }); // Merges without deleting your watchlist array
      setSaved(true);
      toast.success("Preferences saved to cloud!");
      setTimeout(() => setSaved(false), 2500);
    } catch (error: any) {
      toast.error("Failed to save: " + error.message);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-[#060606] text-gray-900 dark:text-white pt-28 pb-16 transition-colors duration-300">
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <div className="absolute top-20 right-0 w-80 h-80 bg-blue-500/5 dark:bg-blue-900/10 blur-[120px] rounded-full" />
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => router.back()}
            className="p-2.5 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.07] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/[0.07] transition-all shadow-sm dark:shadow-none">
            <ChevronLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-black flex items-center gap-2"><Settings size={22} className="text-blue-600 dark:text-blue-400" /> Preferences</h1>
            <p className="text-gray-500 text-sm mt-0.5">Customize your FinIntel experience</p>
          </div>
          <button onClick={handleSave}
            className={`ml-auto flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-white transition-all ${saved ? "bg-emerald-500 dark:bg-emerald-600 shadow-[0_0_20px_rgba(16,185,129,0.3)]" : "bg-blue-600 hover:bg-blue-500 shadow-[0_0_14px_rgba(59,130,246,0.3)] hover:shadow-[0_0_24px_rgba(59,130,246,0.5)]"}`}>
            {saved ? <><Check size={16} /> Saved!</> : <><Save size={16} /> Save</>}
          </button>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar nav */}
          <div className="lg:w-48 flex-shrink-0">
            <div className="flex lg:flex-col gap-1 overflow-x-auto scrollbar-hide pb-1 lg:pb-0">
              {SECTIONS.map(section => (
                <button key={section} onClick={() => setActiveSection(section)}
                  className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all text-left whitespace-nowrap ${
                    activeSection === section 
                      ? "bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-500/25 shadow-sm dark:shadow-none" 
                      : "text-gray-600 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-white/[0.04]"
                  }`}>
                  {section}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 space-y-4">
            <AnimatePresence mode="wait">
              <motion.div key={activeSection} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className="space-y-4">

                {activeSection === "Appearance" && (
                  <>
                    <SectionCard title="Theme" icon={<Sun size={15} />}>
                      <OptionGroup
                        // Fallback to local state if next-themes isn't mounted yet
                        value={mounted ? (theme as string) : prefs.theme}
                        onChange={handleThemeChange}
                        options={[
                          { value: "light", label: "Light Mode", desc: "Bright and clear for daytime use", flag: "☀️" },
                          { value: "dark", label: "Dark Mode", desc: "Easy on the eyes for trading marathons", flag: "🌙" },
                          { value: "system", label: "System", desc: "Follows your operating system settings", flag: "💻" },
                        ]}
                      />
                    </SectionCard>

                    <SectionCard title="Default Asset" icon={<TrendingUp size={15} />}>
                      <div>
                        <label className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-2 block">Default Symbol on Dashboard</label>
                        <input
                          value={prefs.defaultSymbol}
                          onChange={e => set("defaultSymbol", e.target.value.toUpperCase())}
                          placeholder="e.g. AAPL"
                          className="w-full bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-xl px-4 py-3 text-gray-900 dark:text-white outline-none focus:border-blue-500 dark:focus:border-blue-500 transition-colors font-mono uppercase text-sm"
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-600 mt-2">This symbol will be analyzed first when you open the dashboard.</p>
                      </div>
                    </SectionCard>
                  </>
                )}

                {activeSection === "Markets" && (
                  <>
                    <SectionCard title="Default Market" icon={<Globe size={15} />}>
                      <OptionGroup
                        value={prefs.defaultMarket}
                        onChange={(v) => set("defaultMarket", v as Prefs["defaultMarket"])}
                        options={[
                          { value: "IN", label: "Indian Markets", desc: "NSE, BSE — IST timezone", flag: "🇮🇳" },
                          { value: "US", label: "US Markets", desc: "NYSE, NASDAQ — EST timezone", flag: "🇺🇸" },
                          { value: "GLOBAL", label: "Global View", desc: "All markets combined", flag: "🌍" },
                        ]}
                      />
                    </SectionCard>

                    <SectionCard title="Display Currency" icon={<DollarSign size={15} />}>
                      <OptionGroup
                        value={prefs.currency}
                        onChange={(v) => set("currency", v as Prefs["currency"])}
                        options={[
                          { value: "USD", label: "US Dollar", desc: "$ — Prices shown in USD" },
                          { value: "INR", label: "Indian Rupee", desc: "₹ — Prices shown in INR" },
                          { value: "EUR", label: "Euro", desc: "€ — Prices shown in EUR" },
                          { value: "GBP", label: "British Pound", desc: "£ — Prices shown in GBP" },
                        ]}
                      />
                    </SectionCard>
                  </>
                )}

                {activeSection === "Notifications" && (
                  <SectionCard title="Notification Preferences" icon={<Bell size={15} />}>
                    <Toggle value={prefs.notifications.priceAlerts} onChange={v => setNotif("priceAlerts", v)} label="Price Alerts" desc="Get notified when a stock crosses your set price target." />
                    <Toggle value={prefs.notifications.marketOpen} onChange={v => setNotif("marketOpen", v)} label="Market Open/Close" desc="Reminder when NSE/NYSE opens and closes each trading day." />
                    <Toggle value={prefs.notifications.portfolioSummary} onChange={v => setNotif("portfolioSummary", v)} label="Weekly Portfolio Summary" desc="A digest of your portfolio performance every Monday." />
                    <Toggle value={prefs.notifications.newsDigest} onChange={v => setNotif("newsDigest", v)} label="Morning News Digest" desc="Top market-moving news delivered each morning." />
                  </SectionCard>
                )}

                {activeSection === "Display" && (
                  <SectionCard title="Display Options" icon={<Eye size={15} />}>
                    <Toggle value={prefs.display.compactMode} onChange={v => setDisplay("compactMode", v)} label="Compact Mode" desc="Reduce card sizes and spacing for more data density." />
                    <Toggle value={prefs.display.showChangePct} onChange={v => setDisplay("showChangePct", v)} label="Show Change Percentage" desc="Display percentage change alongside absolute price change." />
                    <Toggle value={prefs.display.animationsEnabled} onChange={v => setDisplay("animationsEnabled", v)} label="Enable Animations" desc="Smooth transitions and micro-interactions throughout the app." />
                  </SectionCard>
                )}

                {activeSection === "Privacy" && (
                  <>
                    <SectionCard title="Privacy Settings" icon={<Shield size={15} />}>
                      <Toggle value={prefs.privacy.publicProfile} onChange={v => setPrivacy("publicProfile", v)} label="Public Profile" desc="Allow others to see your profile and watchlist." />
                      <Toggle value={prefs.privacy.analyticsOpt} onChange={v => setPrivacy("analyticsOpt", v)} label="Usage Analytics" desc="Help improve FinIntel by sharing anonymous usage data." />
                    </SectionCard>

                    <div className="bg-amber-50 dark:bg-amber-500/[0.05] border border-amber-200 dark:border-amber-500/20 rounded-2xl p-5">
                      <div className="flex items-start gap-3">
                        <AlertCircle size={16} className="text-amber-500 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-bold text-amber-800 dark:text-amber-300 mb-1">Data Notice</p>
                          <p className="text-xs text-amber-700/80 dark:text-amber-400/70 leading-relaxed">FinIntel stores your preferences securely in the cloud and does not share personal financial data with third parties. Market data is sourced from public APIs.</p>
                        </div>
                      </div>
                    </div>
                  </>
                )}

              </motion.div>
            </AnimatePresence>

            {/* Save button (bottom mobile layout) */}
            <div className="flex justify-end pt-2">
              <button onClick={handleSave}
                className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all ${saved ? "bg-emerald-500 dark:bg-emerald-600 shadow-md" : "bg-blue-600 hover:bg-blue-500 shadow-md"}`}>
                {saved ? <><Check size={15} /> Preferences Saved!</> : <><Save size={15} /> Save Changes</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}