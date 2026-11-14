//! Windows: the child is created suspended, placed in a job object that kills everything in it
//! when its last handle closes, and only then allowed to run. Processes the child starts are in
//! the job too.

use std::io;
use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    OpenThread, ResumeThread, WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED,
    THREAD_SUSPEND_RESUME,
};

/// A job object handle, closed when the last clone is dropped. Closing it kills what is left.
struct Job(HANDLE);

// SAFETY: a job handle may be used from any thread; the kernel synchronises access to the job.
unsafe impl Send for Job {}
unsafe impl Sync for Job {}

impl Drop for Job {
    fn drop(&mut self) {
        // SAFETY: the handle came from `CreateJobObjectW` and is closed exactly once, here.
        unsafe {
            CloseHandle(self.0);
        }
    }
}

/// The child's process handle, borrowed from the `Child` the run owns. It is only used while
/// `retired` is false, and the `Child` outlives that.
struct Process(HANDLE);

// SAFETY: a process handle may be waited on from any thread.
unsafe impl Send for Process {}
unsafe impl Sync for Process {}

#[derive(Clone)]
pub(super) struct Tree {
    job: Arc<Job>,
    process: Arc<Process>,
    retired: Arc<Mutex<bool>>,
}

pub(super) fn spawn(command: &mut Command) -> io::Result<(Child, Tree)> {
    // SAFETY: both pointers may be null: default security, no name.
    let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if job.is_null() {
        return Err(io::Error::last_os_error());
    }
    let job = Job(job);
    // SAFETY: the structure is plain data, zero is a valid value for every field, and the size
    // passed is the size of the structure the pointer refers to.
    let configured = unsafe {
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            std::ptr::from_ref(&limits).cast(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if configured == 0 {
        return Err(io::Error::last_os_error());
    }

    // Suspended, so the child cannot run or start anything before it is in the job.
    command.creation_flags(CREATE_SUSPENDED | CREATE_NO_WINDOW);
    let mut child = command.spawn()?;
    let process = child.as_raw_handle() as HANDLE;
    // SAFETY: both handles are valid and owned by this function's values.
    if unsafe { AssignProcessToJobObject(job.0, process) } == 0 {
        let error = io::Error::last_os_error();
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    if let Err(error) = resume(child.id()) {
        // Dropping the job kills the still-suspended child.
        drop(job);
        let _ = child.wait();
        return Err(error);
    }
    Ok((
        child,
        Tree {
            job: Arc::new(job),
            process: Arc::new(Process(process)),
            retired: Arc::new(Mutex::new(false)),
        },
    ))
}

/// Resumes the threads of a process that was created suspended.
fn resume(process_id: u32) -> io::Result<()> {
    // SAFETY: the snapshot handle is checked and closed; `entry` is plain data with its size set
    // as the API requires; each thread handle is checked and closed.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        let mut entry: THREADENTRY32 = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        let mut resumed = 0;
        let mut more = Thread32First(snapshot, &mut entry);
        while more != 0 {
            if entry.th32OwnerProcessID == process_id {
                let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
                if !thread.is_null() {
                    if ResumeThread(thread) != u32::MAX {
                        resumed += 1;
                    }
                    CloseHandle(thread);
                }
            }
            more = Thread32Next(snapshot, &mut entry);
        }
        CloseHandle(snapshot);
        if resumed == 0 {
            return Err(io::Error::other("the new process could not be resumed"));
        }
    }
    Ok(())
}

impl Tree {
    fn terminate(&self) {
        // SAFETY: the job handle is valid for as long as this value exists.
        unsafe {
            TerminateJobObject(self.job.0, 1);
        }
    }

    /// Kills every process in the job, unless the run is already retired.
    pub(super) fn kill(&self) {
        let retired = super::lock(&self.retired);
        if !*retired {
            self.terminate();
        }
    }

    /// Whether the child itself has exited.
    pub(super) fn exited(&self) -> bool {
        let retired = super::lock(&self.retired);
        if *retired {
            return true;
        }
        // SAFETY: the process handle is valid until the run is retired, which this lock excludes.
        unsafe { WaitForSingleObject(self.process.0, 0) == WAIT_OBJECT_0 }
    }

    /// Kills whatever is left in the job, then collects the child. Returns its exit code.
    pub(super) fn retire(&self, child: &mut Child) -> Option<i32> {
        let mut retired = super::lock(&self.retired);
        if !*retired {
            self.terminate();
        }
        let status = child.wait().ok();
        *retired = true;
        status.and_then(|status| status.code())
    }
}
