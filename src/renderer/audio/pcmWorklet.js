/**
 * Collects mono float samples and posts them in fixed-size blocks.
 *
 * `process` is called with 128 frames at a time — roughly 125 times a second — which is
 * far too chatty for IPC, so blocks are batched here on the audio thread instead.
 */
class PcmCollector extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super()
    this.block = new Float32Array(processorOptions?.chunkFrames ?? 4096)
    this.filled = 0
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel) return true

    for (let i = 0; i < channel.length; i += 1) {
      this.block[this.filled] = channel[i]
      this.filled += 1

      if (this.filled === this.block.length) {
        // A copy, because the block is reused for the next batch.
        this.port.postMessage(this.block.slice())
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-collector', PcmCollector)
