
import { useEffect, useRef, useState } from "react";
import type { Go } from "../App";
import {
  Button,
  Chip,
  Pill,
  Progress,
  Screen,
  SpeakButton,
  useLive,
  useOnline,
} from "../components/ui";
import { QUESTIONS } from "../data/questions";
import {
  db,
  patchStudent,
  type Answer,
  type SkillClaim,
} from "../lib/db";
import { recordEvent, recordEvents } from "../lib/events";
import { useT } from "../lib/i18n";
import { extractKeywords } from "../lib/keywords";
import { kb } from "../lib/kb";
import { Recorder, speak } from "../lib/speech";
import { extractRemote } from "../lib/sync";

type VoiceState = "idle" | "recording" | "thinking";

export default function Questions({ go, id }: { go: Go; id: string }) {
  const { t, pick, lang } = useT();
  const online = useOnline();
  const student = useLive(() => db.students.get(id), [id], undefined);

  const [index, setIndex] = useState(0);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<VoiceState>("idle");
  const [note, setNote] = useState("");

  const stopRef = useRef<() => void>(() => {});
  const recorder = useRef<Recorder | null>(null);

  const q = QUESTIONS[index];

  useEffect(() => {
    if (!q) return;

    speak(pick(q), lang, `q_${q.id}`);
    setTyping(false);
    setText("");
    setNote("");
  }, [q, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!student || !q) return null;

  const answer: Answer = student.answers[q.id] ?? {
    qid: q.id,
    chips: [],
  };

  const update = (change: (a: Answer) => Answer) =>
    patchStudent(id, (s) => ({
      ...s,
      answers: {
        ...s.answers,
        [q.id]: change(
          s.answers[q.id] ?? { qid: q.id, chips: [] }
        ),
      },
    }));

  const toggle = (skill: string) => {
    const wasOn = answer.chips.includes(skill);

    void update((a) => ({
      ...a,
      chips: a.chips.includes(skill)
        ? a.chips.filter((c) => c !== skill)
        : [...a.chips, skill],
    }));

    void recordEvent({
      student_id: id,
      kind: "self_report",
      skill_id: skill,
      payload: {
        source: "tap",
        qid: q.id,
        ...(wasOn ? { retracted: true } : {}),
      },
    });
  };

  const join = (a?: string, b?: string) =>
    [a, b].filter(Boolean).join(" · ");

  const addExtracted = (
    skills: SkillClaim[],
    extra: (a: Answer) => Partial<Answer>
  ) => {
    const fresh = skills.filter(
      (s) => !(answer.extracted ?? []).some((m) => m.id === s.id)
    );

    void recordEvents(
      fresh.map((s) => ({
        student_id: id,
        kind: "self_report" as const,
        skill_id: s.id,
        payload: {
          source: s.source,
          qid: q.id,
          evidence: s.evidence,
          confidence: s.confidence,
        },
      }))
    );

    void update((a) => {
      const merged = [...(a.extracted ?? [])];

      for (const s of skills) {
        if (!merged.some((m) => m.id === s.id)) {
          merged.push(s);
        }
      }

      return {
        ...a,
        ...extra(a),
        extracted: merged,
      };
    });
  };

  const submitText = async () => {
    const value = text.trim();
    if (!value) return;

    setVoice("thinking");

    try {
      const remote = await extractRemote(pick(q), {
        text: value,
      });

      const skills = remote?.skills ?? extractKeywords(value);

      addExtracted(skills, (a) => ({
        text: join(a.text, value),
        via: remote?.source ?? "keywords",
        experiences: [
          ...(a.experiences ?? []),
          ...(remote?.experiences ?? []),
        ],
      }));

      setText("");
      setTyping(false);
    } finally {
      setVoice("idle");
    }
  };

  const startVoice = async () => {
    if (!online) {
      setNote(t("voiceOffline"));
      return;
    }

    try {
      recorder.current = new Recorder();

      await recorder.current.start(45, () =>
        stopRef.current()
      );

      setVoice("recording");
    } catch {
      setNote(t("voiceOffline"));
    }
  };

  const stopVoice = async () => {
    if (!recorder.current) return;

    const audio = await recorder.current.stop();
    recorder.current = null;

    setVoice("thinking");

    try {
      const remote = await extractRemote(pick(q), {
        audio,
      });

      if (!remote || remote.source === "unavailable") {
        setNote(t("voiceOffline"));
        return;
      }

      addExtracted(remote.skills, (a) => ({
        transcript: join(a.transcript, remote.transcript),
        via: remote.source,
        experiences: [
          ...(a.experiences ?? []),
          ...(remote.experiences ?? []),
        ],
      }));
    } finally {
      setVoice("idle");
    }
  };

  stopRef.current = () => void stopVoice();

  const next = () =>
    index + 1 < QUESTIONS.length
      ? setIndex(index + 1)
      : go({ name: "facts", id });

  return (
    <Screen
      title={`${index + 1} / ${QUESTIONS.length}`}
      onBack={() =>
        index > 0
          ? setIndex(index - 1)
          : go({ name: "cards", id })
      }
    >
      {/* Progress */}
      <div className="rounded-3xl border border-[#EDE3F6] bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-[#806B96]">
            Your Questions
          </span>

          <span className="rounded-full bg-[#F2EAF9] px-3 py-1 text-sm font-bold text-[#765795]">
            {index + 1} / {QUESTIONS.length}
          </span>
        </div>

        <Progress step={index + 1} total={QUESTIONS.length} />

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#F1EAF7]">
          <div
            className="h-full rounded-full bg-[#A98BCB] transition-all duration-500"
            style={{
              width: `${((index + 1) / QUESTIONS.length) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Question */}
      <div className="rounded-[2rem] border border-[#E9DDF4] bg-gradient-to-br from-[#F5EFFB] to-[#FFF0F5] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm">
            💭
          </div>

          <h2 className="flex-1 pt-1 text-xl font-bold leading-relaxed text-[#493B59]">
            {pick(q)}
          </h2>

          <SpeakButton
            text={pick(q)}
            audioKey={`q_${q.id}`}
          />
        </div>

        <p className="mt-4 text-sm leading-relaxed text-[#796B86]">
          {t("questionsHint")}
        </p>
      </div>

      {/* Skill selection */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-[#554365]">
            ✨ Choose your interests
          </h3>

          <span className="text-xs font-medium text-[#917DA8]">
            {answer.chips.length} selected
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {q.chips.map((c) => (
            <Chip
              key={c.skill + c.en}
              selected={answer.chips.includes(c.skill)}
              onClick={() => toggle(c.skill)}
            >
              <div className="flex flex-col items-center justify-center gap-2 py-2">
                <span className="text-4xl">{c.emoji}</span>

                <span className="text-center font-semibold">
                  {pick(c)}
                </span>

                {answer.chips.includes(c.skill) && (
                  <span className="text-sm font-bold text-[#8060A4]">
                    ✓ Selected
                  </span>
                )}
              </div>
            </Chip>
          ))}
        </div>
      </div>

      {/* Input options */}
      <div className="rounded-3xl border border-[#EDE3F6] bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-base font-bold text-[#554365]">
          💬 Tell us more about yourself
        </h3>

        <div className="flex gap-3">
          {Recorder.supported() && (
            <button
              onClick={
                voice === "recording"
                  ? stopVoice
                  : startVoice
              }
              disabled={voice === "thinking"}
              className={`flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl px-3 text-sm font-bold transition-all active:scale-95 ${
                voice === "recording"
                  ? "animate-pulse bg-[#E56A82] text-white"
                  : "border border-[#E8D8F4] bg-[#F2EAF9] text-[#765795]"
              }`}
            >
              {voice === "recording"
                ? `⏹ ${t("stop")}`
                : `🎤 ${t("speak")}`}
            </button>
          )}

          <button
            onClick={() => setTyping(!typing)}
            className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl border border-[#F2D9E5] bg-[#FFF0F5] px-3 text-sm font-bold text-[#A65373] transition-all active:scale-95"
          >
            ⌨️ {t("type")}
          </button>
        </div>

        {typing && (
          <div className="mt-3 flex gap-2">
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && void submitText()
              }
              placeholder={t("typeHere")}
              className="min-h-14 min-w-0 flex-1 rounded-2xl border-2 border-[#E5D8EF] bg-[#FCFAFE] px-4 text-base outline-none transition focus:border-[#A98BCB]"
            />

            <Button
              onClick={submitText}
              disabled={!text.trim() || voice === "thinking"}
            >
              ✓
            </Button>
          </div>
        )}
      </div>

      {/* Voice status */}
      {voice === "recording" && (
        <p className="rounded-2xl bg-[#FFF0F3] p-3 text-center font-semibold text-[#C24E68]">
          🔴 {t("listening")}
        </p>
      )}

      {voice === "thinking" && (
        <p className="rounded-2xl bg-[#F2EAF9] p-3 text-center font-semibold text-[#8060A4]">
          ⏳ {t("thinking")}
        </p>
      )}

      {note && (
        <p className="rounded-2xl bg-[#FFF0F5] px-4 py-3 text-sm font-medium text-[#A65373]">
          {note}
        </p>
      )}

      {/* Extracted answers */}
      {(answer.transcript ||
        answer.text ||
        (answer.extracted?.length ?? 0) > 0) && (
        <div className="rounded-3xl border border-[#EADFF3] bg-white p-4 shadow-sm">
          <h3 className="text-sm font-bold text-[#806B96]">
            💜 {t("weHeard")}
          </h3>

          {(answer.transcript || answer.text) && (
            <p className="mt-2 text-base leading-relaxed text-[#554365]">
              “{answer.transcript || answer.text}”
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {(answer.extracted ?? []).map((s) => (
              <Pill key={s.id} tone="brand">
                {kb.skills[s.id]
                  ? pick(kb.skills[s.id].name)
                  : s.id}
              </Pill>
            ))}
          </div>
        </div>
      )}

      {/* Next */}
      <Button
        className="mt-auto"
        onClick={next}
        disabled={voice !== "idle"}
      >
        {t("next")} →
      </Button>
    </Screen>
  );
}
