// The page a buyer opens from the student's link (#confirm=token): three yes/no taps, optional phone OTP, works once.

import { useEffect, useState } from "react";
import { Button, Screen } from "../components/ui";
import { useT } from "../lib/i18n";
import { Icon } from "../components/Icon";

const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
type Info = { student: string; skill: { en: string; ta?: string }; what: string; amount_inr: number; otp_required?: boolean;
  privacy?: { kept: string[]; optional: string[]; never: string[]; delete_after_days: number } };
const QUESTIONS = ["on_time", "quality", "rehire"] as const;

export default function ConfirmJob({ token, onClose }: { token: string; onClose: () => void }) {
  const { t, pick } = useT();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Partial<Record<(typeof QUESTIONS)[number], boolean>>>({});
  const [done, setDone] = useState(false);
  // Customer privacy (guard.buyer_privacy): nothing about the customer is kept unless they say yes here.
  const [privacyOk, setPrivacyOk] = useState(false);
  const [shareName, setShareName] = useState(false);
  const [buyerName, setBuyerName] = useState("");
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");

  useEffect(() => {
    fetch(`${API}/v2/confirm/info`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
    })
      .then(async (r) => (r.ok ? setInfo(await r.json()) : setError((await r.json()).detail ?? t("linkInvalid"))))
      .catch(() => setError(t("offline")));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendOtp = async () => {
    setError(null);
    const r = await fetch(`${API}/v2/confirm/otp`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, phone }),
    });
    const out = await r.json();
    if (!r.ok) { setError(out.detail ?? t("linkInvalid")); return; }
    setOtpSent(true);
    setDemoCode(out.demo_code ?? null);
  };

  const send = async () => {
    setError(null);
    const r = await fetch(`${API}/v2/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token, ...answers,
        share_name: shareName && !!buyerName.trim(),
        buyer_name: shareName ? buyerName.trim() : null,
        otp_code: otpCode.trim() || null,
      }),
    });
    if (r.ok) setDone(true);
    else setError((await r.json()).detail ?? t("linkInvalid"));
  };

  return (
    <Screen title={t("confirmJobTitle")} onBack={onClose}>
      {error && <p className="rounded-xl bg-sun-soft p-4 text-warn">{error}</p>}
      {done && <p className="rounded-2xl bg-good-soft p-6 text-center text-xl font-semibold text-good">{t("thanksBuyer")}</p>}
      {info && !done && (
        <>
          <p className="text-lg">{t("confirmJobIntro", { name: info.student, skill: pick(info.skill), amount: info.amount_inr })}</p>
          {info.what && <p className="text-muted">“{info.what}”</p>}
          <div className="rounded-2xl border border-line bg-surface p-4 text-sm">
            <p className="flex items-center gap-2 font-bold"><Icon name="shield" className="size-4 text-good" />{t("buyerPrivacyTitle")}</p>
            <p className="mt-1">{t("buyerPrivacyKept")}</p>
            <p className="mt-1 text-muted">{t("buyerPrivacyNever")}</p>
            <label className="mt-3 flex items-start gap-2"><input type="checkbox" className="mt-1 size-5" checked={privacyOk} onChange={(e) => setPrivacyOk(e.target.checked)} />{t("buyerPrivacyOk")}</label>
            <label className="mt-2 flex items-start gap-2"><input type="checkbox" className="mt-1 size-5" checked={shareName} onChange={(e) => setShareName(e.target.checked)} />{t("buyerShareName")}</label>
            {shareName && <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder={t("yourName")} className="mt-2 min-h-11 w-full rounded-lg border border-line px-3" />}
          </div>
          <div className="rounded-2xl border border-line bg-surface p-4 text-sm">
            <p className="font-semibold">{t("buyerPhoneOptional")}</p>
            <div className="mt-2 flex gap-2">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9876543210" inputMode="tel"
                className="min-h-11 flex-1 rounded-lg border border-line px-3" />
              <Button kind="soft" disabled={phone.trim().length < 6} onClick={() => void sendOtp()}>{t("sendOtp")}</Button>
            </div>
            {otpSent && (
              <div className="mt-2 flex flex-col gap-2">
                {demoCode && <p className="rounded-lg bg-brand-soft px-3 py-1.5 font-mono text-xs">{t("otpDemoCode")}: <strong>{demoCode}</strong></p>}
                <input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder={t("enterOtp")} inputMode="numeric"
                  className="min-h-11 w-full rounded-lg border border-line px-3 font-mono" />
              </div>
            )}
          </div>
          {QUESTIONS.map((q) => (
            <div key={q} className="rounded-2xl bg-surface p-4 border border-line">
              <p className="font-semibold">{t(`buyer_${q}`)}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {[true, false].map((v) => (
                  <button key={String(v)} onClick={() => setAnswers({ ...answers, [q]: v })} aria-pressed={answers[q] === v}
                    className={`inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border text-lg font-semibold ${answers[q] === v ? "border-brand bg-brand text-white" : "border-line"}`}>
                    {v ? <><Icon name="up" className="size-5" />{t("yes")}</> : <><Icon name="down" className="size-5" />{t("no")}</>}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <Button disabled={!privacyOk || QUESTIONS.some((q) => answers[q] === undefined) || ((otpSent || info.otp_required) && otpCode.trim().length < 4)} onClick={() => void send()}>{t("send")}</Button>
        </>
      )}
    </Screen>
  );
}
