import AppKit
import Carbon.HIToolbox

final class GlobalShortcut {
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private var held = false
    private let action: () -> Void
    private(set) var available = false

    init(action: @escaping () -> Void) {
        self.action = action
        var events = [
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased))
        ]
        let installed = events.withUnsafeMutableBufferPointer { events in
            InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
                guard let event = event, let context = context else { return OSStatus(eventNotHandledErr) }
                let shortcut = Unmanaged<GlobalShortcut>.fromOpaque(context).takeUnretainedValue()
                var identifier = EventHotKeyID()
                guard GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &identifier) == noErr,
                      identifier.signature == 0x4F53534D, identifier.id == 1 else { return OSStatus(eventNotHandledErr) }
                if GetEventKind(event) == UInt32(kEventHotKeyReleased) { shortcut.held = false }
                else if !shortcut.held { shortcut.held = true; shortcut.action() }
                return noErr
            }, events.count, events.baseAddress, Unmanaged.passUnretained(self).toOpaque(), &handler)
        }
        guard installed == noErr else { return }
        let result = RegisterEventHotKey(UInt32(kVK_Space), UInt32(optionKey), EventHotKeyID(signature: 0x4F53534D, id: 1), GetApplicationEventTarget(), OptionBits(kEventHotKeyExclusive), &hotKey)
        available = result == noErr
        if !available, let handler = handler { RemoveEventHandler(handler); self.handler = nil }
    }

    func stop() {
        if let hotKey = hotKey { UnregisterEventHotKey(hotKey); self.hotKey = nil }
        if let handler = handler { RemoveEventHandler(handler); self.handler = nil }
        available = false
    }

    deinit { stop() }
}
