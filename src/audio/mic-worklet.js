/* global AudioWorkletProcessor, registerProcessor */
// AudioWorklet for the microphone: keeps the latest `frame` input samples in a
// ring buffer and posts them (oldest first) every `hop` samples to the main
// thread, where src/audio/pitch.js detects the pitch. Outputs silence.
class MicFrames extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super();
    this.frame = processorOptions.frame || 2048;
    this.hop = processorOptions.hop || 1024;
    this.ring = new Float32Array(this.frame);
    this.pos = 0;
    this.count = 0;
    this.sinceHop = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.ring[this.pos] = ch[i];
        this.pos = (this.pos + 1) % this.frame;
        if (this.count < this.frame) this.count++;
        if (this.count === this.frame && ++this.sinceHop >= this.hop) {
          this.sinceHop = 0;
          const out = new Float32Array(this.frame);
          out.set(this.ring.subarray(this.pos));
          out.set(this.ring.subarray(0, this.pos), this.frame - this.pos);
          this.port.postMessage(out, [out.buffer]);
        }
      }
    }
    return true;
  }
}
registerProcessor('mic-frames', MicFrames);
