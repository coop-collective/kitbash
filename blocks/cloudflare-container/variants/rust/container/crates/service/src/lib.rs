use axum::{
    Router,
    body::to_bytes,
    extract::{Request, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::sync::Semaphore;

pub const MAX_BYTES: usize = 1_048_576;
#[derive(Clone)]
pub struct Scratch {
    pub path: PathBuf,
    pub memory_backed: bool,
}

pub fn scratch_root(candidates: &[PathBuf]) -> std::io::Result<Scratch> {
    for root in candidates {
        let Ok(info) = std::fs::symlink_metadata(root) else {
            continue;
        };
        if !info.is_dir() || info.file_type().is_symlink() {
            continue;
        }
        let Ok(probe) = tempfile::Builder::new().prefix("probe-").tempdir_in(root) else {
            continue;
        };
        probe.close()?;
        return Ok(Scratch {
            path: root.clone(),
            memory_backed: memory_backed(root),
        });
    }
    Err(std::io::Error::other("no writable scratch directory"))
}

fn memory_backed(path: &Path) -> bool {
    #[cfg(target_os = "linux")]
    {
        nix::sys::statfs::statfs(path).is_ok_and(|fs| fs.filesystem_type().0 == 0x01021994)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = path;
        false
    }
}

pub fn default_scratch() -> std::io::Result<Scratch> {
    let mut roots: Vec<PathBuf> = std::env::var_os("TMPDIR")
        .map(PathBuf::from)
        .into_iter()
        .collect();
    roots.extend(["/dev/shm", "/app-tmp", "/tmp"].map(PathBuf::from));
    scratch_root(&roots)
}

#[derive(Clone)]
struct App {
    scratch: Scratch,
    slots: Arc<Semaphore>,
}

pub fn router(scratch: Scratch) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/hash", post(hash))
        .with_state(App {
            scratch,
            slots: Arc::new(Semaphore::new(2)),
        })
}

async fn health(State(app): State<App>) -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "application/json")],
        format!(
            "{{\"ok\":true,\"scratchMemoryBacked\":{}}}",
            app.scratch.memory_backed
        ),
    )
}

async fn hash(State(app): State<App>, request: Request) -> Response {
    if request.uri().query().is_some() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Ok(permit) = app.slots.try_acquire_owned() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let bytes = match tokio::time::timeout(
        Duration::from_secs(10),
        to_bytes(request.into_body(), MAX_BYTES),
    )
    .await
    {
        Err(_) => return StatusCode::REQUEST_TIMEOUT.into_response(),
        Ok(Err(_)) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
        Ok(Ok(bytes)) => bytes,
    };
    // At most two bounded bodies and files exist. The blocking task owns the permit and RAII cleanup,
    // so cancelling the HTTP future cannot release capacity while its filesystem work is still running.
    let result = tokio::task::spawn_blocking(move || -> std::io::Result<(usize, String)> {
        let _permit = permit;
        let directory = private_job(&app.scratch.path)?;
        let path = directory.path().join("input");
        use std::io::{Read, Write};
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&path)?;
        file.write_all(&bytes)?;
        drop(file);
        let mut file = std::fs::File::open(&path)?;
        let mut buffer = [0_u8; 8192];
        let mut digest = Sha256::new();
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            digest.update(&buffer[..read]);
        }
        let result = (bytes.len(), format!("{:x}", digest.finalize()));
        drop(file);
        directory.close()?;
        Ok(result)
    })
    .await;
    match result {
        Ok(Ok((bytes, digest))) => (
            [
                (header::CONTENT_TYPE, "application/json"),
                (header::CACHE_CONTROL, "no-store"),
            ],
            format!("{{\"bytes\":{bytes},\"sha256\":\"{digest}\"}}"),
        )
            .into_response(),
        _ => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

fn private_job(root: &Path) -> std::io::Result<tempfile::TempDir> {
    use std::os::unix::fs::PermissionsExt;
    tempfile::Builder::new()
        .prefix("job-")
        .permissions(std::fs::Permissions::from_mode(0o700))
        .tempdir_in(root)
}

pub fn bind_address(port: Option<&str>) -> Result<std::net::SocketAddr, &'static str> {
    let port = port
        .unwrap_or("8080")
        .parse::<u16>()
        .map_err(|_| "invalid PORT")?;
    if port == 0 {
        return Err("invalid PORT");
    }
    Ok(([0, 0, 0, 0], port).into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn scratch_job_is_private_and_raii_removes_it() {
        let root = tempfile::tempdir().unwrap();
        let job = private_job(root.path()).unwrap();
        let path = job.path().to_path_buf();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o700
        );
        drop(job);
        assert!(!path.exists());
    }
}
