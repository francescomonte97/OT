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
  if (betaRange >= gammaRange) {
    return { axis: "deltaBeta", dominantRange: betaRange, secondaryRange: gammaRange };
  }
  return { axis: "deltaGamma", dominantRange: gammaRange, secondaryRange: betaRange };
}

function localExtrema(series) {
  const peaks = [];
  const valleys = [];
  for (let i = 1; i < series.length - 1; i++) {
    const prev = series[i - 1];
    const curr = series[i];
    const next = series[i + 1];
    if (![prev, curr, next].every(Number.isFinite)) continue;
    if (curr > prev && curr >= next) peaks.push(i);
    if (curr < prev && curr <= next) valleys.push(i);
  }
  return { peaks, valleys };
}

function nearestValleyBetween(valleyIdx, left, right) {
  const inside = valleyIdx.filter((v) => v > left && v < right);
  return inside.length ? inside[0] : null;
}

export function detectValidBBTCycles(samples, options = {}) {
  const opts = {
    smoothingWindow: options.smoothingWindow ?? 7,
    minPeakDistanceMs: options.minPeakDistanceMs ?? 480,
    minProminenceRatio: options.minProminenceRatio ?? 0.08,
    minCycleDurationMs: options.minCycleDurationMs ?? 500,
    maxCycleDurationMs: options.maxCycleDurationMs ?? 2000,
    minCycleAmplitudeDeg: options.minCycleAmplitudeDeg ?? 6,
    minLocalSpeed: options.minLocalSpeed ?? 8,
    maxLocalSpeed: options.maxLocalSpeed ?? 90,
    maxAsymmetryRatio: options.maxAsymmetryRatio ?? 3.2,
    minAxisDominanceRatio: options.minAxisDominanceRatio ?? 1.02,
  };

  if (!samples || samples.length < 8) {
    return {
      dominantAxis: "deltaBeta",
      smoothedAxis: [],
      peaks: [],
      valleys: [],
      validCycles: [],
      intervalsMs: [],
      cycleCount: 0,
      meanCycleMs: 0,
      cycleCv: 0,
      rhythmicityScore: 0,
      validityScore: 0,
    };
  }

  const axisInfo = chooseDominantAxis(samples);
  const dominantAxis = axisInfo.axis;
  const axisDominanceRatio = axisInfo.secondaryRange > 0
    ? axisInfo.dominantRange / axisInfo.secondaryRange
    : 10;
  const rawAxis = samples.map((s) => s[dominantAxis]);
  const smoothedAxis = movingAverage(rawAxis, opts.smoothingWindow);
  const clean = smoothedAxis.filter(Number.isFinite);
  const range = clean.length ? Math.max(...clean) - Math.min(...clean) : 0;
  const minProminence = Math.max(opts.minCycleAmplitudeDeg * 0.5, range * opts.minProminenceRatio);

  const { peaks: peakIdxRaw, valleys: valleyIdxRaw } = localExtrema(smoothedAxis);

  const candidatePeaks = [];
  let lastCandidatePeakTime = -Infinity;
  for (const pi of peakIdxRaw) {
    const t = samples[pi].t;
    if (t - lastCandidatePeakTime < opts.minPeakDistanceMs) continue;

    const left = Math.max(0, pi - 4);
    const right = Math.min(smoothedAxis.length - 1, pi + 4);
    let localMin = Number.POSITIVE_INFINITY;
    for (let k = left; k <= right; k++) {
      if (k === pi) continue;
      const v = smoothedAxis[k];
      if (Number.isFinite(v) && v < localMin) localMin = v;
    }
    const prominence = smoothedAxis[pi] - localMin;
    if (!Number.isFinite(prominence) || prominence < minProminence) continue;

    candidatePeaks.push(pi);
    lastCandidatePeakTime = t;
  }

  const validCycles = [];
  for (let i = 1; i < candidatePeaks.length; i++) {
    const prevPeak = candidatePeaks[i - 1];
    const currPeak = candidatePeaks[i];

    const cycleDurationMs = samples[currPeak].t - samples[prevPeak].t;
    if (cycleDurationMs < opts.minCycleDurationMs || cycleDurationMs > opts.maxCycleDurationMs) continue;

    const valley = nearestValleyBetween(valleyIdxRaw, prevPeak, currPeak);
    if (valley === null) continue;

    const ampA = smoothedAxis[prevPeak] - smoothedAxis[valley];
    const ampB = smoothedAxis[currPeak] - smoothedAxis[valley];
    const peakToValleyAmplitude = Math.max(ampA, ampB);
    if (!Number.isFinite(peakToValleyAmplitude) || peakToValleyAmplitude < opts.minCycleAmplitudeDeg) continue;

    const riseMs = samples[currPeak].t - samples[valley].t;
    const fallMs = samples[valley].t - samples[prevPeak].t;
    if (riseMs <= 0 || fallMs <= 0) continue;
    const asymmetry = Math.max(riseMs, fallMs) / Math.max(1, Math.min(riseMs, fallMs));
    if (asymmetry > opts.maxAsymmetryRatio) continue;

    const localSpeeds = samples
      .slice(prevPeak, currPeak + 1)
      .map((s) => s.speed)
      .filter(Number.isFinite);
    const localMeanSpeed = localSpeeds.length ? mean(localSpeeds) : 0;
    if (localMeanSpeed < opts.minLocalSpeed || localMeanSpeed > opts.maxLocalSpeed) continue;

    const slope1 = smoothedAxis[valley] - smoothedAxis[prevPeak];
    const slope2 = smoothedAxis[currPeak] - smoothedAxis[valley];
    const hasDirectionInversion = slope1 < 0 && slope2 > 0;
    if (!hasDirectionInversion) continue;

    validCycles.push({
      startPeakIndex: prevPeak,
      endPeakIndex: currPeak,
      valleyIndex: valley,
      timestamp: samples[currPeak].t,
      cycleDurationMs,
      peakToValleyAmplitude,
      localMeanSpeed,
      asymmetry,
    });
  }

  const dominanceGate = axisDominanceRatio >= opts.minAxisDominanceRatio;
  let acceptedCycles = dominanceGate ? validCycles.slice() : [];

  if (!acceptedCycles.length && candidatePeaks.length >= 3) {
    const relaxed = validCycles.filter((c) => c.peakToValleyAmplitude >= opts.minCycleAmplitudeDeg * 0.7);
    acceptedCycles = relaxed.slice(0, Math.max(0, relaxed.length));
  }

  const validPeakTimestamps = acceptedCycles.map((c) => c.timestamp);
  const intervalsMs = acceptedCycles.map((c) => c.cycleDurationMs);
  const cycleCount = acceptedCycles.length;
  const meanCycleMs = intervalsMs.length ? mean(intervalsMs) : 0;
  const cycleCv = intervalsMs.length > 1 ? cvPercent(intervalsMs) : 0;
  const rhythmicityScore = intervalsMs.length > 1 ? clamp(100 - cycleCv * 1.5, 0, 100) : 0;
  const validityScore = candidatePeaks.length
    ? clamp((cycleCount / candidatePeaks.length) * 100, 0, 100)
    : 0;

  return {
    dominantAxis,
    smoothedAxis,
    peaks: candidatePeaks.map((i) => ({ index: i, t: samples[i].t, value: smoothedAxis[i] })),
    valleys: valleyIdxRaw.map((i) => ({ index: i, t: samples[i].t, value: smoothedAxis[i] })),
    validCycles: acceptedCycles,
    validPeakTimestamps,
    intervalsMs,
    cycleCount,
    meanCycleMs,
    cycleCv,
    rhythmicityScore,
    validityScore,
  };
}
