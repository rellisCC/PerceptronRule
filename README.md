# 2D Perceptron Trainer CODAP Plugin (Temp - This was generated via vibe coding with ChatGPT 5.2)

This is a lightweight CODAP Data Interactive Plugin that implements a one-point-at-a-time perceptron training workflow.

## What it does
- Dataset dropdown includes **Sample Dataset**. Clicking "Load/Reset Sample Dataset" creates a CODAP dataContext + cases.
- Training view shows **one case at a time** with the inequality region shaded orange (predicts +1).
- Students must choose:
  - "Rule correctly predicts point…" (advances only if correct), or
  - "Rule fails. Must improve!" (updates weights via perceptron; animates boundary shift)
- Evaluate mode shows **all points** and reports:
  - Accuracy (% correct)
  - MSE (mean squared error on raw score vs Sentiment)

## Required dataset columns (for student-created datasets)
- feat1 (numeric)
- feat2 (numeric)
- label (numeric, should be -1 or +1)

## How to run (local)
1) Start a static server in this folder, e.g.:
   - `python -m http.server 8080`
2) In CODAP, add a plugin by URL pointing to:
   - `http://localhost:8080/perceptron-codap-plugin/index.html`

Docs:
- CODAP Plugin Development: https://codap.concord.org/developers/plugin-development/
- CODAP Data Interactive Plugin API wiki: https://github.com/concord-consortium/codap/wiki/CODAP-Data-Interactive-Plugin-API
