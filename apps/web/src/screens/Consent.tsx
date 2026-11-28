// Consent with separate scopes (Step 11.1). "assess" is needed to use Disha; the other two are optional.
// Under 18 (or age unknown) a parent must agree on the signed paper form. OTP to the parent's phone is not built yet.

import { useState } from "react";
import type { Go } from "../App";
import { nextStep } from "./Home";
import { Button, Screen, SpeakButton, useLive } from "../components/ui";
import { db, isMinorStudent, patchStudent, type ConsentMethod, type Scope } from "../lib/db";
import { useT, type StringKey } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { apiFetch } from "../lib/api";
import { isOnline, syncNow } from "../lib/sync";

export const OPTIONAL_SCOPES: { scope: Scope; key: StringKey }[] = [
  { scope: "photos", key: "consentPhotos" },
  { scope: "share_portfolio", key: "consentShare" },
  { scope: "publish_profile", key: "consentPublish" },
];

export default function Consent({ go, id }: { go: Go; id: string }) {
  const { t } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined);
  const [extra, setExtra] = useState<Set<Scope>>(new Set());
  const [method, setMethod] = useState<ConsentMethod>("paper_form");
  const [guardian, setGuardian] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpDemo, setOtpDemo] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpErr, setOtpErr] = useState("");
  if (!student) return null;
  const minor = isMinorStudent(student);
  const by: ConsentMethod = minor && method === "self_18plus" ? "paper_form" : method;
  const methods: ConsentMethod[] = minor ? ["paper_form", "otp"] : ["paper_form", "otp", "self_18plus"];

  const toggle = (s: Scope) => setExtra((cur) => {
    const next = new Set(cur);
    if (next.has(s)) next.delete(s); else next.add(s);
    return next;
  });

  const sendGuardianOtp = async () => {
    setOtpErr("");
    if (!isOnline()) { setOtpErr(t("offline")); return; }
    await syncNow();
    const r = await apiFetch("/v2/consent/guardian-otp", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_id: id, phone: guardianPhone }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) { setOtpErr(out.detail ?? "Error"); return; }
    setOtpSent(true);
    setOtpDemo(out.demo_code ?? null);
  };

  const verifyGuardianOtp = async () => {
    setOtpErr("");
    const r = await apiFetch("/v2/consent/guardian-otp/verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_id: id, code: otpCode }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) { setOtpErr(out.detail ?? "Wrong code"); return; }
    setOtpVerified(true);
  };

  const agree = async () => {
    await patchStudent(id, (s) => ({
      ...s,
      consent: {
        at: Date.now(), scopes: ["assess", ...extra], method: by,
        guardian_name: by !== "self_18plus" && guardian.trim() ? guardian.trim() : undefined,
      },
    }));
    const s = await db.students.get(id);
    go(s ? nextStep(s) : { name: "home" });
  };

  return (
    <Screen title={t("consentTitle")} onBack={() => go({ name: "home" })}>
      <div className="flex flex-col items-center gap-3 pt-4 text-center">
        <span className="flex size-16 items-center justify-center rounded-xl bg-brand text-accent"><Icon name="users" className="size-8" /></span>
        <h2 className="text-2xl font-extrabold">{t("consentTitle")}</h2>
      </div>
      <div className="flex items-start gap-3 rounded-2xl bg-surface p-5 border border-line">
        <p className="flex-1 text-lg leading-relaxed">{t("consentBody")}</p>
        <SpeakButton text={t("consentBody")} audioKey="consent" />
      </div>

      <section className="flex flex-col gap-2 rounded-2xl bg-surface p-4 border border-line">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 font-semibold">{t("consentScopes")}</h3>
          <SpeakButton text={[t("consentAssess"), ...OPTIONAL_SCOPES.map((o) => t(o.key))].join(". ")} />
        </div>
        <label className="flex items-start gap-3 rounded-xl bg-brand-soft p-3">
          <input type="checkbox" checked disabled className="mt-1 size-6" />
          <span>{t("consentAssess")}</span>
        </label>
        {OPTIONAL_SCOPES.map((o) => (
          <label key={o.scope} className="flex items-start gap-3 rounded-xl border border-line p-3">
            <input type="checkbox" checked={extra.has(o.scope)} onChange={() => toggle(o.scope)} className="mt-1 size-6" />
            <span>{t(o.key)}</span>
          </label>
        ))}
      </section>

      <section className="flex flex-col gap-2 rounded-2xl bg-surface p-4 border border-line">
        <h3 className="font-semibold">{t("consentWho")}</h3>
        {methods.map((m) => (
          <label key={m} className="flex items-start gap-3 rounded-xl border border-line p-3">
            <input type="radio" name="method" checked={by === m} onChange={() => setMethod(m)} className="mt-1 size-6" />
            <span>{t(m === "paper_form" ? "methodPaper" : m === "otp" ? "methodOtp" : "methodSelf")}</span>
          </label>
        ))}
        {by === "paper_form" && (
          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted">{t("guardianName")}</span>
            <input value={guardian} onChange={(e) => setGuardian(e.target.value)} autoComplete="off"
              className="min-h-12 rounded-xl border border-line bg-surface px-4 text-lg" />
          </label>
        )}
        {by === "otp" && (
          <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
            <div className="flex gap-2">
              <input value={guardianPhone} onChange={(e) => setGuardianPhone(e.target.value)} placeholder="9876543210" inputMode="tel"
                className="min-h-11 flex-1 rounded-lg border border-line px-3" />
              <Button kind="soft" disabled={guardianPhone.trim().length < 6} onClick={() => void sendGuardianOtp()}>{t("sendOtp")}</Button>
            </div>
            {otpDemo && <p className="rounded bg-brand-soft px-2 py-1 font-mono text-xs">{t("otpDemoCode")}: <strong>{otpDemo}</strong></p>}
            {otpSent && !otpVerified && (
              <div className="flex gap-2">
                <input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder={t("enterOtp")} inputMode="numeric"
                  className="min-h-11 flex-1 rounded-lg border border-line px-3 font-mono" />
                <Button kind="soft" onClick={() => void verifyGuardianOtp()}>{t("check")}</Button>
              </div>
            )}
            {otpVerified && <p className="text-xs text-good"><Icon name="check" className="mr-1 inline size-3.5" />OK</p>}
            {otpErr && <p className="text-xs text-warn">{otpErr}</p>}
          </div>
        )}
      </section>

      <Button className="mt-auto" disabled={by === "otp" && !otpVerified} onClick={agree}><Icon name="check" className="size-5" />{t(by === "self_18plus" ? "consentAgreeSelf" : "consentAgree")}</Button>
    </Screen>
  );
}
