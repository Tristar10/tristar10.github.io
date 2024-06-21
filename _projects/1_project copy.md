---
layout: page
title: A collection of my AU/VST music effects plugins
description: Here are some effect plugins that I made for musical production.
img: assets/img/Wobbler.png
importance: 1
category: work
---

I have been producing music for 6+ years now, and being as a computer engineer with solid foundation of digital signal processing and electrical engineering, I have always been thinking on combine my knowledge into music-making.

I took a wonderful course taught by Professor Luke Dahl in University of Virginia, and introduced us to the projucer platform, a C++ based platform that uses DSP to produce audio effect plugins and synthesizers.

Here I will introduce you to all of the plugins that I made using this platform, tell you what they do, and what are their uniqueness. You can find the source code of these plugins in my [Github Repos](http://github.com/tristar10) that starts with 'MU45'.

This is an EQ plugin that tunes the sound of a sample/instrument. It takes in a signal than modulates the digital filters' parameters according to the user input to change the effect of the sound. The plugin gives the users many controls like the breakpoint frequency of the filters, the Q value of the filters and the gain of the filters. The UI is configured logically and intuitively so anyone can use without any problems. It also has four built-in preset buttons that people might found them handy in music production.

<div class="col-sm mt-3 mt-md-0">
    {% include figure.liquid loading="eager" path="assets/img/EQ.png" title="example image" class="img-fluid rounded z-depth-1" %}
</div>
<div class="col-sm mt-3 mt-md-0">
    {% include figure.liquid loading="eager" path="assets/img/EQSFD.png" title="example image" class="img-fluid rounded z-depth-1" %}
</div>
<div class="caption">
    Above are the GUI and the signal flow diagram of the EQ Plugin.
</div>
Here's a clip that I use the plugin in production: In this track, the chorus is bass boosted using the low shelf below 100Hz, and a sweeping effect is created in the chorus using a notch boost combined with an automation curve.
<div class="col-sm mt-3 mt-md-0">
        {% include audio.liquid path="assets/audio/EQ.wav" controls=true %}
</div>
