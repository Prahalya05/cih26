// Funder dashboard: what each milestone has paid, read straight from the Proof Pays contract (not from Disha's
// database), with new payouts appearing live. A funder sees that a qualified student was paid, never who she is.

import { useEffect, useState } from "react";
import { createPublicClient, http, parseAbiItem, type Log } from "viem";
import type { Go } from "../App";
import { Pill, Screen } from "../components/ui";
import { useT } from "../lib/i18n";
import { payConfig, type PayConfig } from "../lib/proof";

const PAID = parseAbiItem("event Paid(uint256 indexed milestoneId, uint256 indexed nullifier, address indexed payout, uint256 amount, uint256 day)");

interface Payout { tx: string; block: bigint; milestone: number; nullifier: string; payout: string; amount: number }

function toPayout(l: Log<bigint, number, false, typeof PAID>): Payout {
  return {
    tx: l.transactionHash ?? "", block: l.blockNumber ?? 0n, milestone: Number(l.args.milestoneId),
    nullifier: String(l.args.nullifier), payout: String(l.args.payout), amount: Number(l.args.amount),
  };
}

export default function Funder({ go }: { go: Go }) {
  const { t } = useT();
  const [cfg, setCfg] = useState<PayConfig | null | undefined>(undefined);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [live, setLive] = useState(false);

  useEffect(() => { void payConfig().then(setCfg); }, []);

  useEffect(() => {
    if (!cfg?.enabled || !cfg.rpc_url || !cfg.proofpays) return;
    const client = createPublicClient({ transport: http(cfg.rpc_url), pollingInterval: 3_000 });
    const add = (logs: Payout[]) => setPayouts((old) => {
      const seen = new Set(old.map((p) => p.tx + p.nullifier));
      return [...logs.filter((p) => !seen.has(p.tx + p.nullifier)), ...old].sort((a, b) => Number(b.block - a.block));
    });
    let stop = () => {};
    void (async () => {
      try {
        const past = await client.getLogs({ address: cfg.proofpays, event: PAID, fromBlock: BigInt(cfg.from_block ?? 0), toBlock: "latest" });
        add(past.map(toPayout));
        stop = client.watchEvent({ address: cfg.proofpays, event: PAID, onLogs: (logs) => {
          add(logs.map(toPayout));
          void payConfig().then(setCfg); // budgets changed
        } });
        setLive(true);
      } catch {
        setLive(false);
      }
    })();
    return () => stop();
    // re-subscribe only when the contract changes, not when budgets refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.enabled, cfg?.rpc_url, cfg?.proofpays]);

  const name = (id: number) => cfg?.milestones.find((m) => m.id === id)?.name ?? `#${id}`;
  const explorer = (tx: string) => (cfg?.explorer ? `${cfg.explorer.replace(/\/$/, "")}/tx/${tx}` : null);
  const total = payouts.reduce((s, p) => s + p.amount, 0);

  return (
    <Screen title={`📊 ${t("funderView")}`} onBack={() => go({ name: "home" })}>
      <p className="text-muted">{t("funderHint")}</p>
      {cfg === null && <p className="rounded-2xl bg-sun-soft p-3 text-warn">{t("needInternet")}</p>}
      {cfg && !cfg.enabled && <p className="rounded-2xl bg-sun-soft p-3 text-warn">{t("payNotSetUp")}</p>}

      {cfg?.enabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white p-3 shadow-sm"><p className="text-2xl font-bold">{payouts.length}</p><p className="text-sm text-muted">{t("studentsPaid")}</p></div>
            <div className="rounded-2xl bg-white p-3 shadow-sm"><p className="text-2xl font-bold">₹{total.toLocaleString("en-IN")}</p><p className="text-sm text-muted">{t("demoRupeesPaid")}</p></div>
          </div>
          <p className="text-sm">{live ? <Pill tone="good">● {t("liveFromChain")}</Pill> : <Pill>{t("connecting")}</Pill>} <span className="text-muted">chain {cfg.chain_id}</span></p>

          {cfg.milestones.map((m) => (
            <section key={m.id} className="rounded-3xl bg-white p-4 shadow-sm">
              <div className="flex items-start gap-2">
                <h3 className="flex-1 font-bold">{m.name}</h3>
                <Pill tone={m.open ? "good" : "neutral"}>{m.open ? t("open") : t("closed")}</Pill>
              </div>
              <p className="mt-1 text-sm text-muted">₹{m.amount} · {t("budgetLeft", { left: m.budget, paid: m.paid_count })}</p>
              <div className="mt-2 h-2 rounded-full bg-line">
                <div className="h-2 rounded-full bg-brand" style={{ width: `${Math.min(100, (m.paid_count * m.amount * 100) / Math.max(1, m.paid_count * m.amount + m.budget))}%` }} />
              </div>
            </section>
          ))}

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-bold">💸 {t("payouts")}</h2>
            {payouts.length === 0 && <p className="text-muted">{t("noPayoutsYet")}</p>}
            {payouts.map((p) => (
              <article key={p.tx + p.nullifier} className="rounded-2xl bg-white p-3 text-sm shadow-sm">
                <p className="font-semibold">₹{p.amount} · {name(p.milestone)}</p>
                <p className="text-muted">{t("anonymousStudent")} <code>{p.nullifier.slice(0, 10)}…</code> → <code>{p.payout.slice(0, 10)}…</code></p>
                {explorer(p.tx)
                  ? <a className="text-brand underline" href={explorer(p.tx)!} target="_blank" rel="noreferrer">{t("seeOnChain")}</a>
                  : <p className="break-all font-mono text-xs text-muted">{p.tx}</p>}
              </article>
            ))}
          </section>
        </>
      )}
    </Screen>
  );
}
