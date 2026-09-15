// src-tauri/src/commands/database.rs
// Re-export database commands from the top-level database module.
// The actual implementation lives in database.rs to keep this file small.
pub use crate::database::{db_query, db_execute, QueryResult};
