// Car Duel — browser game engine.
//
// This is server.js ported to run inside the host player's browser so the game
// can be served as static files (GitHub Pages). The game logic and prompts are
// unchanged; what changed is the plumbing:
//   - Claude is called through a small proxy that holds the API key
//     (see worker/claude-proxy.js), so the key never reaches the browser.
//   - Socket.io is replaced by virtual sockets. transport.js feeds them events
//     from the local page and from the opponent's browser over WebRTC.
//   - The used-cars history lives in localStorage instead of a file.
(function () {
'use strict';

// Claude calls go through a small proxy (worker/claude-proxy.js, deployed on
// Cloudflare) that holds the Anthropic API key. Players never see or enter a key.
const PROXY_URL = (window.CAR_DUEL_CONFIG && window.CAR_DUEL_CONFIG.proxyUrl) || '';

async function callClaude(params) {
  if (!PROXY_URL) {
    const err = new Error('The game is not connected to its AI proxy yet.');
    err.noProxy = true;
    err.status = 503;
    throw err;
  }
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params)
  });
  if (!res.ok) {
    let message = res.status + ' ' + res.statusText;
    try {
      const data = await res.json();
      if (data && data.error && data.error.message) message = data.error.message;
    } catch (e) { /* keep status text */ }
    const err = new Error(message);
    err.status = res.status;
    const ra = res.headers.get('retry-after');
    if (ra) err.retryAfter = parseInt(ra, 10);
    throw err;
  }
  return res.json();
}

function keyErrorMessage(err) {
  if (err && err.noProxy) return 'The game is not connected to its AI service yet. Try again later.';
  if (err && err.status === 429) return 'Too many games right now. Wait a minute and try again.';
  return 'AI error: ' + (err && err.message ? err.message : 'unknown error');
}

