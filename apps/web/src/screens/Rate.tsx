// Teacher and mentor ratings, using the same four levels as everything else.
//   taster: after a half-day career taster, the mentor rates the sub-skills that career needs.
//   term:   once a term, the teacher rates 5 everyday skills.

import { useState } from "react";
import { needsOf } from "@disha/engine";
import type { Go } from "../App";
import { Button, Chip, Screen, useLive } from "../components/ui";
import { db } from "../lib/db";
import { raterId, recordEvent } from "../lib/events";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";
import { Icon } from "../components/Icon";

export const TERM_SKILLS = ["sk_communication", "sk_leadership", "sk_basic_math", "sk_computer_basic", "sk_organising"];

export default function Rate({ go, id, mode }: { go: Go; id: string; mode: "taster" | "term" }) {
  const { t, pick } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined);
  const [occ, setOcc] = useState<string | null>(null);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState(false);
  const g = kb.graph!;
  if (!student) return null;
  const back = () => go({ name: "teacher" });

  const units = mode === "term" ? TERM_SKILLS : occ ? needsOf(g, occ).map((n) => n.id) : [];
  const name = (u: string) => pick(g.subskills[u]?.name ?? kb.skills[u]?.name ?? { en: u });
  const describe = (u: string, L: number) => {
    const d = g.subskills[u]?.levels[String(L) as "1"];
    return d ? pick({ en: d.en, ta: d.ta ?? undefined }) : t(`level${L}` as "level1");
  };

  const save = async () => {
    const rater = await raterId();
    if (mode === "taster") {
      await recordEvent({ student_id: id, kind: "taster", rater_id: rater, payload: { levels, occupation: occ } });
    } else {
      for (const [u, L] of Object.entries(levels)) {
        await recordEvent({ student_id: id, kind: "rating", rater_id: rater, ...(g.subskills[u] ? { subskill_id: u } : { skill_id: u }),
          payload: { level: L, term: true } });
      }
    }
    setSaved(true);
  };

  return (
    <Screen title={`${student.avatar} ${student.name}`} onBack={back}>
      <h2 className="text-xl font-extrabold">{mode === "taster" ? t("rateTaster") : t("rateTerm")}</h2>
      <p className="text-muted">{mode === "taster" ? t("rateTasterHint") : t("rateTermHint")}</p>
      {mode === "taster" && !occ && (
        <div className="grid grid-cols-1 gap-2">
          {Object.values(kb.occupations).map((o) => (
            <Chip key={o.id} selected={false} onClick={() => setOcc(o.id)}><span>{pick(o.name)}</span></Chip>
          ))}
        </div>
      )}
      {units.map((u) => (
        <div key={u} className="rounded-2xl bg-surface p-4 border border-line">
          <p className="font-semibold">{name(u)}</p>
          <div className="mt-2 flex flex-col gap-1.5">
            {[1, 2, 3, 4].map((L) => (
              <button key={L} onClick={() => setLevels({ ...levels, [u]: L })} aria-pressed={levels[u] === L}
                className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-left text-sm ${levels[u] === L ? "border-brand bg-brand-soft ring-1 ring-brand" : "border-line"}`}>
                <span className="font-bold">{L}</span><span>{describe(u, L)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {units.length > 0 && !saved && (
        <Button disabled={Object.keys(levels).length === 0} onClick={() => void save()}><Icon name="check" className="size-5" />{t("saveRatings")}</Button>
      )}
      {saved && <p className="rounded-xl bg-good-soft p-4 text-center font-semibold text-good">{t("ratingsSaved")}</p>}
      {saved && <Button onClick={back}>{t("done")}</Button>}
    </Screen>
  );
}
