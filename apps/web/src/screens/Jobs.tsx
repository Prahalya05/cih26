// Jobs board for teachers and employers: post an internship/job/apprenticeship, see who applied, move them on.
// A teacher's post is seen only by her school; an employer's by every school. Students see posts in their
// Opportunities list, sorted by the same readiness rule as every other listing.

import { useEffect, useState } from "react";
import type { Go } from "../App";
import { Button, Card, Pill, Screen } from "../components/ui";
import { Icon } from "../components/Icon";
import { useT, type StringKey } from "../lib/i18n";
import { kb } from "../lib/kb";
import { call, isError, useAccount } from "../lib/auth";
import { emit } from "../lib/xray";

const KINDS = ["internship", "apprenticeship", "job", "mentorship", "training"] as const;
const STATUSES = ["seen", "shortlisted", "not_selected", "hired"] as const;

export interface Posting { id: string; opportunity: { id: string; kind: string; title: { en: string }; org: string; district?: string; stipend_inr_month?: number; needs: { id: string; level: number }[]; description_en?: string }; by: string; mine: boolean; applications: number | null; created_at: string }
interface Received { id: string; title: string; opportunity_id: string; status: string; message?: string; created_at: string; docs: Record<string, string>;
  resume: { first_name: string; headline?: string; skills: { id: string; level?: number; verified?: boolean }[]; education: string[]; experience: string[]; languages: string[] } }

