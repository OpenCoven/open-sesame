use super::*;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    thread,
    time::Instant,
};

fn read_request(socket: &mut TcpStream) -> serde_json::Value {
    // Accepted sockets can inherit O_NONBLOCK on macOS. Headers may arrive later.
    socket.set_nonblocking(false).unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut bytes = Vec::new();
    let mut byte = [0];
    while !bytes.ends_with(b"\r\n\r\n") {
        socket.read_exact(&mut byte).unwrap();
        bytes.push(byte[0]);
        assert!(bytes.len() < 32768);
    }
    let header = String::from_utf8(bytes).unwrap();
    let count: usize = header
        .lines()
        .find_map(|line| {
            line.to_lowercase()
                .strip_prefix("content-length:")
                .map(str::trim)
                .and_then(|s| s.parse().ok())
        })
        .unwrap();
    assert!(count < 1_000_000);
    let mut body = vec![0; count];
    socket.read_exact(&mut body).unwrap();
    serde_json::from_slice(&body).unwrap()
}
fn server(
    replies: Vec<(&'static str, String)>,
) -> (String, thread::JoinHandle<Vec<serde_json::Value>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let mut requests = Vec::new();
        for (kind, body) in replies {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut socket = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline, "Fixture request timed out");
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("{error}"),
                }
            };
            requests.push(read_request(&mut socket));
            let header=format!("HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len());
            socket.write_all(header.as_bytes()).unwrap();
            socket.write_all(body.as_bytes()).unwrap();
        }
        requests
    });
    (url, worker)
}
fn start() -> Start {
    Start {
        prompt: "Inspect the synthetic screen and click its fixture target".into(),
        history: vec![],
    }
}
#[tokio::test]
async fn cli_planner_roundtrips_native_http_and_typed_images() {
    let reply = |id: &str| {
        json!({"summary":"Synthetic observation","observation":{"id":id,"width":640,"height":480,"app":"Fixture","display":"Fixture display"},"image":"/9j/Zml4dHVyZQ=="}).to_string()
    };
    let (native, requests) = server(vec![
        ("application/json",json!({"message":"Observe.","action":{"action":"observe"}}).to_string()),
        ("application/json",reply("frame-1")),
        ("application/json",json!({"message":"Click.","action":{"action":"click","observation":"frame-1","coordinate":[320,240]}}).to_string()),
        ("application/json",reply("frame-2")),
        ("application/json",json!({"message":"Fixture visibly verified.","action":null}).to_string()),
    ]);
    execute(
        start(),
        reqwest::Client::builder().no_proxy().build().unwrap(),
        reqwest::Url::parse(&(native + "/computer")).unwrap(),
        "fixture-private-native-token-00000000".into(),
    )
    .await
    .unwrap();
    let requests = requests.join().unwrap();
    assert_eq!(requests.len(), 5);
    assert_eq!(requests[1]["action"], "observe");
    assert_eq!(requests[3]["observation"], "frame-1");
    assert_eq!(requests[3]["coordinate"], json!([320.0, 240.0]));
    let blocks = requests[2]["messages"].as_array().unwrap().last().unwrap()["content"]
        .as_array()
        .unwrap();
    assert!(blocks
        .iter()
        .any(|b| b["type"] == "image" && b["source"]["media_type"] == "image/jpeg"));
    assert!(blocks.iter().any(|b| b["type"] == "text"
        && b["text"]
            .as_str()
            .is_some_and(|s| s.contains("frame-1") && s.contains("640"))));
    assert!(requests[0]["system"]
        .as_str()
        .unwrap()
        .contains("Open Sesame"));
}
#[tokio::test]
async fn truncated_planner_result_cannot_dispatch_native_action() {
    let (base, provider) = server(vec![(
        "application/json",
        "{\"message\":\"unfinished\",\"action\":".into(),
    )]);
    let result = execute(
        start(),
        reqwest::Client::new(),
        reqwest::Url::parse(&(base + "/computer")).unwrap(),
        "fixture-private-token-0000000000000".into(),
    )
    .await;
    assert!(result.is_err());
    assert_ne!(result.unwrap_err(), "Native action was interrupted");
    provider.join().unwrap();
}
#[test]
fn retired_images_preserve_tool_result_pairing() {
    let mut messages:Vec<_>=(0..6).map(|_|Message::user_blocks(result_blocks("call".into(),serde_json::from_value(json!({"summary":"fixture","observation":{"id":"frame","width":640,"height":480,"app":"Fixture","display":"Fixture"},"image":"/9j/Zml4dHVyZQ=="})).unwrap()).unwrap().0)).collect();
    prune_images(&mut messages);
    let mut count = 0;
    for m in &messages {
        if let MessageContent::Blocks(blocks) = &m.content {
            assert!(matches!(
                blocks.first(),
                Some(ContentBlock::ToolResult { .. })
            ));
            count += blocks
                .iter()
                .filter(|b| matches!(b, ContentBlock::Image { .. }))
                .count();
        }
    }
    assert_eq!(count, 4);
}

#[test]
fn fragmented_request_waits_for_header_and_body_bytes() {
    let (url, worker) = server(vec![("application/json", "{}".into())]);
    let mut stream = TcpStream::connect(url.trim_start_matches("http://")).unwrap();
    let body = br#"{"action":"observe"}"#;
    stream
        .write_all(
            format!(
                "POST /computer HTTP/1.1\r\nContent-Length: {}\r\n",
                body.len()
            )
            .as_bytes(),
        )
        .unwrap();
    thread::sleep(Duration::from_millis(20));
    stream
        .write_all(b"Content-Type: application/json\r\n\r\n")
        .unwrap();
    stream.write_all(&body[..10]).unwrap();
    thread::sleep(Duration::from_millis(20));
    stream.write_all(&body[10..]).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 200"));
    assert_eq!(worker.join().unwrap()[0]["action"], "observe");
}
