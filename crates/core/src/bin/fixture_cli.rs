//! A test fixture for the process runner (issue #73). It is not part of the app.
//!
//! Each subcommand does one small, predictable thing so the runner's tests can use a real child
//! process on every operating system without Python or a shell.

use std::io::{Read, Write};
use std::process::{Command, ExitCode};
use std::thread::sleep;
use std::time::Duration;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let rest: Vec<&str> = args.iter().skip(1).map(String::as_str).collect();
    let code = match args.first().map(String::as_str) {
        // sleep <seconds>
        Some("sleep") => {
            sleep(Duration::from_secs_f64(number(&rest, 0) as f64));
            0
        }
        // lines <n>: prints 1..=n, one per line, flushing each.
        Some("lines") => {
            let mut out = std::io::stdout();
            for line in 1..=number(&rest, 0) {
                if writeln!(out, "{line}").and_then(|()| out.flush()).is_err() {
                    break;
                }
                sleep(Duration::from_millis(5));
            }
            0
        }
        // flood <bytes>, flood-stderr <bytes>: writes that many bytes with no newline.
        Some("flood") => flood(&mut std::io::stdout(), number(&rest, 0)),
        Some("flood-stderr") => flood(&mut std::io::stderr(), number(&rest, 0)),
        // partial: two complete lines and an unterminated third.
        Some("partial") => {
            print!("one\r\ntwo\nthree");
            0
        }
        // echo-args <args...>: one argument per line, exactly as received.
        Some("echo-args") => {
            for arg in &rest {
                println!("{arg}");
            }
            0
        }
        Some("cwd") => {
            println!("{}", std::env::current_dir().map(|dir| dir.display().to_string()).unwrap_or_default());
            0
        }
        // env <NAME>: prints the value, or exits 1 when it is not set.
        Some("env") => match std::env::var(rest.first().copied().unwrap_or_default()) {
            Ok(value) => {
                println!("{value}");
                0
            }
            Err(_) => 1,
        },
        // exit <code>: writes a line to each stream, then exits with the code.
        Some("exit") => {
            println!("to stdout");
            eprintln!("to stderr");
            number(&rest, 0) as u8
        }
        // cat: copies standard input to standard output.
        Some("cat") => {
            let mut input = Vec::new();
            let _ = std::io::stdin().read_to_end(&mut input);
            let _ = std::io::stdout().write_all(&input);
            0
        }
        // heartbeat <file>: writes a growing counter to the file until killed.
        Some("heartbeat") => {
            let file = rest.first().copied().unwrap_or_default();
            for beat in 1u64.. {
                let _ = std::fs::write(file, beat.to_string());
                sleep(Duration::from_millis(20));
            }
            0
        }
        // spawn-child-and-sleep <file>: starts a heartbeat child, prints its PID, then sleeps.
        // spawn-child-and-exit <file>: the same, but exits at once and leaves the child running
        // with this process's output pipes still open.
        Some(mode @ ("spawn-child-and-sleep" | "spawn-child-and-exit")) => {
            let file = rest.first().copied().unwrap_or_default();
            let program = std::env::current_exe().expect("the fixture knows its own path");
            match Command::new(program).args(["heartbeat", file]).spawn() {
                Ok(child) => {
                    println!("{}", child.id());
                    let _ = std::io::stdout().flush();
                    if mode == "spawn-child-and-sleep" {
                        sleep(Duration::from_secs(30));
                    }
                    0
                }
                Err(_) => 3,
            }
        }
        _ => {
            eprintln!("fixture_cli: unknown subcommand");
            2
        }
    };
    ExitCode::from(code)
}

fn number(rest: &[&str], index: usize) -> usize {
    rest.get(index).and_then(|text| text.parse().ok()).unwrap_or(0)
}

fn flood(out: &mut dyn Write, mut bytes: usize) -> u8 {
    let chunk = [b'x'; 8192];
    while bytes > 0 {
        let count = bytes.min(chunk.len());
        if out.write_all(&chunk[..count]).is_err() {
            return 0;
        }
        bytes -= count;
    }
    let _ = out.flush();
    0
}
