import { useEffect, useState } from "react";
import { LangContext, type LangCode } from "./lib/i18n";
import { stopSpeaking } from "./lib/speech";
import { syncNow } from "./lib/sync";
import Home from "./screens/Home";
import NewStudent from "./screens/NewStudent";
import Consent from "./screens/Consent";
import Cards from "./screens/Cards";
import Questions from "./screens/Questions";
import FactsScreen from "./screens/Facts";
import Results from "./screens/Results";
import CareerDetail from "./screens/CareerDetail";
import Teacher from "./screens/Teacher";
import Assess from "./screens/Assess";
import Game from "./screens/Game";
import WorkSample from "./screens/WorkSample";
import Order from "./screens/Order";
import Rate from "./screens/Rate";
import ConfirmJob from "./screens/ConfirmJob";
import Privacy from "./screens/Privacy";
import { scorePending } from "./lib/samples";

export type Route =
  | { name: "home" }
  | { name: "new" }
  | { name: "consent"; id: string }
  | { name: "cards"; id: string }
  | { name: "questions"; id: string }
  | { name: "facts"; id: string }
  | { name: "results"; id: string; tab?: "strengths" | "careers" | "schemes" }
  | { name: "career"; id: string; occ: string }
  | { name: "teacher" }
  | { name: "assess"; id: string; subskill: string }
  | { name: "game"; id: string; domain: string }
  | { name: "sample"; id: string; rubric: string }
  | { name: "order"; id: string }
  | { name: "rate"; id: string; mode: "taster" | "term" }
  | { name: "privacy"; id: string };

export type Go = (r: Route) => void;

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "home" });
  // A buyer opening a job-confirmation link (?confirm=token) sees only that page.
  const [confirmToken, setConfirmToken] = useState(() => new URLSearchParams(location.search).get("confirm"));
  const [lang, setLangState] = useState<LangCode>(() => (read("disha.lang") as LangCode) || "ta");

  const setLang = (l: LangCode) => {
    setLangState(l);
    write("disha.lang", l);
    document.documentElement.lang = l;
  };

  const go: Go = (r) => {
    stopSpeaking();
    setRoute(r);
    window.scrollTo(0, 0);
  };

  // Sync whenever we come online, and every 30 s while online.
  useEffect(() => {
    const run = () => void syncNow().then(() => scorePending());
    run();
    const onOnline = () => run();
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => navigator.onLine && run(), 30_000);
    return () => { window.removeEventListener("online", onOnline); window.clearInterval(timer); };
  }, []);

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {confirmToken && <ConfirmJob token={confirmToken} onClose={() => { history.replaceState(null, "", "/"); setConfirmToken(null); }} />}
      {!confirmToken && route.name === "home" && <Home go={go} />}
      {route.name === "new" && <NewStudent go={go} />}
      {route.name === "consent" && <Consent go={go} id={route.id} />}
      {route.name === "cards" && <Cards go={go} id={route.id} />}
      {route.name === "questions" && <Questions go={go} id={route.id} />}
      {route.name === "facts" && <FactsScreen go={go} id={route.id} />}
      {route.name === "results" && <Results go={go} id={route.id} tab={route.tab ?? "strengths"} />}
      {route.name === "career" && <CareerDetail go={go} id={route.id} occ={route.occ} />}
      {route.name === "teacher" && <Teacher go={go} />}
      {route.name === "assess" && <Assess go={go} id={route.id} subskill={route.subskill} />}
      {route.name === "game" && <Game go={go} id={route.id} domain={route.domain} />}
      {route.name === "sample" && <WorkSample go={go} id={route.id} rubric={route.rubric} />}
      {route.name === "order" && <Order go={go} id={route.id} />}
      {route.name === "rate" && <Rate go={go} id={route.id} mode={route.mode} />}
      {route.name === "privacy" && <Privacy go={go} id={route.id} />}
    </LangContext.Provider>
  );
}
