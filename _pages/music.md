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
<section id="player" markdown="0">
{% include musicPlayer.html %}
</section>
