import { mean, cvPercent, clamp } from "../core/utils.js";

function movingAverage(values, windowSize = 5) {
  if (!values.length) return [];
  const out = [];

  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let count = 0;

    for (let j = i - Math.floor(windowSize / 2); j <= i + Math.floor(windowSize / 2); j++) {
      if (j >= 0 && j < values.length && Number.isFinite(values[j])) {
        sum += values[j];
        count++;
      }
    }

    out.push(count ? sum / count : values[i]);
  }

  return out;
}

function countDirectionalExtrema(samples) {
  const betaVals = samples.map((s) => s.deltaBeta).filter(Number.isFinite);
  const gammaVals = samples.map((s) => s.deltaGamma).filter(Number.isFinite);

  if (betaVals.length < 6 || gammaVals.length < 6) {
    return 0;
  }

  const betaRange = Math.max(...betaVals) - Math.min(...betaVals);
  const gammaRange = Math.max(...gammaVals) - Math.min(...gammaVals);

  const axisKey = betaRange >= gammaRange ? "deltaBeta" : "deltaGamma";
  const axisVals = samples.map((s) => s[axisKey]).filter(Number.isFinite);

  if (axisVals.length < 6) return 0;

  const smoothed = movingAverage(axisVals, 5);
  const axisRange = Math.max(...smoothed) - Math.min(...smoothed);
  const minAmplitude = Math.max(3, axisRange * 0.08);

  let extrema = 0;
  let lastExtremeValue = smoothed[0];
  let lastExtremeTime = samples[0].t;

  for (let i = 2; i < smoothed.length - 2; i++) {
    const prevSlope = smoothed[i] - smoothed[i - 1];
    const nextSlope = smoothed[i + 1] - smoothed[i];

    const isPeak = prevSlope > 0 && nextSlope <= 0;
    const isTrough = prevSlope < 0 && nextSlope >= 0;
    if (!isPeak && !isTrough) continue;

    const currentValue = smoothed[i];
    const currentTime = samples[i].t;

    const amplitudeOk = Math.abs(currentValue - lastExtremeValue) >= minAmplitude;
    const timeOk = currentTime - lastExtremeTime >= 300;

    if (amplitudeOk && timeOk) {
      extrema++;
      lastExtremeValue = currentValue;
      lastExtremeTime = currentTime;
    }
  }

  return extrema;
}

function estimateBlocksFromMotion({
  burstCount,
  activeTimeMs,
  meanBurstMs,
  activeMeanSpeed,
  smoothnessScore,
  directionalExtrema,
}) {
  const activeTimeSec = activeTimeMs / 1000;

  const cadenceEstimate =
    Number.isFinite(meanBurstMs) && meanBurstMs > 0
      ? activeTimeMs / Math.max(meanBurstMs + 180, 450)
      : 0;

  const burstEstimate = burstCount;
  const extremaEstimate = directionalExtrema > 0 ? Math.max(0, directionalExtrema - 1) : 0;

  const speedFactor = clamp(activeMeanSpeed / 70, 0.75, 1.25);
  const smoothnessFactor = clamp(smoothnessScore / 75, 0.75, 1.20);
  const activityFactor = clamp(activeTimeSec / 35, 0.75, 1.20);

  const raw =
    (0.45 * burstEstimate + 0.35 * cadenceEstimate + 0.20 * extremaEstimate) *
    speedFactor *
    smoothnessFactor *
    activityFactor;

  return Math.max(0, Math.round(raw));
}

