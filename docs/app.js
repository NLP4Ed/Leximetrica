/* leximetrica frontend - worker pyodide on http/s, main-thread fallback on file:// */

(() => {
  "use strict";

  const APP_NAME = "Leximetrica";
  const APP_VERSION = "v1.3";
  const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/";
  const IS_FILE_PROTOCOL = window.location.protocol === "file:";

  // dom refs
  const inputText = document.getElementById("inputText");
  const inputCounter = document.getElementById("inputCounter");
  const numSegmentsInput = document.getElementById("numSegments");
  const minFreqInput = document.getElementById("minFreq");
  const lowercaseCheckbox = document.getElementById("optLowercase");
  const clearBtn = document.getElementById("clearBtn");
  const fileUploadInput = document.getElementById("fileUpload");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const analyzeBtnSpinner = document.getElementById("analyzeBtnSpinner");
  const analyzeBtnZap = document.getElementById("analyzeBtnZap");
  const analyzeBtnText = document.getElementById("analyzeBtnText");

  const busyBanner = document.getElementById("busyBanner");
  const busyText = document.getElementById("busyText");
  const errorBanner = document.getElementById("errorBanner");
  const warningsContainer = document.getElementById("warningsContainer");
  const resultsSection = document.getElementById("resultsSection");

  const metaGrid = document.getElementById("metaGrid");
  const lawsGrid = document.getElementById("lawsGrid");
  const zipfCaption = document.getElementById("zipfCaption");
  const heapsCaption = document.getElementById("heapsCaption");
  const menzerathCaption = document.getElementById("menzerathCaption");

  const dispersionTable = document.getElementById("dispersionTable");
  const dispersionTbody = document.getElementById("dispersionTbody");
  const dispersionSummaryLine = document.getElementById("dispersionSummaryLine");
  const wordFilter = document.getElementById("wordFilter");
  const sortStatus = document.getElementById("sortStatus");

  const exportSummaryCsvBtn = document.getElementById("exportSummaryCsvBtn");
  const exportCsvBtn = document.getElementById("exportCsvBtn");

  // state
  let worker = null;
  let mainThreadPyodide = null;
  let runtimeReady = false;
  let requestCounter = 0;
  let lastResult = null;
  const charts = { zipf: null, heaps: null, menzerath: null };
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  // live word count regexes (matches tokenizer.py)
  const ARABIC_MARKS_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
  const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const LATIN_CHAR_RE = /\p{Script=Latin}/u;
  const WORD_COUNT_RE = /[\p{L}]+(?:['’-][\p{L}]+)*/gu;

  // busy + error state
  function setBusy(isBusy, bannerMessage = "Analyzing text…", buttonLabel = "Analyzing…") {
    busyBanner.hidden = !isBusy;
    if (isBusy) {
      busyText.textContent = bannerMessage;
      analyzeBtn.disabled = true;
      analyzeBtnSpinner.toggleAttribute("hidden", false);
      analyzeBtnZap.toggleAttribute("hidden", true);
      analyzeBtnText.textContent = buttonLabel;
    } else {
      analyzeBtn.disabled = !runtimeReady;
      analyzeBtnSpinner.toggleAttribute("hidden", runtimeReady);
      analyzeBtnZap.toggleAttribute("hidden", !runtimeReady);
      analyzeBtnText.textContent = runtimeReady ? "Analyze Text" : "Loading…";
    }
  }

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.hidden = false;
  }

  function hideError() {
    errorBanner.hidden = true;
    errorBanner.textContent = "";
  }

  // input text helpers
  function getInputText() {
    const blocks = [];
    for (const node of inputText.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const val = node.textContent.replace(/\r\n?/g, "\n");
        if (val.trim()) blocks.push(val);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const val = (node.innerText || node.textContent || "").replace(/\r\n?/g, "\n");
        if (val.trim()) blocks.push(val);
      }
    }
    return blocks.join("\n");
  }

  function setInputText(rawText) {
    const normalized = String(rawText || "").replace(/\r\n?/g, "\n");
    const paragraphs = normalized.split(/\n+/).filter((p) => p.trim().length > 0);
    if (!paragraphs.length) {
      inputText.replaceChildren();
      return;
    }
    const frag = document.createDocumentFragment();
    for (const para of paragraphs) {
      const p = document.createElement("p");
      p.dir = "auto";
      p.textContent = para;
      frag.appendChild(p);
    }
    inputText.replaceChildren(frag);
  }

  function syncInputLetterSpacing() {
    if (inputText.children.length === 0) {
      const txt = inputText.textContent || "";
      inputText.classList.toggle("is-latin", !txt.trim() || (LATIN_CHAR_RE.test(txt) && !ARABIC_SCRIPT_RE.test(txt)));
      return;
    }
    inputText.classList.remove("is-latin");
    for (const child of inputText.children) {
      const txt = child.textContent || "";
      child.classList.toggle("is-latin", LATIN_CHAR_RE.test(txt) && !ARABIC_SCRIPT_RE.test(txt));
    }
  }

  function updateInputCounter() {
    syncInputLetterSpacing();
    const text = getInputText();
    const chars = text.length;
    const normalized = text.normalize("NFC").replace(ARABIC_MARKS_RE, "");
    const matches = normalized.match(WORD_COUNT_RE);
    const words = matches ? matches.length : 0;
    inputCounter.textContent =
      `${words.toLocaleString()} word${words === 1 ? "" : "s"} • ${chars.toLocaleString()} character${chars === 1 ? "" : "s"}`;
  }

  // pyodide runtime init
  function loadExternalScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}. Check your internet connection.`));
      document.head.appendChild(script);
    });
  }

  async function initMainThreadPyodide() {
    try {
      setBusy(true, "Preparing text analyzer…", "Loading…");
      await loadExternalScript(`${PYODIDE_BASE}pyodide.js`);
      mainThreadPyodide = await window.loadPyodide({ indexURL: PYODIDE_BASE });

      const files = window.LEXIMETRICA_PY_FILES;
      if (!files) {
        throw new Error("Embedded analyzer bundle (py_bundle.js) is missing.");
      }

      mainThreadPyodide.FS.mkdirTree("/home/pyodide/leximetrica");
      for (const [name, source] of Object.entries(files)) {
        mainThreadPyodide.FS.writeFile(`/home/pyodide/leximetrica/${name}`, source, { encoding: "utf8" });
      }

      await mainThreadPyodide.runPythonAsync(`
import sys, json
if "/home/pyodide" not in sys.path:
    sys.path.insert(0, "/home/pyodide")
import leximetrica

def _run_analysis(text, num_segments, min_freq, lowercase):
    result = leximetrica.analyze_text(
        text,
        num_segments=int(num_segments),
        min_freq=int(min_freq),
        lowercase=bool(lowercase),
    )
    return json.dumps(result, ensure_ascii=False)
`);

      onRuntimeReady();
    } catch (err) {
      setBusy(false);
      showError(`Could not initialize analyzer: ${err.message}`);
    }
  }

  function initWorkerRuntime() {
    setBusy(true, "Preparing text analyzer…", "Loading…");
    try {
      worker = new Worker("./worker.js");
    } catch {
      initMainThreadPyodide();
      return;
    }

    worker.addEventListener("message", (event) => {
      const msg = event.data || {};
      if (msg.type === "status") {
        if (runtimeReady) {
          setBusy(true, "Analyzing text…", "Analyzing…");
        }
        return;
      }

      if (msg.type === "ready") {
        onRuntimeReady();
        return;
      }

      if (msg.type === "result") {
        setBusy(false);
        hideError();
        lastResult = msg.data;
        renderReport(lastResult);
        return;
      }

      if (msg.type === "error") {
        setBusy(false);
        showError(`Analysis error: ${msg.message}`);
      }
    });

    worker.addEventListener("error", () => {
      if (!runtimeReady) {
        worker.terminate();
        worker = null;
        initMainThreadPyodide();
      } else {
        setBusy(false);
        showError("Background analyzer encountered an unexpected error.");
      }
    });

    worker.postMessage({ type: "init" });
  }

  function onRuntimeReady() {
    runtimeReady = true;
    setBusy(false);
    if (getInputText().trim()) {
      triggerAnalysis();
    }
  }

  // run analysis
  function triggerAnalysis() {
    if (!runtimeReady) return;
    const text = getInputText();
    if (!text.trim()) {
      showError("Please enter text or select a sample above first.");
      return;
    }

    hideError();
    const numSegments = Math.max(2, Math.min(50, Number(numSegmentsInput.value) || 10));
    const minFreq = Math.max(1, Math.min(50, Number(minFreqInput.value) || 2));
    numSegmentsInput.value = String(numSegments);
    minFreqInput.value = String(minFreq);

    const payload = {
      text,
      numSegments,
      minFreq,
      lowercase: lowercaseCheckbox.checked,
    };

    setBusy(true, "Analyzing text…", "Analyzing…");

    if (worker) {
      worker.postMessage({ type: "analyze", id: ++requestCounter, payload });
      return;
    }

    setTimeout(() => {
      try {
        const runFn = mainThreadPyodide.globals.get("_run_analysis");
        const jsonStr = runFn(
          payload.text,
          payload.numSegments,
          payload.minFreq,
          payload.lowercase
        );
        runFn.destroy();
        lastResult = JSON.parse(jsonStr);
        setBusy(false);
        renderReport(lastResult);
      } catch (err) {
        setBusy(false);
        showError(`Analysis error: ${err.message}`);
      }
    }, 20);
  }

  // render results
  function fmt(val, digits = 3) {
    return val === null || val === undefined || Number.isNaN(val)
      ? "-"
      : Number(val).toFixed(digits);
  }

  function renderReport(data) {
    resultsSection.hidden = false;

    warningsContainer.replaceChildren();
    if (data.warnings && data.warnings.length) {
      warningsContainer.hidden = false;
      for (const w of data.warnings) {
        const div = document.createElement("div");
        div.className = "status-banner status-banner--warn";
        div.textContent = w;
        warningsContainer.appendChild(div);
      }
    } else {
      warningsContainer.hidden = true;
    }

    renderStats(data);
    renderCharts(data);
    renderDispersionTable(data.dispersion);
  }

  function makeStatBox(label, value, subtext = "") {
    const box = document.createElement("div");
    box.className = "stat-box";
    const lbl = document.createElement("div");
    lbl.className = "stat-label";
    lbl.textContent = label;
    const val = document.createElement("div");
    val.className = "stat-val";
    val.textContent = value;
    box.append(lbl, val);
    if (subtext) {
      const sub = document.createElement("div");
      sub.className = "stat-sub";
      sub.textContent = subtext;
      box.appendChild(sub);
    }
    return box;
  }

  function renderStats(data) {
    const m = data.meta;
    metaGrid.replaceChildren(
      makeStatBox("Tokens (N)", m.total_tokens.toLocaleString()),
      makeStatBox("Types (V)", m.vocab_size.toLocaleString()),
      makeStatBox("Sentences", m.num_sentences.toLocaleString()),
      makeStatBox("Mean Word Len", `${m.mean_word_length} ch`),
      makeStatBox("Mean Sent Len", `${m.mean_sentence_length} w`),
      makeStatBox("Segments (n)", String(m.num_segments))
    );

    const { zipf, heaps, entropy, menzerath_altmann: ma, signatures: sig } = data.laws;
    const dispSum = data.dispersion.summary;

    lawsGrid.replaceChildren(
      makeStatBox(
        "Zipf Exponent (α)",
        fmt(zipf.alpha, 3),
        `R² = ${fmt(zipf.r_squared, 3)} · natural prose ≈ 0.8-1.2`
      ),
      makeStatBox(
        "Heaps Exponent (β)",
        fmt(heaps.beta, 3),
        `K = ${fmt(heaps.k, 2)} · R² = ${fmt(heaps.r_squared, 3)}`
      ),
      makeStatBox(
        "Shannon Entropy (H)",
        entropy.entropy_bits !== null ? `${fmt(entropy.entropy_bits, 2)} bits` : "-",
        `Evenness J = ${fmt(entropy.evenness_j, 3)} · Redundancy = ${fmt(entropy.redundancy, 3)}`
      ),
      makeStatBox(
        "Menzerath-Altmann (r)",
        fmt(ma.pearson_r, 3),
        `Slope = ${fmt(ma.slope, 4)} across ${ma.num_sentences} sentences`
      ),
      makeStatBox(
        "Mean Gries DP_norm",
        fmt(dispSum.mean_dp_norm, 3),
        `Mean Juilland D = ${fmt(dispSum.mean_juilland_d, 3)} (${dispSum.analyzed_types} types)`
      ),
      makeStatBox(
        "Mean Burstiness (B)",
        fmt(dispSum.mean_burstiness, 3),
        "-1 periodic · 0 Poisson · +1 bursty"
      ),
      makeStatBox(
        "Yule's K & Herdan's C",
        fmt(sig.yules_k, 1),
        `Herdan's C = ${fmt(sig.herdan_c, 3)} · TTR = ${fmt(sig.ttr, 3)}`
      ),
      makeStatBox(
        "Hapax / Dis Legomena",
        sig.hapax_ratio_types !== null ? `${(sig.hapax_ratio_types * 100).toFixed(1)}%` : "-",
        `${sig.hapax_count} hapax · ${sig.dis_count} dis legomena`
      )
    );
  }

  // chart configs + png export
  function buildChartConfig(key, data, scale = 1) {
    const pal = {
      text: "#334155",
      title: "#0f172a",
      muted: "#64748b",
      grid: "rgba(15, 23, 42, 0.08)",
      slate: "#0f172a",
      red: "#c1272d",
    };

    const fontFamily = "'IBM Plex Mono', 'Noto Naskh Arabic', monospace";
    const tickFont = { family: fontFamily, size: Math.round(11 * scale) };
    const axisFont = { family: fontFamily, size: Math.round(12 * scale), weight: "600" };
    const legendFont = { family: fontFamily, size: Math.round(11 * scale) };
    const isExport = scale > 1;

    const exportHeaderPlugins = (titleText, subtitleText) =>
      isExport
        ? {
            title: {
              display: true,
              text: titleText,
              color: pal.title,
              font: { family: fontFamily, size: 34, weight: "700" },
              padding: { top: 20, bottom: 8 },
            },
            subtitle: {
              display: Boolean(subtitleText),
              text: subtitleText,
              color: pal.muted,
              font: { family: fontFamily, size: 22, weight: "400" },
              padding: { bottom: 26 },
            },
          }
        : {};

    const baseLayout = isExport ? { padding: { top: 24, right: 48, bottom: 58, left: 36 } } : {};

    if (key === "zipf") {
      const zipf = data.laws.zipf;
      const caption =
        zipf.alpha !== null
          ? `Fitted: f(r) ≈ ${zipf.constant} · r^(−${zipf.alpha}) (R² = ${zipf.r_squared})`
          : "Not enough distinct word ranks for regression.";
      return {
        caption,
        fileBase: "leximetrica-zipf-law",
        config: {
          type: "scatter",
          data: {
            datasets: [
              {
                label: "Observed (rank, freq)",
                data: zipf.points.map((p) => ({ x: p.rank, y: p.freq, word: p.word })),
                backgroundColor: pal.slate,
                pointRadius: 3.5 * scale,
              },
              {
                label: "Zipf OLS Fit",
                type: "line",
                data: zipf.points.map((p) => ({ x: p.rank, y: p.fitted })),
                borderColor: pal.red,
                borderWidth: 2 * scale,
                pointRadius: 0,
                tension: 0,
              },
            ],
          },
          options: {
            responsive: !isExport,
            maintainAspectRatio: false,
            animation: isExport ? false : undefined,
            layout: baseLayout,
            plugins: {
              ...exportHeaderPlugins("Zipf's Law (Log-Log Rank-Frequency)", caption),
              legend: { labels: { color: pal.text, font: legendFont, padding: Math.round(14 * scale) } },
              tooltip: {
                enabled: !isExport,
                callbacks: {
                  label: (ctx) => {
                    const raw = ctx.raw;
                    return raw.word
                      ? `"${raw.word}" - rank ${raw.x}, freq ${raw.y}`
                      : `Fitted: ${Number(raw.y).toFixed(2)} at rank ${raw.x}`;
                  },
                },
              },
            },
            scales: {
              x: {
                type: "logarithmic",
                title: { display: true, text: "Rank (log)", color: pal.text, font: axisFont },
                ticks: { color: pal.text, font: tickFont },
                grid: { color: pal.grid, lineWidth: scale },
              },
              y: {
                type: "logarithmic",
                title: { display: true, text: "Frequency (log)", color: pal.text, font: axisFont },
                ticks: { color: pal.text, font: tickFont },
                grid: { color: pal.grid, lineWidth: scale },
              },
            },
          },
        },
      };
    }

    if (key === "heaps") {
      const heaps = data.laws.heaps;
      const caption =
        heaps.beta !== null
          ? `Fitted: V(N) ≈ ${heaps.k} · N^${heaps.beta} (R² = ${heaps.r_squared})`
          : "Not enough tokens for vocabulary growth fit.";
      return {
        caption,
        fileBase: "leximetrica-heaps-law",
        config: {
          type: "line",
          data: {
            datasets: [
              {
                label: "Observed Types V(N)",
                data: heaps.points.map((p) => ({ x: p.n, y: p.v })),
                borderColor: pal.slate,
                backgroundColor: pal.slate,
                borderWidth: 2.2 * scale,
                pointRadius: 0,
              },
              {
                label: "Heaps Fit",
                data: heaps.points.map((p) => ({ x: p.n, y: p.fitted })),
                borderColor: pal.red,
                borderDash: [6 * scale, 4 * scale],
                borderWidth: 2 * scale,
                pointRadius: 0,
              },
            ],
          },
          options: {
            responsive: !isExport,
            maintainAspectRatio: false,
            animation: isExport ? false : undefined,
            parsing: false,
            layout: baseLayout,
            plugins: {
              ...exportHeaderPlugins("Heaps' Law (Vocabulary Growth)", caption),
              legend: { labels: { color: pal.text, font: legendFont, padding: Math.round(14 * scale) } },
              tooltip: { enabled: !isExport },
            },
            scales: {
              x: {
                type: "linear",
                title: { display: true, text: "Running Tokens (N)", color: pal.text, font: axisFont },
                ticks: { color: pal.text, font: tickFont },
                grid: { color: pal.grid, lineWidth: scale },
              },
              y: {
                type: "linear",
                title: { display: true, text: "Unique Types (V)", color: pal.text, font: axisFont },
                ticks: { color: pal.text, font: tickFont },
                grid: { color: pal.grid, lineWidth: scale },
              },
            },
          },
        },
      };
    }

    // menzerath-altmann
    const ma = data.laws.menzerath_altmann;
    const caption =
      ma.pearson_r !== null
        ? `Pearson r = ${ma.pearson_r} · slope = ${ma.slope} chars/word per extra word in sentence (${ma.num_sentences} sentences)`
        : `Detected ${ma.num_sentences} sentence(s); add more sentences to evaluate trend.`;
    return {
      caption,
      fileBase: "leximetrica-menzerath-altmann-law",
      config: {
        type: "scatter",
        data: {
          datasets: [
            {
              label: "Mean Word Length by Sentence Length",
              data: ma.binned_points.map((p) => ({
                x: p.sentence_length,
                y: p.mean_word_length,
                count: p.count,
              })),
              backgroundColor: pal.slate,
              pointRadius: 5 * scale,
            },
            ...(ma.binned_points.length >= 2 && ma.slope !== null
              ? [
                  {
                    label: "Linear Trend",
                    type: "line",
                    data: ma.binned_points.map((p) => ({
                      x: p.sentence_length,
                      y: p.fitted,
                    })),
                    borderColor: pal.red,
                    borderWidth: 2.2 * scale,
                    pointRadius: 0,
                  },
                ]
              : []),
          ],
        },
        options: {
          responsive: !isExport,
          maintainAspectRatio: false,
          animation: isExport ? false : undefined,
          layout: isExport ? baseLayout : { padding: { top: 8, right: 16, bottom: 8, left: 8 } },
          plugins: {
            ...exportHeaderPlugins("Menzerath-Altmann Law (Sentence Length vs. Mean Word Length)", caption),
            legend: { labels: { color: pal.text, font: legendFont, padding: Math.round(16 * scale) } },
            tooltip: {
              enabled: !isExport,
              callbacks: {
                label: (ctx) => {
                  const raw = ctx.raw;
                  return raw.count !== undefined
                    ? `Sent len ${raw.x}w → mean ${raw.y} chars (${raw.count} sent)`
                    : `Trend: ${raw.y} chars`;
                },
              },
            },
          },
          scales: {
            x: {
              type: "linear",
              grace: "5%",
              title: { display: true, text: "Sentence Length (words)", color: pal.text, font: axisFont, padding: { top: Math.round(10 * scale) } },
              ticks: { color: pal.text, font: tickFont, padding: Math.round(6 * scale) },
              grid: { color: pal.grid, lineWidth: scale },
            },
            y: {
              type: "linear",
              grace: "12%",
              title: { display: true, text: "Mean Word Length (chars)", color: pal.text, font: axisFont, padding: { bottom: Math.round(10 * scale) } },
              ticks: { color: pal.text, font: tickFont, padding: Math.round(6 * scale) },
              grid: { color: pal.grid, lineWidth: scale },
            },
          },
        },
      },
    };
  }

  function renderCharts(data) {
    if (typeof window.Chart === "undefined") return;

    const specs = [
      ["zipf", "zipfChart", zipfCaption],
      ["heaps", "heapsChart", heapsCaption],
      ["menzerath", "menzerathChart", menzerathCaption],
    ];

    for (const [key, canvasId, captionEl] of specs) {
      const built = buildChartConfig(key, data, 1);
      captionEl.textContent = built.caption;
      if (charts[key]) charts[key].destroy();
      charts[key] = new window.Chart(document.getElementById(canvasId), built.config);
    }
  }

  function exportHighResChart(key) {
    if (!lastResult || typeof window.Chart === "undefined") return;

    // 2400x1440 white-bg png with corner watermark
    const offscreen = document.createElement("canvas");
    offscreen.width = 2400;
    offscreen.height = 1440;

    const built = buildChartConfig(key, lastResult, 2.2);
    const exportDecorPlugin = {
      id: "leximetricaExportDecor",
      beforeDraw(chart) {
        const ctx = chart.ctx;
        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, chart.width, chart.height);
        ctx.restore();
      },
      afterDraw(chart) {
        const ctx = chart.ctx;
        ctx.save();
        ctx.font = "500 22px 'IBM Plex Mono', monospace";
        ctx.fillStyle = "rgba(15, 23, 42, 0.35)";
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText(`${APP_NAME} (${APP_VERSION}) · NLP4Ed.com`, chart.width - 42, chart.height - 18);
        ctx.restore();
      },
    };

    const exportChart = new window.Chart(offscreen, {
      ...built.config,
      plugins: [exportDecorPlugin],
    });

    exportChart.update("none");
    const dataUrl = offscreen.toDataURL("image/png", 1.0);
    exportChart.destroy();

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${built.fileBase}-${getExportTimestamp()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // sortable dispersion table
  function makeNumericCell(rawValue, displayText, extraClass = "") {
    const td = document.createElement("td");
    td.dataset.numeric = "true";
    td.dataset.value = rawValue === null || rawValue === undefined ? "" : String(rawValue);
    td.textContent = displayText;
    if (extraClass) td.className = extraClass;
    return td;
  }

  function makeSparkCell(segmentCounts) {
    const td = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = "spark-bars";
    const maxVal = Math.max(1, ...segmentCounts);
    wrap.title = `Segment counts: [${segmentCounts.join(", ")}]`;
    wrap.setAttribute("aria-label", `Occurrences per segment: ${segmentCounts.join(", ")}`);

    for (const count of segmentCounts) {
      const bar = document.createElement("span");
      bar.className = count > 0 ? "spark-bar spark-bar--active" : "spark-bar";
      const pct = count > 0 ? Math.max(20, Math.round((count / maxVal) * 100)) : 12;
      bar.style.height = `${pct}%`;
      wrap.appendChild(bar);
    }
    td.appendChild(wrap);
    return td;
  }

  function renderDispersionTable(dispersion) {
    const words = dispersion.words || [];
    const numSegs = dispersion.segment_sizes ? dispersion.segment_sizes.length : 0;

    dispersionSummaryLine.textContent = words.length
      ? `Showing ${words.length} word types (freq ≥ ${lastResult.meta.min_freq}) across ${numSegs} corpus segments.`
      : "No words met the minimum frequency threshold. Try lowering Min. freq.";

    const fragment = document.createDocumentFragment();
    for (const row of words) {
      const tr = document.createElement("tr");
      tr.dataset.word = row.word.toLowerCase();

      const th = document.createElement("th");
      th.scope = "row";
      th.dir = "auto";
      th.textContent = row.word;

      const dpClass =
        row.gries_dp_norm <= 0.35
          ? "badge-even"
          : row.gries_dp_norm >= 0.75
            ? "badge-clumped"
            : "";

      tr.append(
        th,
        makeNumericCell(row.freq, String(row.freq)),
        makeNumericCell(row.range_pct, `${row.range_segments}/${numSegs} (${row.range_pct}%)`),
        makeNumericCell(row.gries_dp, fmt(row.gries_dp, 3)),
        makeNumericCell(row.gries_dp_norm, fmt(row.gries_dp_norm, 3), dpClass),
        makeNumericCell(row.juilland_d, fmt(row.juilland_d, 3)),
        makeNumericCell(row.carroll_d2, fmt(row.carroll_d2, 3)),
        makeNumericCell(row.rosengren_s, fmt(row.rosengren_s, 3)),
        makeNumericCell(
          row.burstiness_b,
          row.burstiness_b !== null ? fmt(row.burstiness_b, 3) : "-"
        ),
        makeSparkCell(row.segment_counts)
      );
      fragment.appendChild(tr);
    }

    dispersionTbody.replaceChildren(fragment);

    for (const header of dispersionTable.tHead.rows[0].cells) {
      header.removeAttribute("aria-sort");
    }
    dispersionTable.tHead.rows[0].cells[1].setAttribute("aria-sort", "descending");
    wordFilter.value = "";
  }

  function handleTableSort(sourceButton) {
    const th = sourceButton.closest("th");
    if (!th) return;

    const direction = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
    for (const header of dispersionTable.tHead.rows[0].cells) {
      header.removeAttribute("aria-sort");
    }
    th.setAttribute("aria-sort", direction);

    const colIndex = th.cellIndex;
    const colType = th.dataset.type || "text";
    const factor = direction === "ascending" ? 1 : -1;

    const entries = [...dispersionTbody.rows].map((row) => {
      const cell = row.cells[colIndex];
      const raw = cell.dataset.value !== undefined ? cell.dataset.value : cell.textContent.trim();
      const num = colType === "number" ? (raw === "" ? Number.NaN : Number(raw)) : Number.NaN;
      return { row, raw, num };
    });

    entries.sort((a, b) => {
      if (colType === "number") {
        const aMissing = Number.isNaN(a.num);
        const bMissing = Number.isNaN(b.num);
        if (aMissing && bMissing) return 0;
        if (aMissing) return 1;
        if (bMissing) return -1;
        return factor * (a.num - b.num);
      }
      return factor * collator.compare(a.raw, b.raw);
    });

    const useMoveBefore = typeof dispersionTbody.moveBefore === "function";
    for (const { row } of entries) {
      if (useMoveBefore) {
        dispersionTbody.moveBefore(row, null);
      } else {
        dispersionTbody.appendChild(row);
      }
    }

    sortStatus.textContent = `Sorted by ${sourceButton.textContent.trim()}, ${direction}, ${entries.length} rows`;
  }

  dispersionTable.addEventListener("command", (event) => {
    if (event.command !== "--sort") return;
    handleTableSort(event.source);
  });

  if (!("commandForElement" in HTMLButtonElement.prototype)) {
    dispersionTable.tHead.addEventListener("click", (event) => {
      const btn = event.target.closest('button[command="--sort"]');
      if (btn) handleTableSort(btn);
    });
  }

  wordFilter.addEventListener("input", () => {
    const query = wordFilter.value.trim().toLowerCase();
    for (const row of dispersionTbody.rows) {
      const match = !query || (row.dataset.word || "").includes(query);
      row.hidden = !match;
    }
  });

  // csv + png exports
  function getExportTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    );
  }

  function escapeCsvValue(value) {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  }

  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  exportSummaryCsvBtn.addEventListener("click", () => {
    if (!lastResult) return;
    const m = lastResult.meta;
    const { zipf, heaps, entropy, menzerath_altmann: ma, signatures: sig } = lastResult.laws;
    const d = lastResult.dispersion.summary;

    const rows = [
      ["Corpus", "Tokens (N)", m.total_tokens],
      ["Corpus", "Types (V)", m.vocab_size],
      ["Corpus", "Sentences", m.num_sentences],
      ["Corpus", "Mean Word Length (chars)", m.mean_word_length],
      ["Corpus", "Mean Sentence Length (words)", m.mean_sentence_length],
      ["Corpus", "Segments (n)", m.num_segments],
      ["Corpus", "Minimum Word Frequency", m.min_freq],
      ["Zipf's Law", "Exponent (alpha)", zipf.alpha],
      ["Zipf's Law", "Constant (C)", zipf.constant],
      ["Zipf's Law", "Fit R^2", zipf.r_squared],
      ["Heaps' Law", "Constant (K)", heaps.k],
      ["Heaps' Law", "Exponent (beta)", heaps.beta],
      ["Heaps' Law", "Fit R^2", heaps.r_squared],
      ["Information Theory", "Shannon Entropy H (bits)", entropy.entropy_bits],
      ["Information Theory", "Max Entropy H_max (bits)", entropy.max_entropy_bits],
      ["Information Theory", "Pielou's Evenness (J)", entropy.evenness_j],
      ["Information Theory", "Redundancy (1 - J)", entropy.redundancy],
      ["Menzerath-Altmann", "Pearson r", ma.pearson_r],
      ["Menzerath-Altmann", "Linear Slope", ma.slope],
      ["Menzerath-Altmann", "Fit R^2", ma.r_squared],
      ["Lexical Signatures", "Yule's K", sig.yules_k],
      ["Lexical Signatures", "Herdan's C", sig.herdan_c],
      ["Lexical Signatures", "Type-Token Ratio (TTR)", sig.ttr],
      ["Lexical Signatures", "Hapax Legomena Count", sig.hapax_count],
      ["Lexical Signatures", "Hapax Ratio (Types)", sig.hapax_ratio_types],
      ["Lexical Signatures", "Dis Legomena Count", sig.dis_count],
      ["Lexical Signatures", "Dis Ratio (Types)", sig.dis_ratio_types],
      ["Dispersion Summary", "Analyzed Word Types", d.analyzed_types],
      ["Dispersion Summary", "Mean Gries DP_norm", d.mean_dp_norm],
      ["Dispersion Summary", "Mean Juilland D", d.mean_juilland_d],
      ["Dispersion Summary", "Mean Burstiness (B)", d.mean_burstiness],
    ];

    const lines = [
      `# Generated by ${APP_NAME} (${APP_VERSION}) - NLP4Ed.com`,
      "category,metric,value",
      ...rows.map((r) => r.map(escapeCsvValue).join(",")),
    ];
    downloadBlob(
      "\uFEFF" + lines.join("\n"),
      `leximetrica-summary-${getExportTimestamp()}.csv`,
      "text/csv;charset=utf-8"
    );
  });

  exportCsvBtn.addEventListener("click", () => {
    if (!lastResult) return;
    const header = [
      "word",
      "freq",
      "rel_freq_per_1k",
      "range_segments",
      "range_pct",
      "gries_dp",
      "gries_dp_norm",
      "juilland_d",
      "carroll_d2",
      "rosengren_s",
      "burstiness_b",
    ];
    const lines = [
      `# Generated by ${APP_NAME} (${APP_VERSION}) - NLP4Ed.com`,
      header.join(","),
      ...lastResult.dispersion.words.map((row) =>
        header.map((col) => escapeCsvValue(row[col])).join(",")
      ),
    ];
    downloadBlob(
      "\uFEFF" + lines.join("\n"),
      `leximetrica-dispersion-${getExportTimestamp()}.csv`,
      "text/csv;charset=utf-8"
    );
  });

  document.querySelectorAll("[data-export-chart]").forEach((btn) => {
    btn.addEventListener("click", () => {
      exportHighResChart(btn.dataset.exportChart);
    });
  });

  // events + boot
  // preload arabic font to avoid swap flash
  if (document.fonts && typeof document.fonts.load === "function") {
    document.fonts.load('400 16px "Noto Naskh Arabic"', "فاس").catch(() => {});
  }

  // paste as plain text
  inputText.addEventListener("paste", (event) => {
    event.preventDefault();
    const plain = (event.clipboardData || window.clipboardData).getData("text/plain") || "";
    if (!plain) return;
    const existing = getInputText();
    if (!existing.trim()) {
      setInputText(plain);
    } else {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(plain));
        range.collapse(false);
      }
    }
    updateInputCounter();
  });

  document.querySelectorAll("[data-sample]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sample;
      const sample = window.LEXIMETRICA_SAMPLES && window.LEXIMETRICA_SAMPLES[key];
      if (sample) {
        setInputText(sample.text);
        updateInputCounter();
        if (runtimeReady) triggerAnalysis();
      }
    });
  });

  fileUploadInput.addEventListener("change", async () => {
    const file = fileUploadInput.files && fileUploadInput.files[0];
    if (!file) return;
    try {
      setInputText(await file.text());
      updateInputCounter();
      if (runtimeReady) triggerAnalysis();
    } catch (err) {
      showError(`Could not read file: ${err.message}`);
    } finally {
      fileUploadInput.value = "";
    }
  });

  inputText.addEventListener("input", () => {
    // keep :empty placeholder working
    if (!inputText.textContent.trim()) {
      inputText.replaceChildren();
    }
    updateInputCounter();
  });

  clearBtn.addEventListener("click", () => {
    inputText.replaceChildren();
    updateInputCounter();
    hideError();
    inputText.focus();
  });

  analyzeBtn.addEventListener("click", triggerAnalysis);
  inputText.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      triggerAnalysis();
    }
  });

  // load default sample + boot runtime
  if (window.LEXIMETRICA_SAMPLES && window.LEXIMETRICA_SAMPLES.english) {
    setInputText(window.LEXIMETRICA_SAMPLES.english.text);
  }
  updateInputCounter();

  if (IS_FILE_PROTOCOL) {
    initMainThreadPyodide();
  } else {
    initWorkerRuntime();
  }
})();
