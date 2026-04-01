import { mean, cvPercent, clamp } from "../core/utils.js";

function movingAverage(values, windowSize = 7) {
  if (!values?.length) return [];
  const half = Math.floor(windowSize / 2);
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < values.length && Number.isFinite(values[j])) {
        sum += values[j];
        n++;
      }
    }
    return n ? sum / n : values[i];
  });
}

function chooseDominantAxis(samples) {
  const beta = samples.map((s) => s.deltaBeta).filter(Number.isFinite);
  const gamma = samples.map((s) => s.deltaGamma).filter(Number.isFinite);
  const betaRange = beta.length ? Math.max(...beta) - Math.min(...beta) : 0;
  const gammaRange = gamma.length ? Math.max(...gamma) - Math.min(...gamma) : 0;
  return betaRange >= gammaRange ? "deltaBeta" : "deltaGamma";
}

export function detectCycles(samples, opts = {}) {
  if (!samples || samples.length < 6) {
    return {
      axisKey: "deltaBeta",
      cycleCount: 0,
      peakTimestamps: [],
      intervalsMs: [],
      meanCycleMs: 0,
      cycleCv: 0,
      rhythmicityScore: 0,
    };
  }

  const axisKey = chooseDominantAxis(samples);
  const raw = samples.map((s) => s[axisKey]);
  const smooth = movingAverage(raw, opts.smoothingWindow ?? 7);
  const clean = smooth.filter(Number.isFinite);
  const range = clean.length ? Math.max(...clean) - Math.min(...clean) : 0;
  const minProminence = Math.max(1.5, range * (opts.minProminenceRatio ?? 0.12));
  const minPeakDistanceMs = opts.minPeakDistanceMs ?? 520;

  const peaks = [];
  let lastPeakTime = -Infinity;
  const prominenceWindow = Math.max(4, Math.floor((opts.prominenceWindow ?? 11) / 2));

  for (let i = 2; i < smooth.length - 2; i++) {
    const v = smooth[i];
    if (!Number.isFinite(v)) continue;
    const prev = smooth[i - 1];
    const next = smooth[i + 1];
    if (!(v > prev && v >= next)) continue;

    const left = Math.max(0, i - prominenceWindow);
    const right = Math.min(smooth.length - 1, i + prominenceWindow);
    let localMin = Number.POSITIVE_INFINITY;
    for (let k = left; k <= right; k++) {
      if (k === i) continue;
      if (Number.isFinite(smooth[k]) && smooth[k] < localMin) localMin = smooth[k];
    }
    if (!Number.isFinite(localMin)) continue;
    const prominence = v - localMin;
    if (prominence < minProminence) continue;

    const t = samples[i].t;
    if (t - lastPeakTime < minPeakDistanceMs) continue;

    peaks.push({ index: i, t, value: v });
    lastPeakTime = t;
  }

  const peakTimestamps = peaks.map((p) => p.t);
  const intervalsMs = [];
  for (let i = 1; i < peakTimestamps.length; i++) {
    const d = peakTimestamps[i] - peakTimestamps[i - 1];
    if (d > 0) intervalsMs.push(d);
  }

  const meanCycleMs = intervalsMs.length ? mean(intervalsMs) : 0;
  const cycleCv = intervalsMs.length > 1 ? cvPercent(intervalsMs) : 0;
  const rhythmicityScore = intervalsMs.length > 1 ? clamp(100 - cycleCv, 0, 100) : 0;

  return {
    axisKey,
    cycleCount: peaks.length,
    peakTimestamps,
    intervalsMs,
    meanCycleMs,
    cycleCv,
    rhythmicityScore,
  };
}
