//! Stdio NDJSON transport — dedicated OS threads (PI-Desktop §5a).
//!
//! One thread reads stdin line-by-line into a tokio mpsc channel; one thread
//! serializes outbound responses to stdout. Tokio's `tokio::io::{stdin,
//! stdout}` adapters are intentionally NOT used because they each grab a
//! blocking-pool worker per call, and an exhausted OS-thread budget would
//! panic the host before a structured error reached Electron.

use std::io::{self, BufRead, BufReader, Write};
use std::sync::mpsc as std_mpsc;
use std::thread;

use anyhow::{anyhow, Result};
use serde_json::Value;

use super::{JsonRpcNotification, JsonRpcRequest, JsonRpcResponse};

/// Event sent from the stdin reader to the dispatcher.
pub enum DispatchEvent {
    Request(Box<JsonRpcRequest>),
    /// Oversize frame (the line exceeded `MAX_STDIN_LINE_BYTES`).
    Oversize {
        id: Value,
    },
    /// IO error reading stdin.
    StdinError(String),
    /// Final EOF marker.
    Eof,
}

/// Spawn the stdin reader thread and return a future that resolves once
/// stdin closes or the reader thread reports a fatal error.
pub async fn run(outbound: std_mpsc::Sender<DispatchEvent>) -> Result<()> {
    let (ready_tx, ready_rx) = std_mpsc::channel::<Result<()>>();
    let (stdin_tx, stdin_rx) = std_mpsc::channel::<DispatchEvent>();

    spawn_stdin_reader(ready_tx, stdin_tx)?;
    // Outer `?` unwraps the channel `RecvError`, inner `?` the reader thread's
    // own result.
    ready_rx.recv()??;

    // Forward stdin events into the dispatcher thread. The forwarder used
    // to be a tokio task that pushed events into a `tokio::sync::mpsc`
    // channel; under `current_thread` + `std::future::pending` the
    // dispatcher never woke up reliably. Sending directly through the
    // `std::sync::mpsc` channel owned by `rpc::serve` removes that pitfall.
    std::thread::Builder::new()
        .name("openbuddy-forwarder".into())
        .spawn(move || {
            while let Ok(event) = stdin_rx.recv() {
                if outbound.send(event).is_err() {
                    break;
                }
            }
        })
        .map_err(|e| anyhow!("failed to spawn forwarder thread: {e}"))?;

    // Spawn the stdout writer thread.
    spawn_stdout_writer()?;

    // Block on a sentinel: we don't tear down explicitly; the supervisor
    // handles process exit when the parent process closes our stdin.
    std::future::pending::<()>().await;
    Ok(())
}

fn spawn_stdin_reader(
    ready_tx: std_mpsc::Sender<Result<()>>,
    event_tx: std_mpsc::Sender<DispatchEvent>,
) -> Result<()> {
    thread::Builder::new()
        .name("openbuddy-stdin".into())
        .spawn(move || {
            let stdin = io::stdin();
            let mut reader = BufReader::new(stdin.lock());

            // Signal readiness after thread spawn so callers can wire the
            // outbound channel before the first event arrives.
            // Signal readiness after thread spawn so callers can wire the
            // outbound channel before the first event arrives.
            let _ = ready_tx.send(Ok(()));
            let mut buf = String::new();
            loop {
                buf.clear();
                match read_line_with_limit(&mut reader, &mut buf, crate::MAX_STDIN_LINE_BYTES) {
                    Ok(ReadOutcome::Line(_len)) => {
                        let trimmed = buf.trim_end_matches(['\n', '\r']);
                        let parse_result: serde_json::Result<JsonRpcRequest> =
                            serde_json::from_str(trimmed);
                        match parse_result {
                            Ok(req) => {
                                if event_tx
                                    .send(DispatchEvent::Request(Box::new(req)))
                                    .is_err()
                                {
                                    return;
                                }
                            }
                            Err(err) => {
                                // Surface a structured parse error back to the
                                // parent so Electron logs the line length but
                                // not the payload (PI-Desktop §2.1).
                                let payload_len = trimmed.len();
                                if event_tx
                                    .send(DispatchEvent::StdinError(format!(
                                        "parse_error len={payload_len}: {err}"
                                    )))
                                    .is_err()
                                {
                                    return;
                                }
                            }
                        }
                    }
                    Ok(ReadOutcome::Oversize) => {
                        // Best-effort peek for an id so the caller can
                        // correlate the rejection with the original request.
                        let id = peek_id(&buf);
                        if event_tx.send(DispatchEvent::Oversize { id }).is_err() {
                            return;
                        }
                        buf.clear();
                    }
                    Ok(ReadOutcome::Eof) => {
                        let _ = event_tx.send(DispatchEvent::Eof);
                        return;
                    }
                    Err(err) => {
                        let _ = event_tx.send(DispatchEvent::StdinError(err.to_string()));
                        return;
                    }
                }
            }
        })
        .map_err(|e| anyhow!("failed to spawn stdin reader thread: {e}"))?;
    Ok(())
}

/// Spawn the stdout writer thread. Outbound writes are funneled through a
/// `std::sync::mpsc` channel owned by the dispatcher; `submit_*` helpers post
/// to it.
fn spawn_stdout_writer() -> Result<()> {
    let (tx, rx) = std_mpsc::channel::<Outbound>();
    thread::Builder::new()
        .name("openbuddy-stdout".into())
        .spawn(move || {
            let stdout = io::stdout();
            let mut out = stdout.lock();
            while let Ok(msg) = rx.recv() {
                let bytes = match msg {
                    Outbound::Response(resp) => serde_json::to_vec(&resp).unwrap_or_default(),
                    Outbound::Notification(note) => serde_json::to_vec(&note).unwrap_or_default(),
                };
                let mut framed = bytes;
                framed.push(b'\n');
                if let Err(err) = out.write_all(&framed).and_then(|_| out.flush()) {
                    eprintln!("[openbuddy-host-core] stdout write failed: {err}");
                    return;
                }
            }
        })
        .map_err(|e| anyhow!("failed to spawn stdout writer thread: {e}"))?;
    // Install the channel as the process-wide writer.
    install_stdout_writer(tx);
    Ok(())
}

