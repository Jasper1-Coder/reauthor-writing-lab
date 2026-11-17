#!/usr/bin/env python3
"""Build corpus v3: unified docs.jsonl + group-level stratified train/holdout split.

Reads calibration/raw/*.jsonl (HC3 subsets, never modified), emits:
  calibration/corpus/v3/docs.jsonl
  calibration/corpus/v3/train.jsonl
  calibration/corpus/v3/holdout.jsonl
  calibration/corpus/v3/stats.json

Guarantees: every `group` (= one HC3 question) lands in exactly one split.
crossdomain/academic_zh.jsonl is an external test set and is NEVER read here.
"""
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "calibration", "raw")
OUT = os.path.join(ROOT, "calibration", "corpus", "v3")

SEED = 20261117
HOLDOUT_FRAC = 0.20
MIN_CHARS = 40
ZH_RATIO = 0.30  # cjk / (cjk + latin letters) >= 0.30 -> zh

# source file -> (domain key, declared lang)
SOURCES = [
    ("zh_baike", "zh_baike", "zh"),
    ("zh_finance", "zh_finance", "zh"),
    ("zh_law", "zh_law", "zh"),
    ("zh_medicine", "zh_medicine", "zh"),
    ("zh_open_qa", "zh_open_qa", "zh"),
    ("zh_psychology", "zh_psychology", "zh"),
    ("zh_nlpcc_dbqa", "zh_nlpcc_dbqa", "zh"),
    ("finance", "en_finance", "en"),
    ("medicine", "en_medicine", "en"),
    ("open_qa", "en_open_qa", "en"),
    ("wiki_csai", "en_wiki_csai", "en"),
    ("reddit_eli5", "en_reddit_eli5", "en"),
]

CJK_RANGES = (
    (0x3400, 0x4DBF),
    (0x4E00, 0x9FFF),
    (0xF900, 0xFAFF),
    (0x20000, 0x2FA1F),
)
WS = re.compile(r"\s+")
ALNUM_OR_CJK = re.compile(r"[0-9A-Za-z\u3400-\u4dbf\u4e00-\u9fff]")


def cjk_ratio(text):
    """cjk / (cjk + latin letters).

    Denominator deliberately excludes digits and punctuation: Chinese
    encyclopedia/QA text is dense in Latin acronyms and code fragments
    (CIP, snprintf, SET /A), and dividing by all non-space chars pushes
    clearly-Chinese answers below the threshold.
    """
    cjk = 0
    latin = 0
    for ch in text:
        cp = ord(ch)
        if ("a" <= ch <= "z") or ("A" <= ch <= "Z"):
            latin += 1
            continue
        for lo, hi in CJK_RANGES:
            if lo <= cp <= hi:
                cjk += 1
                break
    total = cjk + latin
    if not total:
        return 0.0
    return cjk / total


def norm_question(q):
    return WS.sub(" ", q or "").strip().lower()


def qhash(q):
    return hashlib.sha1(norm_question(q).encode("utf-8")).hexdigest()[:16]


def score(group_id):
    """Deterministic pseudo-random score in [0,1) for reproducible splitting."""
    h = hashlib.sha256(("%d:%s" % (SEED, group_id)).encode("utf-8")).hexdigest()
    return int(h[:15], 16) / float(1 << 60)


