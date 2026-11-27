// A student without a school code finds an online classroom that fits her (age, place, language) and asks to join.
// The teacher approves; until then nothing about her leaves the request she chose to send.

import { useEffect, useState } from "react";
import type { Go } from "../App";
import { Icon } from "../components/Icon";
import { Button, Card, Pill, Screen, useLive } from "../components/ui";
import { isError, useAccount } from "../lib/auth";
import {
  askToJoin, cancelRequest, leaveClassroom, myRequests, searchClassrooms, type Classroom, type JoinRequest,
} from "../lib/classrooms";
import { db } from "../lib/db";
import { useT, type StringKey } from "../lib/i18n";

const LANGS = [["", "langAny"], ["ta", "தமிழ்"], ["en", "English"], ["hi", "हिन्दी"]] as const;

export default function FindClass({ go }: { go: Go }) {
  const { t } = useT();
  const account = useAccount();
  const me = useLive(() => (account?.student_id ? db.students.get(account.student_id) : Promise.resolve(undefined)), [account?.student_id], undefined);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [rooms, setRooms] = useState<Classroom[] | null>(null);
  const [age, setAge] = useState("");
  const [state, setState] = useState("Tamil Nadu");
  const [district, setDistrict] = useState("");
  const [language, setLanguage] = useState("");
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Fill her age from her profile once it loads.
  useEffect(() => {
    if (!me) return;
    const a = typeof me.factAnswers?.age === "number" ? me.factAnswers.age : me.birth_year ? new Date().getFullYear() - me.birth_year : undefined;
    if (a && !age) setAge(String(a));
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRequests = async () => {
    const r = await myRequests();
    if (!("error" in r)) setRequests(r.requests);
  };
  const waiting = requests.some((r) => r.status === "pending");
  useEffect(() => { void loadRequests(); }, []);
  // While a request waits, check every 20 s so an approval shows up without reloading.
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void loadRequests(), 20_000);
    return () => window.clearInterval(timer);
  }, [waiting]);

  const search = async () => {
    setBusy(true); setError("");
    const r = await searchClassrooms({ age: Number(age) || undefined, state, district, language, q });
    setBusy(false);
    if (isError(r)) setError(r.error); else setRooms(r.classrooms);
  };

  const send = async (code: string) => {
    if (!Number(age)) { setError(t("classAgeNeeded")); return; }
    setBusy(true); setError("");
    const r = await askToJoin(code, { age: Number(age), state, district, note });
    setBusy(false);
    if (isError(r)) { setError(r.error); return; }
    setAsking(null); setNote("");
    await loadRequests();
  };

  if (!account || account.role !== "student") return null;
  const minor = Number(age) > 0 && Number(age) < 18;
  const asked = new Set(requests.filter((r) => r.status === "pending").map((r) => r.code));

  // ---- already in a class ----
  if (account.school_id) {
    const current = requests.find((r) => r.status === "approved" && r.code === account.class_code);
    return (
      <Screen title={t("myClass")} onBack={() => go({ name: "account" })}>
        <Card className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-lg font-extrabold"><Icon name="check" className="size-5 text-good" />{t("inClass")}</p>
          <p>{current ? `${current.name} · ${current.teacher}` : account.class_code}</p>
          <Pill tone="brand">{account.class_code}</Pill>
        </Card>
        {current && !confirmLeave && <Button kind="ghost" onClick={() => setConfirmLeave(true)}>{t("leaveClass")}</Button>}
        {current && confirmLeave && (
          <Card className="flex flex-col gap-2">
            <p className="text-sm">{t("leaveClassWarn")}</p>
            <div className="flex gap-2">
              <Button className="flex-1" disabled={busy} onClick={async () => {
                setBusy(true);
                const r = await leaveClassroom();
                setBusy(false); setConfirmLeave(false);
                if ("error" in r) setError(r.error); else void loadRequests();
              }}>{t("leaveClass")}</Button>
              <Button kind="ghost" className="flex-1" onClick={() => setConfirmLeave(false)}>{t("cancel")}</Button>
            </div>
          </Card>
        )}
        {!current && <p className="text-sm text-muted">{t("schoolClassNote")}</p>}
        {error && <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm font-semibold text-bad">{error}</p>}
      </Screen>
    );
  }

  // ---- find a class ----
  return (
    <Screen title={t("findClass")} onBack={() => go({ name: "home" })}>
      <p className="text-muted">{t("findClassHint")}</p>

      {requests.filter((r) => r.status !== "cancelled").length > 0 && (
        <Card className="flex flex-col gap-2">
          <p className="font-bold">{t("myRequests")}</p>
          {requests.filter((r) => r.status !== "cancelled").slice(0, 6).map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{r.name}</p>
                <p className="text-xs text-muted">{r.teacher}</p>
              </div>
              <Pill tone={r.status === "approved" ? "good" : r.status === "pending" ? "sun" : "neutral"}>{t(`req_${r.status}` as StringKey)}</Pill>
              {r.status === "pending" && (
                <button onClick={async () => { await cancelRequest(r.id); void loadRequests(); }} className="text-xs font-bold text-muted underline">{t("takeBack")}</button>
              )}
            </div>
          ))}
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("yourAge")}><input value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" className={INPUT} /></Field>
          <Field label={t("classLanguage")}>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className={INPUT}>
              {LANGS.map(([v, label]) => <option key={v} value={v}>{v ? label : t(label as StringKey)}</option>)}
            </select>
          </Field>
          <Field label={t("yourState")}><input value={state} onChange={(e) => setState(e.target.value)} className={INPUT} /></Field>
          <Field label={t("yourDistrict")}><input value={district} onChange={(e) => setDistrict(e.target.value)} className={INPUT} /></Field>
        </div>
        <Field label={t("classSearchWords")}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("classSearchPlaceholder")} className={INPUT} /></Field>
        <Button disabled={busy} onClick={() => void search()}><Icon name="scan" className="size-5" />{t("findClassButton")}</Button>
      </Card>

      {minor && <p className="flex gap-2 rounded-xl bg-sun-soft p-3 text-sm text-warn"><Icon name="info" className="mt-0.5 size-4 shrink-0" />{t("tellGuardian")}</p>}
      {error && <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm font-semibold text-bad">{error}</p>}

      {rooms && rooms.length === 0 && <p className="text-center text-muted">{t("noClassFound")}</p>}
      {rooms?.map((c) => (
        <Card key={c.code} className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-lg leading-snug font-bold">{c.name}</p>
              <p className="text-sm text-muted">{c.teacher}{c.online ? ` · ${t("onlineTeacher")}` : c.school ? ` · ${c.school}` : ""}</p>
            </div>
            {c.near === 2 && <Pill tone="good">{t("nearYou")}</Pill>}
          </div>
          {c.about && <p className="text-sm">{c.about}</p>}
          <div className="flex flex-wrap gap-1.5">
            {(c.min_age || c.max_age) && <Pill>{t("agesRange", { from: c.min_age ?? 5, to: c.max_age ?? 99 })}</Pill>}
            {(c.district || c.state) && <Pill>{[c.district, c.state].filter(Boolean).join(", ")}</Pill>}
            {c.language && <Pill>{LANGS.find(([v]) => v === c.language)?.[1] ?? c.language}</Pill>}
            <Pill tone="brand">{t("seatsLeft", { n: c.seats_left })}</Pill>
          </div>
          {asked.has(c.code) ? <Pill tone="sun">{t("req_pending")}</Pill>
            : asking === c.code ? (
              <div className="flex flex-col gap-2">
                <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} rows={2} placeholder={t("joinNotePlaceholder")}
                  className="rounded-xl border border-line px-3 py-2 text-base" />
                <p className="text-xs text-muted">{t("joinShares")}</p>
                <div className="flex gap-2">
                  <Button className="flex-1" disabled={busy} onClick={() => void send(c.code)}><Icon name="send" className="size-5" />{t("sendRequest")}</Button>
                  <Button kind="ghost" onClick={() => setAsking(null)}>{t("cancel")}</Button>
                </div>
              </div>
            ) : <Button kind="soft" onClick={() => { setAsking(c.code); setError(""); }}>{t("askToJoin")}</Button>}
        </Card>
      ))}
    </Screen>
  );
}

const INPUT = "min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1"><span className="text-sm font-semibold">{label}</span>{children}</label>;
}
