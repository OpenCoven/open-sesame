//! Development-only native qualification receipts. No renderer command or provider invocation.
use crate::AppState;
use open_sesame_core::{
    process::{EnvSource, Fallback, ShellEnv},
    Core,
};
use serde_json::json;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, Runtime};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);
static PUBLISHED: Mutex<u64> = Mutex::new(0);

struct Observation {
    directory: PathBuf,
    core: Arc<Core>,
    environment: ShellEnv,
    event: &'static str,
    sequence: u64,
    observed_at: u128,
}

/// Snapshot memory only. Receipt I/O and discovery must never delay a page or its bridge reply.
pub fn record<R: Runtime>(app: &AppHandle<R>, event: &'static str) {
    let Some(directory) = std::env::var_os("OPEN_SESAME_RUNTIME_PROBE_DIR").map(PathBuf::from)
    else {
        return;
    };
    if !directory.is_absolute() {
        return;
    }
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let observation = Observation {
        directory,
        core: Arc::clone(&state.core),
        environment: state.startup.environment(),
        event,
        sequence: SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1,
        observed_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    };
    enqueue(move || observation.write());
}

fn enqueue(action: impl FnOnce() + Send + 'static) {
    // Dropping the join handle leaves this diagnostic work queued; callers never await it.
    drop(tauri::async_runtime::spawn_blocking(action));
}

impl Observation {
    fn write(self) {
        if !self.directory.is_dir() {
            return;
        }
        // Use the environment captured at the observed event, never a later startup snapshot.
        let found = self.core.find_tool("runtime-fixture", &self.environment);
        let report = json!({
            "event": self.event, "processId": std::process::id(), "sequence": self.sequence,
            "observedAtUnixMs": self.observed_at,
            "captureReady": self.environment.source() != &EnvSource::Inherited(Fallback::NotCaptured),
            "source": format!("{:?}",self.environment.source()),
            "fixturePath": found.as_ref().ok().and_then(|path| path.as_ref()),
            "error": found.err().map(|error| error.to_string()),
        });
        if let Ok(bytes) = serde_json::to_vec_pretty(&report) {
            let name = format!("probe-{}-{}.json", std::process::id(), self.sequence);
            let _ = std::fs::write(self.directory.join(name), &bytes);
            let mut published = PUBLISHED.lock().unwrap_or_else(|p| p.into_inner());
            if self.sequence > *published
                && std::fs::write(self.directory.join("probe.json"), bytes).is_ok()
            {
                *published = self.sequence;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn receipt_work_does_not_hold_its_calling_callback_or_run_on_its_thread() {
        use std::{
            sync::{atomic::AtomicBool, mpsc},
            time::Duration,
        };
        let returned = Arc::new(AtomicBool::new(false));
        let observed_return = Arc::clone(&returned);
        let (release, wait) = mpsc::channel();
        let (done, finished) = mpsc::channel();
        let caller = std::thread::current().id();
        enqueue(move || {
            let _ = wait.recv_timeout(Duration::from_secs(5));
            done.send((
                std::thread::current().id(),
                observed_return.load(Ordering::SeqCst),
            ))
            .unwrap();
        });
        returned.store(true, Ordering::SeqCst);
        let _ = release.send(());
        let (worker, callback_returned) = finished.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(
            callback_returned,
            "receipt work withheld the caller's return"
        );
        assert_ne!(
            worker, caller,
            "receipt work ran on the page/reply callback thread"
        );
    }
}
