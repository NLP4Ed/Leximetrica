# Leximetrica: Quantitative Linguistics & Lexical Dispersion Analyzer

<p align="center">
  <img src="docs/img/nlp4ed.svg" alt="NLP4Ed Logo" width="220" />
</p>

<p align="center">
  <strong>Leximetrica is a zero-server web app and zero-dependency Python library for quantitative linguistics laws and lexical dispersion / burstiness analysis.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://doi.org/10.5281/zenodo.24459810"><img src="https://img.shields.io/badge/DOI-10.5281%2Fzenodo.24459810-purple.svg" alt="DOI: 10.5281/zenodo.24459810"></a>
  <a href="https://github.com/NLP4Ed/Leximetrica"><img src="https://img.shields.io/badge/Release-v1.3-blue.svg" alt="Version"></a>
  <a href="https://nlp4ed.com/Leximetrica/"><img src="https://img.shields.io/badge/Live%20App-Leximetrica%201.3-emerald.svg" alt="Live App Leximetrica 1.3"></a>
  <a href="docs/index.html"><img src="https://img.shields.io/badge/Execution-100%25%20Client--Side-teal.svg" alt="Client-Side"></a>
</p>

---

## Measurements

### Quantitative Linguistics Laws & Corpus Signatures
| Metric | Formula / Output | Reference |
| :--- | :--- | :--- |
| **Zipf's Law Fit** | $f(r) \approx C \cdot r^{-\alpha}$ via OLS log-log regression ($\alpha$, $C$, $R^2$) | Zipf (1949) |
| **Heaps' Law Growth** | $V(N) \approx K \cdot N^{\beta}$ vocabulary growth curve ($K$, $\beta$, $R^2$) | Heaps (1978) |
| **Shannon Lexical Entropy** | $H = -\sum p_i \log_2 p_i$, $H_{\max} = \log_2 V$, Pielou's Evenness $J = H/H_{\max}$, Redundancy $1 - J$ | Shannon (1948) |
| **Menzerath-Altmann Law** | Pearson $r$ & linear slope between sentence length (words) and mean word length (chars) | Altmann (1980) |
| **Stability Companions** | Yule's $K$, Herdan's $C$ ($\log V / \log N$), Hapax & Dis Legomena ratios | Yule (1944); Herdan (1960) |

### Per-Word Lexical Dispersion & Burstiness
| Metric | Range & Interpretation | Reference |
| :--- | :--- | :--- |
| **Gries's $DP$** | $[0, 1)$: $0$ = perfectly proportional across segments; higher = clumped | Gries (2008) |
| **Gries's $DP_{\text{norm}}$** | $[0, 1]$: normalized by $1 - \min(s_i)$ | Lijffijt & Gries (2012) |
| **Juilland's $D$** | $[0, 1]$: $1$ = perfectly uniform; $0$ = confined to one segment | Juilland & Chang-Rodriguez (1964) |
| **Carroll's $D_2$** | $[0, 1]$: entropy-normalized dispersion ($1$ = uniform, $0$ = clumped) | Carroll (1970) |
| **Rosengren's $S$** | $(\min s_i, 1]$: proportional dispersion index | Rosengren (1971) |
| **Burstiness ($B$)** | $[-1, 1]$ on inter-occurrence gaps ($f \ge 3$): $-1$ periodic, $0$ Poisson, $+1$ bursty | Goh & Barabási (2008) |

---

## License

This project is licensed under the [MIT License](LICENSE).
