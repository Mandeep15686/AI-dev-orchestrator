// src-tauri/src/commands/fs.rs
// Filesystem commands exposed to the TypeScript orchestration core.
// Scoped to allowed paths — never reaches outside project directories.

use std::path::Path;
use tauri::command;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct DirEntry {
    pub name:     String,
    pub path:     String,
    pub is_dir:   bool,
    pub size:     u64,
    pub modified: i64,
}

/// Read a text file from disk. Returns an error if not UTF-8.
#[command]
pub fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("read_file({path}): {e}"))
}

/// Write text content to a file, creating parent directories as needed.
#[command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create_dir_all: {e}"))?;
    }
    std::fs::write(&path, content.as_bytes())
        .map_err(|e| format!("write_file({path}): {e}"))
}

/// List the immediate children of a directory (one level deep).
#[command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let entries = std::fs::read_dir(&path)
        .map_err(|e| format!("list_dir({path}): {e}"))?;

    let mut result = Vec::new();
    for entry in entries.flatten() {
        let meta     = entry.metadata().ok();
        let is_dir   = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size     = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified = meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        result.push(DirEntry {
            name:   entry.file_name().to_string_lossy().into_owned(),
            path:   entry.path().to_string_lossy().into_owned(),
            is_dir,
            size,
            modified,
        });
    }
    result.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(result)
}

/// Create a directory (and all intermediate parents).
#[command]
pub fn ensure_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path)
        .map_err(|e| format!("ensure_dir({path}): {e}"))
}

/// Check whether a path exists on the filesystem.
#[command]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Append text to a file, creating it if it doesn't exist.
#[command]
pub fn append_file(path: String, content: String) -> Result<(), String> {
    use std::io::Write;
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true).append(true).open(&path)
        .map_err(|e| e.to_string())?;
    f.write_all(content.as_bytes()).map_err(|e| e.to_string())
}

/// Delete a file or (recursively) a directory.
#[command]
pub fn delete_path(path: String, recursive: bool) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() { return Ok(()); }
    if p.is_dir() && recursive {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else if p.is_file() {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    } else {
        Err("Path is a directory; set recursive=true to delete".into())
    }
}
