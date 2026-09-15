// src-tauri/src/ipc.rs
// Manages the stdio JSON-RPC pipe between the Rust native layer
// and the TypeScript Orchestration Core sidecar process.

use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Stdio},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id:      u64,
    pub method:  String,
    pub params:  serde_json::Value,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id:      u64,
    pub result:  Option<serde_json::Value>,
    pub error:   Option<JsonRpcError>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct JsonRpcError {
    pub code:    i32,
    pub message: String,
}

pub struct SidecarProcess {
    pub child: Child,
    pub stdin: Arc<Mutex<ChildStdin>>,
}

impl SidecarProcess {
    /// Spawn the Node.js orchestration sidecar.
    pub fn spawn(app: AppHandle, sidecar_path: &str) -> anyhow::Result<Self> {
        let mut child = std::process::Command::new("node")
            .arg(sidecar_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let stdin = child.stdin.take().expect("sidecar stdin");
        let stdin = Arc::new(Mutex::new(stdin));

        // Thread: read sidecar stdout → forward to Tauri events
        if let Some(stdout) = child.stdout.take() {
            let app2 = app.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    if line.trim().is_empty() { continue; }
                    // Parse as JSON-RPC notification or response
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                        // Forward orchestrator events straight to the UI
                        if let Some(method) = val.get("method").and_then(|m| m.as_str()) {
                            let payload = val.get("params").cloned().unwrap_or(serde_json::Value::Null);
                            let _ = app2.emit(method, payload);
                        }
                    }
                }
            });
        }

        // Thread: read sidecar stderr → log
        if let Some(stderr) = child.stderr.take() {
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    eprintln!("[sidecar stderr] {line}");
                }
            });
        }

        Ok(Self { child, stdin })
    }

    /// Send a JSON-RPC request to the sidecar.
    pub fn send(&self, req: &JsonRpcRequest) -> anyhow::Result<()> {
        let mut line = serde_json::to_string(req)?;
        line.push('\n');
        let mut stdin = self.stdin.lock().unwrap();
        stdin.write_all(line.as_bytes())?;
        stdin.flush()?;
        Ok(())
    }

    /// Send a plain event notification (no response expected).
    pub fn notify(&self, method: &str, params: serde_json::Value) -> anyhow::Result<()> {
        let notif = serde_json::json!({
            "jsonrpc": "2.0",
            "method":  method,
            "params":  params,
        });
        let mut line = serde_json::to_string(&notif)?;
        line.push('\n');
        let mut stdin = self.stdin.lock().unwrap();
        stdin.write_all(line.as_bytes())?;
        stdin.flush()?;
        Ok(())
    }
}

/// Tauri state wrapper
pub struct SidecarState(pub Arc<Mutex<Option<SidecarProcess>>>);

impl Default for SidecarState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(None)))
    }
}