enum Outbound {
    Response(JsonRpcResponse),
    Notification(JsonRpcNotification),
}

static STDOUT_TX: std::sync::OnceLock<parking_lot::Mutex<Option<std_mpsc::Sender<Outbound>>>> =
    std::sync::OnceLock::new();
fn stdout_tx() -> &'static parking_lot::Mutex<Option<std_mpsc::Sender<Outbound>>> {
    STDOUT_TX.get_or_init(|| parking_lot::Mutex::new(None))
}

fn install_stdout_writer(tx: std_mpsc::Sender<Outbound>) {
    *stdout_tx().lock() = Some(tx);
}

/// Public helper for the dispatcher to write a JSON-RPC response.
pub fn submit_response(resp: JsonRpcResponse) -> Result<()> {
    let guard = stdout_tx().lock();
    let tx = guard
        .as_ref()
        .ok_or_else(|| anyhow!("stdout writer not installed"))?;
    tx.send(Outbound::Response(resp))
        .map_err(|e| anyhow!("stdout channel closed: {e}"))
}

/// Public helper for the dispatcher to push a notification.
pub fn submit_notification(method: String, params: Value) -> Result<()> {
    let guard = stdout_tx().lock();
    let tx = guard
        .as_ref()
        .ok_or_else(|| anyhow!("stdout writer not installed"))?;
    tx.send(Outbound::Notification(JsonRpcNotification {
        jsonrpc: "2.0",
        method,
        params,
    }))
    .map_err(|e| anyhow!("stdout channel closed: {e}"))
}

enum ReadOutcome {
    Line(usize),
    Oversize,
    Eof,
}

fn read_line_with_limit<R: BufRead>(
    reader: &mut R,
    buf: &mut String,
    max: usize,
) -> io::Result<ReadOutcome> {
    // Plain `BufRead::read_line` (PI-Desktop reference
    // `crates/host-core/src/rpc/mod.rs:spawn_stdin_reader`). The
    // implementation reads until LF or EOF without blocking on the
    // underlying pipe to fill a fixed buffer, which is the behaviour we
    // need when Node's `child.stdin.write` is delivering bytes through a
    // Unix-socket-backed stdio pipe.
    let read = reader.read_line(buf)?;
    if read == 0 {
        return Ok(ReadOutcome::Eof);
    }
    if buf.len() > max {
        return Ok(ReadOutcome::Oversize);
    }
    Ok(ReadOutcome::Line(read))
}

/// Best-effort id extraction from a possibly truncated NDJSON line. Mirrors
/// PI-Desktop's `peek_jsonrpc_id`.
fn peek_id(prefix: &str) -> Value {
    let window = prefix.get(..prefix.len().min(2048)).unwrap_or(prefix);
    if let Ok(value) = serde_json::from_str::<Value>(window) {
        return value.get("id").cloned().unwrap_or(Value::Null);
    }
    let bytes = window.as_bytes();
    let mut i = 0;
    while i + 4 < bytes.len() {
        if &bytes[i..i + 4] != b"\"id\"" {
            i += 1;
            continue;
        }
        let mut j = i + 4;
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        if j >= bytes.len() || bytes[j] != b':' {
            i += 1;
            continue;
        }
        j += 1;
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        if j >= bytes.len() {
            return Value::Null;
        }
        if bytes[j] == b'"' {
            // String id — scan for the matching unescaped quote.
            let mut k = j + 1;
            while k < bytes.len() {
                if bytes[k] == b'\\' {
                    k += 2;
                    continue;
                }
                if bytes[k] == b'"' {
                    let raw = &window[j + 1..k];
                    return Value::String(raw.to_string());
                }
                k += 1;
            }
            return Value::Null;
        }
        // Numeric id — read digits.
        let mut k = j;
        while k < bytes.len() && (bytes[k].is_ascii_digit() || bytes[k] == b'-' || bytes[k] == b'+')
        {
            k += 1;
        }
        if k > j {
            let raw = &window[j..k];
            if let Ok(n) = raw.parse::<i64>() {
                return Value::Number(n.into());
            }
        }
        return Value::Null;
    }
    Value::Null
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peek_id_picks_string_id() {
        let s = r#"{"jsonrpc":"2.0","id":"req_01","method":"app.handshake"}"#;
        assert_eq!(peek_id(s), Value::String("req_01".into()));
    }

    #[test]
    fn peek_id_picks_numeric_id() {
        let s = r#"{"jsonrpc":"2.0","id":42,"method":"app.handshake"}"#;
        assert_eq!(peek_id(s), Value::Number(42.into()));
    }

    #[test]
    fn peek_id_returns_null_when_missing() {
        let s = r#"{"jsonrpc":"2.0","method":"app.handshake"}"#;
        assert_eq!(peek_id(s), Value::Null);
    }

    #[test]
    fn peek_id_tolerates_truncated_input() {
        let s = r#"{"jsonrpc":"2.0","id":"req_01","method":"app.handshake","params":"#;
        let result = peek_id(s);
        assert_eq!(result, Value::String("req_01".into()));
    }
}
