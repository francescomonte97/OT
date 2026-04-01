import { mean, cvPercent, clamp } from "../core/utils.js";

function movingAverage(values, windowSize = 7) {
  if (!values?.length) return [];
  const safeWindow = Math.max(3, windowSize | 1);
  const half = Math.floor(safeWindow / 2);
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
  return betaRange >= gammaRange
    ? { axis: "deltaBeta", dominantRange: betaRange, secondaryRange: gammaRange }
    : { axis: "deltaGamma", dominantRange: gammaRange, secondaryRange: betaRange };
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

function findDeepestValleyBetween(valleyIndexes, series, left, right) {
  const inside = valleyIndexes.filter((v) => v > left && v < right);
  if (!inside.length) return null;

  let best = inside[0];
  let bestValue = series[best];
  for (const vi of inside) {
    if (series[vi] < bestValue) {
      best = vi;
      bestValue = series[vi];
    }
  }
  return best;
}

function buildAxisSpeed(samples, axisValues) {
  const speed = new Array(samples.length).fill(0);
  for (let i = 1; i < samples.length; i++) {
    const dt = Math.max(1, samples[i].t - samples[i - 1].t) / 1000;
    const prev = axisValues[i - 1];
    const curr = axisValues[i];
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) {
      speed[i] = speed[i - 1];
      continue;
    }
    speed[i] = Math.abs((curr - prev) / dt);
  }
  return movingAverage(speed, 5);
}

function emptyResult() {
  return {
    dominantAxis: "deltaBeta",
    smoothedAxis: [],
    peaks: [],
    valleys: [],
    validCycles: [],
    validPeakTimestamps: [],
    intervalsMs: [],
    cycleCount: 0,
    meanCycleMs: 0,
    cycleCv: 0,
    rhythmicityScore: 0,
    validityScore: 0,
  };
}

export function detectValidBBTCycles(samples, options = {}) {
  const opts = {
    smoothingWindow: options.smoothingWindow ?? 7,
    minPeakDistanceMs: options.minPeakDistanceMs ?? 520,
    minProminenceRatio: options.minProminenceRatio ?? 0.1,
    minCycleDurationMs: options.minCycleDurationMs ?? 500,
    maxCycleDurationMs: options.maxCycleDurationMs ?? 2000,
    minCycleAmplitudeDeg: options.minCycleAmplitudeDeg ?? 6,
    minLocalSpeed: options.minLocalSpeed ?? 8,
    maxLocalSpeed: options.maxLocalSpeed ?? 180,
    maxAsymmetryRatio: options.maxAsymmetryRatio ?? 3.2,
    minAxisDominanceRatio: options.minAxisDominanceRatio ?? 1.15,
    minValleyDwellMs: options.minValleyDwellMs ?? 80,
  };

  if (!samples || samples.length < 8) return emptyResult();

  const axisInfo = chooseDominantAxis(samples);
  const dominantAxis = axisInfo.axis;
  const axisDominanceRatio = axisInfo.secondaryRange > 0
    ? axisInfo.dominantRange / axisInfo.secondaryRange
    : 10;

  const rawAxis = samples.map((s) => s[dominantAxis]);
  const smoothedAxis = movingAverage(rawAxis, opts.smoothingWindow);
  const clean = smoothedAxis.filter(Number.isFinite);
  if (!clean.length) return { ...emptyResult(), dominantAxis };

  const range = Math.max(...clean) - Math.min(...clean);
  const minProminence = Math.max(opts.minCycleAmplitudeDeg * 0.45, range * opts.minProminenceRatio);

  const { peaks: localPeaks, valleys: localValleys } = localExtrema(smoothedAxis);
  const axisSpeed = buildAxisSpeed(samples, smoothedAxis);

  const candidatePeaks = [];
  let lastCandidatePeakTime = -Infinity;

  for (const pi of localPeaks) {
    const t = samples[pi].t;
    if (t - lastCandidatePeakTime < opts.minPeakDistanceMs) continue;

    const left = Math.max(0, pi - 5);
    const right = Math.min(smoothedAxis.length - 1, pi + 5);
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

    const valley = findDeepestValleyBetween(localValleys, smoothedAxis, prevPeak, currPeak);
    if (valley === null) continue;

    const ampA = smoothedAxis[prevPeak] - smoothedAxis[valley];
    const ampB = smoothedAxis[currPeak] - smoothedAxis[valley];
    const peakToValleyAmplitude = Math.min(ampA, ampB);
    if (!Number.isFinite(peakToValleyAmplitude) || peakToValleyAmplitude < opts.minCycleAmplitudeDeg) continue;

    const descentMs = samples[valley].t - samples[prevPeak].t;
    const ascentMs = samples[currPeak].t - samples[valley].t;
    if (descentMs <= 0 || ascentMs <= 0) continue;

    const asymmetry = Math.max(descentMs, ascentMs) / Math.max(1, Math.min(descentMs, ascentMs));
    if (asymmetry > opts.maxAsymmetryRatio) continue;

    const localAxisSpeeds = axisSpeed.slice(prevPeak, currPeak + 1).filter(Number.isFinite);
    const localSampleSpeeds = samples
      .slice(prevPeak, currPeak + 1)
      .map((s) => s.speed)
      .filter(Number.isFinite);
    const blendedSpeeds = [...localAxisSpeeds, ...localSampleSpeeds];
    const localMeanSpeed = blendedSpeeds.length ? mean(blendedSpeeds) : 0;

    if (localMeanSpeed < opts.minLocalSpeed || localMeanSpeed > opts.maxLocalSpeed) continue;

    const slopeDown = smoothedAxis[valley] - smoothedAxis[prevPeak];
    const slopeUp = smoothedAxis[currPeak] - smoothedAxis[valley];
    if (!(slopeDown < 0 && slopeUp > 0)) continue;

    const valleyBand = peakToValleyAmplitude * 0.2;
    let valleyDwellMs = 0;
    for (let j = prevPeak + 1; j <= currPeak; j++) {
      const prevT = samples[j - 1].t;
      const currT = samples[j].t;
      const dtMs = Math.max(0, currT - prevT);
      if (dtMs <= 0) continue;
      const inValleyBand =
        Number.isFinite(smoothedAxis[j]) &&
        Math.abs(smoothedAxis[j] - smoothedAxis[valley]) <= valleyBand;
      if (inValleyBand) valleyDwellMs += dtMs;
    }
    if (valleyDwellMs < opts.minValleyDwellMs) continue;

    validCycles.push({
      startPeakIndex: prevPeak,
      endPeakIndex: currPeak,
      valleyIndex: valley,
      timestamp: samples[currPeak].t,
      cycleDurationMs,
      peakToValleyAmplitude,
      localMeanSpeed,
      asymmetry,
      valleyDwellMs,
    });
  }

  const dominanceGate = axisDominanceRatio >= opts.minAxisDominanceRatio;
  const acceptedCycles = dominanceGate ? validCycles : [];

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
    valleys: localValleys.map((i) => ({ index: i, t: samples[i].t, value: smoothedAxis[i] })),
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
