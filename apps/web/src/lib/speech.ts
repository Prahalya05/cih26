// Voice output and input.
// Output: a recorded prompt if one exists (public/audio/manifest.json), otherwise the phone's text-to-speech.
// Input: push-to-talk recording (record, then upload). Live streaming doesn't survive 2G/3G.

import type { LangCode } from "./i18n";

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

/** True if this phone can read text aloud in the language (Tamil voices are missing on many cheap phones). */
export function canSpeak(lang: LangCode): boolean {
  return !!voiceFor(lang);
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
  if (!voice) return false;
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

  async start(maxSeconds = 45, onAutoStop?: () => void) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    this.rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start();
    this.timer = window.setTimeout(() => onAutoStop?.(), maxSeconds * 1000);
  }

  stop(): Promise<Blob> {
    window.clearTimeout(this.timer);
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
