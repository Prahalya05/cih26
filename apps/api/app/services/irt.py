"""Item response theory on a grid, the adaptive question picker, and ability-to-level conversion.

Same maths as packages/engine/src/irt.ts; golden tests check they agree.
"""
from __future__ import annotations

import math
from typing import Callable

GRID = [-4 + i * 0.2 for i in range(41)]
STOP_SE = 0.4
MAX_ITEMS = 8
TOP_K = 3
MAX_RUN = 3


def p_correct(th: float, a: float, b: float) -> float:
    return 1 / (1 + math.exp(-a * (th - b)))


def _normalise(w: list[float]) -> list[float]:
    s = 0.0
    for x in w:
        s += x
    return [x / s for x in w]


def prior(mean: float = 0, sd: float = 1.2) -> list[float]:
    return _normalise([math.exp(-0.5 * ((g - mean) / sd) ** 2) for g in GRID])


def update(post: list[float], item: dict, correct: bool, weight: float = 1) -> list[float]:
    out = []
    for i, w in enumerate(post):
        p = p_correct(GRID[i], item["a"], item["b"])
        out.append(w * math.pow(p if correct else 1 - p, weight))
    return _normalise(out)


def eap(post: list[float]) -> float:
    m = 0.0
    for i in range(len(GRID)):
        m += post[i] * GRID[i]
    return m


def se(post: list[float]) -> float:
    m = eap(post)
    v = 0.0
    for i in range(len(GRID)):
        v += post[i] * (GRID[i] - m) ** 2
    return math.sqrt(v)


def information(item: dict, th: float) -> float:
    p = p_correct(th, item["a"], item["b"])
    return item["a"] * item["a"] * p * (1 - p)


def seeded_random(seed: int) -> Callable[[], float]:
    """mulberry32, bit for bit the same as seededRandom() in irt.ts."""
    state = [seed & 0xFFFFFFFF]

    def imul(x: int, y: int) -> int:
        return ((x & 0xFFFFFFFF) * (y & 0xFFFFFFFF)) & 0xFFFFFFFF

    def rand() -> float:
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        a = state[0]
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rand


def next_item(post: list[float], bank: list[dict], seen: set[str], rand: Callable[[], float],
              recent_formats: list[str] | None = None) -> dict | None:
    pool = [it for it in bank if it["id"] not in seen]
    if not pool:
        return None
    last = (recent_formats or [])[-MAX_RUN:]
    if len(last) == MAX_RUN and all(f == last[0] for f in last):
        other = [it for it in pool if it.get("format") != last[0]]
        if other:
            pool = other
    th = eap(post)
    ranked = sorted(pool, key=lambda it: (-information(it, th), it["id"]))
    k = min(TOP_K, len(ranked))
    return ranked[math.floor(rand() * k)]


STOP_LEVEL_CONFIDENCE = 0.85
MIN_ITEMS = 3


def should_stop(post: list[float], answered: int, items_left: int, cuts=None) -> bool:
    if se(post) < STOP_SE or answered >= MAX_ITEMS or items_left == 0:
        return True
    return cuts is not None and answered >= MIN_ITEMS and max(level_probs(post, cuts)) >= STOP_LEVEL_CONFIDENCE


def band_of(th: float, cuts) -> int:
    return 0 if th < cuts[0] else 1 if th < cuts[1] else 2 if th < cuts[2] else 3


def level_probs(post: list[float], cuts) -> list[float]:
    out = [0.0, 0.0, 0.0, 0.0]
    for i, g in enumerate(GRID):
        out[band_of(g, cuts)] += post[i]
    return out


def level_likelihood(answers: list[tuple[dict, bool]], cuts, weight: float = 1) -> list[float]:
    base = prior()
    num = [0.0, 0.0, 0.0, 0.0]
    den = [0.0, 0.0, 0.0, 0.0]
    for i, g in enumerate(GRID):
        lik = 1.0
        for item, correct in answers:
            p = p_correct(g, item["a"], item["b"])
            lik *= math.pow(p if correct else 1 - p, weight)
        band = band_of(g, cuts)
        num[band] += base[i] * lik
        den[band] += base[i]
    return [num[L] / den[L] if den[L] > 0 else 0.0 for L in range(4)]
