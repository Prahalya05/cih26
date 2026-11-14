// Privacy settings for one student (Steps 11.1 and 11.2): change optional scopes, withdraw consent, delete everything.

import { useState } from "react";
import type { Go } from "../App";
import { Button, Screen, useLive } from "../components/ui";
import { db, hasScope, patchStudent, scopesOf, type Scope } from "../lib/db";
import { useT } from "../lib/i18n";
import { eraseStudent, syncNow } from "../lib/sync";
import { OPTIONAL_SCOPES } from "./Consent";

export default function Privacy({ go, id }: { go: Go; id: string }) {
  const { t } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined);
  const [sure, setSure] = useState(false);
  if (!student) return null;
  const active = hasScope(student, "assess");

  const setScope = async (scope: Scope, on: boolean) => {
    await patchStudent(id, (s) => {
      const cur = scopesOf(s).filter((x) => x !== scope);
      return { ...s, consent: { ...s.consent!, scopes: on ? [...cur, scope] : cur, photos: undefined } };
    });
    void syncNow(); // tell the server straight away when online
  };

  const withdraw = async () => {
    await patchStudent(id, (s) => ({ ...s, consent: { ...s.consent!, scopes: [], photos: undefined, revoked_at: Date.now() } }));
    void syncNow();
  };

  const erase = async () => {
    await eraseStudent(id, student.consent?.method === "self_18plus" ? "student" : "guardian");
    go({ name: "home" });
  };

  return (
    <Screen title={t("privacy")} onBack={() => go(active ? { name: "results", id } : { name: "home" })}>
      <p className="text-muted">{t("privacyHint")}</p>

      {active ? (
        <section className="flex flex-col gap-2 rounded-3xl bg-white p-4 shadow-sm">
          <label className="flex items-start gap-3 rounded-2xl bg-brand-soft p-3">
            <input type="checkbox" checked disabled className="mt-1 size-6" />
            <span>{t("consentAssess")}</span>
          </label>
          {OPTIONAL_SCOPES.map((o) => (
            <label key={o.scope} className="flex items-start gap-3 rounded-2xl border-2 border-line p-3">
              <input type="checkbox" checked={hasScope(student, o.scope)} className="mt-1 size-6"
                onChange={(e) => void setScope(o.scope, e.target.checked)} />
              <span>{t(o.key)}</span>
            </label>
          ))}
          <Button kind="ghost" className="text-base" onClick={withdraw}>✋ {t("withdraw")}</Button>
        </section>
      ) : (
        <p className="rounded-2xl bg-sun-soft p-3 text-warn">{t("withdrawn")}</p>
      )}

      <section className="mt-auto flex flex-col gap-2 rounded-3xl bg-white p-4 shadow-sm">
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-1 size-6" />
          <span>{t("deleteConfirm")}</span>
        </label>
        <Button kind="ghost" className="text-base text-red-700" disabled={!sure} onClick={erase}>🗑 {t("deleteNow")}</Button>
      </section>
    </Screen>
  );
}
