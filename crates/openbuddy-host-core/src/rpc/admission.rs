//! Admission control — mirrors PI-Desktop §2.1.
//!
//! Caps parallel in-flight requests so a runaway renderer cannot exhaust OS
//! resources. Phase 0 only enforces the global cap; per-tool-kind buckets
//! land in Phase 1 alongside the capability modules.

use std::sync::Arc;

use tokio::sync::Semaphore;

/// Total parallel RPC requests (matches PI-Desktop `32`).
pub const MAX_ACTIVE_REQUESTS: usize = 32;

/// Returned to callers so the [`Admission`] slot is held for the
/// duration of the await; the permit is released when the guard is
/// dropped. Stored as an `OwnedSemaphorePermit` so the dispatcher can
/// hand the guard across await points without lifetime gymnastics.

#[derive(Debug, Clone)]
pub struct Admission {
    global: Arc<Semaphore>,
}

impl Admission {
    pub fn new() -> Self {
        Self {
            global: Arc::new(Semaphore::new(MAX_ACTIVE_REQUESTS)),
        }
    }

    /// Acquire one slot. Returns a RAII guard on success; on overload the
    /// caller should bail with `RpcError::HostOverloaded` and let the TS side
    /// retry with the standard backoff.
    pub async fn acquire(&self) -> Option<AdmissionGuard> {
        match self.global.clone().try_acquire_owned() {
            Ok(permit) => Some(AdmissionGuard { permit }),
            Err(_) => None,
        }
    }
}

impl Default for Admission {
    fn default() -> Self {
        Self::new()
    }
}

pub struct AdmissionGuard {
    #[allow(dead_code)]
    permit: tokio::sync::OwnedSemaphorePermit,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caps_at_max_active_requests() {
        // Phase 0 admission is purely synchronous over a `Semaphore`; the
        // only async surface is `acquire().await`. We use `tokio::runtime`
        // directly so the test binary never depends on `#[tokio::main]`.
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("build runtime");
        let outcome = std::panic::catch_unwind(|| {
            rt.block_on(async {
                let adm = Admission::new();
                let mut guards = Vec::new();
                for _ in 0..MAX_ACTIVE_REQUESTS {
                    guards.push(adm.acquire().await.expect("slot available"));
                }
                assert!(adm.acquire().await.is_none(), "must refuse when full");
                drop(guards);
                assert!(adm.acquire().await.is_some(), "must recover after release");
            });
        });
        // Drop the runtime explicitly so its background IO / time drivers
        // (none here, but defensive) shut down before the test returns.
        drop(rt);
        if let Err(payload) = outcome {
            std::panic::resume_unwind(payload);
        }
    }
}
