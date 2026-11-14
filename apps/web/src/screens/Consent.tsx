
// Consent with separate scopes (Step 11.1). "assess" is needed to use Disha; the other two are optional.
// Under 18 (or age unknown) a parent must agree on the signed paper form. OTP to the parent's phone is not built yet.

import { useState } from "react";
import type { Go } from "../App";
import { nextStep } from "./Home";
import { Button, Screen, SpeakButton, useLive } from "../components/ui";
import { db, isMinorStudent, patchStudent, type ConsentMethod, type Scope } from "../lib/db";
import { useT, type StringKey } from "../lib/i18n";

export const OPTIONAL_SCOPES: { scope: Scope; key: StringKey }[] = [
  { scope: "photos", key: "consentPhotos" },
  { scope: "share_portfolio", key: "consentShare" },
];

export default function Consent({ go, id }: { go: Go; id: string }) {
  const { t } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined);
  const [extra, setExtra] = useState<Set<Scope>>(new Set());
  const [method, setMethod] = useState<ConsentMethod>("paper_form");
  const [guardian, setGuardian] = useState("");

  if (!student) return null;

  const minor = isMinorStudent(student);
  const by: ConsentMethod = minor ? "paper_form" : method;
  const methods: ConsentMethod[] = minor
    ? ["paper_form"]
    : ["paper_form", "self_18plus"];

  const toggle = (s: Scope) => setExtra((cur) => {
    const next = new Set(cur);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    return next;
  });

  const agree = async () => {
    await patchStudent(id, (s) => ({
      ...s,
      consent: {
        at: Date.now(),
        scopes: ["assess", ...extra],
        method: by,
        guardian_name:
          by === "paper_form" && guardian.trim()
            ? guardian.trim()
            : undefined,
      },
    }));

    const s = await db.students.get(id);
    go(s ? nextStep(s) : { name: "home" });
  };

  return (
    <Screen
      title={t("consentTitle")}
      onBack={() => go({ name: "home" })}
    >
      <div className="flex flex-col gap-5 pb-5">

        {/* Consent heading */}
        <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#a98cdd] via-[#b99cde] to-[#e2b4d8] px-5 py-7 text-center text-white shadow-lg shadow-[#b99cde]/20">
          <div className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-white/15" />
          <div className="pointer-events-none absolute -bottom-16 -left-8 size-40 rounded-full bg-white/10" />

          <div className="relative flex flex-col items-center gap-3">
            <span className="flex size-20 items-center justify-center rounded-3xl border border-white/30 bg-white/20 text-5xl shadow-sm">
              👨‍👩‍👧
            </span>
            <h2 className="text-2xl font-bold">
              {t("consentTitle")}
            </h2>
          </div>
        </section>

        {/* Consent information */}
        <section className="rounded-3xl border border-[#eee5fa] bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <p className="flex-1 text-base leading-7 text-[#554965]">
              {t("consentBody")}
            </p>
            <SpeakButton
              text={t("consentBody")}
              audioKey="consent"
            />
          </div>
        </section>

        {/* Permission scopes */}
        <section className="flex flex-col gap-3 rounded-3xl border border-[#eee5fa] bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 pb-1">
            <h3 className="flex-1 text-lg font-bold text-[#49365f]">
              {t("consentScopes")}
            </h3>
            <SpeakButton
              text={[
                t("consentAssess"),
                ...OPTIONAL_SCOPES.map((o) => t(o.key)),
              ].join(". ")}
            />
          </div>

          <label className="flex items-start gap-3 rounded-2xl border border-[#d9c9f0] bg-[#f3edfc] p-4">
            <input
              type="checkbox"
              checked
              disabled
              className="mt-1 size-5 accent-[#9274c8]"
            />
            <span className="flex-1 text-sm font-medium leading-6 text-[#49365f]">
              {t("consentAssess")}
            </span>
          </label>

          {OPTIONAL_SCOPES.map((o) => (
            <label
              key={o.scope}
              className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-4 transition-all duration-200 ${
                extra.has(o.scope)
                  ? "border-[#9274c8] bg-[#f5f0fc]"
                  : "border-[#eee7f3] bg-[#fcfaff] hover:border-[#c9b4e8]"
              }`}
            >
              <input
                type="checkbox"
                checked={extra.has(o.scope)}
                onChange={() => toggle(o.scope)}
                className="mt-1 size-5 accent-[#9274c8]"
              />
              <span className="flex-1 text-sm font-medium leading-6 text-[#49365f]">
                {t(o.key)}
              </span>
            </label>
          ))}
        </section>

        {/* Consent method */}
        <section className="flex flex-col gap-3 rounded-3xl border border-[#eee5fa] bg-white p-4 shadow-sm">
          <h3 className="pb-1 text-lg font-bold text-[#49365f]">
            {t("consentWho")}
          </h3>

          {methods.map((m) => (
            <label
              key={m}
              className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-4 transition-all duration-200 ${
                by === m
                  ? "border-[#9274c8] bg-[#f5f0fc]"
                  : "border-[#eee7f3] bg-[#fcfaff] hover:border-[#c9b4e8]"
              }`}
            >
              <input
                type="radio"
                name="method"
                checked={by === m}
                onChange={() => setMethod(m)}
                className="mt-1 size-5 accent-[#9274c8]"
              />
              <span className="flex-1 text-sm font-medium leading-6 text-[#49365f]">
                {t(m === "paper_form" ? "methodPaper" : "methodSelf")}
              </span>
            </label>
          ))}

          {by === "paper_form" && (
            <label className="flex flex-col gap-2 pt-1">
              <span className="text-sm font-semibold text-[#665576]">
                {t("guardianName")}
              </span>
              <input
                value={guardian}
                onChange={(e) => setGuardian(e.target.value)}
                autoComplete="off"
                className="min-h-14 rounded-2xl border-2 border-[#eee7f3] bg-[#fcfaff] px-4 text-base text-[#352b43] outline-none transition placeholder:text-[#b5a9c2] focus:border-[#9274c8] focus:bg-white focus:ring-4 focus:ring-[#eee6fa]"
              />
            </label>
          )}
        </section>

        {/* Agreement */}
        <Button
          className="mt-1 w-full rounded-2xl shadow-md"
          onClick={agree}
        >
          ✅ {t(by === "self_18plus" ? "consentAgreeSelf" : "consentAgree")}
        </Button>
      </div>
    </Screen>
  );
}
