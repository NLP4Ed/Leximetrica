"""quantitative linguistics laws + lexical signatures."""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional, Sequence, Tuple


def _ols_regression(xs: Sequence[float], ys: Sequence[float]) -> Tuple[float, float, float]:
    """pure-python ols (slope, intercept, r2)."""
    n = len(xs)
    if n < 2:
        return 0.0, 0.0, 0.0

    mean_x = sum(xs) / n
    mean_y = sum(ys) / n

    ss_xx = sum((x - mean_x) ** 2 for x in xs)
    ss_yy = sum((y - mean_y) ** 2 for y in ys)
    ss_xy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))

    if ss_xx == 0.0:
        return 0.0, mean_y, 0.0

    slope = ss_xy / ss_xx
    intercept = mean_y - slope * mean_x

    if ss_yy == 0.0:
        r_squared = 1.0 if slope == 0.0 else 0.0
    else:
        r_squared = (ss_xy ** 2) / (ss_xx * ss_yy)
        r_squared = max(0.0, min(1.0, r_squared))

    return slope, intercept, r_squared


def _downsample_indices(length: int, max_points: int) -> List[int]:
    """pick up to max_points indices preserving endpoints."""
    if length <= max_points:
        return list(range(length))
    if max_points < 2:
        return [0]
    step = (length - 1) / (max_points - 1)
    indices = sorted({round(i * step) for i in range(max_points)})
    if indices[-1] != length - 1:
        indices.append(length - 1)
    return indices


def compute_zipf_law(tokens: Sequence[str], *, max_points: int = 160) -> Dict[str, Any]:
    """fit zipf law via log-log ols."""
    if not tokens:
        return {
            "alpha": None,
            "constant": None,
            "r_squared": None,
            "num_ranks": 0,
            "points": [],
        }

    counts = Counter(tokens)
    ranked = counts.most_common()
    num_ranks = len(ranked)

    if num_ranks < 2:
        word, freq = ranked[0]
        return {
            "alpha": None,
            "constant": float(freq),
            "r_squared": None,
            "num_ranks": 1,
            "points": [{"rank": 1, "freq": freq, "fitted": float(freq), "word": word}],
        }

    log_ranks = [math.log(r) for r in range(1, num_ranks + 1)]
    log_freqs = [math.log(freq) for _, freq in ranked]

    slope, intercept, r_squared = _ols_regression(log_ranks, log_freqs)
    alpha = -slope
    constant = math.exp(intercept)

    # log-sample tail to keep chart payload light
    if num_ranks <= max_points:
        sample_idx = list(range(num_ranks))
    else:
        top_keep = min(30, max_points // 3)
        remaining = max_points - top_keep
        tail_indices = {
            min(num_ranks - 1, int(round(math.exp(
                math.log(top_keep + 1)
                + i * (math.log(num_ranks) - math.log(top_keep + 1)) / max(1, remaining - 1)
            ))) - 1)
            for i in range(remaining)
        }
        sample_idx = sorted(set(range(top_keep)) | tail_indices | {num_ranks - 1})

    points = []
    for idx in sample_idx:
        rank = idx + 1
        word, freq = ranked[idx]
        fitted = constant * (rank ** (-alpha))
        points.append({
            "rank": rank,
            "freq": freq,
            "fitted": round(fitted, 4),
            "word": word,
        })

    return {
        "alpha": round(alpha, 4),
        "constant": round(constant, 4),
        "r_squared": round(r_squared, 4),
        "num_ranks": num_ranks,
        "points": points,
    }


def compute_heaps_law(tokens: Sequence[str], *, num_checkpoints: int = 80) -> Dict[str, Any]:
    """fit heaps law over cumulative token prefixes."""
    total = len(tokens)
    if total == 0:
        return {
            "k": None,
            "beta": None,
            "r_squared": None,
            "points": [],
        }

    # evenly spaced prefix checkpoints
    if total <= num_checkpoints:
        checkpoints = set(range(1, total + 1))
    else:
        checkpoints = {
            max(1, round(i * total / num_checkpoints))
            for i in range(1, num_checkpoints + 1)
        }
        checkpoints.add(1)
        checkpoints.add(total)

    seen = set()
    empirical: List[Tuple[int, int]] = []
    for pos, tok in enumerate(tokens, start=1):
        seen.add(tok)
        if pos in checkpoints:
            empirical.append((pos, len(seen)))

    if len(empirical) < 2:
        n_val, v_val = empirical[0]
        return {
            "k": float(v_val),
            "beta": None,
            "r_squared": None,
            "points": [{"n": n_val, "v": v_val, "fitted": float(v_val)}],
        }

    log_n = [math.log(n_val) for n_val, _ in empirical]
    log_v = [math.log(v_val) for _, v_val in empirical]
    beta, intercept, r_squared = _ols_regression(log_n, log_v)
    k_val = math.exp(intercept)

    points = [
        {
            "n": n_val,
            "v": v_val,
            "fitted": round(k_val * (n_val ** beta), 2),
        }
        for n_val, v_val in empirical
    ]

    return {
        "k": round(k_val, 4),
        "beta": round(beta, 4),
        "r_squared": round(r_squared, 4),
        "points": points,
    }


def compute_shannon_entropy(tokens: Sequence[str]) -> Dict[str, Optional[float]]:
    """shannon entropy, evenness j, redundancy."""
    total = len(tokens)
    if total == 0:
        return {
            "entropy_bits": None,
            "max_entropy_bits": None,
            "evenness_j": None,
            "redundancy": None,
        }

    counts = Counter(tokens)
    vocab_size = len(counts)
    entropy = 0.0
    for freq in counts.values():
        p = freq / total
        entropy -= p * math.log2(p)

    max_entropy = math.log2(vocab_size) if vocab_size > 1 else 0.0
    if max_entropy > 0.0:
        evenness = max(0.0, min(1.0, entropy / max_entropy))
        redundancy = max(0.0, min(1.0, 1.0 - evenness))
    else:
        evenness = None
        redundancy = None

    return {
        "entropy_bits": round(entropy, 4),
        "max_entropy_bits": round(max_entropy, 4),
        "evenness_j": round(evenness, 4) if evenness is not None else None,
        "redundancy": round(redundancy, 4) if redundancy is not None else None,
    }


def compute_menzerath_altmann(
    sentences: Sequence[Sequence[str]],
    *,
    max_points: int = 120,
) -> Dict[str, Any]:
    """menzerath-altmann: sentence length vs mean word length."""
    pairs: List[Tuple[int, float]] = []
    by_length: Dict[int, List[float]] = defaultdict(list)

    for sent in sentences:
        if not sent:
            continue
        sent_len = len(sent)
        mean_word_len = sum(len(w) for w in sent) / sent_len
        pairs.append((sent_len, mean_word_len))
        by_length[sent_len].append(mean_word_len)

    if len(pairs) < 2:
        return {
            "pearson_r": None,
            "slope": None,
            "intercept": None,
            "r_squared": None,
            "num_sentences": len(pairs),
            "binned_points": [
                {
                    "sentence_length": length,
                    "mean_word_length": round(sum(vals) / len(vals), 3),
                    "count": len(vals),
                }
                for length, vals in sorted(by_length.items())
            ],
        }

    xs = [float(x) for x, _ in pairs]
    ys = [y for _, y in pairs]
    slope, intercept, r_squared = _ols_regression(xs, ys)

    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)
    ss_xy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    ss_xx = sum((x - mean_x) ** 2 for x in xs)
    ss_yy = sum((y - mean_y) ** 2 for y in ys)

    if ss_xx > 0.0 and ss_yy > 0.0:
        pearson_r: Optional[float] = ss_xy / math.sqrt(ss_xx * ss_yy)
    else:
        pearson_r = None

    sorted_lengths = sorted(by_length.items())
    keep_idx = _downsample_indices(len(sorted_lengths), max_points)
    binned_points = []
    for idx in keep_idx:
        length, vals = sorted_lengths[idx]
        binned_points.append({
            "sentence_length": length,
            "mean_word_length": round(sum(vals) / len(vals), 3),
            "fitted": round(intercept + slope * length, 3),
            "count": len(vals),
        })

    return {
        "pearson_r": round(pearson_r, 4) if pearson_r is not None else None,
        "slope": round(slope, 5),
        "intercept": round(intercept, 4),
        "r_squared": round(r_squared, 4),
        "num_sentences": len(pairs),
        "binned_points": binned_points,
    }