function windowMetrics(samples, opts, startT, endT) {
  const subset = samples.filter((s) => s.t >= startT && s.t <= endT);
  if (subset.length < 2) {
    return {
      activeTimeMs: 0,
      activeMeanSpeed: 0,
      pauseLoadPct: 0,
      totalTimeMs: Math.max(0, endT - startT),
    };
  }

  let activeTimeMs = 0;
  let pauseTimeMs = 0;
  const activeSpeeds = [];
  let activeRunMs = 0;
  let activeRunSpeeds = [];
  const minGoalRunMs = opts.minGoalRunMs ?? 220;

  for (let i = 1; i < subset.length; i++) {
    const prev = subset[i - 1];
    const curr = subset[i];
    const dt = curr.t - prev.t;
    if (dt <= 0) continue;

    const speedAvg = (prev.speed + curr.speed) / 2;
    if (!Number.isFinite(speedAvg)) continue;
    const stepDelta =
      Number.isFinite(prev.deltaBeta) &&
      Number.isFinite(prev.deltaGamma) &&
      Number.isFinite(curr.deltaBeta) &&
      Number.isFinite(curr.deltaGamma)
        ? Math.hypot(curr.deltaBeta - prev.deltaBeta, curr.deltaGamma - prev.deltaGamma)
        : 0;
    const isGoalDirected = stepDelta >= (opts.minStepDeltaDeg ?? 0.18);

    if (speedAvg > opts.activeSpeedThreshold && isGoalDirected) {
      activeRunMs += dt;
      activeRunSpeeds.push(speedAvg);
    } else if (activeRunMs > 0) {
      if (activeRunMs >= minGoalRunMs) {
        activeTimeMs += activeRunMs;
        activeSpeeds.push(...activeRunSpeeds);
      }
      activeRunMs = 0;
      activeRunSpeeds = [];
    }

    if (speedAvg < opts.pauseSpeedThreshold) {
      pauseTimeMs += dt;
    }
  }
  if (activeRunMs >= minGoalRunMs) {
    activeTimeMs += activeRunMs;
    activeSpeeds.push(...activeRunSpeeds);
  }

  const totalTimeMs = Math.max(1, subset[subset.length - 1].t - subset[0].t);

  return {
    activeTimeMs,
    activeMeanSpeed: activeSpeeds.length ? mean(activeSpeeds) : 0,
    pauseLoadPct: (pauseTimeMs / totalTimeMs) * 100,
    totalTimeMs,
  };
}

function computeSmoothness(pauseLoad, burstCount, burstDurations, totalTimeMs) {
  const totalSec = Math.max(1, totalTimeMs / 1000);
  const burstRate = burstCount / totalSec;
  const burstCv = cvPercent(burstDurations);

  const pausePenalty = pauseLoad * 0.8;
  const burstPenalty = Math.max(0, burstRate - 0.6) * 18;
  const cvPenalty = burstCv * 0.25;

  return clamp(100 - pausePenalty - burstPenalty - cvPenalty, 0, 100);
}

function computeJerkProxy(samples) {
  if (!samples || samples.length < 3) return 0;
  const jerkAbs = [];

  for (let i = 2; i < samples.length; i++) {
    const a = samples[i - 2];
    const b = samples[i - 1];
    const c = samples[i];
    const dt1 = (b.t - a.t) / 1000;
    const dt2 = (c.t - b.t) / 1000;
    if (dt1 <= 0 || dt2 <= 0) continue;

    const acc1 = (b.speed - a.speed) / dt1;
    const acc2 = (c.speed - b.speed) / dt2;
    const dtAcc = (c.t - a.t) / 1000;
    if (dtAcc <= 0) continue;

    const jerk = (acc2 - acc1) / dtAcc;
    if (Number.isFinite(jerk)) jerkAbs.push(Math.abs(jerk));
  }

  return jerkAbs.length ? mean(jerkAbs) : 0;
}

function computeRhythmicityIndex(burstCenters, totalTimeMs) {
  if (!burstCenters || burstCenters.length < 3 || totalTimeMs <= 0) return 0;
  const intervals = [];

  for (let i = 1; i < burstCenters.length; i++) {
    const d = burstCenters[i] - burstCenters[i - 1];
    if (d > 0) intervals.push(d);
  }

  if (intervals.length < 2) return 0;
  const cv = cvPercent(intervals);
  return clamp(100 - cv, 0, 100);
}

