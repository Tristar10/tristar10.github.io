---
layout: page
title: Wobbler-A VST/AU Plugin that makes your sound wobble.
description: This effect plugin is meant to create WObble Chords/Bass in music.
img: assets/img/Cover.png
importance: 1
category: work
---

I have been producing music for 6+ years now, and being as a computer engineer with solid foundation of digital signal processing and electrical engineering, I have always been thinking on combine my knowledge into music-making.
I took a wonderful course taught by Professor Luke Dahl in University of Virginia, and introduced us to the projucer, a C++ based platform that uses DSP to produce audio effect plugins and synthesizers.
Here I will introduce you to the biggest audio effects plugin that I made, the Wobbler. As this website is more of a comprehensive overview of what I've done, I will not explain too deep. For more `in-depth details`, you can find the `source code` and the `technical project report` of these plugins in my [Github Repos](http://github.com/tristar10) that starts with `'MU45'`.

Again, huge thanks to professor Dahl for kickstarting all of these. This is undoubtly the best course I've ever taken in UVA.

Starting off, what is Wobble and why make a plugin for this purpose only? I am a future house lover, and one of the signature sounds for this genre and other genres including bass house, future bass, etc, use this effect.

<html lang="en">
<head>
    <meta charset="UTF-8">
    <script src="https://w.soundcloud.com/player/api.js" type="text/javascript"></script>
</head>
<body>
  <iframe width="100%" height="166" scrolling="no" frameborder="no" allow="autoplay" src="https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/334196027&color=%23525764&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true"></iframe><div style="font-size: 10px; color: #cccccc;line-break: anywhere;word-break: normal;overflow: hidden;white-space: nowrap;text-overflow: ellipsis; font-family: Interstate,Lucida Grande,Lucida Sans Unicode,Lucida Sans,Garuda,Verdana,Tahoma,sans-serif;font-weight: 100;"><a href="https://soundcloud.com/dondiablo" title="Don Diablo" target="_blank" style="color: #cccccc; text-decoration: none;">Don Diablo</a> · <a href="https://soundcloud.com/dondiablo/momentum" title="Don Diablo - Momentum" target="_blank" style="color: #cccccc; text-decoration: none;">Don Diablo - Momentum</a></div>
    <script src="https://w.soundcloud.com/player/api.js" type="text/javascript"></script>
    <script type="text/javascript">
    (function(){
      var widgetIframe = document.getElementById('sc-widget'),
          widget       = SC.Widget(widgetIframe);

      widget.bind(SC.Widget.Events.READY, function() {
        widget.bind(SC.Widget.Events.PLAY, function() {
          // get information about currently playing sound
          widget.getCurrentSound(function(currentSound) {
            console.log('sound ' + currentSound.get('') + 'began to play');
          });
        });
        // get current level of volume
        widget.getVolume(function(volume) {
          console.log('current volume value is ' + volume);
        });
        // set new volume level
        widget.setVolume(50);
        // get the value of the current position
      });
    }());
    </script>
</body>
<div class="caption">
    Here's the track that defined wobble effect in Future House: Momentum
</div>

I have been using Xfer Records's LFOTool for quite a while to create the wobble effects. However, the plugin although very versatile, it is also very complicated. Therefore I wanted to make a straighHorward, simple yet useful plugin to create the effect of wobble on any instruments. This could be synths, bass, leads, or even other samples like vocals.


<div class="row">
    <div class="col-sm mt-3 mt-md-0">
    </div>
    <div class="col-sm-6 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/LFOTool.png" title="example image" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
    </div>
</div>
<div class="caption">
    Xfer's LFOTool's GUI. Very complicated, but some of the functions are redundant for my use case.
</div>

To start with, the plugin is essentially two gains per channel that were modulated by a pair of LFOs (Low-Frequency Oscillators), and then the mix between the dry and wet signals could be adjusted to produce an optimal effect. Moreover, a low pass filter is also included to filter out some of the nasty high-frequency noises. 


<div class="row">
    <div class="col-sm mt-3 mt-md-0">
    </div>
    <div class="col-sm-6 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/WobblerSFD.png" title="example image" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
    </div>
