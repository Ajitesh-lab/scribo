import Cocoa
import ApplicationServices
import Foundation

func emit(_ value: String) {
  print(value)
  fflush(stdout)
}

func emitError(_ value: String) {
  fputs("\(value)\n", stderr)
  fflush(stderr)
}

let hasInputMonitoring = CGPreflightListenEventAccess()
let requestedInputMonitoring = hasInputMonitoring || CGRequestListenEventAccess()

if !requestedInputMonitoring {
  emitError("ERROR:INPUT_MONITORING_REQUIRED")
  exit(1)
}

let controlKeyCodes: Set<Int64> = [59, 62]
var isControlPressed = false
var eventTapPort: CFMachPort?

func eventTapCallback(
  proxy: CGEventTapProxy,
  type: CGEventType,
  event: CGEvent,
  userInfo: UnsafeMutableRawPointer?,
) -> Unmanaged<CGEvent>? {
  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
    if let tap = eventTapPort {
      CGEvent.tapEnable(tap: tap, enable: true)
    }

    return Unmanaged.passUnretained(event)
  }

  guard type == .flagsChanged else {
    return Unmanaged.passUnretained(event)
  }

  let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
  guard controlKeyCodes.contains(keyCode) else {
    return Unmanaged.passUnretained(event)
  }

  let pressed = event.flags.contains(.maskControl)
  if pressed != isControlPressed {
    isControlPressed = pressed
    emit(pressed ? "DOWN" : "UP")
  }

  return Unmanaged.passUnretained(event)
}

let eventMask = (1 << CGEventType.flagsChanged.rawValue)
guard let eventTap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  options: .listenOnly,
  eventsOfInterest: CGEventMask(eventMask),
  callback: eventTapCallback,
  userInfo: nil,
) else {
  emitError("ERROR:EVENT_TAP_CREATE_FAILED")
  exit(1)
}

eventTapPort = eventTap

guard let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0) else {
  emitError("ERROR:RUN_LOOP_SOURCE_FAILED")
  exit(1)
}

CGEvent.tapEnable(tap: eventTap, enable: true)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
emit("READY")
RunLoop.current.run()
