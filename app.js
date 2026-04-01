import {
  mean,
  std,
  lowPass,
  clamp,
  formatDeg,
  formatSpeed,
  formatInt,
  formatTimerMs,
} from "./core/utils.js";
import { playEndBeep } from "./core/audio.js";
import {
  drawLineChart,
  drawBarChart,
  drawDualBarChart,
  drawWorkspaceScatter,
  drawHalvesComparison,
  drawCycleIntervals,
} from "./core/charts.js";
import { computeBBTMetrics, computeSummary } from "./metrics/bbtMetrics.js";

(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);

  const ui = {
    enableBtn: byId("enableBtn"),
    calibrateBtn: byId("calibrateBtn"),
    startTestBtn: byId("startTestBtn"),
    resetBtn: byId("resetBtn"),
    saveTrialBtn: byId("saveTrialBtn"),

    sideSelect: byId("sideSelect"),
    blocksSaveInput: byId("blocksSaveInput"),

    status: byId("status"),
    statusText: byId("statusText"),
    supportInfo: byId("supportInfo"),
    phase: byId("phase"),
    baselineReady: byId("baselineReady"),
    trialBadge: byId("trialBadge"),
    stepHint: byId("stepHint"),

    testTimer: byId("testTimer"),
    timerStateText: byId("timerStateText"),
    progressFill: byId("progressFill"),

    rawBeta: byId("rawBeta"),
    rawGamma: byId("rawGamma"),
    deltaBeta: byId("deltaBeta"),
    deltaGamma: byId("deltaGamma"),
    liveSpeed: byId("liveSpeed"),
    calibrationSamples: byId("calibrationSamples"),
    gestureSamples: byId("gestureSamples"),

    blocksCount: byId("blocksCount"),
    estimatedBlocks: byId("estimatedBlocks"),
    cycleCount: byId("cycleCount"),
    meanCycleMs: byId("meanCycleMs"),
    cycleCv: byId("cycleCv"),
    meanTaskSpeed: byId("meanTaskSpeed"),
    peakSpeed: byId("peakSpeed"),
    fatigueIndex: byId("fatigueIndex"),
    workspaceBeta: byId("workspaceBeta"),
    workspaceGamma: byId("workspaceGamma"),
    rhythmicity: byId("rhythmicity"),
    estBlocksAdv: byId("estBlocksAdv"),

    meanBlocks: byId("meanBlocks"),
    bestBlocks: byId("bestBlocks"),
    meanEstimatedBlocks: byId("meanEstimatedBlocks"),
    meanCycleCount: byId("meanCycleCount"),
    meanTaskSpeedSummary: byId("meanTaskSpeedSummary"),
    meanRhythmicity: byId("meanRhythmicity"),
    meanFatigue: byId("meanFatigue"),

    speedChart: byId("speedChart"),
    cycleIntervalsChart: byId("cycleIntervalsChart"),
    halvesChart: byId("halvesChart"),
    workspaceChart: byId("workspaceChart"),
    blocksCompareChart: byId("blocksCompareChart"),
    rhythmicityTrialsChart: byId("rhythmicityTrialsChart"),
  };

  const state = {
    sensorsEnabled: false,
    listenerAttached: false,
    hasOrientationEvent: false,

    rawBeta: null,
    rawGamma: null,
    filteredBeta: null,
    filteredGamma: null,
    previousFilteredBeta: null,
    previousFilteredGamma: null,
    filterAlpha: 0.22,

    lastTimestampMs: null,
    motionSpeedRaw: 0,
    motionSpeed: 0,
    motionSpeedAlpha: 0.35,

    betaBaseline: null,
    gammaBaseline: null,
    calibrationValuesBeta: [],
    calibrationValuesGamma: [],
    isCalibrating: false,

    phase: "idle",
    prepDelayMs: 1000,
    calibrationDurationMs: 2000,
    countdownMs: 3000,
    testDurationMs: 60000,

    metricOptions: {
      smoothingWindow: 7,
      minProminenceRatio: 0.08,
      minPeakDistanceMs: 480,
      minCycleDurationMs: 500,
      maxCycleDurationMs: 2000,
      minCycleAmplitudeDeg: 6,
      minLocalSpeed: 8,
      maxLocalSpeed: 50,
      maxAsymmetryRatio: 3.2,
      minAxisDominanceRatio: 1.15,
    },

    currentTrial: 1,
    maxTrials: 3,

    currentSamples: [],
    currentMetrics: null,
    trials: [],
    summary: null,

    prepTimerId: null,
    calibrationTimerId: null,
    countdownTimerId: null,
    recordingStopTimerId: null,
    timerIntervalId: null,

    recordingStartMs: null,
    recordingStopAtMs: null,
    countdownEndsAtMs: null,

    chartFrameRequested: false,
  };

  function setStatus(message, mode = "warn") {
    ui.status.className = `status ${mode}`;
    ui.statusText.textContent = `Stato: ${message}`;
  }

  function setSupportInfo(message) {
    ui.supportInfo.textContent = message;
  }

  function setPhase(phase) {
    state.phase = phase;
  }

  function clearTimers() {
    if (state.prepTimerId) clearTimeout(state.prepTimerId);
    if (state.calibrationTimerId) clearTimeout(state.calibrationTimerId);
    if (state.countdownTimerId) clearTimeout(state.countdownTimerId);
    if (state.recordingStopTimerId) clearTimeout(state.recordingStopTimerId);
    if (state.timerIntervalId) clearInterval(state.timerIntervalId);

    state.prepTimerId = null;
    state.calibrationTimerId = null;
    state.countdownTimerId = null;
    state.recordingStopTimerId = null;
    state.timerIntervalId = null;
  }

  function scheduleChartDraw() {
    if (state.chartFrameRequested) return;
    state.chartFrameRequested = true;
    requestAnimationFrame(() => {
      state.chartFrameRequested = false;
      drawAllCharts();
    });
  }

  function makeSample(t) {
    const deltaBeta =
      Number.isFinite(state.filteredBeta) && Number.isFinite(state.betaBaseline)
        ? state.filteredBeta - state.betaBaseline
        : null;

    const deltaGamma =
      Number.isFinite(state.filteredGamma) && Number.isFinite(state.gammaBaseline)
        ? state.filteredGamma - state.gammaBaseline
        : null;

    return {
      t,
      beta: state.filteredBeta,
      gamma: state.filteredGamma,
      deltaBeta,
      deltaGamma,
      speed: state.motionSpeed,
    };
  }

  function updateTimerDisplay() {
    let timerText = "01:00.0";
    let progress = 0;
    let stateText = "In attesa";
    const now = performance.now();

    if (state.phase === "countdown" && Number.isFinite(state.countdownEndsAtMs)) {
      const remaining = Math.max(0, state.countdownEndsAtMs - now);
      timerText = formatTimerMs(remaining);
      progress = (1 - remaining / state.countdownMs) * 100;
      stateText = "Countdown";
    } else if (state.phase === "recording" && Number.isFinite(state.recordingStopAtMs)) {
      const remaining = Math.max(0, state.recordingStopAtMs - now);
      timerText = formatTimerMs(remaining);
      progress = (1 - remaining / state.testDurationMs) * 100;
      stateText = "Registrazione";
    } else if (state.phase === "await_blocks") {
      timerText = "00:00.0";
      progress = 100;
      stateText = "Inserisci blocchi";
    } else if (state.phase === "ready") {
      timerText = "01:00.0";
      progress = 0;
      stateText = "Pronto";
    } else if (state.phase === "done") {
      timerText = "00:00.0";
      progress = 100;
      stateText = "Serie completata";
    }

    ui.testTimer.textContent = timerText;
    ui.timerStateText.textContent = stateText;
    ui.progressFill.style.width = `${clamp(progress, 0, 100)}%`;
  }

  function updateHint() {
    const map = {
      idle: "Premi “Abilita sensori”, poi “Calibra”.",
      prep_calibration: "Mettiti in posizione di riposo: hai 1 secondo.",
      calibrating: "Resta fermo 2 secondi.",
      ready: "Premi “Avvia test”.",
      countdown: "Preparati: il test sta per iniziare.",
      recording: "Test in corso: continua fino al bip finale.",
      await_blocks: "Inserisci i blocchi trasferiti e salva la prova.",
      done: "Serie completata. Premi reset per ripartire.",
    };
    ui.stepHint.textContent = map[state.phase] || "";
  }

  function applyCurrentMetrics(metrics) {
    ui.blocksCount.textContent = formatInt(metrics?.blocksTransferred ?? null);
    ui.estimatedBlocks.textContent =
      Number.isFinite(metrics?.estimatedBlocks) && metrics.estimatedBlocks > 0
        ? formatInt(metrics.estimatedBlocks)
        : "--";
    ui.cycleCount.textContent =
      Number.isFinite(metrics?.cycleCount) && metrics.cycleCount > 0 ? formatInt(metrics.cycleCount) : "--";
    const hasValidCycles = Number.isFinite(metrics?.cycleCount) && metrics.cycleCount > 0;
    ui.meanCycleMs.textContent =
      hasValidCycles && Number.isFinite(metrics?.meanCycleMs) ? `${metrics.meanCycleMs.toFixed(0)} ms` : "--";
    ui.cycleCv.textContent =
      hasValidCycles && Number.isFinite(metrics?.cycleCv) ? `${metrics.cycleCv.toFixed(0)}%` : "--";
    ui.meanTaskSpeed.textContent = formatSpeed(metrics?.meanTaskSpeed ?? null);
    ui.peakSpeed.textContent = formatSpeed(metrics?.peakSpeed ?? null);
    ui.fatigueIndex.textContent =
      Number.isFinite(metrics?.fatigueIndex) ? `${metrics.fatigueIndex.toFixed(0)}%` : "--";
    ui.workspaceBeta.textContent = formatDeg(metrics?.workspaceBeta ?? null);
    ui.workspaceGamma.textContent = formatDeg(metrics?.workspaceGamma ?? null);
    ui.rhythmicity.textContent =
      hasValidCycles && Number.isFinite(metrics?.rhythmicityScore) ? `${metrics.rhythmicityScore.toFixed(0)}/100` : "--";
    ui.estBlocksAdv.textContent = formatInt(metrics?.estimatedBlocks ?? null);
  }

  function applySummary(summary) {
    ui.meanBlocks.textContent = formatInt(summary?.meanBlocks ?? null);
    ui.bestBlocks.textContent = formatInt(summary?.bestBlocks ?? null);
    ui.meanEstimatedBlocks.textContent = formatInt(summary?.meanEstimatedBlocks ?? null);
    ui.meanCycleCount.textContent =
      Number.isFinite(summary?.meanCycleCount) ? summary.meanCycleCount.toFixed(1) : "--";
    ui.meanTaskSpeedSummary.textContent = formatSpeed(summary?.meanTaskSpeed ?? null);
    ui.meanRhythmicity.textContent =
      Number.isFinite(summary?.meanRhythmicity) ? `${summary.meanRhythmicity.toFixed(0)}/100` : "--";
    ui.meanFatigue.textContent =
      Number.isFinite(summary?.meanFatigue) ? `${summary.meanFatigue.toFixed(0)}%` : "--";
  }

  function updateUI() {
    ui.phase.textContent = state.phase;
    ui.baselineReady.textContent =
      Number.isFinite(state.betaBaseline) && Number.isFinite(state.gammaBaseline) ? "sì" : "no";
    ui.trialBadge.textContent = `Prova ${state.currentTrial}/${state.maxTrials}`;

    ui.rawBeta.textContent = formatDeg(state.rawBeta);
    ui.rawGamma.textContent = formatDeg(state.rawGamma);

    const deltaBeta =
      Number.isFinite(state.filteredBeta) && Number.isFinite(state.betaBaseline)
        ? state.filteredBeta - state.betaBaseline
        : null;

    const deltaGamma =
      Number.isFinite(state.filteredGamma) && Number.isFinite(state.gammaBaseline)
        ? state.filteredGamma - state.gammaBaseline
        : null;

    ui.deltaBeta.textContent = formatDeg(deltaBeta);
    ui.deltaGamma.textContent = formatDeg(deltaGamma);
    ui.liveSpeed.textContent = formatSpeed(state.motionSpeed);
    ui.calibrationSamples.textContent = String(state.calibrationValuesBeta.length);
    ui.gestureSamples.textContent = String(state.currentSamples.length);

    applyCurrentMetrics(state.currentMetrics);
    applySummary(state.summary);

    const seriesComplete = state.trials.length >= state.maxTrials;

    ui.calibrateBtn.disabled =
      !state.sensorsEnabled ||
      ["prep_calibration", "calibrating", "countdown", "recording"].includes(state.phase);

    ui.startTestBtn.disabled =
      !state.sensorsEnabled ||
      !Number.isFinite(state.betaBaseline) ||
      seriesComplete ||
      !["ready", "await_blocks"].includes(state.phase);

    ui.saveTrialBtn.disabled = state.phase !== "await_blocks";

    updateHint();
    updateTimerDisplay();
    scheduleChartDraw();
  }

  function addOrientationListenerOnce() {
    if (state.listenerAttached) return;
    window.addEventListener("deviceorientation", onDeviceOrientation, true);
    state.listenerAttached = true;
  }

  async function enableSensors() {
    if (state.sensorsEnabled) {
      setStatus("sensori già attivi", "ok");
      setSupportInfo("Puoi calibrare.");
      return;
    }

    const isSecureEnough =
      window.isSecureContext ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1";

    if (!isSecureEnough) {
      setStatus("serve HTTPS o localhost", "warn");
      setSupportInfo("Apri la pagina in HTTPS oppure su localhost.");
      return;
    }

    if (typeof window.DeviceOrientationEvent === "undefined") {
      setStatus("DeviceOrientation non supportato", "warn");
      setSupportInfo("Prova da smartphone recente.");
      return;
    }

    try {
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== "granted") {
          setStatus("permesso sensori negato", "warn");
          setSupportInfo("Accetta il permesso e riprova.");
          return;
        }
      }

      addOrientationListenerOnce();
      state.sensorsEnabled = true;
      setPhase("idle");
      setStatus("sensori attivi", "ok");
      setSupportInfo("Ora premi “Calibra”.");
      updateUI();

      setTimeout(() => {
        if (!state.hasOrientationEvent) {
          setStatus("nessun dato sensore ricevuto", "warn");
          setSupportInfo("Controlla browser, permessi e dispositivo.");
        }
      }, 1500);
    } catch (error) {
      console.error(error);
      setStatus("errore attivazione sensori", "warn");
      setSupportInfo(error instanceof Error ? error.message : "Errore sconosciuto");
    }
  }

  function startCalibrationWindow() {
    state.prepTimerId = null;

    if (!Number.isFinite(state.filteredBeta) || !Number.isFinite(state.filteredGamma)) {
      setPhase("idle");
      setStatus("nessun dato sensore disponibile", "warn");
      setSupportInfo("Aspetta i dati del sensore e riprova.");
      updateUI();
      return;
    }

    state.isCalibrating = true;
    state.calibrationValuesBeta = [];
    state.calibrationValuesGamma = [];

    setPhase("calibrating");
    setStatus("calibrazione in corso", "warn");
    setSupportInfo("Resta fermo 2 secondi.");
    updateUI();

    state.calibrationTimerId = setTimeout(finishCalibration, state.calibrationDurationMs);
  }

  function finishCalibration() {
    state.isCalibrating = false;
    state.calibrationTimerId = null;

    if (state.calibrationValuesBeta.length < 5 || state.calibrationValuesGamma.length < 5) {
      setPhase("idle");
      setStatus("calibrazione fallita", "warn");
      setSupportInfo("Pochi campioni. Riprova.");
      updateUI();
      return;
    }

    const betaNoise = std(state.calibrationValuesBeta);
    const gammaNoise = std(state.calibrationValuesGamma);
    const maxNoiseDeg = 2.2;
    if (betaNoise > maxNoiseDeg || gammaNoise > maxNoiseDeg) {
      setPhase("idle");
      setStatus("calibrazione instabile", "warn");
      setSupportInfo("Troppo movimento durante calibrazione. Ripeti mantenendo il braccio fermo.");
      updateUI();
      return;
    }

    state.betaBaseline = mean(state.calibrationValuesBeta);
    state.gammaBaseline = mean(state.calibrationValuesGamma);

    setPhase("ready");
    setStatus("calibrazione completata", "ok");
    setSupportInfo("Premi “Avvia test”.");
    updateUI();
  }

  function calibrate() {
    if (!state.sensorsEnabled) return;

    clearTimers();
    state.isCalibrating = false;
    state.calibrationValuesBeta = [];
    state.calibrationValuesGamma = [];

    setPhase("prep_calibration");
    setStatus("preparati", "warn");
    setSupportInfo("Hai 1 secondo per posizionarti.");
    updateUI();

    state.prepTimerId = setTimeout(startCalibrationWindow, state.prepDelayMs);
  }

  function startTimerLoop() {
    if (state.timerIntervalId) clearInterval(state.timerIntervalId);
    state.timerIntervalId = setInterval(updateTimerDisplay, 100);
  }

  function startRecording() {
    state.currentSamples = [];
    state.currentMetrics = null;
    state.recordingStartMs = performance.now();
    state.recordingStopAtMs = state.recordingStartMs + state.testDurationMs;

    setPhase("recording");
    setStatus("test in corso", "ok");
    setSupportInfo("Registrazione attiva.");
    updateUI();

    startTimerLoop();
    state.recordingStopTimerId = setTimeout(stopRecording, state.testDurationMs);
  }

  function startTest() {
    if (!state.sensorsEnabled || !Number.isFinite(state.betaBaseline)) return;
    if (["countdown", "recording"].includes(state.phase)) return;
    if (state.trials.length >= state.maxTrials) return;

    clearTimers();

    setPhase("countdown");
    state.countdownEndsAtMs = performance.now() + state.countdownMs;
    setStatus("countdown", "ok");
    setSupportInfo("3... 2... 1...");
    updateUI();

    startTimerLoop();
    state.countdownTimerId = setTimeout(() => {
      state.countdownTimerId = null;
      state.countdownEndsAtMs = null;
      startRecording();
    }, state.countdownMs);
  }

  function stopRecording() {
    if (state.recordingStopTimerId) clearTimeout(state.recordingStopTimerId);
    state.recordingStopTimerId = null;
    if (state.timerIntervalId) clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;

    state.currentMetrics = computeBBTMetrics(
      state.currentSamples,
      null,
      state.metricOptions
    );

    setPhase("await_blocks");
    setStatus("test terminato", "ok");
    setSupportInfo("Inserisci i blocchi e salva la prova.");
    playEndBeep();
    updateUI();
  }

  function saveTrial() {
    if (state.phase !== "await_blocks" || !state.currentMetrics) return;

    const raw = ui.blocksSaveInput.value.trim();
    if (raw === "") {
      setStatus("manca il numero di blocchi", "warn");
      setSupportInfo("Inserisci i blocchi trasferiti.");
      return;
    }

    const blocksTransferred = Number(raw);
    if (!Number.isFinite(blocksTransferred) || blocksTransferred < 0) {
      setStatus("numero non valido", "warn");
      setSupportInfo("Inserisci un numero valido.");
      return;
    }

    state.currentMetrics.blocksTransferred = Math.round(blocksTransferred);

    state.trials.push({
      ...state.currentMetrics,
      side: ui.sideSelect.value,
      samples: state.currentSamples.slice(),
    });

    state.summary = computeSummary(state.trials);
    ui.blocksSaveInput.value = "";

    if (state.trials.length < state.maxTrials) {
      state.currentTrial = state.trials.length + 1;
      setPhase("ready");
      setStatus(`prova ${state.trials.length}/3 salvata`, "ok");
      setSupportInfo("Puoi avviare la prova successiva.");
    } else {
      setPhase("done");
      setStatus("serie completata", "ok");
      setSupportInfo("Hai completato tutte le prove.");
    }

    updateUI();
  }

  function onDeviceOrientation(event) {
    const nowMs = performance.now();
    const beta = typeof event.beta === "number" ? event.beta : null;
    const gamma = typeof event.gamma === "number" ? event.gamma : null;
    if (beta === null || gamma === null) return;

    state.hasOrientationEvent = true;
    state.rawBeta = beta;
    state.rawGamma = gamma;

    state.filteredBeta = lowPass(beta, state.filteredBeta, state.filterAlpha);
    state.filteredGamma = lowPass(gamma, state.filteredGamma, state.filterAlpha);

    if (
      Number.isFinite(state.previousFilteredBeta) &&
      Number.isFinite(state.previousFilteredGamma) &&
      Number.isFinite(state.lastTimestampMs)
    ) {
      const dt = (nowMs - state.lastTimestampMs) / 1000;
      if (dt > 0) {
        const vBeta = (state.filteredBeta - state.previousFilteredBeta) / dt;
        const vGamma = (state.filteredGamma - state.previousFilteredGamma) / dt;
        state.motionSpeedRaw = Math.sqrt(vBeta * vBeta + vGamma * vGamma);
        state.motionSpeed =
          state.motionSpeedAlpha * state.motionSpeedRaw +
          (1 - state.motionSpeedAlpha) * state.motionSpeed;
      }
    }

    state.previousFilteredBeta = state.filteredBeta;
    state.previousFilteredGamma = state.filteredGamma;
    state.lastTimestampMs = nowMs;

    if (state.isCalibrating) {
      state.calibrationValuesBeta.push(state.filteredBeta);
      state.calibrationValuesGamma.push(state.filteredGamma);
    }

    if (state.phase === "recording") {
      state.currentSamples.push(makeSample(nowMs));

      if (state.currentSamples.length > 5) {
        state.currentMetrics = computeBBTMetrics(
          state.currentSamples,
          null,
          state.metricOptions
        );
      }
    }

    updateUI();
  }

  function resetAll() {
    clearTimers();

    state.rawBeta = null;
    state.rawGamma = null;
    state.filteredBeta = null;
    state.filteredGamma = null;
    state.previousFilteredBeta = null;
    state.previousFilteredGamma = null;
    state.lastTimestampMs = null;
    state.motionSpeedRaw = 0;
    state.motionSpeed = 0;

    state.betaBaseline = null;
    state.gammaBaseline = null;
    state.calibrationValuesBeta = [];
    state.calibrationValuesGamma = [];
    state.isCalibrating = false;

    state.currentSamples = [];
    state.currentMetrics = null;
    state.trials = [];
    state.summary = null;
    state.currentTrial = 1;
    state.recordingStartMs = null;
    state.recordingStopAtMs = null;
    state.countdownEndsAtMs = null;

    ui.blocksSaveInput.value = "";

    setPhase("idle");
    setStatus("reset eseguito", "warn");
    setSupportInfo("Riabilita i sensori o ricalibra.");
    updateUI();
  }

  function drawAllCharts() {
    const currentSamples = state.currentMetrics?.samples || state.currentSamples || [];
    const smoothSpeedSamples = currentSamples.length
      ? currentSamples.map((s, i) => {
          const left = Math.max(0, i - 3);
          const right = Math.min(currentSamples.length - 1, i + 3);
          let sum = 0;
          let n = 0;
          for (let k = left; k <= right; k++) {
            const v = currentSamples[k].speed;
            if (Number.isFinite(v)) {
              sum += v;
              n++;
            }
          }
          return { ...s, speedSmooth: n ? sum / n : s.speed };
        })
      : [];
    const labels = state.trials.map((_, i) => `P${i + 1}`);

    drawLineChart(
      ui.speedChart,
      smoothSpeedSamples,
      (s) => s.speedSmooth,
      (v) => `${Math.round(v)}`,
      {
        startAtZero: true,
        lineColor: "#2563eb",
        markerTimestamps: state.currentMetrics?.peakTimestamps || [],
        markerColor: "#ef4444",
      }
    );

    drawCycleIntervals(ui.cycleIntervalsChart, state.currentMetrics?.cycleIntervalsMs || []);

    drawHalvesComparison(ui.halvesChart, state.currentMetrics?.halves ?? null);

    drawWorkspaceScatter(
      ui.workspaceChart,
      currentSamples.map((s) => ({
        x: s.deltaBeta,
        y: s.deltaGamma,
      }))
    );

    drawDualBarChart(
      ui.blocksCompareChart,
      state.trials.map((t) => t.blocksTransferred),
      state.trials.map((t) => t.rhythmicityScore),
      labels,
      (v) => `${Math.round(v)}`,
      "Blocchi",
      "Rhythm"
    );

    drawBarChart(
      ui.rhythmicityTrialsChart,
      state.trials.map((t) => t.fatigueIndex),
      labels,
      (v) => `${Math.round(v)}`
    );
  }

  function init() {
    setStatus("pronto", "warn");
    setSupportInfo("Apri da smartphone, in HTTPS o localhost.");
    updateUI();

    ui.enableBtn.addEventListener("click", enableSensors);
    ui.calibrateBtn.addEventListener("click", calibrate);
    ui.startTestBtn.addEventListener("click", startTest);
    ui.saveTrialBtn.addEventListener("click", saveTrial);
    ui.resetBtn.addEventListener("click", resetAll);
    window.addEventListener("resize", scheduleChartDraw);
  }

  init();
})();
