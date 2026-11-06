(() => {
  "use strict";

  const COLORS = ["#ef5b2a", "#2878b5", "#37a169", "#a855b5", "#d59c17", "#2f9da0", "#d24a68", "#6d72d8"];
  const GRID_POINTS = 800;
  const MODE_NAMES = ["Stock", "FWD", "50:50", "60:40", "70:30", "80:20", "90:10", "Speed", "Throttle", "Map", "RPM"];
  const GAIN_COLORS = {
    strongGain: "#1a9850",
    gain: "#8cc665",
    neutral: "#a3a3a3",
    loss: "#f59053",
    strongLoss: "#d73027",
  };

  // Extra channels. G-forces come from RaceChrono's own calculated columns. The
  // rest follow the OpenHaldex-S3 $RC3 Wi-Fi mapping (docs/RACECHRONO_WIFI.md):
  // `oh` is the RC3 slot as RaceChrono names it in exports (e.g. analog4-data).
  const CHANNELS = [
    { key: "latG", label: "Lateral G", unit: "G", names: ["lateral acc", "latacc"], digits: 2 },
    { key: "longG", label: "Longitudinal G", unit: "G", names: ["longitudinal acc", "longacc"], digits: 2 },
    { key: "throttle", label: "Accelerator", unit: "%", oh: "analog2", digits: 0 },
    { key: "brake", label: "Brake pressure", unit: "bar", oh: "analog12", digits: 1 },
    { key: "steering", label: "Steering angle", unit: "°", oh: "analog11", digits: 1 },
    { key: "rpm", label: "Engine RPM", unit: "rpm", oh: "digital1", digits: 0 },
    { key: "gear", label: "Gear", unit: "", oh: "x rate of rotation", digits: 0, step: true },
    { key: "lock", label: "Haldex lock", unit: "%", oh: "analog4", digits: 0 },
    { key: "mode", label: "OpenHaldex mode", unit: "", oh: "analog5", digits: 0, step: true, mode: true },
    { key: "torque", label: "Engine torque", unit: "Nm", oh: "analog3", digits: 0 },
    { key: "boost", label: "Boost", unit: "mbar", oh: "digital2", digits: 0 },
    { key: "canSpeed", label: "Vehicle speed (CAN)", unit: "km/h", oh: "analog1", digits: 0 },
    { key: "abs", label: "ABS active", unit: "", oh: "x acc", digits: 0, step: true, flag: true },
    { key: "esp", label: "ESP active", unit: "", oh: "y acc", digits: 0, step: true, flag: true },
    { key: "eds", label: "EDS/XDS active", unit: "", oh: "z acc", digits: 0, step: true, flag: true },
    { key: "oilPressure", label: "Oil pressure", unit: "bar", oh: "y rate of rotation", digits: 1 },
    { key: "iat", label: "Intake air temp", unit: "°C", oh: "z rate of rotation", digits: 0 },
    { key: "clutchTemp", label: "Haldex clutch temp", unit: "°C", oh: "analog10", digits: 0 },
    { key: "oilTemp", label: "Oil temp", unit: "°C", oh: "analog13", digits: 0 },
    { key: "coolantTemp", label: "Coolant temp", unit: "°C", oh: "analog14", digits: 0 },
    { key: "transTemp", label: "Transmission temp", unit: "°C", oh: "analog15", digits: 0 },
  ];
  const CHANNEL_BY_KEY = Object.fromEntries(CHANNELS.map((channel) => [channel.key, channel]));
  const OH_REQUIRES_DEVICE_SOURCE = new Set(["x acc", "y acc", "z acc", "x rate of rotation", "y rate of rotation", "z rate of rotation"]);

  const state = {
    groups: [],
    groupIndex: 0,
    referenceId: null,
    compareId: null,
    channelKey: null,
    mapMode: "laps",
    baseName: "muted",
    baseLayer: null,
    hiddenLaps: new Set(),
    coachChat: [],
    coachBusy: false,
    lapLayers: {},
    zoomRange: null,
    highlightLayer: null,
    drag: null,
    suppressClickUntil: 0,
    replay: { playing: false, active: false, time: 0, last: null, speed: 1, frame: null },
    overlayDelta: false,
    charts: {},
    map: null,
    mapBounds: [],
    mapLayers: [],
    cursorMarkers: [],
    cursorIndex: null,
    current: null,
    expandedPanel: null,
  };

  const byId = (id) => document.getElementById(id);
  const els = {};

  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        })[character]
    );
  }

  function normalize(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\s+/g, " ");
  }

  const compact = (value) => normalize(value).replace(/[^a-z0-9]/g, "");

  function parseCsvLine(line) {
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = !quoted;
      } else if (char === "," && !quoted) {
        cells.push(cell);
        cell = "";
      } else cell += char;
    }
    cells.push(cell);
    return cells;
  }

  function findHeader(lines) {
    for (let i = 0; i < lines.length; i += 1) {
      const values = parseCsvLine(lines[i]).map(normalize);
      if (values.some((v) => v.includes("time")) && values.some((v) => v.includes("speed"))) return i;
    }
    return -1;
  }

  function findColumn(headers, candidates, preferLast = false) {
    const matches = [];
    headers.forEach((header, index) => {
      const name = normalize(header);
      if (candidates.some((candidate) => name === candidate || name.includes(candidate))) matches.push(index);
    });
    if (!matches.length) return -1;
    return preferLast ? matches[matches.length - 1] : matches[0];
  }

  function numeric(value) {
    const result = Number.parseFloat(value);
    return Number.isFinite(result) ? result : null;
  }

  // columns: [{ name, source }]. Returns { key: columnIndex } for every extra
  // channel found. OpenHaldex slots must come from the same source as the
  // analog channels, so the phone's own accelerometer/gyro are never mistaken
  // for ABS/ESP/EDS flags or gear/oil pressure/IAT.
  function resolveChannels(columns) {
    const mapping = {};
    const analog = columns.find((column) => /^analog\d+$/.test(compact(column.name)));
    const deviceSource = analog ? normalize(analog.source) : null;
    CHANNELS.forEach((channel) => {
      let matches;
      if (channel.oh) {
        if (deviceSource === null) return;
        const wanted = compact(channel.oh);
        matches = columns.map((column, index) => ({ column, index })).filter(({ column }) => compact(column.name) === wanted);
        const fromDevice = matches.filter(({ column }) => normalize(column.source) === deviceSource);
        if (fromDevice.length || OH_REQUIRES_DEVICE_SOURCE.has(channel.oh)) matches = fromDevice;
      } else {
        const wanted = channel.names.map(compact);
        matches = columns.map((column, index) => ({ column, index })).filter(({ column }) => wanted.includes(compact(column.name)));
        const calculated = matches.filter(({ column }) => normalize(column.source).includes("calc"));
        if (calculated.length) matches = calculated;
      }
      if (matches.length) mapping[channel.key] = matches[0].index;
    });
    return mapping;
  }

  function readChannels(cells, mapping) {
    const values = {};
    Object.entries(mapping).forEach(([key, index]) => {
      values[key] = numeric(cells[index]);
    });
    return values;
  }

  function parseRaceChrono(text, filename) {
    const lines = text.replace(/^﻿/, "").split(/\r?\n/);
    const headerIndex = findHeader(lines);
    if (headerIndex < 0) throw new Error(`${filename}: no RaceChrono telemetry header found.`);

    const headers = parseCsvLine(lines[headerIndex]);
    const timeIndex = findColumn(headers, ["elapsed time", "session time", "timestamp", "time"]);
    const lapIndex = findColumn(headers, ["lap number", "lap"]);
    const distanceIndex = findColumn(headers, ["distance traveled", "distance"]);
    const latIndex = findColumn(headers, ["latitude", "lat"]);
    const lonIndex = findColumn(headers, ["longitude", "lon", "lng"]);

    const units = parseCsvLine(lines[headerIndex + 1] || "");
    const sources = parseCsvLine(lines[headerIndex + 2] || "");
    // RaceChrono can export several speed columns (GPS, calculated, OBD). OBD
    // speed is often empty, so prefer the calculated, then GPS one.
    const speedColumns = headers.map((header, index) => index).filter((index) => normalize(headers[index]).includes("speed"));
    const speedBySource = (pattern) => speedColumns.find((index) => pattern.test(normalize(sources[index])));
    const speedIndex = speedBySource(/calc/) ?? speedBySource(/gps/) ?? (speedColumns.length ? speedColumns[speedColumns.length - 1] : -1);
    if (timeIndex < 0 || speedIndex < 0) throw new Error(`${filename}: time or speed column is missing.`);
    const speedUnit = normalize(units[speedIndex] || headers[speedIndex]);
    const channelMap = resolveChannels(headers.map((name, index) => ({ name, source: sources[index] || "" })));
    const rows = [];

    for (let i = headerIndex + 3; i < lines.length; i += 1) {
      if (!lines[i].trim()) continue;
      const cells = parseCsvLine(lines[i]);
      const rawTime = numeric(cells[timeIndex]);
      const rawSpeed = numeric(cells[speedIndex]);
      if (rawTime === null || rawSpeed === null) continue;
      let speedMps = rawSpeed;
      if (speedUnit.includes("km/h") || speedUnit.includes("kph")) speedMps = rawSpeed / 3.6;
      else if (speedUnit.includes("mph")) speedMps = rawSpeed * 0.44704;
      rows.push({
        time: rawTime,
        speedMps,
        lap: lapIndex >= 0 ? numeric(cells[lapIndex]) : 1,
        distance: distanceIndex >= 0 ? numeric(cells[distanceIndex]) : null,
        lat: latIndex >= 0 ? numeric(cells[latIndex]) : null,
        lon: lonIndex >= 0 ? numeric(cells[lonIndex]) : null,
        ch: readChannels(cells, channelMap),
      });
    }
    if (rows.length < 2) throw new Error(`${filename}: no usable telemetry samples found.`);
    rows.sort((a, b) => a.time - b.time);
    return splitLaps(rows, filename);
  }

  // RaceChrono .vbo export. Coordinates are in minutes with longitude positive
  // west; laps are cut at the [laptiming] start/finish traps.
  function parseVbo(text, filename) {
    const lines = text.replace(/^﻿/, "").split(/\r?\n/);
    const sections = {};
    lines.forEach((line, index) => {
      const match = line.trim().match(/^\[(.+)\]$/);
      if (match) sections[match[1].toLowerCase()] = index;
    });
    if (sections["column names"] === undefined || sections.data === undefined) {
      throw new Error(`${filename}: not a VBO file with [column names] and [data] sections.`);
    }
    let namesLine = sections["column names"] + 1;
    while (namesLine < lines.length && !lines[namesLine].trim()) namesLine += 1;
    const names = lines[namesLine].trim().split(/\s+/);
    const columns = names.map((name) => {
      const split = name.lastIndexOf("-");
      return split > 0 ? { name: name.slice(0, split), source: name.slice(split + 1) } : { name, source: "" };
    });
    const index = (wanted, source = "") => columns.findIndex((column) => column.name === wanted && column.source === source);
    const timeIndex = index("time");
    const latIndex = index("lat");
    const lonIndex = index("long");
    let speedIndex = index("velocity");
    if (speedIndex < 0) speedIndex = index("velocity", "calc");
    if (timeIndex < 0 || speedIndex < 0) throw new Error(`${filename}: time or velocity column is missing.`);
    const channelMap = resolveChannels(columns);

    const toSeconds = (value) => {
      const raw = Number.parseFloat(value);
      if (!Number.isFinite(raw)) return null;
      const hours = Math.floor(raw / 10000);
      const minutes = Math.floor((raw - hours * 10000) / 100);
      return hours * 3600 + minutes * 60 + (raw - hours * 10000 - minutes * 100);
    };

    const rows = [];
    let dayOffset = 0;
    let previousTime = null;
    for (let i = sections.data + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.startsWith("[")) break;
      const cells = line.split(/\s+/);
      if (cells.length !== names.length) continue;
      let time = toSeconds(cells[timeIndex]);
      const speed = numeric(cells[speedIndex]);
      if (time === null || speed === null) continue;
      if (previousTime !== null && time + dayOffset < previousTime - 3600) dayOffset += 86400;
      time += dayOffset;
      previousTime = time;
      const lat = latIndex >= 0 ? numeric(cells[latIndex]) : null;
      const lon = lonIndex >= 0 ? numeric(cells[lonIndex]) : null;
      rows.push({
        time,
        speedMps: speed / 3.6,
        lap: 1,
        distance: null,
        lat: lat !== null && lat !== 0 ? lat / 60 : null,
        lon: lon !== null && lon !== 0 ? -lon / 60 : null,
        ch: readChannels(cells, channelMap),
      });
    }
    if (rows.length < 2) throw new Error(`${filename}: no usable telemetry samples found.`);

    const gates = { start: null, finish: null };
    if (sections.laptiming !== undefined) {
      for (let i = sections.laptiming + 1; i < lines.length; i += 1) {
        const line = lines[i].trim();
        if (!line || line.startsWith("[")) break;
        const match = line.match(/^(start|finish)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)/i);
        if (!match) continue;
        const [lon1, lat1, lon2, lat2] = match.slice(2, 6).map(Number.parseFloat);
        gates[match[1].toLowerCase()] = [
          [lat1 / 60, -lon1 / 60],
          [lat2 / 60, -lon2 / 60],
        ];
      }
    }

    const laps = lapsFromGates(rows, gates)
      .map((samples, lapIndex) => makeLap(filename, lapIndex + 1, samples))
      .filter(Boolean);
    if (laps.length) return laps;
    const whole = makeLap(filename, 1, rows);
    return whole ? [whole] : [];
  }

  function segmentsCross(a, b, c, d) {
    const scale = Math.cos((a[0] * Math.PI) / 180);
    const p = (point) => [point[1] * scale, point[0]];
    const [ax, ay] = p(a);
    const [bx, by] = p(b);
    const [cx, cy] = p(c);
    const [dx, dy] = p(d);
    const denominator = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (denominator === 0) return false;
    const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denominator;
    const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denominator;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  function gateCrossings(rows, gate) {
    if (!gate) return [];
    const crossings = [];
    for (let i = 1; i < rows.length; i += 1) {
      const a = rows[i - 1];
      const b = rows[i];
      if (a.lat === null || b.lat === null) continue;
      if (!segmentsCross([a.lat, a.lon], [b.lat, b.lon], gate[0], gate[1])) continue;
      if (crossings.length && b.time - rows[crossings[crossings.length - 1]].time < 5) continue;
      crossings.push(i);
    }
    return crossings;
  }

  function lapsFromGates(rows, gates) {
    const starts = gateCrossings(rows, gates.start);
    if (!starts.length) return [];
    const sameLine = !gates.finish || (geoDistance(gates.finish[0], gates.start[0]) < 5 && geoDistance(gates.finish[1], gates.start[1]) < 5);
    const laps = [];
    if (sameLine) {
      for (let i = 1; i < starts.length; i += 1) laps.push(rows.slice(starts[i - 1], starts[i] + 1));
      return laps;
    }
    const finishes = gateCrossings(rows, gates.finish);
    starts.forEach((start) => {
      const finish = finishes.find((candidate) => candidate > start);
      if (finish !== undefined) laps.push(rows.slice(start, finish + 1));
    });
    return laps;
  }

  function expectedLapFromFilename(filename) {
    const stem = filename.replace(/\.(csv|vbo)$/i, "");
    const patterns = [/(?:^|[_\s-])lap[_\s-]*(\d+)(?=[_\s.-]|$)/i, /(?:^|[_\s-])l[_\s-]*(\d+)(?=[_\s.-]|$)/i];
    for (const pattern of patterns) {
      const match = stem.match(pattern);
      if (match) return Number.parseInt(match[1], 10);
    }
    return null;
  }

  function makeLap(filename, lapNumber, rows) {
    if (rows.length < 3) return null;
    const samples = rows.map((row) => ({ ...row }));
    const startTime = samples[0].time;
    let integratedDistance = 0;
    const firstDistanceSample = samples.find((sample) => sample.distance !== null);
    const startDistance = firstDistanceSample ? firstDistanceSample.distance : 0;
    samples.forEach((sample, index) => {
      const previous = samples[Math.max(0, index - 1)];
      integratedDistance += sample.speedMps * Math.max(0, sample.time - previous.time);
      sample.elapsed = sample.time - startTime;
      sample.lapDistance = sample.distance !== null ? sample.distance - startDistance : integratedDistance;
      sample.speedKph = sample.speedMps * 3.6;
    });
    const last = samples[samples.length - 1];
    if (last.elapsed <= 0 || last.lapDistance <= 0) return null;
    const channels = CHANNELS.filter((channel) => samples.some((sample) => Math.abs(sample.ch[channel.key] || 0) > 1e-6)).map(
      (channel) => channel.key
    );
    // Mode 0 is "Stock", so an all-zero mode trace is still real data whenever
    // the OpenHaldex device was clearly connected (it reported lock).
    if (channels.includes("lock") && !channels.includes("mode") && "mode" in samples[0].ch) {
      channels.splice(channels.indexOf("lock") + 1, 0, "mode");
    }
    return {
      id: `${filename}::${lapNumber}`,
      filename,
      lapNumber,
      label: `${filename.replace(/\.(csv|vbo)$/i, "")} · L${lapNumber}`,
      samples,
      channels,
      lapTime: last.elapsed,
      distance: last.lapDistance,
    };
  }

  function splitLaps(rows, filename) {
    const buckets = new Map();
    rows.forEach((row) => {
      const lapNumber = Number.isFinite(row.lap) ? Math.trunc(row.lap) : 1;
      if (!buckets.has(lapNumber)) buckets.set(lapNumber, []);
      buckets.get(lapNumber).push(row);
    });

    const expectedLap = expectedLapFromFilename(filename);
    const selectedBuckets =
      expectedLap !== null && buckets.has(expectedLap) ? [[expectedLap, buckets.get(expectedLap)]] : Array.from(buckets.entries());

    return selectedBuckets.map(([lapNumber, samples]) => makeLap(filename, lapNumber, samples)).filter(Boolean);
  }

  function geoDistance(a, b) {
    const toRad = (degrees) => (degrees * Math.PI) / 180;
    const p1 = toRad(a[0]);
    const p2 = toRad(b[0]);
    const dp = toRad(b[0] - a[0]);
    const dl = toRad(b[1] - a[1]);
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(h));
  }

  function lapStart(lap) {
    const point = lap.samples.find((sample) => sample.lat !== null && sample.lon !== null);
    return point ? [point.lat, point.lon] : null;
  }

  function groupLaps(laps) {
    const groups = [];
    laps.forEach((lap) => {
      const location = lapStart(lap);
      let group = groups.find((candidate) => {
        if (location && candidate.location) return geoDistance(location, candidate.location) <= 3000;
        if (!location && !candidate.location) return Math.abs(lap.distance - candidate.distance) / candidate.distance <= 0.15;
        return false;
      });
      if (!group) {
        group = { location, distance: lap.distance, laps: [] };
        groups.push(group);
      }
      group.laps.push(lap);
    });
    groups.forEach((group, index) => {
      group.name = groups.length === 1 ? "Loaded session" : `Track ${index + 1}`;
      group.channels = CHANNELS.filter((channel) => group.laps.some((lap) => lap.channels.includes(channel.key))).map((channel) => channel.key);
    });
    return groups;
  }

  // Samples the lap at fractions of its own length, so laps that took a
  // slightly longer or shorter line stay aligned corner for corner.
  function interpolate(lap, fractions, channelKeys) {
    const samples = lap.samples.filter((sample, index, all) => index === 0 || sample.lapDistance > all[index - 1].lapDistance);
    let cursor = 0;
    return fractions.map((fraction) => {
      const distance = fraction * lap.distance;
      while (cursor < samples.length - 2 && samples[cursor + 1].lapDistance < distance) cursor += 1;
      const left = samples[cursor];
      const right = samples[Math.min(cursor + 1, samples.length - 1)];
      const span = right.lapDistance - left.lapDistance;
      const ratio = span > 0 ? Math.min(1, Math.max(0, (distance - left.lapDistance) / span)) : 0;
      const mix = (a, b) => (a === null || b === null ? (ratio < 0.5 ? a : b) : a + (b - a) * ratio);
      const ch = {};
      channelKeys.forEach((key) => {
        const a = left.ch[key] ?? null;
        const b = right.ch[key] ?? null;
        ch[key] = CHANNEL_BY_KEY[key].step ? (ratio < 0.5 ? a : b) : mix(a, b);
      });
      return {
        time: left.elapsed + (right.elapsed - left.elapsed) * ratio,
        speed: left.speedKph + (right.speedKph - left.speedKph) * ratio,
        lat: left.lat === null || right.lat === null ? null : mix(left.lat, right.lat),
        lon: left.lon === null || right.lon === null ? null : mix(left.lon, right.lon),
        ch,
      };
    });
  }

  function comparisonData(group, reference) {
    const fractions = [];
    for (let i = 0; i <= GRID_POINTS; i += 1) fractions.push(i / GRID_POINTS);
    const xs = fractions.map((fraction) => fraction * reference.distance);
    const ref = interpolate(reference, fractions, group.channels);
    const comparisons = group.laps.map((lap, index) => {
      const points = interpolate(lap, fractions, group.channels).map((point, i) => ({ ...point, x: xs[i] }));
      return {
        lap,
        color: COLORS[index % COLORS.length],
        points,
        speed: points.map((point) => ({ x: point.x, y: point.speed })),
        delta: points.map((point, i) => ({ x: point.x, y: point.time - ref[i].time })),
      };
    });
    comparisons
      .slice()
      .sort((a, b) => a.lap.lapTime - b.lap.lapTime)
      .forEach((entry, index) => {
        entry.badge = index + 1;
      });
    return { xs, comparisons };
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, "0")}`;
  }

  function formatSigned(value, digits = 3) {
    if (!Number.isFinite(value)) return "–";
    const fixed = value.toFixed(digits);
    if (Number(fixed) === 0) return (0).toFixed(digits);
    return value > 0 ? `+${fixed}` : fixed;
  }

  function formatChannel(key, value) {
    const channel = CHANNEL_BY_KEY[key];
    if (value === null || value === undefined || !Number.isFinite(value)) return "–";
    if (channel.flag) return value ? "on" : "off";
    if (channel.mode) return MODE_NAMES[Math.round(value)] || String(Math.round(value));
    return `${value.toFixed(channel.digits)}${channel.unit ? ` ${channel.unit}` : ""}`;
  }

  // ---- Linked cursor -------------------------------------------------------

  const cursorPlugin = {
    id: "telemetryCursor",
    afterDatasetsDraw(chart) {
      const { drag } = state;
      if (drag && drag.canvas === chart.canvas) {
        const { top, bottom } = chart.chartArea;
        chart.ctx.save();
        chart.ctx.fillStyle = "rgba(255, 212, 0, 0.22)";
        chart.ctx.fillRect(Math.min(drag.startPx, drag.endPx), top, Math.abs(drag.endPx - drag.startPx), bottom - top);
        chart.ctx.restore();
      }
      if (state.cursorIndex === null || !state.current) return;
      const x = state.current.xs[state.cursorIndex];
      const pixel = chart.scales.x.getPixelForValue(x);
      const { top, bottom, left, right } = chart.chartArea;
      if (pixel < left || pixel > right) return;
      const { ctx } = chart;
      ctx.save();
      ctx.strokeStyle = "rgba(127,127,127,.85)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(pixel, top);
      ctx.lineTo(pixel, bottom);
      ctx.stroke();
      ctx.restore();
    },
  };

  let cursorFrame = null;
  function setCursor(index, fromUser = true) {
    if (!state.current) return;
    if (fromUser && state.replay.active && !state.replay.playing) {
      state.replay.active = false;
      els.replayClock.hidden = true;
      updateReplayButton();
    }
    state.cursorIndex = index === null ? null : Math.max(0, Math.min(state.current.xs.length - 1, index));
    if (cursorFrame) return;
    cursorFrame = window.requestAnimationFrame(() => {
      cursorFrame = null;
      ["speed", "delta", "channel"].forEach((name) => state.charts[name] && state.charts[name].draw());
      updateCursorMarkers();
      updateReadout();
    });
  }

  function setCursorByDistance(distance) {
    if (!state.current) return;
    const { xs } = state.current;
    const step = xs[1] - xs[0];
    setCursor(Math.round(distance / step));
  }

  // Hover moves the cursor; drag across a chart to zoom every chart and the
  // map to that stretch; double-click to zoom back out.
  function attachChartCursor(canvas) {
    const locate = (event) => {
      const chart = window.Chart && Chart.getChart(canvas);
      if (!chart || !state.current) return null;
      const rect = canvas.getBoundingClientRect();
      const { left, right } = chart.chartArea;
      return {
        chart,
        px: Math.min(right, Math.max(left, event.clientX - rect.left)),
        inside: event.clientX - rect.left >= left && event.clientX - rect.left <= right,
      };
    };
    canvas.addEventListener("pointermove", (event) => {
      const hit = locate(event);
      if (!hit) return;
      if (state.drag && state.drag.canvas === canvas) {
        state.drag.endPx = hit.px;
        hit.chart.draw();
      }
      if (hit.inside && !state.replay.playing) setCursorByDistance(hit.chart.scales.x.getValueForPixel(hit.px));
    });
    canvas.addEventListener("pointerdown", (event) => {
      const hit = locate(event);
      if (!hit || !hit.inside || event.button !== 0 || event.pointerType === "touch") return;
      state.drag = { canvas, startPx: hit.px, endPx: hit.px };
    });
    canvas.addEventListener("dblclick", () => resetZoom());
  }

  window.addEventListener("pointerup", () => {
    const drag = state.drag;
    if (!drag) return;
    state.drag = null;
    const chart = window.Chart && Chart.getChart(drag.canvas);
    if (!chart) return;
    chart.draw();
    if (Math.abs(drag.endPx - drag.startPx) < 8) return;
    state.suppressClickUntil = performance.now() + 400;
    zoomToDistance(chart.scales.x.getValueForPixel(drag.startPx), chart.scales.x.getValueForPixel(drag.endPx));
  });

  function updateReadout() {
    const current = state.current;
    if (!current || state.cursorIndex === null) {
      els.readout.hidden = true;
      return;
    }
    const i = state.cursorIndex;
    const x = current.xs[i];
    const channel = state.channelKey;
    els.readout.hidden = false;
    els.readoutTitle.textContent = `${Math.round(x)} m · ${Math.round((i / GRID_POINTS) * 100)}% of lap`;
    els.readoutBody.innerHTML = current.comparisons
      .filter((entry) => !state.hiddenLaps.has(entry.lap.id))
      .map((entry) => {
        const point = entry.points[i];
        const delta = entry.delta[i].y;
        const isRef = entry.lap.id === current.reference.id;
        const channelValue = channel ? ` · ${escapeHtml(CHANNEL_BY_KEY[channel].label)} ${formatChannel(channel, point.ch[channel])}` : "";
        return `<span class="telemetry-readout-chip${isRef ? " is-reference" : ""}" style="--chip-color:${entry.color}">
          <b title="${escapeHtml(entry.lap.label)}">${escapeHtml(entry.lap.label)}</b>
          ${point.speed.toFixed(1)} km/h · ${isRef ? "ref" : `${formatSigned(delta)} s`}${channelValue}
        </span>`;
      })
      .join("");
  }

  // ---- Charts --------------------------------------------------------------

  function chartOptions(yTitle, overlayDelta = false) {
    const [xMin, xMax] = chartXRange();
    const scales = {
      x: {
        type: "linear",
        min: xMin,
        max: xMax,
        title: { display: true, text: "Distance along reference lap (m)" },
        grid: { color: "rgba(127,127,127,.12)" },
        ticks: { maxTicksLimit: 6 },
      },
      y: { title: { display: true, text: yTitle }, grid: { color: "rgba(127,127,127,.12)" }, ticks: { maxTicksLimit: 6 } },
    };
    if (overlayDelta) {
      scales.delta = {
        position: "right",
        title: { display: true, text: "Delta (s)" },
        grid: { drawOnChartArea: false },
        ticks: { maxTicksLimit: 6 },
      };
    }
    return {
      animation: false,
      maintainAspectRatio: false,
      normalized: true,
      parsing: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 8, font: { size: 10 }, padding: 10, usePointStyle: true },
        },
        tooltip: { enabled: false },
      },
      scales,
    };
  }

  function updateCharts(comparisons, reference) {
    ["speed", "delta"].forEach((name) => {
      if (state.charts[name]) state.charts[name].destroy();
      delete state.charts[name];
    });
    const datasets = comparisons.map((entry) => ({
      label: `#${entry.badge} ${entry.lap.label} (${formatTime(entry.lap.lapTime)})`,
      hidden: state.hiddenLaps.has(entry.lap.id),
      data: entry.speed,
      borderColor: entry.color,
      backgroundColor: entry.color,
      borderWidth: entry.lap.id === reference.id ? 3 : 1.7,
      pointRadius: 0,
    }));
    const deltaSets = comparisons.map((entry) => ({
      label: `${state.overlayDelta ? "Δ " : ""}#${entry.badge} ${entry.lap.label}`,
      hidden: state.hiddenLaps.has(entry.lap.id),
      data: entry.delta,
      borderColor: entry.color,
      backgroundColor: entry.color,
      borderWidth: entry.lap.id === reference.id ? 2.5 : 1.7,
      borderDash: state.overlayDelta ? [5, 4] : [],
      pointRadius: 0,
      yAxisID: state.overlayDelta ? "delta" : "y",
    }));
    const speedDatasets = state.overlayDelta ? datasets.concat(deltaSets) : datasets;
    state.charts.speed = new Chart(byId("telemetry-speed-chart"), {
      type: "line",
      data: { datasets: speedDatasets },
      options: chartOptions("Speed (km/h)", state.overlayDelta),
      plugins: [cursorPlugin],
    });
    els.deltaPanel.hidden = state.overlayDelta;
    els.speedPanel.classList.toggle("is-overlay", state.overlayDelta);
    if (!state.overlayDelta) {
      state.charts.delta = new Chart(byId("telemetry-delta-chart"), {
        type: "line",
        data: { datasets: deltaSets },
        options: chartOptions("Delta (s)"),
        plugins: [cursorPlugin],
      });
    }
  }

  function updateChannelChart() {
    if (state.charts.channel) state.charts.channel.destroy();
    delete state.charts.channel;
    const current = state.current;
    const key = state.channelKey;
    els.channelPanel.hidden = !key;
    if (!key) return;
    const channel = CHANNEL_BY_KEY[key];
    els.channelUnit.textContent = channel.mode ? MODE_NAMES.map((name, i) => `${i} ${name}`).join(" · ") : channel.unit || "";
    const datasets = current.comparisons
      .filter((entry) => entry.lap.channels.includes(key) || (entry.derived || []).includes(key))
      .map((entry) => ({
        label: `#${entry.badge} ${entry.lap.label}`,
        hidden: state.hiddenLaps.has(entry.lap.id),
        data: entry.points.map((point) => ({ x: point.x, y: point.ch[key] })),
        borderColor: entry.color,
        backgroundColor: entry.color,
        borderWidth: entry.lap.id === current.reference.id ? 2.5 : 1.5,
        pointRadius: 0,
        stepped: channel.step ? "middle" : false,
      }));
    const options = chartOptions(`${channel.label}${channel.unit ? ` (${channel.unit})` : ""}`);
    if (channel.flag) Object.assign(options.scales.y, { min: -0.1, max: 1.1, ticks: { stepSize: 1 } });
    state.charts.channel = new Chart(byId("telemetry-channel-chart"), {
      type: "line",
      data: { datasets },
      options,
      plugins: [cursorPlugin],
    });
  }

  function updateGG() {
    if (state.charts.gg) state.charts.gg.destroy();
    delete state.charts.gg;
    const current = state.current;
    const show = current.group.channels.includes("latG") && current.group.channels.includes("longG");
    els.ggPanel.hidden = !show;
    if (!show) return;
    const laps = [current.reference];
    if (current.compare.id !== current.reference.id) laps.push(current.compare);
    let limit = 0.5;
    const datasets = laps.map((lap) => {
      const entry = current.comparisons.find((candidate) => candidate.lap.id === lap.id);
      const stride = Math.max(1, Math.floor(lap.samples.length / 1500));
      const data = [];
      for (let i = 0; i < lap.samples.length; i += stride) {
        const { latG, longG } = lap.samples[i].ch;
        if (latG === null || longG === null || latG === undefined || longG === undefined) continue;
        limit = Math.max(limit, Math.abs(latG), Math.abs(longG));
        data.push({ x: latG, y: longG });
      }
      return {
        label: lap.label,
        data,
        backgroundColor: `${entry.color}66`,
        borderColor: entry.color,
        pointRadius: 1.6,
        pointHoverRadius: 1.6,
      };
    });
    limit = Math.ceil(limit * 10 + 1) / 10;
    if (current.gripEnvelope) {
      const ring = [];
      for (let a = 0; a <= 64; a += 1)
        ring.push({ x: current.gripEnvelope * Math.cos((a / 64) * 2 * Math.PI), y: current.gripEnvelope * Math.sin((a / 64) * 2 * Math.PI) });
      datasets.push({
        type: "line",
        label: `Grip seen this session (${current.gripEnvelope.toFixed(2)} G)`,
        data: ring,
        borderColor: "rgba(127,127,127,.7)",
        borderDash: [5, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      });
    }
    const axis = (title) => ({
      type: "linear",
      min: -limit,
      max: limit,
      title: { display: true, text: title },
      grid: { color: (context) => (context.tick.value === 0 ? "rgba(127,127,127,.45)" : "rgba(127,127,127,.12)") },
      ticks: { maxTicksLimit: 7 },
    });
    state.charts.gg = new Chart(byId("telemetry-gg-chart"), {
      type: "scatter",
      data: { datasets },
      options: {
        animation: false,
        maintainAspectRatio: false,
        parsing: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 8, font: { size: 10 }, padding: 10, usePointStyle: true } },
          tooltip: { enabled: false },
        },
        scales: { x: axis("Lateral G"), y: axis("Longitudinal G (− braking)") },
      },
    });
  }

  // ---- Map -----------------------------------------------------------------

  // Speed minima (corners) and maxima (straights) on an evenly spaced trace.
  function speedExtrema(points, lapDistance, step, limit = 16) {
    const smoothRadius = Math.max(2, Math.round(10 / step));
    const smoothed = points.map((point, index) => {
      const start = Math.max(0, index - smoothRadius);
      const end = Math.min(points.length - 1, index + smoothRadius);
      let total = 0;
      for (let i = start; i <= end; i += 1) total += points[i].speed;
      return total / (end - start + 1);
    });
    const speedRange = Math.max(...smoothed) - Math.min(...smoothed);
    const minProminence = Math.max(4, speedRange * 0.07);
    const minSeparation = Math.max(35, lapDistance * 0.018);
    // Prominence: how far speed recovers (or drops) on both sides before the
    // trace passes this point again, looking up to ~15% of the lap each way.
    // This catches long fast sweepers on road courses as well as tight
    // autocross elements.
    const reach = Math.max(4, Math.round(Math.max(80, lapDistance * 0.15) / step));
    const sideExtreme = (index, direction, isCorner) => {
      const value = smoothed[index];
      let extreme = value;
      for (let i = index + direction, n = 0; i >= 0 && i < smoothed.length && n < reach; i += direction, n += 1) {
        if (isCorner ? smoothed[i] < value : smoothed[i] > value) break;
        extreme = isCorner ? Math.max(extreme, smoothed[i]) : Math.min(extreme, smoothed[i]);
      }
      return extreme;
    };
    const candidates = [];

    for (let index = 2; index < smoothed.length - 2; index += 1) {
      const value = smoothed[index];
      const isCorner = value <= smoothed[index - 1] && value < smoothed[index + 1];
      const isStraight = value >= smoothed[index - 1] && value > smoothed[index + 1];
      if (!isCorner && !isStraight) continue;
      const left = sideExtreme(index, -1, isCorner);
      const right = sideExtreme(index, 1, isCorner);
      const prominence = isCorner ? Math.min(left, right) - value : value - Math.max(left, right);
      if (prominence >= minProminence) {
        const point = points[index];
        candidates.push({
          index,
          distance: point.distance,
          speed: point.speed,
          lat: point.lat,
          lon: point.lon,
          kind: isCorner ? "corner" : "straight",
          prominence,
        });
      }
    }

    const selected = [];
    candidates
      .sort((a, b) => b.prominence - a.prominence)
      .forEach((candidate) => {
        if (selected.length >= limit) return;
        const clear = selected.every(
          (marker) => Math.abs(marker.distance - candidate.distance) >= (marker.kind === candidate.kind ? minSeparation : minSeparation / 3)
        );
        if (clear) selected.push(candidate);
      });
    return { markers: selected.sort((a, b) => a.distance - b.distance), smoothed };
  }

  function lapPolyline(lap) {
    const points = [];
    lap.samples.forEach((sample) => {
      if (sample.lat === null || sample.lon === null) return;
      const point = [sample.lat, sample.lon];
      if (points.length) {
        const gap = geoDistance(points[points.length - 1], point);
        // Skip GPS jumps, and thin out high-rate logs to about one point per metre.
        if (gap > 200 || gap < 1) return;
      }
      points.push(point);
    });
    return points;
  }

  function gainBucket(rate) {
    if (rate <= -0.012) return "strongGain";
    if (rate <= -0.003) return "gain";
    if (rate < 0.003) return "neutral";
    if (rate < 0.012) return "loss";
    return "strongLoss";
  }

  // Time gained/lost per 10 m by the compare lap relative to the reference.
  function gainRates(entry, xs) {
    const step = xs[1] - xs[0];
    const radius = Math.max(1, Math.round(10 / step));
    return entry.delta.map((_, i) => {
      const a = Math.max(0, i - radius);
      const b = Math.min(entry.delta.length - 1, i + radius);
      const span = xs[b] - xs[a];
      return span > 0 ? ((entry.delta[b].y - entry.delta[a].y) / span) * 10 : 0;
    });
  }

  const BASE_LAYERS = {
    muted: {
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      options: { subdomains: "abcd", maxZoom: 20, attribution: "&copy; OpenStreetMap contributors &copy; CARTO" },
    },
    dark: {
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      options: { subdomains: "abcd", maxZoom: 20, attribution: "&copy; OpenStreetMap contributors &copy; CARTO" },
    },
    satellite: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      options: { maxZoom: 19, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics" },
    },
    street: {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      options: { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" },
    },
  };
  const VALUE_COLORS = ["#2c7bb6", "#00a6ca", "#00ccbc", "#90eb9d", "#ffff8c", "#f9d057", "#f29e2e", "#e76818", "#d7191c"];

  const refEntry = (current) => current.comparisons.find((entry) => entry.lap.id === current.reference.id);
  const focusEntry = (current) => current.comparisons.find((entry) => entry.lap.id === current.compare.id);
  const isKeyLap = (entry, current) => entry.lap.id === current.reference.id || entry.lap.id === current.compare.id;

  function addMapLayer(layer) {
    layer.addTo(state.map);
    state.mapLayers.push(layer);
    return layer;
  }

  function mapLabel(latLng, html, className, options = {}) {
    return L.marker(latLng, {
      icon: L.divIcon({ className: `telemetry-map-label ${className}`, html, iconSize: [0, 0] }),
      keyboard: false,
      ...options,
    });
  }

  function gridLine(entry, from = 0, to = entry.points.length - 1) {
    const line = [];
    for (let i = Math.max(0, from); i <= Math.min(entry.points.length - 1, to); i += 1) {
      const point = entry.points[i];
      if (point.lat !== null) line.push([point.lat, point.lon]);
    }
    return line;
  }

  // Draws one lap's grid trace, grouping neighbouring points of the same colour.
  function drawColoredRuns(entry, colorAt, bounds) {
    let run = null;
    const flush = () => {
      if (!run || run.points.length < 2) return;
      addMapLayer(L.polyline(run.points, { color: run.color, opacity: 0.95, weight: 5, lineCap: "round", interactive: false }));
      run.points.forEach((point) => bounds.push(point));
    };
    entry.points.forEach((point, i) => {
      if (point.lat === null) return;
      const color = colorAt(i);
      const latLng = [point.lat, point.lon];
      if (run && run.color === color) {
        run.points.push(latLng);
        return;
      }
      const previous = run ? run.points[run.points.length - 1] : null;
      flush();
      run = { color, points: previous ? [previous, latLng] : [latLng] };
    });
    flush();
  }

  function drawGhostReference(current, bounds) {
    if (current.compare.id === current.reference.id) return;
    const line = lapPolyline(current.reference);
    if (line.length < 2) return;
    addMapLayer(L.polyline(line, { color: "#666", opacity: 0.45, weight: 2, dashArray: "4 5", interactive: false }));
    line.forEach((point) => bounds.push(point));
  }

  function drawGainMap(current, bounds) {
    drawGhostReference(current, bounds);
    const rates = gainRates(focusEntry(current), current.xs);
    drawColoredRuns(focusEntry(current), (i) => GAIN_COLORS[gainBucket(rates[i])], bounds);
    return `<i style="background:${GAIN_COLORS.strongGain}"></i>gaining <i style="background:${GAIN_COLORS.neutral}"></i>even <i style="background:${GAIN_COLORS.strongLoss}"></i>losing`;
  }

  function drawValueMap(current, mode, bounds) {
    const entry = focusEntry(current);
    const key = mode === "speed" ? null : mode.slice(3);
    const channel = key ? CHANNEL_BY_KEY[key] : null;
    const values = entry.points.map((point) => (key ? point.ch[key] : point.speed));
    const finite = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    drawGhostReference(current, bounds);
    if (!finite.length) return "No data for this lap";
    if (channel && channel.flag) {
      drawColoredRuns(entry, (i) => (values[i] ? "#d7191c" : "#9ca3af"), bounds);
      return `<i style="background:#d7191c"></i>${escapeHtml(channel.label.replace(/ active$/, ""))} on <i style="background:#9ca3af"></i>off`;
    }
    let low = finite[Math.floor((finite.length - 1) * 0.02)];
    let high = finite[Math.floor((finite.length - 1) * 0.98)];
    if (high - low < 1e-9) {
      low -= 1;
      high += 1;
    }
    drawColoredRuns(
      entry,
      (i) => {
        if (!Number.isFinite(values[i])) return "#9ca3af";
        const t = Math.min(0.999, Math.max(0, (values[i] - low) / (high - low)));
        return VALUE_COLORS[Math.floor(t * VALUE_COLORS.length)];
      },
      bounds
    );
    const format = (value) => (key ? formatChannel(key, value) : `${value.toFixed(0)} km/h`);
    return `<span class="telemetry-gradient-key">${format(low)}<b style="background:linear-gradient(90deg,${VALUE_COLORS.join(",")})"></b>${format(high)}</span>`;
  }

  const lapBadgeHtml = (entry) => `<span class="telemetry-lap-badge" style="--chip-color:${entry.color}">${entry.badge}</span>`;

  function lapStyle(entry, current, emphasis) {
    const key = isKeyLap(entry, current);
    const weight = key ? 5 : 3.5;
    if (emphasis === "focus") return { line: { opacity: 1, weight: weight + 2 }, casing: { opacity: 0.95, weight: weight + 6 } };
    if (emphasis === "fade") return { line: { opacity: 0.12, weight }, casing: { opacity: 0, weight: weight + 4 } };
    return { line: { opacity: 0.95, weight }, casing: { opacity: 0.85, weight: weight + 4 } };
  }

  // Emphasises one lap on the map (hover a line or a legend chip) and fades the rest.
  function highlightLap(id) {
    const current = state.current;
    if (!current || !state.lapLayers) return;
    Object.entries(state.lapLayers).forEach(([lapId, layers]) => {
      const emphasis = id === null ? "normal" : lapId === id ? "focus" : "fade";
      const style = lapStyle(layers.entry, current, emphasis);
      layers.casing.setStyle(style.casing);
      layers.line.setStyle(style.line);
      if (layers.tag) layers.tag.setOpacity(emphasis === "fade" ? 0.15 : 1);
    });
    if (id !== null && state.lapLayers[id]) {
      state.lapLayers[id].casing.bringToFront();
      state.lapLayers[id].line.bringToFront();
    }
    els.lapLegend.querySelectorAll("[data-id]").forEach((chip) => {
      chip.classList.toggle("is-focus", id !== null && decodeURIComponent(chip.dataset.id) === id);
    });
  }

  function drawLapLines(current, bounds) {
    state.lapLayers = {};
    const visible = current.comparisons.filter((entry) => !state.hiddenLaps.has(entry.lap.id));
    visible
      .slice()
      .sort((a, b) => Number(isKeyLap(a, current)) - Number(isKeyLap(b, current)))
      .forEach((entry) => {
        const line = lapPolyline(entry.lap);
        if (line.length < 2) return;
        const style = lapStyle(entry, current, "normal");
        const casing = addMapLayer(L.polyline(line, { color: "#fff", lineCap: "round", interactive: false, ...style.casing }));
        const polyline = addMapLayer(
          L.polyline(line, { color: entry.color, lineCap: "round", ...style.line }).bindTooltip(
            `#${entry.badge} ${escapeHtml(entry.lap.label)} · ${formatTime(entry.lap.lapTime)}`,
            { sticky: true }
          )
        );
        polyline.on("mouseover", () => highlightLap(entry.lap.id));
        polyline.on("mouseout", () => highlightLap(null));
        state.lapLayers[entry.lap.id] = { entry, casing, line: polyline, tag: null };
        line.forEach((point) => bounds.push(point));
      });
    // A numbered tag on each line, spread around the lap so they don't stack.
    const count = current.comparisons.length;
    visible.forEach((entry) => {
      const fraction = count === 1 ? 0.15 : 0.1 + (0.8 * (entry.badge - 1)) / (count - 1);
      const point = entry.points[Math.round(fraction * GRID_POINTS)];
      if (!point || point.lat === null || !state.lapLayers[entry.lap.id]) return;
      const tag = addMapLayer(mapLabel([point.lat, point.lon], lapBadgeHtml(entry), "is-lap-tag"));
      tag.bindTooltip(`#${entry.badge} ${escapeHtml(entry.lap.label)} · ${formatTime(entry.lap.lapTime)}`, { direction: "top", offset: [0, -10] });
      tag.on("mouseover", () => highlightLap(entry.lap.id));
      tag.on("mouseout", () => highlightLap(null));
      state.lapLayers[entry.lap.id].tag = tag;
    });
    return "Hover a line or a lap below to pick it out";
  }

  function bearing(a, b) {
    const y = (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180);
    return (Math.atan2(y, b[0] - a[0]) * 180) / Math.PI;
  }

  function drawTrackFurniture(current) {
    const ref = refEntry(current);
    const points = ref.points.filter((point) => point.lat !== null);
    if (points.length < 10) return;
    const start = [points[0].lat, points[0].lon];
    const finish = [points[points.length - 1].lat, points[points.length - 1].lon];
    if (geoDistance(start, finish) < 40) {
      addMapLayer(mapLabel(start, "<span>🏁 Start / Finish</span>", "is-flag", { interactive: false }));
    } else {
      addMapLayer(mapLabel(start, "<span>Start</span>", "is-flag", { interactive: false }));
      addMapLayer(mapLabel(finish, "<span>🏁 Finish</span>", "is-flag", { interactive: false }));
    }
    for (let fraction = 0.05; fraction < 0.97; fraction += 0.1) {
      const i = Math.round(fraction * GRID_POINTS);
      const a = ref.points[Math.max(0, i - 4)];
      const b = ref.points[Math.min(GRID_POINTS, i + 4)];
      const here = ref.points[i];
      if (a.lat === null || b.lat === null || here.lat === null) continue;
      const angle = bearing([a.lat, a.lon], [b.lat, b.lon]) - 90;
      addMapLayer(
        mapLabel([here.lat, here.lon], `<span style="transform:translate(-50%,-50%) rotate(${angle.toFixed(0)}deg)">➤</span>`, "is-arrow", {
          interactive: false,
        })
      );
    }
  }

  function drawCornerLabels(current) {
    const ref = refEntry(current);
    const same = current.compare.id === current.reference.id;
    (current.cornerRows || []).forEach((row) => {
      const point = ref.points[row.zone.apex];
      if (point.lat === null) return;
      const tooltip = same
        ? `T${row.zone.number}: min ${row.ref.minSpeed.toFixed(1)} km/h`
        : `T${row.zone.number}: min ${row.ref.minSpeed.toFixed(1)} → ${row.cmp.minSpeed.toFixed(1)} km/h · ${formatSigned(row.dt)} s`;
      const marker = mapLabel(
        [point.lat, point.lon],
        `<span class="${row.worst ? "is-worst" : ""}">T${row.zone.number}</span>`,
        "is-corner"
      ).bindTooltip(tooltip, { direction: "top", offset: [0, -10] });
      marker.on("click", () => zoomToCorner(row.zone));
      addMapLayer(marker);
    });
  }

  function setBaseLayer(name) {
    if (!state.map) return;
    if (state.baseLayer) state.baseLayer.remove();
    const base = BASE_LAYERS[name] || BASE_LAYERS.muted;
    state.baseLayer = L.tileLayer(base.url, base.options).addTo(state.map);
    els.mapPanel.classList.toggle("is-dark-map", name === "satellite" || name === "dark");
  }

  function ensureMap() {
    if (state.map || !window.L) return Boolean(state.map);
    state.map = L.map("telemetry-map", { scrollWheelZoom: true, zoomControl: true });
    setBaseLayer(state.baseName);
    state.map.on("mousemove", (event) => {
      if (!state.current || state.replay.playing) return;
      const target = [event.latlng.lat, event.latlng.lng];
      let best = null;
      let bestDistance = Infinity;
      refEntry(state.current).points.forEach((point, index) => {
        if (point.lat === null) return;
        const distance = geoDistance(target, [point.lat, point.lon]);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      const metersPerPixel = (40075016 * Math.cos((target[0] * Math.PI) / 180)) / 2 ** (state.map.getZoom() + 8);
      if (best !== null && bestDistance < Math.max(15, metersPerPixel * 25)) setCursor(best);
    });
    return true;
  }

  function updateMap(current) {
    if (!ensureMap()) return;
    state.lapLayers = {};
    state.mapLayers.forEach((layer) => layer.remove());
    state.cursorMarkers.forEach(({ marker }) => marker.remove());
    state.mapLayers = [];
    state.cursorMarkers = [];
    const bounds = [];
    const multi = current.compare.id !== current.reference.id;
    let mode = state.mapMode;
    if (mode === "gain" && !multi) mode = "laps";
    let legend;
    if (mode === "gain") legend = drawGainMap(current, bounds);
    else if (mode === "laps") legend = drawLapLines(current, bounds);
    else legend = drawValueMap(current, mode, bounds);
    if (mode !== "laps") legend = `${escapeHtml(current.compare.label)}: ${legend}`;
    els.mapLegend.innerHTML = legend;

    drawTrackFurniture(current);
    drawCornerLabels(current);

    const cursorLaps = current.comparisons.filter((entry) => !state.hiddenLaps.has(entry.lap.id) && (mode === "laps" || isKeyLap(entry, current)));
    state.cursorMarkers = cursorLaps.map((entry) => ({
      entry,
      marker: L.circleMarker([0, 0], {
        radius: 7,
        color: "#fff",
        weight: 2,
        fillColor: entry.color,
        fillOpacity: 1,
        interactive: false,
      }),
    }));

    updateLapLegend(current);
    state.mapBounds = bounds;
    drawZoomHighlight();
    window.requestAnimationFrame(() => {
      state.map.invalidateSize();
      fitMap();
    });
  }

  function fitMap() {
    if (!state.map) return;
    const line = state.zoomRange ? zoomLine() : null;
    if (line && line.length > 1) state.map.fitBounds(line, { padding: [30, 30], maxZoom: 19 });
    else if (state.mapBounds.length) state.map.fitBounds(state.mapBounds, { padding: [16, 16], maxZoom: 18 });
    else state.map.setView([38, -97], 3);
  }

  function updateLapLegend(current) {
    const anyHidden = current.comparisons.some((entry) => state.hiddenLaps.has(entry.lap.id));
    els.lapLegend.innerHTML =
      current.comparisons
        .slice()
        .sort((a, b) => a.badge - b.badge)
        .map((entry) => {
          const hidden = state.hiddenLaps.has(entry.lap.id);
          const role = entry.lap.id === current.reference.id ? "ref" : entry.lap.id === current.compare.id ? "compare" : "";
          return `<button type="button" class="telemetry-lap-chip${hidden ? " is-hidden" : ""}${role ? " is-key" : ""}" data-id="${encodeURIComponent(
            entry.lap.id
          )}" style="--chip-color:${entry.color}" aria-pressed="${!hidden}" title="Click to ${hidden ? "show" : "hide"} · double-click to show only this lap">
            ${lapBadgeHtml(entry)}${escapeHtml(entry.lap.label)} <small>${formatTime(entry.lap.lapTime)}${role ? ` · ${role}` : ""}</small>
          </button>`;
        })
        .join("") +
      (anyHidden ? `<button type="button" class="telemetry-lap-show-all" data-action="all">Show all</button>` : "") +
      `<span class="telemetry-lap-legend-hint">Click to hide/show · double-click to solo</span>`;
  }

  function setLapVisibility(update) {
    if (!state.current) return;
    update();
    const current = state.current;
    if (current.comparisons.every((entry) => state.hiddenLaps.has(entry.lap.id))) state.hiddenLaps.clear();
    updateCharts(current.comparisons, current.reference);
    updateChannelChart();
    updateMap(current);
    updateCursorMarkers();
    updateReadout();
  }

  // ---- Zoom to a stretch of track -----------------------------------------

  function zoomIndices() {
    if (!state.zoomRange || !state.current) return null;
    return [Math.floor(state.zoomRange[0] * GRID_POINTS), Math.ceil(state.zoomRange[1] * GRID_POINTS)];
  }

  function zoomLine() {
    const indices = zoomIndices();
    return indices ? gridLine(refEntry(state.current), indices[0], indices[1]) : null;
  }

  function chartXRange() {
    const current = state.current;
    if (!current) return [undefined, undefined];
    const max = current.xs[current.xs.length - 1];
    return state.zoomRange ? [state.zoomRange[0] * max, state.zoomRange[1] * max] : [0, max];
  }

  function applyChartZoom() {
    const [min, max] = chartXRange();
    ["speed", "delta", "channel"].forEach((name) => {
      const chart = state.charts[name];
      if (!chart) return;
      chart.options.scales.x.min = min;
      chart.options.scales.x.max = max;
      chart.update("none");
    });
  }

  function drawZoomHighlight() {
    if (state.highlightLayer) state.highlightLayer.remove();
    state.highlightLayer = null;
    const line = state.map && state.zoomRange ? zoomLine() : null;
    if (!line || line.length < 2) return;
    state.highlightLayer = L.polyline(line, { color: "#ffd400", weight: 14, opacity: 0.5, interactive: false }).addTo(state.map);
    state.highlightLayer.bringToBack();
  }

  function zoomToDistance(x0, x1) {
    const current = state.current;
    if (!current) return;
    const max = current.xs[current.xs.length - 1];
    const a = Math.max(0, Math.min(x0, x1));
    const b = Math.min(max, Math.max(x0, x1));
    if (b - a < 5) return;
    state.zoomRange = [a / max, b / max];
    els.zoomReset.hidden = false;
    applyChartZoom();
    drawZoomHighlight();
    fitMap();
  }

  function zoomToCorner(zone) {
    const { xs } = state.current;
    const margin = (xs[zone.end] - xs[zone.start]) * 0.1;
    zoomToDistance(xs[zone.start] - margin, xs[zone.end] + margin);
    setCursor(zone.apex);
  }

  function resetZoom() {
    state.zoomRange = null;
    els.zoomReset.hidden = true;
    applyChartZoom();
    drawZoomHighlight();
    fitMap();
  }

  // ---- Ghost replay --------------------------------------------------------

  function lapPositionAt(lap, time) {
    const { samples } = lap;
    if (time <= 0) return samples[0];
    if (time >= lap.lapTime) return samples[samples.length - 1];
    let low = 0;
    let high = samples.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (samples[mid].elapsed <= time) low = mid;
      else high = mid;
    }
    const left = samples[low];
    const right = samples[high];
    const span = right.elapsed - left.elapsed;
    const ratio = span > 0 ? (time - left.elapsed) / span : 0;
    const mix = (a, b) => (a === null || b === null ? a : a + (b - a) * ratio);
    return {
      lat: mix(left.lat, right.lat),
      lon: mix(left.lon, right.lon),
      lapDistance: mix(left.lapDistance, right.lapDistance),
      speedKph: mix(left.speedKph, right.speedKph),
    };
  }

  function replayDuration() {
    const current = state.current;
    return Math.max(...current.comparisons.filter((entry) => !state.hiddenLaps.has(entry.lap.id)).map((entry) => entry.lap.lapTime), 0);
  }

  function updateReplayButton() {
    els.replayButton.textContent = state.replay.playing ? "❚❚ Pause" : state.replay.active ? "▶ Resume" : "▶ Replay";
    els.replayButton.setAttribute("aria-pressed", String(state.replay.playing));
  }

  function stopReplay() {
    state.replay.playing = false;
    state.replay.active = false;
    state.replay.time = 0;
    if (state.replay.frame) window.cancelAnimationFrame(state.replay.frame);
    state.replay.frame = null;
    if (els.replayClock) els.replayClock.hidden = true;
    if (els.replayButton) updateReplayButton();
  }

  function toggleReplay() {
    if (!state.current) return;
    const replay = state.replay;
    if (replay.playing) {
      replay.playing = false;
      updateReplayButton();
      return;
    }
    if (!replay.active || replay.time >= replayDuration()) replay.time = 0;
    replay.active = true;
    replay.playing = true;
    replay.last = null;
    updateReplayButton();
    const step = (timestamp) => {
      if (!replay.playing) return;
      if (replay.last !== null) replay.time += ((timestamp - replay.last) / 1000) * replay.speed;
      replay.last = timestamp;
      const duration = replayDuration();
      if (replay.time >= duration) {
        replay.time = duration;
        replay.playing = false;
      }
      showReplayFrame();
      updateReplayButton();
      if (replay.playing) replay.frame = window.requestAnimationFrame(step);
    };
    replay.frame = window.requestAnimationFrame(step);
  }

  function showReplayFrame() {
    const current = state.current;
    const time = state.replay.time;
    const reference = current.reference;
    const refPosition = lapPositionAt(reference, time);
    const index = Math.max(0, Math.min(GRID_POINTS, Math.round((refPosition.lapDistance / reference.distance) * GRID_POINTS)));
    setCursor(index, false);
    let gap = "";
    if (current.compare.id !== reference.id) {
      if (time >= reference.lapTime && time >= current.compare.lapTime) {
        gap = `Finished ${formatSigned(current.compare.lapTime - reference.lapTime)} s`;
      } else {
        // Same measure as the delta chart: how much later the compare lap
        // reaches the point the reference lap is at right now.
        const delta = focusEntry(current).delta[index].y;
        gap = Math.abs(delta) < 0.005 ? "Dead even" : `Compare ${Math.abs(delta).toFixed(2)} s ${delta > 0 ? "behind" : "ahead"}`;
      }
    }
    els.replayClock.hidden = false;
    els.replayClock.innerHTML = `<b>${formatTime(time)}</b>${gap ? `<span>${gap}</span>` : ""}`;
  }

  function updateCursorMarkers() {
    if (!state.map) return;
    state.cursorMarkers.forEach(({ marker, entry }) => {
      let point = null;
      if (state.replay.active) point = lapPositionAt(entry.lap, state.replay.time);
      else if (state.cursorIndex !== null) point = entry.points[state.cursorIndex];
      if (!point || point.lat === null) {
        marker.remove();
        return;
      }
      marker.setLatLng([point.lat, point.lon]);
      if (!state.map.hasLayer(marker)) marker.addTo(state.map);
    });
  }

  function resizeVisuals() {
    window.requestAnimationFrame(() => {
      Object.values(state.charts).forEach((chart) => chart.resize());
      if (state.map) {
        state.map.invalidateSize();
        fitMap();
      }
    });
  }

  function setExpandedPanel(panel) {
    if (state.expandedPanel) {
      const previousButton = state.expandedPanel.querySelector(".telemetry-expand");
      state.expandedPanel.classList.remove("is-expanded");
      if (previousButton) {
        previousButton.textContent = "⛶";
        previousButton.setAttribute("aria-label", "Expand panel");
        previousButton.setAttribute("aria-pressed", "false");
      }
      state.expandedPanel = null;
      document.body.classList.remove("telemetry-panel-open");
    }

    if (panel) {
      const button = panel.querySelector(".telemetry-expand");
      state.expandedPanel = panel;
      panel.classList.add("is-expanded");
      document.body.classList.add("telemetry-panel-open");
      if (button) {
        button.textContent = "×";
        button.setAttribute("aria-label", "Close expanded panel");
        button.setAttribute("aria-pressed", "true");
      }
    }
    resizeVisuals();
  }

  function setupExpandablePanels() {
    document.querySelectorAll(".telemetry-panel").forEach((panel) => {
      const button = document.createElement("button");
      button.className = "telemetry-expand";
      button.type = "button";
      button.textContent = "⛶";
      button.setAttribute("aria-label", "Expand panel");
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        setExpandedPanel(panel.classList.contains("is-expanded") ? null : panel);
      });
      panel.appendChild(button);
      panel.addEventListener(
        "click",
        (event) => {
          if (
            state.expandedPanel ||
            performance.now() < state.suppressClickUntil ||
            event.target.closest("button, a, select, input, label, tr, canvas, #telemetry-map, .telemetry-map-tools")
          )
            return;
          setExpandedPanel(panel);
        },
        true
      );
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.expandedPanel) setExpandedPanel(null);
    });
  }

  // ---- Derived channels: line offset and grip usage ------------------------

  CHANNEL_BY_KEY.lineOffset = { key: "lineOffset", label: "Line offset vs reference", unit: "m", digits: 1 };
  CHANNEL_BY_KEY.gripUse = { key: "gripUse", label: "Grip used", unit: "%", digits: 0 };
  CHANNEL_BY_KEY.combinedG = { key: "combinedG", label: "Combined G", unit: "G", digits: 2 };

  function localProjector(lat0, lon0) {
    const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
    const ky = 110540;
    return (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky];
  }

  // Signed distance (m) from each grid point of `entry` to the reference line:
  // positive = left of the reference's direction of travel, negative = right.
  function lineOffsets(entry, refEntry, project) {
    const ref = refEntry.points.map((point) => (point.lat === null ? null : project(point.lat, point.lon)));
    const n = ref.length;
    const window = Math.max(40, Math.round(n * 0.06));
    return entry.points.map((point, i) => {
      if (point.lat === null) return null;
      const p = project(point.lat, point.lon);
      let best = null;
      for (let j = Math.max(0, i - window); j < Math.min(n - 1, i + window); j += 1) {
        const a = ref[j];
        const b = ref[j + 1];
        if (!a || !b) continue;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const length2 = dx * dx + dy * dy;
        const t = length2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0;
        const qx = a[0] + t * dx;
        const qy = a[1] + t * dy;
        const distance = Math.hypot(p[0] - qx, p[1] - qy);
        if (!best || distance < best.distance) {
          const side = dx * (p[1] - a[1]) - dy * (p[0] - a[0]);
          best = { distance, signed: side >= 0 ? distance : -distance };
        }
      }
      return best && best.distance < 30 ? best.signed : null;
    });
  }

  function percentile(values, q) {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (!sorted.length) return null;
    return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
  }

  // Adds derived per-point channels to the comparison and returns their keys.
  function addDerivedChannels(current) {
    const derived = [];
    const ref = refEntry(current);
    const first = ref.points.find((point) => point.lat !== null);
    if (first && current.comparisons.length > 1) {
      const project = localProjector(first.lat, first.lon);
      current.comparisons.forEach((entry) => {
        const offsets = entry === ref ? entry.points.map((point) => (point.lat === null ? null : 0)) : lineOffsets(entry, ref, project);
        entry.points.forEach((point, i) => {
          point.ch.lineOffset = offsets[i];
        });
        entry.derived = (entry.derived || []).concat("lineOffset");
      });
      derived.push("lineOffset");
    }
    if (current.group.channels.includes("latG") && current.group.channels.includes("longG")) {
      // "Available grip" = what the car showed it can do this session: the 98th
      // percentile of combined G across all laps on this track.
      const all = [];
      current.comparisons.forEach((entry) =>
        entry.points.forEach((point) => {
          const { latG, longG } = point.ch;
          point.ch.combinedG = latG === null || longG === null || latG === undefined || longG === undefined ? null : Math.hypot(latG, longG);
          all.push(point.ch.combinedG);
        })
      );
      const envelope = percentile(all, 0.98);
      current.gripEnvelope = envelope;
      if (envelope && envelope > 0.2) {
        current.comparisons.forEach((entry) => {
          entry.points.forEach((point) => {
            point.ch.gripUse = point.ch.combinedG === null ? null : Math.min(120, (point.ch.combinedG / envelope) * 100);
          });
          entry.derived = (entry.derived || []).concat("combinedG", "gripUse");
        });
        derived.push("gripUse", "combinedG");
      }
    }
    return derived;
  }

  // Line and grip numbers for one lap through one corner zone.
  function cornerExtras(entry, zone, apexIndex) {
    const { points } = entry;
    const window = Math.max(2, Math.round((zone.end - zone.start) * 0.05));
    const offsets = [];
    for (let i = Math.max(zone.start, apexIndex - window); i <= Math.min(zone.end, apexIndex + window); i += 1) {
      if (points[i].ch.lineOffset !== null && points[i].ch.lineOffset !== undefined) offsets.push(points[i].ch.lineOffset);
    }
    let gripTotal = 0;
    let gripCount = 0;
    let peakG = 0;
    for (let i = zone.start; i <= zone.end; i += 1) {
      const { gripUse, combinedG } = points[i].ch;
      if (combinedG !== null && combinedG !== undefined) peakG = Math.max(peakG, combinedG);
      // Only the loaded part of the corner (braking + turning), not the straight.
      if (gripUse !== null && gripUse !== undefined && combinedG > 0.25) {
        gripTotal += gripUse;
        gripCount += 1;
      }
    }
    return {
      apexOffset: offsets.length ? offsets.reduce((sum, value) => sum + value, 0) / offsets.length : null,
      grip: gripCount ? gripTotal / gripCount : null,
      peakG: peakG || null,
    };
  }

  // +1 for a left-hand corner, -1 for a right-hander, from the reference line.
  function cornerDirection(refEntry, zone) {
    const at = (i) => refEntry.points[Math.max(0, Math.min(refEntry.points.length - 1, i))];
    const span = Math.max(3, Math.round((zone.end - zone.start) / 4));
    const a = at(zone.apex - span);
    const b = at(zone.apex);
    const c = at(zone.apex + span);
    if (a.lat === null || b.lat === null || c.lat === null) return 0;
    const project = localProjector(b.lat, b.lon);
    const [ax, ay] = project(a.lat, a.lon);
    const [cx, cy] = project(c.lat, c.lon);
    const cross = -ax * (cy - 0) + ay * cx; // (b - a) x (c - b) with b at the origin
    return cross > 0 ? 1 : cross < 0 ? -1 : 0;
  }

  // "1.8 m wider" / "1.2 m tighter" for the coached lap at the apex.
  function lineText(row) {
    if (row.cmpExtra.apexOffset === null || row.direction === 0) return "–";
    const inside = row.cmpExtra.apexOffset * row.direction;
    if (Math.abs(inside) < 0.5) return "same";
    return `${Math.abs(inside).toFixed(1)} m ${inside > 0 ? "tighter" : "wider"}`;
  }

  // ---- Corners -------------------------------------------------------------

  function cornerZones(current) {
    const reference = current.comparisons.find((entry) => entry.lap.id === current.reference.id);
    const step = current.xs[1] - current.xs[0];
    const points = reference.points.map((point) => ({ ...point, distance: point.x }));
    const { markers, smoothed } = speedExtrema(points, current.reference.distance, step, 30);
    const apexes = markers.filter((marker) => marker.kind === "corner").map((marker) => marker.index);
    const argmax = (from, to) => {
      let best = from;
      for (let i = from; i <= to; i += 1) if (smoothed[i] > smoothed[best]) best = i;
      return best;
    };
    // A "corner" with no speed recovery after it is the car slowing past the
    // finish line, not a corner.
    return apexes
      .map((apex, n) => ({
        apex,
        start: argmax(n === 0 ? 0 : apexes[n - 1], apex),
        end: argmax(apex, n === apexes.length - 1 ? smoothed.length - 1 : apexes[n + 1]),
      }))
      .filter((zone) => zone.end - zone.apex > 2 && zone.apex - zone.start > 2)
      .map((zone, n) => ({ ...zone, number: n + 1 }));
  }

  function cornerMetrics(entry, zone, channels) {
    const { points } = entry;
    let apex = zone.start;
    for (let i = zone.start; i <= zone.end; i += 1) if (points[i].speed < points[apex].speed) apex = i;
    let brake = null;
    const useG = channels.includes("longG");
    const usePressure = channels.includes("brake");
    if (useG || usePressure) {
      for (let i = zone.start; i <= apex; i += 1) {
        const pressure = points[i].ch.brake;
        const longG = points[i].ch.longG;
        if ((usePressure && pressure !== null && pressure > 5) || (!usePressure && longG !== null && longG <= -0.25)) {
          brake = i;
          break;
        }
      }
    }
    // Throttle pickup after the apex, coasting (neither pedal), and driver aids.
    const hasPedals = channels.includes("throttle") && channels.includes("brake");
    let throttleIndex = null;
    if (channels.includes("throttle")) {
      for (let i = apex; i <= zone.end; i += 1) {
        if ((points[i].ch.throttle || 0) > 20) {
          throttleIndex = i;
          break;
        }
      }
    }
    let coast = 0;
    let abs = false;
    let eds = false;
    let peakBrake = 0;
    let lockTotal = 0;
    let lockCount = 0;
    for (let i = zone.start; i <= zone.end; i += 1) {
      const { ch } = points[i];
      if (hasPedals && (ch.throttle || 0) < 5 && (ch.brake || 0) < 3 && i > zone.start) coast += points[i].x - points[i - 1].x;
      if (ch.abs) abs = true;
      if (ch.eds) eds = true;
      if (i <= apex) peakBrake = Math.max(peakBrake, usePressure ? ch.brake || 0 : -(ch.longG || 0));
      if (i >= apex && ch.lock !== undefined && ch.lock !== null) {
        lockTotal += ch.lock;
        lockCount += 1;
      }
    }
    return {
      apexIndex: apex,
      apexX: points[apex].x,
      entrySpeed: points[zone.start].speed,
      minSpeed: points[apex].speed,
      exitSpeed: points[zone.end].speed,
      time: points[zone.end].time - points[zone.start].time,
      brakeX: brake === null ? null : points[brake].x,
      throttleX: throttleIndex === null ? null : points[throttleIndex].x,
      coast: hasPedals ? coast : null,
      abs,
      eds,
      peakBrake: useG || usePressure ? peakBrake : null,
      exitLock: lockCount ? lockTotal / lockCount : null,
    };
  }

  const gripText = (value) => (value === null ? "–" : `${value.toFixed(0)}%`);

  function updateCorners(current) {
    const zones = cornerZones(current);
    current.corners = zones;
    const reference = current.comparisons.find((entry) => entry.lap.id === current.reference.id);
    const compare = current.comparisons.find((entry) => entry.lap.id === current.compare.id);
    const channels = current.group.channels;
    const same = reference === compare;
    els.cornerCompare.textContent = same ? `Reference: ${current.reference.label}` : `${current.compare.label} vs ${current.reference.label}`;
    current.cornerRows = [];
    if (!zones.length) {
      els.cornerBody.innerHTML = `<tr><td colspan="9">No clear corners found in the reference lap.</td></tr>`;
      els.cornerSummary.textContent = "";
      return;
    }
    const rows = zones.map((zone) => {
      const ref = cornerMetrics(reference, zone, channels);
      const cmp = cornerMetrics(compare, zone, channels);
      return {
        zone,
        ref,
        cmp,
        dt: cmp.time - ref.time,
        direction: cornerDirection(reference, zone),
        refExtra: cornerExtras(reference, zone, ref.apexIndex),
        cmpExtra: cornerExtras(compare, zone, cmp.apexIndex),
      };
    });
    const worst = rows
      .filter((row) => row.dt > 0.02)
      .sort((a, b) => b.dt - a.dt)
      .slice(0, 3);
    rows.forEach((row) => {
      row.worst = !same && worst.includes(row);
    });
    current.cornerRows = rows;
    const cellClass = (value, threshold) => (value > threshold ? "is-loss" : value < -threshold ? "is-gain" : "");
    els.cornerBody.innerHTML = rows
      .map((row) => {
        const { zone, ref, cmp, dt } = row;
        const brakeDelta = ref.brakeX !== null && cmp.brakeX !== null ? cmp.brakeX - ref.brakeX : null;
        const brakeText =
          brakeDelta === null
            ? "–"
            : Math.abs(brakeDelta) < 1
              ? "same"
              : `${Math.abs(brakeDelta).toFixed(0)} m ${brakeDelta > 0 ? "later" : "earlier"}`;
        return `<tr data-index="${zone.apex}" class="${worst.includes(row) ? "is-worst" : ""}">
          <td>T${zone.number} <small>${Math.round(current.xs[zone.apex])} m</small></td>
          <td>${ref.minSpeed.toFixed(1)}</td>
          <td>${same ? "–" : cmp.minSpeed.toFixed(1)}</td>
          <td class="${same ? "" : cellClass(-(cmp.minSpeed - ref.minSpeed), 1)}">${same ? "–" : formatSigned(cmp.minSpeed - ref.minSpeed, 1)}</td>
          <td class="${same ? "" : cellClass(-(cmp.exitSpeed - ref.exitSpeed), 1)}">${same ? "–" : formatSigned(cmp.exitSpeed - ref.exitSpeed, 1)}</td>
          <td>${same ? (ref.brakeX === null ? "–" : `${Math.round(current.xs[zone.apex] - ref.brakeX)} m before apex`) : brakeText}</td>
          <td>${same ? "–" : lineText(row)}</td>
          <td>${gripText(row.refExtra.grip)}${same ? "" : ` / ${gripText(row.cmpExtra.grip)}`}</td>
          <td class="${same ? "" : cellClass(dt, 0.02)}">${same ? ref.time.toFixed(2) : formatSigned(dt)}</td>
        </tr>`;
      })
      .join("");
    els.cornerTimeHeading.textContent = same ? "Time (s)" : "Time Δ (s)";
    if (same) els.cornerSummary.textContent = "Load another lap and pick it as the compare lap to see where time is gained or lost.";
    else {
      const total = rows.reduce((sum, row) => sum + row.dt, 0);
      els.cornerSummary.innerHTML = `${escapeHtml(current.compare.label)} is <strong>${formatSigned(total)} s</strong> through the corners. ${
        worst.length
          ? `Biggest losses: ${worst.map((row) => `T${row.zone.number} (${formatSigned(row.dt, 2)} s)`).join(", ")}.`
          : "No corner loses more than 0.02 s."
      }`;
    }
  }

  // ---- Coach ---------------------------------------------------------------

  const COACH_URL = "https://car-duel-proxy.car-duel-proxy.workers.dev/coach";

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const meters = (value) => `${Math.abs(value).toFixed(0)} m`;
  const kph = (value) => `${Math.abs(value).toFixed(0)} km/h`;

  // Rule-based tips for one corner: the compare lap ("you") against the
  // reference ("your best"). Returns the single most useful tip, or null.
  function cornerTip(row, channels) {
    const { ref, cmp, dt, zone } = row;
    const name = `T${zone.number}`;
    const minDiff = cmp.minSpeed - ref.minSpeed;
    const exitDiff = cmp.exitSpeed - ref.exitSpeed;
    const brakeDiff = ref.brakeX !== null && cmp.brakeX !== null ? cmp.brakeX - ref.brakeX : null;
    const throttleDiff = ref.throttleX !== null && cmp.throttleX !== null ? cmp.throttleX - cmp.apexX - (ref.throttleX - ref.apexX) : null;
    const coastDiff = ref.coast !== null && cmp.coast !== null ? cmp.coast - ref.coast : null;
    const tips = [];

    if (cmp.abs && !ref.abs) {
      tips.push({
        weight: 3,
        title: "ABS is working here",
        detail: `ABS triggered in ${name} on this lap but not on your best. You're asking for more brake than the tyres have. Brake a little earlier or build pressure more smoothly.`,
      });
    }
    if (brakeDiff !== null && brakeDiff > 5 && minDiff < -2) {
      tips.push({
        weight: 3,
        title: "Overdriving the entry",
        detail: `You brake ${meters(brakeDiff)} later than your best lap but are ${kph(minDiff)} slower at the apex${
          exitDiff < -2 ? ` and ${kph(exitDiff)} slower on exit` : ""
        }. The late braking costs more than it gains. Brake a touch earlier and focus on rolling speed to the apex.`,
      });
    } else if (brakeDiff !== null && brakeDiff < -5 && minDiff > -2) {
      tips.push({
        weight: 2.5,
        title: "Braking too early",
        detail: `You start braking ${meters(brakeDiff)} earlier than your best lap without carrying more speed through the corner. Move your brake point later.`,
      });
    }
    if (minDiff < -3 && (brakeDiff === null || Math.abs(brakeDiff) <= 5)) {
      tips.push({
        weight: 2,
        title: "Carry more apex speed",
        detail: `Your minimum speed is ${kph(minDiff)} lower than your best lap (${cmp.minSpeed.toFixed(0)} vs ${ref.minSpeed.toFixed(
          0
        )} km/h) with a similar brake point. Release the brake earlier and let the car roll in.`,
      });
    }
    if (throttleDiff !== null && throttleDiff > 8) {
      tips.push({
        weight: 2,
        title: "Late on the throttle",
        detail: `You pick up throttle ${meters(throttleDiff)} later after the apex than your best lap${
          exitDiff < -2 ? `, and leave the corner ${kph(exitDiff)} slower` : ""
        }. Commit to throttle earlier.`,
      });
    } else if (exitDiff < -4 && minDiff > 2) {
      tips.push({
        weight: 2.2,
        title: "In fast, out slow",
        detail: `You're ${kph(minDiff)} faster at the apex than your best lap but exit ${kph(
          exitDiff
        )} slower. The extra entry speed is costing you the exit. Give up a little entry speed to get the car turned and back on throttle sooner.`,
      });
    } else if (exitDiff < -4 && minDiff > -2) {
      tips.push({
        weight: 1.8,
        title: "Slow exit",
        detail: `Apex speed is fine, but you exit ${kph(exitDiff)} slower than your best lap. Straighten the wheel sooner and get to full throttle earlier.`,
      });
    }
    if (coastDiff !== null && coastDiff > 15) {
      tips.push({
        weight: 1.5,
        title: "Coasting",
        detail: `You spend ${meters(cmp.coast)} on neither pedal here, ${meters(coastDiff)} more than your best lap. Blend brake release straight into throttle.`,
      });
    }
    if (cmp.exitLock !== null && ref.exitLock !== null && ref.exitLock - cmp.exitLock > 15 && exitDiff < -2) {
      tips.push({
        weight: 1.2,
        title: "Less AWD on exit",
        detail: `Haldex lock averaged ${cmp.exitLock.toFixed(0)}% on exit vs ${ref.exitLock.toFixed(
          0
        )}% on your best lap. Less rear drive here lines up with the slower exit, so check the mode and throttle you used.`,
      });
    }
    if (row.cmpExtra && row.cmpExtra.grip !== null && row.refExtra.grip !== null && row.refExtra.grip - row.cmpExtra.grip > 8) {
      tips.push({
        weight: 1.7,
        title: "Grip left unused",
        detail: `You used ${row.cmpExtra.grip.toFixed(0)}% of the available grip through ${name}, against ${row.refExtra.grip.toFixed(
          0
        )}% on your best lap. The car can take more load here: brake harder or carry more speed.`,
      });
    }
    if (row.direction && row.cmpExtra && row.cmpExtra.apexOffset !== null) {
      const inside = row.cmpExtra.apexOffset * row.direction;
      if (Math.abs(inside) >= 1.5 && (minDiff < -1 || exitDiff < -2)) {
        tips.push({
          weight: 1.6,
          title: inside > 0 ? "Apex too tight" : "Missing the apex",
          detail:
            inside > 0
              ? `You're about ${Math.abs(inside).toFixed(1)} m tighter than your best line at the apex, which tightens the corner and costs exit speed. Turn in a little later and use more track on entry.`
              : `You're about ${Math.abs(inside).toFixed(1)} m wide of your best line at the apex. Get closer to the inside so you can straighten the wheel and use the exit sooner.`,
        });
      }
    }
    if (!tips.length) {
      const parts = [];
      if (Math.abs(minDiff) >= 1) parts.push(`apex ${formatSigned(minDiff, 0)} km/h`);
      if (Math.abs(exitDiff) >= 1) parts.push(`exit ${formatSigned(exitDiff, 0)} km/h`);
      if (brakeDiff !== null && Math.abs(brakeDiff) >= 3) parts.push(`braking ${meters(brakeDiff)} ${brakeDiff > 0 ? "later" : "earlier"}`);
      tips.push({
        weight: 1,
        title: "Time lost",
        detail: `No single clear cause. Compared with your best lap: ${parts.join(", ") || "very similar speeds"}. Check your line on the map.`,
      });
    }
    tips.sort((a, b) => b.weight - a.weight);
    return { ...tips[0], corner: name, zone, gain: dt };
  }

  function soloTips(rows) {
    const tips = [];
    rows.forEach((row) => {
      const name = `T${row.zone.number}`;
      if (row.ref.abs) {
        tips.push({
          corner: name,
          zone: row.zone,
          gain: null,
          title: "ABS triggered",
          detail: `ABS came on in ${name}. You're braking past the limit of grip.`,
        });
      }
      if (row.ref.coast !== null && row.ref.coast > 25) {
        tips.push({
          corner: name,
          zone: row.zone,
          gain: null,
          title: "Coasting",
          detail: `${meters(row.ref.coast)} on neither pedal through ${name}. Blend brake release straight into throttle.`,
        });
      }
    });
    return tips;
  }

  function buildCoach(current) {
    const rows = current.cornerRows || [];
    const same = current.compare.id === current.reference.id;
    const tips = same
      ? soloTips(rows)
      : rows
          .filter((row) => row.dt > 0.03)
          .sort((a, b) => b.dt - a.dt)
          .slice(0, 6)
          .map((row) => cornerTip(row, current.group.channels));
    const sectors = current.comparisons.map((entry) => sectorTimes(entry));
    const bestSectors = [0, 1, 2, 3].map((i) => Math.min(...sectors.map((s) => s[i])));
    const theoretical = bestSectors.reduce((sum, value) => sum + value, 0);
    const lostTotal = same ? 0 : rows.reduce((sum, row) => sum + Math.max(0, row.dt), 0);
    let headline;
    if (same) {
      headline =
        current.group.laps.length > 1
          ? "Pick a different compare lap to get corner-by-corner coaching against this one."
          : "Load a second lap (ideally a faster one) to get corner-by-corner coaching.";
    } else {
      headline = `${escapeHtml(current.compare.label)} is ${formatSigned(current.compare.lapTime - current.reference.lapTime, 2)} s off ${escapeHtml(
        current.reference.label
      )}. ${lostTotal > 0.05 ? `About ${lostTotal.toFixed(2)} s of that is lost in the corners below.` : ""}`;
    }
    const fastest = Math.min(...current.group.laps.map((lap) => lap.lapTime));
    if (current.group.laps.length > 1 && fastest - theoretical > 0.05) {
      headline += ` Your best four sectors add up to ${formatTime(theoretical)}, ${(fastest - theoretical).toFixed(2)} s quicker than your fastest lap.`;
    }
    return { tips, headline };
  }

  function updateCoach(current) {
    const { tips, headline } = buildCoach(current);
    current.coach = { tips, headline };
    els.coachHeadline.innerHTML = headline;
    els.coachTips.innerHTML = tips.length
      ? tips
          .map(
            (tip) => `<li data-apex="${tip.zone ? tip.zone.apex : ""}">
          <span class="telemetry-coach-corner">${tip.corner}</span>
          <div><strong>${escapeHtml(tip.title)}</strong>${tip.gain !== null ? ` <em>${formatSigned(tip.gain, 2)} s</em>` : ""}<p>${escapeHtml(
            tip.detail
          )}</p></div>
        </li>`
          )
          .join("")
      : `<li class="is-empty">Nothing stands out. Load or pick another lap to compare against.</li>`;
    resetCoachChat();
  }

  // Compact text summary of the comparison for the AI coach. Only these
  // numbers leave the browser, never the raw log.
  function coachSummary(current) {
    const { reference, compare, group } = current;
    const channels = group.channels.map((key) => CHANNEL_BY_KEY[key].label).join(", ") || "GPS speed only";
    const lines = [
      `Track length about ${Math.round(reference.distance)} m. Channels logged: ${channels}.`,
      `Reference (best) lap: ${reference.label}, ${formatTime(reference.lapTime)}.`,
      `Coached lap: ${compare.label}, ${formatTime(compare.lapTime)}${compare.id === reference.id ? " (same as reference)" : ""}.`,
      `Other laps: ${
        group.laps
          .filter((lap) => lap.id !== reference.id && lap.id !== compare.id)
          .map((lap) => formatTime(lap.lapTime))
          .join(", ") || "none"
      }.`,
      "",
      "Corners (distance of apex along the lap; ref = reference lap, you = coached lap):",
    ];
    (current.cornerRows || []).forEach((row) => {
      const f = (metrics, extra) =>
        [
          `entry ${metrics.entrySpeed.toFixed(0)}`,
          `min ${metrics.minSpeed.toFixed(0)}`,
          `exit ${metrics.exitSpeed.toFixed(0)} km/h`,
          metrics.brakeX !== null ? `brakes ${Math.round(metrics.apexX - metrics.brakeX)} m before apex` : null,
          metrics.peakBrake !== null && metrics.peakBrake > 0
            ? group.channels.includes("brake")
              ? `peak brake ${metrics.peakBrake.toFixed(0)} bar`
              : `peak decel ${metrics.peakBrake.toFixed(2)} G`
            : null,
          metrics.throttleX !== null ? `throttle ${Math.round(metrics.throttleX - metrics.apexX)} m after apex` : null,
          metrics.coast !== null ? `coasting ${Math.round(metrics.coast)} m` : null,
          metrics.abs ? "ABS active" : null,
          metrics.eds ? "EDS/XDS active" : null,
          metrics.exitLock !== null ? `Haldex lock on exit ${metrics.exitLock.toFixed(0)}%` : null,
          `time in corner ${metrics.time.toFixed(2)} s`,
          extra && extra.grip !== null ? `grip used ${extra.grip.toFixed(0)}%` : null,
          extra && extra.peakG ? `peak ${extra.peakG.toFixed(2)} G` : null,
        ]
          .filter(Boolean)
          .join(", ");
      lines.push(`T${row.zone.number} at ${Math.round(current.xs[row.zone.apex])} m:`);
      lines.push(`  ref: ${f(row.ref, row.refExtra)}`);
      if (compare.id !== reference.id) {
        const line = lineText(row);
        lines.push(
          `  you: ${f(row.cmp, row.cmpExtra)}; line at apex vs ref: ${line === "–" ? "unknown" : line}; time vs ref ${formatSigned(row.dt, 2)} s`
        );
      }
    });
    if (current.coach && current.coach.tips.length) {
      lines.push("", "Automatic tips already shown to the driver:");
      current.coach.tips.forEach((tip) => lines.push(`- ${tip.corner} ${tip.title}: ${tip.detail}`));
    }
    return lines.join("\n").slice(0, 12000);
  }

  function formatCoachText(text) {
    return escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .split(/\n{2,}/)
      .map((block) => {
        const items = block.split("\n");
        if (items.every((item) => /^\s*([-*•]|\d+\.)\s+/.test(item))) {
          return `<ul>${items.map((item) => `<li>${item.replace(/^\s*([-*•]|\d+\.)\s+/, "")}</li>`).join("")}</ul>`;
        }
        return `<p>${items.join("<br>")}</p>`;
      })
      .join("");
  }

  function renderCoachChat() {
    els.coachChat.innerHTML = state.coachChat
      .map((message, index) =>
        index === 0 && message.role === "user"
          ? ""
          : `<div class="telemetry-coach-msg is-${message.role}">${message.role === "assistant" ? formatCoachText(message.content) : escapeHtml(message.content)}</div>`
      )
      .join("");
    els.coachChat.hidden = !state.coachChat.length;
  }

  function resetCoachChat() {
    state.coachChat = [];
    state.coachBusy = false;
    if (!els.coachChat) return;
    renderCoachChat();
    els.coachForm.hidden = true;
    els.coachAsk.hidden = false;
    els.coachAsk.disabled = false;
    els.coachStatus.textContent = "";
  }

  async function askCoach(question) {
    const current = state.current;
    if (!current || state.coachBusy) return;
    if (!state.coachChat.length) {
      state.coachChat.push({
        role: "user",
        content: "Give me a short debrief of this lap: the 2 or 3 changes that would gain the most time, in order.",
      });
    } else if (question) {
      state.coachChat.push({ role: "user", content: question.slice(0, 1500) });
    } else return;
    renderCoachChat();
    state.coachBusy = true;
    els.coachAsk.disabled = true;
    els.coachSend.disabled = true;
    els.coachStatus.textContent = "Coach is thinking…";
    try {
      const response = await fetch(COACH_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summary: coachSummary(current), messages: state.coachChat.slice(-12) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.text) throw new Error((data.error && data.error.message) || `Coach unavailable (${response.status}).`);
      state.coachChat.push({ role: "assistant", content: data.text });
      els.coachStatus.textContent = "";
      els.coachAsk.hidden = true;
      els.coachForm.hidden = false;
    } catch (error) {
      state.coachChat.pop();
      els.coachStatus.textContent = error.message || "The AI coach could not be reached.";
      els.coachAsk.disabled = false;
    } finally {
      state.coachBusy = false;
      els.coachSend.disabled = false;
      renderCoachChat();
    }
  }

  // ---- Printable report ----------------------------------------------------

  function trackSvg(current) {
    const ref = refEntry(current);
    const cmp = focusEntry(current);
    const first = ref.points.find((point) => point.lat !== null);
    if (!first) return "";
    const project = localProjector(first.lat, first.lon);
    const toXY = (entry) => entry.points.map((point) => (point.lat === null ? null : project(point.lat, point.lon)));
    const refXY = toXY(ref);
    const cmpXY = cmp === ref ? refXY : toXY(cmp);
    const all = refXY.concat(cmpXY).filter(Boolean);
    const minX = Math.min(...all.map((p) => p[0]));
    const maxX = Math.max(...all.map((p) => p[0]));
    const minY = Math.min(...all.map((p) => p[1]));
    const maxY = Math.max(...all.map((p) => p[1]));
    const width = 640;
    const height = 380;
    const pad = 24;
    const scale = Math.min((width - 2 * pad) / Math.max(1, maxX - minX), (height - 2 * pad) / Math.max(1, maxY - minY));
    const offsetX = (width - (maxX - minX) * scale) / 2;
    const offsetY = (height - (maxY - minY) * scale) / 2;
    const sx = (p) => (offsetX + (p[0] - minX) * scale).toFixed(1);
    const sy = (p) => (height - offsetY - (p[1] - minY) * scale).toFixed(1);
    const path = (points) =>
      points
        .filter(Boolean)
        .map((p, i) => `${i ? "L" : "M"}${sx(p)} ${sy(p)}`)
        .join(" ");
    let body = `<path d="${path(refXY)}" fill="none" stroke="#999" stroke-width="2" stroke-dasharray="5 4"/>`;
    if (cmp !== ref) {
      const rates = gainRates(cmp, current.xs);
      let run = null;
      const segments = [];
      cmpXY.forEach((p, i) => {
        if (!p) return;
        const color = GAIN_COLORS[gainBucket(rates[i])];
        if (run && run.color === color) run.points.push(p);
        else {
          const previous = run ? run.points[run.points.length - 1] : null;
          if (run) segments.push(run);
          run = { color, points: previous ? [previous, p] : [p] };
        }
      });
      if (run) segments.push(run);
      body += segments
        .map((segment) => `<path d="${path(segment.points)}" fill="none" stroke="${segment.color}" stroke-width="5" stroke-linecap="round"/>`)
        .join("");
    }
    (current.cornerRows || []).forEach((row) => {
      const p = refXY[row.zone.apex];
      if (!p) return;
      body += `<g transform="translate(${sx(p)} ${sy(p)})"><circle r="10" fill="${row.worst ? "#d73027" : "#fff"}" stroke="#222" stroke-width="1.5"/><text text-anchor="middle" dy="3.5" font-size="9" font-weight="800" fill="${
        row.worst ? "#fff" : "#222"
      }">T${row.zone.number}</text></g>`;
    });
    const start = refXY.find(Boolean);
    if (start)
      body += `<circle cx="${sx(start)}" cy="${sy(start)}" r="5" fill="#111"/><text x="${sx(start)}" y="${Number(sy(start)) - 9}" text-anchor="middle" font-size="10" font-weight="700">Start</text>`;
    return `<svg viewBox="0 0 ${width} ${height}" class="telemetry-report-track" role="img" aria-label="Track map">${body}</svg>`;
  }

  function chartImage(name, title) {
    const chart = state.charts[name];
    if (!chart) return "";
    return `<figure><figcaption>${escapeHtml(title)}</figcaption><img src="${chart.toBase64Image("image/png", 1)}" alt="${escapeHtml(title)}"></figure>`;
  }

  function buildReport() {
    const current = state.current;
    if (!current) return;
    const { group, reference, compare } = current;
    const fastest = Math.min(...group.laps.map((lap) => lap.lapTime));
    const lapRows = current.comparisons
      .slice()
      .sort((a, b) => a.badge - b.badge)
      .map((entry) => {
        const role = entry.lap.id === reference.id ? "reference" : entry.lap.id === compare.id ? "coached lap" : "";
        return `<tr><td>${lapBadgeHtml(entry)}</td><td>${escapeHtml(entry.lap.label)}${role ? ` <small>(${role})</small>` : ""}</td><td>${formatTime(
          entry.lap.lapTime
        )}</td><td>${entry.lap.lapTime === fastest ? "best" : `+${(entry.lap.lapTime - fastest).toFixed(3)}`}</td></tr>`;
      })
      .join("");
    const coach = current.coach || { tips: [], headline: "" };
    const tips = coach.tips
      .map(
        (tip) =>
          `<li><b>${tip.corner} · ${escapeHtml(tip.title)}</b>${tip.gain !== null ? ` <em>${formatSigned(tip.gain, 2)} s</em>` : ""}<br>${escapeHtml(tip.detail)}</li>`
      )
      .join("");
    const debrief = state.coachChat.filter((message) => message.role === "assistant");
    const cornerTable = document.querySelector(".telemetry-corner-table");
    const generated = new Date().toLocaleString();
    return `
      <header>
        <p class="telemetry-kicker">LAP REPORT</p>
        <h1>${escapeHtml(group.name === "Loaded session" ? reference.filename.replace(/\.(csv|vbo)$/i, "") : group.name)}</h1>
        <p>${plural(group.laps.length, "lap")} · best ${formatTime(fastest)} · coached lap ${escapeHtml(compare.label)} vs reference ${escapeHtml(
          reference.label
        )} · generated ${escapeHtml(generated)}</p>
      </header>
      <section class="telemetry-report-row">
        <div>
          <h2>Laps</h2>
          <table class="telemetry-table"><thead><tr><th>#</th><th>Lap</th><th>Time</th><th>Gap</th></tr></thead><tbody>${lapRows}</tbody></table>
        </div>
        <div>
          <h2>Track${compare.id !== reference.id ? " · green gaining, red losing" : ""}</h2>
          ${trackSvg(current)}
        </div>
      </section>
      <section>
        <h2>Coach</h2>
        <p>${coach.headline}</p>
        ${tips ? `<ol class="telemetry-report-tips">${tips}</ol>` : ""}
        ${debrief.length ? `<h3>AI coach debrief</h3>${debrief.map((message) => `<div class="telemetry-report-debrief">${formatCoachText(message.content)}</div>`).join("")}` : ""}
      </section>
      <section class="telemetry-report-charts">
        ${chartImage("speed", "Speed over distance (km/h)")}
        ${chartImage("delta", "Delta to reference (s)")}
      </section>
      ${cornerTable ? `<section><h2>Corner by corner</h2>${cornerTable.outerHTML}</section>` : ""}
      <footer>Made with the RaceChrono lap analyzer · tristar10.github.io/telemetry</footer>`;
  }

  const REPORT_CSS = `
    body { color: #171717; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 24px auto; max-width: 900px; padding: 0 16px; }
    h1 { font-size: 26px; letter-spacing: -0.02em; margin: 0 0 4px; }
    h2 { font-size: 15px; margin: 18px 0 8px; }
    h3 { font-size: 13px; margin: 12px 0 6px; }
    header p { color: #666; margin: 0; }
    .telemetry-kicker { color: #ef5b2a; font-size: 10px; font-weight: 800; letter-spacing: 0.16em; margin: 0 0 4px; }
    .telemetry-report-row { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); }
    .telemetry-report-track { border: 1px solid #ddd; border-radius: 6px; width: 100%; }
    .telemetry-table { border-collapse: collapse; font-size: 11px; width: 100%; }
    .telemetry-table th, .telemetry-table td { border-bottom: 1px solid #e5e5e5; padding: 5px 4px; text-align: right; white-space: nowrap; }
    .telemetry-table th:first-child, .telemetry-table td:first-child, .telemetry-table td:nth-child(2) { text-align: left; }
    .telemetry-table small { color: #888; }
    .is-loss { color: #d73027; font-weight: 700; } .is-gain { color: #1a9850; font-weight: 700; }
    .telemetry-lap-badge { align-items: center; background: var(--chip-color); border-radius: 50%; color: #fff; display: inline-flex; font-size: 10px; font-weight: 800; height: 18px; justify-content: center; width: 18px; }
    .telemetry-report-tips { padding-left: 18px; } .telemetry-report-tips li { margin-bottom: 6px; } .telemetry-report-tips em { color: #d73027; font-style: normal; font-weight: 700; }
    .telemetry-report-debrief { background: #fdf0eb; border-radius: 6px; padding: 8px 12px; }
    .telemetry-report-charts { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; margin-top: 14px; }
    figure { margin: 0; } figcaption { font-weight: 700; margin-bottom: 4px; } figure img { border: 1px solid #eee; width: 100%; }
    footer { border-top: 1px solid #ddd; color: #888; font-size: 11px; margin-top: 20px; padding-top: 8px; }
    .telemetry-report-actions { display: flex; gap: 8px; justify-content: flex-end; margin-bottom: 12px; }
    .telemetry-report-actions button { background: #ef5b2a; border: 0; border-radius: 6px; color: #fff; cursor: pointer; font: inherit; font-weight: 700; padding: 8px 14px; }
    section, tr, figure, svg { break-inside: avoid; }
    @media print { .telemetry-report-actions { display: none; } body { margin: 0; } }
    @media (max-width: 640px) { .telemetry-report-row, .telemetry-report-charts { grid-template-columns: 1fr; } }`;

  // Opens the report in its own tab; "Save as PDF" in the print dialog makes
  // a file that can be sent to anyone.
  function printReport() {
    if (!state.current) return;
    const html = buildReport();
    const tab = window.open("", "_blank");
    if (!tab) {
      setStatus("Allow pop-ups for this site to open the report.", true);
      return;
    }
    tab.document.open();
    tab.document.write(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lap report</title><style>${REPORT_CSS}</style></head><body><div class="telemetry-report-actions"><button type="button" onclick="window.print()">Save as PDF / Print</button></div>${html}</body></html>`
    );
    tab.document.close();
  }

  function sectorTimes(entry) {
    const points = entry.points;
    const maxDistance = points[points.length - 1].x;
    const boundaryTimes = [0];
    for (let sector = 1; sector <= 4; sector += 1) {
      const target = (maxDistance * sector) / 4;
      const point = points.reduce((best, current) => (Math.abs(current.x - target) < Math.abs(best.x - target) ? current : best));
      boundaryTimes.push(point.time);
    }
    return boundaryTimes.slice(1).map((time, index) => time - boundaryTimes[index]);
  }

  function updateSectors(comparisons, reference) {
    const entries = comparisons.map((entry) => ({ lap: entry.lap, sectors: sectorTimes(entry) }));
    const best = [0, 1, 2, 3].map((index) => Math.min(...entries.map((entry) => entry.sectors[index])));
    els.sectorBody.innerHTML = entries
      .map(
        (entry) => `
      <tr class="${entry.lap.id === reference.id ? "is-reference" : ""}">
        <td title="${escapeHtml(entry.lap.label)}">${escapeHtml(entry.lap.label)}</td>
        ${entry.sectors.map((value, index) => `<td>${value.toFixed(3)}${Math.abs(value - best[index]) < 0.001 ? " ★" : ""}</td>`).join("")}
        <td>${formatTime(entry.lap.lapTime)}</td>
      </tr>`
      )
      .join("");
    els.theoretical.innerHTML = `Theoretical best: <strong>${formatTime(
      best.reduce((sum, value) => sum + value, 0)
    )}</strong> from the best four sectors.`;
  }

  function updateKpis(group, reference) {
    const fastest = group.laps.reduce((best, lap) => (lap.lapTime < best.lapTime ? lap : best));
    const maxSpeed = group.laps.reduce((max, lap) => lap.samples.reduce((lapMax, sample) => Math.max(lapMax, sample.speedKph), max), 0);
    const averageSpeed = reference.samples.reduce((sum, sample) => sum + sample.speedKph, 0) / reference.samples.length;
    els.kpis.innerHTML = [
      ["Fastest lap", formatTime(fastest.lapTime)],
      ["Reference", formatTime(reference.lapTime)],
      ["Reference avg.", `${averageSpeed.toFixed(1)} km/h`],
      ["Top speed", `${maxSpeed.toFixed(1)} km/h`],
    ]
      .map(
        ([label, value]) =>
          `<div class="telemetry-kpi"><span class="telemetry-kpi-label">${label}</span><span class="telemetry-kpi-value">${value}</span></div>`
      )
      .join("");
  }

  function updateMapModeOptions(current) {
    const { group } = current;
    const options = [["laps", "Lap colors"]];
    if (group.laps.length > 1) options.push(["gain", "Gain / loss vs reference"]);
    options.push(["speed", "Speed"]);
    current.channels.forEach((key) => options.push([`ch:${key}`, CHANNEL_BY_KEY[key].label]));
    if (!options.some(([value]) => value === state.mapMode)) state.mapMode = "laps";
    els.mapMode.innerHTML = options
      .map(([value, label]) => `<option value="${value}" ${value === state.mapMode ? "selected" : ""}>${escapeHtml(label)}</option>`)
      .join("");
  }

  function lapOptions(laps, selectedId) {
    return laps
      .slice()
      .sort((a, b) => a.lapTime - b.lapTime)
      .map(
        (lap) =>
          `<option value="${encodeURIComponent(lap.id)}" ${lap.id === selectedId ? "selected" : ""}>${escapeHtml(lap.label)} — ${formatTime(
            lap.lapTime
          )}</option>`
      )
      .join("");
  }

  function render() {
    const group = state.groups[state.groupIndex];
    if (!group) return;
    const byTime = group.laps.slice().sort((a, b) => a.lapTime - b.lapTime);
    let reference = group.laps.find((lap) => lap.id === state.referenceId);
    if (!reference) reference = byTime[0];
    state.referenceId = reference.id;
    let compare = group.laps.find((lap) => lap.id === state.compareId);
    if (!compare || (compare.id === reference.id && group.laps.length > 1)) compare = byTime.find((lap) => lap.id !== reference.id) || reference;
    state.compareId = compare.id;
    els.reference.innerHTML = lapOptions(group.laps, reference.id);
    els.compare.innerHTML = lapOptions(group.laps, compare.id);

    els.results.hidden = false;
    stopReplay();
    const { xs, comparisons } = comparisonData(group, reference);
    state.current = { group, reference, compare, xs, comparisons };
    const channels = group.channels.concat(addDerivedChannels(state.current));
    state.current.channels = channels;
    if (!channels.includes(state.channelKey)) {
      state.channelKey = ["lock", "throttle", "brake", "lineOffset", "longG", "latG"].find((key) => channels.includes(key)) || channels[0] || null;
    }
    els.channel.innerHTML = channels
      .map((key) => `<option value="${key}" ${key === state.channelKey ? "selected" : ""}>${escapeHtml(CHANNEL_BY_KEY[key].label)}</option>`)
      .join("");
    if (state.cursorIndex !== null && state.cursorIndex >= xs.length) state.cursorIndex = null;
    updateKpis(group, reference);
    updateCharts(comparisons, reference);
    updateChannelChart();
    updateGG();
    updateCorners(state.current);
    updateMapModeOptions(state.current);
    updateMap(state.current);
    updateSectors(comparisons, reference);
    updateCoach(state.current);
    setCursor(state.cursorIndex);
  }

  async function loadFiles(files) {
    const telemetryFiles = Array.from(files).filter((file) => /\.(csv|vbo)$/i.test(file.name));
    if (!telemetryFiles.length) {
      setStatus("Choose at least one .csv or .vbo file.", true);
      return;
    }
    setStatus(`Reading ${telemetryFiles.length} file${telemetryFiles.length === 1 ? "" : "s"}…`);
    try {
      const results = await Promise.all(
        telemetryFiles.map(async (file) => {
          const text = await file.text();
          return /\.vbo$/i.test(file.name) ? parseVbo(text, file.name) : parseRaceChrono(text, file.name);
        })
      );
      const laps = results.flat();
      if (!laps.length) throw new Error("No complete laps were found in the selected files.");
      state.groups = groupLaps(laps);
      state.zoomRange = null;
      state.hiddenLaps.clear();
      els.zoomReset.hidden = true;
      state.groupIndex = 0;
      state.referenceId = null;
      state.compareId = null;
      state.cursorIndex = null;
      els.track.innerHTML = state.groups
        .map((group, index) => `<option value="${index}">${group.name} · ${group.laps.length} lap${group.laps.length === 1 ? "" : "s"}</option>`)
        .join("");
      const channelCount = new Set(laps.flatMap((lap) => lap.channels)).size;
      setStatus(
        `${laps.length} lap${laps.length === 1 ? "" : "s"} loaded from ${telemetryFiles.length} file${telemetryFiles.length === 1 ? "" : "s"}${
          channelCount ? `, with ${channelCount} extra channel${channelCount === 1 ? "" : "s"}` : ""
        }.`
      );
      render();
      els.results.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setStatus(error.message || "The telemetry files could not be read.", true);
    }
  }

  function setStatus(message, isError = false) {
    els.status.textContent = message;
    els.status.classList.toggle("is-error", isError);
  }

  function reset() {
    if (state.expandedPanel) setExpandedPanel(null);
    Object.values(state.charts).forEach((chart) => chart.destroy());
    state.charts = {};
    state.groups = [];
    state.referenceId = null;
    state.compareId = null;
    state.cursorIndex = null;
    state.zoomRange = null;
    state.hiddenLaps.clear();
    stopReplay();
    state.current = null;
    els.zoomReset.hidden = true;
    els.readout.hidden = true;
    els.files.value = "";
    els.results.hidden = true;
    setStatus("Ready for telemetry files.");
  }

  document.addEventListener("DOMContentLoaded", () => {
    Object.assign(els, {
      files: byId("telemetry-files"),
      dropzone: byId("telemetry-dropzone"),
      status: byId("telemetry-status"),
      results: byId("telemetry-results"),
      track: byId("telemetry-track-select"),
      reference: byId("telemetry-reference-select"),
      compare: byId("telemetry-compare-select"),
      mapMode: byId("telemetry-map-mode"),
      mapBase: byId("telemetry-map-base"),
      mapPanel: byId("telemetry-map-panel"),
      lapLegend: byId("telemetry-lap-legend"),
      zoomReset: byId("telemetry-zoom-reset"),
      replayButton: byId("telemetry-replay"),
      replaySpeed: byId("telemetry-replay-speed"),
      replayClock: byId("telemetry-replay-clock"),
      channel: byId("telemetry-channel-select"),
      channelUnit: byId("telemetry-channel-unit"),
      reset: byId("telemetry-reset"),
      overlayDelta: byId("telemetry-overlay-delta"),
      speedPanel: byId("telemetry-speed-panel"),
      deltaPanel: byId("telemetry-delta-panel"),
      channelPanel: byId("telemetry-channel-panel"),
      ggPanel: byId("telemetry-gg-panel"),
      mapLegend: byId("telemetry-map-legend"),
      kpis: byId("telemetry-kpis"),
      readout: byId("telemetry-readout"),
      readoutTitle: byId("telemetry-readout-title"),
      readoutBody: byId("telemetry-readout-body"),
      cornerBody: byId("telemetry-corner-body"),
      cornerCompare: byId("telemetry-corner-compare"),
      cornerSummary: byId("telemetry-corner-summary"),
      cornerTimeHeading: byId("telemetry-corner-time-heading"),
      sectorBody: byId("telemetry-sector-body"),
      theoretical: byId("telemetry-theoretical"),
      coachHeadline: byId("telemetry-coach-headline"),
      reportButton: byId("telemetry-report-button"),
      coachTips: byId("telemetry-coach-tips"),
      coachAsk: byId("telemetry-coach-ask"),
      coachStatus: byId("telemetry-coach-status"),
      coachChat: byId("telemetry-coach-chat"),
      coachForm: byId("telemetry-coach-form"),
      coachInput: byId("telemetry-coach-input"),
      coachSend: byId("telemetry-coach-send"),
    });
    els.files.addEventListener("change", () => loadFiles(els.files.files));
    ["dragenter", "dragover"].forEach((event) =>
      els.dropzone.addEventListener(event, (e) => {
        e.preventDefault();
        els.dropzone.classList.add("is-dragging");
      })
    );
    ["dragleave", "drop"].forEach((event) =>
      els.dropzone.addEventListener(event, (e) => {
        e.preventDefault();
        els.dropzone.classList.remove("is-dragging");
      })
    );
    els.dropzone.addEventListener("drop", (event) => loadFiles(event.dataTransfer.files));
    els.track.addEventListener("change", () => {
      state.groupIndex = Number(els.track.value);
      state.zoomRange = null;
      els.zoomReset.hidden = true;
      state.referenceId = null;
      state.compareId = null;
      state.cursorIndex = null;
      render();
    });
    els.reference.addEventListener("change", () => {
      state.referenceId = decodeURIComponent(els.reference.value);
      render();
    });
    els.compare.addEventListener("change", () => {
      state.compareId = decodeURIComponent(els.compare.value);
      render();
    });
    els.mapMode.addEventListener("change", () => {
      state.mapMode = els.mapMode.value;
      if (state.current) {
        updateMap(state.current);
        updateCursorMarkers();
      }
    });
    els.mapBase.addEventListener("change", () => {
      state.baseName = els.mapBase.value;
      setBaseLayer(state.baseName);
    });
    // One click toggles a lap; a second click on the same lap within 250 ms
    // shows only that lap. (Detected here because toggling re-renders the chips.)
    let pendingChip = null;
    els.lapLegend.addEventListener("click", (event) => {
      if (event.target.closest("[data-action='all']")) {
        setLapVisibility(() => state.hiddenLaps.clear());
        return;
      }
      const chip = event.target.closest("[data-id]");
      if (!chip || !state.current) return;
      const id = decodeURIComponent(chip.dataset.id);
      if (pendingChip && pendingChip.id === id) {
        window.clearTimeout(pendingChip.timer);
        pendingChip = null;
        setLapVisibility(() => {
          state.hiddenLaps.clear();
          state.current.comparisons.forEach((entry) => {
            if (entry.lap.id !== id) state.hiddenLaps.add(entry.lap.id);
          });
        });
        return;
      }
      if (pendingChip) window.clearTimeout(pendingChip.timer);
      pendingChip = {
        id,
        timer: window.setTimeout(() => {
          pendingChip = null;
          setLapVisibility(() => {
            if (state.hiddenLaps.has(id)) state.hiddenLaps.delete(id);
            else state.hiddenLaps.add(id);
          });
        }, 250),
      };
    });
    els.lapLegend.addEventListener("mouseover", (event) => {
      const chip = event.target.closest("[data-id]");
      highlightLap(chip && !chip.classList.contains("is-hidden") ? decodeURIComponent(chip.dataset.id) : null);
    });
    els.lapLegend.addEventListener("mouseleave", () => highlightLap(null));
    els.zoomReset.addEventListener("click", resetZoom);
    els.coachTips.addEventListener("click", (event) => {
      const item = event.target.closest("li[data-apex]");
      if (!item || !item.dataset.apex || !state.current) return;
      const row = (state.current.cornerRows || []).find((candidate) => candidate.zone.apex === Number(item.dataset.apex));
      if (row) {
        zoomToCorner(row.zone);
        els.mapPanel.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    els.coachAsk.addEventListener("click", () => askCoach());
    els.reportButton.addEventListener("click", printReport);
    els.coachForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const question = els.coachInput.value.trim();
      if (!question) return;
      els.coachInput.value = "";
      askCoach(question);
    });
    els.replayButton.addEventListener("click", toggleReplay);
    els.replaySpeed.addEventListener("change", () => {
      state.replay.speed = Number(els.replaySpeed.value) || 1;
    });
    els.channel.addEventListener("change", () => {
      state.channelKey = els.channel.value;
      updateChannelChart();
      updateReadout();
    });
    els.cornerBody.addEventListener("click", (event) => {
      const row = event.target.closest("tr[data-index]");
      if (!row || !state.current) return;
      const index = Number(row.dataset.index);
      const match = (state.current.cornerRows || []).find((candidate) => candidate.zone.apex === index);
      if (match) zoomToCorner(match.zone);
    });
    els.reset.addEventListener("click", reset);
    els.overlayDelta.addEventListener("change", () => {
      state.overlayDelta = els.overlayDelta.checked;
      render();
    });
    ["telemetry-speed-chart", "telemetry-delta-chart", "telemetry-channel-chart"].forEach((id) => attachChartCursor(byId(id)));
    setupExpandablePanels();
  });
})();
