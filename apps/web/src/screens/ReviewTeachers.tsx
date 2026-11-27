// Reviewer page (open with ?review): Disha reviewers check online teachers' teaching proofs and approve or reject.
// It needs the server's admin token, kept only for this browser tab. Photos are deleted on the server once decided.

import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { Button, Card, Pill, Screen } from "../components/ui";
import { API } from "../lib/api";
import { useT, type StringKey } from "../lib/i18n";

interface Waiting { account_id: string; name: string; login: string; doc_kind: string; note: string | null; submitted_at: string; classrooms: number }

const KEY = "disha.reviewToken";
const readToken = () => { try { return sessionStorage.getItem(KEY) ?? ""; } catch { return ""; } };

export default function ReviewTeachers({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [token, setToken] = useState(readToken);
  const [draft, setDraft] = useState("");
  const [list, setList] = useState<Waiting[] | null>(null);
  const [error, setError] = useState("");

  const headers = { "X-Admin-Token": token };
  const load = async () => {
    setError("");
    try {
      const res = await fetch(`${API}/v2/review/teachers`, { headers });
      if (res.status === 401) { setError(t("reviewTokenWrong")); setToken(""); return; }
      if (!res.ok) { setError(`Error ${res.status}`); return; }
      setList(((await res.json()) as { teachers: Waiting[] }).teachers);
    } catch { setError(t("needInternet")); }
  };
  useEffect(() => { if (token) void load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!token) {
    return (
      <Screen title={t("reviewTitle")} onBack={onClose}>
        <p className="text-muted">{t("reviewIntro")}</p>
        <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("reviewToken")}
          className="min-h-14 rounded-xl border border-line bg-surface px-4 text-lg" />
        <Button disabled={!draft.trim()} onClick={() => { try { sessionStorage.setItem(KEY, draft.trim()); } catch { /* ignore */ } setToken(draft.trim()); }}>
          {t("next")} <Icon name="next" className="size-5" />
        </Button>
        {error && <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm font-semibold text-bad">{error}</p>}
      </Screen>
    );
  }

  return (
    <Screen title={t("reviewTitle")} onBack={onClose}
      right={<button onClick={() => void load()} className="rounded-full bg-brand-soft p-2 text-brand" aria-label="refresh"><Icon name="refresh" className="size-5" /></button>}>
      <p className="text-muted">{t("reviewHint")}</p>
      {list && list.length === 0 && <p className="text-center text-muted">{t("reviewNone")}</p>}
      {list?.map((w) => <Item key={w.account_id} w={w} token={token} onDone={() => void load()} />)}
      {error && <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm font-semibold text-bad">{error}</p>}
    </Screen>
  );
}

function Item({ w, token, onDone }: { w: Waiting; token: string; onDone: () => void }) {
  const { t } = useT();
  const [img, setImg] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let url: string | null = null;
    void fetch(`${API}/v2/review/teachers/${encodeURIComponent(w.account_id)}/photo`, { headers: { "X-Admin-Token": token } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (b) { url = URL.createObjectURL(b); setImg(url); } })
      .catch(() => undefined);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [w.account_id, token]);

  const decideIt = async (approve: boolean) => {
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API}/v2/review/teachers/${encodeURIComponent(w.account_id)}`, {
        method: "POST", headers: { "X-Admin-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ approve, reason: approve ? undefined : reason.trim() }),
      });
      if (!res.ok) { setError((await res.json().catch(() => ({}))).detail ?? `Error ${res.status}`); return; }
      onDone();
    } catch { setError(t("needInternet")); } finally { setBusy(false); }
  };

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold">{w.name}</p>
          <p className="text-sm text-muted">{w.login} · {new Date(w.submitted_at).toLocaleString()}</p>
        </div>
        <Pill tone="brand">{t(`proof_${w.doc_kind}` as StringKey)}</Pill>
      </div>
      {w.note && <p className="text-sm">“{w.note}”</p>}
      <p className="text-xs text-muted">{t("reviewClassrooms", { n: w.classrooms })}</p>
      {img ? <img src={img} alt={t(`proof_${w.doc_kind}` as StringKey)} className="max-h-96 w-full rounded-xl border border-line object-contain" />
        : <p className="text-sm text-muted">…</p>}
      <p className="text-xs text-muted">{t("reviewCheckList")}</p>
      {rejecting ? (
        <div className="flex flex-col gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 300))} placeholder={t("rejectReason")}
            className="min-h-12 rounded-xl border border-line px-3 text-base" />
          <div className="flex gap-2">
            <Button className="flex-1" disabled={busy || !reason.trim()} onClick={() => void decideIt(false)}>{t("reject")}</Button>
            <Button kind="ghost" onClick={() => setRejecting(false)}>{t("cancel")}</Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button className="flex-1" disabled={busy} onClick={() => void decideIt(true)}><Icon name="check" className="size-5" />{t("approve")}</Button>
          <Button kind="ghost" className="flex-1" disabled={busy} onClick={() => setRejecting(true)}>{t("reject")}</Button>
        </div>
      )}
      {error && <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm font-semibold text-bad">{error}</p>}
    </Card>
  );
}
