//! The loopback listener that Claude Code's HTTP hooks post to.
//!
//! It binds `127.0.0.1` only, so no other machine can reach it, and serves one path,
//! `/hook/<token>`, where the token is a random 256-bit value made for each install (at the
//! first preview after the last removal).
//! A request without that path, with any method but `POST`, with an `Origin` header (what a
//! browser page sends) or with a body that is not one JSON object is refused and is not an
//! event. Every accepted request is answered `204 No Content`: an empty answer tells Claude
//! Code nothing, so it never allows or denies anything on the person's behalf.
//!
//! The body is read as it arrives, and only the fields the board reads are kept: the prompt, a
//! tool's input and output and the transcript's path are skipped without being stored. The
//! event is handed on before the reply, so Claude Code's next event cannot overtake it, and
//! each connection has a deadline, so connections that trickle bytes cannot hold every slot.

use serde::de::IgnoredAny;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// The largest body taken. A tool's output in `PostToolUse` can be megabytes; it is read and
/// skipped, never kept.
const MOST_BODY: usize = 64 * 1024 * 1024;
const MOST_HEADER: usize = 16 * 1024;
/// How long one connection may take to send its request, from its first byte to its last.
const DEADLINE: Duration = Duration::from_secs(3);
/// Connections served at once; more are closed unanswered.
const MOST_CONNECTIONS: usize = 16;

pub struct Listener {
    address: SocketAddr,
    stopping: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Listener {
    pub fn port(&self) -> u16 {
        self.address.port()
    }

    pub fn address(&self) -> SocketAddr {
        self.address
    }

    /// Stops accepting and closes the port. Requests already being read finish on their own.
    pub fn stop(mut self) {
        self.halt();
    }

    fn halt(&mut self) {
        self.stopping.store(true, Ordering::SeqCst);
        // Wakes the accepting thread, which then sees the flag.
        let _ = TcpStream::connect_timeout(&self.address, Duration::from_secs(1));
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        if self.thread.is_some() {
            self.halt();
        }
    }
}

/// Listens on `127.0.0.1:port` (`0` for any free port) and hands each accepted event to `sink`
/// on the connection's own thread.
pub fn start(
    port: u16,
    token: &str,
    sink: impl Fn(Value) + Send + Sync + 'static,
) -> io::Result<Listener> {
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    let address = listener.local_addr()?;
    let stopping = Arc::new(AtomicBool::new(false));
    let path = format!("/hook/{token}");
    let sink = Arc::new(sink);
    let open = Arc::new(AtomicUsize::new(0));
    let flag = Arc::clone(&stopping);
    let thread = std::thread::Builder::new()
        .name("attention-listener".into())
        .spawn(move || {
            for stream in listener.incoming() {
                if flag.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(stream) = stream else { continue };
                if open.fetch_add(1, Ordering::SeqCst) >= MOST_CONNECTIONS {
                    open.fetch_sub(1, Ordering::SeqCst);
                    continue;
                }
                let (path, sink, done) = (path.clone(), Arc::clone(&sink), Arc::clone(&open));
                let served = std::thread::Builder::new()
                    .name("attention-request".into())
                    .spawn(move || {
                        serve(stream, &path, &*sink);
                        done.fetch_sub(1, Ordering::SeqCst);
                    });
                if served.is_err() {
                    // The thread could not start: its stream went with the closure, and its
                    // slot is given back here.
                    open.fetch_sub(1, Ordering::SeqCst);
                }
            }
        })?;
    Ok(Listener {
        address,
        stopping,
        thread: Some(thread),
    })
}

fn serve(stream: TcpStream, path: &str, sink: &(dyn Fn(Value) + Send + Sync)) {
    let _ = stream.set_write_timeout(Some(DEADLINE));
    let Ok(reader) = stream.try_clone() else {
        return;
    };
    let reader = Deadline {
        stream: reader,
        until: Instant::now() + DEADLINE,
    };
    let (status, event) = answer(BufReader::new(reader), path);
    if let Some(event) = event {
        sink(event);
    }
    let reason = match status {
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Payload Too Large",
    };
    let mut stream = stream;
    let _ = write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    let _ = stream.flush();
}

/// A stream that gives up at a fixed moment, however the bytes trickle in.
struct Deadline {
    stream: TcpStream,
    until: Instant,
}

impl Read for Deadline {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let left = self.until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err(io::ErrorKind::TimedOut.into());
        }
        self.stream.set_read_timeout(Some(left))?;
        self.stream.read(buffer)
    }
}

