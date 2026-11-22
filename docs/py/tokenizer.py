"""word tokenizer, sentence splitter, corpus segmenter."""

from __future__ import annotations

import re
import unicodedata
from typing import List, Tuple

# strip arabic diacritics + tatweel
_ARABIC_MARKS_RE = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")

# unicode alphabetic words (keeps contractions + hyphens, skips pure numbers)
_WORD_RE = re.compile(r"[^\W\d_]+(?:['’-][^\W\d_]+)*", re.UNICODE)

# split on terminal punctuation or newlines
_SENTENCE_SPLIT_RE = re.compile(r"(?:[.!?؟…]+(?:\s+|$)|\n+)")


def _normalize_text(text: str) -> str:
    return _ARABIC_MARKS_RE.sub("", unicodedata.normalize("NFC", text))


def tokenize(text: str, *, lowercase: bool = True) -> List[str]:
    """extract word tokens, excluding pure numbers."""
    if not text or not text.strip():
        return []

    normalized = _normalize_text(text)
    tokens = _WORD_RE.findall(normalized)
    if lowercase:
        tokens = [tok.casefold() for tok in tokens]
    return tokens


def split_sentences(text: str, *, lowercase: bool = True) -> List[List[str]]:
    """split text into tokenized sentences."""
    if not text or not text.strip():
        return []

    normalized = _normalize_text(text)
    raw_sentences = _SENTENCE_SPLIT_RE.split(normalized)
    tokenized_sentences: List[List[str]] = []
    for sent in raw_sentences:
        toks = tokenize(sent, lowercase=lowercase)
        if toks:
            tokenized_sentences.append(toks)
    return tokenized_sentences


def partition_tokens(
    tokens: List[str],
    num_segments: int = 10,
) -> Tuple[List[List[str]], List[float]]:
    """split tokens into n near-equal contiguous segments."""
    total = len(tokens)
    if total == 0:
        return [], []

    n = max(1, min(int(num_segments), total))
    base, remainder = divmod(total, n)

    segments: List[List[str]] = []
    proportions: List[float] = []
    idx = 0
    for i in range(n):
        size = base + (1 if i < remainder else 0)
        segments.append(tokens[idx : idx + size])
        proportions.append(size / total)
        idx += size

    return segments, proportions
