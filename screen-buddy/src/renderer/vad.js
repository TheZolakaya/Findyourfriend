// On-device speech detection: decides from loudness alone when someone starts
// and stops talking, so silence and background hum are never sent anywhere.
// It's deliberately simple (no model); the wake word does the real filtering.
// Loads as a plain script in the window (window.ScreenBuddyAudio) and as a
// CommonJS module in the tests.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ScreenBuddyAudio = Object.assign(root.ScreenBuddyAudio || {}, factory());
})(typeof self !== "undefined" ? self : this, function () {
  function rms(frame) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    return Math.sqrt(sum / (frame.length || 1));
  }

  class Vad {
    constructor({
      frameMs = 20,
      minLevel = 0.012, // never trigger below this, however quiet the room
      ratio = 3, // speech must be this many times louder than the noise floor
      startMs = 120, // loud for this long to count as speech
      endMs = 800, // quiet for this long to end the utterance
      minSpeechMs = 300, // shorter blips are dropped
      maxSpeechMs = 15000, // cut long monologues into pieces
      preRollMs = 400, // keep this much audio from before speech started
    } = {}) {
      Object.assign(this, { frameMs, minLevel, ratio, startMs, endMs, minSpeechMs, maxSpeechMs, preRollMs });
      this.floor = minLevel / ratio;
      this.reset();
    }

    reset() {
      this.speaking = false;
      this.loudMs = 0;
      this.quietMs = 0;
      this.frames = []; // pre-roll while waiting, the utterance while speaking
      this.speechMs = 0;
    }

    threshold() {
      return Math.max(this.minLevel, this.floor * this.ratio);
    }

    /**
     * Feed one frame of samples (Float32Array, -1..1).
     * @returns {null | {type:"start"} | {type:"end", samples:Float32Array} | {type:"drop"}}
     */
    push(frame) {
      const level = rms(frame);
      const loud = level >= this.threshold();
      this.frames.push(frame);

      if (!this.speaking) {
        // Slowly learn the room's noise floor from non-speech frames.
        if (!loud) this.floor = this.floor * 0.98 + level * 0.02;
        this.loudMs = loud ? this.loudMs + this.frameMs : 0;
        const keep = Math.ceil((this.preRollMs + this.startMs) / this.frameMs);
        if (this.frames.length > keep) this.frames.splice(0, this.frames.length - keep);
        if (this.loudMs >= this.startMs) {
          this.speaking = true;
          this.speechMs = this.loudMs;
          this.quietMs = 0;
          return { type: "start" };
        }
        return null;
      }

      this.speechMs += this.frameMs;
      this.quietMs = loud ? 0 : this.quietMs + this.frameMs;
      if (this.quietMs >= this.endMs || this.speechMs >= this.maxSpeechMs) {
        const talked = this.speechMs - this.quietMs;
        const samples = concat(this.frames);
        this.reset();
        return talked >= this.minSpeechMs ? { type: "end", samples } : { type: "drop" };
      }
      return null;
    }
  }

  function concat(frames) {
    let n = 0;
    for (const f of frames) n += f.length;
    const out = new Float32Array(n);
    let o = 0;
    for (const f of frames) {
      out.set(f, o);
      o += f.length;
    }
    return out;
  }

  // 16-bit mono PCM WAV, what Whisper is happy to take.
  function encodeWav(samples, sampleRate) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const str = (o, s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
    str(0, "RIFF");
    v.setUint32(4, 36 + samples.length * 2, true);
    str(8, "WAVE");
    str(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); // PCM
    v.setUint16(22, 1, true); // mono
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, "data");
    v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buf);
  }

  return { Vad, encodeWav, rms };
});
