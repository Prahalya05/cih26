import type { Go } from "../App";
import { Icon, type IconName } from "../components/Icon";
import { Screen, SpeakButton, useLive } from "../components/ui";
import { CARDS } from "../data/cards";
import { db, hasScope, type Student } from "../lib/db";
import { useT } from "../lib/i18n";
import { useAccount } from "../lib/auth";

/** Interests are done when every card is answered, or she told us in her own words, or chose "don't know yet". */
export const interestsDone = (s: Student) => Object.keys(s.cards).length >= CARDS.length || !!s.interests;

/** Where to send a returning student: the first step they haven't finished. */
export function nextStep(s: Student): Parameters<Go>[0] {
  if (!s.scenario && !s.simulated) return { name: "situation", id: s.id };
  if (!hasScope(s, "assess")) return { name: "consent", id: s.id };
  // Voice/text mode starts with "tell us about yourself"; picture and mixed modes start with the picture cards.
  if (!interestsDone(s)) return s.uiMode === "voice_text" ? { name: "talk", id: s.id } : { name: "cards", id: s.id };
  if (Object.keys(s.answers).length === 0) return { name: "questions", id: s.id };
  if (Object.keys(s.factAnswers).length === 0) return { name: "facts", id: s.id };
  return { name: "results", id: s.id };
}

export default function Home({ go }: { go: Go }) {
  const { t } = useT();
  const account = useAccount();
  const students = useLive(
    async () => {
      const all = await db.students.orderBy("updated_at").reverse().filter((s) => !s.simulated).toArray();
      if (account?.role === "student" && account.student_id) return all.filter((s) => s.id === account.student_id);
      return all;
    },
    [account?.id, account?.student_id],
    [] as Student[],
  );

  return (
    <Screen>
      <section className="relative overflow-hidden rounded-3xl bg-brand px-5 pt-6 pb-5 text-white">
        {/* the open ring from the Disha mark, large and faint */}
        <svg viewBox="0 0 200 200" className="pointer-events-none absolute -top-16 -right-16 size-56 opacity-25" aria-hidden>
          <path d="M100 12a88 88 0 1 1-80 51" fill="none" stroke="var(--color-accent)" strokeWidth="14" strokeLinecap="round" />
        </svg>
        <p className="eyebrow !text-accent">Disha</p>
        <p className="relative mt-2 max-w-[17rem] text-[1.6rem] leading-[1.2] font-extrabold">{t("tagline")}</p>
        <div className="relative mt-5 flex items-center gap-3">
          <SpeakButton text={t("tagline")} audioKey="welcome" className="!border-white/20 !bg-white/10 !text-white" />
        </div>
      </section>

      <div className="flex items-end justify-between pt-2">
        <h2 className="text-xl font-extrabold">{t("whoIsUsing")}</h2>
        <SpeakButton text={t("whoIsUsing")} audioKey="who" />
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {students.map((s) => (
          <button
            key={s.id}
            onClick={() => go(nextStep(s))}
            className="group flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-surface p-2 transition hover:border-accent active:scale-[0.98]"
          >
            <span className="flex size-16 items-center justify-center rounded-full bg-paper text-4xl transition group-hover:bg-brand-soft">{s.avatar}</span>
            <span className="w-full truncate text-center text-sm font-bold">{s.name}</span>
          </button>
        ))}
        {!(account?.role === "student" && account.student_id && students.length > 0) && (
          <button
            onClick={() => go({ name: "new" })}
            className="flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-accent bg-brand-soft/60 p-2 text-accent-dark transition hover:bg-brand-soft active:scale-[0.98]"
          >
            <span className="flex size-16 items-center justify-center rounded-full bg-surface"><Icon name="plus" className="size-7" strokeWidth={2.2} /></span>
            <span className="text-center text-sm font-bold">{t("newStudent")}</span>
          </button>
        )}
      </div>

      {/* Signed up without a school code: find an online class (or see the requests she already sent). */}
      {account?.role === "student" && !account.school_id && (
        <button onClick={() => go({ name: "findClass" })}
          className="flex items-center gap-3 rounded-2xl bg-brand p-4 text-left text-white active:bg-brand-dark">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/10 text-accent"><Icon name="users" className="size-6" /></span>
          <span className="flex-1">
            <span className="block text-lg font-semibold">{t("findClass")}</span>
            <span className="block text-sm opacity-90">{t("findClassShort")}</span>
          </span>
          <Icon name="chevron" className="size-6" />
        </button>
      )}

      {/* Teacher, donor and employer screens are reached by signing in with that role, not from a student's home. */}
      {account?.role === "student" && account.student_id && (
        <nav className="mt-auto flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          <HomeLink icon="idcard" label={t("myResume")} onClick={() => go({ name: "resume", id: account.student_id! })} />
          <HomeLink icon="clipboard" label={t("myDocs")} onClick={() => go({ name: "docs", id: account.student_id! })} />
        </nav>
      )}
    </Screen>
  );
}

function HomeLink({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex min-h-14 items-center gap-3 px-4 text-left font-bold hover:bg-paper active:bg-paper">
      <span className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-accent-dark"><Icon name={icon} /></span>
      <span className="flex-1">{label}</span>
      <Icon name="chevron" className="size-5 text-faint" />
    </button>
  );
}
