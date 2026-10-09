---
layout: page
title: MIDICreator - a smart MIDI controller for beginner producers
description: My ECE capstone, which I led. A 12-button MIDI controller with a built-in screen, a chord mode and a guitar strum mode, built on a Raspberry Pi Pico.
img: assets/img/midicreator/controller.jpg
importance: 0
category: work
---

MIDICreator is the project I care about most. It started as an idea I had been carrying around for years as a music producer, and in my final semester at UVA (Fall 2024) I got to build it as my Electrical and Computer Engineering capstone. I proposed it, led the five-person team **To: Be Continued**, planned the features and parts, wrote the MIDI firmware, and designed the enclosure in CAD.

The result is a working USB MIDI controller with twelve transparent buttons sitting over a screen. The screen shows what each button will play, so you can see the note or chord under your finger. On top of a normal note mode, it has a **Chord Mode** that only offers chords that fit the key you picked, and a **Strum Mode** that turns each row of buttons into a guitar chord you can strum across.

The code and the full final report are on GitHub at [ZzzzzzT233/TBC_Capstone](https://github.com/ZzzzzzT233/TBC_Capstone).

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/midicreator/controller.jpg" title="The finished MIDICreator" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    The finished controller: a 3D-printed resin case, a screen on top, twelve clear grid buttons over it, and the five-way navigation stick on the right.
</div>

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include video.liquid path="https://www.youtube.com/embed/KZbZeCWBt0g" class="img-fluid rounded z-depth-1" %}
    </div>
</div>
<div class="caption">
    MIDICreator in action.
</div>

## Why I wanted to build it

I grew up around music. My mom is a music teacher, I learned three instruments, and I played in my school orchestra for five years. When I started producing, a lot of my friends wanted to try it too, so I started teaching them the basics. That is where the idea came from. Many of them struggled to write anything that followed the rules of harmony, and often they couldn't hear that something was off. Most of them had never had any music education, and some gave up because the theory felt like a wall. I have wanted to find a way to lower that wall ever since.

That same semester I wrote my STS research on this question: how unequal music education and access to technology shape who gets to make music. One thing I looked at was Apple's Smart Chord strips in Logic Pro and Logic Remote, which suggest chords that fit your key. They work well, but only inside Apple's ecosystem, even though MIDI itself is universal. MIDICreator was my attempt to put that kind of help into a plain USB MIDI device that works with any DAW.

The thing that slows beginners down is rarely the software. It is music theory. A pad controller gives you one note per pad, so to play a chord you have to know which notes make it up and where they are on the grid. Most pad layouts don't tell you which pad is which note, either, so you have to memorize them.

Some commercial controllers already have a chord mode. The Novation Launchpad Pro [MK3] is the best known. But you switch modes in companion software on the computer, so you end up juggling that software and your DAW, and the pads light up without telling you what they play. The labels are on the screen while your eyes are on the pads.

My idea was to put the information where the player is already looking. If the buttons are see-through and there is a screen right under them, each button can show its own note or chord name. Once the screen is there, it can also do the theory for you: pick a key, and every button becomes a chord that belongs in it.

## What it does

You plug the controller into a computer over USB. It shows up as a standard USB MIDI device, so any DAW can use it with no driver or companion app. The top of the screen shows the current mode. You move through the menus with the five-way stick (up and down to scroll, left to go back to the home page, press to select).

- **Traditional Mode.** A normal MIDI controller. The twelve buttons play the twelve chromatic notes of one octave, from middle C (MIDI note 60) up to B. A note plays while its button is held, and pressing several buttons plays a chord.
- **Chord Mode.** You choose a key first: any of seven major or seven minor keys. The twelve buttons then fill with chords from that key, and each button shows its chord name. In C major the grid holds Em, Am, Dm, G, C and F, plus E, A and D, the chords that pull back toward the key (the secondary dominants), so a beginner can wander away from the home chords and still land somewhere that sounds right. Pressing a button plays the whole chord.
- **Strum Mode.** This one imitates a guitar. You pick a major key, then pick three chords from that key's list, which includes the dominant 7th. Each row of four buttons becomes one chord, and each button in the row is one "string": the chord's three notes an octave down, plus the root an octave above. Swiping a finger along a row plays the notes one after another, like a strum.

## How it works

