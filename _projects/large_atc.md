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

I rebuilt the aircraft controller, `SimplePlaneCommander` in `PlaneCommander.cs`, around path data that lives in the scene instead of in the script.

**Paths are GameObjects.** Each plane gets five path parents in the Inspector: holding, landing, ground (rollout to the gate area), taxi to runway, and takeoff. Each one is an empty GameObject whose children are the waypoints in order, so a route is laid out and dragged around in the Unity editor rather than typed in as coordinates. Airborne paths are handed to the flight guidance (the SparseDesign ControlledFlight path follower) as a list of objects, with the holding pattern set to loop. Ground paths are read once at start into lists of positions.

**Each plane runs a small life cycle:**

1. **Holding.** Every plane starts on the looping holding path and joins a shared landing queue, sorted by a per-plane priority (lower goes first).
2. **Landing.** When cleared, the plane flies to an entry fix placed at the first landing waypoint, then switches onto the landing path.
3. **Rollout and taxi.** Once it reaches the stop point on the runway, it leaves flight mode: the guidance is switched off, the rigidbody goes kinematic, and the plane drives along the ground waypoints itself, turning toward each one at a set turn rate and speed.
4. **Takeoff queue.** At the end of the ground path it joins a takeoff queue. When cleared, it taxis to the runway, waits two seconds, switches flight guidance back on and follows the takeoff path out.

**One plane holds ATC authority.** The landing and takeoff queues are static, so every plane shares them, and exactly one plane instance (the one with the lowest instance ID) owns the controls and runs the three ATC commands: `ATC_ClearNextForLanding`, `ATC_ClearNextForTakeoff` and `ATC_ReassertHolding`, which sends every airborne plane back to holding and rebuilds the landing queue. Those three public methods are the whole control surface. Keyboard keys call them during testing, and the VR panel and the voice pipeline call the same three.

**Data and control are separate.** Because the routes are scene data, adding a runway or a taxiway is a scene change, not a rewrite of the controller. I set up that node and waypoint structure, and Derek built on it to add the runway and taxiway navigation, with A\* shortest-path routing so aircraft taxi dynamically between runways and gates.

I also made the plane-control interface: a floating panel in VR with buttons you press with the controllers to issue those clearances.

## Voice commands

The other way to control traffic is to talk. Holding a controller button (or the spacebar) records the microphone on the Quest 3, a local whisper.cpp model transcribes it, and a local Qwen3 1.7B model turns the transcript into a strict JSON command that calls the same `PlaneCommander` methods as the buttons. Everything runs locally, with end-to-end latency under three seconds.

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
