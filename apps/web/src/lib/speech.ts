// Voice output and input.
// Output: a recorded prompt if one exists (public/audio/manifest.json), otherwise the phone's text-to-speech.
// Input: push-to-talk recording (record, then upload). Live streaming doesn't survive 2G/3G.

import type { LangCode } from "./i18n";
import { apiFetch } from "./api";

let manifest: Record<string, string> | null = null;
fetch("/audio/manifest.json")
  .then((r) => (r.ok ? r.json() : { files: {} }))
  .then((m) => { manifest = m.files ?? {}; })
  .catch(() => { manifest = {}; });

const BCP47: Record<LangCode, string> = { ta: "ta-IN", en: "en-IN", hi: "hi-IN" };

function voiceFor(lang: LangCode): SpeechSynthesisVoice | undefined {
  if (!("speechSynthesis" in window)) return undefined;
  const voices = speechSynthesis.getVoices();
  const code = BCP47[lang].toLowerCase();
  return voices.find((v) => v.lang.toLowerCase() === code) ?? voices.find((v) => v.lang.toLowerCase().startsWith(lang));
}

/** True if this phone can read text aloud in the language (Tamil voices are missing on many cheap phones):
 *  its own voice, or the server's voice while online (see /v1/tts). */
export function canSpeak(lang: LangCode): boolean {
  return !!voiceFor(lang) || (typeof navigator !== "undefined" && navigator.onLine);
}

// Spoken prompts made by the server, kept for this session (same text = same audio).
const served = new Map<string, string>();

async function speakFromServer(text: string, lang: LangCode): Promise<boolean> {
  const key = `${lang}|${text}`;
  let url = served.get(key);
  if (!url) {
    try {
      const res = await apiFetch("/v1/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text.slice(0, 400), lang }) });
      if (!res.ok) return false;
      url = URL.createObjectURL(await res.blob());
      served.set(key, url);
    } catch { return false; }
  }
  stopSpeaking();
  current = new Audio(url);
  void current.play().catch(() => {});
  return true;
}

let current: HTMLAudioElement | null = null;

export function stopSpeaking() {
  current?.pause();
  current = null;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

export function speak(text: string, lang: LangCode, key?: string): boolean {
  stopSpeaking();
  const file = key && manifest?.[`${lang}/${key}`];
  if (file) {
    current = new Audio(`/audio/${file}`);
    void current.play();
    return true;
  }
  const voice = voiceFor(lang);
  // No voice for this language on the phone (common for Tamil): ask the server to speak it.
  if (!voice) { if (navigator.onLine) void speakFromServer(text, lang); return navigator.onLine; }
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.9;
  speechSynthesis.speak(u);
  return true;
}

// Voices load asynchronously on Android Chrome.
if ("speechSynthesis" in window) speechSynthesis.getVoices();

export class Recorder {
  private rec?: MediaRecorder;
  private chunks: Blob[] = [];
  private timer?: number;

  static supported() {
    return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }

  private dictation?: { stop: () => void };

  /** live: words appear on screen while she speaks (the phone's own recogniser, e.g. Tamil ta-IN), as a preview.
   *  The recording is still sent to the server for the real transcript and skill reading. */
  async start(maxSeconds = 45, onAutoStop?: () => void, live?: { lang: LangCode; onText: (t: string) => void }) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (live) this.dictation = startDictation(live.lang, live.onText) ?? undefined;
    const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    this.rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start();
    this.timer = window.setTimeout(() => onAutoStop?.(), maxSeconds * 1000);
  }

  stop(): Promise<Blob> {
    window.clearTimeout(this.timer);
    this.dictation?.stop();
    this.dictation = undefined;
    return new Promise((resolve) => {
      const rec = this.rec;
      if (!rec) return resolve(new Blob());
      rec.onstop = () => {
        rec.stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(this.chunks, { type: rec.mimeType || "audio/webm" }));
      };
      rec.stop();
    });
  }
}

// ---------- live dictation (Tamil, Hindi, English) ----------

type SR = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onerror: (() => void) | null };

/** True if the phone can turn speech into words as she speaks (Chrome on Android supports ta-IN). */
export function canDictate(): boolean {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

/** Starts live speech-to-text in her language; onText gets the words so far. Returns null if not supported. */
export function startDictation(lang: LangCode, onText: (text: string) => void): { stop: () => void } | null {
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  try {
    const rec = new Ctor();
    rec.lang = BCP47[lang];
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      onText(text.trim());
    };
    rec.onerror = () => {};
    rec.start();
    return { stop: () => { try { rec.stop(); } catch { /* already stopped */ } } };
  } catch {
    return null;
  }
}
