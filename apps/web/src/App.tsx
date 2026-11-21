import { lazy, Suspense, useEffect, useState } from "react";
import { LangContext, type LangCode } from "./lib/i18n";
import { stopSpeaking } from "./lib/speech";
import { syncNow } from "./lib/sync";
import { refreshSchemes } from "./lib/schemes";
import { refreshPostings } from "./lib/postings";
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
import Order from "./screens/Order";
import Rate from "./screens/Rate";
import ConfirmJob from "./screens/ConfirmJob";
import Privacy from "./screens/Privacy";
import { scorePending } from "./lib/samples";
import Situation from "./screens/Situation";
import Talk from "./screens/Talk";
import { setXrayOn, xrayInitiallyOn } from "./lib/xray";
import { useAccount } from "./lib/auth";
import SignIn from "./screens/SignIn";
import { BottomNav } from "./components/BottomNav";

// Camera (MediaPipe), zero-knowledge and chain code load only when these screens open, so the everyday
// student flow stays small on low-end phones.
const WorkSample = lazy(() => import("./screens/WorkSample"));
const Proof = lazy(() => import("./screens/Proof"));
const Funder = lazy(() => import("./screens/Funder"));
// Aim High screens (higher-study routes, readiness checks, practice).
const AimTrack = lazy(() => import("./screens/AimTrack"));
const AimQuiz = lazy(() => import("./screens/AimQuiz"));
// Decision X-ray panel, "How Disha decides" and the per-student map (graph).
const XRay = lazy(() => import("./components/XRay"));
const HowItDecides = lazy(() => import("./screens/HowItDecides"));
const GraphScreen = lazy(() => import("./screens/Graph"));
// Accounts, jobs, resumes and documents.
const Account = lazy(() => import("./screens/Account"));
const Jobs = lazy(() => import("./screens/Jobs"));
const Resume = lazy(() => import("./screens/Resume"));
const Docs = lazy(() => import("./screens/Docs"));
// Teacher courses, profiles and "who does what".
const Courses = lazy(() => import("./screens/Courses"));
const CourseScreen = lazy(() => import("./screens/Course"));
const CourseBuilder = lazy(() => import("./screens/CourseBuilder"));
const TeacherCourses = lazy(() => import("./screens/TeacherCourses"));
const TeacherProfile = lazy(() => import("./screens/TeacherProfile"));
const StudentProfile = lazy(() => import("./screens/StudentProfile"));
const Roles = lazy(() => import("./screens/Roles"));
// Online classrooms: teachers make them, students ask to join.
const FindClass = lazy(() => import("./screens/FindClass"));
const Classrooms = lazy(() => import("./screens/Classrooms"));
const ReviewTeachers = lazy(() => import("./screens/ReviewTeachers"));

export type Route =
  | { name: "home" }
  | { name: "new" }
  | { name: "situation"; id: string }
  | { name: "talk"; id: string }
  | { name: "how"; from?: Route }
  | { name: "graph"; id: string; from?: Route }
  | { name: "consent"; id: string }
  | { name: "cards"; id: string }
  | { name: "questions"; id: string }
  | { name: "facts"; id: string }
  | { name: "results"; id: string; tab?: "strengths" | "careers" | "schemes" | "opps" | "map" | "aim" }
  | { name: "career"; id: string; occ: string }
  | { name: "teacher" }
  | { name: "assess"; id: string; subskill: string }
  | { name: "game"; id: string; domain: string }
  | { name: "sample"; id: string; rubric: string }
  | { name: "order"; id: string }
  | { name: "rate"; id: string; mode: "taster" | "term" }
  | { name: "privacy"; id: string }
  | { name: "proof"; id: string }
  | { name: "funder" }
  | { name: "aimTrack"; id: string; track: string }
  | { name: "aimQuiz"; id: string; subject: string; mode: "check" | "practice"; track?: string }
  | { name: "account" }
  | { name: "jobs" }
  | { name: "resume"; id: string }
  | { name: "docs"; id: string }
  | { name: "courses" }
  | { name: "course"; courseId: string }
  | { name: "courseBuilder"; courseId?: string }
  | { name: "teacherCourses" }
  | { name: "teacherProfile"; teacherId?: string }
  | { name: "studentProfile"; id: string }
  | { name: "roles" }
  | { name: "findClass" }
  | { name: "classrooms" };

