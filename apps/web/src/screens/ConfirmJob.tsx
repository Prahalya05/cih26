
import { useEffect, useState } from "react";
import { Button, Screen } from "../components/ui";
import { useT } from "../lib/i18n";

const API =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

type Info = {
  student: string;
  skill: { en: string; ta?: string };
  what: string;
  amount_inr: number;
};

const QUESTIONS = ["on_time", "quality", "rehire"] as const;

export default function ConfirmJob({
  token,
  onClose,
}: {
  token: string;
  onClose: () => void;
}) {
  const { t, pick } = useT();

  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<
    Partial<Record<(typeof QUESTIONS)[number], boolean>>
  >({});
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`${API}/v2/confirm/${encodeURIComponent(token)}`)
      .then(async (r) =>
        r.ok
          ? setInfo(await r.json())
          : setError((await r.json()).detail ?? t("linkInvalid")),
      )
      .catch(() => setError(t("offline")));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const r = await fetch(`${API}/v2/confirm/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(answers),
    });

    if (r.ok) {
      setDone(true);
    } else {
      setError((await r.json()).detail ?? t("linkInvalid"));
    }
  };

  return (
    <Screen title={t("confirmJobTitle")} onBack={onClose}>
      <div className="flex flex-col gap-5 pb-4">

        {/* Error message */}
        {error && (
          <div className="rounded-2xl border border-line bg-sun-soft p-4">
            <p className="text-sm font-medium leading-6 text-warn">
              ⚠️ {error}
            </p>
          </div>
        )}

        {/* Successful confirmation */}
        {done && (
          <section className="rounded-3xl border border-good/20 bg-good-soft p-6 text-center">
            <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-white text-4xl">
              🙏
            </div>
            <p className="text-xl font-bold text-good">
              {t("thanksBuyer")}
            </p>
          </section>
        )}

        {/* Job information and questions */}
        {info && !done && (
          <>
            <section className="rounded-3xl border border-line bg-white p-5 shadow-sm">
              <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-2xl">
                💼
              </div>

              <p className="text-base leading-7">
                {t("confirmJobIntro", {
                  name: info.student,
                  skill: pick(info.skill),
                  amount: info.amount_inr,
                })}
              </p>

              {info.what && (
                <div className="mt-4 rounded-2xl bg-paper p-4">
                  <p className="text-xs font-semibold text-muted">
                    Job details
                  </p>
                  <p className="mt-1 text-sm leading-6">
                    “{info.what}”
                  </p>
                </div>
              )}
            </section>

            {/* Buyer questions */}
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-lg font-bold">⭐ Your feedback</h2>
                <p className="mt-1 text-sm text-muted">
                  Please answer these three questions about the work.
                </p>
              </div>

              {QUESTIONS.map((q, index) => (
                <div
                  key={q}
                  className="rounded-3xl border border-line bg-white p-5 shadow-sm"
                >
                  <div className="mb-4 flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-sm font-bold text-brand-dark">
                      {index + 1}
                    </span>

                    <p className="pt-1 font-semibold leading-6">
                      {t(`buyer_${q}`)}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {[true, false].map((v) => {
                      const selected = answers[q] === v;

                      return (
                        <button
                          key={String(v)}
                          type="button"
                          onClick={() =>
                            setAnswers({ ...answers, [q]: v })
                          }
                          aria-pressed={selected}
                          className={`min-h-14 rounded-2xl border-2 text-base font-semibold transition-colors ${
                            selected
                              ? "border-brand bg-brand text-white"
                              : "border-line bg-paper text-ink hover:border-brand"
                          }`}
                        >
                          {v ? `👍 ${t("yes")}` : `👎 ${t("no")}`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>

            {/* Submit */}
            <div className="rounded-3xl border border-line bg-white p-4 shadow-sm">
              <p className="mb-3 text-center text-sm text-muted">
                {Object.keys(answers).length} / {QUESTIONS.length} questions answered
              </p>

              <div className="mb-4 h-2 overflow-hidden rounded-full bg-brand-soft">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{
                    width: `${(Object.keys(answers).length / QUESTIONS.length) * 100}%`,
                  }}
                />
              </div>

              <Button
                disabled={QUESTIONS.some((q) => answers[q] === undefined)}
                onClick={() => void send()}
              >
                {t("send")} →
              </Button>
            </div>
          </>
        )}
      </div>
    </Screen>
  );
}
