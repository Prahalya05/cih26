// Shown before filming or choosing a work video: what she must do, what the phone checks, and what happens to the video.
// Nothing here is sent anywhere; it only explains the rules before the camera or gallery opens.

import { useState } from "react";
import { useT } from "../lib/i18n";
import { Icon } from "./Icon";
import { Button } from "./ui";

type Next = "film" | "upload";

const RULES: { icon: "video" | "bulb" | "users" | "phone" | "eyeOff" | "shield"; key: string }[] = [
  { icon: "video", key: "ruleHands" },
  { icon: "bulb", key: "ruleLight" },
  { icon: "users", key: "ruleAlone" },
  { icon: "phone", key: "ruleNoScreens" },
  { icon: "eyeOff", key: "rulePrivacy" },
  { icon: "shield", key: "ruleChecked" },
];

export function VideoRules({ next, onFilm, onFile, onCancel }: {
  next: Next;
  /** short: a normal video up to 3 min; long: up to an hour, kept as one picture a second plus full-speed clips */
  onFilm: (mode: "short" | "long") => void;
  onFile: (file: File | undefined) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [agreed, setAgreed] = useState(false);
  const [mode, setMode] = useState<"short" | "long">("short");
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <p className="flex items-center gap-2 text-lg font-extrabold"><Icon name="info" className="size-5 text-accent-dark" />{t("rulesTitle")}</p>
      <ul className="flex flex-col gap-2">
        {RULES.map((r) => (
          <li key={r.key} className="flex gap-3">
            <Icon name={r.icon} className="mt-0.5 size-5 shrink-0 text-accent-dark" />
            <span>{t(r.key as "ruleHands")}</span>
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2 rounded-xl bg-paper p-3 font-semibold">
        <input type="checkbox" className="size-5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        {t("rulesAgree")}
      </label>
      {next === "film" && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-bold">{t("modeTitle")}</legend>
          {(["short", "long"] as const).map((m) => (
            <label key={m} className={`flex gap-3 rounded-xl border p-3 ${mode === m ? "border-accent bg-brand-soft/60" : "border-line"}`}>
              <input type="radio" name="mode" className="mt-1 size-5" checked={mode === m} onChange={() => setMode(m)} />
              <span><span className="font-bold">{t(m === "short" ? "modeShort" : "modeLong")}</span><br />
                <span className="text-sm text-muted">{t(m === "short" ? "modeShortHint" : "modeLongHint")}</span></span>
            </label>
          ))}
        </fieldset>
      )}
      {next === "film" && (
        <Button disabled={!agreed} onClick={() => onFilm(mode)}><Icon name="video" className="size-5" />{t("rulesStart")}</Button>
      )}
      {next === "upload" && (
        <label className={`flex min-h-13 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-base font-bold text-white ${agreed ? "cursor-pointer" : "pointer-events-none opacity-40"}`}>
          <Icon name="layers" className="size-5" />{t("chooseVideo")}
          <input type="file" accept="video/*" className="hidden" disabled={!agreed} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      )}
      <button className="text-sm text-muted underline" onClick={onCancel}>{t("rulesBack")}</button>
    </section>
  );
}
