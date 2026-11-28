# Disha Scoring & Matching Maths Audit

This document records every constant, formula, invariant, and TypeScript/Python parity finding across:
- `packages/engine/src/{tracing,fitreach,irt,readiness,pathways,matcher}.ts`
- `apps/api/app/services/{tracing,fitreach,irt,matcher,raters}.py`

---

## 1. Bayesian Skill Tracing (`tracing.ts` / `tracing.py`)

| Constant | Value | Justification |
| :--- | :--- | :--- |
| `PRIOR` | `[0.4, 0.3, 0.2, 0.1]` | Conservative right-skewed prior across NSQF Levels 1–4; most incoming students start at Level 1 or 2 until evidence proves otherwise. |
| `EVIDENCE_WEIGHTS.self_report` | `0.5` | Spoken/tapped claims only nudge the estimate gently; never enough alone to make a skill "Strong". |
| `EVIDENCE_WEIGHTS.family_report` | `0.75` | Slightly stronger than self-report, still non-performance ("said") evidence. |
| `EVIDENCE_WEIGHTS.endorse` | `2` | Teacher endorsement without a structured rubric; strong contextual signal, non-performance. |
| `EVIDENCE_WEIGHTS.item_group` | `0.7` | One daily adaptive test session on a sub-skill; tempered below `1.0` pending full pilot item calibration. |
| `EVIDENCE_WEIGHTS.task` | `2` | Structured practical task score (`0–1` Gaussian likelihood). |
| `EVIDENCE_WEIGHTS.work_sample_ai` | `3` | AI rubric score (`0–2` per criterion); subject to `raterWeights["ai_vision"]` (floor `0.3`). |
| `EVIDENCE_WEIGHTS.work_sample_teacher` | `4` | Teacher-confirmed work sample; replaces any prior AI score via `undo` tempering. |
| `EVIDENCE_WEIGHTS.rating_level` | `3` | Direct 1–4 level rating by teacher/mentor (`peaked` likelihood `[0.6, 0.25, 0.05]`). |
| `EVIDENCE_WEIGHTS.taster` | `4` | Hands-on taster workshop observation (`peaked` likelihood). |
| `EVIDENCE_WEIGHTS.order_unconfirmed` | `1` | Logged paid job before buyer confirmation (`ORDER_UNCONFIRMED`); replaced upon confirmation. |
| `EVIDENCE_WEIGHTS.order_confirmed` | `2` | Buyer-confirmed paid job (`ORDER_GOOD` / `ORDER_OK` / `ORDER_POOR`). |
| `MAX_CONFIRMED_ORDERS` | `5` | Caps cumulative paid-order weight at 5 orders (`5 × 2 = 10` max total weight) so repeat orders cannot swamp all other evidence. |
| `HALF_LIFE_DAYS.said` | `365` | Self/family claims decay by half after 1 year. |
| `HALF_LIFE_DAYS.shown` | `730` | Demonstrated performance evidence decays by half after 2 years. |
| `LEARN_PER_WEEK` / `LEARN_MAX` | `0.05` / `0.2` | Upward Markov learning drift between events (+5% per week, capped at 20% per gap). |
| `SPREAD_HOP1` / `SPREAD_HOP2` | `0.5` / `0.25` | Graph propagation of flattened ("below L2 vs ≥ L2") performance likelihoods to 1-hop and 2-hop related sub-skills. |
| `STRONG_CONFIDENCE` | `0.8` | Minimum cumulative `P(L >= 3)` required for `strong = true` (alongside `performance = true`). |
| `LEVEL4_CAP_UNPAID` | `0.4` | Caps `P(L = 4)` at `0.4` (`< 0.5`) unless `u.paid = true` (buyer-confirmed order), guaranteeing unpaid evidence never yields Level 4. |
| `TASK_MU` / `WORK_MU` / `SCORE_SD` | `[0.2,0.5,0.8,0.8]` / `[0.15,0.45,0.8,0.8]` / `0.4` | Gaussian centres and SD for continuous `[0,1]` scores; L3 and L4 centres are tied at `0.8` because unpaid tasks/photos cannot distinguish L3 from L4. |
| `applyLeniency` *(new flag)* | `false` *(default)* | Off by default (`APPLY_RATER_LENIENCY=0`). When enabled, shifts rater level by `-clamp(leniency, -1.5, 1.5)` and work-sample scores by `-leniency * 0.25`. |

---

## 2. Adaptive Testing — 2PL IRT (`irt.ts` / `irt.py`)

| Constant | Value | Justification |
| :--- | :--- | :--- |
| `GRID` | `41` points, `[-4.0, +4.0]` step `0.2` | Discrete numerical integration grid for deterministic browser/server parity without quadrature library drift. |
| `prior(mean=0, sd=1.2)` | `N(0, 1.2²)` | Weakly informative normal prior over ability $\theta$. (Aptitude folding uses `prior(0, 1)`.) |
| `STOP_SE` | `0.4` | Stops adaptive test once posterior standard error drops below `0.4`. |
| `MIN_ITEMS` / `MAX_ITEMS` | `3` / `8` | Minimum 3 items for early level-confidence stop; hard cap of 8 items to prevent fatigue on low-end phones. |
| `STOP_LEVEL_CONFIDENCE` | `0.85` | Stops early after `MIN_ITEMS` if any NSQF level band reaches $\ge 85\%$ probability. |
| `TOP_K` / `MAX_RUN` | `3` / `3` | Picks randomly among top-3 most informative items (anti-cheating) and avoids $>3$ consecutive items of the same format. |

