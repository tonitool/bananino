import AVFoundation

/*
 * Converts a capture stream to the 16 kHz mono 16-bit PCM whisper.cpp requires.
 *
 * One converter instance is reused across chunks so its filter state carries over;
 * converting each chunk with a fresh converter would put a click at every boundary.
 */
final class Resampler {
    private let converter: AVAudioConverter
    private let inputFormat: AVAudioFormat
    private let outputFormat: AVAudioFormat

    init?(inputSampleRate: Double, inputChannels: UInt32) {
        guard
            let input = AVAudioFormat(
                commonFormat: .pcmFormatFloat32, sampleRate: inputSampleRate,
                channels: AVAudioChannelCount(inputChannels), interleaved: false),
            let output = AVAudioFormat(
                commonFormat: .pcmFormatInt16, sampleRate: Double(WavWriter.sampleRate),
                channels: 1, interleaved: true),
            let converter = AVAudioConverter(from: input, to: output)
        else { return nil }
        self.inputFormat = input
        self.outputFormat = output
        self.converter = converter
        converter.sampleRateConverterQuality = AVAudioQuality.high.rawValue
    }

    /// Interleaved input samples in, 16 kHz mono Int16 out.
    func convert(_ samples: [Float]) -> [Int16] {
        let channels = Int(inputFormat.channelCount)
        let frames = samples.count / channels
        guard frames > 0 else { return [] }

        guard
            let inputBuffer = AVAudioPCMBuffer(
                pcmFormat: inputFormat, frameCapacity: AVAudioFrameCount(frames))
        else { return [] }
        inputBuffer.frameLength = AVAudioFrameCount(frames)

        // De-interleave into the buffer's per-channel planes.
        if let channelData = inputBuffer.floatChannelData {
            for channel in 0..<channels {
                let plane = channelData[channel]
                for frame in 0..<frames { plane[frame] = samples[frame * channels + channel] }
            }
        }

        let ratio = Double(WavWriter.sampleRate) / inputFormat.sampleRate
        let capacity = AVAudioFrameCount(Double(frames) * ratio) + 1024
        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity)
        else { return [] }

        var supplied = false
        var error: NSError?
        converter.convert(to: outputBuffer, error: &error) { _, status in
            if supplied {
                status.pointee = .noDataNow
                return nil
            }
            supplied = true
            status.pointee = .haveData
            return inputBuffer
        }
        guard error == nil, let data = outputBuffer.int16ChannelData else { return [] }
        return Array(UnsafeBufferPointer(start: data[0], count: Int(outputBuffer.frameLength)))
    }
}
