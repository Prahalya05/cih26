// A student's knowledge graph as its own screen (opened from the teacher view, or the student's results).

import { useMemo } from "react";
import type { Go } from "../App";
import { PersonGraphView } from "../components/PersonGraph";
import { Screen, useLive } from "../components/ui";
import { db, type Action } from "../lib/db";
import { useT } from "../lib/i18n";
import { analyse } from "../lib/profile";
import { profileOf } from "../lib/skills";

export default function GraphScreen({ go, id, back }: { go: Go; id: string; back?: () => void }) {
  const { t, lang } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined);
  const actions = useLive(() => db.actions.where("student_id").equals(id).toArray(), [id], [] as Action[]);
  const profile = useLive(() => profileOf(id), [id], null);
  const analysis = useMemo(() => (student && profile ? analyse(student, actions, lang, profile) : null), [student, actions, lang, profile]);
  if (!student || !analysis || !profile) return null;
  return (
    <Screen title={<span className="flex items-center gap-2"><span className="text-xl">{student.avatar}</span>{student.name} · {t("map")}</span>}
      onBack={back ?? (() => go({ name: "results", id, tab: "map" }))}>
      <PersonGraphView student={student} analysis={analysis} profile={profile} />
    </Screen>
  );
}
