// Interests in her own words: she can skip the picture cards entirely and just speak or type, in any language.
// AI (online) reads it and proposes interests with quotes; a rule keeps only real letters with quotes she said.
// Offline, a word list in Tamil, Hindi and English does the same job. "I don't know yet" is always allowed.

import { checkFollowup, checkInterests, interestsFromKeywords, isVague, type InterestClaim } from "@disha/engine";
import { useEffect, useRef, useState } from "react";
import type { Go } from "../App";
import { Icon } from "../components/Icon";
import { Button, Pill, Screen, SpeakButton, useLive, useOnline } from "../components/ui";
import { db, patchStudent, type Interests } from "../lib/db";
import { recordEvents } from "../lib/events";
import { useT } from "../lib/i18n";
import { Recorder, speak } from "../lib/speech";
import { followupRemote, interestsRemote } from "../lib/sync";
import { emit } from "../lib/xray";

const LETTER: Record<string, { emoji: string; en: string; ta: string; hi: string }> = {
  R: { emoji: "🔧", en: "Hands-on work", ta: "கைவேலை", hi: "हाथ का काम" },
  I: { emoji: "🔬", en: "Finding out how things work", ta: "ஆராய்தல்", hi: "खोजबीन" },
  A: { emoji: "🎨", en: "Creating and designing", ta: "படைத்தல்", hi: "रचना और डिज़ाइन" },
  S: { emoji: "🤝", en: "Helping and teaching people", ta: "மக்களுக்கு உதவுதல்", hi: "लोगों की मदद" },
  E: { emoji: "📣", en: "Leading and selling", ta: "தலைமை, விற்பனை", hi: "नेतृत्व और बिक्री" },
  C: { emoji: "🗂️", en: "Organising and records", ta: "ஒழுங்குபடுத்தல்", hi: "व्यवस्था और हिसाब" },
};

type Busy = "idle" | "recording" | "thinking";

