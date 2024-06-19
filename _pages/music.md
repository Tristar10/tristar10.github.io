---
layout: page
title: Music
permalink: /music/
description: A growing collection of my musical productions
nav: true
nav_order: 3
display_categories: [work, fun]
horizontal: false
---
<section id="categories" markdown="1">
This is an example post with audios. It supports local audio files.
<link rel="musicplayer" href="assets/css/musicplayer.scss">
<div class="row mt-3">
    <div class="col-sm mt-3 mt-md-0">
        {% include audio.liquid path="assets/audio/HC114.mp3" controls=true %}
    </div>
</div>
<div class="musicplayer">
</div>
<div class="caption">
    A simple, elegant caption looks good between video rows, after each row, or doesn't have to be there at all.
</div>
</section>
<div id="html" markdown="0">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto:400">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/node-waves/0.7.5/waves.min.css">
    <link rel="stylesheet" href="https://michael-zhigulin.github.io/mz-codepen-projects/Material%20Design%20UI%20Audio%20Player/font/font.css">
    <link rel="stylesheet" href="assets/css/musicplayer1.less">
    <script src="https://code.jquery.com/jquery-2.1.1.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/node-waves/0.7.5/waves.min.js"></script>
    <script src="assets/js/musicplayer1.js"></script>
    <div class="container">
    <div class="player">
        <div class="like waves-effect waves-light">
        <i class="icon-heart"></i>
        </div>
        <div class="mask"></div>
        <ul class="player-info info-one">
        <li>Rock'n'Roll Nerd</li>
        <li>Tim Minchin</li>
        <li>5:34</li>
        </ul>
        <ul class="player-info info-two">
        <li>Rock'n'Roll Nerd</li>
        <li>Tim Minchin</li>
        <li><span id="duration"></span><i> / </i>5:34</li>
        </ul>
        <div id="play-button" class="unchecked">
        <i class="icon icon-play"></i>
        </div>
        <div class="control-row">
        <div class="waves-animation-one"></div>
        <div class="waves-animation-two"></div>
        <div id="pause-button">
            <i class="icon"></i>
        </div>
        <div class="seek-field">
            <input id="audioSeekBar" min="0" max="334" step="1" value="0" type="range" oninput="audioSeekBar()" onchange="this.oninput()">
        </div>
        <div class="volume-icon">
            <i class="icon-volume-up"></i>
        </div>
        <div class="volume-field">
            <input type="range" min="0" max="100" value="100" step="1" oninput="audio.volume = this.value/100" onchange="this.oninput()">
        </div>
        </div>
    </div>
    </div>
    <audio id="audio-player" ontimeupdate="SeekBar()" ondurationchange="CreateSeekBar()" preload="auto" loop>
    <source src="https://michael-zhigulin.github.io/mz-codepen-projects/Material%20Design%20UI%20Audio%20Player/audio/Tim%20Minchin%20%E2%80%94%20Rock%20n%20Roll%20Nerd.ogg" type="audio/ogg">
    <source src="https://michael-zhigulin.github.io/mz-codepen-projects/Material%20Design%20UI%20Audio%20Player/audio/Tim%20Minchin%20%E2%80%94%20Rock%20n%20Roll%20Nerd.mp3" type="audio/mpeg">
    </audio>
</div>
