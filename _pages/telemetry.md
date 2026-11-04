---
layout: page
title: Telemetry
permalink: /telemetry/
description: Compare RaceChrono laps directly in your browser.
nav: false
chart:
  chartjs: true
map: true
---

<link rel="stylesheet" href="{{ '/assets/css/telemetry.css' | relative_url }}">

<div class="telemetry-app" id="telemetry-app">
  <section class="telemetry-hero">
    <div>
      <p class="telemetry-eyebrow">RACECHRONO LAP ANALYZER</p>
      <h1>Find the time hiding in every corner.</h1>
      <p class="telemetry-lede">
        Drop in one or more RaceChrono CSV exports to compare speed, time delta, sectors, and driving lines.
        Analysis happens entirely in your browser; your files never leave your device.
      </p>
    </div>
    <div class="telemetry-stat" aria-label="Privacy information">
      <span class="telemetry-stat-value">100%</span>
      <span class="telemetry-stat-label">local processing</span>
    </div>
  </section>

  <label class="telemetry-dropzone" id="telemetry-dropzone" for="telemetry-files">
    <input id="telemetry-files" type="file" accept=".csv,text/csv" multiple>
    <span class="telemetry-drop-icon" aria-hidden="true">↗</span>
    <span class="telemetry-drop-title">Choose RaceChrono CSV files</span>
    <span class="telemetry-drop-copy">or drag and drop them here</span>
  </label>

  <div class="telemetry-status" id="telemetry-status" role="status" aria-live="polite">
    Ready for telemetry files.
  </div>

  <section class="telemetry-results" id="telemetry-results" hidden>
    <div class="telemetry-toolbar">
      <label>
        Track group
        <select id="telemetry-track-select"></select>
      </label>
      <label>
        Reference lap
        <select id="telemetry-reference-select"></select>
      </label>
      <button class="telemetry-reset" id="telemetry-reset" type="button">Clear files</button>
    </div>

    <div class="telemetry-kpis" id="telemetry-kpis"></div>

    <div class="telemetry-grid">
      <article class="telemetry-panel telemetry-panel-wide">
        <div class="telemetry-panel-heading">
          <div>
            <p class="telemetry-kicker">PACE</p>
            <h2>Speed over distance</h2>
          </div>
          <span>km/h</span>
        </div>
        <div class="telemetry-chart-wrap"><canvas id="telemetry-speed-chart"></canvas></div>
      </article>

      <article class="telemetry-panel telemetry-panel-wide">
        <div class="telemetry-panel-heading">
          <div>
            <p class="telemetry-kicker">GAIN / LOSS</p>
            <h2>Delta to reference</h2>
          </div>
          <span>seconds</span>
        </div>
        <div class="telemetry-chart-wrap"><canvas id="telemetry-delta-chart"></canvas></div>
      </article>

      <article class="telemetry-panel telemetry-panel-map">
        <div class="telemetry-panel-heading">
          <div>
            <p class="telemetry-kicker">DRIVING LINE</p>
            <h2>GPS track map</h2>
          </div>
        </div>
        <div id="telemetry-map" aria-label="GPS map of selected laps"></div>
      </article>

      <article class="telemetry-panel telemetry-panel-sectors">
        <div class="telemetry-panel-heading">
          <div>
            <p class="telemetry-kicker">SECTOR ANALYSIS</p>
            <h2>Four-way split</h2>
          </div>
        </div>
        <div class="telemetry-table-wrap">
          <table class="telemetry-table">
            <thead><tr><th>Lap</th><th>S1</th><th>S2</th><th>S3</th><th>S4</th><th>Total</th></tr></thead>
            <tbody id="telemetry-sector-body"></tbody>
          </table>
        </div>
        <p class="telemetry-theoretical" id="telemetry-theoretical"></p>
      </article>
    </div>

  </section>
</div>

<noscript>This analyzer needs JavaScript enabled to process telemetry files.</noscript>

<script defer src="{{ '/assets/js/telemetry.js' | relative_url }}"></script>
