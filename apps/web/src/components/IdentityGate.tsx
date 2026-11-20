// "Is it really you?" A 3-second front-camera check before filming a task (rule.identity), all on the phone.
// First time: she saves her face (kept only on this phone). Every time: show N fingers while looking at the camera.

import { useEffect, useRef, useState } from "react";
import { identityCheck, type IdentityInput } from "@disha/engine";
import { checkIdentity, enrolFace, hasEnrolledFace, openFrontCamera, randomFingers } from "../lib/identity";
import { useT } from "../lib/i18n";
import { Icon } from "./Icon";
import { Button, Pill } from "./ui";

export function IdentityGate({ studentId, onDone }: { studentId: string; onDone: (x: IdentityInput | null) => void }) {
  const { t } = useT();
  const video = useRef<HTMLVideoElement>(null);
  const close = useRef<() => void>(() => {});
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [asked] = useState(randomFingers);
  const [busy, setBusy] = useState<"" | "enrol" | "check">("");
  const [live, setLive] = useState<{ fingers: number; distance: number | null } | null>(null);
  const [result, setResult] = useState<{ input: IdentityInput; status: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void hasEnrolledFace(studentId).then(setEnrolled);
    void openFrontCamera(video.current!).then((c) => { close.current = c; }).catch(() => setError(t("cameraFailed")));
    return () => close.current();
  }, [studentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = (x: IdentityInput | null) => { close.current(); onDone(x); };

  const enrol = async () => {
    setBusy("enrol"); setError("");
    const ok = await enrolFace(studentId, video.current!).catch(() => false);
    setBusy("");
    if (ok) setEnrolled(true); else setError(t("faceNotFound"));
  };
  const check = async () => {
    setBusy("check"); setError("");
    try {
      const input = await checkIdentity(studentId, video.current!, asked, 3500, setLive);
      setResult({ input, status: identityCheck(input).status });
    } catch { setError(t("cameraFailed")); }
    setBusy("");
  };

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <p className="flex items-center gap-2 font-extrabold"><Icon name="scan" className="size-5 text-accent-dark" />{t("isItYou")}</p>
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video ref={video} className="w-full -scale-x-100" />
        {busy === "check" && (
          <span className="absolute left-2 top-2 rounded-md bg-brand-dark/80 px-2 py-1 font-mono text-xs text-white">
            ✋ {live?.fingers ?? 0} · {live?.distance == null ? "—" : live.distance.toFixed(2)}
          </span>
        )}
      </div>
      <p className="flex items-start gap-2 text-xs text-muted"><Icon name="lock" className="mt-0.5 size-4 shrink-0" />{t("faceStaysOnPhone")}</p>
      {enrolled === false && <Button disabled={!!busy} onClick={() => void enrol()}>{busy === "enrol" ? "…" : t("saveMyFace")}</Button>}
      {enrolled && !result && (
        <>
          <p className="text-lg font-bold">{t("showFingers", { n: asked })} <span className="text-3xl" aria-hidden>{["☝️", "✌️", "🤟", "🖖"][asked - 1]}</span></p>
          <Button disabled={!!busy} onClick={() => void check()}>{busy === "check" ? t("holdStill") : t("startCheck")}</Button>
        </>
      )}
      {result && (
        <>
          <Pill tone={result.status === "verified" ? "good" : result.status === "mismatch" ? "bad" : "sun"}>{t(`identity_${result.status}` as "identity_verified")}</Pill>
          <Button onClick={() => finish(result.input)}>{t("continueFilming")} <Icon name="next" className="size-5" /></Button>
          {result.status !== "verified" && <button className="text-sm font-bold text-accent-dark" onClick={() => setResult(null)}>{t("tryAgain")}</button>}
        </>
      )}
      {error && <p className="rounded-lg bg-sun-soft p-2 text-sm text-warn">{error}</p>}
      <button className="text-sm text-muted underline" onClick={() => finish(null)}>{t("skipIdentity")}</button>
    </section>
  );
}
