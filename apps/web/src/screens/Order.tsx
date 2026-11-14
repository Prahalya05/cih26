
// "I did a paid job": the student logs a job, then sends the buyer a one-time link (WhatsApp or share)
// with three tap questions. A confirmed, well-rated job is the strongest evidence and the only way to level 4.

import { useState } from "react";
import type { Go } from "../App";
import { Button, Chip, Pill, Screen, useLive } from "../components/ui";
import { db } from "../lib/db";
import { recordEvent } from "../lib/events";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";
import { isOnline, syncEvents } from "../lib/sync";

const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

async function makeLink(orderId: string): Promise<string | null> {
  if (!isOnline()) return null;
  await syncEvents();

  try {
    const res = await fetch(`${API}/v2/orders/${orderId}/link`, { method: "POST" });
    if (!res.ok) return null;

    const { token } = (await res.json()) as { token: string };
    return `${location.origin}/?confirm=${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}

export default function Order({ go, id }: { go: Go; id: string }) {
  const { t, pick } = useT();
  const events = useLive(() => db.events.where("student_id").equals(id).toArray(), [id], []);

  const [skill, setSkill] = useState<string | null>(null);
  const [what, setWhat] = useState("");
  const [amount, setAmount] = useState("");
  const [links, setLinks] = useState<Record<string, string | null>>({});

  const back = () => go({ name: "results", id, tab: "strengths" });

  const claimed = [...new Set(events.filter((e) => e.kind === "self_report" && e.skill_id).map((e) => e.skill_id!))];
  const choices = [...claimed, ...Object.keys(kb.skills).filter((s) => !claimed.includes(s))].slice(0, 12);

  const orders = events.filter((e) => e.kind === "order").sort((a, b) => (a.id < b.id ? 1 : -1));
  const confirmed = new Set(events.filter((e) => e.kind === "rating" && e.refers_to).map((e) => e.refers_to));

  const save = async () => {
    if (!skill) return;

    const ev = await recordEvent({
      student_id: id,
      kind: "order",
      skill_id: skill,
      payload: { amount_inr: Number(amount) || 0, what: what.trim() },
    });

    setSkill(null);
    setWhat("");
    setAmount("");

    if (ev) setLinks({ ...links, [ev.id]: await makeLink(ev.id) });
  };

  const share = async (url: string) => {
    const text = `${t("buyerMessage")} ${url}`;

    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        /* fall back to WhatsApp */
      }
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <Screen title={t("paidJob")} onBack={back}>
      <div className="rounded-[1.5rem] border border-line bg-brand/10 p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm">
            💼
          </span>
          <p className="pt-1 text-sm leading-relaxed text-muted">
            {t("paidJobHint")}
          </p>
        </div>
      </div>

      <section className="flex flex-col gap-4 rounded-[2rem] border border-line bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand/10 text-xl">
            ✨
          </span>
          <p className="text-lg font-bold">{t("whichSkill")}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {choices.map((s) => (
            <Chip key={s} selected={skill === s} onClick={() => setSkill(s)}>
              <span>{pick(kb.skills[s].name)}</span>
            </Chip>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <input
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            placeholder={t("whatDidYouMake")}
            className="min-h-14 rounded-2xl border-2 border-line bg-brand/5 px-4 text-base outline-none transition focus:border-brand"
          />

          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t("amountPaid")}
            className="min-h-14 rounded-2xl border-2 border-line bg-brand/5 px-4 text-base outline-none transition focus:border-brand"
          />
        </div>

        <Button className="w-full" disabled={!skill || !amount} onClick={() => void save()}>
          {t("saveJob")} →
        </Button>
      </section>

      {orders.length > 0 && (
        <div className="flex items-center gap-2 px-1 pt-2">
          <span className="text-xl">📋</span>
          <h3 className="text-lg font-bold">{t("paidJob")}</h3>
          <span className="ml-auto rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-muted">
            {orders.length}
          </span>
        </div>
      )}

      {orders.map((o) => {
        const url = links[o.id];

        return (
          <article key={o.id} className="flex flex-col gap-3 rounded-[1.5rem] border border-line bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-xl">
                🧾
              </span>

              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-snug">
                  {pick(kb.skills[o.skill_id!]?.name ?? { en: o.skill_id! })}
                </p>
                <p className="mt-1 text-lg font-bold text-brand">
                  ₹{String(o.payload.amount_inr)}
                </p>
              </div>

              {confirmed.has(o.id)
                ? <Pill tone="good">✔ {t("buyerConfirmed")}</Pill>
                : <Pill tone="sun">{t("waitingBuyer")}</Pill>}
            </div>

            {o.payload.what ? (
              <p className="rounded-xl bg-brand/5 px-3 py-2 text-sm text-muted">
                {String(o.payload.what)}
              </p>
            ) : null}

            {!confirmed.has(o.id) && (
              <div className="border-t border-line pt-3">
                {url ? (
                  <Button kind="soft" className="w-full" onClick={() => void share(url)}>
                    📤 {t("sendToBuyer")}
                  </Button>
                ) : (
                  <Button
                    kind="ghost"
                    className="w-full text-base"
                    onClick={async () => setLinks({ ...links, [o.id]: await makeLink(o.id) })}
                  >
                    🔗 {isOnline() ? t("makeLink") : t("linkWhenOnline")}
                  </Button>
                )}
              </div>
            )}
          </article>
        );
      })}
    </Screen>
  );
}
