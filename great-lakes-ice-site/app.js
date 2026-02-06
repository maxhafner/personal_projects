const HISTORY_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const LAKES = [
  {
    key: "Superior",
    name: "Lake Superior",
    accent: "#4aa8d8",
    path: "M12,82 L20,70 L34,62 L48,50 L64,44 L83,42 L98,36 L118,34 L136,36 L153,32 L170,34 L188,40 L202,46 L214,56 L224,66 L226,78 L220,88 L208,94 L194,102 L176,106 L156,108 L138,104 L124,106 L108,112 L92,114 L74,110 L58,112 L42,106 L28,102 L18,94 L12,82 Z",
  },
  {
    key: "Michigan",
    name: "Lake Michigan",
    accent: "#35a8be",
    path: "M120,12 L130,18 L136,28 L138,40 L136,54 L132,64 L126,74 L124,86 L126,98 L130,112 L128,124 L120,130 L108,128 L98,120 L94,110 L92,98 L94,86 L92,74 L84,60 L76,48 L74,34 L80,22 L92,14 L106,12 L120,12 Z",
  },
  {
    key: "Huron",
    name: "Lake Huron",
    accent: "#4b98cf",
    path: "M58,24 L72,16 L90,18 L106,22 L118,30 L128,36 L140,38 L152,46 L160,56 L160,68 L154,78 L146,84 L136,86 L128,94 L118,102 L106,108 L92,110 L80,106 L68,98 L58,92 L50,82 L46,70 L48,58 L46,46 L52,34 L58,24 Z",
  },
  {
    key: "Erie",
    name: "Lake Erie",
    accent: "#6cb0a4",
    path: "M16,84 L24,74 L40,68 L58,64 L80,62 L102,60 L126,60 L150,62 L172,64 L192,68 L206,74 L208,82 L202,88 L190,94 L170,96 L148,98 L124,98 L98,100 L72,100 L50,98 L34,94 L22,90 L16,84 Z",
  },
  {
    key: "Ontario",
    name: "Lake Ontario",
    accent: "#2582b4",
    path: "M34,74 L44,62 L60,54 L78,50 L98,48 L118,50 L136,54 L150,58 L162,66 L168,74 L166,82 L160,90 L148,98 L134,102 L118,104 L98,104 L78,102 L60,98 L48,92 L38,84 L34,74 Z",
  },
];

const LATEST_ENDPOINTS = [
  "/api/ice-latest",
  "https://apps.glerl.noaa.gov/erddap/tabledap/glerlIce.json?time,Superior,Michigan,Huron,Erie,Ontario,GL_Total&orderByMax(%22time%22)",
  "https://apps.glerl.noaa.gov/erddap/tabledap/glerlIce.json?time,Superior,Michigan,Huron,Erie,Ontario,GL_Total",
];

const HISTORY_ENDPOINTS = [
  `/api/ice-history?days=${HISTORY_DAYS}`,
  "https://apps.glerl.noaa.gov/erddap/tabledap/glerlIce.json?time,Superior,Michigan,Huron,Erie,Ontario,GL_Total",
];

const grid = document.getElementById("lake-grid");
const overallTotal = document.getElementById("overall-total");
const overallMeter = document.getElementById("overall-meter");
const overallCaption = document.getElementById("overall-caption");
const updatedAt = document.getElementById("last-updated");
const statusPill = document.getElementById("status-pill");
const historyNote = document.getElementById("history-note");

const clampPercent = (value) => Math.max(0, Math.min(100, value));

