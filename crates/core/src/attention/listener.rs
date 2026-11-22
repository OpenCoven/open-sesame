//! The loopback listener that Claude Code's HTTP hooks post to.
//!
//! It binds `127.0.0.1` only, so no other machine can reach it, and serves one path,
//! `/hook/<token>`, where the token is a random 256-bit value made when the hook is installed.
//! A request without that path, with any method but `POST`, with an `Origin` header (what a
//! browser page sends) or with a body that is not one JSON object is refused and is not an
//! event. Every accepted request is answered `204 No Content`: an empty answer tells Claude
//! Code nothing, so it never allows or denies anything on the person's behalf.

use serde_json::Value;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

/// The largest body taken. Hook events are a few kilobytes; a tool's input can be larger.
const MOST_BODY: usize = 1024 * 1024;
const MOST_HEADER: usize = 16 * 1024;
/// How long one connection may take to send its request.
const READ_TIMEOUT: Duration = Duration::from_secs(2);
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
                let (path, sink, open) = (path.clone(), Arc::clone(&sink), Arc::clone(&open));
                let served = std::thread::Builder::new()
                    .name("attention-request".into())
                    .spawn(move || {
                        serve(stream, &path, &*sink);
                        open.fetch_sub(1, Ordering::SeqCst);
                    });
                if served.is_err() {
                    // The thread could not start; its stream was dropped with the closure.
                    continue;
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
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
    let _ = stream.set_write_timeout(Some(READ_TIMEOUT));
    let Ok(reader) = stream.try_clone() else {
        return;
    };
    let (status, event) = answer(BufReader::new(reader), path);
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
    drop(stream);
    if let Some(event) = event {
        sink(event);
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
    let mut body = vec![0; length];
    if reader.read_exact(&mut body).is_err() {
        return (400, None);
    }
    match serde_json::from_slice::<Value>(&body) {
        Ok(event @ Value::Object(_)) => (204, Some(event)),
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
