"""Generates the aptitude game question banks: packages/kb/items/aptitude_*.json.

Puzzles are described as data (gear sizes, lever weights, grid shapes) and drawn by the app as SVG,
so no picture files are needed. Difficulty values (b) are team estimates from puzzle features;
recalibrate them from pilot answers (scripts/calibrate.py, Step 12.4).

    python scripts/gen_aptitude.py
"""
from __future__ import annotations

import json
import random
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "packages" / "kb" / "items"


def L(en: str, ta: str) -> dict:
    return {"en": en, "ta": ta}


def item(iid, domain, fmt, b, prompt, options, answer, figure=None, a=1.2):
    it = {"id": iid, "domain": domain, "format": fmt, "prompt": prompt, "options": options, "answer": answer,
          "b": round(b, 2), "a": a, "b_source": "feature_estimate", "reviewed": False, "author": "generator"}
    if figure:
        it["figure"] = figure
    return it


# ---------------- mechanical: gears and levers ----------------

CW = {"id": "cw", **L("Clockwise ↻", "கடிகார திசை ↻")}
CCW = {"id": "ccw", **L("Anticlockwise ↺", "எதிர் கடிகார திசை ↺")}


def mechanical(rng: random.Random) -> list[dict]:
    out = []
    for n in range(2, 8):  # gear chains: each gear turns the opposite way to the one before
        sizes = [rng.choice([18, 22, 26, 30]) for _ in range(n)]
        answer = "cw" if n % 2 == 1 else "ccw"
        out.append(item(f"apt_mech_chain{n}", "apt_mechanical", "choice", -1.6 + 0.45 * (n - 2),
                        L("The first gear turns clockwise ↻. Which way does the last gear turn?",
                          "முதல் பல்சக்கரம் கடிகார திசையில் ↻ சுழல்கிறது. கடைசி பல்சக்கரம் எந்தத் திசையில் சுழலும்?"),
                        [CW, CCW], answer, {"type": "gears", "sizes": sizes, "first": "cw", "ask": "last"}))
    for k, sizes in enumerate([[30, 18], [20, 30, 24], [28, 16, 22], [24, 30, 18, 26], [22, 26, 30, 16, 28]]):
        letters = "ABCDE"[: len(sizes)]
        fastest = letters[sizes.index(min(sizes))]
        out.append(item(f"apt_mech_fast{k}", "apt_mechanical", "choice", -0.6 + 0.4 * k,
                        L("These gears turn together. Which gear turns fastest?",
                          "இந்தப் பல்சக்கரங்கள் சேர்ந்து சுழல்கின்றன. எந்தப் பல்சக்கரம் மிக வேகமாகச் சுழலும்?"),
                        [{"id": x, **L(f"Gear {x}", f"பல்சக்கரம் {x}")} for x in letters], fastest,
                        {"type": "gears", "sizes": sizes, "labels": True}))
    levers = [  # (left weight, left distance, right weight, right distance, difficulty)
        (3, 2, 1, 2, -1.5), (2, 3, 2, 1, -1.0), (1, 4, 2, 2, 0.2), (2, 2, 1, 4, 0.3), (3, 1, 1, 4, 0.8),
        (1, 4, 3, 1, 0.9), (4, 1, 1, 3, 1.1), (2, 3, 3, 2, 0.6), (1, 3, 2, 1, 1.3), (3, 2, 2, 4, 1.5),
    ]
    for k, (wl, dl, wr, dr, b) in enumerate(levers):
        tl, tr = wl * dl, wr * dr
        ans = "left" if tl > tr else "right" if tr > tl else "equal"
        out.append(item(f"apt_mech_lever{k}", "apt_mechanical", "choice", b,
                        L("Which side of the seesaw goes down?", "சீசாவின் எந்தப் பக்கம் கீழே இறங்கும்?"),
                        [{"id": "left", **L("Left", "இடது")}, {"id": "right", **L("Right", "வலது")},
                         {"id": "equal", **L("Neither, it balances", "இரண்டும் இல்லை, சமநிலையில் இருக்கும்")}],
                        ans, {"type": "lever", "left": [wl, dl], "right": [wr, dr]}))
    return out


