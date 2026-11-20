import { useEffect, useState, type ReactNode } from "react";
import { liveQuery } from "dexie";
import { useT } from "../lib/i18n";
import { canSpeak, speak } from "../lib/speech";
import { LangContext } from "../lib/i18n";
import { useContext } from "react";
import { Icon, Mark } from "./Icon";

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

export function Screen({ children, title, onBack, right }: { children: ReactNode; title?: ReactNode; onBack?: () => void; right?: ReactNode }) {
  const { t } = useT();
  const online = useOnline();
  const { lang, setLang } = useContext(LangContext);
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-paper">
      <header className="sticky top-0 z-20 flex h-[60px] items-center gap-2 border-b border-line bg-surface/90 px-3 backdrop-blur-md">
        {onBack ? (
          <button onClick={onBack} className="flex size-10 items-center justify-center rounded-lg text-ink hover:bg-paper active:bg-line" aria-label={t("back")}>
            <Icon name="back" className="size-[22px]" />
          </button>
        ) : (
          <LongPressMark />
        )}
        {title ? (
          <h1 className="flex-1 truncate text-[17px] font-bold">{title}</h1>
        ) : (
          <p className="flex-1 text-xl font-extrabold tracking-tight text-brand">DISHA<span className="text-accent">.</span></p>
        )}
        {right}
        <div className="flex rounded-lg bg-paper p-0.5 text-xs font-bold" role="group" aria-label="Language">
          {(["ta", "hi", "en"] as const).map((l) => (
            <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l}
              className={`rounded-md px-2.5 py-1.5 ${lang === l ? "bg-surface text-brand shadow-[0_1px_2px_rgb(11_31_58/0.12)]" : "text-muted"}`}>
              {l === "ta" ? "த" : l === "hi" ? "हि" : "En"}
            </button>
          ))}
        </div>
      </header>
      {!online && (
        <div className="flex items-center gap-2 border-b border-sun/30 bg-sun-soft px-4 py-2 text-sm font-medium text-warn">
          <Icon name="offline" className="size-4" /> {t("offline")}
        </div>
      )}
      <main className="flex flex-1 flex-col gap-4 px-4 pt-5 pb-8">{children}</main>
    </div>
  );
}

export function Button({ children, onClick, kind = "primary", disabled, className = "" }: {
  children: ReactNode; onClick?: () => void; kind?: "primary" | "ghost" | "soft" | "accent"; disabled?: boolean; className?: string;
}) {
  const styles = {
    primary: "bg-brand text-white hover:bg-brand-dark active:bg-brand-dark",
    accent: "bg-accent text-brand-dark hover:brightness-105 active:brightness-95",
    soft: "bg-brand-soft text-brand hover:brightness-[0.98] active:brightness-95",
    ghost: "border border-line bg-surface text-ink hover:border-faint active:bg-paper",
  }[kind];
  return (
    <button onClick={onClick} disabled={disabled}
      className={`inline-flex min-h-13 items-center justify-center gap-2 rounded-xl px-5 text-base font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}>
      {children}
    </button>
  );
}

/** A white surface with a hairline border: the one container style used across screens. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>{children}</section>;
}

/** Section heading: optional number or small label above a bold title, like the deck's "01 Discover". */
export function Heading({ children, eyebrow, action }: { children: ReactNode; eyebrow?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end gap-3">
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="eyebrow mb-0.5">{eyebrow}</p>}
        <h2 className="text-xl leading-tight font-extrabold">{children}</h2>
      </div>
      {action}
    </div>
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
      className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-accent-dark hover:border-accent active:bg-brand-soft ${className}`}
      aria-label="Read aloud"
    >
      <Icon name="speaker" className="size-[18px]" />
    </button>
  );
}

export function Progress({ step, total }: { step: number; total: number }) {
  const pct = Math.min(100, Math.round((step / Math.max(1, total)) * 100));
  return (
    <div className="flex items-center gap-3" aria-label={`${step} / ${total}`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs font-semibold text-muted tabular-nums">{Math.min(step, total)}/{total}</span>
    </div>
  );
}

export function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`flex min-h-13 items-center gap-2 rounded-xl border px-3 py-2 text-left text-base font-medium transition ${
        selected ? "border-brand bg-brand text-white" : "border-line bg-surface hover:border-faint"
      }`}
    >
      {children}
    </button>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "sun" | "brand" | "bad" }) {
  const styles = {
    neutral: "bg-paper text-muted",
    good: "bg-good-soft text-good",
    sun: "bg-sun-soft text-warn",
    brand: "bg-brand-soft text-accent-dark",
    bad: "bg-bad-soft text-bad",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold ${styles}`}>{children}</span>;
}

/** The Disha logo. Holding it for a second turns the decision X-ray on or off (for demos). */
function LongPressMark() {
  let timer: number | undefined;
  const start = () => { timer = window.setTimeout(() => window.dispatchEvent(new Event("disha:xray-toggle")), 900); };
  const cancel = () => window.clearTimeout(timer);
  return (
    <span onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onContextMenu={(e) => e.preventDefault()} className="select-none">
      <Mark className="ml-1 size-8" />
    </span>
  );
}
