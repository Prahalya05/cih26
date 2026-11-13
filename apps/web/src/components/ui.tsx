import { useEffect, useState, type ReactNode } from "react";
import { liveQuery } from "dexie";
import { useT } from "../lib/i18n";
import { canSpeak, speak } from "../lib/speech";
import { LangContext } from "../lib/i18n";
import { useContext } from "react";

/** Re-render when IndexedDB data changes. */
export function useLive<T>(query: () => Promise<T>, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: console.error });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

export function Screen({ children, title, onBack, right }: { children: ReactNode; title?: string; onBack?: () => void; right?: ReactNode }) {
  const { t } = useT();
  const online = useOnline();
  const { lang, setLang } = useContext(LangContext);
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur">
        {onBack ? (
          <button onClick={onBack} className="-ml-2 rounded-full p-2 text-2xl leading-none" aria-label={t("back")}>←</button>
        ) : (
          <span className="text-2xl" aria-hidden>🧭</span>
        )}
        <h1 className="flex-1 truncate text-lg font-semibold">{title ?? t("appName")}</h1>
        {right}
        <button
          onClick={() => setLang(lang === "ta" ? "en" : "ta")}
          className="rounded-full border border-line px-3 py-1 text-sm font-medium"
          aria-label="Change language"
        >
          {lang === "ta" ? "English" : "தமிழ்"}
        </button>
      </header>
      {!online && <div className="bg-sun-soft px-4 py-2 text-sm text-warn">📴 {t("offline")}</div>}
      <main className="flex flex-1 flex-col gap-4 px-4 py-5">{children}</main>
    </div>
  );
}

export function Button({ children, onClick, kind = "primary", disabled, className = "" }: {
  children: ReactNode; onClick?: () => void; kind?: "primary" | "ghost" | "soft"; disabled?: boolean; className?: string;
}) {
  const styles = {
    primary: "bg-brand text-white active:bg-brand-dark disabled:opacity-40",
    soft: "bg-brand-soft text-brand-dark active:brightness-95",
    ghost: "border border-line bg-white text-ink active:bg-stone-50",
  }[kind];
  return (
    <button onClick={onClick} disabled={disabled} className={`min-h-14 rounded-2xl px-5 text-lg font-semibold ${styles} ${className}`}>
      {children}
    </button>
  );
}

/** Read text aloud. Hidden on phones with no voice for the current language. */
export function SpeakButton({ text, audioKey, className = "" }: { text: string; audioKey?: string; className?: string }) {
  const { lang } = useT();
  const [available, setAvailable] = useState(() => canSpeak(lang));
  useEffect(() => {
    setAvailable(canSpeak(lang));
    if (!("speechSynthesis" in window)) return;
    const update = () => setAvailable(canSpeak(lang));
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, [lang]);
  if (!available && !audioKey) return null;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); speak(text, lang, audioKey); }}
      className={`inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-sun-soft text-xl ${className}`}
      aria-label="Read aloud"
    >
      🔊
    </button>
  );
}

export function Progress({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex gap-1.5" aria-label={`${step} / ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className={`h-1.5 flex-1 rounded-full ${i < step ? "bg-brand" : "bg-line"}`} />
      ))}
    </div>
  );
}

export function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`flex min-h-14 items-center gap-2 rounded-2xl border-2 px-3 py-2 text-left text-base font-medium transition ${
        selected ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-white"
      }`}
    >
      {children}
    </button>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "sun" | "brand" }) {
  const styles = {
    neutral: "bg-stone-100 text-muted",
    good: "bg-good-soft text-good",
    sun: "bg-sun-soft text-warn",
    brand: "bg-brand-soft text-brand-dark",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles}`}>{children}</span>;
}
