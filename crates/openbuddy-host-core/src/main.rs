//! OpenBuddy host-core entry point.
//!
//! Mirrors PI-Desktop `crates/host-core/src/main.rs`:
//! 1. Initialise tracing to stderr.
//! 2. Resolve the data directory (`PI_OPENBUDDY_DATA_DIR` or `~/.openbuddy`).
//! 3. Create the directory tree (`logs/`, `secrets/`, `cache/`, etc.).
//! 4. Open `AppState`.
//! 5. Hand control to `rpc::serve` which spawns the stdin reader, stdout
//!    writer, and dispatcher tasks.

use std::process::ExitCode;
use std::sync::Arc;

use openbuddy_host_core::rpc;
use openbuddy_host_core::state::{AppState, DataDir};
use tracing_subscriber::EnvFilter;

#[cfg(not(test))]
#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    let data_dir = match DataDir::resolve() {
        Ok(dir) => dir,
        Err(err) => {
            eprintln!("[openbuddy-host-core] failed to resolve data dir: {err:#}");
            return ExitCode::from(2);
        }
    };

    if let Err(err) = ensure_subdirs(&data_dir) {
        eprintln!(
            "[openbuddy-host-core] failed to prepare {}: {err:#}",
            data_dir.0.display()
        );
        return ExitCode::from(2);
    }

    let state: Arc<AppState> = match AppState::open(data_dir.clone()) {
        Ok(state) => state,
        Err(err) => {
            eprintln!("[openbuddy-host-core] failed to open state: {err:#}");
            return ExitCode::from(2);
        }
    };

    tracing::info!(
        target: "openbuddy.host",
        version = openbuddy_host_core::HOST_VERSION,
        protocol = openbuddy_host_core::PROTOCOL_VERSION,
        data_dir = %data_dir.0.display(),
        "host-core starting"
    );

    if let Err(err) = rpc::serve(state).await {
        eprintln!("[openbuddy-host-core] rpc server stopped: {err:#}");
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}

fn ensure_subdirs(dir: &DataDir) -> anyhow::Result<()> {
    for sub in [
        dir.logs_dir(),
        dir.cache_dir(),
        dir.crash_dumps_dir(),
        dir.secrets_dir(),
    ] {
        std::fs::create_dir_all(&sub)?;
    }
    Ok(())
}
