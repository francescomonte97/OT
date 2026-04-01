function prepareCanvas(canvas) {
  if (!canvas) return null;

  const rect = canvas.getBoundingClientRect();
  const widthCss = Math.max(10, rect.width || canvas.clientWidth || 300);
  const heightCss = Math.max(10, rect.height || canvas.clientHeight || 180);
  const dpr = window.devicePixelRatio || 1;

  const pxWidth = Math.round(widthCss * dpr);
  const pxHeight = Math.round(heightCss * dpr);

  if (canvas.width !== pxWidth || canvas.height !== pxHeight) {
    canvas.width = pxWidth;
    canvas.height = pxHeight;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: widthCss, height: heightCss };
}

function drawEmptyChart(canvas, message) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;

  const { ctx, width, height } = prepared;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "13px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(message, width / 2, height / 2);
}

function drawAxes(ctx, left, top, plotW, plotH, yMin, yMax, yFormatter) {
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, top + plotH);
  ctx.lineTo(left + plotW, top + plotH);
  ctx.stroke();

  const ticks = 4;
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= ticks; i++) {
    const ratio = i / ticks;
    const y = top + plotH - ratio * plotH;
    const value = yMin + ratio * (yMax - yMin);

    ctx.strokeStyle = "#f1f5f9";
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + plotW, y);
    ctx.stroke();

    ctx.fillStyle = "#64748b";
    ctx.fillText(yFormatter(value), left - 8, y);
  }
}

