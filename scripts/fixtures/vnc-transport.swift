import Foundation
import Network
@main struct TransportTest {
 static func main() throws {
  let service = VNCTransport()
  let listener = try NWListener(using:.tcp, on:.any)
  var peer: NWConnection?
  let payload = Data((0..<2097152).map { UInt8($0 % 251) })
  var received = Data(), token = ""
  var paused = false, resumed = false
  listener.newConnectionHandler = { c in peer = c; c.start(queue:.main); c.send(content:payload, completion:.contentProcessed { _ in }) }
  listener.stateUpdateHandler = { state in
   if case .ready = state {
    let result = try! service.call("vnc.open", ["id":"fixture", "host":"127.0.0.1", "port":Int(listener.port!.rawValue)]) as! [String:String];token = result["token"]!
   }
  }
  service.emit = { m in
   guard m["event"] as? String == "vnc.data" else { return }
   let data = Data(base64Encoded:m["data"] as! String)!; received.append(data)
   if !resumed {
    if received.count == 1048576 && !paused {
     paused = true
     DispatchQueue.main.asyncAfter(deadline:.now()+0.2) {
      precondition(received.count == 1048576, "Host must stop reading without credit")
      precondition(service.streams["fixture"]!.outstanding == 1048576)
      resumed = true
      _ = try! service.call("vnc.ack",["id":"fixture","token":token,"bytes":1048576])
     }
    }
   } else { _ = try! service.call("vnc.ack",["id":"fixture","token":token,"bytes":data.count]) }
   if received.count == payload.count {
    precondition(received == payload)
    do { _ = try service.call("vnc.write",["id":"fixture","token":"stale","data":"AA=="]); fatalError("Accepted stale token") } catch {}
    let encoded = Data(repeating:42,count:65536).base64EncodedString()
    for _ in 0..<16 { _ = try! service.call("vnc.write",["id":"fixture","token":token,"data":encoded]) }
    do { _ = try service.call("vnc.write",["id":"fixture","token":token,"data":"AA=="]); fatalError("Accepted write queue overflow") } catch {}
    precondition(service.streams.isEmpty, "Overflow must retire its stream")
    service.closeAll();precondition(service.streams.isEmpty);peer?.cancel();listener.cancel();print("PASS VNC real TCP 2 MiB byte preservation, 1 MiB read backpressure/resume, write overflow retirement, stale-token rejection and cleanup");exit(0)
   }
  }
  listener.start(queue:.main)
  DispatchQueue.main.asyncAfter(deadline:.now()+10) { fatalError("VNC transport timed out") }
  dispatchMain()
 }
}
