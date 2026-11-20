// Who does what: Disha (fixed rules + AI that is always checked), the teacher, the student and family, donors, and
// employers/customers. The same list is in docs/RESPONSIBILITIES.md.

import type { Go } from "../App";
import { Card, Screen } from "../components/ui";
import { Icon, type IconName } from "../components/Icon";
import { useT, type StringKey } from "../lib/i18n";

const ROLES: { icon: IconName; title: StringKey; does: StringKey[]; never: StringKey }[] = [
  { icon: "scan", title: "rolesDisha", does: ["rd_1", "rd_2", "rd_3", "rd_4", "rd_5", "rd_6"], never: "rd_never" },
  { icon: "bot", title: "rolesAi", does: ["ra_1", "ra_2", "ra_3"], never: "ra_never" },
  { icon: "teacher", title: "rolesTeacher", does: ["rt_1", "rt_2", "rt_3", "rt_4", "rt_5", "rt_6"], never: "rt_never" },
  { icon: "users", title: "rolesStudent", does: ["rs_1", "rs_2", "rs_3"], never: "rs_never" },
  { icon: "wallet", title: "rolesFunder", does: ["rf_1", "rf_2"], never: "rf_never" },
  { icon: "briefcase", title: "rolesEmployer", does: ["re_1", "re_2"], never: "re_never" },
];

export default function Roles({ go }: { go: Go }) {
  const { t } = useT();
  return (
    <Screen title={t("whoDoesWhat")} onBack={() => go({ name: "account" })}>
      <p className="text-muted">{t("whoDoesWhatHint")}</p>
      {ROLES.map((r) => (
        <Card key={r.title}>
          <p className="mb-2 flex items-center gap-2 text-lg font-extrabold"><Icon name={r.icon} className="size-5 text-accent-dark" />{t(r.title)}</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {r.does.map((d) => <li key={d} className="flex gap-2"><Icon name="check" className="mt-0.5 size-4 shrink-0 text-good" />{t(d)}</li>)}
            <li className="flex gap-2 text-muted"><Icon name="ban" className="mt-0.5 size-4 shrink-0 text-bad" />{t(r.never)}</li>
          </ul>
        </Card>
      ))}
    </Screen>
  );
}
