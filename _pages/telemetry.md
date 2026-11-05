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
        Drop in RaceChrono CSV or VBO exports to compare speed, time delta, corners, and driving lines. OpenHaldex channels (lock, mode, pedal, brake, steering and more) show up automatically when they were logged.
        Analysis happens entirely in your browser; your files never leave your device.
      </p>
    </div>
    <div class="telemetry-stat" aria-label="Privacy information">
      <span class="telemetry-stat-value">100%</span>
      <span class="telemetry-stat-label">local processing</span>
    </div>
  </section>

  <label class="telemetry-dropzone" id="telemetry-dropzone" for="telemetry-files">
    <input id="telemetry-files" type="file" accept=".csv,.vbo,text/csv" multiple>
    <span class="telemetry-drop-icon" aria-hidden="true">↗</span>
    <span class="telemetry-drop-title">Choose RaceChrono CSV or VBO files</span>
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
      <label>
        Compare lap
        <select id="telemetry-compare-select"></select>
      </label>
      <label class="telemetry-check-option">
        <input id="telemetry-overlay-delta" type="checkbox">
        Overlay delta on speed
      </label>
      <button class="telemetry-reset" id="telemetry-reset" type="button">Clear files</button>
    </div>

    <div class="telemetry-kpis" id="telemetry-kpis"></div>

    <div class="telemetry-grid">
      <article class="telemetry-panel" id="telemetry-speed-panel">
        <div class="telemetry-panel-heading">
          <div>
            <p class="telemetry-kicker">PACE</p>
            <h2>Speed over distance</h2>
          </div>
          <span>km/h</span>
        </div>
        <div class="telemetry-chart-wrap"><canvas id="telemetry-speed-chart"></canvas></div>
      </article>

      <article class="telemetry-panel" id="telemetry-delta-panel">
        <div class="telemetry-panel-heading">
          <div>
            <p class="telemetry-kicker">GAIN / LOSS</p>
            <h2>Delta to reference</h2>
          </div>
          <span>seconds</span>
        </div>
        <div class="telemetry-chart-wrap"><canvas id="telemetry-delta-chart"></canvas></div>
      </article>

      <article class="telemetry-panel telemetry-panel-map telemetry-panel-wide" id="telemetry-map-panel">
        <div class="telemetry-panel-heading">
          <div>
            <p class="telemetry-kicker">DRIVING LINE</p>
            <h2>GPS track map</h2>
          </div>
          <span class="telemetry-map-legend" id="telemetry-map-legend"></span>
        </div>
        <div class="telemetry-map-tools">
          <label>
            Color by
            <select id="telemetry-map-mode"></select>
          </label>
          <label>
            Base map
            <select id="telemetry-map-base">
              <option value="muted">Muted</option>
              <option value="dark">Dark</option>
              <option value="satellite">Satellite</option>
              <option value="street">Street</option>
            </select>
          </label>
          <div class="telemetry-replay-controls">
            <button type="button" id="telemetry-replay" aria-pressed="false">▶ Replay</button>
            <select id="telemetry-replay-speed" aria-label="Replay speed">
              <option value="0.5">0.5×</option>
              <option value="1" selected>1×</option>
              <option value="2">2×</option>
              <option value="4">4×</option>
            </select>
          </div>
          <button type="button" class="telemetry-zoom-reset" id="telemetry-zoom-reset" hidden>Reset zoom</button>
          <span class="telemetry-map-hint">Click a corner label to zoom · drag across a chart to zoom · double-click a chart to reset</span>
        </div>
        <div class="telemetry-map-wrap">
          <div id="telemetry-map" aria-label="GPS map of selected laps"></div>
          <div class="telemetry-replay-clock" id="telemetry-replay-clock" hidden></div>
        </div>
        <div class="telemetry-lap-legend" id="telemetry-lap-legend" aria-label="Show or hide laps on the map"></div>
      </article>

      <article class="telemetry-panel" id="telemetry-channel-panel" hidden>
        <div class="telemetry-panel-heading">
          <div>
            <p class="telemetry-kicker">CHANNELS</p>
            <h2><select class="telemetry-channel-select" id="telemetry-channel-select" aria-label="Channel"></select></h2>
          </div>
          <span id="telemetry-channel-unit"></span>
        </div>
        <div class="telemetry-chart-wrap"><canvas id="telemetry-channel-chart"></canvas></div>
      </article>

      <article class="telemetry-panel telemetry-panel-wide">
        <div class="telemetry-panel-heading">
          <div>
            <p class="telemetry-kicker">CORNER BY CORNER</p>
            <h2>Where the time goes</h2>
          </div>
          <span id="telemetry-corner-compare"></span>
        </div>
        <div class="telemetry-table-wrap">
          <table class="telemetry-table telemetry-corner-table">
            <thead>
              <tr>
                <th>Corner</th><th>Ref min km/h</th><th>Lap min km/h</th><th>Min Δ</th><th>Exit Δ</th><th>Braking</th><th id="telemetry-corner-time-heading">Time Δ (s)</th>
              </tr>
            </thead>
            <tbody id="telemetry-corner-body"></tbody>
          </table>
        </div>
        <p class="telemetry-theoretical" id="telemetry-corner-summary"></p>
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

      <article class="telemetry-panel" id="telemetry-gg-panel" hidden>
        <div class="telemetry-panel-heading">
          <div>
            <p class="telemetry-kicker">GRIP</p>
            <h2>G-G diagram</h2>
          </div>
          <span>reference + compare lap</span>
        </div>
        <div class="telemetry-chart-wrap telemetry-chart-square"><canvas id="telemetry-gg-chart"></canvas></div>
      </article>
    </div>

    <div class="telemetry-readout" id="telemetry-readout" hidden>
      <span class="telemetry-readout-title" id="telemetry-readout-title"></span>
      <div class="telemetry-readout-body" id="telemetry-readout-body"></div>
    </div>

  </section>
</div>

<noscript>This analyzer needs JavaScript enabled to process telemetry files.</noscript>

<script defer src="{{ '/assets/js/telemetry.js' | relative_url }}"></script>