def main():
    os.makedirs(OUT, exist_ok=True)
    docs = []
    dropped = Counter()
    per_source = {}
    groups = defaultdict(set)  # group -> doc indexes (for leak audit)

    missing = [s for s, _, _ in SOURCES if not os.path.exists(os.path.join(RAW, s + ".jsonl"))]
    if missing:
        print("WARN missing raw files: %s" % missing, file=sys.stderr)

    for fname, domain, declared_lang in SOURCES:
        path = os.path.join(RAW, fname + ".jsonl")
        if not os.path.exists(path):
            continue
        rows = 0
        kept = 0
        lang_mismatch = 0
        with open(path, encoding="utf-8") as fh:
            for lineno, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                rows += 1
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    dropped["bad_json"] += 1
                    continue
                q = rec.get("question") or ""
                gid = "q_" + qhash(q)
                for label, key, tag in ((0, "human_answers", "h"), (1, "chatgpt_answers", "a")):
                    answers = rec.get(key) or []
                    if not isinstance(answers, list):
                        answers = [answers]
                    for i, ans in enumerate(answers):
                        if not isinstance(ans, str):
                            dropped["non_str"] += 1
                            continue
                        text = ans.strip()
                        if len(text) < MIN_CHARS:
                            dropped["too_short"] += 1
                            continue
                        if not ALNUM_OR_CJK.search(text):
                            dropped["no_alnum"] += 1
                            continue
                        lang = "zh" if cjk_ratio(text) >= ZH_RATIO else "en"
                        if lang != declared_lang:
                            lang_mismatch += 1
                        docs.append({
                            "id": "%s-%s%d-%d-%s" % (domain, tag, lineno, i, gid[2:8]),
                            "group": gid,
                            "domain": domain,
                            "lang": lang,
                            "label": label,
                            "chars": len(text),
                            "text": text,
                        })
                        kept += 1
        per_source[fname] = {
            "domain": domain,
            "declared_lang": declared_lang,
            "rows": rows,
            "kept_answers": kept,
            "lang_mismatch": lang_mismatch,
        }

    for idx, d in enumerate(docs):
        groups[d["group"]].add(idx)

    # ---- group-level split, stratified per domain -------------------------
    by_domain = defaultdict(list)
    for gid, idxs in groups.items():
        doms = [docs[i]["domain"] for i in idxs]
        by_domain[Counter(doms).most_common(1)[0][0]].append(gid)

    holdout_groups = set()
    for domain, gids in sorted(by_domain.items()):
        total = sum(len(groups[g]) for g in gids)
        quota = total * HOLDOUT_FRAC
        acc = 0
        for g in sorted(gids, key=lambda g: (score(g), g)):
            if acc >= quota:
                break
            holdout_groups.add(g)
            acc += len(groups[g])

    for d in docs:
        d["split"] = "holdout" if d["group"] in holdout_groups else "train"

    leak = len({x["group"] for x in docs if x["split"] == "train"} &
               {x["group"] for x in docs if x["split"] == "holdout"})

    docs.sort(key=lambda x: (x["split"], x["domain"], x["label"], x["id"]))
    with open(os.path.join(OUT, "docs.jsonl"), "w", encoding="utf-8", newline="\n") as f:
        for d in docs:
            f.write(json.dumps(d, ensure_ascii=False) + "\n")
    for split in ("train", "holdout"):
        with open(os.path.join(OUT, split + ".jsonl"), "w", encoding="utf-8", newline="\n") as f:
            for d in docs:
                if d["split"] == split:
                    f.write(json.dumps(d, ensure_ascii=False) + "\n")

    # ---- stats -----------------------------------------------------------
    def agg(rows):
        return {
            "docs": len(rows),
            "chars": sum(r["chars"] for r in rows),
            "human": sum(1 for r in rows if r["label"] == 0),
            "ai": sum(1 for r in rows if r["label"] == 1),
        }

    domain_label = defaultdict(lambda: {"train": [0, 0], "holdout": [0, 0]})
    for d in docs:
        domain_label[d["domain"]][d["split"]][d["label"]] += 1

    stats = {
        "seed": SEED,
        "min_chars": MIN_CHARS,
        "zh_ratio_threshold": ZH_RATIO,
        "sources": per_source,
        "dropped": dict(dropped),
        "overall": agg(docs),
        "train": agg([d for d in docs if d["split"] == "train"]),
        "holdout": agg([d for d in docs if d["split"] == "holdout"]),
        "lang": {
            l: agg([d for d in docs if d["lang"] == l]) for l in ("zh", "en")
        },
        "lang_split": {
            "%s_%s" % (l, s): agg([d for d in docs if d["lang"] == l and d["split"] == s])
            for l in ("zh", "en") for s in ("train", "holdout")
        },
        "domain_label": {k: v for k, v in sorted(domain_label.items())},
        "groups": {
            "total": len(groups),
            "holdout": len(holdout_groups),
            "avg_docs_per_group": round(len(docs) / max(len(groups), 1), 3),
            "leak_across_split": leak,
        },
    }
    with open(os.path.join(OUT, "stats.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)

    print("docs=%d train=%d holdout=%d chars=%d groups=%d leak=%d" % (
        stats["overall"]["docs"], stats["train"]["docs"], stats["holdout"]["docs"],
        stats["overall"]["chars"], len(groups), leak))
    print("dropped=%s" % dict(dropped))


if __name__ == "__main__":
    main()
