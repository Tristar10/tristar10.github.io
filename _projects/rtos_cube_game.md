---
layout: page
title: Cube Game - a multithreaded RTOS game on the TM4C123G
description: A team-built real-time embedded game on an ARM Cortex-M4, with RTOS threads, semaphores, joystick input, LCD graphics and PWM sound.
img: assets/img/rtos_cube_game/gameplay.jpg
importance: 1
category: work
---

Cube Game was the final project for the Advanced Embedded Systems class at UVA (spring 2026), built by Team Beta: Haizhou Yu, Evan Sage, Nina Pournaras and Xinwei Li. It runs on a TI TM4C123G LaunchPad (ARM Cortex-M4) with a booster pack carrying a joystick, buttons, a buzzer and a 128×128 color LCD, running on an RTOS with threads, semaphores, sleep and kill.

The game itself is simple. Cubes spawn at random on a 6×6 grid and wander around on their own. You steer a crosshair with the joystick to catch them before their countdown runs out. A catch scores a point and a miss costs a life; reach 20 points to win, run out of lives and you lose. The point of the project was everything underneath: splitting the game into threads that run concurrently and share the grid, the screen and the score without corrupting them or deadlocking.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include video.liquid path="assets/img/rtos_cube_game/demo.mp4" class="img-fluid rounded z-depth-1" controls=true %}
    </div>
</div>
<div class="caption">
    Demo: start screen, a full round to the "You Win!" screen, a restart, and the graphics demo at the end.
</div>

## Who did what

| Area                                                         | Owner   |
| ------------------------------------------------------------ | ------- |
| Game state machine, UI screens, win and lose conditions      | Haizhou |
| Cube generation, cube threads, hit detection, random numbers | Nina    |
| Graphics, joystick                                           | Xinwei  |
| Sound thread                                                 | Evan    |

## System architecture

Each piece of the game is its own thread, and they only talk through shared state guarded by semaphores.

| Thread      | Type         | Priority | Role                                                                                 |
| ----------- | ------------ | -------- | ------------------------------------------------------------------------------------ |
| Producer    | Periodic ISR | 1        | Reads the joystick ADC and calls `CheckHit` to see if the crosshair landed on a cube |
| Consumer    | Foreground   | 2        | Draws the crosshair, manages the game state, starts `CubeSpawner`                    |
| CubeThread  | Foreground   | 2        | One per cube: that cube's motion, hit and expiry logic                               |
| CubeSpawner | Foreground   | 2        | Spawns a new batch of 1 to 5 cubes once every cube is gone                           |

The producer handles input and the consumer handles output. Hits are flagged in a shared `CubeArray[col][row].hit`, which the cube threads pick up to add score or take a life, and a PWM sound plays on every hit, lost life, win and loss.

## My part: the state machine and the screens

I owned the layer that turns a set of threads into a game you can play more than once: the game state machine, everything the LCD shows outside of gameplay, and the win and lose rules.

The whole game sits in one of four states. The consumer thread checks for state changes on every pass and draws the matching screen.

<div class="row">
    <div class="col-sm-5 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/rtos_cube_game/gamestate_enum.png" title="GameState enum" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/rtos_cube_game/draw_screens.png" title="Start and end screens" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    Left: the four game states. Right: the start screen with the rules, and the end screen for a win or a loss.
</div>

A few things made this more than a `switch` statement:

- **The LCD is a shared resource.** Every screen draw takes the `LCDFree` semaphore first and gives it back after, so a cube thread can't draw a cube halfway through the game-over screen.
- **Restart has to clean up live threads.** When a round ends, each cube thread sees that the state is no longer `STATE_PLAYING`, erases its cube, releases its grid cell and kills itself. `ResetGame()` then resets score, lives, the crosshair and the cube count, inside a critical section, then re-initializes every grid cell's semaphore and clears every cube's state, so the next round starts from a clean board.
- **One variable drives everything.** Reaching 20 points or losing the last life flips the state, and the spawner, the cube threads and the screens all react to that one value.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/rtos_cube_game/start_screen.jpg" title="Start screen" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/rtos_cube_game/gameplay.jpg" title="Playing" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/rtos_cube_game/win_screen.jpg" title="Win screen" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    The states on the board: start, playing (score and lives along the bottom), and win, with a button press to restart.
</div>

<div class="row">
    <div class="col-sm-7 mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/rtos_cube_game/reset_game.png" title="ResetGame" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    `ResetGame()`, run before every new round.
</div>

## Cubes, randomness and deadlock

Each cube is its own thread. It picks a random free cell, then loops: try to move one cell in a random direction, sleep 200 ms, check whether it has been hit or has run out of time. Every grid cell has a binary semaphore, `BlockFree`, so two cubes can never sit on the same cell.

The interesting bug to avoid was deadlock. If cube A waited on the cell cube B holds while cube B waited on cube A's cell, both would block forever. So cubes never call `OS_bWait` on a cell. They peek at the semaphore inside a critical section; if the cell is taken they pick a new direction and try again later, and they only release the old cell after the new one is secured. A cube never holds one cell while waiting for another, which removes the hold-and-wait condition entirely.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/rtos_cube_game/claim_cell.png" title="Non-blocking cell claim" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    Claiming the next cell without blocking: check under a critical section, take it if free, otherwise turn and retry.
</div>

Spawn positions, directions and batch sizes come from a pseudorandom generator built from two linear feedback shift registers, 31 and 32 bits long. Because the lengths are coprime, XORing their outputs gives a combined period of about 2⁶³.

## Graphics and sound

The first version of the face graphic was a hard-coded 16×16 bitmap, which scaled badly to the 128×128 screen and was painful to edit pixel by pixel. The second version draws it procedurally: filled circles from (x−cx)² + (y−cy)² ≤ r², drawn line by line, a smile from the curve y = 92 − i²/24, and small circles for the eyes and blush, in a style borrowed from Twemoji.

<div class="row">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/rtos_cube_game/face_bitmap.jpg" title="V1: bitmap" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid loading="eager" path="assets/img/rtos_cube_game/face_procedural.jpg" title="V2: procedural" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    Left: the 16×16 bitmap. Right: the procedurally drawn version.
</div>

Sound is a PWM output on PF2: a request sets the frequency and a duration in milliseconds, and a timer silences the output when it runs out. A hit plays a tone whose pitch depends on the cube's row.

## What we took away

- Keep ISRs and background threads light and do only what has to happen there.
- Never hold one resource while waiting for another; give it up first.
- An RTOS design needs a clean split of responsibilities between tasks. Lumping things together makes it hard to debug.
- Good version control matters, because without it bugs spread between people's work fast.
