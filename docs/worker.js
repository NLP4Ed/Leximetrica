/* pyodide worker for http/s */

const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/";
const PY_MODULES = [
  "__init__.py",
  "tokenizer.py",
  "laws.py",
  "dispersion.py",
  "analyzer.py",
];

let pyodide = null;
let initPromise = null;

async function initializePyodide() {
  self.postMessage({ type: "status", state: "loading", message: "Loading Python runtime…" });

  importScripts(`${PYODIDE_BASE}pyodide.js`);
  pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });

  self.postMessage({ type: "status", state: "loading", message: "Loading Leximetrica modules…" });

  pyodide.FS.mkdirTree("/home/pyodide/leximetrica");
  await Promise.all(
    PY_MODULES.map(async (filename) => {
      const url = new URL(`./py/${filename}`, self.location.href);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch Python module ${filename} (HTTP ${response.status})`);
      }
      const source = await response.text();
      pyodide.FS.writeFile(`/home/pyodide/leximetrica/${filename}`, source, { encoding: "utf8" });
    })
  );

  await pyodide.runPythonAsync(`
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

  self.postMessage({ type: "ready" });
}

self.addEventListener("message", async (event) => {
  const { type, id, payload } = event.data || {};

  try {
    if (type === "init") {
      if (!initPromise) {
        initPromise = initializePyodide();
      }
      await initPromise;
      return;
    }

    if (type === "analyze") {
      if (!initPromise) {
        initPromise = initializePyodide();
      }
      await initPromise;

      self.postMessage({ type: "status", state: "analyzing", message: "Computing quantitative laws & dispersion…" });

      const runFn = pyodide.globals.get("_run_analysis");
      const jsonStr = runFn(
        payload.text ?? "",
        payload.numSegments ?? 10,
        payload.minFreq ?? 2,
        payload.lowercase ?? true
      );
      runFn.destroy();

      const data = JSON.parse(jsonStr);
      self.postMessage({ type: "result", id, data });
    }
  } catch (err) {
    self.postMessage({
      type: "error",
      id,
      message: err?.message || String(err),
    });
  }
});
