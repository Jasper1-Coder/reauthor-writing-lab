#!/usr/bin/env python3
"""Audit corpus v3: group leakage, split ratio, domain x label table, language mix.

Reads only calibration/corpus/v3/{train,holdout}.jsonl and prints a self-check table.
Exit code 1 if any group leaks across splits or the files are inconsistent.
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V3 = os.path.join(ROOT, "calibration", "corpus", "v3")

SENT_SPLIT = re.compile(r"[。！？!?;；]+|\.\s|\n+")


def load(split):
    path = os.path.join(V3, split + ".jsonl")
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def sent_count(text):
    parts = [p for p in SENT_SPLIT.split(text) if p.strip()]
    return max(1, len(parts))


def main():
    train, holdout = load("train"), load("holdout")
    docs = train + holdout

    g_train = {d["group"] for d in train}
    g_hold = {d["group"] for d in holdout}
    leak = g_train & g_hold

    ids_train = {d["id"] for d in train}
    dup_ids = len(ids_train & {d["id"] for d in holdout})
    dup_within = len(train) - len(ids_train)

    print("== split integrity ==")
    print("train docs      : %d" % len(train))
    print("holdout docs    : %d" % len(holdout))
    print("holdout share   : %.4f" % (len(holdout) / len(docs)))
    print("groups train    : %d" % len(g_train))
    print("groups holdout  : %d" % len(g_hold))
    print("groups overlap  : %d  (must be 0)" % len(leak))
    print("avg docs/group  : %.3f" % (len(docs) / len(g_train | g_hold)))
    print("dup ids across  : %d  (must be 0)" % dup_ids)
    print("dup ids in train: %d  (must be 0)" % dup_within)

    print("\n== language (docs / chars) ==")
    for lang in ("zh", "en"):
        rows = [d for d in docs if d["lang"] == lang]
        print("%-3s docs=%-7d chars=%-10d human=%-6d ai=%-6d" % (
            lang, len(rows), sum(d["chars"] for d in rows),
            sum(1 for d in rows if d["label"] == 0), sum(1 for d in rows if d["label"] == 1)))

    print("\n== per source: docs / chars / sentences (human | ai) ==")
    per = defaultdict(lambda: {"h": [0, 0, 0], "a": [0, 0, 0]})
    for d in docs:
        k = "h" if d["label"] == 0 else "a"
        per[d["domain"]][k][0] += 1
        per[d["domain"]][k][1] += d["chars"]
        per[d["domain"]][k][2] += sent_count(d["text"])
    for dom in sorted(per):
        h, a = per[dom]["h"], per[dom]["a"]
        print("%-16s human %5dd/%9dc/%6ds | ai %5dd/%9dc/%6ds" % (
            dom, h[0], h[1], h[2], a[0], a[1], a[2]))

    print("\n== domain x label (train / holdout) ==")
    tab = defaultdict(lambda: [[0, 0], [0, 0]])
    for d in train:
        tab[d["domain"]][0][d["label"]] += 1
    for d in holdout:
        tab[d["domain"]][1][d["label"]] += 1
    print("%-16s %-19s %-19s %s" % ("domain", "train h/a", "holdout h/a", "holdout h% / a%"))
    for dom in sorted(tab):
        (th, ta), (hh, ha) = tab[dom]
        tot_h, tot_a = th + hh, ta + ha
        ph = hh / tot_h if tot_h else 0
        pa = ha / tot_a if tot_a else 0
        print("%-16s %6d / %-10d %6d / %-10d %.3f / %.3f" % (dom, th, ta, hh, ha, ph, pa))

    tot_h = sum(1 for d in docs if d["label"] == 0)
    tot_a = sum(1 for d in docs if d["label"] == 1)
    print("\noverall label   : human=%d ai=%d (ai share %.3f)" % (tot_h, tot_a, tot_a / len(docs)))
    print("total chars     : %d" % sum(d["chars"] for d in docs))
    print("external testset: %s (not in corpus: %s)" % (
        os.path.exists(os.path.join(ROOT, "crossdomain", "academic_zh.jsonl")),
        all("academic" not in d["domain"] for d in docs)))

    size = {s: os.path.getsize(os.path.join(V3, s + ".jsonl")) for s in ("docs", "train", "holdout")}
    print("file sizes MB   : %s" % {k: round(v / 1e6, 1) for k, v in size.items()})

    if leak or dup_ids or dup_within:
        print("\nFAIL: leakage or duplicate ids detected")
        return 1
    print("\nPASS: group-disjoint split, no duplicate ids")
    return 0


if __name__ == "__main__":
    sys.exit(main())
