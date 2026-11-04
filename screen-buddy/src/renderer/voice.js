// The window's half of voice: the microphone, on-device speech detection, and
// playing the buddy's replies. Transcription and the voice itself happen in
// the main process (the keys live there); this file never sees a key.
//
// While the buddy is talking, and for TAIL_MS after it stops, anything the mic
// catches is marked "duringSpeech": the main process then only acts on
// "Buddy, stop" and ignores the rest, so the buddy never hears itself as you.
(function () {
  const { Vad, encodeWav } = window.ScreenBuddyAudio;
  const RATE = 16000;
  const TAIL_MS = 500;

  const state = {
    stream: null,
    ctx: null,
    node: null,
    vad: null,
    hearing: false,
    overlap: false, // this utterance overlapped the buddy talking (or its tail)
    // speaking
    mainBusy: false, // main is still generating pieces
    queue: [], // pieces waiting to play
    current: null, // { stop() } for what's playing
    quietSince: 0, // when speaking last ended (for the tail)
  };
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn(api.status()));

  function speakingNow() {
    return state.mainBusy || state.queue.length > 0 || state.current !== null;
  }
  function inTail() {
    return speakingNow() || Date.now() - state.quietSince < TAIL_MS;
  }
  function markMaybeQuiet() {
    if (!speakingNow()) {
      state.quietSince = Date.now();
      notify();
    }
  }

  // ---- microphone ---------------------------------------------------------

  async function start() {
    if (state.stream) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });
    const ctx = new AudioContext({ sampleRate: RATE });
    await ctx.audioWorklet.addModule("mic-worklet.js");
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "mic-frames");
    // The worklet needs a path to the output to keep running; a muted gain
    // keeps the mic from being played back through the speakers.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(ctx.destination);
    Object.assign(state, { stream, ctx, node, vad: new Vad() });
    node.port.onmessage = (e) => onFrame(e.data);
    notify();
  }

  async function stop() {
    const { stream, ctx, node } = state;
    Object.assign(state, { stream: null, ctx: null, node: null, vad: null, hearing: false });
    if (node) node.port.onmessage = null;
    stream?.getTracks().forEach((t) => t.stop()); // releases the mic (and its indicator)
    await ctx?.close().catch(() => {});
    notify();
  }

  function onFrame(frame) {
    if (!state.vad) return;
    const ev = state.vad.push(frame);
    if (state.hearing && inTail()) state.overlap = true;
    if (!ev) return;
    if (ev.type === "start") {
      state.hearing = true;
      state.overlap = inTail();
      notify();
      return;
    }
    const duringSpeech = state.overlap || inTail();
    state.hearing = false;
    state.overlap = false;
    notify();
    if (ev.type === "end") {
      window.buddy.voiceUtterance(encodeWav(ev.samples, RATE), { duringSpeech });
    }
  }

  // ---- playback -----------------------------------------------------------

  function playNext() {
    if (state.current || !state.queue.length) return markMaybeQuiet();
    const item = state.queue.shift();
    const done = () => {
      state.current = null;
      playNext();
    };
    if (item.audio) {
      const url = URL.createObjectURL(new Blob([item.audio], { type: item.mime || "audio/wav" }));
      const el = new Audio(url);
      const finish = () => {
        URL.revokeObjectURL(url);
        done();
      };
      el.onended = finish;
      el.onerror = finish;
      state.current = { stop: () => { el.pause(); URL.revokeObjectURL(url); } };
      el.play().catch(finish);
    } else if (item.text && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(item.text);
      u.rate = 1;
      u.onend = done;
      u.onerror = done;
      state.current = { stop: () => speechSynthesis.cancel() };
      speechSynthesis.speak(u);
    } else {
      return done();
    }
    notify();
  }

  function stopSpeaking() {
    state.queue = [];
    const cur = state.current;
    state.current = null;
    cur?.stop();
    markMaybeQuiet();
  }

  window.buddy.onVoice("voice:play", (item) => {
    state.queue.push(item);
    playNext();
  });
  window.buddy.onVoice("voice:stop", () => stopSpeaking());
  window.buddy.onVoice("voice:tts-busy", () => {
    state.mainBusy = true;
    notify();
  });
  window.buddy.onVoice("voice:tts-idle", () => {
    state.mainBusy = false;
    markMaybeQuiet();
  });

  const api = {
    start,
    stop,
    stopSpeaking,
    onChange: (fn) => listeners.add(fn),
    status: () => ({ listening: Boolean(state.stream), hearing: state.hearing, speaking: speakingNow() }),
  };
  window.ScreenBuddyVoice = api;
})();
