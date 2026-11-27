// The tab bar at the bottom: different tabs for each role, like any standard app.

import type { Go, Route } from "../App";
import type { Account } from "../lib/auth";
import { useT, type StringKey } from "../lib/i18n";
import { Icon, type IconName } from "./Icon";

interface Tab { label: StringKey; icon: IconName; to: Route; match: Route["name"][] }

function tabsFor(a: Account): Tab[] {
  const account: Tab = { label: "tabAccount", icon: "users", to: { name: "account" }, match: ["account", "privacy"] };
  const how: Tab = { label: "tabHow", icon: "scan", to: { name: "how" }, match: ["how"] };
  switch (a.role) {
    case "teacher":
      return [
        { label: "tabClass", icon: "teacher", to: { name: a.school_kind === "school" ? "teacher" : "classrooms" }, match: ["teacher", "rate", "graph", "docs", "studentProfile", "classrooms"] },
        { label: "tabCourses", icon: "cap", to: { name: "teacherCourses" }, match: ["teacherCourses", "courseBuilder", "course", "teacherProfile"] },
        { label: "tabJobs", icon: "briefcase", to: { name: "jobs" }, match: ["jobs"] },
        { ...account, match: ["account", "privacy", "roles", "how"] },
      ];
    case "funder":
      return [{ label: "tabPayouts", icon: "wallet", to: { name: "funder" }, match: ["funder"] }, how, account];
    case "employer":
      return [{ label: "tabJobs", icon: "briefcase", to: { name: "jobs" }, match: ["jobs"] }, how, account];
    default:
      return [
        { label: "tabHome", icon: "target", to: { name: "home" }, match: ["home", "new", "situation", "talk", "consent", "cards", "questions", "facts", "results", "career", "assess", "game", "sample", "order", "proof", "aimTrack", "aimQuiz", "graph"] },
        { label: "tabLearn", icon: "cap", to: { name: "courses" }, match: ["courses", "course", "teacherProfile"] },
        { label: "tabResume", icon: "idcard", to: { name: "home" }, match: ["resume", "docs"] },
        { ...account, match: ["account", "privacy", "studentProfile", "roles", "how", "findClass"] },
      ];
  }
}

export function BottomNav({ account, route, go }: { account: Account; route: Route; go: Go }) {
  const { t } = useT();
  const tabs = tabsFor(account);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-md" aria-label="Main">
      <ul className="mx-auto flex max-w-md">
        {tabs.map((tab) => {
          const active = tab.match.includes(route.name);
          // A student's resume tab needs a profile: open the resume of the profile on screen, or her own.
          const target: Route = tab.label === "tabResume"
            ? ("id" in route && typeof route.id === "string" ? { name: "resume", id: route.id } : account.student_id ? { name: "resume", id: account.student_id } : { name: "home" })
            : tab.to;
          return (
            <li key={tab.label} className="flex-1">
              <button onClick={() => go(target)} aria-current={active ? "page" : undefined}
                className={`flex h-16 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-bold ${active ? "text-brand" : "text-muted"}`}>
                <span className={`flex h-7 w-12 items-center justify-center rounded-full ${active ? "bg-brand-soft" : ""}`}><Icon name={tab.icon} className="size-5" /></span>
                {t(tab.label)}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
