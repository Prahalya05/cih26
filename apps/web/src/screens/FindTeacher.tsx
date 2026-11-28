// Find a teacher across schools by coarse district (no GPS coordinates ever leave the phone).
// "Use my location" computes the nearest district centroid from packages/kb/districts.json on-device,
// discards the coordinates, and sends only the district code to GET /v2/teachers/search.

import { useEffect, useState } from "react";
import districtsData from "@kb/districts.json";
import type { Go } from "../App";
import { Button, Card, Pill, Screen } from "../components/ui";
import { Icon } from "../components/Icon";
import { call, isError } from "../lib/auth";
import { useT } from "../lib/i18n";

interface District {
  code: string;
  state: string;
  name: { en: string; ta: string; hi: string };
  lat: number;
  lng: number;
}

interface TeacherResult {
  id: string;
  name: string;
  avatar: string;
  subjects: string[];
  languages: string[];
  district?: string | null;
  district_code?: string | null;
  qualification?: string | null;
  years?: number | null;
  bio?: string | null;
  courses: number;
  distance_km?: number | null;
}

const DISTRICTS = districtsData as District[];
const PAGE = 10;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function nearestDistrictCode(lat: number, lng: number): string {
  let best = DISTRICTS[0];
  let bestD = Infinity;
  for (const d of DISTRICTS) {
    const dist = haversineKm(lat, lng, d.lat, d.lng);
    if (dist < bestD) { bestD = dist; best = d; }
  }
  return best.code;
}

export default function FindTeacher({ go }: { go: Go }) {
  const { t, lang } = useT();
  const [district, setDistrict] = useState("");
  const [subject, setSubject] = useState("");
  const [language, setLanguage] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [teachers, setTeachers] = useState<TeacherResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locHint, setLocHint] = useState(false);

  const labelOf = (d: District) => d.name[lang] ?? d.name.en;

  useEffect(() => {
    const params = new URLSearchParams();
    if (district) params.set("district", district);
    if (subject.trim()) params.set("subject", subject.trim());
    if (language.trim()) params.set("language", language.trim());
    if (q.trim()) params.set("q", q.trim());
    params.set("limit", String(PAGE));
    params.set("offset", String(offset));
    setBusy(true);
    setError("");
    void call<{ total: number; teachers: TeacherResult[] }>(`/v2/teachers/search?${params.toString()}`)
      .then((r) => {
        setBusy(false);
        if (isError(r)) setError(r.error);
        else { setTotal(r.total); setTeachers(r.teachers); }
      });
  }, [district, subject, language, q, offset]);

  const useMyLocation = () => {
    if (!navigator.geolocation) { setError(t("offline")); return; }
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Compute nearest district centroid on the phone, then discard coordinates immediately.
        const code = nearestDistrictCode(pos.coords.latitude, pos.coords.longitude);
        setDistrict(code);
        setOffset(0);
        setLocHint(true);
      },
      () => setError(t("offline")),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  };

  return (
    <Screen title={t("findTeacher")} onBack={() => go({ name: "courses" })}>
      <Card className="flex flex-col gap-3">
        <div className="flex gap-2">
          <select value={district} onChange={(e) => { setDistrict(e.target.value); setOffset(0); setLocHint(false); }}
            className="min-h-12 flex-1 rounded-xl border border-line bg-surface px-3 text-base">
            <option value="">{t("allDistricts")}</option>
            {DISTRICTS.map((d) => <option key={d.code} value={d.code}>{labelOf(d)}</option>)}
          </select>
          <Button kind="soft" onClick={useMyLocation}>
            <Icon name="compass" className="size-5" />{t("useMyLocation")}
          </Button>
        </div>
        {locHint && <p className="text-xs text-good"><Icon name="shield" className="mr-1 inline size-3.5" />{t("gpsDiscardedHint")}</p>}
        <div className="grid grid-cols-2 gap-2">
          <input value={subject} onChange={(e) => { setSubject(e.target.value); setOffset(0); }} placeholder={t("filterSubject")}
            className="min-h-11 rounded-xl border border-line bg-surface px-3 text-sm" />
          <input value={language} onChange={(e) => { setLanguage(e.target.value); setOffset(0); }} placeholder={t("filterLanguage")}
            className="min-h-11 rounded-xl border border-line bg-surface px-3 text-sm" />
        </div>
        <input value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder={t("searchTeachersHint")}
          className="min-h-11 rounded-xl border border-line bg-surface px-3 text-sm" />
      </Card>

      {error && <p className="rounded-xl bg-sun-soft p-3 text-sm text-warn">{error}</p>}
      {!busy && teachers.length === 0 && !error && <p className="text-muted">{t("noTeachersFound")}</p>}

      {teachers.map((tc) => (
        <Card key={tc.id}>
          <button className="flex w-full items-start gap-3 text-left" onClick={() => go({ name: "teacherProfile", teacherId: tc.id })}>
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-soft text-3xl">{tc.avatar}</span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-extrabold leading-snug">{tc.name}</p>
              <p className="text-sm text-muted">
                {[tc.district, tc.distance_km != null ? t("kmAway", { n: tc.distance_km }) : null, tc.qualification].filter(Boolean).join(" · ")}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {tc.courses > 0 && <Pill tone="good">{t("coursesN", { n: tc.courses })}</Pill>}
                {tc.subjects.slice(0, 3).map((s) => <Pill key={s} tone="brand">{s}</Pill>)}
                {tc.languages.slice(0, 2).map((l) => <Pill key={l}>{l}</Pill>)}
              </div>
            </div>
            <Icon name="chevron" className="size-5 shrink-0 text-faint" />
          </button>
        </Card>
      ))}

      {total > PAGE && (
        <div className="flex items-center justify-between gap-2">
          <Button kind="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t("back")}</Button>
          <span className="text-xs text-muted">{offset + 1}–{Math.min(total, offset + PAGE)} / {total}</span>
          <Button kind="ghost" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>{t("next")}</Button>
        </div>
      )}
    </Screen>
  );
}
