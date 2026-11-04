---
layout: page
title: Apps
permalink: /apps/
description: Interactive tools you can use in the browser.
# Set this to Car Duel's hosted URL (e.g. its Railway or Render address) to make the card live.
car_duel_url: ""
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

<section class="apps-section">
  <div class="apps-section-heading">
    <p>GAMES</p>
    <h2>Things to play</h2>
  </div>
  {% if page.car_duel_url != "" %}
  <a class="apps-feature apps-feature-game" href="{{ page.car_duel_url }}" target="_blank" rel="noopener">
  {% else %}
  <div class="apps-feature apps-feature-game apps-feature-pending">
  {% endif %}
    <div>
      <span class="apps-tag">MULTIPLAYER GAME · OPENS ITS OWN SITE</span>
      <h3>Car Duel</h3>
      <p>
        A real-time two-player car guessing game. Both players get the same secret car and ask yes/no
        questions in their own sessions, with Claude answering from real car facts. First correct guess wins.
      </p>
      {% if page.car_duel_url == "" %}<p class="apps-pending-note">Launching soon.</p>{% endif %}
    </div>
    <span class="apps-arrow" aria-hidden="true">↗</span>
  {% if page.car_duel_url != "" %}
  </a>
  {% else %}
  </div>
  {% endif %}
</section>