Every grid button sits over a small tactile switch on a thin button PCB. The switch wiring runs to a main PCB that carries a Raspberry Pi Pico. When a switch closes, the Pico sends a MIDI NoteOn over USB to the computer, and a NoteOff when it opens. The same Pico drives the screen through an Adafruit DVI breakout. The five-way stick sits on the top button PCB and goes to its own GPIOs.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/midicreator/block_diagram.png" title="Block diagram" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    Signal paths. Blue: a grid button press becomes MIDI data to the computer. Orange: the five-way stick drives the menus, and the Pico draws them through the DVI socket.
</div>

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/midicreator/cross_section.png" title="Cross section" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    Side view of the stack: grid buttons on top, button PCBs between the rows, the screen under the buttons, and the main PCB at the bottom.
</div>

## The MIDI firmware

I wrote the MIDI side in CircuitPython on the Pico, using Adafruit's `adafruit_midi` library over the Pico's built-in USB MIDI port. We picked the Pico over an STM32 because CircuitPython made the MIDI and display libraries easy to get going, and it was cheap. We stayed on the original Pico rather than the Pico 2, which at the time had a reported GPIO latch-up erratum and was hard to get.

The firmware is one main loop. Each pass checks the navigation stick and every grid button, and sends NoteOn or NoteOff for any button whose state changed. Each button remembers whether it is held, so a held button doesn't keep re-sending notes.

- **Notes as numbers.** Traditional Mode is just an array of twelve MIDI note numbers, 60 to 71, indexed the same way as the button array.
- **Chords as strings.** Chords are stored by name (`"Am"`, `"F#"`, `"Ddim"`, `"G7"`), because the UI needs to print the same names on screen. A small `chord_to_midi()` function splits a name into its root and quality, looks up the root's note number, and adds the intervals for major, minor, diminished, augmented or dominant 7th.
- **Precomputed per key.** When you pick a key, the firmware converts all twelve chord names into lists of note numbers once and stores them. A button press then loops over that button's list and sends a NoteOn for each note, so the whole chord sounds at once.
- **Strum Mode.** Each of the three chosen chords is converted, dropped an octave, cut to its three chord tones, and given the root an octave up as a fourth note. Instead of putting the whole chord on one button, the firmware spreads it across a row, one note per button.

## The user interface

My teammates Tong Zhou and Jinhong Zhao built the on-screen interface with CircuitPython's `displayio` and Adafruit's display-text and shapes libraries. The screen runs at 320 x 240, rotated to portrait. The menus are a small state machine: the stick moves a selection up or down a list, the arrows disappear at the ends of the list, and pressing the stick confirms. The bottom of the screen draws a 4 x 3 grid of labels that lines up with the physical buttons.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/midicreator/ui_tree.png" title="UI tree" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/midicreator/ui_fsm.png" title="Menu state machine" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    Left: the page tree from mode selection down to the key and chord pages. Right: the up/down/select state machine behind each menu.
</div>

Memory was the hard limit. With a full-screen background and decorative borders, the Pico would eventually crash with memory allocation errors after enough mode changes. The fix was to drop the background fill, keep a plain rectangular border, update only the labels that change instead of redrawing the screen, and run garbage collection after removing elements.

## PCBs

Jennifer Shern drew the schematics and laid out the boards in KiCad, with help from Wanghaotian Zhang and me. There are two designs:

- **Main PCB** (45 x 57 mm). The Pico and DVI breakout mount here, with a row of through-holes along one edge for the wires to the button boards and a ground plane on the back.
- **Button PCB.** A long, thin strip that sits between two rows of grid buttons, with four mini tactile switches and a footprint for the five-way stick. We needed custom footprints for the 3 x 6 x 5 mm switches, measured by hand.

The grid buttons use GPIO 5 to 11 and 20 to 22 plus 26 and 27, the stick uses GPIO 0 to 4, and the DVI breakout takes GPIO 12 to 19. The boards passed KiCad's design rule check and a FreeDFM review with no show-stoppers, and JLCPCB made them. The first revision worked, so we never needed a second one. The one thing we got wrong was spacing the through-holes too tightly for the low-profile connectors we had planned, so we soldered the wires directly instead.

