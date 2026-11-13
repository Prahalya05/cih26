// Small helpers that copy Python's number behaviour, so the phone gives the
// exact same scores and eligibility results as the FastAPI server.

/** Python 3.12+ sum() of floats (Neumaier compensated summation). */
export function pySum(values: Iterable<number>): number {
  let total = 0;
  let c = 0;
  for (const x of values) {
    const t = total + x;
    if (Math.abs(total) >= Math.abs(x)) c += (total - t) + x;
    else c += (x - t) + total;
    total = t;
  }
  return c !== 0 && Number.isFinite(c) ? total + c : total;
}

/** Python round(x, digits): correctly rounded, ties go to the even digit. */
export function pyRound(x: number, digits: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const sign = x < 0 ? -1 : 1;
  // toFixed(100) prints the exact decimal value of the double for the ranges we use.
  const exact = Math.abs(x).toFixed(100);
  const dot = exact.indexOf(".");
  const keep = exact.slice(0, dot + 1 + digits);
  const rest = exact.slice(dot + 1 + digits);
  let roundUp: boolean;
  if (rest[0] > "5") roundUp = true;
  else if (rest[0] < "5") roundUp = false;
  else if (/[1-9]/.test(rest.slice(1))) roundUp = true;
  else {
    const last = Number(keep[keep.length - 1]);
    roundUp = last % 2 === 1; // exact tie: round half to even
  }
  const step = 10 ** -digits;
  let result = Number(keep);
  if (roundUp) result = Number((result + step).toFixed(digits));
  return sign * result;
}

/** Python truthiness: empty list, empty string, 0, null are false. */
export function pyTruthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v !== null && typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

/** Python ==: True == 1, otherwise strict equality (lists compared by value). */
export function pyEq(a: unknown, b: unknown): boolean {
  const numLike = (v: unknown) => typeof v === "number" || typeof v === "boolean";
  if (numLike(a) && numLike(b)) return Number(a) === Number(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => pyEq(x, b[i]));
  }
  return a === b;
}
