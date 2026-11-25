// Microphone input: monophonic pitch detection for practising on an acoustic
// piano (or any instrument) without MIDI. Works for single notes only.
//
//   const mic = createMic({onNote(n, velocity, time), onRelease(n, time), isBusy});
//   await mic.start()   // asks for microphone permission (only here, never before)
//   mic.stop(); mic.setSensitivity(0…1); mic.on
//
// Frames of 2048 samples every 1024 (≈ 21 ms at 48 kHz) go through YIN
// (src/audio/pitch.js); a note starts after 3 frames agree. Lowest reliable note
// ≈ F#1 (one frame must hold two periods). `isBusy()` lets the app mute detection
// while its own piano is striking notes, so the mic doesn't hear the speakers.
import {detectPitch, createNoteTracker} from './pitch.js';
import workletSource from './mic-worklet.js?raw';

const FRAME = 2048, HOP = 1024;

export function createMic({onNote = () => {}, onRelease = () => {}, onState = () => {}, isBusy = () => false, sensitivity = .5} = {}) {
  let ctx = null, stream = null, source = null, node = null, sink = null, on = false;
  const tracker = createNoteTracker({sensitivity});
  const stats = {frames: 0, voiced: 0, maxRms: 0, path: ''}; // diagnostics

  function frame(buf) {
    if (!on) return;
    const now = performance.now();
    if (isBusy()) { tracker.reset(); return; }
    const p = detectPitch(buf, ctx.sampleRate, {threshold: .12, maxFreq: 4300});
    stats.frames++; stats.maxRms = Math.max(stats.maxRms, p.rms); if (p.freq) stats.voiced++;
    // The frame ends now; an attack inside it is on average half a frame earlier.
    for (const ev of tracker.push(p, now - FRAME / ctx.sampleRate * 500)) {
      if (ev.type === 'on') onNote(ev.note, ev.velocity, ev.time);
      else onRelease(ev.note, ev.time);
    }
  }

  async function start() {
    if (on) return true;
    if (!navigator.mediaDevices?.getUserMedia) throw Error('This browser has no microphone access');
    // Echo cancellation keeps the app's own piano out; no noise suppression or
    // automatic gain, which smear and pump sustained notes.
    stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1}});
    ctx = new (window.AudioContext || window.webkitAudioContext)({latencyHint: 'interactive'});
    if (ctx.state === 'suspended') await ctx.resume();
    source = ctx.createMediaStreamSource(stream);
    sink = ctx.createGain(); sink.gain.value = 0; // silent: the mic never reaches the speakers
    try {
      // A Blob URL works the same in dev, in the build and offline (and in Safari).
      const url = URL.createObjectURL(new Blob([workletSource], {type: 'text/javascript'}));
      try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      node = new AudioWorkletNode(ctx, 'mic-frames', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: {frame: FRAME, hop: HOP}});
      node.port.onmessage = e => frame(e.data);
      stats.path = 'worklet';
    } catch {
      // Older Safari: ScriptProcessor fallback, same frames.
      const ring = new Float32Array(FRAME);
      node = ctx.createScriptProcessor(HOP, 1, 1);
      node.onaudioprocess = e => {
        const x = e.inputBuffer.getChannelData(0);
        ring.copyWithin(0, x.length); ring.set(x, FRAME - x.length);
        frame(ring.slice());
      };
      stats.path = 'script-processor';
    }
    source.connect(node); node.connect(sink); sink.connect(ctx.destination);
    tracker.reset();
    on = true;
    onState(true);
    return true;
  }

  function stop() {
    if (tracker.held != null) onRelease(tracker.held, performance.now());
    on = false;
    try { source?.disconnect(); node?.disconnect(); sink?.disconnect(); } catch {}
    stream?.getTracks().forEach(t => t.stop());
    ctx?.close().catch(() => {});
    ctx = stream = source = node = sink = null;
    tracker.reset();
    onState(false);
  }

  return {start, stop, setSensitivity: s => tracker.setSensitivity(s), get on() { return on; }, stats};
}
