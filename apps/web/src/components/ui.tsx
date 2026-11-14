
import { useEffect, useState, type ReactNode, useContext } from "react";
import { liveQuery } from "dexie";
import { useT } from "../lib/i18n";
import { canSpeak, speak } from "../lib/speech";
import { LangContext } from "../lib/i18n";

/** Re-render when IndexedDB data changes. */
export function useLive<T>(query: () => Promise<T>, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    const sub = liveQuery(query).subscribe({
      next: setValue,
      error: console.error,
    });

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

    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return online;
}

export function Screen({
  children,
  title,
  onBack,
  right,
}: {
  children: ReactNode;
  title?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const { t } = useT();
  const online = useOnline();
  const { lang, setLang } = useContext(LangContext);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line/80 bg-paper/90 px-4 py-3.5 shadow-sm backdrop-blur-xl">

        {onBack ? (
          <button
            onClick={onBack}
            className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-full text-2xl text-brand-dark hover:bg-brand-soft"
            aria-label={t("back")}
          >
            ←
          </button>
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-2xl" aria-hidden>
            🧭
          </span>
        )}

        <h1 className="flex-1 truncate text-lg font-bold tracking-tight text-ink">
          {title ?? t("appName")}
        </h1>

        {right}

        <button
          onClick={() => setLang(lang === "ta" ? "en" : "ta")}
          className="shrink-0 rounded-full border border-brand/20 bg-white px-3.5 py-2 text-sm font-semibold text-brand-dark shadow-sm hover:bg-brand-soft"
          aria-label="Change language"
        >
          {lang === "ta" ? "English" : "தமிழ்"}
        </button>
      </header>

      {!online && (
        <div className="border-b border-[#f1d7b9] bg-sun-soft px-4 py-2.5 text-center text-sm font-medium text-warn">
          📴 {t("offline")}
        </div>
      )}

      <main className="flex flex-1 flex-col gap-5 px-4 py-5">
        {children}
      </main>
    </div>
  );
}

export function Button({
  children,
  onClick,
  kind = "primary",
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "ghost" | "soft";
  disabled?: boolean;
  className?: string;
}) {
  const styles = {
    primary:
      "bg-brand text-white shadow-md shadow-purple-200/60 hover:bg-brand-dark hover:shadow-lg active:scale-[0.98] disabled:opacity-40",
    soft:
      "bg-brand-soft text-brand-dark hover:bg-[#e5d9f6] active:scale-[0.98] disabled:opacity-40",
    ghost:
      "border border-line bg-white text-ink shadow-sm hover:border-brand/40 hover:bg-brand-soft active:scale-[0.98] disabled:opacity-40",
  }[kind];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`min-h-14 rounded-2xl px-5 text-base font-semibold transition-all duration-200 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

/** Read text aloud. Hidden on phones with no voice for the current language. */
export function SpeakButton({
  text,
  audioKey,
  className = "",
}: {
  text: string;
  audioKey?: string;
  className?: string;
}) {
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
      onClick={(e) => {
        e.stopPropagation();
        speak(text, lang, audioKey);
      }}
      className={`inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-[#f3dfca] bg-sun-soft text-xl shadow-sm hover:scale-105 active:scale-95 ${className}`}
      aria-label="Read aloud"
    >
      🔊
    </button>
  );
}

export function Progress({
  step,
  total,
}: {
  step: number;
  total: number;
}) {
  return (
    <div
      className="flex gap-1.5"
      aria-label={`${step} / ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-2 flex-1 rounded-full transition-colors duration-300 ${
            i < step ? "bg-brand" : "bg-line"
          }`}
        />
      ))}
    </div>
  );
}

export function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`flex min-h-14 items-center gap-2 rounded-2xl border-2 px-4 py-2.5 text-left text-base font-medium transition-all duration-200 ${
        selected
          ? "border-brand bg-brand-soft text-brand-dark shadow-sm"
          : "border-line bg-white text-ink hover:border-brand/40 hover:bg-[#faf7ff]"
      }`}
    >
      {children}
    </button>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "sun" | "brand";
}) {
  const styles = {
    neutral: "bg-[#f2eff5] text-muted",
    good: "bg-good-soft text-good",
    sun: "bg-sun-soft text-warn",
    brand: "bg-brand-soft text-brand-dark",
  }[tone];

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide ${styles}`}>
      {children}
    </span>
  );
}