</div>
<div class="caption">
    The signal flow diagram of Wobbler
</div>

I had some thoughts when creating the GUI: I first layout the sliders, buVons, and visualizer for the plugin. I grouped the speed, attack, and high cut on the top right corner, because they are they define the shape of the waveform and the frequency spectrum. The mix knob is on its separate to the right, like the design on the plugin `kickstart`. The rate sliders, BPM label and buVons are down one row. It is in a symmetrical design for beVer looks. After All this finished, I looked for a background picture to start the design. I came across this blue, wavy looking paVern, that reminds me of the word “wobble”. I used Photoshop to create different layers: one for the background, one for the sliders’ region with 
the round edge rectangular design, and one for the “Wobble” word logo and the bars in between the sliders to separate their region. I changed a lot of opacity, and blending with shadow, glow, and the background was done. I also changed the colors of the sliders and buVons, so they matched the color scheme, I even went into the detail of changed the RGB values of the color to fine tune them. The color of the rails, knobs, text, textbox background of the slider, and the color of the textbox text, textbox background, also the color of the text of the text-button and its background, as all been customized.


It took me one whole day from starXng to design the GUI to finish, and I really put a lot of work and effort as well as cra-smanship into it, and I hope everyone else will be pleased by the looks of it as what I do.



<div class="row">
    <div class="col-sm mt-3 mt-md-0">
    </div>
    <div class="col-sm-6 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/Wobbler.png" title="example image" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
    </div>
</div>
<div class="caption">
    The GUI of Wobbler
</div>



<div class="row">
    <div class="col-sm mt-3 mt-md-0">
    </div>
    <div class="col-sm mt-3 mt-md-0">
            {% include audio.liquid path="assets/audio/EQ.wav" controls=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
    </div>
</div>

I made this song using the wobble chords effects generated from the Wobbler. You can find the video of this on the [Wobbler repo](http://github.com/Tristar10/MU45-Wobbler-Plugin)

<html lang="en">
<head>
    <meta charset="UTF-8">
    <script src="https://w.soundcloud.com/player/api.js" type="text/javascript"></script>
</head>
<body>
  <iframe width="100%" height="166" scrolling="no" frameborder="no" allow="autoplay" src="https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/1853392689&color=%23525764&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true"></iframe><div style="font-size: 10px; color: #cccccc;line-break: anywhere;word-break: normal;overflow: hidden;white-space: nowrap;text-overflow: ellipsis; font-family: Interstate,Lucida Grande,Lucida Sans Unicode,Lucida Sans,Garuda,Verdana,Tahoma,sans-serif;font-weight: 100;"><a href="https://soundcloud.com/james-yu-38183882" title="Tristar" target="_blank" style="color: #cccccc; text-decoration: none;">Tristar</a> · <a href="https://soundcloud.com/james-yu-38183882/citypop-future-bass-vocaloid-commission-track" title="Citypop &amp; Future Bass &amp; VOCALOID commission track" target="_blank" style="color: #cccccc; text-decoration: none;">Citypop &amp; Future Bass &amp; VOCALOID commission track</a></div>
    <script src="https://w.soundcloud.com/player/api.js" type="text/javascript"></script>
    <script type="text/javascript">
    (function(){
      var widgetIframe = document.getElementById('sc-widget'),
          widget       = SC.Widget(widgetIframe);

      widget.bind(SC.Widget.Events.READY, function() {
        widget.bind(SC.Widget.Events.PLAY, function() {
          // get information about currently playing sound
          widget.getCurrentSound(function(currentSound) {
            console.log('sound ' + currentSound.get('') + 'began to play');
          });
        });
        // get current level of volume
        widget.getVolume(function(volume) {
          console.log('current volume value is ' + volume);
        });
        // set new volume level
        widget.setVolume(50);
        // get the value of the current position
      });
    }());
    </script>
</body>

For detail explation of the algorithm and specs, please visit the [Wobbler repo](http://github.com/Tristar10/MU45-Wobbler-Plugin) to see the source code, python visualization, and my technical report.
