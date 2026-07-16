//! Platform-specific self-upgrade launcher.
//!
//! On Unix, `infinitecode upgrade` runs a short shell script in the current process
//! tree: it downloads `install.sh` into a temporary directory and executes it,
//! then reports the installer's exit status back to the caller. Unix systems can
//! generally replace an executable file while the old process is still running,
//! so no detached helper is needed.
//!
//! On Windows, the running `infinitecode.exe` file is locked by the current process, so
//! it cannot be replaced in-place. The Windows path starts a detached PowerShell
//! process, passes it the current process id, and returns immediately. The
//! PowerShell script waits for this `infinitecode.exe` process to exit, then downloads
//! and runs `install.ps1`, which can safely copy the new binary over the old one
//! after the lock has been released.

use std::process::Command;

use anyhow::Context;
use anyhow::Result;
#[cfg(unix)]
use anyhow::bail;

#[cfg(unix)]
const INSTALL_SH_URL: &str =
    "https://raw.githubusercontent.com/AFS-Agentics/InfiniteCode/main/install.sh";
#[cfg(windows)]
const INSTALL_PS1_URL: &str =
    "https://raw.githubusercontent.com/AFS-Agentics/InfiniteCode/main/install.ps1";

pub fn run_upgrade() -> Result<()> {
    run_platform_upgrade()
}

#[cfg(unix)]
fn run_platform_upgrade() -> Result<()> {
    println!("Downloading install.sh from {INSTALL_SH_URL} ...");

    let status = Command::new("sh")
        .arg("-c")
        .arg(unix_upgrade_script())
        .status()
        .context("run install.sh for infinitecode upgrade")?;

    if !status.success() {
        bail!("infinitecode upgrade failed with status {status}");
    }

    Ok(())
}

#[cfg(unix)]
fn unix_upgrade_script() -> String {
    format!(
        r#"set -eu
command -v curl >/dev/null 2>&1 || {{
    printf '%s\n' "Error: 'curl' is required but not installed." >&2
    exit 1
}}
tmp_dir="$(mktemp -d "${{TMPDIR:-/tmp}}/infinitecode-upgrade.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM
curl -fsSL '{INSTALL_SH_URL}' -o "$tmp_dir/install.sh"
sh "$tmp_dir/install.sh"
"#
    )
}

#[cfg(windows)]
fn run_platform_upgrade() -> Result<()> {
    use std::process::Stdio;

    let parent_pid = std::process::id();
    println!("Downloading install.ps1 from {INSTALL_PS1_URL} ...");
    Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &windows_upgrade_script(parent_pid),
        ])
        .stdin(Stdio::null())
        .spawn()
        .context("start install.ps1 for infinitecode upgrade")?;

    println!("Started infinitecode upgrade with install.ps1.");
    println!("The installer will continue after this infinitecode.exe process exits.");
    Ok(())
}

#[cfg(windows)]
fn windows_upgrade_script(parent_pid: u32) -> String {
    format!(
        r#"$ErrorActionPreference = 'Stop'
$parent = Get-Process -Id {parent_pid} -ErrorAction SilentlyContinue
if ($parent) {{
    Wait-Process -Id {parent_pid}
}}
$script = Invoke-WebRequest -UseBasicParsing -Uri '{INSTALL_PS1_URL}'
Invoke-Expression $script.Content
"#
    )
}
