"""per-word dispersion + burstiness indices."""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional, Sequence

from .tokenizer import partition_tokens


def gries_dp(part_counts: Sequence[int], expected_props: Sequence[float]) -> float:
    """gries dp in [0, 1) (0 = proportional, 1 = clumped)."""
    freq = sum(part_counts)
    if freq <= 0 or not expected_props:
        return 0.0
    dp = 0.5 * sum(abs((v / freq) - s) for v, s in zip(part_counts, expected_props))
    return max(0.0, min(1.0, dp))


def gries_dp_norm(dp: float, expected_props: Sequence[float]) -> float:
    """lijffijt + gries normalized dp in [0, 1]."""
    if len(expected_props) <= 1:
        return 0.0
    min_s = min(expected_props)
    denom = 1.0 - min_s
    if denom <= 0.0:
        return 0.0
    return max(0.0, min(1.0, dp / denom))


def juillands_d(part_counts: Sequence[int], expected_props: Sequence[float]) -> float:
    """juilland d in [0, 1] (1 = uniform, 0 = clumped)."""
    n = len(part_counts)
    if n <= 1 or sum(part_counts) <= 0:
        return 1.0

    rates = [(v / s) if s > 0.0 else 0.0 for v, s in zip(part_counts, expected_props)]
    mean_r = sum(rates) / n
    if mean_r == 0.0:
        return 0.0

    variance = sum((r - mean_r) ** 2 for r in rates) / n
    cv = math.sqrt(variance) / mean_r
    d_val = 1.0 - (cv / math.sqrt(n - 1))
    return max(0.0, min(1.0, d_val))


def carrolls_d2(part_counts: Sequence[int], expected_props: Sequence[float]) -> float:
    """carroll d2 entropy dispersion in [0, 1]."""
    n = len(part_counts)
    if n <= 1 or sum(part_counts) <= 0:
        return 1.0

    rates = [(v / s) if s > 0.0 else 0.0 for v, s in zip(part_counts, expected_props)]
    total_r = sum(rates)
    if total_r == 0.0:
        return 0.0

    entropy = 0.0
    for r in rates:
        if r > 0.0:
            p = r / total_r
            entropy -= p * math.log2(p)

    d2 = entropy / math.log2(n)
    return max(0.0, min(1.0, d2))


def rosengrens_s(part_counts: Sequence[int], expected_props: Sequence[float]) -> float:
    """rosengren s in (0, 1]."""
    freq = sum(part_counts)
    if freq <= 0 or not expected_props:
        return 0.0
    root_sum = sum(math.sqrt(s * v) for v, s in zip(part_counts, expected_props))
    s_val = (root_sum ** 2) / freq
    return max(0.0, min(1.0, s_val))


def goh_barabasi_burstiness(positions: Sequence[int]) -> Optional[float]:
    """goh + barabasi burstiness b in [-1, 1] (needs >= 3 hits)."""
    if len(positions) < 3:
        return None

    gaps = [positions[i + 1] - positions[i] for i in range(len(positions) - 1)]
    mean_gap = sum(gaps) / len(gaps)
    if mean_gap == 0.0:
        return None

    variance = sum((g - mean_gap) ** 2 for g in gaps) / len(gaps)
    std_gap = math.sqrt(variance)
    denom = std_gap + mean_gap
    if denom == 0.0:
        return None

    b_val = (std_gap - mean_gap) / denom
    return max(-1.0, min(1.0, b_val))


def compute_word_dispersion(
    tokens: Sequence[str],
    *,
    num_segments: int = 10,
    min_freq: int = 2,
    max_words: int = 500,
) -> Dict[str, Any]:
    """compute dispersion + burstiness per word across segments."""
    if not tokens:
        return {
            "num_segments": 0,
            "segment_sizes": [],
            "words": [],
            "summary": {
                "analyzed_types": 0,
                "mean_dp_norm": None,
                "mean_juilland_d": None,
                "mean_burstiness": None,
            },
        }

    segments, expected_props = partition_tokens(list(tokens), num_segments=num_segments)
    n_seg = len(segments)

    # counts per segment + token positions
    total_counts = Counter(tokens)
    seg_counts: Dict[str, List[int]] = defaultdict(lambda: [0] * n_seg)
    positions: Dict[str, List[int]] = defaultdict(list)

    pos = 0
    for seg_idx, seg in enumerate(segments):
        for tok in seg:
            seg_counts[tok][seg_idx] += 1
            positions[tok].append(pos)
            pos += 1

    # filter by min_freq, sort by freq desc then word
    eligible = [
        (word, freq)
        for word, freq in total_counts.items()
        if freq >= min_freq
    ]
    eligible.sort(key=lambda item: (-item[1], item[0]))
    if max_words > 0:
        eligible = eligible[:max_words]

    rows: List[Dict[str, Any]] = []
    dp_norms: List[float] = []
    juillands: List[float] = []
    bursts: List[float] = []

    for word, freq in eligible:
        p_counts = seg_counts[word]
        dp = gries_dp(p_counts, expected_props)
        dp_n = gries_dp_norm(dp, expected_props)
        j_d = juillands_d(p_counts, expected_props)
        c_d2 = carrolls_d2(p_counts, expected_props)
        r_s = rosengrens_s(p_counts, expected_props)
        burst = goh_barabasi_burstiness(positions[word])
        seg_range = sum(1 for c in p_counts if c > 0)

        dp_norms.append(dp_n)
        juillands.append(j_d)
        if burst is not None:
            bursts.append(burst)

        rows.append({
            "word": word,
            "freq": freq,
            "rel_freq_per_1k": round((freq / len(tokens)) * 1000.0, 2),
            "range_segments": seg_range,
            "range_pct": round((seg_range / n_seg) * 100.0, 1) if n_seg else 0.0,
            "gries_dp": round(dp, 4),
            "gries_dp_norm": round(dp_n, 4),
            "juilland_d": round(j_d, 4),
            "carroll_d2": round(c_d2, 4),
            "rosengren_s": round(r_s, 4),
            "burstiness_b": round(burst, 4) if burst is not None else None,
            "segment_counts": p_counts,
        })

    return {
        "num_segments": n_seg,
        "segment_sizes": [len(s) for s in segments],
        "words": rows,
        "summary": {
            "analyzed_types": len(rows),
            "mean_dp_norm": round(sum(dp_norms) / len(dp_norms), 4) if dp_norms else None,
            "mean_juilland_d": round(sum(juillands) / len(juillands), 4) if juillands else None,
            "mean_burstiness": round(sum(bursts) / len(bursts), 4) if bursts else None,
        },
    }