export function drawLineChart(canvas, samples, getY, yFormatter, options = {}) {
  if (!samples || samples.length < 2) {
    drawEmptyChart(canvas, "Nessun dato disponibile");
    return;
  }

  const prepared = prepareCanvas(canvas);
  if (!prepared) return;

  const { ctx, width, height } = prepared;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const left = 48;
  const right = 12;
  const top = 14;
  const bottom = 26;
  const plotW = width - left - right;
  const plotH = height - top - bottom;

  const t0 = samples[0].t;
  const points = samples
    .map((s) => ({ x: (s.t - t0) / 1000, y: getY(s) }))
    .filter((p) => Number.isFinite(p.y));

  if (points.length < 2) {
    drawEmptyChart(canvas, "Dati insufficienti");
    return;
  }

  const xMax = Math.max(points[points.length - 1].x, 0.001);
  let yMin = options.startAtZero ? 0 : Math.min(...points.map((p) => p.y));
  let yMax = Math.max(...points.map((p) => p.y));

  if (!Number.isFinite(yMin)) yMin = 0;
  if (!Number.isFinite(yMax)) yMax = 1;
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }

  drawAxes(ctx, left, top, plotW, plotH, yMin, yMax, yFormatter);

  ctx.strokeStyle = options.lineColor || "#2563eb";
  ctx.lineWidth = 2.2;
  ctx.beginPath();

  points.forEach((p, index) => {
    const x = left + (p.x / xMax) * plotW;
    const y = top + plotH - ((p.y - yMin) / (yMax - yMin)) * plotH;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();

  if (Array.isArray(options.markerTimestamps) && options.markerTimestamps.length) {
    const markerSet = options.markerTimestamps;
    ctx.fillStyle = options.markerColor || "#ef4444";
    for (const mt of markerSet) {
      const p = points.find((pt) => Math.abs((pt.x * 1000 + t0) - mt) < 120);
      if (!p) continue;
      const x = left + (p.x / xMax) * plotW;
      const y = top + plotH - ((p.y - yMin) / (yMax - yMin)) * plotH;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = "#64748b";
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("tempo (s)", left + plotW / 2, height - 16);
}

export function drawBarChart(canvas, values, labels, valueFormatter) {
  const numeric = values.filter((v) => Number.isFinite(v));
  if (!numeric.length) {
    drawEmptyChart(canvas, "Nessuna prova disponibile");
    return;
  }

  const prepared = prepareCanvas(canvas);
  if (!prepared) return;

  const { ctx, width, height } = prepared;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const left = 42;
  const right = 16;
  const top = 18;
  const bottom = 34;
  const plotW = width - left - right;
  const plotH = height - top - bottom;

  let yMax = Math.max(...numeric);
  if (yMax <= 0) yMax = 1;
  yMax *= 1.15;

  drawAxes(ctx, left, top, plotW, plotH, 0, yMax, (v) => valueFormatter(v));

  const slotW = plotW / values.length;
  const barW = Math.min(46, slotW * 0.6);

  values.forEach((value, idx) => {
    const x = left + idx * slotW + (slotW - barW) / 2;
    const barH = Number.isFinite(value) ? (value / yMax) * plotH : 0;
    const y = top + plotH - barH;

    ctx.fillStyle = Number.isFinite(value) ? "#2563eb" : "#d1d5db";
    ctx.fillRect(x, y, barW, barH);

    ctx.fillStyle = "#334155";
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(labels[idx] || "", x + barW / 2, top + plotH + 8);

    if (Number.isFinite(value)) {
      ctx.textBaseline = "bottom";
      ctx.fillText(valueFormatter(value), x + barW / 2, y - 4);
    }
  });
}

export function drawDualBarChart(canvas, seriesA, seriesB, labels, formatter, legendA = "A", legendB = "B") {
  const numeric = [...seriesA, ...seriesB].filter((v) => Number.isFinite(v));
  if (!numeric.length) {
    drawEmptyChart(canvas, "Nessuna prova disponibile");
    return;
  }

  const prepared = prepareCanvas(canvas);
  if (!prepared) return;

  const { ctx, width, height } = prepared;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const left = 42;
  const right = 16;
  const top = 30;
  const bottom = 34;
  const plotW = width - left - right;
  const plotH = height - top - bottom;

  let yMax = Math.max(...numeric, 1);
  yMax *= 1.15;

  drawAxes(ctx, left, top, plotW, plotH, 0, yMax, (v) => formatter(v));

  const groupW = plotW / labels.length;
  const barW = Math.min(24, groupW * 0.22);

  labels.forEach((label, idx) => {
    const center = left + idx * groupW + groupW / 2;
    const a = seriesA[idx];
    const b = seriesB[idx];

    const bars = [
      { value: a, x: center - barW - 4, color: "#2563eb" },
      { value: b, x: center + 4, color: "#60a5fa" },
    ];

    for (const bar of bars) {
      const barH = Number.isFinite(bar.value) ? (bar.value / yMax) * plotH : 0;
      const y = top + plotH - barH;
      ctx.fillStyle = Number.isFinite(bar.value) ? bar.color : "#d1d5db";
      ctx.fillRect(bar.x, y, barW, barH);
    }

    ctx.fillStyle = "#334155";
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, center, top + plotH + 8);
  });

  ctx.fillStyle = "#64748b";
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(legendA, left, 6);
  ctx.fillStyle = "#2563eb";
  ctx.fillRect(left + 52, 8, 10, 10);
  ctx.fillStyle = "#64748b";
  ctx.fillText(legendB, left + 74, 6);
  ctx.fillStyle = "#60a5fa";
  ctx.fillRect(left + 132, 8, 10, 10);
}

export function drawActivityTimeline(canvas, samples, options = {}) {
  if (!samples || samples.length < 2) {
    drawEmptyChart(canvas, "Nessun dato disponibile");
    return;
  }

  const prepared = prepareCanvas(canvas);
  if (!prepared) return;

  const { ctx, width, height } = prepared;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const left = 20;
  const right = 20;
  const top = 52;
  const barH = 36;
  const plotW = width - left - right;
  const threshold = options.activeSpeedThreshold ?? 8;

  const t0 = samples[0].t;
  const t1 = samples[samples.length - 1].t;
  const total = Math.max(1, t1 - t0);

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    const startX = left + ((prev.t - t0) / total) * plotW;
    const endX = left + ((curr.t - t0) / total) * plotW;
    const segW = Math.max(1, endX - startX);
    const speedAvg = (prev.speed + curr.speed) / 2;

    ctx.fillStyle = speedAvg > threshold ? "#2563eb" : "#d1d5db";
    ctx.fillRect(startX, top, segW, barH);
  }

  ctx.strokeStyle = "#e2e8f0";
  ctx.strokeRect(left, top, plotW, barH);

  ctx.fillStyle = "#0f172a";
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("attivo", left, top - 12);
  ctx.fillStyle = "#64748b";
  ctx.fillText("blu = attività, grigio = inattività", left, top + barH + 18);
}

export function drawWorkspaceScatter(canvas, points) {
  const clean = (points || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (clean.length < 2) {
    drawEmptyChart(canvas, "Nessun dato disponibile");
    return;
  }

  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, width, height } = prepared;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const left = 28;
  const right = 18;
  const top = 18;
  const bottom = 28;
  const plotW = width - left - right;
  const plotH = height - top - bottom;

  let minX = Math.min(...clean.map((p) => p.x));
  let maxX = Math.max(...clean.map((p) => p.x));
  let minY = Math.min(...clean.map((p) => p.y));
  let maxY = Math.max(...clean.map((p) => p.y));

  if (minX === maxX) { minX -= 1; maxX += 1; }
  if (minY === maxY) { minY -= 1; maxY += 1; }

  ctx.strokeStyle = "#e2e8f0";
  ctx.strokeRect(left, top, plotW, plotH);

  const zeroX = left + ((0 - minX) / (maxX - minX)) * plotW;
  const zeroY = top + plotH - ((0 - minY) / (maxY - minY)) * plotH;

  if (zeroX >= left && zeroX <= left + plotW) {
    ctx.strokeStyle = "#f1f5f9";
    ctx.beginPath();
    ctx.moveTo(zeroX, top);
    ctx.lineTo(zeroX, top + plotH);
    ctx.stroke();
  }
  if (zeroY >= top && zeroY <= top + plotH) {
    ctx.strokeStyle = "#f1f5f9";
    ctx.beginPath();
    ctx.moveTo(left, zeroY);
    ctx.lineTo(left + plotW, zeroY);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(37,99,235,.28)";
  for (const p of clean) {
    const x = left + ((p.x - minX) / (maxX - minX)) * plotW;
    const y = top + plotH - ((p.y - minY) / (maxY - minY)) * plotH;
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#64748b";
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("Δβ", left + plotW / 2, height - 16);

  ctx.save();
  ctx.translate(12, top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("Δγ", 0, 0);
  ctx.restore();
}

export function drawHalvesComparison(canvas, halves) {
  if (!halves) {
    drawEmptyChart(canvas, "Nessun dato disponibile");
    return;
  }

  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, width, height } = prepared;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const metrics = [
    { label: "Cicli", a: halves.first.cycles, b: halves.second.cycles },
    { label: "Velocità", a: halves.first.meanSpeed, b: halves.second.meanSpeed },
    { label: "Ritmo", a: halves.first.rhythmicity, b: halves.second.rhythmicity },
  ];

  const left = 40;
  const right = 16;
  const top = 18;
  const bottom = 34;
  const plotW = width - left - right;
  const plotH = height - top - bottom;

  const all = metrics.flatMap((m) => [m.a, m.b]).filter(Number.isFinite);
  let yMax = Math.max(...all, 1) * 1.15;

  drawAxes(ctx, left, top, plotW, plotH, 0, yMax, (v) => `${Math.round(v)}`);

  const groupW = plotW / metrics.length;
  const barW = Math.min(28, groupW * 0.22);

  metrics.forEach((m, i) => {
    const center = left + i * groupW + groupW / 2;
    const bars = [
      { value: m.a, x: center - barW - 4, color: "#2563eb" },
      { value: m.b, x: center + 4, color: "#60a5fa" },
    ];

    bars.forEach((bar) => {
      const barH = (bar.value / yMax) * plotH;
      const y = top + plotH - barH;
      ctx.fillStyle = bar.color;
      ctx.fillRect(bar.x, y, barW, barH);
    });

    ctx.fillStyle = "#334155";
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(m.label, center, top + plotH + 8);
  });

  ctx.fillStyle = "#64748b";
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("1ª metà", left, 4);
  ctx.fillStyle = "#2563eb";
  ctx.fillRect(left + 42, 6, 10, 10);
  ctx.fillStyle = "#64748b";
  ctx.fillText("2ª metà", left + 68, 4);
  ctx.fillStyle = "#60a5fa";
  ctx.fillRect(left + 112, 6, 10, 10);
}

export function drawCycleIntervals(canvas, intervalsMs) {
  if (!intervalsMs || intervalsMs.length < 1) {
    drawEmptyChart(canvas, "Intervalli ciclo non disponibili");
    return;
  }

  const samples = intervalsMs.map((v, i) => ({ t: i, value: v }));
  drawLineChart(
    canvas,
    samples,
    (s) => s.value,
    (v) => `${Math.round(v)} ms`,
    { lineColor: "#38bdf8" }
  );
}
