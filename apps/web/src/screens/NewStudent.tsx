
import { useState } from "react";
import type { Go } from "../App";
import { Button, Screen, SpeakButton } from "../components/ui";
import { newId, saveStudent } from "../lib/db";
import { useT } from "../lib/i18n";

const AVATARS = ["🦚", "🐘", "🐅", "🌻", "🌙", "⭐", "🐟", "🦋", "🌳", "🪔", "🥭", "🐓"];

const lastCode = () => {
  try {
    return localStorage.getItem("disha.code") ?? "";
  } catch {
    return "";
  }
};

export default function NewStudent({ go }: { go: Go }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [code, setCode] = useState(lastCode);
  const [birthYear, setBirthYear] = useState("");
  const year = Number(birthYear);
  const validYear =
    Number.isInteger(year) &&
    year >= 1950 &&
    year <= new Date().getFullYear() - 8;

  const create = async () => {
    const id = newId();
    const facilitator_code = code.trim().toUpperCase() || undefined;

    try {
      if (facilitator_code) localStorage.setItem("disha.code", facilitator_code);
    } catch {
      /* ignore */
    }

    await saveStudent({
      id,
      name: name.trim() || avatar,
      avatar,
      facilitator_code,
      birth_year: validYear ? year : undefined,
      cards: {},
      answers: {},
      factAnswers: {},
      updated_at: Date.now(),
    });

    go({ name: "consent", id });
  };

  return (
    <Screen title={t("newStudent")} onBack={() => go({ name: "home" })}>
      <div className="flex flex-col gap-6 pb-4">

        {/* Avatar selection */}
        <section className="rounded-3xl border border-[#eee5fa] bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <h2 className="flex-1 text-lg font-bold text-[#49365f]">
              {t("pickPicture")}
            </h2>
            <SpeakButton
              text={t("pickPicture")}
              audioKey="pick_picture"
            />
          </div>

          <div className="grid grid-cols-4 gap-3">
            {AVATARS.map((a) => (
              <button
                key={a}
                onClick={() => setAvatar(a)}
                aria-pressed={avatar === a}
                className={`flex aspect-square items-center justify-center rounded-2xl border-2 text-4xl transition-all duration-200 ${
                  avatar === a
                    ? "scale-105 border-[#9274c8] bg-[#eee6fa] shadow-md"
                    : "border-[#eee7f3] bg-[#fcfaff] hover:border-[#c9b4e8] hover:bg-[#f6f0ff]"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </section>

        {/* Student details */}
        <section className="flex flex-col gap-5 rounded-3xl border border-[#eee5fa] bg-white p-4 shadow-sm">
          <label className="flex flex-col gap-2">
            <span className="font-semibold text-[#49365f]">
              {t("yourName")}
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-h-14 rounded-2xl border-2 border-[#eee7f3] bg-[#fcfaff] px-4 text-lg text-[#352b43] outline-none transition focus:border-[#9274c8] focus:bg-white focus:ring-4 focus:ring-[#eee6fa]"
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="font-semibold text-[#49365f]">
              {t("birthYear")}
            </span>
            <input
              value={birthYear}
              onChange={(e) =>
                setBirthYear(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              inputMode="numeric"
              placeholder="2010"
              className="min-h-14 rounded-2xl border-2 border-[#eee7f3] bg-[#fcfaff] px-4 text-lg text-[#352b43] outline-none transition placeholder:text-[#b5a9c2] focus:border-[#9274c8] focus:bg-white focus:ring-4 focus:ring-[#eee6fa]"
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="font-semibold text-[#49365f]">
              {t("facilitatorCode")}
            </span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="PSG01"
              className="min-h-14 rounded-2xl border-2 border-[#eee7f3] bg-[#fcfaff] px-4 text-lg uppercase text-[#352b43] outline-none transition placeholder:text-[#b5a9c2] focus:border-[#9274c8] focus:bg-white focus:ring-4 focus:ring-[#eee6fa]"
              autoComplete="off"
            />
          </label>
        </section>

        <Button
          className="mt-1 w-full rounded-2xl shadow-md"
          disabled={!avatar}
          onClick={create}
        >
          {t("next")} →
        </Button>
      </div>
    </Screen>
  );
}
