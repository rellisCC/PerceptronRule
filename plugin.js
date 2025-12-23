/* plugin.js — CODAP Perceptron Trainer
   Uses iframe-phone to talk to CODAP Data Interactive API (no CodapPluginApi wrapper).
*/

/* global iframePhone, SAMPLE_DATASETS */

(function () {
  "use strict";

  // ----------------------------
  // UI helpers
  // ----------------------------
  const $ = (sel) => document.querySelector(sel);

  const els = {
    datasetSelect: $("#datasetSelect"),
    refreshBtn: $("#refreshBtn"),
    loadSampleBtn: $("#loadSampleBtn"),
    dataStatus: $("#dataStatus"),

    w1: $("#w1"),
    w2: $("#w2"),
    c: $("#c"),
    lr: $("#lr"),
    w1Val: $("#w1Val"),
    w2Val: $("#w2Val"),
    cVal: $("#cVal"),
    lrVal: $("#lrVal"),

    resetModelBtn: $("#resetModelBtn"),
    evaluateBtn: $("#evaluateBtn"),
    modelStatus: $("#modelStatus"),

    viz: $("#viz"),

    ptInfo: $("#ptInfo"),
    epochInfo: $("#epochInfo"),
    indexInfo: $("#indexInfo"),
    scoreInfo: $("#scoreInfo"),
    predInfo: $("#predInfo"),
    sentInfo: $("#sentInfo"),
    mistakeInfo: $("#mistakeInfo"),
    deltaInfo: $("#deltaInfo"),

    btnCorrect: $("#btnCorrect"),
    btnFail: $("#btnFail"),
    btnNextAfterImprove: $("#btnNextAfterImprove"),

    alertDlg: $("#alertDlg"),
    alertMsg: $("#alertMsg"),
    alertOk: $("#alertOk"),

    evalDlg: $("#evalDlg"),
    evalSummary: $("#evalSummary"),
    evalClose: $("#evalClose")
  };

  function setStatus(text) {
    els.dataStatus.textContent = text;
  }
  function setModelStatus(text) {
    els.modelStatus.textContent = text || "";
  }

  function showAlert(msg) {
    els.alertMsg.textContent = msg || "Does the current rule properly predict this point?";
    if (els.alertDlg && els.alertDlg.showModal) els.alertDlg.showModal();
    else alert(els.alertMsg.textContent);
  }

  // ----------------------------
  // CODAP phone / request layer
  // ----------------------------
  let phone = null;
  let connected = false;

  function ensurePhone() {
    if (!phone) throw new Error("Not connected to CODAP (phone is null).");
  }

  function codapRequest(action, resource, values) {
    ensurePhone();
    return new Promise((resolve, reject) => {
      phone.call({ action, resource, values }, (result) => {
        if (!result) return reject(new Error("No response from CODAP."));
        if (result.success) resolve(result);
        else reject(new Error((result.values && result.values.error) || "CODAP request failed."));
      });
    });
  }

  async function connectToCODAP() {
    // Must be embedded in CODAP (iFrame). iframe-phone provides the RPC transport.
    if (!window.iframePhone || !window.iframePhone.IframePhoneRpcEndpoint) {
      throw new Error("iframePhone RPC not found. Make sure iframe-phone.js is loaded before plugin.js");
    }

    // Create an RPC endpoint to CODAP (the parent frame).
    // The handler is required by iframe-phone but we don't need to handle incoming calls here.
    phone = new window.iframePhone.IframePhoneRpcEndpoint(function () {}, "data-interactive", window.parent);

    // Verify CODAP is listening:
    await codapRequest("get", "interactiveFrame");

    connected = true;
    setStatus("Connected to CODAP ✓");
  }


  // ----------------------------
  // Data model
  // ----------------------------
  const DEFAULT_MODEL = { w1: 0.4, w2: -0.4, c: 2.0 };
  let model = { ...DEFAULT_MODEL };

  // Training state
  let currentDatasetName = null;
  let cases = []; // [{id, Cbest, Cbad, Sentiment}]
  let curIndex = 0;
  let epoch = 0;
  let showingAll = false;
  let lastEval = null;
  let awaitingImprove = false;

  // For plotting
  const PLOT = { w: 600, h: 400, pad: 40 };
  const AX = { xmin: -0.5, xmax: 2.5, ymin: -0.5, ymax: 2.5 };

  // ----------------------------
  // Sample dataset (Mama’s)
  // ----------------------------
  // Expects sample-data.js defines SAMPLE_DATASETS array
  // with a dataset having:
  //   name: "Sample Dataset"
  //   attrs: [{name:"Cbest"}, {name:"Cbad"}, {name:"Sentiment"}]
  //   cases: [{Cbest:0,Cbad:2,Sentiment:-1, Text:"..."}, ...]  (Text optional)
  const SAMPLE_NAME = "Sample Dataset";
  const SAMPLE_SPEC = (window.SAMPLE_DATASETS || []).find(d => d.name === SAMPLE_NAME);

  // ----------------------------
  // CODAP dataset utilities
  // ----------------------------
  async function listCODAPDatasets() {
    const res = await codapRequest("get", "dataContextList");
    // returns { values: { dataContexts: [{name, title, id}, ...] } }
    const dcs = (res.values && res.values.dataContexts) ? res.values.dataContexts : [];
    return dcs.map(dc => dc.name || dc.title).filter(Boolean);
  }

  async function loadDatasetCases(datasetName) {
    // Get all cases from collection[0]
    const collectionsRes = await codapRequest("get", `dataContext[${datasetName}].collectionList`);
    const collections = collectionsRes.values && collectionsRes.values.collections;
    if (!collections || !collections.length) throw new Error("No collections found in dataset.");
    const collName = collections[0].name;

    const casesRes = await codapRequest(
  "get",
  `dataContext[${datasetName}].collection[${collName}].allCases`
);
    const found = (casesRes.values && casesRes.values.cases) ? casesRes.values.cases : [];

    // Normalize:
    return found.map(c => {
      const v = c.values || {};
      return {
        id: c.id,
        Cbest: Number(v.Cbest ?? v.x ?? 0),
        Cbad: Number(v.Cbad ?? v.y ?? 0),
        Sentiment: Number(v.Sentiment ?? v.sentiment ?? v.label ?? 0),
        Text: v.Text ?? v.text ?? ""
      };
    });
  }

  async function createOrResetSampleDataset() {
    if (!SAMPLE_SPEC) {
      throw new Error("Sample dataset spec not found in sample-data.js (SAMPLE_DATASETS).");
    }

    // If exists, delete then recreate (simplest reset behavior)
    const existing = await listCODAPDatasets();
    if (existing.includes(SAMPLE_SPEC.name)) {
      await codapRequest("delete", `dataContext[${SAMPLE_SPEC.name}]`);
    }

    // Create dataContext
    await codapRequest("create", "dataContext", {
      name: SAMPLE_SPEC.name,
      title: SAMPLE_SPEC.name,
      collections: [{
        name: "Cases",
        attrs: SAMPLE_SPEC.attrs.map(a => ({ name: a.name }))
      }]
    });

    // Add cases
    const values = SAMPLE_SPEC.cases.map(row => ({
      values: row
    }));
    await codapRequest(
      "create",
      `dataContext[${SAMPLE_SPEC.name}].collection[Cases].case`,
      values
    );

    return SAMPLE_SPEC.name;
  }

  // ----------------------------
  // Perceptron math
  // ----------------------------
  function scorePoint(pt) {
    return model.w1 * pt.Cbest + model.w2 * pt.Cbad + model.c;
  }

  function predFromScore(s) {
    // predicts +1 when s >= 0 else -1
    return s >= 0 ? 1 : -1;
  }

  function perceptronUpdate(pt, lr) {
    // Standard perceptron update on mistake:
    // w <- w + lr * y * x
    // c <- c + lr * y
    const y = pt.Sentiment;
    const dw1 = lr * y * pt.Cbest;
    const dw2 = lr * y * pt.Cbad;
    const dc = lr * y;

    model.w1 += dw1;
    model.w2 += dw2;
    model.c += dc;

    return { dw1, dw2, dc };
  }

  function isMistake(pt) {
    const s = scorePoint(pt);
    const yhat = predFromScore(s);
    return yhat !== pt.Sentiment;
  }

  // ----------------------------
  // Rendering (simple SVG)
  // ----------------------------
  function clearSVG() {
    while (els.viz.firstChild) els.viz.removeChild(els.viz.firstChild);
  }

  function sx(x) {
    const { w, pad } = PLOT;
    return pad + (x - AX.xmin) * (w - 2 * pad) / (AX.xmax - AX.xmin);
  }
  function sy(y) {
    const { h, pad } = PLOT;
    // SVG y goes down
    return h - pad - (y - AX.ymin) * (h - 2 * pad) / (AX.ymax - AX.ymin);
  }

  function svgEl(name, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, String(v)));
    return el;
  }

  function drawAxes() {
    const g = svgEl("g", {});
    // border
    g.appendChild(svgEl("rect", {
      x: PLOT.pad, y: PLOT.pad,
      width: PLOT.w - 2 * PLOT.pad,
      height: PLOT.h - 2 * PLOT.pad,
      fill: "none",
      stroke: "#bbb"
    }));
    els.viz.appendChild(g);
  }

  function drawDecisionRegion() {
    // Region where w1*Cbest + w2*Cbad + c >= 0 (orange)
    // We approximate by filling polygon clipped to plot box.
    const w1 = model.w1, w2 = model.w2, c = model.c;

    // Line: w1 x + w2 y + c = 0  => y = -(w1/w2)x - c/w2 if w2 != 0
    // We'll compute intersections with plot bounds and then fill the ">=0" side.
    const bx0 = AX.xmin, bx1 = AX.xmax, by0 = AX.ymin, by1 = AX.ymax;

    // sample corners, evaluate inequality:
    const corners = [
      { x: bx0, y: by0 }, { x: bx1, y: by0 },
      { x: bx1, y: by1 }, { x: bx0, y: by1 }
    ];

    function inside(p) {
      return (w1 * p.x + w2 * p.y + c) >= 0;
    }

    // Build polygon via half-plane clipping (Sutherland–Hodgman)
    function clip(poly) {
      let output = poly.slice();
      // clip against the decision boundary half-plane directly by checking inside
      // We clip against the half-plane, not the box (box already is our poly).
      const input = output;
      output = [];
      for (let i = 0; i < input.length; i++) {
        const A = input[i];
        const B = input[(i + 1) % input.length];
        const Ain = inside(A);
        const Bin = inside(B);

        if (Ain && Bin) {
          output.push(B);
        } else if (Ain && !Bin) {
          // leaving: add intersection
          const I = intersectSeg(A, B);
          if (I) output.push(I);
        } else if (!Ain && Bin) {
          // entering: add intersection then B
          const I = intersectSeg(A, B);
          if (I) output.push(I);
          output.push(B);
        }
      }
      return output;
    }

    // Intersection of segment with line w1 x + w2 y + c = 0
    function intersectSeg(A, B) {
      const fA = w1 * A.x + w2 * A.y + c;
      const fB = w1 * B.x + w2 * B.y + c;
      const denom = (fA - fB);
      if (denom === 0) return null;
      const t = fA / denom; // where f(t)=0 between A and B
      if (t < 0 || t > 1) return null;
      return { x: A.x + t * (B.x - A.x), y: A.y + t * (B.y - A.y) };
    }

    let poly = corners;
    poly = clip(poly);

    if (poly.length < 3) return;

    const d = poly.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x)} ${sy(p.y)}`).join(" ") + " Z";
    els.viz.appendChild(svgEl("path", {
      d,
      fill: "rgba(255,165,0,0.25)",
      stroke: "none"
    }));
  }

  function drawDecisionLine() {
    const w1 = model.w1, w2 = model.w2, c = model.c;
    const bx0 = AX.xmin, bx1 = AX.xmax, by0 = AX.ymin, by1 = AX.ymax;

    const pts = [];

    // Intersections with x=bx0 and x=bx1
    if (w2 !== 0) {
      const y0 = (-c - w1 * bx0) / w2;
      const y1 = (-c - w1 * bx1) / w2;
      pts.push({ x: bx0, y: y0 }, { x: bx1, y: y1 });
    } else if (w1 !== 0) {
      // vertical line: x = -c/w1
      const x = (-c) / w1;
      pts.push({ x, y: by0 }, { x, y: by1 });
    }

    // Clip to bounds by sampling endpoints and clipping visually (good enough for class range)
    const A = pts[0], B = pts[1];

    els.viz.appendChild(svgEl("line", {
      x1: sx(A.x), y1: sy(A.y),
      x2: sx(B.x), y2: sy(B.y),
      stroke: "#333",
      "stroke-width": 2
    }));
  }

  function drawPoint(pt, isCurrent) {
    const positive = (pt.Sentiment === 1);
    const r = isCurrent ? 8 : 5;

    els.viz.appendChild(svgEl("circle", {
      cx: sx(pt.Cbest),
      cy: sy(pt.Cbad),
      r,
      fill: positive ? "orange" : "purple",
      opacity: isCurrent ? 1 : 0.65
    }));
  }

  function renderViz() {
    clearSVG();
    drawDecisionRegion();
    drawAxes();
    drawDecisionLine();

    if (showingAll) {
      cases.forEach(pt => drawPoint(pt, false));
    } else {
      const pt = cases[curIndex];
      if (pt) drawPoint(pt, true);
    }
  }

  // ----------------------------
  // Training workflow UI
  // ----------------------------
  function syncSlidersToModel() {
    els.w1.value = String(model.w1);
    els.w2.value = String(model.w2);
    els.c.value = String(model.c);
    updateSliderLabels();
  }

  function updateModelFromSliders() {
    model.w1 = Number(els.w1.value);
    model.w2 = Number(els.w2.value);
    model.c = Number(els.c.value);
    updateSliderLabels();
    renderViz();
    updateCurrentPointPanel();
  }

  function updateSliderLabels() {
    els.w1Val.textContent = Number(els.w1.value).toFixed(2);
    els.w2Val.textContent = Number(els.w2.value).toFixed(2);
    els.cVal.textContent = Number(els.c.value).toFixed(2);
    els.lrVal.textContent = Number(els.lr.value).toFixed(2);
  }

  function updateCurrentPointPanel() {
    const pt = cases[curIndex];
    if (!pt) {
      els.ptInfo.textContent = "—";
      els.indexInfo.textContent = "—";
      return;
    }

    const s = scorePoint(pt);
    const yhat = predFromScore(s);
    const mistake = (yhat !== pt.Sentiment);

    els.ptInfo.textContent = `(${pt.Cbest}, ${pt.Cbad})`;
    els.epochInfo.textContent = String(epoch);
    els.indexInfo.textContent = String(curIndex + 1) + " / " + String(cases.length);

   // els.scoreInfo.textContent = s.toFixed(3);
    els.predInfo.textContent = (yhat === 1 ? "+1 (Positive)" : "-1 (Negative)");
    els.sentInfo.textContent = (pt.Sentiment === 1 ? "+1 (Positive)" : "-1 (Negative)");
  //  els.mistakeInfo.textContent = mistake ? "YES" : "no";
   if (!awaitingImprove) els.deltaInfo.textContent = "";

    // enable/disable "Rule improved..." based on state
    els.btnNextAfterImprove.disabled = !awaitingImprove;
  }

  function advancePoint() {
     els.btnFail.disabled = false;
    curIndex += 1;
    if (curIndex >= cases.length) {
      curIndex = 0;
      epoch += 1;
    }
    awaitingImprove = false;
    showingAll = false;
    renderViz();
    updateCurrentPointPanel();
  }

  function setDatasetUIOptions(datasetNames) {
    els.datasetSelect.innerHTML = "";
    // Always include sample dataset option at top
    const sampleOpt = document.createElement("option");
    sampleOpt.value = SAMPLE_NAME;
    sampleOpt.textContent = SAMPLE_NAME;
    els.datasetSelect.appendChild(sampleOpt);

    datasetNames
      .filter(n => n !== SAMPLE_NAME)
      .forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        els.datasetSelect.appendChild(opt);
      });
  }

  async function refreshDatasetList() {
    const names = await listCODAPDatasets();
    setDatasetUIOptions(names);
    setStatus(`Connected ✓  •  Found ${names.length} CODAP dataset(s)`);
  }

  async function chooseDataset(name) {
    currentDatasetName = name;

    if (name === SAMPLE_NAME) {
      // Don’t auto-create until they click Load/Reset;
      // but if it already exists, we can use it.
      const names = await listCODAPDatasets();
      if (names.includes(SAMPLE_NAME)) {
        cases = await loadDatasetCases(SAMPLE_NAME);
      } else {
        cases = [];
      }
    } else {
      cases = await loadDatasetCases(name);
    }

    if (!cases.length) {
      setModelStatus("No cases loaded yet. If using Sample Dataset, click Load/Reset Sample Dataset.");
    } else {
      // Ensure Sentiment is ±1
      cases = cases.map(pt => ({
        ...pt,
        Sentiment: (pt.Sentiment >= 0 ? 1 : -1)
      }));
      curIndex = 0;
      epoch = 0;
      awaitingImprove = false;
      showingAll = false;
      setModelStatus(`Loaded ${cases.length} cases from "${name}".`);
      renderViz();
      updateCurrentPointPanel();
    }
  }

  // ----------------------------
  // Evaluation
  // ----------------------------
  function evaluateAll() {
    if (!cases.length) return { acc: 0, mse: 0, n: 0 };

    let correct = 0;
    let sumSq = 0;
    cases.forEach(pt => {
      const s = scorePoint(pt);
      const yhat = predFromScore(s);
      if (yhat === pt.Sentiment) correct += 1;
      const diff = (pt.Sentiment - s);
      sumSq += diff * diff;
    });

    const n = cases.length;
    return { acc: correct / n, mse: sumSq / n, n };
  }

  // ----------------------------
  // Button logic: “student judges”
  // ----------------------------
  function studentSaysCorrect() {
    const pt = cases[curIndex];
    if (!pt) return;

    const actuallyMistake = isMistake(pt);
    if (actuallyMistake) {
      showAlert("Check again! The current rule does NOT correctly predict this point.");
      return;
    }
    advancePoint();
  }

  function studentSaysFail() {
    const pt = cases[curIndex];
    if (!pt) return;

    const actuallyMistake = isMistake(pt);
    if (!actuallyMistake) {
      showAlert("Check again! The current rule DOES correctly predict this point.");
      return;
    }

    // Apply perceptron update + show the deltas
    const lr = Number(els.lr.value);
    const sBefore = scorePoint(pt);
    const y = pt.Sentiment;
    const yhat = predFromScore(sBefore);

    const deltas = perceptronUpdate(pt, lr);

    // Reflect in sliders immediately (and redraw)
    syncSlidersToModel();
    renderViz();

    const w1Old = model.w1 - deltas.dw1;
const w2Old = model.w2 - deltas.dw2;
const cOld  = model.c  - deltas.dc;

function fmtRule(w1, w2, c, bold=false) {
  const b = (s) => bold ? `<b>${s}</b>` : s;
  const w1s = b(w1.toFixed(2));
  const w2s = b(w2.toFixed(2));
  const cs  = b(c.toFixed(2));
  const w2sign = (w2 >= 0) ? " + " : " − ";
  const csign  = (c  >= 0) ? " + " : " − ";
  return `${w1s}·Cbest${w2sign}${b(Math.abs(w2).toFixed(2))}·Cbad${csign}${b(Math.abs(c).toFixed(2))} ≥ 0`;
}

els.deltaInfo.innerHTML = `
  <div class="mathline"><b>Old rule</b>: ${fmtRule(w1Old, w2Old, cOld, false)}</div>

  <div class="mathblock">
    <div class="mathline"><b>w1 update</b></div>
    <div class="mathline small">words: New w1 = Old w1 + LearnRate × TrueSentiment × Cbest</div>
    <div class="mathline small">values: New w1 = ${w1Old.toFixed(2)} + ${lr.toFixed(2)} × (${y}) × ${pt.Cbest}</div>
    <div class="mathline"><b>simplify:</b> New w1 = <b>${model.w1.toFixed(2)}</b></div>
  </div>

  <div class="mathblock">
    <div class="mathline"><b>w2 update</b></div>
    <div class="mathline small">words: New w2 = Old w2 + LearnRate × TrueSentiment × Cbad</div>
    <div class="mathline small">values: New w2 = ${w2Old.toFixed(2)} + ${lr.toFixed(2)} × (${y}) × ${pt.Cbad}</div>
    <div class="mathline"><b>simplify:</b> New w2 = <b>${model.w2.toFixed(2)}</b></div>
  </div>

  <div class="mathblock">
    <div class="mathline"><b>c (bias) update</b></div>
    <div class="mathline small">words: New c = Old c + LearnRate × TrueSentiment</div>
    <div class="mathline small">values: New c = ${cOld.toFixed(2)} + ${lr.toFixed(2)} × (${y})</div>
    <div class="mathline"><b>simplify:</b> New c = <b>${model.c.toFixed(2)}</b></div>
  </div>

  <div class="mathline"><b>New rule</b>: ${fmtRule(model.w1, model.w2, model.c, true)}</div>
