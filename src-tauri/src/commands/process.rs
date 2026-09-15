use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::Write,
    process::{Child, ChildStdin, Stdio},
    sync::{Arc, Mutex},
};
use tauri::{command, AppHandle, Emitter};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SpawnOptions {
    pub program:    String,
    pub args:       Vec<String>,
    pub cwd:        String,
    pub env:        HashMap<String, String>,
    pub session_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProcessInfo {
    pub session_id: String,
    pub pid:        u32,
    pub program:    String,
    pub status:     String,
}

pub struct ManagedProcess {
    pub child:   Child,
    pub stdin:   Option<ChildStdin>,
    pub program: String,
}

#[derive(Default)]
pub struct ProcessRegistry(pub Arc<Mutex<HashMap<String, ManagedProcess>>>);

impl ProcessRegistry {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(HashMap::new())))
    }
}

#[command]
pub async fn spawn_agent_process(
    app: AppHandle,
    opts: SpawnOptions,
    state: tauri::State<'_, ProcessRegistry>,
) -> Result<ProcessInfo, String> {
    let mut cmd = std::process::Command::new(&opts.program);
    cmd.args(&opts.args)
       .current_dir(&opts.cwd)
       .envs(&opts.env)
       .stdin(Stdio::piped())
       .stdout(Stdio::piped())
       .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let pid    = child.id();
    let stdin  = child.stdin.take();

    // Stream stdout → Tauri events
    if let Some(stdout) = child.stdout.take() {
        let app2 = app.clone();
        let sid  = opts.session_id.clone();
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            for line in BufReader::new(stdout).lines().flatten() {
                let _ = app2.emit("agent_output", serde_json::json!({
                    "session_id": sid,
                    "chunk": line,
                    "is_error": false,
                }));
            }
        });
    }

    // Stream stderr → Tauri events
    if let Some(stderr) = child.stderr.take() {
        let app3 = app.clone();
        let sid  = opts.session_id.clone();
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            for line in BufReader::new(stderr).lines().flatten() {
                let _ = app3.emit("agent_output", serde_json::json!({
                    "session_id": sid,
                    "chunk": line,
                    "is_error": true,
                }));
            }
        });
    }

    let info = ProcessInfo {
        session_id: opts.session_id.clone(),
        pid,
        program:    opts.program.clone(),
        status:     "running".to_string(),
    };

    let managed = ManagedProcess { child, stdin, program: opts.program };
    state.0.lock().unwrap().insert(opts.session_id, managed);

    Ok(info)
}

#[command]
pub fn kill_agent_process(
    session_id: String,
    state: tauri::State<'_, ProcessRegistry>,
) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    if let Some(mp) = map.get_mut(&session_id) {
        mp.child.kill().map_err(|e| e.to_string())?;
        map.remove(&session_id);
        Ok(())
    } else {
        Err(format!("no process for session {session_id}"))
    }
}

#[command]
pub fn send_to_process(
    session_id: String,
    data: String,
    state: tauri::State<'_, ProcessRegistry>,
) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    if let Some(mp) = map.get_mut(&session_id) {
        if let Some(ref mut stdin) = mp.stdin {
            stdin.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
            stdin.write_all(b"\n").map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("stdin not available".into())
        }
    } else {
        Err(format!("no process {session_id}"))
    }
}

#[command]
pub fn list_processes(
    state: tauri::State<'_, ProcessRegistry>,
) -> Vec<ProcessInfo> {
    state.0.lock().unwrap().iter().map(|(id, mp)| ProcessInfo {
        session_id: id.clone(),
        pid:        mp.child.id(),
        program:    mp.program.clone(),
        status:     "running".into(),
    }).collect()
}