const toNumber = (value) => {
  if (typeof value === "number") {
    return value;
  }

  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const toTimestamp = (value) => {
  const stamp = new Date(String(value)).getTime();
  return Number.isFinite(stamp) ? stamp : null;
};

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const parseLatestPayload = (json) => {
  if (!json || !json.table || !Array.isArray(json.table.rows) || json.table.rows.length === 0) {
    throw new Error("Payload had no rows.");
  }

  const columns = json.table.columnNames;
  const lastRow = json.table.rows[json.table.rows.length - 1];
  const row = Object.fromEntries(columns.map((name, index) => [name, lastRow[index]]));

  const result = {
    time: String(row.time ?? ""),
    GL_Total: toNumber(row.GL_Total),
  };

  for (const lake of LAKES) {
    result[lake.key] = toNumber(row[lake.key]);
  }

  return result;
};

const normalizeHistoryRows = (payload) => {
  let rawRows = [];

  if (Array.isArray(payload?.rows)) {
    rawRows = payload.rows;
  } else if (Array.isArray(payload?.table?.rows) && Array.isArray(payload?.table?.columnNames)) {
    rawRows = payload.table.rows.map((rawRow) =>
      Object.fromEntries(payload.table.columnNames.map((name, index) => [name, rawRow[index]]))
    );
  } else {
    throw new Error("No historical rows in payload.");
  }

  const cutoff = Date.now() - (HISTORY_DAYS + 7) * DAY_MS;
  const normalizedRows = rawRows
    .map((row) => {
      const stamp = toTimestamp(row.time);
      if (stamp === null) {
        return null;
      }

      const normalized = {
        time: String(row.time),
        timeMs: stamp,
        GL_Total: toNumber(row.GL_Total),
      };

      for (const lake of LAKES) {
        normalized[lake.key] = toNumber(row[lake.key]);
      }

      return normalized;
    })
    .filter((row) => row && row.timeMs >= cutoff)
    .sort((a, b) => a.timeMs - b.timeMs);

  if (!normalizedRows.length) {
    throw new Error("No historical rows in requested range.");
  }

  return normalizedRows;
};

const statusLabel = (value) => {
  if (value >= 80) {
    return "Fully frozen";
  }
  if (value >= 50) {
    return "Heavy ice";
  }
  if (value >= 20) {
    return "Significant ice";
  }
  if (value >= 5) {
    return "Early ice";
  }
  return "Mostly open water";
};

const coverageLabel = (value) => {
  if (value >= 50) {
    return "Strong winter peak";
  }
  if (value >= 20) {
    return "Winter build-up";
  }
  return "Light seasonal cover";
};

const formatDate = (isoValue) => {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return "latest available";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
};

const formatDelta = (value) => {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
};

const buildSparkline = (values, width = 220, height = 62, padding = 6) => {
  if (!values.length) {
    return null;
  }

  if (values.length === 1) {
    const y = height / 2;
    const points = `${padding},${y.toFixed(2)} ${(width - padding).toFixed(2)},${y.toFixed(2)}`;
    return {
      linePoints: points,
      areaPoints: `${padding},${height - padding} ${points} ${(width - padding).toFixed(2)},${height - padding}`,
      min: values[0],
      max: values[0],
    };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.0001);
  const stepX = (width - padding * 2) / (values.length - 1);

  const points = values.map((value, index) => {
    const x = padding + stepX * index;
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const linePoints = points.join(" ");
  const areaPoints = `${padding},${height - padding} ${linePoints} ${(width - padding).toFixed(2)},${height - padding}`;

  return { linePoints, areaPoints, min, max };
};

const sevenDayDelta = (series) => {
  if (series.length < 2) {
    return null;
  }

  const latest = series[series.length - 1];
  const target = latest.timeMs - 7 * DAY_MS;

  let baseline = series[0];
  for (let index = series.length - 1; index >= 0; index -= 1) {
    if (series[index].timeMs <= target) {
      baseline = series[index];
      break;
    }
  }

  return latest.value - baseline.value;
};

const renderHistoryMeta = (historyRows) => {
  if (!historyRows.length) {
    historyNote.textContent = "Trend unavailable right now.";
    return;
  }

  const first = historyRows[0];
  const last = historyRows[historyRows.length - 1];
  historyNote.textContent = `History: ${historyRows.length} observations from ${formatDate(first.time)} to ${formatDate(last.time)}.`;
};

const lakeSeriesFromHistory = (lakeKey, historyRows, fallbackTime, fallbackValue) => {
  const series = historyRows
    .map((row) => ({
      timeMs: row.timeMs,
      value: clampPercent(toNumber(row[lakeKey]) ?? 0),
    }))
    .filter((point) => Number.isFinite(point.timeMs));

  if (series.length) {
    return series;
  }

  return [
    {
      timeMs: toTimestamp(fallbackTime) ?? Date.now(),
      value: clampPercent(toNumber(fallbackValue) ?? 0),
    },
  ];
};

const renderLakeCards = (dataset, historyRows) => {
  const rankings = LAKES.map((lake) => ({
    ...lake,
    value: clampPercent(toNumber(dataset[lake.key]) ?? 0),
  })).sort((a, b) => b.value - a.value);

  const rankByLake = Object.fromEntries(rankings.map((lake, index) => [lake.key, index + 1]));

  grid.innerHTML = rankings
    .map((lake, index) => {
      const rank = rankByLake[lake.key];
      const clipId = `clip-${lake.key.toLowerCase()}-${index}`;
      const waterId = `water-${lake.key.toLowerCase()}-${index}`;
      const iceId = `ice-${lake.key.toLowerCase()}-${index}`;
      const fill = (lake.value / 100).toFixed(3);

      const series = lakeSeriesFromHistory(lake.key, historyRows, dataset.time, lake.value);
      const sparkline = buildSparkline(series.map((point) => point.value));
      const delta = sevenDayDelta(series);
      const deltaClass = delta === null ? "" : delta >= 0 ? "up" : "down";
      const deltaText = delta === null ? "Need more data" : `${formatDelta(delta)} in 7 days`;

      return `
        <article class="lake-card" style="animation-delay: ${index * 85}ms">
          <div class="lake-card-head">
            <h3 class="lake-name">${lake.name}</h3>
            <p class="rank-chip">#${rank} ice</p>
          </div>

          <div class="lake-shape-wrap">
            <svg class="lake-shape" viewBox="0 0 240 140" role="img" aria-label="${lake.name} ${lake.value.toFixed(1)} percent ice cover">
              <defs>
                <clipPath id="${clipId}">
                  <path d="${lake.path}"></path>
                </clipPath>
                <linearGradient id="${waterId}" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#d8f2ff"></stop>
                  <stop offset="100%" stop-color="#7dc6e7"></stop>
                </linearGradient>
                <linearGradient id="${iceId}" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#f8fdff"></stop>
                  <stop offset="100%" stop-color="${lake.accent}"></stop>
                </linearGradient>
              </defs>
              <g clip-path="url(#${clipId})">
                <rect x="0" y="0" width="240" height="140" fill="url(#${waterId})"></rect>
                <rect class="ice-fill" style="--fill: ${fill};" x="0" y="0" width="240" height="140" fill="url(#${iceId})"></rect>
              </g>
              <path class="lake-outline" d="${lake.path}"></path>
            </svg>
            <p class="shape-percent">${lake.value.toFixed(1)}%</p>
          </div>

          <p class="status-text"><strong>${statusLabel(lake.value)}</strong><br />${coverageLabel(lake.value)}</p>

          <div class="trend-wrap">
            <div class="trend-head">
              <p class="trend-label">${HISTORY_DAYS}-day trend</p>
              <p class="trend-change ${deltaClass}">${deltaText}</p>
            </div>
            ${
              sparkline
                ? `<svg class="sparkline" viewBox="0 0 220 62" preserveAspectRatio="none" aria-hidden="true">
                    <polygon class="sparkline-area" points="${sparkline.areaPoints}"></polygon>
                    <polyline class="sparkline-line" points="${sparkline.linePoints}"></polyline>
                  </svg>
                  <p class="trend-range">Range: ${sparkline.min.toFixed(1)}% to ${sparkline.max.toFixed(1)}%</p>`
                : '<p class="trend-range">Historical trend unavailable.</p>'
            }
          </div>
        </article>
      `;
    })
    .join("");
};

const renderSummary = (dataset, historyRows) => {
  const calculatedAverage =
    LAKES.reduce((sum, lake) => sum + clampPercent(toNumber(dataset[lake.key]) ?? 0), 0) / LAKES.length;

  const totalValue = clampPercent(toNumber(dataset.GL_Total) ?? calculatedAverage);
  overallTotal.textContent = `${totalValue.toFixed(1)}%`;
  overallMeter.style.width = `${totalValue}%`;
  overallCaption.textContent = coverageLabel(totalValue);
  updatedAt.textContent = `Observed ${formatDate(dataset.time)} (UTC)`;

  renderHistoryMeta(historyRows);
};

const renderError = (error) => {
  statusPill.textContent = "Offline";
  overallTotal.textContent = "--%";
  overallMeter.style.width = "0";
  overallCaption.textContent = "Live feed unavailable";
  updatedAt.textContent = "Could not fetch NOAA data.";
  historyNote.textContent = "History unavailable.";

  grid.innerHTML = `
    <article class="lake-card" style="grid-column: 1 / -1; animation-delay: 0ms;">
      <h3 class="lake-name">Data unavailable right now</h3>
      <p class="status-text">${escapeHtml(error.message)}</p>
      <p class="status-text">Start the site using <code>python3 server.py</code> to enable the NOAA proxy endpoint.</p>
    </article>
  `;
};

const endpointErrorMessage = async (response, endpoint) => {
  try {
    const body = await response.json();
    if (typeof body.error === "string") {
      return `${body.error} (${endpoint})`;
    }
  } catch (_unused) {
    // Ignore non-JSON error responses.
  }

  return `Request failed (${response.status}) at ${endpoint}`;
};

const fetchLatestDataset = async () => {
  let lastError = new Error("No latest-data endpoints attempted.");

  for (const endpoint of LATEST_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await endpointErrorMessage(response, endpoint));
      }

      const json = await response.json();
      return parseLatestPayload(json);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
};

const fetchHistoryDataset = async () => {
  let lastError = new Error("No history-data endpoints attempted.");

  for (const endpoint of HISTORY_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await endpointErrorMessage(response, endpoint));
      }

      const json = await response.json();
      return normalizeHistoryRows(json);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
};

const init = async () => {
  try {
    const latest = await fetchLatestDataset();

    let historyRows = [];
    try {
      historyRows = await fetchHistoryDataset();
      statusPill.textContent = "Live + Trend";
    } catch (_historyError) {
      statusPill.textContent = "Live";
      historyNote.textContent = "Live values loaded. Trend data unavailable right now.";
    }

    renderSummary(latest, historyRows);
    renderLakeCards(latest, historyRows);
  } catch (error) {
    renderError(error);
  }
};

init();