function newRoomId() {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// Retry wrapper — handles 429 rate-limit responses with exponential backoff.
// Classifiers on haiku are cheap and fast; answer calls on opus get 3 retries.
async function withRetry(fn, maxAttempts = 3) {
  let delay = 1000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err?.status === 429;
      // Parse the reset time from the header if available for a smarter wait
      const retryAfterMs = err?.retryAfter
        ? err.retryAfter * 1000
        : delay;
      if (is429 && attempt < maxAttempts) {
        console.warn(`Rate limited — retry ${attempt}/${maxAttempts - 1} in ${retryAfterMs}ms`);
        await new Promise(r => setTimeout(r, retryAfterMs));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
}

// ── Persistent used-cars queue ─────────────────────────────────────────────
// Kept in localStorage so Claude doesn't repeat recent cars for this host's browser.
const USED_CARS_KEY = 'cdUsedCars';
const MAX_USED_CARS = 150; // keep last N cars

function loadUsedCars() {
  try {
    const data = JSON.parse(localStorage.getItem(USED_CARS_KEY) || '[]');
    if (Array.isArray(data)) return data.slice(-MAX_USED_CARS);
  } catch (err) { /* start fresh */ }
  return [];
}

function saveUsedCars(queue) {
  try { localStorage.setItem(USED_CARS_KEY, JSON.stringify(queue)); } catch (err) { /* ignore */ }
}

let usedCarsQueue = loadUsedCars();

function recordCar(car) {
  usedCarsQueue.push(car);
  if (usedCarsQueue.length > MAX_USED_CARS) {
    usedCarsQueue = usedCarsQueue.slice(usedCarsQueue.length - MAX_USED_CARS);
  }
  saveUsedCars(usedCarsQueue);
}

// ── Virtual sockets (stand-ins for Socket.io) ────────────────────────────
const sockets = new Map(); // id -> virtual socket

const io = {
  sockets: { sockets },
  to(roomId) {
    return {
      emit(event, data) {
        const room = rooms.get(roomId);
        if (!room) return;
        for (const [sid] of room.players) {
          const s = sockets.get(sid);
          if (s) s.emit(event, data);
        }
      }
    };
  }
};

function connect(id, send) {
  const handlers = new Map();
  const socket = {
    id,
    emit: (event, data) => send(event, data),
    on: (event, fn) => handlers.set(event, fn),
    join: () => {}
  };
  sockets.set(id, socket);
  onConnection(socket);
  return {
    handle(event, data) {
      const fn = handlers.get(event);
      if (fn) return fn(data || {});
    },
    disconnect(reason) {
      if (!sockets.has(id)) return;
      sockets.delete(id);
      const fn = handlers.get('disconnect');
      if (fn) fn(reason || 'transport close');
    }
  };
}

// ── Room state ─────────────────────────────────────────────────────────────
const rooms = new Map();

const DIFFICULTY_PROMPTS = {
  easy: 'Pick a very well-known, popular everyday car that most people would recognise, such as a mainstream sedan, SUV, or iconic muscle car from any major brand.',
  medium: 'Pick a niche car from a major, well-known manufacturer. It might be niche because it was only sold in certain markets, or because it only had a limited production run. Examples: Toyota Sera, Volkswagen Gol.',
  hard: 'Pick a rare, obscure, exotic, or niche car that only dedicated car enthusiasts or collectors would know. Avoid the most famous supercars. It can be a sports car, but something like Toyota Windom is also a good example.'
};

// Extra constraints injected randomly to push Claude away from its defaults.
// Each entry is [value, weight]. Higher weight = more likely to be picked.
// 'any X' entries are weighted ~3x a specific option so Claude stays unconstrained
// most of the time but still gets nudged toward a specific dimension occasionally.
const RANDOM_DECADES = [
  ['1960s', 1], ['1970s', 1], ['1980s', 1], ['1990s', 1],
  ['2000s', 1], ['2010s', 1],
  ['any era', 6]   // ~50 % chance
];
const RANDOM_REGIONS = [
  ['Japanese', 1], ['European', 1], ['American', 1], ['Korean', 1],
  ['British', 1], ['German', 1], ['Italian', 1], ['French', 1],
  ['any origin', 8]  // ~50 % chance
];
const RANDOM_BODY_STYLES = [
  ['sedan', 1], ['coupe', 1], ['hatchback', 1], ['SUV', 1],
  ['pickup truck', 1], ['wagon', 1], ['convertible', 1], ['van', 1],
  ['any body style', 8]  // ~50 % chance
];

function randomPick(weightedArr) {
  const totalWeight = weightedArr.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * totalWeight;
  for (const [value, weight] of weightedArr) {
    r -= weight;
    if (r <= 0) return value;
  }
  return weightedArr[weightedArr.length - 1][0];
}

function randomSeed() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

// ── Car picker ─────────────────────────────────────────────────────────────
async function pickCar(difficulty) {
  const hint = DIFFICULTY_PROMPTS[difficulty] || DIFFICULTY_PROMPTS.medium;
  const seed = randomSeed();

  // Random constraints force variety — Claude can't fall back to its "default" answer
  const decade = randomPick(RANDOM_DECADES);
  const region = randomPick(RANDOM_REGIONS);
  const bodyStyle = randomPick(RANDOM_BODY_STYLES);

  const historyBlock = usedCarsQueue.length > 0
    ? `DO NOT pick any of these previously used cars:\n${usedCarsQueue.join('\n')}`
    : 'No cars have been used yet.';

  try {
    const response = await callClaude({
      model: 'claude-haiku-4-5',
      max_tokens: 20,
      temperature: 1.0,
      messages: [
        {
          role: 'user',
          content: `You are picking a secret car for a guessing game. Be creative and unpredictable.

Difficulty instruction:
${hint}

Random constraints to guide your pick (use these as inspiration, not hard rules — override them if needed to find a car that matches the difficulty):
- Preferred era: ${decade}
- Preferred origin: ${region}
- Preferred body style: ${bodyStyle}

Random seed (use this to vary your answer): ${seed}

${historyBlock}

Reply with ONLY the car's make and model.
Do not include year, trim, explanation, punctuation, or quotation marks.

Example:
Ford Mustang`
        }
      ]
    });

    const car =
      response.content[0]?.text
        ?.trim()
        .replace(/^["'.]+|["'.]+$/g, '') || 'Toyota Camry';

    recordCar(car);
    return car;
  } catch (err) {
    console.error('pickCar error:', err.message);
    // If the AI service itself is unavailable, say so instead of silently
    // starting every game with the same fallback car.
    if (err.noProxy || err.status === 401 || err.status === 403 || err.status === 429 || err.status >= 500) throw err;
    return 'Ford Mustang';
  }
}

// ── Public state helper ────────────────────────────────────────────────────
function getRoomPublicState(room, socketId) {
  const limits = getRoomLimits(room);

  const players = [...room.players.entries()].map(([sid, p]) => ({
    name: p.name,
    qCount: p.qCount,
    geoGuesses: p.geoGuesses,
    geoLimit: limits.geoLimit,
    makerGuesses: p.makerGuesses,
    makerLimit: limits.makerLimit,
    won: p.won,
    surrendered: p.surrendered || false,
    isYou: sid === socketId
  }));

  return {
    roomId: room.id,
    status: room.status,
    mode: room.mode,
    players,
    difficulty: room.difficulty,
    restrictionMode: room.restrictionMode || 'normal',
    geoLimit: limits.geoLimit,
    makerLimit: limits.makerLimit,
  };
}

// ── Broadcast room state ───────────────────────────────────────────────────
function broadcastGameState(room) {
  for (const [sid] of room.players) {
    const s = io.sockets.sockets.get(sid);
    if (s) {
      s.emit('game_state', getRoomPublicState(room, sid));
    }
  }
}

// ── Question classifiers ───────────────────────────────────────────────────

// ── Inferno mode: classify body-style and era questions too ───────────────
// Returns { isGeo, isMaker, isBodyStyle, isEra }
// IMPORTANT: maker is checked first and is authoritative.
// If a question names a specific brand, isGeo is forced false even if the
// brand has a clear country association (e.g. "Is it a Mazda?" → isMaker
// only, not geo). This prevents double-counting and mis-labelling.
async function classifyQuestion(question, infernoMode = false) {
  const q = question.trim();

  const classifyPromises = [
    // ── Maker classifier (runs first; result gates geo) ───────────────────
    withRetry(() => callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: `You are a classifier for a car guessing game.

A player asked: "${q}"

Does this question name or strongly imply a SPECIFIC car manufacturer, brand, or corporate group?
Flag it only when a particular company is named or unmistakably implied.
Vague / categorical language is always NO.

YES examples:
- "Is it a Mazda?" → YES
- "Is it made by GM?" → YES
- "Is it a Ford product?" → YES
- "Did Toyota make it?" → YES
- "Is it from the Volkswagen Group?" → YES
- "Does it use a BMW engine?" → YES
- "Is it the same brand as the Civic?" → YES (unmistakably Honda)

NO examples:
- "Is it a luxury brand?" → NO
- "Is it from a large conglomerate?" → NO
- "Is it from a brand known for sports cars?" → NO
- "Is it a budget car?" → NO
- "Does it have a turbo?" → NO
- "Is it rear-wheel drive?" → NO

Reply ONLY with YES or NO.`
      }]
    })),

    // ── Geo classifier — only fires on country/region language ────────────
    // Explicitly told: brand names alone are NOT geo, even if the brand
    // is strongly associated with a country.
    withRetry(() => callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: `You are a classifier for a car guessing game.

A player asked: "${q}"

Does this question ask about a COUNTRY, REGION, or GEOGRAPHIC ORIGIN using geographic language?

CRITICAL RULE: If the question names a specific car brand (Toyota, Ford, BMW, Mazda, etc.),
answer NO — brand names belong to a different category, not geo, even if the brand
is strongly associated with a country.

YES examples (geographic language, no brand named):
- "Is it an American car?" → YES
- "Is it from Europe?" → YES
- "Was it made in Japan?" → YES
- "Is it a German-engineered car?" → YES
- "Is it produced in Italy?" → YES

NO examples:
- "Is it a Mazda?" → NO (brand name, not geo)
- "Is it a Toyota?" → NO (brand name, not geo)
- "Is it a Japanese brand?" → NO (asks about brand identity, not pure geography)
- "Is it sold in the Chinese market?" → NO (market/sales, allowed)
- "Is it available in Europe?" → NO (market question, allowed)
- "Does it have a V8?" → NO
- "Is it a sedan?" → NO
- "Was it made before 2000?" → NO

Reply ONLY with YES or NO.`
      }]
    }))
  ];

  if (infernoMode) {
    // ── Body style classifier (inferno only) ─────────────────────────────
    classifyPromises.push(withRetry(() => callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: `You are a classifier for a car guessing game.

A player asked: "${q}"

Does this question ask about the BODY STYLE or BODY TYPE of the car?
(sedan, coupe, hatchback, SUV, truck, van, convertible, wagon, crossover, etc.)

YES examples:
- "Is it a sedan?" → YES
- "Is it an SUV?" → YES
- "Does it have 4 doors?" → YES
- "Is it a hatchback?" → YES
- "Is it a convertible?" → YES
- "Is it a pickup truck?" → YES

NO examples:
- "Does it have a turbo?" → NO
- "Is it rear-wheel drive?" → NO
- "Was it made in the 1990s?" → NO
- "Is it a luxury car?" → NO

Reply ONLY with YES or NO.`
      }]
    })));

    // ── Era/year classifier (inferno only) ───────────────────────────────
    classifyPromises.push(withRetry(() => callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: `You are a classifier for a car guessing game.

A player asked: "${q}"

Does this question ask about the ERA, DECADE, YEAR, or TIME PERIOD the car is from?

YES examples:
- "Was it made in the 1990s?" → YES
- "Is it from the 80s?" → YES
- "Is it a modern car?" → YES
- "Was it produced before 2000?" → YES
- "Is it from this decade?" → YES

NO examples:
- "Does it have a turbo?" → NO
- "Is it a sedan?" → NO
- "Is it a luxury car?" → NO
- "Was it sold in Japan?" → NO

Reply ONLY with YES or NO.`
      }]
    })));
  }

  const results = await Promise.allSettled(classifyPromises);

  const isMaker = results[0].status === 'fulfilled'
    ? results[0].value.content[0]?.text?.trim().toUpperCase().startsWith('YES')
    : false;

  // Geo is only true if geographic language was used AND no specific brand named
  const isGeoRaw = results[1].status === 'fulfilled'
    ? results[1].value.content[0]?.text?.trim().toUpperCase().startsWith('YES')
    : false;
  const isGeo = isGeoRaw && !isMaker;

  const isBodyStyle = infernoMode && results[2]?.status === 'fulfilled'
    ? results[2].value.content[0]?.text?.trim().toUpperCase().startsWith('YES')
    : false;

  const isEra = infernoMode && results[3]?.status === 'fulfilled'
    ? results[3].value.content[0]?.text?.trim().toUpperCase().startsWith('YES')
    : false;

  return { isGeo, isMaker, isBodyStyle, isEra };
}

