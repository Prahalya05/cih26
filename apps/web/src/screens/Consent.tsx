import type { Go } from "../App";
import { Button, Screen, SpeakButton, useLive } from "../components/ui";
import { db, patchStudent } from "../lib/db";
import { useT } from "../lib/i18n";

export default function Consent({ go, id }: { go: Go; id: string }) {
  const { t } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined);
  if (!student) return null;

  const agree = async () => {
    await patchStudent(id, (s) => ({ ...s, consent: { at: Date.now() } }));
    go({ name: "cards", id });
  };

  return (
    <Screen title={t("consentTitle")} onBack={() => go({ name: "home" })}>
      <div className="flex flex-col items-center gap-3 pt-4 text-center">
        <span className="text-7xl">👨‍👩‍👧</span>
        <h2 className="text-2xl font-bold">{t("consentTitle")}</h2>
      </div>
      <div className="flex items-start gap-3 rounded-3xl bg-white p-5 shadow-sm">
        <p className="flex-1 text-lg leading-relaxed">{t("consentBody")}</p>
        <SpeakButton text={t("consentBody")} audioKey="consent" />
      </div>
      <Button className="mt-auto" onClick={agree}>✅ {t("consentAgree")}</Button>
    </Screen>
  );
}
