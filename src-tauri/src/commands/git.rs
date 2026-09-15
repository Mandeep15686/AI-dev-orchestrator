use git2::{Repository, StatusOptions, DiffOptions, ResetType};
use serde::{Deserialize, Serialize};
use tauri::command;
use anyhow::{Context, Result};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileStatus {
    pub path: String,
    pub status: String, // "modified" | "added" | "deleted" | "renamed" | "untracked"
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitStatus {
    pub branch: String,
    pub commit:  String,
    pub dirty:   bool,
    pub files:   Vec<FileStatus>,
    pub ahead:   i64,
    pub behind:  i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitCommit {
    pub oid:     String,
    pub message: String,
    pub author:  String,
    pub time:    i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorktreeInfo {
    pub path:   String,
    pub branch: String,
    pub commit: String,
}

// ─── Commands ─────────────────────────────────────────────────────────────────

#[command]
pub fn git_status(project_path: String) -> Result<GitStatus, String> {
    _git_status(&project_path).map_err(|e| e.to_string())
}

fn _git_status(path: &str) -> Result<GitStatus> {
    let repo = Repository::open(path).context("open repo")?;
    let head  = repo.head().context("get HEAD")?;
    let branch = head.shorthand().unwrap_or("HEAD").to_string();
    let commit = head
        .peel_to_commit()
        .map(|c| c.id().to_string())
        .unwrap_or_default();

    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts)).context("get statuses")?;

    let mut files = Vec::new();
    for entry in statuses.iter() {
        let path_str = entry.path().unwrap_or("").to_string();
        let s = entry.status();
        let status = if s.contains(git2::Status::WT_NEW) {
            "untracked"
        } else if s.contains(git2::Status::INDEX_NEW) {
            "added"
        } else if s.contains(git2::Status::WT_DELETED) || s.contains(git2::Status::INDEX_DELETED) {
            "deleted"
        } else if s.contains(git2::Status::WT_RENAMED) || s.contains(git2::Status::INDEX_RENAMED) {
            "renamed"
        } else {
            "modified"
        };
        files.push(FileStatus { path: path_str, status: status.to_string() });
    }
    let dirty = !files.is_empty();
    Ok(GitStatus { branch, commit, dirty, files, ahead: 0, behind: 0 })
}

#[command]
pub fn git_diff(project_path: String, from: Option<String>, to: Option<String>) -> Result<String, String> {
    _git_diff(&project_path, from.as_deref(), to.as_deref()).map_err(|e| e.to_string())
}

fn _git_diff(path: &str, from: Option<&str>, to: Option<&str>) -> Result<String> {
    let repo = Repository::open(path).context("open repo")?;
    let mut opts = DiffOptions::new();
    opts.context_lines(3);

    let diff = match (from, to) {
        (Some(f), Some(t)) => {
            let a = repo.revparse_single(f)?.peel_to_tree()?;
            let b = repo.revparse_single(t)?.peel_to_tree()?;
            repo.diff_tree_to_tree(Some(&a), Some(&b), Some(&mut opts))?
        }
        (Some(f), None) => {
            let tree = repo.revparse_single(f)?.peel_to_tree()?;
            repo.diff_tree_to_index(Some(&tree), None, Some(&mut opts))?
        }
        _ => repo.diff_index_to_workdir(None, Some(&mut opts))?,
    };

    let mut out = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let prefix = match line.origin() {
            '+' => "+",
            '-' => "-",
            _ => " ",
        };
        if let Ok(s) = std::str::from_utf8(line.content()) {
            out.push_str(prefix);
            out.push_str(s);
        }
        true
    })?;
    Ok(out)
}

#[command]
pub fn git_commit(project_path: String, message: String) -> Result<String, String> {
    _git_commit(&project_path, &message).map_err(|e| e.to_string())
}

fn _git_commit(path: &str, message: &str) -> Result<String> {
    let repo = Repository::open(path).context("open repo")?;
    let mut index = repo.index()?;
    index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;
    index.write()?;
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;
    let sig  = repo.signature()?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents = parent.as_ref().map(|p| vec![p]).unwrap_or_default();
    let oid = repo.commit(
        Some("HEAD"), &sig, &sig, message, &tree,
        parents.as_slice()
    )?;
    Ok(oid.to_string())
}

#[command]
pub fn git_log(project_path: String, limit: usize) -> Result<Vec<GitCommit>, String> {
    _git_log(&project_path, limit).map_err(|e| e.to_string())
}

fn _git_log(path: &str, limit: usize) -> Result<Vec<GitCommit>> {
    let repo = Repository::open(path)?;
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(git2::Sort::TIME)?;

    let mut commits = Vec::new();
    for (i, oid) in revwalk.enumerate() {
        if i >= limit { break; }
        let oid    = oid?;
        let commit = repo.find_commit(oid)?;
        commits.push(GitCommit {
            oid:     oid.to_string(),
            message: commit.summary().unwrap_or("").to_string(),
            author:  commit.author().name().unwrap_or("").to_string(),
            time:    commit.time().seconds(),
        });
    }
    Ok(commits)
}

#[command]
pub fn git_create_worktree(
    project_path: String,
    branch: String,
    worktree_path: String,
) -> Result<WorktreeInfo, String> {
    _git_create_worktree(&project_path, &branch, &worktree_path).map_err(|e| e.to_string())
}

fn _git_create_worktree(project_path: &str, branch: &str, wt_path: &str) -> Result<WorktreeInfo> {
    let output = std::process::Command::new("git")
        .args(["worktree", "add", "-b", branch, wt_path])
        .current_dir(project_path)
        .output()
        .context("spawn git")?;
    if !output.status.success() {
        anyhow::bail!("{}", String::from_utf8_lossy(&output.stderr));
    }
    let repo = Repository::open(wt_path)?;
    let commit = repo.head()?.peel_to_commit()?.id().to_string();
    Ok(WorktreeInfo { path: wt_path.to_string(), branch: branch.to_string(), commit })
}

#[command]
pub fn git_delete_worktree(project_path: String, worktree_path: String) -> Result<(), String> {
    let output = std::process::Command::new("git")
        .args(["worktree", "remove", "--force", &worktree_path])
        .current_dir(&project_path)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() { Ok(()) }
    else { Err(String::from_utf8_lossy(&output.stderr).to_string()) }
}

#[command]
pub fn git_rollback(project_path: String, commit: String) -> Result<(), String> {
    _git_rollback(&project_path, &commit).map_err(|e| e.to_string())
}

fn _git_rollback(path: &str, commit: &str) -> Result<()> {
    let repo = Repository::open(path)?;
    let obj  = repo.revparse_single(commit)?;
    repo.reset(&obj, ResetType::Hard, None)?;
    Ok(())
}

#[command]
pub fn git_merge_worktree(
    project_path: String,
    branch: String,
    target: String,
) -> Result<bool, String> {
    // Returns true = clean merge, false = conflicts
    let output = std::process::Command::new("git")
        .args(["merge", "--no-ff", &branch])
        .current_dir(&project_path)
        .env("GIT_MERGE_AUTOEDIT", "no")
        .output()
        .map_err(|e| e.to_string())?;
    let _ = target;
    Ok(output.status.success())
}
