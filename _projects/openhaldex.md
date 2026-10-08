---
layout: page
title: OpenHaldex-S3 - DIY AWD controller tinkering
description: Building, flashing and extending an open-source ESP32-S3 Haldex AWD controller, from browser flashing to RaceChrono telemetry.
img: assets/img/openhaldex/t2can_box.jpg
importance: 1
category: work
---

<!-- TODO(Haizhou): one line on the car this runs on and why you wanted it. -->

[OpenHaldex-S3](https://github.com/meatro/OpenHaldex-S3) is an open-source all-wheel-drive controller for Haldex-equipped VW and transverse Audi cars. It runs on an off-the-shelf ESP32-S3 board and plugs in inline at the factory Haldex connector. From there it can pass the car's CAN traffic through untouched, or rewrite selected signals to ask the Haldex coupling for a different amount of lock. A built-in web UI handles setup, lock maps, diagnostics and over-the-air updates.

I built one for my car, then forked the firmware and spent a stretch adding the things I wanted: easier flashing, live telemetry into RaceChrono, a few track-day automations, and a tool for putting the data on top of driving video. My fork is at [Tristar10/OpenHaldex-S3](https://github.com/Tristar10/OpenHaldex-S3).

## The hardware

The controller is a LilyGO T-2CAN: an ESP32-S3 with two independent CAN channels on one board. Two channels is the whole trick. Channel A listens to the car's chassis CAN bus, channel B talks to the Haldex module, and the firmware sits in the middle deciding what to forward.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/openhaldex/t2can_box.jpg" title="LilyGO T-2CAN" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    The LilyGO T-2CAN: ESP32-S3 on the left, two CAN modules on the right.
</div>

## Building the inline harness

The install doesn't cut any factory wiring. I made a short harness with the OEM Haldex connector pair: one end plugs into the car's loom, the other into the Haldex module. Power, ground and the non-CAN signals pass straight through. The chassis CAN pair goes into channel A, the Haldex CAN pair comes out of channel B, and the 12V feed and ground branch off to power the board. Unplugging it puts the car back to stock.

<div class="row">
    <div class="col-sm-4 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/openhaldex/t2can_harness.jpg" title="Harness wired to the T-2CAN" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/openhaldex/inline_harness.jpg" title="Finished inline harness" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    Left: first fit-up, with the two connectors wired to the board's CAN terminals and the power branch. Right: the finished harness, with the board wrapped in foam and taped up to live under the rear seat.
</div>

## Flashing from the browser

Flashing the stock project meant setting up PlatformIO. I added a `flash.py` helper that builds and flashes in one step, and then a browser installer (`tools/web-installer` plus `web_flash.py`) so you can plug the board in over USB-C and flash it from a web page.

I also tried gzip-compressing the web UI assets during the build to make them smaller. Serving the compressed files turned out to be unreliable, so I reverted that change.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/openhaldex/bench_flash.jpg" title="Bench flashing" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    Bench setup: the T-2CAN on USB-C, flashed from the browser installer on the laptop.
</div>

## Telemetry in RaceChrono: Bluetooth first, then Wi-Fi

I wanted the controller's view of the car (speed, RPM, pedal, Haldex lock and mode) logged alongside lap data in RaceChrono. The first version made the board a Bluetooth LE "DIY CAN-bus" device, which showed up in RaceChrono as **OpenHaldex-RC**.

<div class="row">
    <div class="col-sm-4 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/openhaldex/app_gauges.jpg" title="RaceChrono gauges" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/openhaldex/app_device.jpg" title="OpenHaldex-RC device" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    The Bluetooth build: a RaceChrono gauge layout including Haldex Lock %, and OpenHaldex-RC added as a Bluetooth LE CAN-bus device.
</div>

It worked, but the board would sometimes reset. I first hardened the startup: every BLE setup step got checked, and a boot guard in RTC memory turned Bluetooth off on the next boot if it had failed, so the board couldn't get stuck in a reboot loop. I also switched the flash mode to DIO and documented that Bluetooth needs 12V power rather than USB alone. Bisecting further showed that turning on the Bluetooth radio by itself could brown out the board, even on 12V power and regardless of Wi-Fi or transmit power.

For a device that sits inline on the CAN bus and controls the AWD system, a reset mid-drive isn't an acceptable price for a telemetry feature. So I removed Bluetooth entirely and replaced it with a RaceChrono `$RC3` TCP server on the Wi-Fi access point the web UI already uses. It carries the same decoded channels, and I verified it end to end in RaceChrono on iOS, including the Haldex lock and mode reading correctly against live CAN traffic.

## Track-day extras

Version 1.1.1 of my fork added:

- **More telemetry channels** for Gen 5 (MQB) cars over `$RC3`, such as gear, oil pressure, and whether ABS, ESP or EDS/XDS are active.
- **Two experimental automations**, behind a Setup toggle that is off by default:
  - **Switch mode in reverse** drops to FWD while the reverse-light switch is on, so the coupling doesn't bind during tight maneuvers like backing into an autocross box.
  - **Haldex clutch thermal protection** drops to FWD when the clutch temperature (polled over UDS every couple of seconds) crosses a threshold during hard track use.
- **A telemetry video overlay tool**, a small local web app that turns a RaceChrono `.vbo` export into a transparent HUD video (ProRes 4444) to drop over driving footage in any editor.

## A dead end worth keeping

I also wanted engine data that isn't broadcast on the chassis bus, so v1.1.2 added a read-only probe. It sent OBD-II and UDS RPM requests, on both 11-bit and 29-bit addressing, to see whether the gateway would route diagnostics through to the engine ECU. With the engine running there were no replies, so the gateway doesn't pass them. I removed the probe in v1.1.3 and kept it in the history.

<!-- TODO(Haizhou): how it drives, and what's next. -->
