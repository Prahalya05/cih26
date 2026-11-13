import { useState } from "react";
import type { Go } from "../App";
import { Button, Screen, SpeakButton } from "../components/ui";
import { newId, saveStudent } from "../lib/db";
import { useT } from "../lib/i18n";

const AVATARS = ["🦚", "🐘", "🐅", "🌻", "🌙", "⭐", "🐟", "🦋", "🌳", "🪔", "🥭", "🐓"];

const lastCode = () => { try { return localStorage.getItem("disha.code") ?? ""; } catch { return ""; } };

export default function NewStudent({ go }: { go: Go }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [code, setCode] = useState(lastCode);

  const create = async () => {
    const id = newId();
    const facilitator_code = code.trim().toUpperCase() || undefined;
    try { if (facilitator_code) localStorage.setItem("disha.code", facilitator_code); } catch { /* ignore */ }
    await saveStudent({
      id, name: name.trim() || avatar, avatar, facilitator_code,
      cards: {}, answers: {}, factAnswers: {}, updated_at: Date.now(),
    });
    go({ name: "consent", id });
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
            className={`aspect-square rounded-2xl border-2 text-4xl ${avatar === a ? "border-brand bg-brand-soft" : "border-line bg-white"}`}
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
          className="min-h-14 rounded-2xl border-2 border-line bg-white px-4 text-lg"
          autoComplete="off"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("facilitatorCode")}</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="PSG01"
          className="min-h-14 rounded-2xl border-2 border-line bg-white px-4 text-lg uppercase"
          autoComplete="off"
        />
      </label>

      <Button className="mt-auto" disabled={!avatar} onClick={create}>{t("next")} →</Button>
    </Screen>
  );
}
