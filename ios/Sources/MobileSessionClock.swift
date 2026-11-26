import Foundation
import Darwin

// Native credential metadata only. Continuous time advances through sleep and cannot be set by the renderer.
enum MobileSessionClock {
    static var now:TimeInterval { var info=mach_timebase_info_data_t();mach_timebase_info(&info);return Double(mach_continuous_time())*Double(info.numer)/Double(info.denom)/1_000_000_000 }
    static func valid(attestedAt:Date,ticks:TimeInterval,deadline:TimeInterval,wall:Date=Date(),continuous:TimeInterval=now)->Bool {
        guard ticks.isFinite,deadline.isFinite,continuous.isFinite,continuous>=ticks,continuous<deadline else{return false}
        return abs(wall.timeIntervalSince(attestedAt)-(continuous-ticks))<=5
    }
}