export default function Talk({ go, id }: { go: Go; id: string }) {
  const { t, pick, lang } = useT();
  const online = useOnline();
  const student = useLive(() => db.students.get(id), [id], undefined);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<Busy>("idle");
  const [said, setSaid] = useState("");
  const [claims, setClaims] = useState<InterestClaim[] | null>(null);
  const [via, setVia] = useState<Interests["via"]>();
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [note, setNote] = useState("");
  // The conversation so far, and the follow-up question now on screen (AI-written, rule-checked; or a fixed one).
  const [turns, setTurns] = useState<{ q?: string; said: string }[]>([]);
  const [followup, setFollowup] = useState<{ q: string; ai: boolean } | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => { speak(t("talkHint"), lang, "talk_hint"); }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!student) return null;

  /** Runs the AI (online) or the word list (offline), and records the decision for the X-ray. */
  const understand = async (input: { text?: string; audio?: Blob }) => {
    setBusy("thinking");
    setNote("");
    const remote = await interestsRemote(input, lang);
    let words = input.text ?? "";
    let kept: InterestClaim[];
    if (remote && remote.source !== "unavailable") {
      words = remote.transcript || words;
      // The server already checked; check again here so the phone never trusts an answer it can't verify.
      const checked = checkInterests(remote.interests, words);
      kept = checked.kept;
      const dropped = [...(remote.trace?.dropped ?? []), ...checked.dropped];
      setVia(remote.source === "cached" || remote.trace?.cached ? "cached" : remote.source === "gemini" ? "gemini" : "keywords");
      emit({
        step: "interests", source: remote.source === "keywords" ? "RULE" : "AI_CHECKED", ref: remote.source === "keywords" ? "rule.interest_keywords" : "ai.interests",
        title: `Interests from her words: ${kept.map((k) => k.letter).join(", ") || "none found"}`, subject: `interests:${id}`,
        inputs: { said: words.slice(0, 120), language: lang }, output: kept.map((k) => `${k.letter} (${k.tag})`).join(", ") || "none",
        why: [...kept.map((k) => `${k.letter} ✓ quote found: "${k.evidence}"`), ...dropped.map((d) => `${d.value} ✗ ${d.reason}`)],
        ai: { model: remote.trace?.model ?? "keywords", latency_ms: remote.trace?.latency_ms, kept: kept.map((k) => `${k.letter}: "${k.evidence}"`), dropped, fallback: remote.trace?.fallback, cached: remote.trace?.cached },
      });
    } else {
      if (input.audio) { setBusy("idle"); setNote(t("voiceOffline")); return; }
      kept = interestsFromKeywords(words);
      setVia("keywords");
      emit({
        step: "interests", source: "RULE", ref: "rule.interest_keywords", title: `Interests offline (word list): ${kept.map((k) => k.letter).join(", ") || "none found"}`,
        subject: `interests:${id}`, inputs: { said: words.slice(0, 120) }, output: kept.map((k) => k.letter).join(", ") || "none",
        why: ["no internet → word list in Tamil, Hindi and English", ...kept.map((k) => `${k.letter}: word "${k.tag}" in "${k.evidence}"`)],
      });
    }
    // Keep what earlier answers found; a new quote for the same letter does not replace the first one.
    const merged = [...(claims ?? [])];
    for (const k of kept) if (!merged.some((m) => m.letter === k.letter)) merged.push(k);
    const allSaid = [said, words].filter(Boolean).join(" · ");
    const history = [...turns, { q: followup?.q ?? t("talkHint"), said: words }];
    setTurns(history);
    setSaid(allSaid);
    setClaims(merged);
    setText("");
    await askFollowup(history, words, merged);
    setBusy("idle");
  };

  /** A rule decides WHEN to ask (vague answer, at most 2 times); the AI writes WHAT to ask; a rule screens the question. */
  const askFollowup = async (history: { q?: string; said: string }[], words: string, merged: InterestClaim[]) => {
    const asked = history.length - 1;
    if (!isVague(words, merged.length, asked)) {
      setFollowup(null);
      if (!merged.length) setNote(t("noInterestFound"));
      return;
    }
    const letters = merged.map((m) => m.letter);
    const remote = await followupRemote(history, letters, lang);
    const checked = checkFollowup(remote?.question);
    const dropped = [...(remote?.trace?.dropped ?? []), ...(remote?.question ? checked.dropped : [])];
    const why = [`rule: ${letters.length} interest area(s) found, ${words.trim().split(/\s+/).filter(Boolean).length} words → vague (follow-up ${asked + 1} of 2)`];
    let next: { q: string; ai: boolean };
    if (checked.question) {
      next = { q: checked.question, ai: true };
      emit({ step: "interests", source: "AI_CHECKED", ref: "ai.talk_followup", subject: `interests:${id}`, title: `AI follow-up question ${asked + 1}`,
        inputs: { she_said: words.slice(0, 120), found: letters.join(", ") || "none" }, output: checked.question,
        why: [...why, ...(remote?.aim ? [`AI's aim: ${remote.aim}`] : []), "✓ one short question, no personal data", ...dropped.map((d) => `${d.value} ✗ ${d.reason}`)],
        ai: { model: remote?.trace?.model ?? "gemini", latency_ms: remote?.trace?.latency_ms, kept: [checked.question], dropped } });
    } else {
      next = { q: t(asked === 0 ? "followupFixed1" : "followupFixed2"), ai: false };
      emit({ step: "interests", source: "RULE", ref: "rule.followup_when", subject: `interests:${id}`, title: `Fixed follow-up question ${asked + 1}`,
        output: next.q, why: [...why, remote?.trace?.fallback ?? (remote ? "AI question failed the check" : "no internet → fixed question"), ...dropped.map((d) => `${d.value} ✗ ${d.reason}`)] });
    }
    setFollowup(next);
    setNote("");
    speak(next.q, lang);
  };

  const startVoice = async () => {
    if (!online) { setNote(t("voiceOffline")); return; }
    try {
      recorder.current = new Recorder();
      await recorder.current.start(45, () => stopRef.current());
      setBusy("recording");
      setMode("voice");
    } catch { setNote(t("voiceOffline")); }
  };
  const stopVoice = async () => {
    if (!recorder.current) return;
    const audio = await recorder.current.stop();
    recorder.current = null;
    await understand({ audio });
  };
  stopRef.current = () => void stopVoice();

  const finish = async (interests: Interests) => {
    await patchStudent(id, (s) => ({ ...s, interests }));
    const list = interests.claims?.length ? interests.claims : [];
    await recordEvents(list.length
      ? list.map((c) => ({ student_id: id, kind: "interest_choice" as const, payload: { card: `words_${c.letter}`, like: true, mode: interests.mode, evidence: c.evidence } }))
      : [{ student_id: id, kind: "interest_choice" as const, payload: { card: "skipped", like: false, mode: "skipped" } }]);
    go({ name: "questions", id });
  };

  const skip = () => {
    emit({ step: "interests", source: "RULE", ref: "rule.interest_unknown", title: "She chose 'I don't know yet'", subject: `interests:${id}`,
      output: "interests not guessed", why: ["no interests given → nothing is guessed", "interest part of Worth = 0 for every career"] });
    void finish({ mode: "skipped", at: Date.now() });
  };

  return (
    <Screen title={t("talkTitle")} onBack={() => go({ name: "home" })}>
      <div className="flex items-start gap-3">
        <p className="flex-1 text-lg leading-snug font-semibold">{t("talkHint")}</p>
        <SpeakButton text={t("talkHint")} audioKey="talk_hint" />
      </div>

      {Recorder.supported() && (
        <button onClick={busy === "recording" ? stopVoice : startVoice} disabled={busy === "thinking"}
          className={`flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl text-lg font-bold ${busy === "recording" ? "animate-pulse bg-red-600 text-white" : "bg-sun-soft text-warn"}`}>
          {busy === "recording" ? <><Icon name="stop" className="size-8" />{t("stop")}</> : <><Icon name="mic" className="size-8" />{t("speak")}</>}
        </button>
      )}

      {turns.length > 0 && (
        <div className="flex flex-col gap-2">
          {turns.map((x, i) => (
            <p key={i} className="ml-8 rounded-2xl rounded-br-sm bg-brand-soft px-3 py-2 text-sm">“{x.said}”</p>
          ))}
        </div>
      )}
      {followup && (
        <div className="flex items-start gap-2 rounded-2xl rounded-bl-sm border border-[#7c3aed]/40 bg-[#7c3aed]/5 p-3">
          <Icon name="spark" className="mt-1 size-4 shrink-0 text-[#7c3aed]" />
          <p className="flex-1 text-base font-semibold">{followup.q}</p>
          <SpeakButton text={followup.q} />
        </div>
      )}

      <div className="flex gap-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={t("talkExample")}
          className="min-h-20 flex-1 rounded-xl border border-line bg-surface p-3 text-base" />
      </div>
      <Button kind="soft" disabled={!text.trim() || busy !== "idle"} onClick={() => { setMode("text"); void understand({ text: text.trim() }); }}>
        <Icon name="send" className="size-5" />{t("send")}
      </Button>

      {busy === "recording" && <p className="text-center font-medium text-red-700">{t("listening")}</p>}
      {busy === "thinking" && <p className="text-center font-medium text-muted">{t("thinking")}</p>}
      {note && <p className="rounded-xl bg-sun-soft px-3 py-2 text-sm text-warn">{note}</p>}

      {claims && claims.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="mt-2 text-sm font-semibold text-muted">{t("interestsFound")}</p>
          <div className="mt-2 flex flex-col gap-2">
            {claims.map((c) => (
              <div key={c.letter} className="flex items-center gap-3 rounded-xl bg-brand-soft p-2">
                <span className="text-3xl">{LETTER[c.letter].emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{pick(LETTER[c.letter])}</p>
                  <p className="truncate text-xs text-muted">“{c.evidence}”</p>
                </div>
              </div>
            ))}
          </div>
          {via && <div className="mt-2"><Pill tone={via === "gemini" ? "brand" : "neutral"}>{via === "gemini" ? "AI, checked by rules" : via === "cached" ? "AI (cached), checked by rules" : "word list (offline)"}</Pill></div>}
          <Button className="mt-3 w-full" onClick={() => void finish({ mode, text: said, claims, via, at: Date.now() })}>{t("continue")} <Icon name="next" className="size-5" /></Button>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <Button kind="ghost" onClick={skip}>🤷 {t("dontKnowYet")}</Button>
        <Button kind="ghost" onClick={() => go({ name: "cards", id })}>🖼️ {t("usePictures")}</Button>
      </div>
    </Screen>
  );
}
