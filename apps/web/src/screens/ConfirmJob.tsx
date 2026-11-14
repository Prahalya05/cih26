// The page a buyer opens from the student's link: three yes/no taps, no account, works once.

import { useEffect, useState } from "react";
import { Button, Screen } from "../components/ui";
import { useT } from "../lib/i18n";

const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
type Info = { student: string; skill: { en: string; ta?: string }; what: string; amount_inr: number };
const QUESTIONS = ["on_time", "quality", "rehire"] as const;

export default function ConfirmJob({ token, onClose }: { token: string; onClose: () => void }) {
  const { t, pick } = useT();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Partial<Record<(typeof QUESTIONS)[number], boolean>>>({});
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`${API}/v2/confirm/${encodeURIComponent(token)}`)
      .then(async (r) => (r.ok ? setInfo(await r.json()) : setError((await r.json()).detail ?? t("linkInvalid"))))
      .catch(() => setError(t("offline")));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const r = await fetch(`${API}/v2/confirm/${encodeURIComponent(token)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(answers),
    });
    if (r.ok) setDone(true);
    else setError((await r.json()).detail ?? t("linkInvalid"));
  };

  return (
    <Screen title={t("confirmJobTitle")} onBack={onClose}>
      {error && <p className="rounded-2xl bg-sun-soft p-4 text-warn">{error}</p>}
      {done && <p className="rounded-3xl bg-good-soft p-6 text-center text-xl font-semibold text-good">🙏 {t("thanksBuyer")}</p>}
      {info && !done && (
        <>
          <p className="text-lg">{t("confirmJobIntro", { name: info.student, skill: pick(info.skill), amount: info.amount_inr })}</p>
          {info.what && <p className="text-muted">“{info.what}”</p>}
          {QUESTIONS.map((q) => (
            <div key={q} className="rounded-3xl bg-white p-4 shadow-sm">
              <p className="font-semibold">{t(`buyer_${q}`)}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {[true, false].map((v) => (
                  <button key={String(v)} onClick={() => setAnswers({ ...answers, [q]: v })} aria-pressed={answers[q] === v}
                    className={`min-h-14 rounded-2xl border-2 text-lg font-semibold ${answers[q] === v ? "border-brand bg-brand text-white" : "border-line"}`}>
                    {v ? `👍 ${t("yes")}` : `👎 ${t("no")}`}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <Button disabled={QUESTIONS.some((q) => answers[q] === undefined)} onClick={() => void send()}>{t("send")}</Button>
        </>
      )}
    </Screen>
  );
}
