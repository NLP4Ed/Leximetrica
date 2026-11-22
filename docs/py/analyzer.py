"""top-level analysis pipeline returning json-ready dict."""

from __future__ import annotations

from typing import Any, Dict, List

from .dispersion import compute_word_dispersion
from .laws import (
    compute_heaps_law,
    compute_lexical_signatures,
    compute_menzerath_altmann,
    compute_shannon_entropy,
    compute_zipf_law,
)
from .tokenizer import split_sentences, tokenize


def analyze_text(
    text: str,
    *,
    num_segments: int = 10,
    min_freq: int = 2,
    lowercase: bool = True,
    max_words: int = 500,
) -> Dict[str, Any]:
    """run full laws + dispersion analysis."""
    tokens = tokenize(text, lowercase=lowercase)
    sentences = split_sentences(text, lowercase=lowercase)

    total_tokens = len(tokens)
    vocab_size = len(set(tokens))
    warnings: List[str] = []

    if total_tokens == 0:
        warnings.append("No word tokens were detected in the input text.")
    elif total_tokens < 50:
        warnings.append(
            f"Short text ({total_tokens} tokens): Zipf, Heaps, and dispersion estimates are more stable above 200+ tokens."
        )

    if len(sentences) < 5 and total_tokens > 0:
        warnings.append(
            f"Only {len(sentences)} sentence(s) detected: Menzerath-Altmann correlation requires more sentences for statistical stability."
        )

    zipf = compute_zipf_law(tokens)
    heaps = compute_heaps_law(tokens)
    entropy = compute_shannon_entropy(tokens)
    menzerath = compute_menzerath_altmann(sentences)
    signatures = compute_lexical_signatures(tokens)
    dispersion = compute_word_dispersion(
        tokens,
        num_segments=num_segments,
        min_freq=min_freq,
        max_words=max_words,
    )

    mean_word_len = round(sum(len(t) for t in tokens) / total_tokens, 2) if total_tokens else 0.0
    mean_sent_len = round(total_tokens / len(sentences), 2) if sentences else 0.0

    return {
        "meta": {
            "total_tokens": total_tokens,
            "vocab_size": vocab_size,
            "num_sentences": len(sentences),
            "mean_word_length": mean_word_len,
            "mean_sentence_length": mean_sent_len,
            "num_segments": dispersion["num_segments"],
            "min_freq": min_freq,
        },
        "warnings": warnings,
        "laws": {
            "zipf": zipf,
            "heaps": heaps,
            "entropy": entropy,
            "menzerath_altmann": menzerath,
            "signatures": signatures,
        },
        "dispersion": {
            "segment_sizes": dispersion["segment_sizes"],
            "summary": dispersion["summary"],
            "words": dispersion["words"],
        },
    }
