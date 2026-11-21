// A teacher's online classrooms: make one and say who it is for, see who asked to join, approve or decline,
// and open a classroom's dashboard (the same class screen a school's teacher code opens).

import { useEffect, useState } from "react";
import type { Go } from "../App";
import { Icon } from "../components/Icon";
import { Button, Card, Pill, Screen } from "../components/ui";
import { isError, saveAccount } from "../lib/auth";
import {
  DOC_KINDS, decide, editClassroom, isChecked, makeClassroom, myClassrooms, roomRequests, sendProof,
  type CheckState, type Classroom, type IncomingRequest, type RoomDraft,
} from "../lib/classrooms";
import { useT, type StringKey } from "../lib/i18n";

const LANGS = [["", "langAny"], ["ta", "தமிழ்"], ["en", "English"], ["hi", "हिन्दी"]] as const;
const EMPTY = { name: "", about: "", language: "", state: "Tamil Nadu", district: "", min_age: "", max_age: "", seats: "40" };

export default function Classrooms({ go }: { go: Go }) {
  const { t } = useT();
  const [rooms, setRooms] = useState<Classroom[] | null>(null);
  const [check, setCheck] = useState<CheckState | null>(null);
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [openRoom, setOpenRoom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    const r = await myClassrooms();
    if (isError(r)) setError(r.error);
    else { setRooms(r.classrooms); setCheck(r.verification); if (!r.classrooms.length) setForm((f) => f ?? EMPTY); }
  };
  useEffect(() => { void load(); }, []);

  const draft = (f: typeof EMPTY, open = true): RoomDraft => ({
    name: f.name.trim(), about: f.about.trim() || undefined, language: f.language || undefined, state: f.state.trim() || undefined,
    district: f.district.trim() || undefined, min_age: Number(f.min_age) || undefined, max_age: Number(f.max_age) || undefined,
    seats: Number(f.seats) || 40, open,
  });

  const create = async () => {
    if (!form) return;
    setBusy(true); setError("");
    const r = await makeClassroom(draft(form));
    setBusy(false);
    if (isError(r)) { setError(r.error); return; }
    await saveAccount(r.account); // her first classroom gives her an online school
    setForm(null);
    void load();
  };

  const toggle = async (c: Classroom) => {
    const r = await editClassroom(c.code, {
      name: c.name, about: c.about ?? undefined, language: c.language ?? undefined, state: c.state ?? undefined,
      district: c.district ?? undefined, min_age: c.min_age ?? undefined, max_age: c.max_age ?? undefined, seats: c.seats, open: !c.open,
    });
    if (isError(r)) setError(r.error); else void load();
  };

  const openDashboard = (code: string) => {
    try { localStorage.setItem("disha.code", code); } catch { /* private mode */ }
    go({ name: "teacher" });
  };

  return (
    <Screen title={t("onlineClassrooms")} onBack={() => go({ name: "teacher" })}>
      <p className="text-muted">{t("onlineClassroomsHint")}</p>
      {check && <CheckCard check={check} onSent={setCheck} />}

      {rooms?.map((c) => (
        <Card key={c.code} className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-lg leading-snug font-bold">{c.name}</p>
              <p className="text-sm text-muted">{t("membersOf", { n: c.members, seats: c.seats })}</p>
            </div>
            {isChecked(check) ? <Pill tone={c.open ? "good" : "neutral"}>{t(c.open ? "classOpen" : "classClosed")}</Pill>
              : <Pill tone="sun">{t("hiddenUntilChecked")}</Pill>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="brand">{c.code}</Pill>
            {(c.min_age || c.max_age) && <Pill>{t("agesRange", { from: c.min_age ?? 5, to: c.max_age ?? 99 })}</Pill>}
            {(c.district || c.state) && <Pill>{[c.district, c.state].filter(Boolean).join(", ")}</Pill>}
            {c.language && <Pill>{LANGS.find(([v]) => v === c.language)?.[1] ?? c.language}</Pill>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button kind={c.waiting ? "primary" : "soft"} className="!min-h-10 !px-3 text-sm" onClick={() => setOpenRoom(openRoom === c.code ? null : c.code)}>
              <Icon name="users" className="size-4" />{t("requestsN", { n: c.waiting ?? 0 })}
            </Button>
            <Button kind="soft" className="!min-h-10 !px-3 text-sm" onClick={() => openDashboard(c.code)}><Icon name="chart" className="size-4" />{t("openClass")}</Button>
            <Button kind="ghost" className="!min-h-10 !px-3 text-sm" onClick={() => void toggle(c)}>{t(c.open ? "closeToRequests" : "openToRequests")}</Button>
          </div>
          {openRoom === c.code && <Requests code={c.code} onChange={() => void load()} />}
        </Card>
      ))}

      {form ? (
        <Card className="flex flex-col gap-3">
          <p className="text-lg font-bold">{t("newClassroom")}</p>
          <Field label={t("classroomName")}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("classroomNamePlaceholder")} className={INPUT} /></Field>
          <Field label={t("classroomAbout")}><textarea value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} rows={2} className={`${INPUT} py-2`} /></Field>
          <p className="text-sm font-bold">{t("whoIsItFor")}</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("classMinAge")}><input value={form.min_age} onChange={(e) => setForm({ ...form, min_age: e.target.value.replace(/\D/g, "").slice(0, 2) })} inputMode="numeric" className={INPUT} /></Field>
            <Field label={t("classMaxAge")}><input value={form.max_age} onChange={(e) => setForm({ ...form, max_age: e.target.value.replace(/\D/g, "").slice(0, 2) })} inputMode="numeric" className={INPUT} /></Field>
            <Field label={t("yourState")}><input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className={INPUT} /></Field>
            <Field label={t("yourDistrict")}><input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} placeholder={t("anyDistrict")} className={INPUT} /></Field>
            <Field label={t("classLanguage")}>
              <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} className={INPUT}>
                {LANGS.map(([v, label]) => <option key={v} value={v}>{v ? label : t("langAny")}</option>)}
              </select>
            </Field>
            <Field label={t("seats")}><input value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value.replace(/\D/g, "").slice(0, 3) })} inputMode="numeric" className={INPUT} /></Field>
          </div>
          <p className="text-xs text-muted">{t("filtersNote")}</p>
          <div className="flex gap-2">
            <Button className="flex-1" disabled={busy || form.name.trim().length < 2} onClick={() => void create()}><Icon name="plus" className="size-5" />{t("makeClassroom")}</Button>
            {rooms && rooms.length > 0 && <Button kind="ghost" onClick={() => setForm(null)}>{t("cancel")}</Button>}
          </div>
        </Card>
      ) : <Button kind="soft" onClick={() => setForm(EMPTY)}><Icon name="plus" className="size-5" />{t("newClassroom")}</Button>}

      {error && <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm font-semibold text-bad">{error}</p>}
    </Screen>
  );
}

