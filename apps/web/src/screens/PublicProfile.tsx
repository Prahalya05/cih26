// Public view of an adult student's allow-listed profile (#public=<slug>). Never exposes PII or documents.

import { useEffect, useState } from "react";
import { Card, Pill, Screen } from "../components/ui";
import { Icon } from "../components/Icon";
import { useT } from "../lib/i18n";

const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export interface PublishedSnapshot {
  handle: string;
  avatar: string;
  district?: string | null;
  age_band: "under_18" | "18_plus" | "unknown";
  verified_skills: { id: string; name: string; level: number; strong: boolean }[];
  interest_tags: string[];
  school?: string | null;
  contact_note: string;
}

export default function PublicProfile({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { t } = useT();
  const [snap, setSnap] = useState<PublishedSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/v2/public/profile/${encodeURIComponent(slug)}`)
      .then(async (r) => (r.ok ? setSnap(await r.json()) : setError((await r.json().catch(() => ({}))).detail ?? t("linkInvalid"))))
      .catch(() => setError(t("offline")));
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen title={t("publicProfileTitle")} onBack={onClose}>
      {error && <p className="rounded-xl bg-sun-soft p-4 text-warn">{error}</p>}
      {snap && (
        <>
          <Card className="flex items-center gap-4">
            <span className="flex size-16 items-center justify-center rounded-full bg-brand-soft text-4xl">{snap.avatar}</span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xl font-extrabold">{snap.handle}</p>
              <p className="text-sm text-muted">{[snap.district, snap.school, snap.age_band].filter(Boolean).join(" · ")}</p>
            </div>
          </Card>
          {snap.interest_tags.length > 0 && (
            <Card>
              <p className="eyebrow mb-1">{t("interests")}</p>
              <div className="flex flex-wrap gap-1">{snap.interest_tags.map((tag) => <Pill key={tag} tone="good">{tag}</Pill>)}</div>
            </Card>
          )}
          <Card>
            <p className="eyebrow mb-2">{t("skillsAndLevels")}</p>
            {snap.verified_skills.length === 0 && <p className="text-sm text-muted">{t("noSkillsYet")}</p>}
            <ul className="flex flex-col gap-1.5">
              {snap.verified_skills.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-sm">
                  <Icon name="check" className="size-4 text-good" />
                  <span className="flex-1">{s.name}</span>
                  <Pill tone={s.strong ? "good" : "brand"}>L{s.level}</Pill>
                </li>
              ))}
            </ul>
          </Card>
          <p className="rounded-xl bg-surface p-3 text-center text-sm text-muted border border-line">{snap.contact_note}</p>
        </>
      )}
    </Screen>
  );
}