// ── Get effective limits for a room based on its restriction mode ──────────
function getRoomLimits(room) {
  switch (room.restrictionMode) {
    case 'nogeo':
      return { geoLimit: 1, makerLimit: 1, bodyStyleLimit: Infinity, eraLimit: Infinity };
    case 'inferno':
      return { geoLimit: 0, makerLimit: 0, bodyStyleLimit: 0, eraLimit: 0 };
    default:
      return { geoLimit: 5, makerLimit: 5, bodyStyleLimit: Infinity, eraLimit: Infinity };
  }
}


function onConnection(socket) {

  // ── Create multiplayer duel room ─────────────────────────────────────────
  socket.on('create_room', async ({ name, difficulty, restrictionMode }) => {
    socket.emit('picking_car', {});

    // Pick the car before the room exists, so an AI failure sends the host
    // straight back to the lobby instead of stranding them on the waiting screen.
    let car;
    try {
      car = await pickCar(difficulty || 'medium');
    } catch (err) {
      socket.emit('error', keyErrorMessage(err));
      return;
    }

    const roomId = newRoomId();
    const room = {
      id: roomId,
      car,
      difficulty: difficulty || 'medium',
      restrictionMode: restrictionMode || 'normal',
      mode: 'duel',
      status: 'waiting',
      players: new Map(),
      createdAt: Date.now()
    };

    room.players.set(socket.id, {
      name: name || 'Player 1',
      history: [],
      qCount: 0,
      geoGuesses: 0,
      makerGuesses: 0,
      bodyStyleGuesses: 0,
      eraGuesses: 0,
      won: false,
      surrendered: false
    });

    rooms.set(roomId, room);
    socket.join(roomId);

    socket.emit('room_created', { roomId });
    socket.emit('game_state', getRoomPublicState(room, socket.id));
  });

  // ── Create single-player room ────────────────────────────────────────────
  socket.on('create_solo_game', async ({ name, difficulty, restrictionMode }) => {
    const roomId = newRoomId();

    socket.emit('picking_car', {});

    let car;
    try {
      car = await pickCar(difficulty || 'medium');
    } catch (err) {
      socket.emit('error', keyErrorMessage(err));
      return;
    }

    const room = {
      id: roomId,
      car,
      difficulty: difficulty || 'medium',
      restrictionMode: restrictionMode || 'normal',
      mode: 'solo',
      status: 'playing',
      players: new Map(),
      createdAt: Date.now()
    };

    room.players.set(socket.id, {
      name: name || 'Solo Player',
      history: [],
      qCount: 0,
      geoGuesses: 0,
      makerGuesses: 0,
      bodyStyleGuesses: 0,
      eraGuesses: 0,
      won: false,
      surrendered: false
    });

    rooms.set(roomId, room);
    socket.join(roomId);

    socket.emit('solo_game_created', { roomId });
    socket.emit('game_started', {
      message: 'Single-player game started! Guess the secret car.'
    });
    socket.emit('game_state', getRoomPublicState(room, socket.id));
  });

  // ── Join multiplayer room ────────────────────────────────────────────────
  socket.on('join_room', async ({ roomId, name }) => {
    const rid = (roomId || '').toUpperCase().trim();
    const room = rooms.get(rid);

    if (!room) {
      socket.emit('error', 'Room not found. Check the code and try again.');
      return;
    }

    if (room.mode === 'solo') {
      socket.emit('error', 'This is a single-player game and cannot be joined.');
      return;
    }

    if (room.status !== 'waiting') {
      socket.emit('error', 'Game already in progress.');
      return;
    }

    if (room.players.size >= 2) {
      socket.emit('error', 'Room is full.');
      return;
    }

    // If the host joined while pickCar was still running, car may still be null.
    // Poll briefly until it resolves (max 15s) rather than erroring out.
    if (room.car === null) {
      socket.emit('picking_car', {});
      const waited = await new Promise((resolve) => {
        const start = Date.now();
        const check = setInterval(() => {
          if (room.car !== null) { clearInterval(check); resolve(true); }
          if (Date.now() - start > 15_000) { clearInterval(check); resolve(false); }
        }, 200);
      });
      if (!waited) {
        socket.emit('error', 'Car selection timed out. Please try again.');
        return;
      }
    }

    room.players.set(socket.id, {
      name: name || 'Player 2',
      history: [],
      qCount: 0,
      geoGuesses: 0,
      makerGuesses: 0,
      bodyStyleGuesses: 0,
      eraGuesses: 0,
      won: false,
      surrendered: false
    });

    room.status = 'playing';
    socket.join(rid);

    broadcastGameState(room);

    io.to(rid).emit('game_started', {
      message: 'Both players connected! The duel begins.'
    });
  });

  // ── Ask yes/no question ──────────────────────────────────────────────────
  socket.on('ask_question', async ({ roomId, question }) => {
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit('error', 'Room not found.');
      return;
    }

    if (room.status !== 'playing') {
      socket.emit('error', 'Game is not in progress.');
      return;
    }

    const player = room.players.get(socket.id);

    if (!player) {
      socket.emit('error', 'You are not registered in this room. Try rejoining.');
      return;
    }

    if (player.won || player.surrendered) return;

    if (!question || !question.trim()) {
      socket.emit('error', 'Question cannot be empty.');
      return;
    }

    player.qCount++;

    broadcastGameState(room);

    // Declared outside try so the catch block can reference them for rollback
    let isGeo = false;
    let isMaker = false;
    let isBodyStyle = false;
    let isEra = false;

    const limits = getRoomLimits(room);
    const infernoMode = room.restrictionMode === 'inferno';

    try {
      // ── Classify question against restricted categories ─────────────────
      ({ isGeo, isMaker, isBodyStyle, isEra } = await classifyQuestion(question.trim(), infernoMode));

      if (isGeo && player.geoGuesses >= limits.geoLimit) {
        player.qCount--;
        broadcastGameState(room);
        const msg = limits.geoLimit === 0
          ? `Country/origin questions are banned in this mode!`
          : `You've used all ${limits.geoLimit} country/origin question${limits.geoLimit !== 1 ? 's' : ''}. Ask about specs or features instead!`;
        socket.emit('geo_limit_reached', { message: msg });
        return;
      }

      if (isMaker && player.makerGuesses >= limits.makerLimit) {
        player.qCount--;
        broadcastGameState(room);
        const msg = limits.makerLimit === 0
          ? `Manufacturer questions are banned in this mode!`
          : `You've used all ${limits.makerLimit} manufacturer question${limits.makerLimit !== 1 ? 's' : ''}. Ask about features or platform instead!`;
        socket.emit('maker_limit_reached', { message: msg });
        return;
      }

      if (infernoMode && isBodyStyle && player.bodyStyleGuesses >= limits.bodyStyleLimit) {
        player.qCount--;
        broadcastGameState(room);
        socket.emit('body_style_limit_reached', { message: `Body style questions are banned in Inferno mode!` });
        return;
      }

      if (infernoMode && isEra && player.eraGuesses >= limits.eraLimit) {
        player.qCount--;
        broadcastGameState(room);
        socket.emit('era_limit_reached', { message: `Era/year questions are banned in Inferno mode!` });
        return;
      }

      if (isGeo) player.geoGuesses++;
      if (isMaker) player.makerGuesses++;
      if (infernoMode && isBodyStyle) player.bodyStyleGuesses = (player.bodyStyleGuesses || 0) + 1;
      if (infernoMode && isEra) player.eraGuesses = (player.eraGuesses || 0) + 1;

      broadcastGameState(room);

      // ── Answer the question ──────────────────────────────────────────────
      const systemPrompt = `You are the judge in a car guessing game.

The secret car is: "${room.car}".

Players ask yes/no questions.

Rules:
- Answer factually and accurately based on real-world knowledge about this specific car.
- Respond with a simple answer.
- Prefer "Yes." or "No."
- If the trait being asked about is NOT consistent across all generations, trims, or model years of this car (e.g. body style, engine, or drivetrain changed between generations, so neither Yes nor No is accurate for the nameplate as a whole), respond with "It could be." instead of forcing a Yes or No.
- If the question cannot be answered at all (unrelated to cars, or genuinely unknowable), respond with "Unknown."
- Do not reveal the secret car.
- Do not give extra hints.`;

      const messages = player.history.flatMap((h) => [
        { role: 'user', content: h.q },
        { role: 'assistant', content: h.a }
      ]);

      messages.push({
        role: 'user',
        content: question.trim()
      });

      const response = await withRetry(() => callClaude({
        model: 'claude-opus-4-5',
        max_tokens: 20,
        system: systemPrompt,
        messages
      }));

      const raw = response.content[0]?.text?.trim() ?? '';
      const lower = raw.toLowerCase();

      let answer;

      if (lower.startsWith('it could be') || lower.startsWith('could be')) {
        answer = 'It could be.';
      } else if (lower.startsWith('yes')) {
        answer = 'Yes.';
      } else if (lower.startsWith('no')) {
        answer = 'No.';
      } else if (lower.startsWith('unknown') || lower.startsWith('unclear')) {
        answer = 'Unknown.';
      } else {
        answer = raw || 'Unknown.';
      }

      player.history.push({
        q: question.trim(),
        a: answer
      });

      socket.emit('question_answered', {
        question: question.trim(),
        answer,
        qCount: player.qCount,
        geoGuesses: player.geoGuesses,
        geoLimit: limits.geoLimit,
        makerGuesses: player.makerGuesses,
        makerLimit: limits.makerLimit,
        restrictionMode: room.restrictionMode
      });

      broadcastGameState(room);
    } catch (err) {
      console.error('Question AI error:', err);

      player.qCount = Math.max(0, player.qCount - 1);
      // Roll back category guesses if the answer call itself failed
      if (isGeo && player.geoGuesses > 0) player.geoGuesses--;
      if (isMaker && player.makerGuesses > 0) player.makerGuesses--;

      socket.emit('error', 'AI error: ' + err.message);
      broadcastGameState(room);
    }
  });

  // ── Submit final guess ───────────────────────────────────────────────────
  socket.on('submit_guess', async ({ roomId, guess }) => {
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit('error', 'Room not found.');
      return;
    }

    if (room.status !== 'playing') {
      socket.emit('error', 'Game is not in progress.');
      return;
    }

    const player = room.players.get(socket.id);

    if (!player) {
      socket.emit('error', 'You are not registered in this room. Try rejoining.');
      return;
    }

    if (player.won || player.surrendered) return;

    if (!guess || !guess.trim()) {
      socket.emit('error', 'Guess cannot be empty.');
      return;
    }

    player.qCount++;

    try {
      const response = await withRetry(() => callClaude({
        model: 'claude-opus-4-5',
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: `Secret car: "${room.car}".
Player guessed: "${guess.trim()}".

Is this correct?

Rules:
- Reply ONLY "correct" or "wrong".
- Make and model match is enough.
- Ignore year, trim, generation, and minor variant differences.
- Do not mark it correct if the guessed model is a different vehicle.`
          }
        ]
      }));

      const verdict = response.content[0]?.text?.trim().toLowerCase() ?? '';
      const isCorrect = verdict.startsWith('correct');

      if (isCorrect) {
        player.won = true;
        room.status = 'finished';

        socket.emit('you_won', {
          car: room.car,
          qCount: player.qCount,
          guess: guess.trim()
        });

        if (room.mode === 'duel') {
          for (const [sid, p] of room.players) {
            if (sid !== socket.id) {
              const s = io.sockets.sockets.get(sid);
              if (s) {
                s.emit('opponent_won', {
                  winnerName: player.name,
                  car: room.car,
                  loserQCount: p.qCount
                });
              }
            }
          }
        }

        broadcastGameState(room);
      } else {
        socket.emit('wrong_guess', {
          guess: guess.trim(),
          qCount: player.qCount
        });

        broadcastGameState(room);
      }
    } catch (err) {
      console.error('Guess AI error:', err);

      player.qCount = Math.max(0, player.qCount - 1);

      socket.emit('error', 'AI error: ' + err.message);
      broadcastGameState(room);
    }
  });

  // ── Surrender ────────────────────────────────────────────────────────────
  socket.on('surrender', ({ roomId }) => {
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit('error', 'Room not found.');
      return;
    }

    const player = room.players.get(socket.id);

    if (!player || player.won || player.surrendered) return;

    player.surrendered = true;

    socket.emit('surrendered', {
      car: room.car,
      qCount: player.qCount
    });

    if (room.mode === 'solo') {
      room.status = 'finished';
    }

    if (room.mode === 'duel') {
      for (const [sid] of room.players) {
        if (sid !== socket.id) {
          const s = io.sockets.sockets.get(sid);
          if (s) {
            s.emit('opponent_surrendered', {
              name: player.name
            });
          }
        }
      }

      const allDone = [...room.players.values()].every(
        (p) => p.won || p.surrendered
      );

      if (allDone) {
        room.status = 'finished';
      }
    }

    broadcastGameState(room);
  });

  // ── Request rematch ──────────────────────────────────────────────────────
  socket.on('request_rematch', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.mode === 'solo') {
      socket.emit('rematch_requested', {});
    } else {
      io.to(roomId).emit('rematch_requested', {});
    }
  });

  // ── Accept rematch ───────────────────────────────────────────────────────
  socket.on('accept_rematch', async ({ roomId, difficulty }) => {
    const room = rooms.get(roomId);

    if (!room) return;

    const diff = difficulty || room.difficulty;

    if (room.mode === 'solo') {
      socket.emit('picking_car', {});
    } else {
      io.to(roomId).emit('picking_car', {});
    }

    try {
      room.car = await pickCar(diff);
    } catch (err) {
      io.to(roomId).emit('error', keyErrorMessage(err));
      return;
    }
    room.difficulty = diff;
    room.status = 'playing';

    for (const [, p] of room.players) {
      p.history = [];
      p.qCount = 0;
      p.geoGuesses = 0;
      p.makerGuesses = 0;
      p.bodyStyleGuesses = 0;
      p.eraGuesses = 0;
      p.won = false;
      p.surrendered = false;
    }

    if (room.mode === 'solo') {
      socket.emit('game_started', {
        message: 'New solo game started! A new car has been chosen.'
      });
    } else {
      io.to(roomId).emit('game_started', {
        message: 'Rematch! A new car has been chosen.'
      });
    }

    broadcastGameState(room);
  });

  // ── Rejoin after reconnect ──────────────────────────────────────────────
  // If a player reconnects with the same name+roomId before the grace period
  // expires, swap their socket ID back in and resume the game.
  socket.on('rejoin_room', ({ roomId, name }) => {
    const rid = (roomId || '').toUpperCase().trim();
    const room = rooms.get(rid);
    if (!room) { socket.emit('error', 'Room no longer exists.'); return; }

    // Find a ghost slot (disconnected) matching this player's name
    let rejoined = false;
    for (const [oldSid, player] of room.players) {
      if (player.name === name && player.disconnected) {
        room.players.delete(oldSid);
        player.disconnected = false;
        if (player.disconnectTimer) {
          clearTimeout(player.disconnectTimer);
          player.disconnectTimer = null;
        }
        room.players.set(socket.id, player);
        socket.join(rid);
        socket.emit('rejoined', { roomId: rid });
        socket.emit('game_state', getRoomPublicState(room, socket.id));
        if (room.status === 'playing') {
          socket.emit('game_started', { message: 'Reconnected! Game is still in progress.' });
          // Re-send their full question history so the chat log rebuilds
          socket.emit('restore_history', { history: player.history });
        }
        if (room.mode === 'duel') {
          io.to(rid).emit('opponent_reconnected', { name });
        }
        broadcastGameState(room);
        rejoined = true;
        console.log(`Player "${name}" rejoined room ${rid}`);
        break;
      }
    }
    if (!rejoined) {
      socket.emit('error', 'Could not rejoin — name not found or grace period expired.');
    }
  });

  // ── Disconnect ───────────────────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    console.log('disconnect', socket.id, reason);

    for (const [roomId, room] of rooms) {
      if (room.players.has(socket.id)) {
        const player = room.players.get(socket.id);

        // Don't immediately evict — give the player 15s to reconnect.
        // This covers Railway restarts, mobile backgrounding, brief network blips.
        player.disconnected = true;
        player.disconnectTimer = setTimeout(() => {
          // Grace period expired — now truly remove them
          if (!room.players.has(socket.id)) return; // already rejoined under new sid
          room.players.delete(socket.id);

          if (room.players.size === 0) {
            rooms.delete(roomId);
            console.log(`Room ${roomId} deleted (empty after grace period)`);
          } else {
            if (room.mode === 'duel') {
              io.to(roomId).emit('opponent_disconnected');
              room.status = 'waiting';
              broadcastGameState(room);
            }
          }
        }, 15_000); // 15-second grace period

        // Notify opponent immediately but softly — they'll get the hard
        // notification only if the grace period expires
        if (room.mode === 'duel' && room.players.size > 1) {
          io.to(roomId).emit('opponent_temporarily_disconnected', { name: player.name });
        }

        break;
      }
    }
  });
}
// ── Clean up stale rooms every 10 minutes ──────────────────────────────────
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;

  for (const [id, room] of rooms) {
    if (room.createdAt < cutoff) {
      rooms.delete(id);
    }
  }
}, 10 * 60 * 1000);


window.CarDuelEngine = { connect };
})();