`;


    awaitingImprove = true;
    els.btnNextAfterImprove.disabled = false;
    els.btnFail.disabled = true; 
    updateCurrentPointPanel();
  }

  function afterImproveNext() {
    if (!awaitingImprove) return;
    advancePoint();
  }

  function resetModel() {
    model = { ...DEFAULT_MODEL };
    syncSlidersToModel();
    setModelStatus("Model reset to defaults.");
    renderViz();
    updateCurrentPointPanel();
  }

  function showEvaluationDialog() {
    showingAll = true;
    renderViz();
    const r = evaluateAll();
    lastEval = r;

    els.evalSummary.textContent =
      `Cases: ${r.n}   •   Accuracy: ${(100 * r.acc).toFixed(1)}%   •   MSE: ${r.mse.toFixed(3)}`;

    if (els.evalDlg && els.evalDlg.showModal) els.evalDlg.showModal();
  }

  // ----------------------------
  // Boot
  // ----------------------------
  async function boot() {
    updateSliderLabels();

    els.alertOk.addEventListener("click", () => els.alertDlg.close());
    els.evalClose.addEventListener("click", () => {
      els.evalDlg.close();
      showingAll = false;
      renderViz();
    });

    // Slider live updates
    [els.w1, els.w2, els.c, els.lr].forEach(inp => {
      inp.addEventListener("input", () => {
        updateSliderLabels();
        if (inp !== els.lr) updateModelFromSliders();
      });
    });

    // Buttons
    els.resetModelBtn.addEventListener("click", resetModel);
    els.evaluateBtn.addEventListener("click", showEvaluationDialog);
    els.btnCorrect.addEventListener("click", studentSaysCorrect);
    els.btnFail.addEventListener("click", studentSaysFail);
    els.btnNextAfterImprove.addEventListener("click", afterImproveNext);

    els.refreshBtn.addEventListener("click", async () => {
      try {
        await refreshDatasetList();
      } catch (e) {
        setStatus(`Error refreshing datasets: ${e.message}`);
      }
    });

    els.loadSampleBtn.addEventListener("click", async () => {
      try {
        setStatus("Creating/resetting sample dataset in CODAP…");
        const name = await createOrResetSampleDataset();
         // Use the sample cases directly for the training view (don’t rely on reading back from CODAP yet)
         cases = SAMPLE_SPEC.cases.map(row => ({
           Cbest: Number(row.Cbest),
           Cbad: Number(row.Cbad),
           Sentiment: Number(row.Sentiment) >= 0 ? 1 : -1,
           Text: row.Text || "",
           ID: row.ID || ""
         }));
         
         curIndex = 0;
         epoch = 0;
         awaitingImprove = false;
         showingAll = false;
         
         setModelStatus(`Loaded ${cases.length} cases from "Sample Dataset".`);
         renderViz();
         updateCurrentPointPanel();
        await refreshDatasetList();
        els.datasetSelect.value = name;
        setStatus(`Sample dataset loaded ✓ (${cases.length} cases)`);
      } catch (e) {
        setStatus(`Error loading sample dataset: ${e.message}`);
      }
    });

    els.datasetSelect.addEventListener("change", async () => {
      try {
        await chooseDataset(els.datasetSelect.value);
      } catch (e) {
        setModelStatus(`Dataset load error: ${e.message}`);
      }
    });
const toggle = document.querySelector("#toggleMath");
const mathCard = document.querySelector("#mathCard");

if (toggle && mathCard) {
  toggle.addEventListener("change", () => {
    mathCard.style.display = toggle.checked ? "block" : "none";
  });
}

     
    // Connect to CODAP
    try {
      setStatus("Connecting to CODAP…");
      await connectToCODAP();
      await refreshDatasetList();
      // Default select “Sample Dataset”
      els.datasetSelect.value = SAMPLE_NAME;
      await chooseDataset(SAMPLE_NAME);

      // Initial draw even if no cases yet
      syncSlidersToModel();
      renderViz();
      updateCurrentPointPanel();
    } catch (e) {
      connected = false;
      setStatus(`Not connected. Open this plugin *inside CODAP* using ?di=…  (${e.message})`);
      // Still render something
      syncSlidersToModel();
      renderViz();
    }
  }

  boot();

})();
