// Sign in with a phone number or email and a one-time code. One screen for every role: student, teacher, donor,
// employer/customer. New people also give their name, their school's code (students, teachers) or organisation
// (donors, employers), and agree to the privacy notice. The role of a student or teacher comes from the school's
// code on the server, never from this screen.

import { useState } from "react";
import { Button, Screen, SpeakButton } from "../components/ui";
import { Icon } from "../components/Icon";
import { useT, type StringKey } from "../lib/i18n";
import { requestOtp, verifyOtp, type AccountRole, type OtpSent } from "../lib/auth";

const ROLES: { role: AccountRole; emoji: string; label: StringKey; hint: StringKey }[] = [
  { role: "student", emoji: "🎒", label: "roleStudent", hint: "roleStudentHint" },
  { role: "teacher", emoji: "🧑‍🏫", label: "roleTeacher", hint: "roleTeacherHint" },
  { role: "funder", emoji: "🤝", label: "roleFunder", hint: "roleFunderHint" },
  { role: "employer", emoji: "🏪", label: "roleEmployer", hint: "roleEmployerHint" },
];

export default function SignIn({ onExplore }: { onExplore: () => void }) {
  const { t } = useT();
  const [role, setRole] = useState<AccountRole | null>(null);
  const [login, setLogin] = useState("");
  const [sent, setSent] = useState<OtpSent | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [privacyOk, setPrivacyOk] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ask = async () => {
    setBusy(true); setError("");
    const r = await requestOtp(login);
    setBusy(false);
    if ("error" in r) setError(r.error);
    else { setSent(r); setCode(""); }
  };

  const verify = async () => {
    setBusy(true); setError("");
    const extra = sent?.new_account && role ? { role, name, org: org || undefined, join_code: joinCode || undefined, privacy_ok: privacyOk } : undefined;
    const r = await verifyOtp(login, code, extra);
    setBusy(false);
    if ("error" in r) setError(r.error);
  };

  // ---- step 1: who are you ----
  if (!role) {
    return (
      <Screen>
        <section className="relative overflow-hidden rounded-3xl bg-brand px-5 pt-6 pb-5 text-white">
          <svg viewBox="0 0 200 200" className="pointer-events-none absolute -top-16 -right-16 size-56 opacity-25" aria-hidden>
            <path d="M100 12a88 88 0 1 1-80 51" fill="none" stroke="var(--color-accent)" strokeWidth="14" strokeLinecap="round" />
          </svg>
          <p className="eyebrow !text-accent">Disha</p>
          <p className="relative mt-2 max-w-[17rem] text-[1.6rem] leading-[1.2] font-extrabold">{t("tagline")}</p>
        </section>
        <div className="flex items-end justify-between pt-1">
          <h2 className="text-xl font-extrabold">{t("whoAreYou")}</h2>
          <SpeakButton text={t("whoAreYou")} />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {ROLES.map((r) => (
            <button key={r.role} onClick={() => setRole(r.role)}
              className="flex flex-col items-start gap-1 rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-accent active:scale-[0.98]">
              <span className="text-4xl" aria-hidden>{r.emoji}</span>
              <span className="text-base font-extrabold">{t(r.label)}</span>
              <span className="text-xs leading-snug text-muted">{t(r.hint)}</span>
            </button>
          ))}
        </div>
        <button onClick={onExplore} className="mt-2 inline-flex items-center justify-center gap-2 text-sm font-bold text-accent-dark">
          <Icon name="scan" className="size-4" />{t("exploreWithout")}
        </button>
      </Screen>
    );
  }

  const roleInfo = ROLES.find((r) => r.role === role)!;

  return (
    <Screen title={`${roleInfo.emoji} ${t(roleInfo.label)}`} onBack={() => { if (sent) setSent(null); else setRole(null); setError(""); }}>
      {!sent && (
        <>
          <h2 className="text-xl font-extrabold">{t("signInTitle")}</h2>
          <p className="text-muted">{t("signInHint")}</p>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t("phoneOrEmail")}</span>
            <input value={login} onChange={(e) => setLogin(e.target.value)} inputMode="email" autoComplete="username"
              placeholder="98765 43210 / name@mail.com" className="min-h-14 rounded-xl border border-line bg-surface px-4 text-lg" />
          </label>
          <Button disabled={login.trim().length < 5 || busy} onClick={() => void ask()}>{busy ? "…" : t("getCode")} <Icon name="next" className="size-5" /></Button>
          <p className="flex items-start gap-2 text-xs text-muted"><Icon name="lock" className="mt-0.5 size-4 shrink-0" />{t("loginPrivacyNote")}</p>
        </>
      )}

      {sent && (
        <>
          <p className="text-muted">{t("codeSentTo", { to: sent.sent_to, min: sent.minutes })}</p>
          {sent.demo_code && (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-accent bg-brand-soft p-3">
              <Icon name="info" className="size-5 shrink-0 text-accent-dark" />
              <p className="flex-1 text-sm">{t("demoCode")} <b className="font-mono text-lg tracking-widest">{sent.demo_code}</b></p>
              <button onClick={() => setCode(sent.demo_code!)} className="rounded-lg bg-surface px-3 py-1.5 text-sm font-bold">{t("useIt")}</button>
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t("enterCode")}</span>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code"
              placeholder="••••••" className="min-h-14 rounded-xl border border-line bg-surface px-4 text-center font-mono text-2xl tracking-[0.5em]" />
          </label>

          {sent.new_account && (
            <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
              <p className="font-bold">{t("newAccount")}</p>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-semibold">{t("yourName")}</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className="min-h-12 rounded-xl border border-line px-3 text-base" />
              </label>
              {(role === "student" || role === "teacher") && (
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">{role === "student" ? t("classCodeLabel") : t("teacherCodeLabel")}</span>
                  <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder={role === "student" ? "DEMO-XXXXX" : ""}
                    className="min-h-12 rounded-xl border border-line px-3 text-base uppercase" />
                  <span className="text-xs text-muted">{role === "student" ? t("classCodeHint") : t("teacherCodeHint")}</span>
                </label>
              )}
              {(role === "funder" || role === "employer") && (
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">{t("orgName")}</span>
                  <input value={org} onChange={(e) => setOrg(e.target.value)} className="min-h-12 rounded-xl border border-line px-3 text-base" />
                </label>
              )}
              <label className="flex items-start gap-3">
                <input type="checkbox" checked={privacyOk} onChange={(e) => setPrivacyOk(e.target.checked)} className="mt-1 size-5 accent-[var(--color-brand)]" />
                <span className="text-sm">{t("privacyAgree")} <button type="button" className="font-bold text-accent-dark underline" onClick={() => setShowPrivacy(!showPrivacy)}>{t("readPrivacy")}</button></span>
              </label>
              {showPrivacy && <PrivacyNotice role={role} />}
            </section>
          )}

          <Button disabled={code.length !== 6 || busy || (sent.new_account && (!name.trim() || !privacyOk || ((role === "student" || role === "teacher") && !joinCode.trim())))}
            onClick={() => void verify()}>{busy ? "…" : t("signInButton")} <Icon name="check" className="size-5" /></Button>
          <button onClick={() => void ask()} className="text-sm font-bold text-accent-dark">{t("resendCode")}</button>
        </>
      )}
      {error && <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm font-semibold text-bad">{error}</p>}
    </Screen>
  );
}

/** What Disha keeps about this kind of account, in plain words (also on the Account screen). */
export function PrivacyNotice({ role }: { role: AccountRole }) {
  const { t } = useT();
  const lines: StringKey[] = ["pn_login", "pn_never_sell", "pn_delete",
    ...(role === "student" ? ["pn_student", "pn_parent"] as StringKey[] : []),
    ...(role === "teacher" ? ["pn_teacher"] as StringKey[] : []),
    ...(role === "funder" ? ["pn_funder"] as StringKey[] : []),
    ...(role === "employer" ? ["pn_employer"] as StringKey[] : [])];
  return (
    <ul className="flex flex-col gap-1.5 rounded-xl bg-paper p-3 text-sm">
      {lines.map((k) => <li key={k} className="flex gap-2"><Icon name="shield" className="mt-0.5 size-4 shrink-0 text-good" />{t(k)}</li>)}
    </ul>
  );
}