export type Go = (r: Route) => void;

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export default function App() {
  // ?funder opens the funder dashboard directly (for a second screen in the demo).
  const [route, setRoute] = useState<Route>(() => (new URLSearchParams(location.search).has("funder") ? { name: "funder" } : { name: "home" }));
  // A buyer opening a job-confirmation link (?confirm=token) sees only that page.
  const [confirmToken, setConfirmToken] = useState(() => new URLSearchParams(location.search).get("confirm"));
  // A Disha reviewer opening ?review checks online teachers' proofs (needs the admin token, not a sign-in).
  const [reviewing, setReviewing] = useState(() => new URLSearchParams(location.search).has("review"));
  const [lang, setLangState] = useState<LangCode>(() => (read("disha.lang") as LangCode) || "ta");
  // Decision X-ray: ?xray=1 (or holding the logo) shows every decision as RULE / AI live, for demos.
  const [xray, setXray] = useState(xrayInitiallyOn);
  useEffect(() => {
    const toggle = () => setXray((on) => { setXrayOn(!on); return !on; });
    window.addEventListener("disha:xray-toggle", toggle);
    return () => window.removeEventListener("disha:xray-toggle", toggle);
  }, []);

  const setLang = (l: LangCode) => {
    setLangState(l);
    write("disha.lang", l);
    document.documentElement.lang = l;
  };

  const account = useAccount();
  // After sign-in (or on opening the app), each role starts on its own home.
  useEffect(() => {
    if (!account) return;
    setRoute((r) => (r.name !== "home" ? r : account.role === "teacher" ? { name: "teacher" } : account.role === "funder" ? { name: "funder" }
      : account.role === "employer" ? { name: "jobs" } : r));
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const go: Go = (r) => {
    stopSpeaking();
    setRoute(r);
    window.scrollTo(0, 0);
  };

  // Components deep in a screen can ask to open another screen (e.g. resume, documents) without prop drilling.
  useEffect(() => {
    const onGo = (e: Event) => go((e as CustomEvent<Route>).detail);
    window.addEventListener("disha:go", onGo);
    return () => window.removeEventListener("disha:go", onGo);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync whenever we come online, and every 30 s while online.
  useEffect(() => {
    const run = () => { void syncNow().then(() => scorePending()); void refreshSchemes(); void refreshPostings(); };
    run();
    const onOnline = () => run();
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => navigator.onLine && run(), 30_000);
    return () => { window.removeEventListener("online", onOnline); window.clearInterval(timer); };
  }, []);

  if (reviewing) {
    return (
      <LangContext.Provider value={{ lang, setLang }}>
        <Suspense fallback={<p className="p-6 text-center text-muted">…</p>}>
          <ReviewTeachers onClose={() => { history.replaceState(null, "", "/"); setReviewing(false); }} />
        </Suspense>
      </LangContext.Provider>
    );
  }

  // Signed out: only the sign-in screen, the buyer's confirmation link and "How Disha decides" are open.
  const signedOut = account === null && !confirmToken;
  if (account === undefined && !confirmToken) return null;
  if (signedOut && route.name !== "how") {
    return (
      <LangContext.Provider value={{ lang, setLang }}>
        <SignIn onExplore={() => go({ name: "how" })} />
      </LangContext.Provider>
    );
  }

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      <div className={`${xray ? "lg:pr-[440px]" : ""} ${account && !confirmToken ? "pb-20" : ""}`}>
      {confirmToken && <ConfirmJob token={confirmToken} onClose={() => { history.replaceState(null, "", "/"); setConfirmToken(null); }} />}
      {!confirmToken && route.name === "home" && <Home go={go} />}
      {route.name === "new" && <NewStudent go={go} />}
      {route.name === "situation" && <Situation go={go} id={route.id} />}
      {route.name === "talk" && <Talk go={go} id={route.id} />}
      {route.name === "consent" && <Consent go={go} id={route.id} />}
      {route.name === "cards" && <Cards go={go} id={route.id} />}
      {route.name === "questions" && <Questions go={go} id={route.id} />}
      {route.name === "facts" && <FactsScreen go={go} id={route.id} />}
      {route.name === "results" && <Results go={go} id={route.id} tab={route.tab ?? "strengths"} />}
      {route.name === "career" && <CareerDetail go={go} id={route.id} occ={route.occ} />}
      {route.name === "teacher" && <Teacher go={go} />}
      {route.name === "assess" && <Assess go={go} id={route.id} subskill={route.subskill} />}
      {route.name === "game" && <Game go={go} id={route.id} domain={route.domain} />}
      <Suspense fallback={<p className="p-6 text-center text-muted">…</p>}>
        {route.name === "sample" && <WorkSample go={go} id={route.id} rubric={route.rubric} />}
        {route.name === "proof" && <Proof go={go} id={route.id} />}
        {route.name === "funder" && <Funder go={go} />}
        {route.name === "aimTrack" && <AimTrack go={go} id={route.id} track={route.track} />}
        {route.name === "how" && <HowItDecides go={go} back={route.from ? () => go(route.from!) : signedOut ? () => go({ name: "home" }) : undefined} />}
        {route.name === "account" && <Account go={go} />}
        {route.name === "jobs" && <Jobs go={go} />}
        {route.name === "resume" && <Resume go={go} id={route.id} />}
        {route.name === "docs" && <Docs go={go} id={route.id} />}
        {route.name === "courses" && <Courses go={go} />}
        {route.name === "course" && <CourseScreen key={route.courseId} go={go} courseId={route.courseId} />}
        {route.name === "courseBuilder" && <CourseBuilder key={route.courseId ?? "new"} go={go} courseId={route.courseId} />}
        {route.name === "teacherCourses" && <TeacherCourses go={go} />}
        {route.name === "teacherProfile" && <TeacherProfile key={route.teacherId ?? "me"} go={go} teacherId={route.teacherId} />}
        {route.name === "studentProfile" && <StudentProfile go={go} id={route.id} />}
        {route.name === "roles" && <Roles go={go} />}
        {route.name === "findClass" && <FindClass go={go} />}
        {route.name === "classrooms" && <Classrooms go={go} />}
        {route.name === "graph" && <GraphScreen go={go} id={route.id} back={route.from ? () => go(route.from!) : undefined} />}
        {route.name === "aimQuiz" && <AimQuiz key={`${route.subject}|${route.mode}`} go={go} id={route.id} subject={route.subject} mode={route.mode} track={route.track} />}
      </Suspense>
      {route.name === "order" && <Order go={go} id={route.id} />}
      {route.name === "rate" && <Rate go={go} id={route.id} mode={route.mode} />}
      {route.name === "privacy" && <Privacy go={go} id={route.id} />}
      </div>
      {account && !confirmToken && <BottomNav account={account} route={route} go={go} />}
      {xray && (
        <Suspense fallback={null}>
          <XRay onClose={() => { setXray(false); setXrayOn(false); }} onHow={() => go({ name: "how", from: route })} />
        </Suspense>
      )}
    </LangContext.Provider>
  );
}
