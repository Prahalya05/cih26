"""Minimal JsonLogic evaluator (subset) with three-valued logic, mirrored in packages/engine/src/jsonlogic.ts.

Supported: var, ==, !=, <, <=, >, >= (incl. 3-arg "between"), and, or, !, in, if.

A fact the student hasn't given yet evaluates to UNKNOWN (unless the rule's var gives a default).
UNKNOWN spreads through comparisons, but "and" with any definite False is False, and "or" with any
definite True is True. So a scheme is "need more info" only when the missing facts could change the answer.
"""
from __future__ import annotations

from typing import Any


class _Unknown:
    def __repr__(self) -> str:
        return "UNKNOWN"


UNKNOWN: Any = _Unknown()


class Evaluation:
    def __init__(self) -> None:
        self.missing: set[str] = set()


def _var(args: Any, data: dict, ev: Evaluation) -> Any:
    name = args[0] if isinstance(args, list) else args
    has_default = isinstance(args, list) and len(args) > 1
    cur: Any = data
    for part in str(name).split("."):
        if isinstance(cur, dict) and part in cur and cur[part] is not None:
            cur = cur[part]
        elif has_default:
            return args[1]
        else:
            ev.missing.add(str(name))
            return UNKNOWN
    return cur


def _cmp(op: str, vals: list) -> bool:
    if any(v is None for v in vals):
        return False
    try:
        if op == "<":
            return all(a < b for a, b in zip(vals, vals[1:]))
        if op == "<=":
            return all(a <= b for a, b in zip(vals, vals[1:]))
        if op == ">":
            return vals[0] > vals[1]
        if op == ">=":
            return vals[0] >= vals[1]
    except TypeError:
        return False
    raise ValueError(op)


def apply(rule: Any, data: dict, ev: Evaluation | None = None) -> Any:
    ev = ev or Evaluation()
    if isinstance(rule, list):
        return [apply(r, data, ev) for r in rule]
    if not isinstance(rule, dict) or len(rule) != 1:
        return rule
    op, args = next(iter(rule.items()))
    if op == "var":
        return _var(args, data, ev)
    if not isinstance(args, list):
        args = [args]
    if op == "and":
        unknown, last = False, True
        for a in args:
            v = apply(a, data, ev)
            if v is UNKNOWN:
                unknown = True
            elif not v:
                return False
            else:
                last = v
        return UNKNOWN if unknown else last
    if op == "or":
        unknown = False
        for a in args:
            v = apply(a, data, ev)
            if v is UNKNOWN:
                unknown = True
            elif v:
                return v
        return UNKNOWN if unknown else False
    if op == "if":
        for i in range(0, len(args) - 1, 2):
            cond = apply(args[i], data, ev)
            if cond is UNKNOWN:
                return UNKNOWN
            if cond:
                return apply(args[i + 1], data, ev)
        return apply(args[-1], data, ev) if len(args) % 2 else None
    vals = [apply(a, data, ev) for a in args]
    if any(v is UNKNOWN for v in vals):
        return UNKNOWN
    if op == "==":
        return vals[0] == vals[1]
    if op == "!=":
        return vals[0] != vals[1]
    if op == "!":
        return not vals[0]
    if op == "in":
        return vals[1] is not None and vals[0] in vals[1]
    if op in ("<", "<=", ">", ">="):
        return _cmp(op, vals)
    raise ValueError(f"Unsupported JsonLogic operator: {op}")