---

## 3. Career Matching — Fit, Reach, Worth (`fitreach.ts` / `fitreach.py`)

| Constant | Value | Justification |
| :--- | :--- | :--- |
| `FRW_WEIGHTS` | `{ fit: 0.4, reach: 0.35, worth: 0.25 }` | Balances current capability (`40%`), achievable growth (`35%`), and student interest + local demand (`25%`). Sums to `1.0`. |
| `REACH_PARTS` | `{ aptitude: 0.4, closeness: 0.3, education: 0.3 }` | Combines cognitive/mechanical aptitude, distance to needed skill levels, and education gap. Sums to `1.0`. |
| `WORTH_PARTS` | `{ interest: 0.6, demand: 0.4 }` | Weights RIASEC cosine similarity (`60%`) slightly above local Tamil Nadu demand (`40%`). Sums to `1.0`. |
| `DEMAND` | `{ high: 1.0, medium: 0.7, low: 0.4 }` | Maps TN local demand tier into `[0, 1]`. |
| `UNKNOWN_LEVELS` | `[0.5, 0.3, 0.15, 0.05]` | Unmeasured sub-skill prior (sums to `1.0`), multiplied by `UNKNOWN_CREDIT = 0.5` so untested sub-skills never outrank tested ones. |
| `MET` | `0.6` | A career/opportunity sub-skill requirement counts as met at $\ge 60\%$ probability. |
| `COULD_LEARN_APTITUDE` | `0.65` | Flags "could learn" careers when measured aptitude $\ge 0.65$ despite `fit < 0.5`. |
| `mmrRerank` | `k = 8, λ = 0.7, minSectors = 4` | Maximal Marginal Relevance diversity re-ranker ensuring top-8 recommendations span at least 4 distinct sectors. |

---

## 4. Opportunity Readiness & Aim High Pathways (`readiness.ts`, `pathways.ts`)

| Constant | Value | Justification |
| :--- | :--- | :--- |
| `READY_SHARE` / `ALMOST_SHARE` | `0.8` / `0.5` | $\ge 80\%$ of needed sub-skills met $\rightarrow$ Ready; $\ge 50\%$ $\rightarrow$ Almost; $< 50\%$ or failed hard check $\rightarrow$ Later. |
| `UNKNOWN_CREDIT` (`readiness.ts`) | `0.5` | Matches `fitreach.ts` (`0.5` credit for untested sub-skills). |
| `GROWTH_PER_MONTH` / `MAX_GROWTH_MONTHS` | `0.05` / `24` | Planning heuristic of `+0.05` $\theta$/month up to 24 months for Aim High exam readiness. |
| `PRACTICE_SHARE` / `MASTERED` | `0.2` / `0.85` | Reserves 20% of weekly study time for revision; skips topics with $\ge 85\%$ mastery (`pCorrect(θ, 1.2, b)`). |
| `LEITNER_DAYS` | `[1, 2, 4, 8, 16]` | Exponential spaced-repetition intervals across 5 boxes. |
| Readiness bands (`pathways.ts`) | `≥ 0.7` / `≥ 0.35` | `on_track` ($\ge 0.7$), `building` ($\ge 0.35$), `start` ($< 0.35$). |

---

## 5. Inconsistencies & Findings Between TS and Python

1. **Client-only modules (`readiness.ts`, `pathways.ts`):**
   - `readiness.ts` and `pathways.ts` exist only in TypeScript (`packages/engine/src/`) and have no Python service twins in `apps/api/app/services/`, because opportunity readiness and Aim High study plans execute purely offline on the phone.
2. **Rater Leniency previously unapplied:**
   - `scripts/rater_stats.py` and `apps/api/app/services/raters.py` computed and stored both `agreement` (weighted $\kappa$) and `leniency`, but `apps/api/app/routers/v2.py` (`refresh_state`) only read `agreement` and `tracing.ts`/`tracing.py` did not use `leniency`. Fixed by adding `applyLeniency` (default `false`, controlled by `APPLY_RATER_LENIENCY=0` in `settings.py`) to both TS and Python.
3. **`fitreach` -> `matcher` dependency & duplicate cosine helper:**
   - `fitreach.ts` and `fitreach.py` previously imported `mmrRerank`, `occRiasecVec`, and `studentRiasecVec` from legacy v1 `matcher.ts`/`matcher.py`, and `fitreach.ts` duplicated `cosine` vs `cos`. Unified so `fitreach.ts`/`fitreach.py` own the shared helpers and `matcher.ts`/`matcher.py` import them while preserving all v1 exports and golden tests.
4. **Stale comment in `tracing.ts`:**
   - Line 34 comments `// up to 10 in total` next to `MAX_CONFIRMED_ORDERS = 5` (reflecting the max total weight `5 × 2 = 10`, not 10 orders).
5. **Duplicate `UNKNOWN_CREDIT` constant:**
   - `readiness.ts` defines its own `const UNKNOWN_CREDIT = 0.5` rather than importing it from `fitreach.ts` (values match).
