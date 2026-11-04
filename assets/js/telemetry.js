(() => {
  "use strict";

  const COLORS = ["#ef5b2a", "#2878b5", "#37a169", "#a855b5", "#d59c17", "#2f9da0", "#d24a68", "#6d72d8"];
  const state = { groups: [], groupIndex: 0, referenceId: null, charts: {}, map: null, mapLayers: [] };

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

  function parseRaceChrono(text, filename) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
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
    const speedUnit = normalize(units[speedIndex] || headers[speedIndex]);
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
      });
    }
    if (rows.length < 2) throw new Error(`${filename}: no usable telemetry samples found.`);
    rows.sort((a, b) => a.time - b.time);
    return splitLaps(rows, filename);
  }

  function splitLaps(rows, filename) {
    const buckets = new Map();
    rows.forEach((row) => {
      const lapNumber = Number.isFinite(row.lap) ? Math.trunc(row.lap) : 1;
      if (!buckets.has(lapNumber)) buckets.set(lapNumber, []);
      buckets.get(lapNumber).push(row);
    });

    const laps = [];
    buckets.forEach((samples, lapNumber) => {
      if (samples.length < 3) return;
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
      if (last.elapsed <= 0 || last.lapDistance <= 0) return;
      laps.push({
        id: `${filename}::${lapNumber}`,
        filename,
        lapNumber,
        label: `${filename.replace(/\.csv$/i, "")} · L${lapNumber}`,
        samples,
        lapTime: last.elapsed,
        distance: last.lapDistance,
      });
    });
    return laps;
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
    });
    return groups;
  }

  function interpolate(lap, distances) {
    const samples = lap.samples.filter((sample, index, all) => index === 0 || sample.lapDistance > all[index - 1].lapDistance);
    let cursor = 0;
    return distances.map((distance) => {
      while (cursor < samples.length - 2 && samples[cursor + 1].lapDistance < distance) cursor += 1;
      const left = samples[cursor];
      const right = samples[Math.min(cursor + 1, samples.length - 1)];
      const span = right.lapDistance - left.lapDistance;
      const ratio = span > 0 ? (distance - left.lapDistance) / span : 0;
      return {
        x: distance,
        time: left.elapsed + (right.elapsed - left.elapsed) * ratio,
        speed: left.speedKph + (right.speedKph - left.speedKph) * ratio,
      };
    });
  }

  function comparisonData(group, reference) {
    const commonDistance = Math.min(...group.laps.map((lap) => lap.distance));
    const step = Math.max(2, commonDistance / 750);
    const distances = [];
    for (let distance = 0; distance <= commonDistance; distance += step) distances.push(distance);
    const ref = interpolate(reference, distances);
    return group.laps.map((lap) => {
      const points = interpolate(lap, distances);
      return {
        lap,
        speed: points.map((point) => ({ x: point.x, y: point.speed })),
        delta: points.map((point, index) => ({ x: point.x, y: point.time - ref[index].time })),
        points,
      };
    });
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, "0")}`;
  }

  function chartOptions(yTitle) {
    return {
      animation: false,
      maintainAspectRatio: false,
      normalized: true,
      parsing: false,
      interaction: { intersect: false, mode: "nearest" },
      plugins: { legend: { labels: { boxWidth: 11, usePointStyle: true } } },
      scales: {
        x: { type: "linear", title: { display: true, text: "Distance (m)" }, grid: { color: "rgba(127,127,127,.12)" } },
        y: { title: { display: true, text: yTitle }, grid: { color: "rgba(127,127,127,.12)" } },
      },
    };
  }

  function updateCharts(comparisons, reference) {
    Object.values(state.charts).forEach((chart) => chart.destroy());
    const datasets = comparisons.map((entry, index) => ({
      label: `${entry.lap.label} (${formatTime(entry.lap.lapTime)})`,
      data: entry.speed,
      borderColor: COLORS[index % COLORS.length],
      backgroundColor: COLORS[index % COLORS.length],
      borderWidth: entry.lap.id === reference.id ? 3 : 1.7,
      pointRadius: 0,
    }));
    const deltaSets = comparisons.map((entry, index) => ({
      label: entry.lap.label,
      data: entry.delta,
      borderColor: COLORS[index % COLORS.length],
      backgroundColor: COLORS[index % COLORS.length],
      borderWidth: entry.lap.id === reference.id ? 2.5 : 1.7,
      pointRadius: 0,
    }));
    state.charts.speed = new Chart(byId("telemetry-speed-chart"), { type: "line", data: { datasets }, options: chartOptions("Speed (km/h)") });
    state.charts.delta = new Chart(byId("telemetry-delta-chart"), {
      type: "line",
      data: { datasets: deltaSets },
      options: chartOptions("Delta (s)"),
    });
  }

  function updateMap(group) {
    if (!window.L) return;
    if (!state.map) {
      state.map = L.map("telemetry-map", { scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(state.map);
    }
    state.mapLayers.forEach((layer) => layer.remove());
    state.mapLayers = [];
    const bounds = [];
    group.laps.forEach((lap, index) => {
      const points = lap.samples.filter((sample) => sample.lat !== null && sample.lon !== null).map((sample) => [sample.lat, sample.lon]);
      if (points.length < 2) return;
      const layer = L.polyline(points, { color: COLORS[index % COLORS.length], opacity: 0.85, weight: 3 }).bindTooltip(
        `${escapeHtml(lap.label)} · ${formatTime(lap.lapTime)}`
      );
      layer.addTo(state.map);
      state.mapLayers.push(layer);
      bounds.push(...points);
    });
    if (bounds.length) state.map.fitBounds(bounds, { padding: [18, 18] });
    else state.map.setView([38, -97], 3);
    window.setTimeout(() => state.map.invalidateSize(), 0);
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

  function render() {
    const group = state.groups[state.groupIndex];
    if (!group) return;
    let reference = group.laps.find((lap) => lap.id === state.referenceId);
    if (!reference) reference = group.laps.reduce((best, lap) => (lap.lapTime < best.lapTime ? lap : best));
    state.referenceId = reference.id;

    els.reference.innerHTML = group.laps
      .slice()
      .sort((a, b) => a.lapTime - b.lapTime)
      .map(
        (lap) =>
          `<option value="${encodeURIComponent(lap.id)}" ${lap.id === reference.id ? "selected" : ""}>${escapeHtml(lap.label)} — ${formatTime(
            lap.lapTime
          )}</option>`
      )
      .join("");

    const comparisons = comparisonData(group, reference);
    updateKpis(group, reference);
    updateCharts(comparisons, reference);
    updateMap(group);
    updateSectors(comparisons, reference);
    els.results.hidden = false;
  }

  async function loadFiles(files) {
    const csvFiles = Array.from(files).filter((file) => file.name.toLowerCase().endsWith(".csv"));
    if (!csvFiles.length) {
      setStatus("Choose at least one .csv file.", true);
      return;
    }
    setStatus(`Reading ${csvFiles.length} file${csvFiles.length === 1 ? "" : "s"}…`);
    try {
      const results = await Promise.all(csvFiles.map(async (file) => parseRaceChrono(await file.text(), file.name)));
      const laps = results.flat();
      if (!laps.length) throw new Error("No complete laps were found in the selected files.");
      state.groups = groupLaps(laps);
      state.groupIndex = 0;
      state.referenceId = null;
      els.track.innerHTML = state.groups
        .map((group, index) => `<option value="${index}">${group.name} · ${group.laps.length} lap${group.laps.length === 1 ? "" : "s"}</option>`)
        .join("");
      setStatus(`${laps.length} lap${laps.length === 1 ? "" : "s"} loaded from ${csvFiles.length} file${csvFiles.length === 1 ? "" : "s"}.`);
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
    Object.values(state.charts).forEach((chart) => chart.destroy());
    state.charts = {};
    state.groups = [];
    state.referenceId = null;
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
      reset: byId("telemetry-reset"),
      kpis: byId("telemetry-kpis"),
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
      render();
    });
    els.reference.addEventListener("change", () => {
      state.referenceId = decodeURIComponent(els.reference.value);
      render();
    });
    els.reset.addEventListener("click", reset);
  });
})();
