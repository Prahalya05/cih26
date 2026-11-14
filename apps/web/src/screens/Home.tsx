
import type { Go } from "../App";
import { Button, Screen, SpeakButton, useLive } from "../components/ui";
import { CARDS } from "../data/cards";
import { db, hasScope, type Student } from "../lib/db";
import { useT } from "../lib/i18n";

/** Where to send a returning student: the first step they haven't finished. */
export function nextStep(s: Student): Parameters<Go>[0] {
  if (!hasScope(s, "assess")) return { name: "consent", id: s.id };
  if (Object.keys(s.cards).length < CARDS.length) return { name: "cards", id: s.id };
  if (Object.keys(s.answers).length === 0) return { name: "questions", id: s.id };
  if (Object.keys(s.factAnswers).length === 0) return { name: "facts", id: s.id };
  return { name: "results", id: s.id };
}

export default function Home({ go }: { go: Go }) {
  const { t } = useT();

  const students = useLive(
    () =>
      db.students
        .orderBy("updated_at")
        .reverse()
        .filter((s) => !s.simulated)
        .toArray(),
    [],
    [] as Student[],
  );

  return (
    <Screen>
      <div className="space-y-6 pb-5">

        {/* Welcome section */}
        <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#a78bda] via-[#b69be4] to-[#e7b4d4] p-6 text-white shadow-lg shadow-purple-100">
          <div className="absolute -right-8 -top-8 h-36 w-36 rounded-full bg-white/15" />
          <div className="absolute -bottom-12 right-16 h-32 w-32 rounded-full bg-white/10" />

          <div className="relative z-10">
            <div className="mb-4 flex items-center justify-between">
              <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold tracking-wide">
                YOUR FUTURE STARTS HERE
              </span>
              <SpeakButton
                text={t("tagline")}
                audioKey="welcome"
                className="rounded-full bg-white/20"
              />
            </div>

            <h1 className="max-w-xs text-2xl font-bold leading-snug">
              {t("tagline")}
            </h1>

            <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/90">
              Discover your strengths, explore your interests, and take a little
              step towards your dreams.
            </p>

            <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/20 px-4 py-2 text-sm font-semibold">
              <span>Explore</span>
              <span aria-hidden="true">→</span>
            </div>
          </div>
        </section>

        {/* Student selection heading */}
        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
                LET'S GET STARTED
              </p>
              <h2 className="mt-1 text-xl font-bold text-ink">
                {t("whoIsUsing")}
              </h2>
            </div>

            <SpeakButton
              text={t("whoIsUsing")}
              audioKey="who"
              className="rounded-full bg-white shadow-sm"
            />
          </div>

          {/* Student profiles */}
          <div className="grid grid-cols-2 gap-3">
            {students.map((s, index) => (
              <button
                key={s.id}
                onClick={() => go(nextStep(s))}
                className="group relative flex min-h-40 flex-col items-center justify-center overflow-hidden rounded-3xl border border-[#eee5f5] bg-white p-4 text-center shadow-sm transition duration-200 hover:-translate-y-1 hover:border-brand hover:shadow-md active:scale-[0.98]"
                aria-label={`Continue as ${s.name}`}
              >
                <div className="absolute right-3 top-3 h-2 w-2 rounded-full bg-[#8fc8a8]" />

                <div className={`mb-3 flex h-[76px] w-[76px] items-center justify-center rounded-full text-5xl transition group-hover:scale-105 ${
                  index % 3 === 0
                    ? "bg-[#f1eaff]"
                    : index % 3 === 1
                    ? "bg-[#fff0e7]"
                    : "bg-[#e8f5ef]"
                }`}>
                  {s.avatar}
                </div>

                <span className="w-full truncate text-sm font-bold text-ink">
                  {s.name}
                </span>

                <span className="mt-1 text-xs font-medium text-brand">
                  Continue journey →
                </span>
              </button>
            ))}

            {/* Add student card */}
            <button
              onClick={() => go({ name: "new" })}
              className="group flex min-h-40 flex-col items-center justify-center rounded-3xl border-2 border-dashed border-[#cbb8e8] bg-[#f7f2ff] p-4 text-center transition duration-200 hover:-translate-y-1 hover:border-brand hover:bg-[#f0e8ff] active:scale-[0.98]"
            >
              <div className="mb-3 flex h-[76px] w-[76px] items-center justify-center rounded-full bg-white text-4xl font-light text-brand shadow-sm transition group-hover:scale-105">
                +
              </div>

              <span className="text-sm font-bold text-brand-dark">
                {t("newStudent")}
              </span>

              <span className="mt-1 text-xs text-muted">
                Start a new journey
              </span>
            </button>
          </div>

          {students.length === 0 && (
            <p className="mt-3 text-center text-xs text-muted">
              Add a student profile to begin exploring.
            </p>
          )}
        </section>

        {/* Teacher access */}
        <section className="rounded-3xl border border-[#eee5f5] bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#fff0e7] text-xl">
              ♙
            </div>

            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-ink">
                Teacher's corner
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Access the teacher dashboard and student support tools.
              </p>
            </div>
          </div>

          <Button
            kind="ghost"
            className="mt-4 w-full rounded-2xl"
            onClick={() => go({ name: "teacher" })}
          >
            {t("teacher")} →
          </Button>
        </section>

        <p className="text-center text-xs text-muted">
          Made with care. Every dream deserves a chance.
        </p>
      </div>
    </Screen>
  );
}
