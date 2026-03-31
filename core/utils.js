export function mean(values) {
  if (!values || !values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function std(values) {
  if (!values || values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function cvPercent(values) {
  if (!values || values.length < 2) return 0;
  const m = mean(values);
  if (!Number.isFinite(m) || m === 0) return 0;
  return (std(values) / m) * 100;
}

export function lowPass(nextValue, prevValue, alpha) {
  if (!Number.isFinite(prevValue)) return nextValue;
  return alpha * nextValue + (1 - alpha) * prevValue;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function formatDeg(v) {
  return Number.isFinite(v) ? `${v.toFixed(1)}°` : "--";
}

export function formatSpeed(v) {
  return Number.isFinite(v) ? `${v.toFixed(1)} °/s` : "--";
}

export function formatTimeMs(v) {
  return Number.isFinite(v) ? `${(v / 1000).toFixed(1)} s` : "--";
}

export function formatInt(v) {
  return Number.isFinite(v) ? String(Math.round(v)) : "--";
}

export function formatPercent(v) {
  return Number.isFinite(v) ? `${v.toFixed(0)}%` : "--";
}

export function formatTimerMs(ms) {
  const safe = Math.max(0, ms);
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const tenths = Math.floor((safe % 1000) / 100);
  return `${minutes}:${seconds}.${tenths}`;
}