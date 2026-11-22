"""leximetrica core package."""

from .analyzer import analyze_text
from .dispersion import compute_word_dispersion
from .laws import (
    compute_heaps_law,
    compute_lexical_signatures,
    compute_menzerath_altmann,
    compute_shannon_entropy,
    compute_zipf_law,
)
from .tokenizer import partition_tokens, split_sentences, tokenize

__all__ = [
    "analyze_text",
    "compute_heaps_law",
    "compute_lexical_signatures",
    "compute_menzerath_altmann",
    "compute_shannon_entropy",
    "compute_word_dispersion",
    "compute_zipf_law",
    "partition_tokens",
    "split_sentences",
    "tokenize",
]

__version__ = "1.3"