def compute_lexical_signatures(tokens: Sequence[str]) -> Dict[str, Optional[float]]:
    """corpus lexical concentration + rarity metrics."""
    total = len(tokens)
    if total == 0:
        return {
            "ttr": None,
            "herdan_c": None,
            "yules_k": None,
            "hapax_count": 0,
            "hapax_ratio_types": None,
            "hapax_ratio_tokens": None,
            "dis_count": 0,
            "dis_ratio_types": None,
        }

    counts = Counter(tokens)
    vocab = len(counts)
    freq_spectrum = Counter(counts.values())

    hapax = freq_spectrum.get(1, 0)
    dis = freq_spectrum.get(2, 0)

    # yule k: 10^4 * (m2 - m1) / m1^2
    m1 = float(total)
    m2 = sum((m * m) * vm for m, vm in freq_spectrum.items())
    yules_k = 10000.0 * (m2 - m1) / (m1 * m1) if m1 > 0 else None

    # herdan c: log(v) / log(n)
    herdan_c = (math.log(vocab) / math.log(total)) if total > 1 and vocab > 0 else None

    return {
        "ttr": round(vocab / total, 4),
        "herdan_c": round(herdan_c, 4) if herdan_c is not None else None,
        "yules_k": round(yules_k, 2) if yules_k is not None else None,
        "hapax_count": hapax,
        "hapax_ratio_types": round(hapax / vocab, 4),
        "hapax_ratio_tokens": round(hapax / total, 4),
        "dis_count": dis,
        "dis_ratio_types": round(dis / vocab, 4),
    }
