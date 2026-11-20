import { useState } from "react";
import type { Go } from "../App";
import { Button, Screen, SpeakButton } from "../components/ui";
import { newId, saveStudent } from "../lib/db";
import { useT } from "../lib/i18n";
import { Icon } from "../components/Icon";

const AVATARS = ["🦚", "🐘", "🐅", "🌻", "🌙", "⭐", "🐟", "🦋", "🌳", "🪔", "🥭", "🐓"];

const lastCode = () => { try { return localStorage.getItem("disha.code") ?? ""; } catch { return ""; } };

export default function NewStudent({ go }: { go: Go }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [code, setCode] = useState(lastCode);
  const [birthYear, setBirthYear] = useState("");
  const year = Number(birthYear);
  const validYear = Number.isInteger(year) && year >= 1950 && year <= new Date().getFullYear() - 8;

  const create = async () => {
    const id = newId();
    const facilitator_code = code.trim().toUpperCase() || undefined;
    try { if (facilitator_code) localStorage.setItem("disha.code", facilitator_code); } catch { /* ignore */ }
    await saveStudent({
      id, name: name.trim() || avatar, avatar, facilitator_code, birth_year: validYear ? year : undefined,
      cards: {}, answers: {}, factAnswers: {}, updated_at: Date.now(),
    });
    go({ name: "situation", id });
  };

  return (
    <Screen title={t("newStudent")} onBack={() => go({ name: "home" })}>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-lg font-semibold">{t("pickPicture")}</h2>
        <SpeakButton text={t("pickPicture")} audioKey="pick_picture" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        {AVATARS.map((a) => (
          <button
            key={a}
            onClick={() => setAvatar(a)}
            aria-pressed={avatar === a}
            className={`aspect-square rounded-xl border text-4xl ${avatar === a ? "border-brand bg-brand-soft ring-1 ring-brand" : "border-line bg-surface"}`}
          >
            {a}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("yourName")}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-h-14 rounded-xl border border-line bg-surface px-4 text-lg"
          autoComplete="off"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("birthYear")}</span>
        <input
          value={birthYear}
          onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          placeholder="2010"
          className="min-h-14 rounded-xl border border-line bg-surface px-4 text-lg"
          autoComplete="off"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("facilitatorCode")}</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="PSG01"
          className="min-h-14 rounded-xl border border-line bg-surface px-4 text-lg uppercase"
          autoComplete="off"
        />
      </label>

      <Button className="mt-auto" disabled={!avatar} onClick={create}>{t("next")} <Icon name="next" className="size-5" /></Button>
    </Screen>
  );
}
