import Foundation
import os

/*
 * Hand-off between a Core Audio render callback and the writer thread.
 *
 * The callback runs on a real-time thread, so it must not block or allocate: capacity is
 * reserved once up front and `drain` keeps it, so steady-state appends never reallocate.
 * An unfair lock is used rather than a queue because the critical section is a memcpy.
 */
final class SampleQueue {
    private var storage: [Float] = []
    private var lock = os_unfair_lock_s()
    private var dropped = 0

    /// Roughly ten seconds at 48 kHz — far more than a drain interval, so overflow only
    /// happens if the writer thread has genuinely stalled.
    private let capacity = 480_000

    init() { storage.reserveCapacity(capacity) }

    func append(_ pointer: UnsafePointer<Float>, count: Int) {
        os_unfair_lock_lock(&lock)
        if storage.count + count > capacity {
            dropped += count
        } else {
            storage.append(contentsOf: UnsafeBufferPointer(start: pointer, count: count))
        }
        os_unfair_lock_unlock(&lock)
    }

    func drain() -> (samples: [Float], dropped: Int) {
        os_unfair_lock_lock(&lock)
        let samples = storage
        let lost = dropped
        storage.removeAll(keepingCapacity: true)
        dropped = 0
        os_unfair_lock_unlock(&lock)
        return (samples, lost)
    }
}
