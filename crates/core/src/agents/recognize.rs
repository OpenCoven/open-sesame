//! Which agent tool a process is, from its arguments only (`provider` in `agent_monitor.py`).

use serde::Serialize;

/// An agent command-line tool the list recognises.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Codex,
    Claude,
    Coven,
    Gemini,
    Aider,
    Opencode,
}

impl Provider {
    /// In the order the Python monitor listed them.
    pub const ALL: [Provider; 6] = [
        Provider::Codex,
        Provider::Claude,
        Provider::Coven,
        Provider::Gemini,
        Provider::Aider,
        Provider::Opencode,
    ];

    /// The program name that identifies the tool.
    pub fn key(self) -> &'static str {
        match self {
            Provider::Codex => "codex",
            Provider::Claude => "claude",
            Provider::Coven => "coven",
            Provider::Gemini => "gemini",
            Provider::Aider => "aider",
            Provider::Opencode => "opencode",
        }
    }

    /// The name shown to the person.
    pub fn name(self) -> &'static str {
        match self {
            Provider::Codex => "Codex",
            Provider::Claude => "Claude Code",
            Provider::Coven => "Coven",
            Provider::Gemini => "Gemini CLI",
            Provider::Aider => "Aider",
            Provider::Opencode => "OpenCode",
        }
    }

    /// The tool whose program is called `name`, as the native executable or the script a runtime runs.
    pub(crate) fn from_program(name: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|provider| provider.key() == name)
    }
}

/// Scripts a JavaScript runtime runs for a tool, by the end of the script's path.
const SCRIPTS: [(&str, Provider); 3] = [
    ("/@openai/codex/bin/codex.js", Provider::Codex),
    ("/@anthropic-ai/claude-code/cli.js", Provider::Claude),
    ("/@google/gemini-cli/dist/index.js", Provider::Gemini),
];

/// Runtimes that start a tool's script, and the Coven launcher that can wrap a tool.
pub(crate) const LAUNCHERS: [&str; 4] = ["node", "nodejs", "bun", "coven"];

/// The tool a process is running, or `None` for anything else, including a shell or a search
/// whose arguments merely mention a tool.
pub fn provider<S: AsRef<str>>(argv: &[S]) -> Option<Provider> {
    let program = program_name(argv.first()?.as_ref());
    if program == "coven-code" {
        return Some(Provider::Coven);
    }
    if let Some(provider) = Provider::from_program(program) {
        return Some(provider);
    }
    let second = argv.get(1).map(AsRef::as_ref);
    if is_python(program) {
        if second == Some("-m") && argv.get(2).map(AsRef::as_ref) == Some("aider") {
            return Some(Provider::Aider);
        }
        return (second.map(program_name) == Some("aider")).then_some(Provider::Aider);
    }
    if matches!(program, "node" | "nodejs" | "bun") {
        let script = second?.replace('\\', "/");
        if let Some((_, provider)) = SCRIPTS.iter().find(|(suffix, _)| script.ends_with(suffix)) {
            return Some(*provider);
        }
        return Provider::from_program(program_name(&script));
    }
    None
}

/// Whether a native executable of a tool runs this program, which is what a launcher can wrap.
pub(crate) fn is_native(program: &str) -> bool {
    program == "coven-code" || Provider::from_program(program).is_some()
}

/// `python`, `python3` or `python3.12`, as the Python monitor's pattern allowed.
fn is_python(program: &str) -> bool {
    program.strip_prefix("python").is_some_and(|version| {
        version.is_empty()
            || version
                .split('.')
                .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
    })
}

/// The last component of a path written with either separator, without a Windows `.exe` suffix.
pub(crate) fn program_name(path: &str) -> &str {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    match name.len().checked_sub(4) {
        Some(cut) if name.is_char_boundary(cut) && name[cut..].eq_ignore_ascii_case(".exe") => {
            &name[..cut]
        }
        _ => name,
    }
}