<div class="row">
    <div class="col-sm-4 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/midicreator/main_pcb.png" title="Main PCB layout" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0 d-flex align-items-center">
        {% include figure.liquid loading="eager" path="assets/img/midicreator/button_pcb.png" title="Button PCB layout" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    Left: main PCB layout around the Pico. Right: one of the button PCB strips.
</div>

## The enclosure

I designed the case in Fusion 360. The look came from two things I liked: stream decks, which put an LCD under clear keys, and the Jubeat arcade machine, which has a grid of clear buttons over a screen with a navigation area above it. That is close to where MIDICreator ended up.

The case is a three-layer sandwich, so it can be printed and assembled in pieces:

- **Bottom base** (285 x 175 x 33.2 mm). Holds the main PCB and wiring. A cross-shaped beam raises the screen off the uneven board underneath, and a side opening lets the USB cables out.
- **Middle case** (21.8 mm). Holds the button PCBs and supports the buttons, and walls off the display area from the button area.
- **Top case** (8.2 mm). Holds the buttons in place and covers the PCBs.

The buttons were the trickiest part. A clear button can't have a switch right under it, because the switch would block the screen. So each button has a pair of legs that reach sideways and down to a switch hidden under the top case, next to the button. A button pressed in the middle would barely move those legs, so I slanted the top: the leg side is raised and the other side sits flush. The button rocks on the low edge like a lever and presses the switch. Grooves on the legs seat them on the switch tops.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/midicreator/cad_top.jpg" title="Top case" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/midicreator/cad_middle.jpg" title="Middle case" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/midicreator/cad_bottom.jpg" title="Bottom base" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/midicreator/cad_button.jpg" title="Grid button" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    The Fusion 360 models: top case, middle case, bottom base, and a grid button (41 x 27.5 x 15 mm).
</div>

The school's printers couldn't do clear parts or a case this big, so we sent it out to a print service. It took two rounds. The first prints were off in width and squareness, the base was too shallow for the DVI board, and the top was too thin around the buttons. We ground the parts down to make them fit, then I redid the design with more tolerance everywhere. The second print went together, with only the button openings a little loose. The case is 9600 resin and the buttons are clear 8001 resin.

## Building and testing it

We tested in three tracks (software, PCB and mechanical), each step gating the next. Bring-up had a few surprises. The Pico's header sockets were placed so close that it wouldn't seat, so we bent its pins slightly. Then the board read 0 V everywhere, because only the DVI breakout had actually been soldered to the main PCB. After re-soldering, the 3.3 V rail came up at 3.29 V. From there the display came up on the first try, and all three modes played correctly. The memory crashes described above showed up only after long use, and went away once we slimmed down the UI.

The final controller measures 285 x 175 x 48 mm. It met nearly every goal in our proposal: it plays notes and chords, it lets someone with little theory make music that sounds right, and it is easy to navigate.

## Leading the team

The team was Tong Zhou, Jinhong Zhao, Jennifer Shern, Wanghaotian Zhang and me. As project lead I set the feature list, chose the hardware, split the work and kept the sub-teams in sync. I also floated between groups when they needed help, on PCB design, the UI and 3D printing.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/midicreator/team_roles.png" title="Team roles" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    Team roles from our proposal, with the planned sequence of work underneath.
</div>

We ran the semester off a Gantt chart and checked it every week. The PCBs were designed by October 15th and arrived October 25th. The case design was done before the end of November. Integration took longer than planned, but because the earlier phases finished early we still had room to test, and every deadline was met. The prototype cost $511.99 with two rounds of printing, re-orders and shipping, a little over our $500 budget. Most of it went to 3D printing:

| Item                                                                |        Cost |
| :------------------------------------------------------------------ | ----------: |
| 3D printing (JLC3DP), first version                                 |     $154.99 |
| 3D printing (JLC3DP), second version                                |     $144.48 |
| Adafruit (Pico, DVI sock, five-way switches, headers, cables)       |      $79.52 |
| 10.1" HDMI screen                                                   |      $59.48 |
| Screen and USB cabling (flat flex HDMI, USB splitters and adapters) |      $42.30 |
| Extra Pico board, mini tactile switches                             |      $15.47 |
| PCBs (JLCPCB, 5 main + 5 button boards, shipped)                    |      $15.75 |
| **Total**                                                           | **$511.99** |

Only about one of each part ended up in the final unit, and those parts came to $222.21, almost half of it 3D printing. In volume, a molded case and fewer cables would bring that down a lot.

## What I'd do next

- **A stronger processor or more memory**, so the UI can be richer and give beginners more guidance on screen. We bought a touchscreen and never got to use the touch layer.
- **One cable.** Right now it takes two USB ports: one for the screen and one for the Pico.
- **A MIDI mapping mode** so users can assign their own notes to buttons.
- **Bluetooth MIDI and a battery**, to make it wireless.
- **A better button mechanism and tighter print tolerances**, so the buttons feel solid and don't slide.
