---
layout: page
title: Apps
permalink: /apps/
description: Tools, games, and interactive experiments.
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
  - title: divider
  - title: JavaFX Wordle
    permalink: /projects/Wordle_Game/
    url: /projects/Wordle_Game/
  - title: Cube Game
    permalink: /projects/rtos_cube_game/
    url: /projects/rtos_cube_game/
  - title: Large ATC
    permalink: /projects/large_atc/
    url: /projects/large_atc/
---

<link rel="stylesheet" href="{{ '/assets/css/apps.css' | relative_url }}">

<div class="apps-intro">
  <p class="apps-eyebrow">THINGS TO USE &amp; PLAY</p>
  <h1>A home for the useful, playful, and slightly weird.</h1>
  <p>
    Browser tools, games, and interactive projects that do not quite belong in one category.
    This page will keep growing as I build more things.
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
    <p>GAMES &amp; SIMULATIONS</p>
    <h2>Things to play</h2>
  </div>
  <div class="apps-grid">
    <a class="apps-card" href="{{ '/projects/Wordle_Game/' | relative_url }}">
      <img src="{{ '/assets/img/nyt_gui.png' | relative_url }}" alt="JavaFX Wordle game interface">
      <div class="apps-card-body">
        <span class="apps-tag">JAVAFX · WORD GAME</span>
        <h3>JavaFX Wordle</h3>
        <p>A desktop Wordle recreation with command-line and graphical versions built around MVC.</p>
      </div>
    </a>
    <a class="apps-card" href="{{ '/projects/rtos_cube_game/' | relative_url }}">
      <img src="{{ '/assets/img/rtos_cube_game/gameplay.jpg' | relative_url }}" alt="Cube Game running on an embedded display">
      <div class="apps-card-body">
        <span class="apps-tag">EMBEDDED · RTOS</span>
        <h3>Cube Game</h3>
        <p>A multithreaded reaction game running on a TM4C123G microcontroller.</p>
      </div>
    </a>
    <a class="apps-card" href="{{ '/projects/large_atc/' | relative_url }}">
      <img src="{{ '/assets/img/large_atc/airport_overview.jpg' | relative_url }}" alt="Large ATC virtual airport overview">
      <div class="apps-card-body">
        <span class="apps-tag">VR · SIMULATION</span>
        <h3>Large ATC</h3>
        <p>A virtual-reality air traffic control simulator with voice commands and a multi-runway airport.</p>
      </div>
    </a>
  </div>
</section>
