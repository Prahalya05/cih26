
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
      return {
        ...s,
        consent: {
          ...s.consent!,
          scopes: on ? [...cur, scope] : cur,
          photos: undefined,
        },
      };
    });
    void syncNow();
  };

  const withdraw = async () => {
    await patchStudent(id, (s) => ({
      ...s,
      consent: {
        ...s.consent!,
        scopes: [],
        photos: undefined,
        revoked_at: Date.now(),
      },
    }));
    void syncNow();
  };

  const erase = async () => {
    await eraseStudent(
      id,
      student.consent?.method === "self_18plus" ? "student" : "guardian",
    );
    go({ name: "home" });
  };

  return (
    <Screen
      title={t("privacy")}
      onBack={() =>
        go(active ? { name: "results", id } : { name: "home" })
      }
    >
      <div className="flex flex-col gap-5 pb-5">

        {/* Privacy information */}
        <section className="rounded-3xl border border-[#eee5fa] bg-gradient-to-br from-[#f3edfc] to-[#fff4f7] p-5">
          <p className="text-sm leading-7 text-[#665576]">
            {t("privacyHint")}
          </p>
        </section>

        {/* Permission settings */}
        {active ? (
          <section className="flex flex-col gap-3 rounded-3xl border border-[#eee5fa] bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 pb-1">
              <h3 className="flex-1 text-lg font-bold text-[#49365f]">
                {t("consentScopes")}
              </h3>
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-[#d9c9f0] bg-[#f3edfc] p-4">
              <input
                type="checkbox"
                checked
                disabled
                className="mt-1 size-5 accent-[#9274c8]"
              />
              <span className="flex-1 text-sm font-medium leading-6 text-[#49365f]">
                {t("consentAssess")}
              </span>
            </label>

            {OPTIONAL_SCOPES.map((o) => (
              <label
                key={o.scope}
                className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-4 transition-all duration-200 ${
                  hasScope(student, o.scope)
                    ? "border-[#9274c8] bg-[#f5f0fc]"
                    : "border-[#eee7f3] bg-[#fcfaff] hover:border-[#c9b4e8]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={hasScope(student, o.scope)}
                  className="mt-1 size-5 accent-[#9274c8]"
                  onChange={(e) =>
                    void setScope(o.scope, e.target.checked)
                  }
                />
                <span className="flex-1 text-sm font-medium leading-6 text-[#49365f]">
                  {t(o.key)}
                </span>
              </label>
            ))}

            <div className="mt-2 border-t border-[#eee7f3] pt-4">
              <Button
                kind="ghost"
                className="w-full rounded-2xl border border-[#f0d8d8] text-base text-[#b45d68] hover:bg-[#fff3f3]"
                onClick={withdraw}
              >
                ✋ {t("withdraw")}
              </Button>
            </div>
          </section>
        ) : (
          <section className="rounded-3xl border border-[#f3dfc3] bg-[#fff8ed] p-5">
            <p className="text-sm font-medium leading-7 text-[#a36c32]">
              {t("withdrawn")}
            </p>
          </section>
        )}

        {/* Delete confirmation */}
        <section className="mt-2 flex flex-col gap-4 rounded-3xl border border-[#f0dada] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-[#fff0f0] text-xl">
              🗑️
            </span>
            <div className="flex-1">
              <h3 className="font-bold text-[#9e4f59]">
                {t("deleteNow")}
              </h3>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-[#fff7f7] p-4">
            <input
              type="checkbox"
              checked={sure}
              onChange={(e) => setSure(e.target.checked)}
              className="mt-1 size-5 accent-[#c45d68]"
            />
            <span className="flex-1 text-sm leading-6 text-[#76545a]">
              {t("deleteConfirm")}
            </span>
          </label>

          <Button
            kind="ghost"
            className="w-full rounded-2xl border border-[#edcaca] text-base text-[#b34f5b] hover:bg-[#fff0f0]"
            disabled={!sure}
            onClick={erase}
          >
            🗑 {t("deleteNow")}
          </Button>
        </section>
      </div>
    </Screen>
  );
}
