import { mean, clamp } from "../core/utils.js";
import { detectCycles } from "./cycles.js";

function percentile(values, q) {
  if (!values || !values.length) return 0;
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const pos = clamp(q, 0, 1) * (sorted.length - 1);
  const base = Math.floor(pos);
  const rest = pos - base;
  if (base + 1 >= sorted.length) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function robustRange(values, lowQ = 0.05, highQ = 0.95) {
  const clean = (values || []).filter(Number.isFinite);
  if (clean.length < 3) return 0;
  return Math.max(0, percentile(clean, highQ) - percentile(clean, lowQ));
}

function detrend(samples, key) {
  if (!samples || samples.length < 3) return [];
  const first = samples[0][key];
  const last = samples[samples.length - 1][key];
  if (!Number.isFinite(first) || !Number.isFinite(last)) return [];

  const t0 = samples[0].t;
  const t1 = samples[samples.length - 1].t;
  const total = Math.max(1, t1 - t0);

  return samples
    .map((s) => {
      if (!Number.isFinite(s[key])) return null;
      const ratio = (s.t - t0) / total;
      const baseline = first + (last - first) * ratio;
      return s[key] - baseline;
    })
    .filter(Number.isFinite);
}

function halfStats(samples, startT, endT, cyclePeaks) {
  const subset = samples.filter((s) => s.t >= startT && s.t <= endT);
  if (subset.length < 2) return { meanSpeed: 0, cycles: 0, rhythmicity: 0 };

  const speeds = [];
  for (let i = 1; i < subset.length; i++) {
    const prev = subset[i - 1];
    const curr = subset[i];
    const dt = curr.t - prev.t;
    if (dt <= 0) continue;
    const v = (prev.speed + curr.speed) / 2;
    if (Number.isFinite(v)) speeds.push(v);
  }

  const halfPeaks = cyclePeaks.filter((t) => t >= startT && t <= endT);
  const intervals = [];
  for (let i = 1; i < halfPeaks.length; i++) intervals.push(halfPeaks[i] - halfPeaks[i - 1]);
  const cv = intervals.length > 1 ? percentile(intervals, 0.75) > 0 ? (Math.sqrt(intervals.map((x) => (x - mean(intervals)) ** 2).reduce((a, b) => a + b, 0) / (intervals.length - 1)) / mean(intervals)) * 100 : 0 : 0;

  return {
    meanSpeed: speeds.length ? mean(speeds) : 0,
    cycles: halfPeaks.length,
    rhythmicity: clamp(100 - cv, 0, 100),
  };
}

export function computeBBTMetrics(samples, blocksTransferred = null, opts = {}) {
  if (!samples || samples.length < 2) return null;

  const firstT = samples[0].t;
  const lastT = samples[samples.length - 1].t;
  const totalTimeMs = Math.max(1, lastT - firstT);

  const speeds = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    const dt = curr.t - prev.t;
    if (dt <= 0) continue;
    const v = (prev.speed + curr.speed) / 2;
    if (Number.isFinite(v)) speeds.push(v);
  }

  const cycles = detectCycles(samples, {
    smoothingWindow: opts.smoothingWindow ?? 7,
    minProminenceRatio: opts.minProminenceRatio ?? 0.08,
    minPeakDistanceMs: opts.minPeakDistanceMs ?? 480,
  });

  const meanTaskSpeed = speeds.length ? mean(speeds) : 0;
  const peakSpeed = speeds.length ? percentile(speeds, 0.98) : 0;

  const betaDetrended = detrend(samples, "deltaBeta");
  const gammaDetrended = detrend(samples, "deltaGamma");
  const workspaceBeta = clamp(robustRange(betaDetrended, 0.05, 0.95), 0, 120);
  const workspaceGamma = clamp(robustRange(gammaDetrended, 0.05, 0.95), 0, 120);

  const midT = firstT + totalTimeMs / 2;
  const firstHalf = halfStats(samples, firstT, midT, cycles.peakTimestamps);
  const secondHalf = halfStats(samples, midT, lastT, cycles.peakTimestamps);

  const fatigueIndex = firstHalf.cycles > 0 ? (secondHalf.cycles / firstHalf.cycles) * 100 : 0;
  const estimatedBlocks = Math.round(cycles.cycleCount * 0.95);

  return {
    totalTimeMs,
    blocksTransferred,
    estimatedBlocks,
    meanTaskSpeed,
    peakSpeed,

    cycleCount: cycles.cycleCount,
    peakTimestamps: cycles.peakTimestamps,
    cycleIntervalsMs: cycles.intervalsMs,
    meanCycleMs: cycles.meanCycleMs,
    cycleCv: cycles.cycleCv,
    rhythmicityScore: cycles.rhythmicityScore,

    fatigueIndex,
    workspaceBeta,
    workspaceGamma,

    halves: {
      first: {
        cycles: firstHalf.cycles,
        meanSpeed: firstHalf.meanSpeed,
        rhythmicity: firstHalf.rhythmicity,
      },
      second: {
        cycles: secondHalf.cycles,
        meanSpeed: secondHalf.meanSpeed,
        rhythmicity: secondHalf.rhythmicity,
      },
    },

    advanced: {
      estimatedBlocksExperimental: estimatedBlocks,
      dominantAxis: cycles.axisKey,
    },

    samples: samples.slice(),
  };
}

export function computeSummary(trials) {
  if (!trials || !trials.length) return null;

  const blocks = trials.map((t) => t.blocksTransferred).filter(Number.isFinite);
  const estimated = trials.map((t) => t.estimatedBlocks).filter(Number.isFinite);
  const rhythmicity = trials.map((t) => t.rhythmicityScore).filter(Number.isFinite);
  const fatigue = trials.map((t) => t.fatigueIndex).filter(Number.isFinite);
  const cycles = trials.map((t) => t.cycleCount).filter(Number.isFinite);
  const speeds = trials.map((t) => t.meanTaskSpeed).filter(Number.isFinite);

  return {
    meanBlocks: blocks.length ? mean(blocks) : null,
    bestBlocks: blocks.length ? Math.max(...blocks) : null,
    meanEstimatedBlocks: estimated.length ? mean(estimated) : null,
    meanRhythmicity: rhythmicity.length ? mean(rhythmicity) : null,
    meanFatigue: fatigue.length ? mean(fatigue) : null,
    meanCycleCount: cycles.length ? mean(cycles) : null,
    meanTaskSpeed: speeds.length ? mean(speeds) : null,
  };
}
