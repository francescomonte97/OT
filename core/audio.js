let audioContext = null;

export function playEndBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    
    if (!audioContext) {
      audioContext = new AudioCtx();
    }
    
    const ctx = audioContext;
    const now = ctx.currentTime;
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.linearRampToValueAtTime(1046, now + 0.09);
    
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(now);
    osc.stop(now + 0.30);
  } catch (error) {
    console.error("Errore beep:", error);
  }
}