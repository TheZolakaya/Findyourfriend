// Runs on the audio thread: hands the microphone's samples to the window in
// 20 ms frames (the audio context runs at 16 kHz, so 320 samples a frame).
class MicFrames extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(320);
    this.n = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.frame[this.n++] = ch[i];
        if (this.n === this.frame.length) {
          this.port.postMessage(this.frame);
          this.frame = new Float32Array(320);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("mic-frames", MicFrames);
