---
layout: page
title: OpenHaldex on a LilyGO T-2CAN
description: An ESP32-S3 dual-CAN board spliced inline with a Haldex AWD controller, flashed from the browser and monitored live over Bluetooth.
img: assets/img/openhaldex/t2can_box.jpg
importance: 1
category: work
---

<!-- TODO(Haizhou): opening paragraph. What car is this on, what you wanted out of the Haldex, and how this fits with the upstream OpenHaldex project. -->

This is a side project where I got OpenHaldex running on a LilyGO T-2CAN and put it in a car. The board sits inline between the Haldex all-wheel-drive controller and the car's wiring, so it can see the CAN traffic going to the coupling. A browser-based installer handles flashing, and a phone app reads the live data back over Bluetooth.

## The hardware

The brain is a LilyGO T-2CAN: an ESP32-S3 with two separate CAN channels on one board, each with its own screw-terminal block. Two channels is the important part. One side can talk to the car and the other side to the Haldex controller.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/openhaldex/t2can_box.jpg" title="LilyGO T-2CAN" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    The LilyGO T-2CAN: ESP32-S3 on the left, two CAN modules on the right.
</div>

## Wiring it inline

To avoid cutting the factory loom, I built a short adapter harness with a matching connector on each end. It plugs in between the car's connector and the Haldex controller. The CAN pairs from each connector go to their own channel on the T-2CAN, and two extra leads bring power to the board's power terminal.

<!-- TODO(Haizhou): confirm which connector goes to which CAN channel, and whether any signals pass straight through untouched. -->

<div class="row">
    <div class="col-sm-4 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/openhaldex/t2can_harness.jpg" title="Harness wired to the T-2CAN" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/openhaldex/inline_harness.jpg" title="Finished inline harness" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    Left: first fit-up, with the two connectors wired to the board's CAN terminals and power taps. Right: the finished harness, with the board wrapped in foam and taped up so it can live in the car.
</div>

## Flashing from the browser

The firmware repo has a `tools/web-installer` (a small `index.html` and `installer.js`) alongside `flash.py` and `web_flash.py` scripts. Instead of setting up a toolchain every time, you plug the board in over USB-C and flash it from a web page. The board's web UI assets are generated and compressed as part of the build.

<!-- TODO(Haizhou): link to your fork / repo, and what you changed vs. upstream (T-2CAN port? web installer? BLE?). -->

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/openhaldex/bench_flash.jpg" title="Bench flashing" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    Bench setup: the T-2CAN connected over USB-C and flashed from the web installer on the laptop.
</div>

## Live data on the phone

The board shows up as **OpenHaldex-RC**, a Bluetooth LE CAN-bus monitor, in a driving-data app on my phone. Once it's connected, the app shows gauges for speed, RPM, throttle position, steering angle, boost, oil, transmission and coolant temperatures, and a **Haldex Lock %** gauge, so I can watch what the coupling is being told to do while driving.

<div class="row">
    <div class="col-sm-4 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/openhaldex/app_gauges.jpg" title="Live gauges" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/openhaldex/app_device.jpg" title="OpenHaldex-RC device" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    Left: the gauge layout, including Haldex Lock %. Right: OpenHaldex-RC added as a Bluetooth LE CAN-bus device.
</div>

<!-- TODO(Haizhou): results. How it drove, any modes you tried, what didn't work, what's next. -->
