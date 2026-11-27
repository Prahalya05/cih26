// My account: who I am signed in as, language, what Disha keeps about me, sign out, delete my account.

import { useContext, useState } from "react";
import type { Go } from "../App";
import { Button, Card, Pill, Screen } from "../components/ui";
import { Icon } from "../components/Icon";
import { LangContext, useT, type StringKey } from "../lib/i18n";
import { call, linkSchoolCode, signOut, useAccount } from "../lib/auth";
import { PrivacyNotice } from "./SignIn";

const ROLE_LABEL: Record<string, StringKey> = { student: "roleStudent", teacher: "roleTeacher", funder: "roleFunder", employer: "roleEmployer" };

export default function Account({ go }: { go: Go }) {
  const { t } = useT();
  const account = useAccount();
  const { lang, setLang } = useContext(LangContext);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [schoolCode, setSchoolCode] = useState("");
  const [linkErr, setLinkErr] = useState("");
  const [linkOk, setLinkOk] = useState(false);
  if (!account) return null;

  const canLinkSchool =
    (account.role === "teacher" && account.school_kind !== "school") ||
    (account.role === "student" && !account.school_id);

  return (
    <Screen title={t("tabAccount")}>
      <Card className="flex items-center gap-4">
        <span className="flex size-14 items-center justify-center rounded-full bg-brand-soft text-2xl font-extrabold text-brand">{account.name.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-extrabold">{account.name}</p>
          <p className="text-sm text-muted">{account.login}{account.org ? ` · ${account.org}` : ""}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Pill tone="brand">{t(ROLE_LABEL[account.role])}</Pill>
            {(account.role === "teacher" || account.role === "student") && (
              <Pill tone={account.school_kind === "school" ? "good" : "neutral"}>
                {account.school_kind === "school" ? (account.school_name || t("accountModeSchool")) : t("accountModeOnline")}
              </Pill>
            )}
            {account.class_code && <Pill>{account.class_code}</Pill>}
          </div>
        </div>
      </Card>

      {canLinkSchool && (
        <Card className="flex flex-col gap-2">
          <p className="font-bold">{t(account.role === "teacher" ? "linkSchoolTitle" : "linkSchoolStudentTitle")}</p>
          <p className="text-xs text-muted">{t("linkSchoolHint")}</p>
          <div className="flex gap-2">
            <input value={schoolCode} onChange={(e) => setSchoolCode(e.target.value.toUpperCase())} placeholder={account.role === "teacher" ? "TCH-01" : "CLS-01"}
              className="min-h-11 flex-1 rounded-xl border border-line bg-paper px-3 text-sm uppercase" />
            <Button kind="soft" className="!min-h-11 !px-3 text-sm" disabled={!schoolCode.trim()} onClick={async () => {
              setLinkErr(""); setLinkOk(false);
              const r = await linkSchoolCode(schoolCode.trim());
              if ("error" in r) setLinkErr(r.error);
              else { setSchoolCode(""); setLinkOk(true); }
            }}>{t("linkSchoolButton")}</Button>
          </div>
          {linkErr && <p className="text-xs font-semibold text-bad">{linkErr}</p>}
          {linkOk && <p className="text-xs font-semibold text-good">{t("schoolLinked")}</p>}
        </Card>
      )}

      <Card>
        <p className="mb-2 font-bold">{t("language")}</p>
        <div className="grid grid-cols-3 gap-2">
          {([["ta", "தமிழ்"], ["hi", "हिन्दी"], ["en", "English"]] as const).map(([l, label]) => (
            <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l}
              className={`min-h-12 rounded-xl border font-bold ${lang === l ? "border-brand bg-brand text-white" : "border-line"}`}>{label}</button>
          ))}
        </div>
      </Card>

      <Card>
        <p className="mb-2 flex items-center gap-2 font-bold"><Icon name="shield" className="size-5 text-good" />{t("whatWeKeep")}</p>
        <PrivacyNotice role={account.role} />
        {account.role === "student" && account.student_id && (
          <Button kind="ghost" className="mt-3 w-full text-base" onClick={() => go({ name: "privacy", id: account.student_id! })}>
            <Icon name="lock" className="size-5" />{t("privacy")}
          </Button>
        )}
      </Card>

      <nav className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {account.role === "student" && account.student_id && <Row icon="users" label={t("myProfile")} onClick={() => go({ name: "studentProfile", id: account.student_id! })} />}
        {account.role === "teacher" && <Row icon="teacher" label={t("myTeacherProfile")} onClick={() => go({ name: "teacherProfile" })} />}
        {account.role === "teacher" && <Row icon="users" label={t("onlineClassrooms")} onClick={() => go({ name: "classrooms" })} />}
        {account.role === "student" && <Row icon="users" label={t(account.school_id ? "myClass" : "findClass")} onClick={() => go({ name: "findClass" })} />}
        {account.role === "student" && account.student_id && <Row icon="idcard" label={t("myResume")} onClick={() => go({ name: "resume", id: account.student_id! })} />}
        {account.role === "student" && account.student_id && <Row icon="clipboard" label={t("myDocs")} onClick={() => go({ name: "docs", id: account.student_id! })} />}
        <Row icon="layers" label={t("whoDoesWhat")} onClick={() => go({ name: "roles" })} />
        <Row icon="scan" label={t("howDecides")} onClick={() => go({ name: "how", from: { name: "account" } })} />
      </nav>

      <Button kind="ghost" onClick={() => void signOut().then(() => go({ name: "home" }))}><Icon name="back" className="size-5" />{t("signOut")}</Button>

      {!confirmDelete
        ? <button onClick={() => setConfirmDelete(true)} className="text-sm font-bold text-bad">{t("deleteAccount")}</button>
        : (
          <Card className="border-bad/40 bg-bad-soft">
            <p className="text-sm">{t("deleteAccountWarn")}</p>
            <Button className="mt-3 w-full !bg-bad" onClick={async () => {
              await call("/v2/auth/me", { method: "DELETE" });
              await signOut();
              go({ name: "home" });
            }}><Icon name="trash" className="size-5" />{t("deleteAccountNow")}</Button>
          </Card>
        )}
    </Screen>
  );
}

function Row({ icon, label, onClick }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex min-h-14 items-center gap-3 px-4 text-left font-bold hover:bg-paper">
      <span className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-accent-dark"><Icon name={icon} /></span>
      <span className="flex-1">{label}</span>
      <Icon name="chevron" className="size-5 text-faint" />
    </button>
  );
}
