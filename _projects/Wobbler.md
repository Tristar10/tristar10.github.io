---
layout: page
title: Wobbler-A VST/AU Plugin that makes your sound wobble.
description: This effect plugin is meant to create WObble Chords/Bass in music.
img: assets/img/Cover.png
importance: 2
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

<div class="row">
    <div class="col-sm-4 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/EQ.png" title="example image" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm-8 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/EQSFD.png" title="example image" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    Above are the GUI and the signal flow diagram of the EQ Plugin.
</div>

Here's a clip that I use the plugin in production: In this track, the chorus is bass boosted using the low shelf below 100Hz, and a sweeping effect is created in the chorus using a notch boost combined with an automation curve.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
    </div>
    <div class="col-sm mt-3 mt-md-0">
            {% include audio.liquid path="assets/audio/EQ.wav" controls=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
    </div>
</div>




This is a Chorous plugin that produces a "Chorous" effect on a signal. This is by using a comb filter and a slight delay to create a "stack" of sound that simlate multiple people singing, or multiple instruments playing, etc. Again, I have given the user full control of the parameters. It is worth mentioning that the two dB sliders are actual linear dB gain, rather than a traditional exponential gain.

<div class="row">
    <div class="col-sm-9 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/ChorousSFD.png" title="example image" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm-3 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/Chorous.png" title="example image" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    Above are the GUI and the signal flow diagram of the chorous Plugin.
</div>

This was my first time messing with a custom background so I went nuts on it and picked the most brainrot picture I could find in my album.

Here's a clip that I use the plugin in production: I used the chorus in my vocal. In the first part of the chorus, I cranked up the effects, so it feels like there is a vocal backing at a smaller volume sing from behind. Then, in the first part of the instrumental, I turn down the intensity of the vocal track, since now it is a vox instrument, and playing very quietly from behind. I don’t want to increase the burden of mixing, so I temporarily turned down the intensity. But, on the second part of the instrumental, I pushed the vox to a higher volume so it’s now a supplement of the leading instrument. Therefore, I turned the intensity back up, so it now sounds more spatial. Even though the parameters of the two parts that implemented the chorus are pretty much the same, they are for different purposes.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
    </div>
    <div class="col-sm mt-3 mt-md-0">
            {% include audio.liquid path="assets/audio/Chorous.mp3" controls=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
    </div>
</div>




This is a delay plugin that is supposed to create a delay effect, which is similar to what is perceived as echoes. The user have the ability to control the decay time, feedback strength, wet and dry gain, as well as a built in low pass filter. The user can also enter the BPM and select the presets that I found most useful.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
    </div>
    <div class="col-sm mt-3 mt-md-0">
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/Delay.png" title="example image" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
    </div>
    <div class="col-sm mt-3 mt-md-0">
    </div>
</div>

<div class="caption">
    Above is the GUI of the delay Plugin.
</div>

The ecological example is where I used the delay in my most used scenario: mixing vocals. In this song (I also made the instrumental part), the first intro vocals, with the low pass enabled, had a ¼ delay. All the rest of the vocals are dry vocals, which I used my delay effect and stock reverb with around 25% sends to create wet, mixed vocals. I also added the delay to my rhythm guitar track, which is a common pracEce in playing/mixing the guitar. I would say I prefer this delay over my big, fat, over complicated stock delay plugin. Since I compose with my tiny laptop, my screen space is saved with this small plugin, and it has all the features I need.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
    </div>
    <div class="col-sm mt-3 mt-md-0">
            {% include audio.liquid path="assets/audio/Delay.wav" controls=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
    </div>
</div>
