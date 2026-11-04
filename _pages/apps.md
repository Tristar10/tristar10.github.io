---
layout: page
title: Apps
permalink: /apps/
description: Interactive tools you can use in the browser.
nav: true
nav_order: 4
dropdown: true
children:
  - title: All Apps
    permalink: /apps/
    url: /apps/
  - title: divider
  - title: Telemetry Analyzer
    permalink: /telemetry/
    url: /telemetry/
---

<link rel="stylesheet" href="{{ '/assets/css/apps.css' | relative_url }}">

<div class="apps-intro">
  <p class="apps-eyebrow">INTERACTIVE APPS</p>
  <h1>Things you can actually use.</h1>
  <p>
    Small, interactive tools that run directly in the browser. This page will keep growing as I
    publish more usable experiments.
  </p>
</div>

<section class="apps-section">
  <div class="apps-section-heading">
    <p>TOOLS</p>
    <h2>Useful things</h2>
  </div>
  <a class="apps-feature" href="{{ '/telemetry/' | relative_url }}">
    <div>
      <span class="apps-tag">WEB APP · LOCAL PROCESSING</span>
      <h3>RaceChrono Telemetry Analyzer</h3>
      <p>Compare laps, speed traces, time deltas, sectors, and GPS driving lines directly in your browser.</p>
    </div>
    <span class="apps-arrow" aria-hidden="true">↗</span>
  </a>
</section>
