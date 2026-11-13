// Minimal JsonLogic evaluator with three-valued logic, a copy of apps/api/app/services/jsonlogic.py.
// Supported: var, ==, !=, <, <=, >, >= (incl. 3-arg "between"), and, or, !, in, if.
//
// A fact the student hasn't given yet evaluates to UNKNOWN (unless the rule's var gives a default).
// UNKNOWN spreads through comparisons, but "and" with any definite false is false, and "or" with any
// definite true is true. So a scheme is "need more info" only when the missing facts could change the answer.

import { pyEq, pyTruthy } from "./pymath.ts";

export const UNKNOWN: unique symbol = Symbol("UNKNOWN");

export class Evaluation {
  missing = new Set<string>();
}

const isDict = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function getVar(args: unknown, data: Record<string, unknown>, ev: Evaluation): unknown {
  const name = Array.isArray(args) ? args[0] : args;
  const hasDefault = Array.isArray(args) && args.length > 1;
  let cur: unknown = data;
  for (const part of String(name).split(".")) {
    if (isDict(cur) && Object.hasOwn(cur, part) && cur[part] !== null && cur[part] !== undefined) {
      cur = cur[part];
    } else if (hasDefault) {
      return (args as unknown[])[1];
    } else {
      ev.missing.add(String(name));
      return UNKNOWN;
    }
  }
  return cur;
}

function comparable(a: unknown, b: unknown): boolean {
  const kind = (v: unknown) => (typeof v === "boolean" ? "number" : typeof v);
  return kind(a) === kind(b) && (kind(a) === "number" || kind(a) === "string");
}

function compare(op: string, vals: unknown[]): boolean {
  if (vals.some((v) => v === null || v === undefined)) return false;
  for (let i = 0; i + 1 < vals.length; i++) {
    if (!comparable(vals[i], vals[i + 1])) return false; // Python raises TypeError -> False
  }
  const v = vals as (number | string)[];
  const pairs = (fn: (a: number | string, b: number | string) => boolean) =>
    v.slice(0, -1).every((a, i) => fn(a, v[i + 1]));
  if (op === "<") return pairs((a, b) => a < b);
  if (op === "<=") return pairs((a, b) => a <= b);
  if (op === ">") return v[0] > v[1];
  if (op === ">=") return v[0] >= v[1];
  throw new Error(op);
}

export function apply(rule: unknown, data: Record<string, unknown>, ev: Evaluation = new Evaluation()): unknown {
  if (Array.isArray(rule)) return rule.map((r) => apply(r, data, ev));
  if (!isDict(rule) || Object.keys(rule).length !== 1) return rule;
  const op = Object.keys(rule)[0];
  let args = rule[op];
  if (op === "var") return getVar(args, data, ev);
  if (!Array.isArray(args)) args = [args];
  const list = args as unknown[];

  if (op === "and") {
    let unknown = false;
    let last: unknown = true;
    for (const a of list) {
      const v = apply(a, data, ev);
      if (v === UNKNOWN) unknown = true;
      else if (!pyTruthy(v)) return false;
      else last = v;
    }
    return unknown ? UNKNOWN : last;
  }
  if (op === "or") {
    let unknown = false;
    for (const a of list) {
      const v = apply(a, data, ev);
      if (v === UNKNOWN) unknown = true;
      else if (pyTruthy(v)) return v;
    }
    return unknown ? UNKNOWN : false;
  }
  if (op === "if") {
    for (let i = 0; i < list.length - 1; i += 2) {
      const cond = apply(list[i], data, ev);
      if (cond === UNKNOWN) return UNKNOWN;
      if (pyTruthy(cond)) return apply(list[i + 1], data, ev);
    }
    return list.length % 2 ? apply(list[list.length - 1], data, ev) : null;
  }

  const vals = list.map((a) => apply(a, data, ev));
  if (vals.some((v) => v === UNKNOWN)) return UNKNOWN;
  if (op === "==") return pyEq(vals[0], vals[1]);
  if (op === "!=") return !pyEq(vals[0], vals[1]);
  if (op === "!") return !pyTruthy(vals[0]);
  if (op === "in") {
    const hay = vals[1];
    if (hay === null || hay === undefined) return false;
    if (Array.isArray(hay)) return hay.some((x) => pyEq(vals[0], x));
    if (typeof hay === "string" && typeof vals[0] === "string") return hay.includes(vals[0]);
    return false;
  }
  if (op === "<" || op === "<=" || op === ">" || op === ">=") return compare(op, vals);
  throw new Error(`Unsupported JsonLogic operator: ${op}`);
}