function computeStabilityAtRest(samples, pauseSpeedThreshold = 5) {
  if (!samples || samples.length < 3) return 0;

  const lowSpeed = samples.filter((s) => Number.isFinite(s.speed) && s.speed < pauseSpeedThreshold);
  if (lowSpeed.length < 3) return 0;

  const deltas = lowSpeed
    .map((s) => {
      if (!Number.isFinite(s.deltaBeta) || !Number.isFinite(s.deltaGamma)) return null;
      return Math.sqrt(s.deltaBeta * s.deltaBeta + s.deltaGamma * s.deltaGamma);
    })
    .filter(Number.isFinite);

  if (deltas.length < 3) return 0;

  const drift = cvPercent(deltas);
  return clamp(100 - drift, 0, 100);
}

function computeCompensationIndex(workspaceBeta, workspaceGamma) {
  if (!Number.isFinite(workspaceBeta) || !Number.isFinite(workspaceGamma)) return 0;
  const dominant = Math.max(workspaceBeta, workspaceGamma, 0.001);
  const orthogonal = Math.min(workspaceBeta, workspaceGamma, dominant);
  return clamp((orthogonal / dominant) * 100, 0, 100);
}

export function computeBBTMetrics(samples, blocksTransferred = null, opts = {}) {
  if (!samples || samples.length < 2) return null;

  const activeSpeedThreshold = opts.activeSpeedThreshold ?? 28;
  const pauseSpeedThreshold = opts.pauseSpeedThreshold ?? 14;
  const pauseMinMs = opts.pauseMinMs ?? 700;
  const burstMinMs = opts.burstMinMs ?? 500;
  const minStepDeltaDeg = opts.minStepDeltaDeg ?? 0.50;
  const minGoalRunMs = opts.minGoalRunMs ?? 320;

  const firstT = samples[0].t;
  const lastT = samples[samples.length - 1].t;
  const totalTimeMs = Math.max(1, lastT - firstT);

  let activeTimeMs = 0;
  let pauseTimeMs = 0;
  const activeSpeeds = [];
  const allSpeeds = [];

  let inPause = false;
  let pauseStart = null;
  const pauseDurations = [];

  let inBurst = false;
  let burstStart = null;
  const burstDurations = [];
  let activeRunMs = 0;
  let activeRunSpeeds = [];

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    const dt = curr.t - prev.t;
    if (dt <= 0) continue;

    const speedAvg = (prev.speed + curr.speed) / 2;
    if (!Number.isFinite(speedAvg)) continue;
    const stepDelta =
      Number.isFinite(prev.deltaBeta) &&
      Number.isFinite(prev.deltaGamma) &&
      Number.isFinite(curr.deltaBeta) &&
      Number.isFinite(curr.deltaGamma)
        ? Math.hypot(curr.deltaBeta - prev.deltaBeta, curr.deltaGamma - prev.deltaGamma)
        : 0;
    const isGoalDirected = stepDelta >= minStepDeltaDeg;

    allSpeeds.push(speedAvg);

    if (speedAvg > activeSpeedThreshold && isGoalDirected) {
      activeRunMs += dt;
      activeRunSpeeds.push(speedAvg);

      if (!inBurst) {
        inBurst = true;
        burstStart = prev.t;
      }
    } else {
      if (activeRunMs >= minGoalRunMs) {
        activeTimeMs += activeRunMs;
        activeSpeeds.push(...activeRunSpeeds);
      }
      activeRunMs = 0;
      activeRunSpeeds = [];

      if (inBurst && burstStart !== null) {
        const burstMs = prev.t - burstStart;
        if (burstMs >= burstMinMs) burstDurations.push(burstMs);
        inBurst = false;
        burstStart = null;
      }
    }

    if (speedAvg < pauseSpeedThreshold) {
      pauseTimeMs += dt;

      if (!inPause) {
        inPause = true;
        pauseStart = prev.t;
      }
    } else if (inPause && pauseStart !== null) {
      const pauseMs = prev.t - pauseStart;
      if (pauseMs >= pauseMinMs) pauseDurations.push(pauseMs);
      inPause = false;
      pauseStart = null;
    }
  }

  if (inPause && pauseStart !== null) {
    const pauseMs = lastT - pauseStart;
    if (pauseMs >= pauseMinMs) pauseDurations.push(pauseMs);
  }

  if (inBurst && burstStart !== null) {
    const burstMs = lastT - burstStart;
    if (burstMs >= burstMinMs) burstDurations.push(burstMs);
  }
  if (activeRunMs >= minGoalRunMs) {
    activeTimeMs += activeRunMs;
    activeSpeeds.push(...activeRunSpeeds);
  }

  const activityRatio = (activeTimeMs / totalTimeMs) * 100;
  const idleTimeMs = Math.max(0, totalTimeMs - activeTimeMs);
  const pauseLoad = (pauseTimeMs / totalTimeMs) * 100;
  const activeMeanSpeed = activeSpeeds.length ? mean(activeSpeeds) : 0;
  const peakSpeed = allSpeeds.length ? Math.max(...allSpeeds) : 0;
  const meanPauseMs = pauseDurations.length ? mean(pauseDurations) : 0;
  const meanBurstMs = burstDurations.length ? mean(burstDurations) : 0;

  const betas = samples.map((s) => s.deltaBeta).filter(Number.isFinite);
  const gammas = samples.map((s) => s.deltaGamma).filter(Number.isFinite);

  const workspaceBeta = betas.length ? Math.max(...betas) - Math.min(...betas) : 0;
  const workspaceGamma = gammas.length ? Math.max(...gammas) - Math.min(...gammas) : 0;
  const workspaceArea = workspaceBeta * workspaceGamma;

  const midT = firstT + totalTimeMs / 2;
  const firstHalf = windowMetrics(
    samples,
    { activeSpeedThreshold, pauseSpeedThreshold, minStepDeltaDeg, minGoalRunMs },
    firstT,
    midT
  );
  const secondHalf = windowMetrics(
    samples,
    { activeSpeedThreshold, pauseSpeedThreshold, minStepDeltaDeg, minGoalRunMs },
    midT,
    lastT
  );

  const fatigueIndex =
    firstHalf.activeMeanSpeed > 0
      ? (secondHalf.activeMeanSpeed / firstHalf.activeMeanSpeed) * 100
      : 0;

  const smoothnessScore = computeSmoothness(
    pauseLoad,
    burstDurations.length,
    burstDurations,
    totalTimeMs
  );
  const jerkProxy = computeJerkProxy(samples);
  const stabilityAtRest = computeStabilityAtRest(samples, pauseSpeedThreshold);
  const compensationIndex = computeCompensationIndex(workspaceBeta, workspaceGamma);

  const directionalExtrema = countDirectionalExtrema(samples);

  const estimatedBlocks = estimateBlocksFromMotion({
    burstCount: burstDurations.length,
    activeTimeMs,
    meanBurstMs,
    activeMeanSpeed,
    smoothnessScore,
    directionalExtrema,
  });
  const burstCenters = burstDurations.length
    ? (() => {
        const centers = [];
        let inBurstCenter = false;
        let burstStart = null;
        for (let i = 1; i < samples.length; i++) {
          const prev = samples[i - 1];
          const curr = samples[i];
          const speedAvg = (prev.speed + curr.speed) / 2;

          const stepDelta =
            Number.isFinite(prev.deltaBeta) &&
            Number.isFinite(prev.deltaGamma) &&
            Number.isFinite(curr.deltaBeta) &&
            Number.isFinite(curr.deltaGamma)
              ? Math.hypot(curr.deltaBeta - prev.deltaBeta, curr.deltaGamma - prev.deltaGamma)
              : 0;
          const isGoalDirected = stepDelta >= minStepDeltaDeg;

          if (speedAvg > activeSpeedThreshold && isGoalDirected && !inBurstCenter) {
            inBurstCenter = true;
            burstStart = prev.t;
          } else if ((!isGoalDirected || speedAvg <= activeSpeedThreshold) && inBurstCenter && burstStart !== null) {
            const end = prev.t;
            if (end - burstStart >= burstMinMs) {
              centers.push((burstStart + end) / 2);
            }
            inBurstCenter = false;
            burstStart = null;
          }
        }
        if (inBurstCenter && burstStart !== null) {
          const end = samples[samples.length - 1].t;
          if (end - burstStart >= burstMinMs) centers.push((burstStart + end) / 2);
        }
        return centers;
      })()
    : [];
  const rhythmicityIndex = computeRhythmicityIndex(burstCenters, totalTimeMs);

  return {
    totalTimeMs,
    activeTimeMs,
    idleTimeMs,
    activityRatio,
    pauseCount: pauseDurations.length,
    pauseLoad,
    meanPauseMs,
    pauseTotalMs: pauseTimeMs,

    burstCount: burstDurations.length,
    meanBurstMs,
    burstCv: cvPercent(burstDurations),

    activeMeanSpeed,
    peakSpeed,
    fatigueIndex,

    workspaceBeta,
    workspaceGamma,
    workspaceArea,

    smoothnessScore,
    jerkProxy,
    rhythmicityIndex,
    stabilityAtRest,
    compensationIndex,
    directionalExtrema,
    estimatedBlocks,
    blocksTransferred,
    samples: samples.slice(),

    halves: {
      first: {
        activeTimeSec: firstHalf.activeTimeMs / 1000,
        activeMeanSpeed: firstHalf.activeMeanSpeed,
        pauseLoadPct: firstHalf.pauseLoadPct,
      },
      second: {
        activeTimeSec: secondHalf.activeTimeMs / 1000,
        activeMeanSpeed: secondHalf.activeMeanSpeed,
        pauseLoadPct: secondHalf.pauseLoadPct,
      },
    },
  };
}