# ---------------- spatial: same shape turned, or a mirror? ----------------

SHAPES = {
    4: [[(0, 0), (0, 1), (0, 2), (1, 2)], [(0, 0), (1, 0), (1, 1), (2, 1)]],
    5: [[(1, 0), (2, 0), (0, 1), (1, 1), (1, 2)], [(0, 0), (0, 1), (0, 2), (0, 3), (1, 1)], [(0, 0), (1, 0), (1, 1), (1, 2), (2, 2)],
        [(0, 0), (0, 1), (1, 1), (1, 2), (1, 3)]],
    6: [[(0, 0), (1, 0), (1, 1), (2, 1), (2, 2), (3, 2)], [(0, 0), (0, 1), (1, 1), (2, 1), (2, 2), (2, 3)],
        [(0, 0), (1, 0), (2, 0), (2, 1), (3, 1), (1, 2)]],
    7: [[(0, 0), (1, 0), (1, 1), (1, 2), (2, 2), (3, 2), (3, 3)], [(0, 1), (1, 1), (1, 0), (2, 0), (2, 1), (2, 2), (3, 2)]],
}


def norm(cells):
    mx, my = min(x for x, _ in cells), min(y for _, y in cells)
    return sorted((x - mx, y - my) for x, y in cells)


def rot(cells, times):
    for _ in range(times % 4):
        cells = [(y, -x) for x, y in cells]
    return norm(cells)


def mirror(cells):
    return norm([(-x, y) for x, y in cells])


def spatial(rng: random.Random) -> list[dict]:
    out = []
    k = 0
    for size, shapes in SHAPES.items():
        for base in shapes:
            base = norm(base)
            if any(mirror(base) == rot(base, t) for t in range(4)):
                continue  # symmetric shapes cannot be told from their mirror
            for turn in (1, 2, 3):
                if k >= 20:
                    break
                right = rot(base, turn)
                if right == base:
                    continue  # this turn leaves the shape looking unchanged: too easy
                mirrored = []
                for t in range(4):  # distinct turns of the mirror image (some shapes repeat after half a turn)
                    m = rot(mirror(base), t)
                    if m not in mirrored:
                        mirrored.append(m)
                wrong = rng.sample(mirrored, 2)
                opts = [{"id": "a", "cells": right}, {"id": "b", "cells": wrong[0]}, {"id": "c", "cells": wrong[1]}]
                b = -1.4 + 0.45 * (size - 4) + (0.35 if turn == 2 else 0.6 if turn == 3 else 0)
                out.append(item(f"apt_spat_{k:02d}", "apt_spatial", "choice", b,
                                L("Which one is the same shape, only turned?", "எது அதே வடிவம், திருப்பப்பட்டது மட்டும்?"),
                                [{**o, **L("", "")} for o in opts], "a", {"type": "shape", "cells": base}))
                k += 1
    return out


# ---------------- numeric: number sense ----------------