export default function Jobs({ go }: { go: Go }) {
  const { t, pick } = useT();
  const account = useAccount();
  const [tab, setTab] = useState<"apps" | "post" | "mine">("apps");
  const [posts, setPosts] = useState<Posting[]>([]);
  const [apps, setApps] = useState<Received[]>([]);
  const [error, setError] = useState("");
  const load = async () => {
    const p = await call<{ postings: Posting[] }>("/v2/postings");
    if (!isError(p)) setPosts(p.postings.filter((x) => x.mine));
    const a = await call<{ applications: Received[] }>("/v2/applications/received");
    if (isError(a)) setError(a.error); else setApps(a.applications);
  };
  useEffect(() => { void load(); }, []);
  if (!account) return null;

  const setStatus = async (a: Received, status: string) => {
    const r = await call(`/v2/applications/${a.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    if (!isError(r)) setApps(apps.map((x) => (x.id === a.id ? { ...x, status } : x)));
  };

  return (
    <Screen title={account.role === "employer" ? (account.org || t("tabJobs")) : t("jobsTitle")} onBack={account.role === "teacher" ? () => go({ name: "teacher" }) : undefined}>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-line/60 p-1 text-sm font-bold">
        {(["apps", "post", "mine"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={`min-h-10 rounded-lg ${tab === k ? "bg-surface shadow-sm" : "text-muted"}`}>
            {t(k === "apps" ? "applicationsIn" : k === "post" ? "postJob" : "myPosts")}{k === "apps" && apps.length ? ` · ${apps.length}` : ""}
          </button>
        ))}
      </div>
      {error && <p className="rounded-xl bg-sun-soft p-3 text-sm text-warn">{error}</p>}

      {tab === "apps" && (
        <>
          {apps.length === 0 && <p className="text-muted">{t("noApplicationsYet")}</p>}
          {apps.map((a) => (
            <Card key={a.id}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold">{a.resume.first_name} <span className="font-normal text-muted">→ {a.title}</span></p>
                  {a.resume.headline && <p className="text-sm text-muted">{a.resume.headline}</p>}
                </div>
                <Pill tone={a.status === "hired" ? "good" : a.status === "shortlisted" ? "sun" : "neutral"}>{t(`appStatus_${a.status}` as StringKey)}</Pill>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {a.resume.skills.map((s) => (
                  <Pill key={s.id} tone={s.verified ? "good" : "neutral"}>{s.verified && <Icon name="check" className="size-3.5" />}{pick(kb.skills[s.id]?.name ?? { en: s.id })}{s.level ? ` · L${s.level}` : ""}</Pill>
                ))}
              </div>
              {a.resume.education.length > 0 && <p className="mt-2 text-sm"><b>{t("education")}:</b> {a.resume.education.join(" · ")}</p>}
              {a.resume.experience.length > 0 && <p className="text-sm"><b>{t("experience")}:</b> {a.resume.experience.join(" · ")}</p>}
              <p className="mt-2 flex flex-wrap gap-1 text-xs">
                {Object.entries(a.docs).map(([k, v]) => <Pill key={k} tone={v === "verified" ? "good" : "sun"}>{v === "verified" ? "✓" : "…"} {t(`doc_${k}` as StringKey)}</Pill>)}
              </p>
              {a.message && <p className="mt-2 rounded-lg bg-paper p-2 text-sm">“{a.message}”</p>}
              <p className="mt-2 text-xs text-muted">{t("contactViaSchool")}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {STATUSES.filter((s) => s !== a.status).slice(0, 4).map((s) => (
                  <button key={s} onClick={() => void setStatus(a, s)} className="min-h-10 rounded-lg border border-line text-sm font-bold">{t(`appStatus_${s}` as StringKey)}</button>
                ))}
              </div>
            </Card>
          ))}
        </>
      )}

      {tab === "post" && <PostForm onPosted={() => { void load(); setTab("mine"); }} />}

      {tab === "mine" && (
        <>
          {posts.length === 0 && <p className="text-muted">{t("noPostsYet")}</p>}
          {posts.map((p) => (
            <Card key={p.id}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold">{p.opportunity.title.en}</p>
                  <p className="text-sm text-muted">{t(`kind_${p.opportunity.kind}` as StringKey)} · {p.opportunity.org}{p.opportunity.district ? ` · ${p.opportunity.district}` : ""}</p>
                </div>
                <Pill tone="brand">{t("appliedCount", { n: p.applications ?? 0 })}</Pill>
              </div>
              <button className="mt-2 text-sm font-bold text-bad" onClick={async () => { await call(`/v2/postings/${p.id}`, { method: "DELETE" }); void load(); }}>{t("closePost")}</button>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

function PostForm({ onPosted }: { onPosted: () => void }) {
  const { t, pick } = useT();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("internship");
  const [title, setTitle] = useState("");
  const [org, setOrg] = useState("");
  const [district, setDistrict] = useState("");
  const [stipend, setStipend] = useState("");
  const [months, setMonths] = useState("");
  const [minAge, setMinAge] = useState("");
  const [desc, setDesc] = useState("");
  const [needs, setNeeds] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const skills = Object.entries(kb.skills).slice(0, 60);

  const submit = async () => {
    setError("");
    const body = { kind, title, org, district: district || null, stipend_inr_month: stipend ? Number(stipend) : null,
      duration_months: months ? Number(months) : null, min_age: minAge ? Number(minAge) : null, description: desc || null,
      needs: Object.entries(needs).map(([id, level]) => ({ id, level })) };
    const r = await call<{ id: string }>("/v2/postings", { method: "POST", body: JSON.stringify(body) });
    if (isError(r)) { setError(r.error); return; }
    emit({ step: "opportunities", source: "RULE", ref: "guard.role_scope", title: `Job posted: ${title}`, subject: `posting:${r.id}`,
      output: "visible to students", why: ["posted by a signed-in teacher or employer", "students see it sorted by rule.readiness (Ready / Almost / Later)"] });
    onPosted();
  };

  const field = "min-h-12 rounded-xl border border-line bg-surface px-3 text-base";
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <button key={k} onClick={() => setKind(k)} className={`rounded-full border px-3 py-1.5 text-sm font-bold ${kind === k ? "border-brand bg-brand text-white" : "border-line"}`}>{t(`kind_${k}` as StringKey)}</button>
        ))}
      </div>
      <input className={field} placeholder={t("postTitle")} value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className={field} placeholder={t("orgName")} value={org} onChange={(e) => setOrg(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <input className={field} placeholder={t("district")} value={district} onChange={(e) => setDistrict(e.target.value)} />
        <input className={field} placeholder={t("stipendMonth")} inputMode="numeric" value={stipend} onChange={(e) => setStipend(e.target.value.replace(/\D/g, ""))} />
        <input className={field} placeholder={t("durationMonths")} inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, ""))} />
        <input className={field} placeholder={t("minAge")} inputMode="numeric" value={minAge} onChange={(e) => setMinAge(e.target.value.replace(/\D/g, ""))} />
      </div>
      <textarea className={`${field} min-h-20 py-2`} placeholder={t("postDescription")} value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div>
        <p className="mb-1 text-sm font-bold">{t("skillsNeeded")}</p>
        <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
          {skills.map(([id, s]) => (
            <button key={id} onClick={() => { const n = { ...needs }; if (n[id]) delete n[id]; else n[id] = 2; setNeeds(n); }}
              className={`rounded-full border px-2.5 py-1 text-xs font-bold ${needs[id] ? "border-accent bg-brand-soft" : "border-line"}`}>{pick(s.name)}{needs[id] ? ` · L${needs[id]}` : ""}</button>
          ))}
        </div>
        {Object.keys(needs).length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {Object.entries(needs).map(([id, lv]) => (
              <div key={id} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{pick(kb.skills[id].name)}</span>
                {[1, 2, 3, 4].map((l) => <button key={l} onClick={() => setNeeds({ ...needs, [id]: l })} className={`size-8 rounded-lg border font-bold ${lv === l ? "border-brand bg-brand text-white" : "border-line"}`}>{l}</button>)}
              </div>
            ))}
          </div>
        )}
      </div>
      {error && <p className="rounded-lg bg-bad-soft p-2 text-sm text-bad">{error}</p>}
      <Button disabled={title.trim().length < 3 || org.trim().length < 2} onClick={() => void submit()}><Icon name="send" className="size-5" />{t("publishPost")}</Button>
    </Card>
  );
}
