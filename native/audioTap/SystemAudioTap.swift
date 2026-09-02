import AudioToolbox
import CoreAudio
import Foundation

/*
 * Captures everything the machine is playing, via a Core Audio process tap.
 *
 * This is the only approach that works: Electron/Chromium's getDisplayMedia loopback
 * hands back an audio track that is already in the "ended" state on macOS 26 (and no
 * track at all through the system picker), so it yields digital silence with no error.
 * A tap needs no Screen Recording permission either — only audio capture.
 */
final class SystemAudioTap {
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private let queue = SampleQueue()

    private(set) var sampleRate: Double = 0
    private(set) var channels: UInt32 = 0

    func start() throws {
        // Excluding our own process would silence the tap when the app itself plays audio;
        // we exclude nothing and rely on the app being quiet during a meeting.
        let description = CATapDescription(monoGlobalTapButExcludeProcesses: [])
        description.name = "lualala meeting tap"
        description.isPrivate = true
        description.muteBehavior = .unmuted

        try check(AudioHardwareCreateProcessTap(description, &tapID), "create process tap")

        var format = AudioStreamBasicDescription()
        var formatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var formatAddress = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        try check(
            AudioObjectGetPropertyData(tapID, &formatAddress, 0, nil, &formatSize, &format),
            "read tap format")
        sampleRate = format.mSampleRate
        channels = format.mChannelsPerFrame

        guard let outputUID = Self.defaultOutputUID() else {
            throw TapError.noDefaultOutput
        }
        let aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "lualala meeting aggregate",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceMainSubDeviceKey: outputUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [],
            kAudioAggregateDeviceTapListKey: [
                [
                    kAudioSubTapUIDKey: description.uuid.uuidString,
                    kAudioSubTapDriftCompensationKey: true,
                ]
            ],
        ]
        try check(
            AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &aggregateID),
            "create aggregate device")

        let sink = queue
        try check(
            AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, nil) {
                _, inInputData, _, _, _ in
                let buffers = UnsafeMutableAudioBufferListPointer(
                    UnsafeMutablePointer(mutating: inInputData))
                for buffer in buffers {
                    guard let raw = buffer.mData else { continue }
                    let count = Int(buffer.mDataByteSize) / MemoryLayout<Float>.size
                    sink.append(raw.assumingMemoryBound(to: Float.self), count: count)
                }
            }, "create IO proc")

        guard let procID else { throw TapError.noProc }
        try check(AudioDeviceStart(aggregateID, procID), "start device")
    }

    func drain() -> (samples: [Float], dropped: Int) { queue.drain() }

    func stop() {
        if let procID {
            AudioDeviceStop(aggregateID, procID)
            AudioDeviceDestroyIOProcID(aggregateID, procID)
        }
        if aggregateID != AudioObjectID(kAudioObjectUnknown) {
            AudioHardwareDestroyAggregateDevice(aggregateID)
        }
        if tapID != AudioObjectID(kAudioObjectUnknown) {
            AudioHardwareDestroyProcessTap(tapID)
        }
        procID = nil
        aggregateID = AudioObjectID(kAudioObjectUnknown)
        tapID = AudioObjectID(kAudioObjectUnknown)
    }

    private func check(_ status: OSStatus, _ stage: String) throws {
        guard status != noErr else { return }
        throw TapError.coreAudio(stage: stage, status: status)
    }

    private static func defaultOutputUID() -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var device = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard
            AudioObjectGetPropertyData(
                AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device) == noErr
        else { return nil }

        var uidAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var uid: CFString?
        var uidSize = UInt32(MemoryLayout<CFString?>.size)
        let status = withUnsafeMutablePointer(to: &uid) {
            AudioObjectGetPropertyData(device, &uidAddress, 0, nil, &uidSize, $0)
        }
        guard status == noErr else { return nil }
        return uid as String?
    }
}

enum TapError: Error, CustomStringConvertible {
    case coreAudio(stage: String, status: OSStatus)
    case noDefaultOutput
    case noProc

    var description: String {
        switch self {
        case .coreAudio(let stage, let status):
            let hint =
                status == 1_886_547_824
                ? " — permission denied; grant System Audio Recording in System Settings › Privacy & Security"
                : ""
            return "core audio failed to \(stage) (status \(status))\(hint)"
        case .noDefaultOutput: return "no default output device"
        case .noProc: return "core audio returned no IO proc"
        }
    }
}
