---
layout: page
title: AltScreen TT - CarPlay maps on the Audi TT Virtual Cockpit
description: Porting a CarPlay "AltScreen" hack to my 2019 Audi TT, so Apple and Google Maps run on the Virtual Cockpit with my own turn-by-turn panel.
img: assets/img/altscreen/panel_layouts.png
importance: 1
category: work
---

The Audi TT 8S has no centre screen. Everything lives in the 12.3" Virtual Cockpit behind the steering wheel, and while the car supports Apple CarPlay, the cockpit's map tab only ever shows Audi's own navigation. I wanted Apple Maps and Google Maps from my iPhone on that map tab, with proper turn arrows next to the speedometer.

There is an open-source project for this, [aberbic's Audi MHI2 Virtual Cockpit AltScreen](https://github.com/aberbic/Audi-MHI2-Virtual-Cockpit-Altscreen-CarPlay-AndroidAuto), but it targets a different head unit firmware (MU1438) on cars with a separate centre display. My TT runs MU1462 on an Nvidia Tegra MHI2 unit under QNX 6.5, so I ported it. The port, its tools and a wiki of everything I learned are at [Tristar10/audi-tt-8s-altscreen](https://github.com/Tristar10/audi-tt-8s-altscreen).

## What works

| Feature                                                    | State                            |
| ---------------------------------------------------------- | -------------------------------- |
| CarPlay map on the cockpit map tab, switched automatically | Works                            |
| Large and small (tach-centred) cockpit views               | Works                            |
| Steering-wheel scroll zoom on the CarPlay map              | Works                            |
| Turn panel: 3D arrows, lanes, exit badge, distance, ETA    | Works parked; live drive pending |
| Android Auto                                               | Not ported to the TT             |

## Starting from my own firmware

Before touching the car, I pulled apart my own firmware image: decompressing the LZO1Z boot image, extracting the QNX6 app partition and the Java HMI, and writing small Python tools to inspect ELF imports and hook targets. That gave a clear table of how the TT differs from the cars the upstream project supports: one display instead of two, different map contexts, a different video output, and a stock firewall that blocks a port the original relies on. It also confirmed that all 47 symbols and all 5 function prologues the CarPlay hook needs match on MU1462, so the core approach could work.

## Getting the map onto the cockpit

The CarPlay video is decoded on the head unit and composited into the cockpit's map window. iOS lays the map out inside a "safe area" the hook reports, and I compared several presets on the car until one fit the TT's window.

The tricky part was the small, tach-centred view. Asking iOS to re-layout on a view change was accepted but ignored by both map apps. What worked was detecting the view change in the HMI and having a patched renderer crop the CarPlay picture at a different offset while the small view is up.

For zoom, I patched the HMI (`tt-zoom.jar`, which overrides a few stock Java classes) so that when CarPlay is drawing, the steering-wheel scroll goes to the iPhone as a zoom step instead of to the stock map.

## Getting the turns

Turn-by-turn data comes from the iPhone over iAP2 route guidance. An existing hook asks iOS for guidance updates, and my Java listener speaks its small binary protocol, keeps a merged route state (updates arrive as deltas), and turns it into maneuvers, distances, ETA and lane information. Both Apple Maps and Google Maps go through Apple's 54 maneuver types, which I mapped onto the pictures the panel draws.

## A dead end worth keeping

The obvious plan was to feed the iPhone's turns into the TT's stock guidance banner. I spent about ten versions on it: the BAP navigation path, the stock cluster models, forcing the nav engine's view visible, cycling its guidance modes. I recorded a real stock-navigation drive and replayed it parked. The conclusion was clear: on the TT, the stock banner only draws from the nav engine's own route and map data, and ignores anything fed to it. So I drew my own.

## My own turn panel

The panel is drawn in plain Java on the head unit (there is no AWT), off the HMI thread, into the window the cockpit already uses for the stock guidance banner. Each maneuver is drawn flat, laid onto the road in perspective, then extruded with side walls, a lit top face and a soft shadow, so the arrows look at home next to Audi's own graphics. The static part is cached per maneuver, so a progress bar update is cheap; a full draw takes 10-15 ms on the car.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/altscreen/panel_layouts.png" title="Turn panel layouts" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    The panel in both cockpit views. Top: the wider panel I draw under the trim line in the small, tach-centred view, with lanes and a highway exit badge. Bottom: the compact version inside the stock frame in the large view.
</div>

Every new picture was mocked up on the PC first and checked before it went into a build. The latest version added nine maneuvers, including lane changes, leaving a roundabout, end-of-road T junctions, on-ramp merges, ferries and which side the destination is on.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/altscreen/panel_pictures.png" title="Maneuver pictures" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    Maneuver pictures from v32: the nine new ones, and three existing ones for comparison.
</div>

## How I worked on it

The car was the test bench, always parked. I built a small toolkit for the head unit so each round was the same: copy a kit, switch to the new version, restart the MMI, play a recorded route, and save the logs. Then I came back with photos of the cockpit and the logs, and the next version was built from what they showed. I wrote much of it with Claude Code, and documented how that went in the repo's [Working with Claude](https://github.com/Tristar10/audi-tt-8s-altscreen/blob/main/ports/tt-8s-mu1462/wiki/Working-with-Claude.md) page. It took 32 HMI versions to get here, most of them answering a single question.

## What's next

- A live drive with Apple and Google Maps.
- Logging whole routes while parked, to see every maneuver type without driving it.
- Real junction shapes and roundabout exit stubs from the junction angles, and a small "then" arrow when two turns come close together.
- An SD-card installer, so others with the same firmware don't need SSH.

The full write-up, including every dead end with its evidence, is in the [TT port wiki](https://github.com/Tristar10/audi-tt-8s-altscreen/blob/main/ports/tt-8s-mu1462/wiki/Home.md). It builds on GPL-3.0 work by aberbic, harman-f, luka-dev, f-io, binarybase, yuedizhibo and chefranov; see the repo's credits page.