export function computeSummary(trials) {
  if (!trials || !trials.length) return null;

  const blocks = trials.map((t) => t.blocksTransferred).filter(Number.isFinite);
  const estimatedBlocks = trials.map((t) => t.estimatedBlocks).filter(Number.isFinite);
  const activeTimes = trials.map((t) => t.activeTimeMs).filter(Number.isFinite);
  const pauseCounts = trials.map((t) => t.pauseCount).filter(Number.isFinite);
  const burstCounts = trials.map((t) => t.burstCount).filter(Number.isFinite);
  const activeSpeeds = trials.map((t) => t.activeMeanSpeed).filter(Number.isFinite);
  const peaks = trials.map((t) => t.peakSpeed).filter(Number.isFinite);
  const smoothness = trials.map((t) => t.smoothnessScore).filter(Number.isFinite);
  const rhythmicity = trials.map((t) => t.rhythmicityIndex).filter(Number.isFinite);
  const stability = trials.map((t) => t.stabilityAtRest).filter(Number.isFinite);
  const compensation = trials.map((t) => t.compensationIndex).filter(Number.isFinite);
  const jerk = trials.map((t) => t.jerkProxy).filter(Number.isFinite);

  return {
    meanBlocks: blocks.length ? mean(blocks) : null,
    bestBlocks: blocks.length ? Math.max(...blocks) : null,
    meanEstimatedBlocks: estimatedBlocks.length ? mean(estimatedBlocks) : null,
    meanActiveTime: activeTimes.length ? mean(activeTimes) : null,
    meanPauseCount: pauseCounts.length ? mean(pauseCounts) : null,
    meanBurstCount: burstCounts.length ? mean(burstCounts) : null,
    meanActiveSpeed: activeSpeeds.length ? mean(activeSpeeds) : null,
    bestPeakSpeed: peaks.length ? Math.max(...peaks) : null,
    meanSmoothness: smoothness.length ? mean(smoothness) : null,
    meanRhythmicity: rhythmicity.length ? mean(rhythmicity) : null,
    meanStabilityAtRest: stability.length ? mean(stability) : null,
    meanCompensation: compensation.length ? mean(compensation) : null,
    meanJerk: jerk.length ? mean(jerk) : null,
  };
}
