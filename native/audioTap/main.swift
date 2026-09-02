import Foundation

/*
 * bananino-audio-tap — records a meeting to 16 kHz mono WAVs ready for whisper.cpp.
 *
 *   bananino-audio-tap --system out/system.wav [--seconds 30]
 *
 * System audio only. The microphone is captured in the renderer instead: TCC attributes
 * microphone access per binary, and this helper has its own ad-hoc signature, so macOS
 * silently handed it an empty input stream inside the packaged app.
 *
 * Emits one JSON line per second on stdout so the parent process can show live levels
 * and tell a silent track from a failed one. Stops cleanly on SIGINT/SIGTERM.
 */

struct Options {
    var systemPath: String?
    var seconds: Double?
}

func parseOptions() -> Options {
    var options = Options()
    var arguments = Array(CommandLine.arguments.dropFirst())
    while let flag = arguments.first {
        arguments.removeFirst()
        switch flag {
        case "--system": options.systemPath = arguments.first; arguments = Array(arguments.dropFirst())
        case "--seconds":
            options.seconds = arguments.first.flatMap(Double.init)
            arguments = Array(arguments.dropFirst())
        default: break
        }
    }
    return options
}

func emit(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
        let line = String(data: data, encoding: .utf8)
    else { return }
    print(line)
    fflush(stdout)
}

func rms(_ samples: [Float]) -> Double {
    guard !samples.isEmpty else { return 0 }
    let total = samples.reduce(into: 0.0) { $0 += Double($1) * Double($1) }
    return (total / Double(samples.count)).squareRoot()
}

let options = parseOptions()
guard let systemPath = options.systemPath else {
    emit(["event": "error", "message": "--system <path> is required"])
    exit(2)
}

/// One capture source plus the file it is being written to.
final class Track {
    let name: String
    let writer: WavWriter
    let resampler: Resampler
    let drain: () -> (samples: [Float], dropped: Int)
    let stop: () -> Void
    var level: Double = 0
    var droppedTotal = 0

    init(
        name: String, writer: WavWriter, resampler: Resampler,
        drain: @escaping () -> (samples: [Float], dropped: Int), stop: @escaping () -> Void
    ) {
        self.name = name
        self.writer = writer
        self.resampler = resampler
        self.drain = drain
        self.stop = stop
    }
}

var tracks: [Track] = []
let tap = SystemAudioTap()

do {
    try tap.start()
    guard
        let resampler = Resampler(inputSampleRate: tap.sampleRate, inputChannels: tap.channels)
    else { throw TapError.noProc }
    tracks.append(
        Track(
            name: "system", writer: try WavWriter(url: URL(fileURLWithPath: systemPath)),
            resampler: resampler, drain: tap.drain, stop: tap.stop))
} catch {
    emit(["event": "error", "track": "system", "message": String(describing: error)])
    exit(1)
}

emit([
    "event": "started",
    "tracks": tracks.map { $0.name },
    "systemSampleRate": tap.sampleRate,
    "systemChannels": tap.channels,
])

var finished = false
func finish(_ reason: String) {
    guard !finished else { return }
    finished = true
    for track in tracks {
        track.stop()
        let (samples, dropped) = track.drain()
        try? track.writer.append(track.resampler.convert(samples))
        track.droppedTotal += dropped
        try? track.writer.close()
    }
    emit([
        "event": "stopped",
        "reason": reason,
        "tracks": tracks.map {
            [
                "name": $0.name, "seconds": $0.writer.duration, "frames": $0.writer.frames,
                "droppedSamples": $0.droppedTotal, "level": $0.level,
            ]
        },
    ])
    exit(0)
}

// Held for the process lifetime — a released source stops delivering.
var signalSources: [DispatchSourceSignal] = []
for signalNumber in [SIGINT, SIGTERM] {
    signal(signalNumber, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
    source.setEventHandler { finish(signalNumber == SIGINT ? "interrupt" : "terminate") }
    source.resume()
    signalSources.append(source)
}

let started = Date()
let drainsPerLevelReport = 4
var drains = 0
let timer = DispatchSource.makeTimerSource(queue: .main)
timer.schedule(deadline: .now() + 0.25, repeating: 0.25)
timer.setEventHandler {
    for track in tracks {
        let (samples, dropped) = track.drain()
        track.droppedTotal += dropped
        if !samples.isEmpty {
            track.level = rms(samples)
            try? track.writer.append(track.resampler.convert(samples))
        }
    }
    drains += 1
    if drains % drainsPerLevelReport == 0 {
        emit([
            "event": "level",
            "seconds": tracks.first?.writer.duration ?? 0,
            "levels": Dictionary(uniqueKeysWithValues: tracks.map { ($0.name, $0.level) }),
        ])
    }
    if let limit = options.seconds, Date().timeIntervalSince(started) >= limit {
        finish("duration")
    }
}
timer.resume()
dispatchMain()
