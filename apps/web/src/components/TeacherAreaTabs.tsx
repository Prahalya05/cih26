import type { Go } from "../App";
import type { Account } from "../lib/auth";
import { useT } from "../lib/i18n";

/** Segmented switcher separating a teacher's physical school area from her online classrooms. */
export function TeacherAreaTabs({
  area,
  account,
  go,
  onSelectSchool,
}: {
  area: "school" | "online";
  account: Account | null | undefined;
  go: Go;
  onSelectSchool?: () => void;
}) {
  const { t } = useT();
  if (!account || account.role !== "teacher") return null;
  const openSchool = () => {
    if (account.school_kind === "school" && account.class_code) {
      try { localStorage.setItem("disha.code", account.class_code); } catch { /* ignore */ }
    } else {
      try { localStorage.removeItem("disha.code"); } catch { /* ignore */ }
    }
    if (onSelectSchool) onSelectSchool();
    else go({ name: "teacher" });
  };
  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-line/60 p-1 text-sm font-bold" role="tablist">
      <button
        role="tab"
        aria-selected={area === "school"}
        onClick={openSchool}
        className={`min-h-10 rounded-lg px-2 ${area === "school" ? "bg-surface text-brand shadow-sm" : "text-muted"}`}
      >
        {t("areaMySchool")}
      </button>
      <button
        role="tab"
        aria-selected={area === "online"}
        onClick={() => go({ name: "classrooms" })}
        className={`min-h-10 rounded-lg px-2 ${area === "online" ? "bg-surface text-brand shadow-sm" : "text-muted"}`}
      >
        {t("areaOnline")}
      </button>
    </div>
  );
}
