/* Perceptron Trainer CODAP Plugin (CSP-safe)
   Requires index.html to load CODAP plugin API bundle:
     <script src="https://codap.concord.org/releases/latest/codap-plugin-api.js"></script>

   Dataset expectations (student datasets):
     - Cbest (numeric)
     - Cbad  (numeric)
     - Sentiment (numeric, -1 or +1)

   Sample dataset comes from sample-data.js as window.SAMPLE_DATASET
*/

(() => {
  const $ = (sel) => document.querySelector(sel);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const sign = (z) => (z >= 0 ? 1 : -1);
  const fmt = (n) => (typeof n === "number" && isFinite(n) ? (Math.round(n * 1000) / 1000).toString() : "—");

  // --- Small SVG "graph" coordinate system ---
  // Here we treat Cbest, Cbad as axes (like x,y).
  const world = { xmin: -0.5, xmax: 3.5, ymin: -0.5, ymax: 3.5 };
  const svgSize = { w: 600, h: 400 };
  const xToPx = (x) => ((x - world.xmin) / (world.xmax - world.xmin)) * svgSize.w;
  const yToPx = (y) => (1 - (y - world.ymin) / (world.ymax - world.ymin)) * svgSize.h;

  // --- CODAP API ---
  /** @type {any} */
  let codap = null;

  async function codapRequest(cmd) {
    // CodapPluginApi exposes sendRequest({action, resource, values})
    const res = await codap.sendRequest(cmd);
    // res generally has {success, values}
    if (res && res.success === false) {
      const msg = (res.values && res.values.error) || res.values || res;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return res;
  }

  // --- Plugin state ---
  const state = {
    dataContextName: null,
    collectionName: null,
    cases: [],
    index: 0,
    epoch: 0,
    phase: "TRAIN_SINGLE", // TRAIN_SINGLE | EVAL
    w1: 0.4,
    w2: -0.4,
    c: 2,
    learnRate: 0.1
  };

  // --- DOM refs ---
  const viz = $("#viz");

  // --- Perceptron math ---
  function score(pt) {
    return state.w1 * pt.Cbest + state.w2 * pt.Cbad + state.c;
  }
  function predict(pt) {
    return sign(score(pt));
  }
  function deltas(pt, sentiment) {
    return {
      dw1: state.learnRate * sentiment * pt.Cbest,
      dw2: state.learnRate * sentiment * pt.Cbad,
      dc: state.learnRate * sentiment
    };
  }

  function currentCase() {
    if (!state.cases.length) return null;
    return state.cases[state.index % state.cases.length];
  }

  // --- UI helpers ---
  function showAlert(msg) {
    $("#alertMsg").textContent = msg || "Check again! Does the current rule properly predict this point?";
    $("#alertDlg").showModal();
  }

  function syncSliders() {
    $("#w1").value = state.w1;
    $("#w2").value = state.w2;
    $("#c").value = state.c;
    $("#lr").value = state.learnRate;

    $("#w1Val").textContent = fmt(state.w1);
    $("#w2Val").textContent = fmt(state.w2);
    $("#cVal").textContent = fmt(state.c);
    $("#lrVal").textContent = fmt(state.learnRate);
  }

  function updatePanel() {
    const ca = currentCase();
    if (!ca) {
      $("#ptInfo").textContent = "—";
      $("#indexInfo").textContent = "—";
      $("#epochInfo").textContent = fmt(state.epoch);
      $("#scoreInfo").textContent = "—";
      $("#predInfo").textContent = "—";
      $("#sentInfo").textContent = "—";
      $("#mistakeInfo").textContent = "—";
      $("#deltaInfo").textContent = "";
      return;
    }

    const pt = { Cbest: +ca.values.Cbest, Cbad: +ca.values.Cbad };
    const sent = +ca.values.Sentiment;
    const z = score(pt);
    const pred = sign(z);
    const correct = pred === sent;

    const id = ca.values.ID ? `${ca.values.ID} ` : "";
    $("#ptInfo").textContent = `${id}(Cbest=${fmt(pt.Cbest)}, Cbad=${fmt(pt.Cbad)})`;
    $("#indexInfo").textContent = `${(state.index % state.cases.length) + 1}/${state.cases.length}`;
    $("#epochInfo").textContent = fmt(state.epoch);
    $("#scoreInfo").textContent = fmt(z);
    $("#predInfo").textContent = pred === 1 ? "+1 (positive)" : "-1 (negative)";
    $("#sentInfo").textContent = sent === 1 ? "+1 (positive)" : "-1 (negative)";
    $("#mistakeInfo").textContent = correct ? "No" : "Yes";

    if (!correct) {
      const d = deltas(pt, sent);
      $("#deltaInfo").textContent = `Δw1=${fmt(d.dw1)}  Δw2=${fmt(d.dw2)}  Δc=${fmt(d.dc)}`;
    } else {
      $("#deltaInfo").textContent = "";
    }
  }

  // --- SVG drawing ---
  function clearViz() {
    while (viz.firstChild) viz.removeChild(viz.firstChild);
  }

  function drawGrid() {
    // light grid for integer counts 0..3
    for (let xi = Math.ceil(world.xmin); xi <= Math.floor(world.xmax); xi++) {
      const x = xToPx(xi);
      const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
      l.setAttribute("x1", x);
      l.setAttribute("x2", x);
      l.setAttribute("y1", 0);
      l.setAttribute("y2", svgSize.h);
      l.setAttribute("stroke", "#f0f0f0");
      viz.appendChild(l);
    }
    for (let yi = Math.ceil(world.ymin); yi <= Math.floor(world.ymax); yi++) {
      const y = yToPx(yi);
      const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
      l.setAttribute("x1", 0);
      l.setAttribute("x2", svgSize.w);
      l.setAttribute("y1", y);
      l.setAttribute("y2", y);
      l.setAttribute("stroke", "#f0f0f0");
      viz.appendChild(l);
    }
  }

  function boundarySegment(w1, w2, c) {
    const pts = [];
    const { xmin, xmax, ymin, ymax } = world;

    function add(x, y) {
      if (!isFinite(x) || !isFinite(y)) return;
      if (x >= xmin - 1e-6 && x <= xmax + 1e-6 && y >= ymin - 1e-6 && y <= ymax + 1e-6) {
        pts.push({ x, y });
      }
    }

    // w1*x + w2*y + c = 0
    if (Math.abs(w2) > 1e-9) {
      add(xmin, (-c - w1 * xmin) / w2);
      add(xmax, (-c - w1 * xmax) / w2);
    }
    if (Math.abs(w1) > 1e-9) {
      add((-c - w2 * ymin) / w1, ymin);
      add((-c - w2 * ymax) / w1, ymax);
    }

    const uniq = [];
    for (const p of pts) {
      if (!uniq.some(q => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6)) uniq.push(p);
    }
    return uniq.slice(0, 2);
  }

  function drawBoundary(w1, w2, c, opts = {}) {
    const seg = boundarySegment(w1, w2, c);
    if (seg.length < 2) return;
    const [p1, p2] = seg;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", xToPx(p1.x));
    line.setAttribute("y1", yToPx(p1.y));
    line.setAttribute("x2", xToPx(p2.x));
    line.setAttribute("y2", yToPx(p2.y));
    line.setAttribute("stroke", opts.stroke || "#111");
    line.setAttribute("stroke-width", (opts.width || 2).toString());
    if (opts.dash) line.setAttribute("stroke-dasharray", opts.dash);
    if (opts.opacity != null) line.setAttribute("opacity", opts.opacity.toString());
    viz.appendChild(line);
  }

  function drawShadedHalfPlane(w1, w2, c) {
    // Shade region where w1*x + w2*y + c >= 0
    const rect = [
      { x: world.xmin, y: world.ymin },
      { x: world.xmax, y: world.ymin },
      { x: world.xmax, y: world.ymax },
      { x: world.xmin, y: world.ymax }
    ];

    const inside = (p) => (w1 * p.x + w2 * p.y + c) >= 0;
    const intersect = (A, B) => {
      const fA = w1 * A.x + w2 * A.y + c;
      const fB = w1 * B.x + w2 * B.y + c;
      const t = fA / (fA - fB);
      return { x: A.x + t * (B.x - A.x), y: A.y + t * (B.y - A.y) };
    };

    let out = [];
    for (let i = 0; i < rect.length; i++) {
      const A = rect[i];
      const B = rect[(i + 1) % rect.length];
      const Ain = inside(A);
      const Bin = inside(B);
      if (Ain && Bin) out.push(B);
      else if (Ain && !Bin) out.push(intersect(A, B));
      else if (!Ain && Bin) { out.push(intersect(A, B)); out.push(B); }
    }
    if (out.length < 3) return;

    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    poly.setAttribute("points", out.map(p => `${xToPx(p.x)},${yToPx(p.y)}`).join(" "));
    poly.setAttribute("fill", "rgba(255,165,0,0.18)");
    poly.setAttribute("stroke", "none");
    viz.appendChild(poly);
  }

  function drawPoint(pt, sentiment, r = 8) {
    const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circ.setAttribute("cx", xToPx(pt.Cbest));
    circ.setAttribute("cy", yToPx(pt.Cbad));
    circ.setAttribute("r", r.toString());
    circ.setAttribute("fill", sentiment === 1 ? "orange" : "purple");
    circ.setAttribute("stroke", "#111");
    circ.setAttribute("stroke-width", "1");
    viz.appendChild(circ);
  }

  function render(showAll = false, ghost = null) {
    clearViz();
    drawGrid();
    drawShadedHalfPlane(state.w1, state.w2, state.c);
    if (ghost) drawBoundary(ghost.w1, ghost.w2, ghost.c, { stroke: "#555", dash: "6 6", opacity: 0.6 });
    drawBoundary(state.w1, state.w2, state.c);

    if (showAll) {
      for (const ca of state.cases) {
        drawPoint({ Cbest: +ca.values.Cbest, Cbad: +ca.values.Cbad }, +ca.values.Sentiment, 6);
      }
    } else {
      const ca = currentCase();
      if (ca) drawPoint({ Cbest: +ca.values.Cbest, Cbad: +ca.values.Cbad }, +ca.values.Sentiment, 8);
    }
  }

  async function animateBoundaryTo(newW, ghost, durationMs = 600) {
    const old = { w1: state.w1, w2: state.w2, c: state.c };
    const start = performance.now();

    return new Promise((resolve) => {
      function tick(now) {
        const t = clamp((now - start) / durationMs, 0, 1);
        const u = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in/out

        state.w1 = old.w1 + (newW.w1 - old.w1) * u;
        state.w2 = old.w2 + (newW.w2 - old.w2) * u;
        state.c  = old.c  + (newW.c  - old.c)  * u;

        syncSliders();
        updatePanel();
        render(false, ghost);

        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
  }

  // --- Training flow ---
  function nextCase() {
    if (!state.cases.length) return;
    const prev = state.index % state.cases.length;
    state.index = (state.index + 1) % state.cases.length;
    const cur = state.index % state.cases.length;
    if (prev === state.cases.length - 1 && cur === 0) state.epoch += 1;
    updatePanel();
    render(false);
  }

  // --- Evaluation ---
  function evaluateAll() {
    if (!state.cases.length) return { n: 0, acc: 0, mse: 0 };
    let correct = 0;
    let mse = 0;
    for (const ca of state.cases) {
      const x = +ca.values.Cbest;
      const y = +ca.values.Cbad;
      const s = +ca.values.Sentiment;
      const z = state.w1 * x + state.w2 * y + state.c;
      const p = sign(z);
      if (p === s) correct += 1;
      const e = s - z;
      mse += e * e;
    }
    const n = state.cases.length;
    return { n, acc: correct / n, mse: mse / n };
  }

  // --- CODAP dataset operations ---
  async function refreshDatasetList() {
    $("#dataStatus").textContent = "Refreshing dataset list…";
    try {
      const res = await codapRequest({ action: "get", resource: "dataContextList" });
      const list = res.values || [];

      const sel = $("#datasetSelect");
      sel.innerHTML = "";

      const optSample = document.createElement("option");
      optSample.value = "__sample__";
      optSample.textContent = "Sample Dataset";
      sel.appendChild(optSample);

      for (const dc of list) {
        const opt = document.createElement("option");
        opt.value = dc.name;
        opt.textContent = dc.title ? `${dc.title} (${dc.name})` : dc.name;
        sel.appendChild(opt);
      }

      $("#dataStatus").textContent = "Choose a dataset (or Sample Dataset).";
    } catch (e) {
      console.error(e);
      $("#dataStatus").textContent = "Could not load dataContextList (see console).";
    }
  }

  async function attachToDatasetByName(dcName) {
    const dc = await codapRequest({ action: "get", resource: `dataContext[${dcName}]` });
    const collections = dc.values?.collections || [];
    const col = collections[0];
    if (!col) throw new Error("No collections found in dataset.");

    const attrNames = new Set((col.attrs || []).map(a => a.name));
    for (const req of ["Cbest", "Cbad", "Sentiment"]) {
      if (!attrNames.has(req)) throw new Error(`Dataset "${dcName}" missing required attribute: ${req}`);
    }

    state.dataContextName = dcName;
    state.collectionName = col.name;
  }

  async function loadAllCases() {
    if (!state.dataContextName || !state.collectionName) return;
    const dc = state.dataContextName;
    const col = state.collectionName;

    const res = await codapRequest({
      action: "get",
      resource: `dataContext[${dc}].collection[${col}].allCases`
    });

    const raw = (res.values && (res.values.cases || res.values)) || [];
    state.cases = raw.map(ca => ({
      id: ca.id,
      values: {
        ID: (ca.values?.ID ?? ca.case?.ID ?? ca.ID),
        Text: (ca.values?.Text ?? ca.case?.Text ?? ca.Text),
        Cbest: +(ca.values?.Cbest ?? ca.case?.Cbest ?? ca.Cbest),
        Cbad: +(ca.values?.Cbad ?? ca.case?.Cbad ?? ca.Cbad),
        Sentiment: +(ca.values?.Sentiment ?? ca.case?.Sentiment ?? ca.Sentiment)
      }
    }));

    state.index = 0;
    state.epoch = 0;
  }

  async function loadOrResetSampleDataset() {
    const dcName = window.SAMPLE_DATASET.dataContextName;
    const colName = window.SAMPLE_DATASET.collectionName;

    // Create the dataContext (if it exists, CODAP will just keep it)
    await codapRequest({
      action: "create",
      resource: "dataContext",
      values: {
        name: dcName,
        title: window.SAMPLE_DATASET.title,
        collections: [{
          name: colName,
          title: "Training Reviews",
          labels: { singleCase: "review", pluralCase: "reviews" },
          attrs: window.SAMPLE_DATASET.attrs
        }]
      }
    });

    // Best-effort delete existing cases (resource selectors vary a bit by CODAP build)
    const deleteTry = [
      `dataContext[${dcName}].collection[${colName}].allCases`,
      `dataContext[${dcName}].collection[${colName}].cases`
    ];
    for (const resource of deleteTry) {
      try {
        await codapRequest({ action: "delete", resource });
        break;
      } catch (e) {
        // try next
      }
    }

    // Recreate cases
    await codapRequest({
      action: "create",
      resource: `dataContext[${dcName}].collection[${colName}].case`,
      values: window.SAMPLE_DATASET.cases
    });

    state.dataContextName = dcName;
    state.collectionName = colName;
    await loadAllCases();
  }

  // --- Wire up UI events ---
  function wireUI() {
    const bindRange = (id, key) => {
      $(id).addEventListener("input", (e) => {
        state[key] = parseFloat(e.target.value);
        syncSliders();
        updatePanel();
        render(state.phase === "EVAL");
      });
    };
    bindRange("#w1", "w1");
    bindRange("#w2", "w2");
    bindRange("#c", "c");
    bindRange("#lr", "learnRate");

    $("#resetModelBtn").addEventListener("click", () => {
      state.w1 = 0.4;
      state.w2 = -0.4;
      state.c = 2;
      state.learnRate = 0.1;
      syncSliders();
      updatePanel();
      render(state.phase === "EVAL");
    });

    $("#refreshBtn").addEventListener("click", refreshDatasetList);

    $("#loadSampleBtn").addEventListener("click", async () => {
      $("#dataStatus").textContent = "Loading sample dataset…";
      try {
        await loadOrResetSampleDataset();
        $("#dataStatus").textContent = `Loaded sample dataset (${state.cases.length} cases).`;
        updatePanel();
        render(false);
      } catch (e) {
        console.error(e);
        $("#dataStatus").textContent = "Failed to load sample dataset (see console).";
      }
    });

    $("#datasetSelect").addEventListener("change", async (e) => {
      const val = e.target.value;
      if (val === "__sample__") {
        $("#dataStatus").textContent = "Sample dataset selected. Click 'Load/Reset Sample Dataset' to create it in CODAP.";
        return;
      }
      $("#dataStatus").textContent = `Attaching to dataset: ${val}…`;
      try {
        await attachToDatasetByName(val);
        await loadAllCases();
        $("#dataStatus").textContent = `Attached to ${val} (${state.cases.length} cases).`;
        updatePanel();
        render(false);
      } catch (err) {
        console.error(err);
        $("#dataStatus").textContent = `Could not attach: ${err.message || "error"}`;
      }
    });

    $("#btnCorrect").addEventListener("click", () => {
      const ca = currentCase();
      if (!ca) return;
      const pt = { Cbest: +ca.values.Cbest, Cbad: +ca.values.Cbad };
      const s = +ca.values.Sentiment;
      if (predict(pt) !== s) {
        showAlert("Check again! Does the current rule properly predict this point?");
        return;
      }
      nextCase();
    });

    $("#btnFail").addEventListener("click", async () => {
      const ca = currentCase();
      if (!ca) return;
      const pt = { Cbest: +ca.values.Cbest, Cbad: +ca.values.Cbad };
      const s = +ca.values.Sentiment;

      if (predict(pt) === s) {
        showAlert("Check again! This point is already predicted correctly.");
        return;
      }

      // Compute deltas & animate boundary shift
      const d = deltas(pt, s);
      const ghost = { w1: state.w1, w2: state.w2, c: state.c };
      const newW = { w1: state.w1 + d.dw1, w2: state.w2 + d.dw2, c: state.c + d.dc };

      $("#btnNextAfterImprove").disabled = true;
      await animateBoundaryTo(newW, ghost, 650);
      $("#btnNextAfterImprove").disabled = false;
    });

    $("#btnNextAfterImprove").addEventListener("click", () => {
      $("#btnNextAfterImprove").disabled = true;
      nextCase();
    });

    $("#evaluateBtn").addEventListener("click", () => {
      if (!state.cases.length) return;
      state.phase = "EVAL";
      render(true);
      const stats = evaluateAll();
      $("#evalSummary").textContent =
        `Cases: ${stats.n}\nAccuracy: ${(stats.acc * 100).toFixed(1)}%\nMSE: ${stats.mse.toFixed(3)}\n\nModel: w1=${fmt(state.w1)}  w2=${fmt(state.w2)}  c=${fmt(state.c)}`;
      $("#evalDlg").showModal();
    });

    $("#evalClose").addEventListener("click", () => {
      $("#evalDlg").close();
      state.phase = "TRAIN_SINGLE";
      render(false);
      updatePanel();
    });

    $("#alertOk").addEventListener("click", () => $("#alertDlg").close());
  }

  // --- Boot ---
  async function boot() {
    syncSliders();
    wireUI();
    render(false);
    updatePanel();

    try {
      if (!window.CodapPluginApi) {
        throw new Error("CodapPluginApi not found. Did you load codap-plugin-api.js in index.html?");
      }
      codap = new CodapPluginApi();
      await codap.init({ name: "Perceptron Trainer", title: "Perceptron Trainer" });

      $("#dataStatus").textContent = "Connected to CODAP.";
      $("#modelStatus").textContent = "Ready.";
      await refreshDatasetList();
    } catch (e) {
      console.error(e);
      $("#dataStatus").textContent = "Could not connect to CODAP. (Check index.html script include and open as a CODAP plugin.)";
      $("#modelStatus").textContent = "Not connected.";
    }
  }

  window.addEventListener("load", boot);
})();
