// Batch render quanta before crossing threads; output remains silent.
class WatcherCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.offset = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] / channels.length;
      this.buffer[this.offset++] = sample;
      if (this.offset === this.buffer.length) {
        this.port.postMessage(
          { pcm: this.buffer, endFrame: currentFrame + i + 1 },
          [this.buffer.buffer],
        );
        this.buffer = new Float32Array(4096);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("watcher-capture", WatcherCapture);
