import { useState } from "react";
import type { Go } from "../App";
import { Button, Screen, SpeakButton } from "../components/ui";
import { newId, saveStudent } from "../lib/db";
import { useT } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { call, currentAccount, saveAccount, useAccount } from "../lib/auth";

const AVATARS = ["🦚", "🐘", "🐅", "🌻", "🌙", "⭐", "🐟", "🦋", "🌳", "🪔", "🥭", "🐓"];

const lastCode = () => { try { return localStorage.getItem("disha.code") ?? ""; } catch { return ""; } };

export default function NewStudent({ go }: { go: Go }) {
  const { t } = useT();
  const account = useAccount();
  // A signed-in student making her own profile: her name and class come from her account.
  const own = account?.role === "student" && !account.student_id;
  const [name, setName] = useState(() => (own && account?.name ? account.name : ""));
  const [avatar, setAvatar] = useState("");
  const [code, setCode] = useState(() => account?.class_code ?? lastCode());
  const [birthYear, setBirthYear] = useState("");
  const year = Number(birthYear);
  const validYear = Number.isInteger(year) && year >= 1950 && year <= new Date().getFullYear() - 8;

  const create = async () => {
    const id = newId();
    const facilitator_code = (account?.class_code || code.trim().toUpperCase()) || undefined;
    try { if (facilitator_code) localStorage.setItem("disha.code", facilitator_code); } catch { /* ignore */ }
    await saveStudent({
      id, name: name.trim() || avatar, avatar, facilitator_code, birth_year: validYear ? year : undefined,
      cards: {}, answers: {}, factAnswers: {}, updated_at: Date.now(),
    });
    // Her account remembers this profile, so it opens straight away next time (and on another phone after sync).
    const acc = await currentAccount();
    if (acc?.role === "student" && !acc.student_id) {
      await saveAccount({ ...acc, student_id: id });
      void call("/v2/auth/me/student", { method: "POST", body: JSON.stringify({ student_id: id }) });
    }
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
