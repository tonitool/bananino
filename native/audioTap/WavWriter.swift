import Foundation

/*
 * Writes 16 kHz mono 16-bit PCM — the only format whisper.cpp accepts.
 *
 * The header is rewritten on every flush rather than only at close, so a crash or a
 * hard quit mid-meeting still leaves a playable file with everything captured so far.
 * A meeting recording is not something we get to ask the user to repeat.
 */
final class WavWriter {
    static let sampleRate = 16_000
    private static let headerBytes = 44
    private static let bitsPerSample = 16
    private static let channels = 1

    private let handle: FileHandle
    private var framesWritten = 0

    init(url: URL) throws {
        let manager = FileManager.default
        try manager.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        manager.createFile(atPath: url.path, contents: nil)
        guard let handle = FileHandle(forWritingAtPath: url.path) else {
            throw WavWriterError.cannotOpen(url.path)
        }
        self.handle = handle
        try handle.write(contentsOf: Self.header(frames: 0))
    }

    var frames: Int { framesWritten }
    var duration: Double { Double(framesWritten) / Double(Self.sampleRate) }

    func append(_ samples: [Int16]) throws {
        guard !samples.isEmpty else { return }
        let bytes = samples.withUnsafeBufferPointer { Data(buffer: $0) }
        try handle.seekToEnd()
        try handle.write(contentsOf: bytes)
        framesWritten += samples.count
        try refreshHeader()
    }

    func close() throws {
        try refreshHeader()
        try handle.close()
    }

    private func refreshHeader() throws {
        try handle.seek(toOffset: 0)
        try handle.write(contentsOf: Self.header(frames: framesWritten))
        try handle.seekToEnd()
    }

    private static func header(frames: Int) -> Data {
        let bytesPerFrame = channels * bitsPerSample / 8
        let dataBytes = frames * bytesPerFrame
        var data = Data(capacity: headerBytes)

        func ascii(_ text: String) { data.append(contentsOf: Array(text.utf8)) }
        func uint32(_ value: Int) { withUnsafeBytes(of: UInt32(value).littleEndian) { data.append(contentsOf: $0) } }
        func uint16(_ value: Int) { withUnsafeBytes(of: UInt16(value).littleEndian) { data.append(contentsOf: $0) } }

        ascii("RIFF")
        uint32(36 + dataBytes)
        ascii("WAVE")
        ascii("fmt ")
        uint32(16)
        uint16(1) // PCM
        uint16(channels)
        uint32(sampleRate)
        uint32(sampleRate * bytesPerFrame)
        uint16(bytesPerFrame)
        uint16(bitsPerSample)
        ascii("data")
        uint32(dataBytes)
        return data
    }
}

enum WavWriterError: Error, CustomStringConvertible {
    case cannotOpen(String)

    var description: String {
        switch self {
        case .cannotOpen(let path): return "could not open \(path) for writing"
        }
    }
}