/// The fields of an event the board reads. Every other field is skipped as it is read.
#[derive(Deserialize)]
struct Event {
    hook_event_name: Option<String>,
    session_id: Option<String>,
    cwd: Option<String>,
    tool_name: Option<String>,
    notification_type: Option<String>,
    message: Option<String>,
    /// Only whether it is there: a subagent's event.
    agent_id: Option<IgnoredAny>,
}

impl Event {
    fn value(self) -> Value {
        let mut kept = Map::new();
        for (name, text) in [
            ("hook_event_name", self.hook_event_name),
            ("session_id", self.session_id),
            ("cwd", self.cwd),
            ("tool_name", self.tool_name),
            ("notification_type", self.notification_type),
            ("message", self.message),
        ] {
            if let Some(text) = text {
                kept.insert(name.into(), Value::String(text));
            }
        }
        if self.agent_id.is_some() {
            kept.insert("agent_id".into(), Value::Bool(true));
        }
        Value::Object(kept)
    }
}

/// Reads one JSON object from the body, keeping only [`Event`]'s fields. Anything else, an
/// array or a string, is not an event.
fn object_of(body: &mut impl Read) -> Option<Value> {
    let mut deserializer = serde_json::Deserializer::from_reader(body);
    let event = Object::deserialize(&mut deserializer).ok()?.0;
    deserializer.end().ok()?;
    Some(event.value())
}

/// An [`Event`] read only from a JSON object.
struct Object(Event);

impl<'de> Deserialize<'de> for Object {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Fields;
        impl<'de> serde::de::Visitor<'de> for Fields {
            type Value = Object;
            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a JSON object")
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(self, map: A) -> Result<Object, A::Error> {
                Event::deserialize(serde::de::value::MapAccessDeserializer::new(map)).map(Object)
            }
        }
        deserializer.deserialize_map(Fields)
    }
}

/// The status for one request, and its event when it is one.
fn answer(mut reader: impl BufRead, path: &str) -> (u16, Option<Value>) {
    let mut head = Vec::new();
    let mut line = Vec::new();
    let mut lines = Vec::new();
    loop {
        line.clear();
        let limit = (MOST_HEADER - head.len().min(MOST_HEADER)) as u64 + 1;
        match (&mut reader).take(limit).read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => return (400, None),
            Ok(_) => {}
        }
        head.extend_from_slice(&line);
        if head.len() > MOST_HEADER || !line.ends_with(b"\n") {
            return (413, None);
        }
        let text = String::from_utf8_lossy(&line).trim_end().to_string();
        if text.is_empty() {
            break;
        }
        lines.push(text);
    }
    let mut request = lines
        .first()
        .map(|line| line.split(' '))
        .into_iter()
        .flatten();
    let (method, target) = (request.next().unwrap_or(""), request.next().unwrap_or(""));
    if !same(target.as_bytes(), path.as_bytes()) {
        return (404, None);
    }
    if method != "POST" {
        return (405, None);
    }
    let mut length = None;
    for header in &lines[1..] {
        let Some((name, value)) = header.split_once(':') else {
            return (400, None);
        };
        match name.trim().to_ascii_lowercase().as_str() {
            "origin" => return (403, None),
            "content-length" => length = value.trim().parse::<usize>().ok(),
            "transfer-encoding" => return (400, None),
            _ => {}
        }
    }
    let Some(length) = length else {
        return (400, None);
    };
    if length > MOST_BODY {
        return (413, None);
    }
    let mut body = reader.take(length as u64);
    let event = object_of(&mut body);
    // A body shorter than it said, or with more after the object, is not an event.
    match event {
        Some(event) if body.limit() == 0 => (204, Some(event)),
        _ => (400, None),
    }
}

/// Compares in time that does not depend on where the two differ.
fn same(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