def numeric() -> list[dict]:
    def ch(iid, b, en, ta, opts, ans):
        return item(iid, "apt_numeric", "choice", b, L(en, ta), [{"id": str(i), **L(o, o)} for i, o in enumerate(opts)], str(ans))
    return [
        ch("apt_num_00", -1.8, "What comes next? 2, 4, 6, 8, …", "அடுத்து வருவது என்ன? 2, 4, 6, 8, …", ["9", "10", "12"], 1),
        ch("apt_num_01", -1.2, "Which is bigger?", "எது பெரியது?", ["0.5", "0.45", "0.405"], 0),
        ch("apt_num_02", -0.9, "What comes next? 3, 6, 12, 24, …", "அடுத்து வருவது என்ன? 3, 6, 12, 24, …", ["36", "48", "30"], 1),
        ch("apt_num_03", -0.6, "Which is closest to 49 × 21?", "49 × 21 க்கு மிக அருகில் உள்ளது எது?", ["100", "1,000", "10,000"], 1),
        ch("apt_num_04", -0.4, "Which is more: 3/4 or 2/3?", "எது அதிகம்: 3/4 அல்லது 2/3?", ["3/4", "2/3", "Same"], 0),
        ch("apt_num_05", -0.2, "What comes next? 1, 4, 9, 16, …", "அடுத்து வருவது என்ன? 1, 4, 9, 16, …", ["20", "25", "32"], 1),
        ch("apt_num_06", 0.0, "Which is cheaper per kilo: 2 kg for ₹90, or 5 kg for ₹200?", "கிலோவுக்கு எது மலிவு: 2 கிலோ ₹90, அல்லது 5 கிலோ ₹200?",
           ["2 kg for ₹90", "5 kg for ₹200", "Same"], 1),
        ch("apt_num_07", 0.2, "Half of a half is…", "பாதியின் பாதி…", ["1/4", "1/3", "1"], 0),
        ch("apt_num_08", 0.4, "What comes next? 5, 8, 12, 17, …", "அடுத்து வருவது என்ன? 5, 8, 12, 17, …", ["21", "22", "23"], 2),
        ch("apt_num_09", 0.5, "10% of 350 is…", "350 இல் 10%…", ["3.5", "35", "350"], 1),
        ch("apt_num_10", 0.7, "A bus leaves every 15 minutes from 7:00. When is the 5th bus?", "7:00 முதல் ஒவ்வொரு 15 நிமிடத்துக்கும் ஒரு பேருந்து. 5வது பேருந்து எப்போது?",
           ["8:00", "8:15", "7:45"], 0),
        ch("apt_num_11", 0.8, "Which is bigger: 0.7 or 2/3?", "எது பெரியது: 0.7 அல்லது 2/3?", ["0.7", "2/3", "Same"], 0),
        ch("apt_num_12", 1.0, "What comes next? 2, 3, 5, 8, 13, …", "அடுத்து வருவது என்ன? 2, 3, 5, 8, 13, …", ["18", "21", "26"], 1),
        ch("apt_num_13", 1.1, "3 workers finish a job in 4 days. How long for 6 workers?", "3 பேர் ஒரு வேலையை 4 நாட்களில் முடிக்கிறார்கள். 6 பேருக்கு எத்தனை நாட்கள்?",
           ["2 days", "8 days", "6 days"], 0),
        ch("apt_num_14", 1.3, "A price goes up 10%, then down 10%. Compared with the start it is…", "ஒரு விலை 10% உயர்ந்து, பின் 10% குறைகிறது. தொடக்கத்தைவிட அது…",
           ["Lower", "The same", "Higher"], 0),
        ch("apt_num_15", 1.5, "What comes next? 1, 2, 6, 24, …", "அடுத்து வருவது என்ன? 1, 2, 6, 24, …", ["48", "96", "120"], 2),
        ch("apt_num_16", 1.7, "Which is closest to 0.98 × 0.98?", "0.98 × 0.98 க்கு மிக அருகில் உள்ளது எது?", ["0.96", "0.98", "1.96"], 0),
        ch("apt_num_17", 1.9, "A tank fills in 6 hours with one pipe and 3 hours with another. Both together?", "ஒரு குழாயால் தொட்டி 6 மணி நேரத்திலும், இன்னொன்றால் 3 மணி நேரத்திலும் நிரம்பும். இரண்டும் சேர்ந்தால்?",
           ["2 hours", "4.5 hours", "9 hours"], 0),
    ]


def main() -> None:
    rng = random.Random(2026)
    banks = {"aptitude_mechanical.json": mechanical(rng), "aptitude_spatial.json": spatial(rng), "aptitude_numeric.json": numeric()}
    for name, rows in banks.items():
        (OUT / name).write_text("[\n" + ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in rows) + "\n]\n",
                                encoding="utf-8", newline="\n")
        print(name, len(rows))


if __name__ == "__main__":
    main()
