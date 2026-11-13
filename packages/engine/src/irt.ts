// Item response theory on a fixed grid of ability values, the adaptive question picker,
// and ability-to-level conversion. Keep in step with apps/api/app/services/irt.py.

export const GRID: number[] = Array.from({ length: 41 }, (_, i) => -4 + i * 0.2);

export interface ItemParams {
  id: string;
  a: number; // discrimination
  b: number; // difficulty
  format?: string;
}

/** Chance of a correct answer at ability th (2-parameter logistic model). */
export const pCorrect = (th: number, a: number, b: number): number => 1 / (1 + Math.exp(-a * (th - b)));

const normalise = (w: number[]): number[] => {
  let s = 0;
  for (const x of w) s += x;
  return w.map((x) => x / s);
};

/** Normal prior over the grid. */
export function prior(mean = 0, sd = 1.2): number[] {
  return normalise(GRID.map((g) => Math.exp(-0.5 * ((g - mean) / sd) ** 2)));
}

/** Posterior after one answer. */
export function update(post: number[], item: ItemParams, correct: boolean, weight = 1): number[] {
  return normalise(post.map((w, i) => {
    const p = pCorrect(GRID[i], item.a, item.b);
    return w * Math.pow(correct ? p : 1 - p, weight);
  }));
}

/** Expected ability. */
export function eap(post: number[]): number {
  let m = 0;
  for (let i = 0; i < GRID.length; i++) m += post[i] * GRID[i];
  return m;
}

/** Standard error of the ability estimate. */
export function se(post: number[]): number {
  const m = eap(post);
  let v = 0;
  for (let i = 0; i < GRID.length; i++) v += post[i] * (GRID[i] - m) ** 2;
  return Math.sqrt(v);
}

/** How much an item tells us at ability th. */
export function information(item: ItemParams, th: number): number {
  const p = pCorrect(th, item.a, item.b);
  return item.a * item.a * p * (1 - p);
}

// ---------- adaptive picker ----------

/** Small seeded random number generator (mulberry32), so test sessions repeat exactly. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const STOP_SE = 0.4;
export const MAX_ITEMS = 8;
const TOP_K = 3;      // pick at random among the 3 most informative, so friends can't share answers
const MAX_RUN = 3;    // no more than 3 questions in a row of the same format

/**
 * The next question: among unseen items, the most informative at the current ability estimate,
 * chosen at random from the top 3. Returns null if none are left.
 * recentFormats: formats of the questions already asked, oldest first.
 */
export function nextItem(post: number[], bank: ItemParams[], seen: Set<string>, rand: () => number,
  recentFormats: string[] = []): ItemParams | null {
  let pool = bank.filter((it) => !seen.has(it.id));
  if (pool.length === 0) return null;
  const last = recentFormats.slice(-MAX_RUN);
  if (last.length === MAX_RUN && last.every((f) => f === last[0])) {
    const other = pool.filter((it) => it.format !== last[0]);
    if (other.length) pool = other;
  }
  const th = eap(post);
  const ranked = pool
    .map((it) => ({ it, info: information(it, th) }))
    .sort((x, y) => y.info - x.info || (x.it.id < y.it.id ? -1 : x.it.id > y.it.id ? 1 : 0));
  const k = Math.min(TOP_K, ranked.length);
  return ranked[Math.floor(rand() * k)].it;
}

export const STOP_LEVEL_CONFIDENCE = 0.85;
export const MIN_ITEMS = 3;

/**
 * Stop when the ability is precise (SE < 0.4), or, given the sub-skill's cut-points, when one level is
 * 85% likely after at least 3 answers (we only need her level, not an exact score), or after 8 answers.
 */
export function shouldStop(post: number[], answered: number, itemsLeft: number, cuts?: readonly number[]): boolean {
  if (se(post) < STOP_SE || answered >= MAX_ITEMS || itemsLeft === 0) return true;
  return !!cuts && answered >= MIN_ITEMS && Math.max(...levelProbs(post, cuts)) >= STOP_LEVEL_CONFIDENCE;
}

// ---------- levels ----------

/** Splits the ability posterior into chances of levels 1-4, using a sub-skill's three cut-points. */
export function levelProbs(post: number[], cuts: readonly number[]): number[] {
  const out = [0, 0, 0, 0];
  for (let i = 0; i < GRID.length; i++) out[bandOf(GRID[i], cuts)] += post[i];
  return out;
}

export function bandOf(th: number, cuts: readonly number[]): number {
  return th < cuts[0] ? 0 : th < cuts[1] ? 1 : th < cuts[2] ? 2 : 3;
}

/**
 * Likelihood of a set of answers at each level: the average chance of these answers over the
 * abilities inside each level's band (weighted by the standard prior). Used to fold test answers
 * into the four-level skill state alongside every other kind of evidence.
 */
export function levelLikelihood(answers: { item: ItemParams; correct: boolean }[],
  cuts: readonly number[], weight = 1): number[] {
  const base = prior();
  const num = [0, 0, 0, 0];
  const den = [0, 0, 0, 0];
  for (let i = 0; i < GRID.length; i++) {
    let lik = 1;
    for (const { item, correct } of answers) {
      const p = pCorrect(GRID[i], item.a, item.b);
      lik *= Math.pow(correct ? p : 1 - p, weight);
    }
    const band = bandOf(GRID[i], cuts);
    num[band] += base[i] * lik;
    den[band] += base[i];
  }
  return num.map((x, L) => (den[L] > 0 ? x / den[L] : 0));
}
