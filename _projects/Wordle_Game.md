---
layout: page
title: JAVAFX Wordle Game
description: A replica game of the NYT's Wordle to solve some addiction issue
img: assets/img/nyt_gui.png
importance: 1
category: work
---

This is a project that I made for CS3140 software development. I was in a group with my good friend Jiaji Ma (Shout out to him and also Cookout) when we created this together.

To start, if you don't know what is `Wordle`, this is how it looks like: 
<div class="row">
    <div class="col-sm mt-3 mt-md-0">
    </div>
    <div class="col-sm-6 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/nyt_gui.png" title="example image" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
    </div>
</div>

This is a game which you basically guess a random 5-letter word. If a letter is contained in the word and is at the correct index, it will show green. If it is in another index, it will show yellow. If it is not contained in the word, it will show grey. Easy enough? The thing is, this NYT wordle only refreshes daily. So when you're done for the day, you gotta wait 24 hours for the next one! Looks like we have an addiction problem here!


The way we developed this APP is that we first start with creating the command-line version, then we create a seperate GUI that links to the command line. The whole development process is following the MVC framework, and we want functions minding their own business as much as possible by limiting the arguements and return variable.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
    </div>
    <div class="col-sm-6 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/command_line.png" title="example image" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
    </div>
</div>

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
    </div>
    <div class="col-sm-6 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/wordle_structure.png" title="example image" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
    </div>
</div>