/** Online teachers are checked by a Disha reviewer before students can see their classrooms. */
function CheckCard({ check, onSent }: { check: CheckState; onSent: (c: CheckState) => void }) {
  const { t } = useT();
  const [kind, setKind] = useState<string>("school_id");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (isChecked(check)) {
    return <p className="flex items-center gap-2 rounded-xl bg-good-soft p-3 text-sm font-semibold text-good"><Icon name="shield" className="size-5" />
      {t(check.status === "by_school" ? "checkedBySchool" : "checkedByReviewer")}</p>;
  }
  if (check.status === "pending") {
    return <p className="flex gap-2 rounded-xl bg-sun-soft p-3 text-sm text-warn"><Icon name="hourglass" className="mt-0.5 size-5 shrink-0" />{t("checkPending")}</p>;
  }
  const send = async () => {
    if (!file) return;
    setBusy(true); setError("");
    const r = await sendProof(kind, note, file);
    setBusy(false);
    if (isError(r)) setError(r.error); else onSent(r);
  };
  return (
    <Card className="flex flex-col gap-3 border-sun">
      <p className="flex items-center gap-2 text-lg font-bold"><Icon name="shield" className="size-5 text-warn" />{t("getChecked")}</p>
      <p className="text-sm">{t("getCheckedHint")}</p>
      {check.status === "rejected" && check.reason && <p className="rounded-xl bg-bad-soft p-3 text-sm text-bad">{t("checkRejected", { reason: check.reason })}</p>}
      <Field label={t("proofKind")}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={INPUT}>
          {DOC_KINDS.map((k) => <option key={k} value={k}>{t(`proof_${k}` as StringKey)}</option>)}
        </select>
      </Field>
      <Field label={t("proofPhoto")}>
        <input type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
      </Field>
      <Field label={t("proofNote")}><input value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} placeholder={t("proofNotePlaceholder")} className={INPUT} /></Field>
      <p className="text-xs text-muted">{t("proofPrivacy")}</p>
      <Button disabled={!file || busy} onClick={() => void send()}><Icon name="send" className="size-5" />{busy ? "…" : t("sendForCheck")}</Button>
      {error && <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm font-semibold text-bad">{error}</p>}
    </Card>
  );
}

function Requests({ code, onChange }: { code: string; onChange: () => void }) {
  const { t } = useT();
  const [list, setList] = useState<IncomingRequest[] | null>(null);
  const [msg, setMsg] = useState("");
  const load = async () => { const r = await roomRequests(code); if (!isError(r)) setList(r.requests); };
  useEffect(() => { void load(); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list) return <p className="text-sm text-muted">…</p>;
  const pending = list.filter((r) => r.status === "pending");
  const members = list.filter((r) => r.status === "approved");
  const act = async (id: string, approve: boolean) => {
    const r = await decide(id, approve);
    setMsg(isError(r) ? r.error : r.reason ?? "");
    await load(); onChange();
  };
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2">
      {pending.length === 0 && <p className="text-sm text-muted">{t("noRequests")}</p>}
      {pending.map((r) => (
        <div key={r.id} className="rounded-xl bg-paper p-3">
          <p className="font-semibold">{r.name} · {t("ageN", { n: r.age })}</p>
          {(r.district || r.state) && <p className="text-sm text-muted">{[r.district, r.state].filter(Boolean).join(", ")}</p>}
          {r.note && <p className="mt-1 text-sm">“{r.note}”</p>}
          <div className="mt-2 flex gap-2">
            <Button className="!min-h-10 flex-1 !px-3 text-sm" onClick={() => void act(r.id, true)}><Icon name="check" className="size-4" />{t("approve")}</Button>
            <Button kind="ghost" className="!min-h-10 flex-1 !px-3 text-sm" onClick={() => void act(r.id, false)}>{t("decline")}</Button>
          </div>
        </div>
      ))}
      {members.length > 0 && <p className="text-sm text-muted">{t("joinedNames", { names: members.map((m) => m.name).join(", ") })}</p>}
      {msg && <p className="rounded-xl bg-sun-soft p-2 text-sm text-warn">{msg}</p>}
    </div>
  );
}

const INPUT = "min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1"><span className="text-sm font-semibold">{label}</span>{children}</label>;
}
