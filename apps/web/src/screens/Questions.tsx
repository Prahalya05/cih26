import { useEffect, useRef, useState } from "react";
import type { Go } from "../App";
import { Button, Chip, Pill, Progress, Screen, SpeakButton, useLive, useOnline } from "../components/ui";
import { QUESTIONS } from "../data/questions";
import { db, patchStudent, type Answer, type SkillClaim } from "../lib/db";
import { recordEvent, recordEvents } from "../lib/events";
import { useT } from "../lib/i18n";
import { extractKeywords } from "../lib/keywords";
import { kb } from "../lib/kb";
import { Recorder, speak } from "../lib/speech";
import { extractRemote } from "../lib/sync";
import { Icon } from "../components/Icon";

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
    speak(pick(q), lang, `q_${q.id}`);
    setTyping(false);
    setText("");
    setNote("");
  }, [q, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!student) return null;
  const answer: Answer = student.answers[q.id] ?? { qid: q.id, chips: [] };

  const update = (change: (a: Answer) => Answer) =>
    patchStudent(id, (s) => ({ ...s, answers: { ...s.answers, [q.id]: change(s.answers[q.id] ?? { qid: q.id, chips: [] }) } }));

  const toggle = (skill: string) => {
    const wasOn = answer.chips.includes(skill);
    void update((a) => ({ ...a, chips: a.chips.includes(skill) ? a.chips.filter((c) => c !== skill) : [...a.chips, skill] }));
    void recordEvent({ student_id: id, kind: "self_report", skill_id: skill,
      payload: { source: "tap", qid: q.id, ...(wasOn ? { retracted: true } : {}) } });
  };

  const join = (a?: string, b?: string) => [a, b].filter(Boolean).join(" · ");

  const addExtracted = (skills: SkillClaim[], extra: (a: Answer) => Partial<Answer>) => {
    const fresh = skills.filter((s) => !(answer.extracted ?? []).some((m) => m.id === s.id));
    void recordEvents(fresh.map((s) => ({ student_id: id, kind: "self_report" as const, skill_id: s.id,
      payload: { source: s.source, qid: q.id, evidence: s.evidence, confidence: s.confidence } })));
    void update((a) => {
      const merged = [...(a.extracted ?? [])];
      for (const s of skills) if (!merged.some((m) => m.id === s.id)) merged.push(s);
      return { ...a, ...extra(a), extracted: merged };
    });
  };

  const submitText = async () => {
    const value = text.trim();
    if (!value) return;
    setVoice("thinking");
    const remote = await extractRemote(pick(q), { text: value });
    const skills = remote?.skills ?? extractKeywords(value);
    addExtracted(skills, (a) => ({ text: join(a.text, value), via: remote?.source ?? "keywords",
      experiences: [...(a.experiences ?? []), ...(remote?.experiences ?? [])] }));
    setText("");
    setTyping(false);
    setVoice("idle");
  };

  const startVoice = async () => {
    if (!online) { setNote(t("voiceOffline")); return; }
    try {
      recorder.current = new Recorder();
      await recorder.current.start(45, () => stopRef.current());
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
    const remote = await extractRemote(pick(q), { audio });
    setVoice("idle");
    if (!remote || remote.source === "unavailable") { setNote(t("voiceOffline")); return; }
    addExtracted(remote.skills, (a) => ({ transcript: join(a.transcript, remote.transcript), via: remote.source,
      experiences: [...(a.experiences ?? []), ...(remote.experiences ?? [])] }));
  };

  stopRef.current = () => void stopVoice();

  const next = () => (index + 1 < QUESTIONS.length ? setIndex(index + 1) : go({ name: "facts", id }));

  return (
    <Screen title={`${index + 1} / ${QUESTIONS.length}`} onBack={() => (index > 0 ? setIndex(index - 1) : go({ name: "cards", id }))}>
      <Progress step={index + 1} total={QUESTIONS.length} />
      <div className="flex items-start gap-3">
        <h2 className="flex-1 text-2xl leading-snug font-bold">{pick(q)}</h2>
        <SpeakButton text={pick(q)} audioKey={`q_${q.id}`} />
      </div>
      <p className="text-muted">{t("questionsHint")}</p>

      <div className="grid grid-cols-2 gap-2.5">
        {q.chips.map((c) => (
          <Chip key={c.skill + c.en} selected={answer.chips.includes(c.skill)} onClick={() => toggle(c.skill)}>
            <span className="text-3xl">{c.emoji}</span>
            <span>{pick(c)}</span>
          </Chip>
        ))}
      </div>

      <div className="flex gap-2.5">
        {Recorder.supported() && (
          <button
            onClick={voice === "recording" ? stopVoice : startVoice}
            disabled={voice === "thinking"}
            className={`flex min-h-14 flex-1 items-center justify-center gap-2 rounded-xl text-lg font-semibold ${
              voice === "recording" ? "animate-pulse bg-red-600 text-white" : "bg-sun-soft text-warn"
            }`}
          >
            {voice === "recording" ? <><Icon name="stop" className="size-5" />{t("stop")}</> : <><Icon name="mic" className="size-5" />{t("speak")}</>}
          </button>
        )}
        <button onClick={() => setTyping(!typing)} className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-surface text-lg font-semibold">
          ⌨️ {t("type")}
        </button>
      </div>

      {typing && (
        <div className="flex gap-2">
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitText()}
            placeholder={t("typeHere")}
            className="min-h-14 flex-1 rounded-xl border border-line bg-surface px-4 text-lg"
          />
          <Button onClick={submitText} disabled={!text.trim() || voice === "thinking"}><Icon name="check" className="size-5" /></Button>
        </div>
      )}

      {voice === "recording" && <p className="text-center font-medium text-red-700">{t("listening")}</p>}
      {voice === "thinking" && <p className="text-center font-medium text-muted">{t("thinking")}</p>}
      {note && <p className="rounded-xl bg-sun-soft px-3 py-2 text-sm text-warn">{note}</p>}

      {(answer.transcript || answer.text || (answer.extracted?.length ?? 0) > 0) && (
        <div className="rounded-xl bg-surface p-4 border border-line">
          <p className="text-sm font-semibold text-muted">{t("weHeard")}</p>
          {(answer.transcript || answer.text) && <p className="mt-1 text-lg">“{answer.transcript || answer.text}”</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(answer.extracted ?? []).map((s) => <Pill key={s.id} tone="brand">{pick(kb.skills[s.id].name)}</Pill>)}
          </div>
        </div>
      )}

      <Button className="mt-auto" onClick={next}>{t("next")} →</Button>
    </Screen>
  );
}
