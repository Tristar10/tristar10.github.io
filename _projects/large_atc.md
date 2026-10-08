---
layout: page
title: Large ATC - a VR air traffic control simulator
description: A team-built Unity VR simulation of a multi-runway airport, with waypoint-based aircraft routing, a floating VR control panel and local voice commands.
img: assets/img/large_atc/airport_overview.jpg
importance: 1
category: work
---

Large ATC was a spring 2026 team project: a virtual reality air traffic control simulator in Unity, built for the Meta Quest 3. It extends an earlier, smaller single-airport ATC simulation into a large airport with two player-controlled runways, a control tower, taxiways and gates. You stand in the tower and clear aircraft to land, take off or hold, either with buttons in VR or by speaking the instruction.

The idea behind it is training access. Air traffic controllers usually train in expensive simulation labs, and a headset-based simulator could make that practice cheaper and easier to get to, while still feeling like the complexity of a real airport.

Team: Derek Hansen, Sriya Gandikota, Nyla Rose Gordon-Crocker, John Murphy, Haizhou Yu and Dawson Johnson. Code: [hanse7962/Large-ATC-Project](https://github.com/hanse7962/Large-ATC-Project).

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/large_atc/airport_overview.jpg" title="Airport overview" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/large_atc/airport_top.jpg" title="Airport from above" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    The finished airport: runways on either side of the terminal and tower, built with the Airport Resource Pack, custom prefabs and Unity's terrain editor.
</div>

## Who did what

| Area                                                                     | Owner                     |
| ------------------------------------------------------------------------ | ------------------------- |
| `PlaneCommander.cs`, waypoint path structure, VR plane-control interface | Haizhou                   |
| Runway and taxiway navigation, grabbable tower objects, repo and merging | Derek                     |
| Airport layout, prefab configuration and animation                       | Sriya, Nyla               |
| Airport layout and implementation, terrain, custom assets                | John                      |
| LLM voice command pipeline                                               | Dawson                    |

## My part: from hard-coded paths to waypoints

In the earlier small-airport version, each aircraft's route was hard-coded. That works for one runway, but it falls apart once there are two runways, several taxiways and gates, because every new route means new code.

I rebuilt the aircraft control around path data that lives in the scene instead of in the script:

- **Paths are GameObjects.** Each movement path is a parent GameObject holding an ordered list of waypoint transforms, so a path is laid out and adjusted in the Unity editor rather than typed in as coordinates.
- **`PlaneCommander.cs` builds routes from them.** The ATC logic assembles a route for landing, takeoff, holding or taxiing out of those paths when the command comes in.
- **Data and control are separate.** The existing queueing and movement logic stayed intact; it just runs on the more flexible path data, so adding a runway or a taxiway is a scene change, not a rewrite.

I set up that node and waypoint structure, and Derek built on it to add the runway and taxiway navigation, with A\* shortest-path routing so aircraft taxi dynamically between runways and gates.

I also made the plane-control interface: a floating panel in VR with buttons you press with the controllers to issue clearances.

## Voice commands

The other way to control traffic is to talk. Holding a controller button (or the spacebar) records the microphone on the Quest 3, a local whisper.cpp model transcribes it, and a local Qwen3 1.7B model turns the transcript into a strict JSON command that calls straight into `PlaneCommander.cs`. Everything runs locally, with end-to-end latency under three seconds.

<div class="row">
    <div class="col-sm-8 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/large_atc/voice_pipeline.png" title="Voice pipeline" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    The voice pipeline: microphone, Whisper transcript, Qwen3 command, then the same `PlaneCommander` actions the VR buttons use.
</div>

The language model is held to a tight prompt. It acts only as an ATC command interpreter and returns just two fields, a runway number and one of `landing`, `takeoff` or `holding`. With no runway mentioned it defaults to runway 1, anything that isn't a valid instruction comes back as `NONE`, and it is allowed to fix obvious transcription slips, like hearing "too" for "two". Keeping the output that strict is what keeps the parsing downstream from breaking.

## Where it ended up

- A complete large-airport environment with terrain and surrounding detail.
- Aircraft that route themselves across the airport by shortest path instead of following fixed scripts.
- Two ways to control traffic: VR buttons or spoken instructions.

Next steps the team pointed to were more aircraft, multiplayer, more realism and better language models.
