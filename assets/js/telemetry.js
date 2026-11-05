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
    const speedIndex = findColumn(headers, ["speed"], true);
    const lapIndex = findColumn(headers, ["lap number", "lap"]);
    const distanceIndex = findColumn(headers, ["distance traveled", "distance"]);
    const latIndex = findColumn(headers, ["latitude", "lat"]);
    const lonIndex = findColumn(headers, ["longitude", "lon", "lng"]);
    if (timeIndex < 0 || speedIndex < 0) throw new Error(`${filename}: time or speed column is missing.`);

    const units = parseCsvLine(lines[headerIndex + 1] || "");
    const sources = parseCsvLine(lines[headerIndex + 2] || "");
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
  function setCursor(index) {
    if (!state.current) return;
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

  function attachChartCursor(canvas) {
    canvas.addEventListener("pointermove", (event) => {
      const chart = window.Chart && Chart.getChart(canvas);
      if (!chart || !state.current) return;
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left;
      if (px < chart.chartArea.left || px > chart.chartArea.right) return;
      setCursorByDistance(chart.scales.x.getValueForPixel(px));
    });
  }

  function updateCursorMarkers() {
    if (!state.map) return;
    state.cursorMarkers.forEach(({ marker, entry }) => {
      const point = state.cursorIndex === null ? null : entry.points[state.cursorIndex];
      if (!point || point.lat === null) {
        marker.remove();
        return;
      }
      marker.setLatLng([point.lat, point.lon]);
      if (!state.map.hasLayer(marker)) marker.addTo(state.map);
    });
  }

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
    const xs = state.current ? state.current.xs : null;
    const scales = {
      x: {
        type: "linear",
        min: 0,
        max: xs ? xs[xs.length - 1] : undefined,
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
      label: `${entry.lap.label} (${formatTime(entry.lap.lapTime)})`,
      data: entry.speed,
      borderColor: entry.color,
      backgroundColor: entry.color,
      borderWidth: entry.lap.id === reference.id ? 3 : 1.7,
      pointRadius: 0,
    }));
    const deltaSets = comparisons.map((entry) => ({
      label: `${state.overlayDelta ? "Δ " : ""}${entry.lap.label}`,
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
      .filter((entry) => entry.lap.channels.includes(key))
      .map((entry) => ({
        label: entry.lap.label,
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

  function interpolateMapSample(left, right, ratio, distance) {
    return {
      distance,
      speed: left.speedKph + (right.speedKph - left.speedKph) * ratio,
      lat: left.lat + (right.lat - left.lat) * ratio,
      lon: left.lon + (right.lon - left.lon) * ratio,
    };
  }

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
    const windowSize = Math.max(4, Math.round(40 / step));
    const candidates = [];

    for (let index = 2; index < smoothed.length - 2; index += 1) {
      const value = smoothed[index];
      const start = Math.max(0, index - windowSize);
      const end = Math.min(smoothed.length - 1, index + windowSize);
      let nearbyMax = -Infinity;
      let nearbyMin = Infinity;
      for (let i = start; i <= end; i += 1) {
        nearbyMax = Math.max(nearbyMax, smoothed[i]);
        nearbyMin = Math.min(nearbyMin, smoothed[i]);
      }
      const isCorner = value <= smoothed[index - 1] && value < smoothed[index + 1];
      const isStraight = value >= smoothed[index - 1] && value > smoothed[index + 1];
      const prominence = isCorner ? nearbyMax - value : isStraight ? value - nearbyMin : 0;
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

  function speedMarkers(lap) {
    const source = [];
    lap.samples.forEach((sample) => {
      if (sample.lat === null || sample.lon === null) return;
      const previous = source[source.length - 1];
      if (previous && (sample.lapDistance <= previous.lapDistance || geoDistance([previous.lat, previous.lon], [sample.lat, sample.lon]) > 200))
        return;
      source.push(sample);
    });
    if (source.length < 5) return [];

    const step = 5;
    const resampled = [];
    let cursor = 0;
    for (let distance = source[0].lapDistance; distance <= source[source.length - 1].lapDistance; distance += step) {
      while (cursor < source.length - 2 && source[cursor + 1].lapDistance < distance) cursor += 1;
      const left = source[cursor];
      const right = source[Math.min(cursor + 1, source.length - 1)];
      const span = right.lapDistance - left.lapDistance;
      const ratio = span > 0 ? (distance - left.lapDistance) / span : 0;
      resampled.push(interpolateMapSample(left, right, ratio, distance));
    }
    if (resampled.length < 12) return [];
    return speedExtrema(resampled, lap.distance, step).markers;
  }

  function lapPolyline(lap) {
    const points = [];
    lap.samples.forEach((sample) => {
      if (sample.lat === null || sample.lon === null) return;
      const point = [sample.lat, sample.lon];
      if (points.length && geoDistance(points[points.length - 1], point) > 200) return;
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

  function drawGainMap(current, bounds) {
    const reference = current.comparisons.find((entry) => entry.lap.id === current.reference.id);
    const compare = current.comparisons.find((entry) => entry.lap.id === current.compare.id);
    const refLine = lapPolyline(reference.lap);
    if (refLine.length > 1) {
      const layer = L.polyline(refLine, { color: "#555", opacity: 0.35, weight: 2, dashArray: "4 4" }).addTo(state.map);
      state.mapLayers.push(layer);
      bounds.push(...refLine);
    }
    const rates = gainRates(compare, current.xs);
    let run = null;
    const flush = () => {
      if (run && run.points.length > 1) {
        const layer = L.polyline(run.points, { color: GAIN_COLORS[run.bucket], opacity: 0.95, weight: 5, lineCap: "butt" }).addTo(state.map);
        state.mapLayers.push(layer);
        bounds.push(...run.points);
      }
    };
    compare.points.forEach((point, i) => {
      if (point.lat === null) return;
      const bucket = gainBucket(rates[i]);
      const latLng = [point.lat, point.lon];
      if (!run || run.bucket !== bucket) {
        const previous = run ? run.points[run.points.length - 1] : null;
        flush();
        run = { bucket, points: previous ? [previous, latLng] : [latLng] };
      } else run.points.push(latLng);
    });
    flush();
  }

  function updateMap(current) {
    if (!window.L) return;
    if (!state.map) {
      state.map = L.map("telemetry-map", { scrollWheelZoom: true, zoomControl: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(state.map);
      state.map.on("mousemove", (event) => {
        if (!state.current) return;
        const target = [event.latlng.lat, event.latlng.lng];
        const reference = state.current.comparisons.find((entry) => entry.lap.id === state.current.reference.id);
        let best = null;
        let bestDistance = Infinity;
        reference.points.forEach((point, index) => {
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
    }
    state.mapLayers.forEach((layer) => layer.remove());
    state.cursorMarkers.forEach(({ marker }) => marker.remove());
    state.mapLayers = [];
    state.cursorMarkers = [];
    const bounds = [];
    const gainMode = state.mapMode === "gain" && current.compare.id !== current.reference.id;
    els.mapLegend.innerHTML = gainMode
      ? `<i style="background:${GAIN_COLORS.strongGain}"></i>gaining <i style="background:${GAIN_COLORS.neutral}"></i>even <i style="background:${GAIN_COLORS.strongLoss}"></i>losing`
      : "▼ corner min · ▲ straight max";

    if (gainMode) drawGainMap(current, bounds);
    else {
      current.comparisons.forEach((entry) => {
        const { lap } = entry;
        const points = lapPolyline(lap);
        if (points.length < 2) return;
        const layer = L.polyline(points, { color: entry.color, opacity: 0.85, weight: 3 }).bindTooltip(
          `${escapeHtml(lap.label)} · ${formatTime(lap.lapTime)}`
        );
        layer.addTo(state.map);
        state.mapLayers.push(layer);
        speedMarkers(lap).forEach((marker) => {
          const symbol = marker.kind === "corner" ? "▼" : "▲";
          const markerLayer = L.marker([marker.lat, marker.lon], {
            icon: L.divIcon({
              className: "telemetry-speed-marker",
              html: `<span class="telemetry-speed-marker-inner is-${marker.kind}" style="--marker-color:${entry.color}">${symbol} ${Math.round(
                marker.speed
              )}</span>`,
              iconAnchor: [24, 14],
            }),
          }).bindTooltip(`${marker.kind === "corner" ? "Corner minimum" : "Straight maximum"}: ${marker.speed.toFixed(1)} km/h`);
          markerLayer.addTo(state.map);
          state.mapLayers.push(markerLayer);
        });
        bounds.push(...points);
      });
    }

    const cursorLaps = gainMode
      ? current.comparisons.filter((entry) => entry.lap.id === current.reference.id || entry.lap.id === current.compare.id)
      : current.comparisons;
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

    state.mapBounds = bounds;
    window.requestAnimationFrame(() => {
      state.map.invalidateSize();
      if (bounds.length) state.map.fitBounds(bounds, { padding: [16, 16], maxZoom: 18 });
      else state.map.setView([38, -97], 3);
    });
  }

  function resizeVisuals() {
    window.requestAnimationFrame(() => {
      Object.values(state.charts).forEach((chart) => chart.resize());
      if (state.map) {
        state.map.invalidateSize();
        if (state.mapBounds.length) state.map.fitBounds(state.mapBounds, { padding: [16, 16], maxZoom: 18 });
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
          if (state.expandedPanel || event.target.closest("button, a, select, input, label, tr, #telemetry-map")) return;
          setExpandedPanel(panel);
        },
        true
      );
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.expandedPanel) setExpandedPanel(null);
    });
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
    return {
      minSpeed: points[apex].speed,
      exitSpeed: points[zone.end].speed,
      time: points[zone.end].time - points[zone.start].time,
      brakeX: brake === null ? null : points[brake].x,
    };
  }

  function updateCorners(current) {
    const zones = cornerZones(current);
    current.corners = zones;
    const reference = current.comparisons.find((entry) => entry.lap.id === current.reference.id);
    const compare = current.comparisons.find((entry) => entry.lap.id === current.compare.id);
    const channels = current.group.channels;
    const same = reference === compare;
    els.cornerCompare.textContent = same ? `Reference: ${current.reference.label}` : `${current.compare.label} vs ${current.reference.label}`;
    if (!zones.length) {
      els.cornerBody.innerHTML = `<tr><td colspan="7">No clear corners found in the reference lap.</td></tr>`;
      els.cornerSummary.textContent = "";
      return;
    }
    const rows = zones.map((zone) => {
      const ref = cornerMetrics(reference, zone, channels);
      const cmp = cornerMetrics(compare, zone, channels);
      return { zone, ref, cmp, dt: cmp.time - ref.time };
    });
    const worst = rows
      .filter((row) => row.dt > 0.02)
      .sort((a, b) => b.dt - a.dt)
      .slice(0, 3);
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
    const maxSpeed = Math.max(...group.laps.flatMap((lap) => lap.samples.map((sample) => sample.speedKph)));
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
    if (!group.channels.includes(state.channelKey)) {
      state.channelKey = ["lock", "throttle", "brake", "longG", "latG"].find((key) => group.channels.includes(key)) || group.channels[0] || null;
    }

    els.reference.innerHTML = lapOptions(group.laps, reference.id);
    els.compare.innerHTML = lapOptions(group.laps, compare.id);
    els.channel.innerHTML = group.channels
      .map((key) => `<option value="${key}" ${key === state.channelKey ? "selected" : ""}>${escapeHtml(CHANNEL_BY_KEY[key].label)}</option>`)
      .join("");

    els.results.hidden = false;
    const { xs, comparisons } = comparisonData(group, reference);
    state.current = { group, reference, compare, xs, comparisons };
    if (state.cursorIndex !== null && state.cursorIndex >= xs.length) state.cursorIndex = null;
    updateKpis(group, reference);
    updateCharts(comparisons, reference);
    updateChannelChart();
    updateGG();
    updateMap(state.current);
    updateCorners(state.current);
    updateSectors(comparisons, reference);
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
    state.current = null;
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
    els.channel.addEventListener("change", () => {
      state.channelKey = els.channel.value;
      updateChannelChart();
      updateReadout();
    });
    els.cornerBody.addEventListener("click", (event) => {
      const row = event.target.closest("tr[data-index]");
      if (!row || !state.current) return;
      const index = Number(row.dataset.index);
      setCursor(index);
      const point = state.current.comparisons.find((entry) => entry.lap.id === state.current.reference.id).points[index];
      if (state.map && point.lat !== null) state.map.panTo([point.lat, point.lon]);
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
