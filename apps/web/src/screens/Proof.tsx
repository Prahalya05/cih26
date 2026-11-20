// Proof Pays: get a signed skill credential, prove a funder's milestone with zero knowledge, and get paid.
// What is proved and what stays hidden is spelled out on screen, and the cheat demo shows the contract refusing
// a replayed proof and a changed payout address.

import { useEffect, useState } from "react";
import { INCOME_BANDS } from "@disha/zk";
import type { Address } from "viem";
import type { Go } from "../App";
import { Button, Pill, Screen, useLive } from "../components/ui";
import { db, hasScope } from "../lib/db";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";
import { Icon } from "../components/Icon";
import {
  balanceOf, claim, dayNumber, meetsMilestone, payConfig, prove, readPublic, requestCredential, savedCredential,
  unpackLevels, walletFor, type ClaimResult, type Credential, type FundedMilestone, type PayConfig, type SkillProof,
} from "../lib/proof";

type Proved = SkillProof & { verified: boolean; verifyMs: number; milestone: FundedMilestone };

export default function Proof({ go, id }: { go: Go; id: string }) {
  const { t, pick } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined);
  const [cfg, setCfg] = useState<PayConfig | null | undefined>(undefined);
  const [cred, setCred] = useState<Credential | null>(null);
  const [wallet, setWallet] = useState<Address | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proved, setProved] = useState<Proved | null>(null);
  const [paid, setPaid] = useState<ClaimResult | null>(null);
  const [cheats, setCheats] = useState<{ label: string; out: ClaimResult }[]>([]);

  useEffect(() => {
    void payConfig().then(setCfg);
    void savedCredential(id).then(setCred);
    void walletFor(id).then(setWallet);
  }, [id]);
  useEffect(() => {
    if (cfg && wallet) void balanceOf(cfg, wallet).then(setBalance);
  }, [cfg, wallet, paid]);

  if (!student) return null;
  const back = () => go({ name: "results", id, tab: "strengths" });
  const subName = (index: number) => {
    const sid = cfg?.subskill_order[index];
    const sub = (sid ? kb.graph?.subskills[sid] : undefined);
    return sub ? pick(sub.name) : sid ?? "?";
  };
  const today = dayNumber(Date.now());

  const getCredential = async () => {
    setBusy("cred"); setError(null);
    const out = await requestCredential(student, cfg?.issuer ?? null);
    setBusy(null);
    if ("error" in out) setError(t(`credError_${out.error}`));
    else { setCred(out.credential); setProved(null); setPaid(null); setCheats([]); }
  };

  // Proving and claiming are two steps so the demo can show a thief trying the proof first (refused: the
  // payout address is inside the proof), then the real claim, then a replay (refused: nullifier used).
  const makeProof = async (m: FundedMilestone) => {
    if (!cred || !wallet) return;
    setError(null); setPaid(null); setCheats([]); setProved(null);
    try {
      setBusy(`prove${m.id}`);
      const p = await prove(id, cred, m, wallet);
      setProved({ ...p, milestone: m });
      if (!p.verified) setError(t("proofNotValid"));
    } catch {
      setError(t("proofFailed"));
    } finally {
      setBusy(null);
    }
  };

  const claimMine = async () => {
    if (!proved || !wallet) return;
    setError(null);
    setBusy("claim");
    const out = await claim(proved.milestone.id, proved, wallet);
    setPaid(out);
    if (!out.ok) setError(out.message ?? t("claimFailed"));
    setBusy(null);
  };

  const cheat = async (kind: "replay" | "redirect") => {
    if (!proved) return;
    setBusy(kind);
    const thief = "0x000000000000000000000000000000000000dEaD" as Address;
    const out = await claim(proved.milestone.id, proved, kind === "replay" ? wallet! : thief);
    setCheats((c) => [...c, { label: t(kind === "replay" ? "cheatReplay" : "cheatRedirect"), out }]);
    setBusy(null);
  };

  const levels = cred ? unpackLevels(BigInt(cred.fields.levels), cred.subskill_order) : {};
  const strong = Object.entries(levels).filter(([, l]) => l >= 2).sort((a, b) => b[1] - a[1]);
  const shareOk = hasScope(student, "share_portfolio");

  return (
    <Screen title={t("proofPays")} onBack={back}>
      <p className="text-muted">{t("proofPaysHint")}</p>

      {cfg === null && <p className="rounded-xl bg-sun-soft p-3 text-warn">{t("needInternet")}</p>}
      {cfg && !cfg.enabled && <p className="rounded-xl bg-sun-soft p-3 text-warn">{t("payNotSetUp")}</p>}
      {!shareOk && <p className="rounded-xl bg-sun-soft p-3 text-warn">{t("shareConsentNeeded")}</p>}

      <section className="rounded-2xl bg-surface p-4 border border-line">
        <h2 className="flex items-center gap-2 text-lg font-extrabold"><Icon name="idcard" className="size-5 text-accent-dark" />{t("myCredential")}</h2>
        {cred ? (
          <>
            <p className="mt-1 text-sm text-good">✔ {t("signedByDisha")} · {t("validUntil", { date: new Date(Number(cred.fields.expires_day) * 86_400_000).toLocaleDateString() })}</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {strong.slice(0, 8).map(([sid, l]) => {
                const sub = (sid ? kb.graph?.subskills[sid] : undefined);
                return <li key={sid}><Pill tone={l >= 3 ? "good" : "sun"}>{sub ? pick(sub.name) : sid} · {l}</Pill></li>;
              })}
              <li><Pill tone="brand"><Icon name="briefcase" className="size-3.5" />{t("confirmedOrders", { n: cred.fields.orders })}</Pill></li>
            </ul>
          </>
        ) : <p className="mt-1 text-muted">{t("noCredentialYet")}</p>}
        <Button kind="soft" className="mt-3 w-full" disabled={!shareOk || busy !== null || !cfg} onClick={() => void getCredential()}>
          {busy === "cred" ? t("thinking") : cred ? `${t("refreshCredential")}` : `${t("getCredential")}`}
        </Button>
      </section>

      {cfg?.enabled && cfg.milestones.map((m) => {
        const check = cred ? meetsMilestone(cred, m, today) : null;
        return (
          <section key={m.id} className="rounded-2xl bg-surface p-4 border border-line">
            <div className="flex items-start gap-2">
              <h3 className="flex-1 font-bold">{m.name}</h3>
              <Pill tone="good">₹{m.amount}</Pill>
            </div>
            <ul className="mt-2 text-sm text-muted">
              <li>• {subName(m.subskill_index)} ≥ {t("levelN", { n: m.min_level })}</li>
              {m.min_orders > 0 && <li>• {t("confirmedOrders", { n: `≥ ${m.min_orders}` })}</li>}
              {m.max_income_band < 15 && <li>• {t("incomeAtMost", { band: INCOME_BANDS[m.max_income_band]?.en ?? "" })}</li>}
              {m.required_gender === 1 && <li>• {t("forGirls")}</li>}
              <li>• {t("budgetLeft", { left: m.budget, paid: m.paid_count })}</li>
            </ul>
            {check && !check.ok && <p className="mt-2 text-sm text-warn">{t("notYet")}: {check.reasons.join(", ")}</p>}
            <Button className="mt-3 w-full" disabled={!check?.ok || !m.open || busy !== null}
              onClick={() => void makeProof(m)}>
              {busy === `prove${m.id}` ? `${t("makingProof")}` : `${t("makeProof")}`}
            </Button>
          </section>
        );
      })}

      {proved && (
        <section className="rounded-2xl bg-surface p-4 border border-line">
          <h2 className="flex items-center gap-2 text-lg font-extrabold"><Icon name="shield" className="size-5 text-accent-dark" />{t("proofMade", { ms: proved.ms })}</h2>
          <p className="text-sm text-muted">{proved.verified ? `${t("proofCheckedHere", { ms: proved.verifyMs })}` : `${t("proofNotValid")}`}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-good-soft p-3">
              <p className="font-semibold text-good">{t("whatIsProved")}</p>
              <ul className="mt-1 text-sm">
                <li className="flex gap-2"><Icon name="check" className="mt-0.5 size-4 shrink-0 text-good" />{subName(proved.milestone.subskill_index)} ≥ {t("levelN", { n: proved.milestone.min_level })}</li>
                {proved.milestone.min_orders > 0 && <li className="flex gap-2"><Icon name="check" className="mt-0.5 size-4 shrink-0 text-good" />{t("confirmedOrders", { n: `≥ ${proved.milestone.min_orders}` })}</li>}
                {proved.milestone.max_income_band < 15 && <li className="flex gap-2"><Icon name="check" className="mt-0.5 size-4 shrink-0 text-good" />{t("incomeAtMost", { band: INCOME_BANDS[proved.milestone.max_income_band]?.en ?? "" })}</li>}
                <li className="flex gap-2"><Icon name="check" className="mt-0.5 size-4 shrink-0 text-good" />{t("signedNotExpired")}</li>
                <li className="flex gap-2"><Icon name="check" className="mt-0.5 size-4 shrink-0 text-good" />{t("payTo")} <code className="break-all text-xs">{"0x" + BigInt(readPublic(proved.publicSignals).payout).toString(16).padStart(40, "0")}</code></li>
              </ul>
            </div>
            <div className="rounded-xl bg-brand-soft p-3">
              <p className="font-semibold text-brand">{t("whatStaysHidden")}</p>
              <ul className="mt-1 text-sm">
                <li className="flex gap-2"><Icon name="eyeOff" className="mt-0.5 size-4 shrink-0 text-muted" />{t("hiddenName")}</li>
                <li className="flex gap-2"><Icon name="eyeOff" className="mt-0.5 size-4 shrink-0 text-muted" />{t("hiddenExact")}</li>
                <li className="flex gap-2"><Icon name="eyeOff" className="mt-0.5 size-4 shrink-0 text-muted" />{t("hiddenOther")}</li>
                <li className="flex gap-2"><Icon name="eyeOff" className="mt-0.5 size-4 shrink-0 text-muted" />{t("hiddenEvidence")}</li>
              </ul>
            </div>
          </div>
          {proved.verified && !paid?.ok && (
            <div className="mt-3 flex flex-col gap-2">
              <Button disabled={busy !== null} onClick={() => void claimMine()}>
                {busy === "claim" ? `${t("sendingProof")}` : `${t("claimToMyAccount")}`}
              </Button>
              <Button kind="ghost" disabled={busy !== null} onClick={() => void cheat("redirect")}><Icon name="alert" className="size-5" />{t("cheatRedirect")}</Button>
            </div>
          )}
          {!paid?.ok && cheats.map((c, i) => <CheatLine key={i} c={c} />)}
        </section>
      )}

      {paid?.ok && (
        <section className="rounded-2xl bg-good-soft p-4">
          <p className="flex items-center gap-2 text-lg font-extrabold text-good"><Icon name="wallet" className="size-5" />{t("paidOut", { amount: proved?.milestone.amount ?? 0 })}</p>
          {balance !== null && <p className="text-good">{t("walletBalance", { n: balance })}</p>}
          {paid.explorer_url && <a href={paid.explorer_url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-brand underline">{t("seeOnChain")}</a>}
          {!paid.explorer_url && paid.tx_hash && <p className="mt-1 break-all font-mono text-xs">{paid.tx_hash}</p>}
          <p className="mt-3 font-semibold">{t("tryToCheat")}</p>
          <Button kind="ghost" className="mt-2 w-full" disabled={busy !== null} onClick={() => void cheat("replay")}><Icon name="refresh" className="size-5" />{t("cheatReplay")}</Button>
          {cheats.map((c, i) => <CheatLine key={i} c={c} />)}
        </section>
      )}

      {error && <p className="rounded-xl bg-sun-soft p-3 text-warn">{error}</p>}
      <Button kind="ghost" onClick={() => go({ name: "funder" })}><Icon name="chart" className="size-5" />{t("funderView")}</Button>
    </Screen>
  );
}

function CheatLine({ c }: { c: { label: string; out: ClaimResult } }) {
  const { t } = useT();
  return (
    <p className={`mt-2 rounded-xl p-2 text-sm ${c.out.ok ? "bg-red-100 text-red-700" : "bg-surface"}`}>
      <Icon name={c.out.ok ? "alert" : "shield"} className="mr-1 inline size-4 align-[-3px]" />{c.label}: {c.out.ok ? t("cheatWorked") : `${t("refused")} (${c.out.reason ?? ""}) ${c.out.message ?? ""}`}
    </p>
  );
}
