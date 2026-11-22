//! One state per agent session, from Claude Code's hook events.

use serde_json::{json, Value};
use std::collections::HashMap;

/// How many sessions the board holds. Past this the one changed longest ago is dropped.
pub const MOST_AGENTS: usize = 64;
/// The longest session id, folder or sentence kept; anything longer is not an event.
const LONGEST_ID: usize = 200;
const LONGEST_TEXT: usize = 400;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    /// Running a turn: thinking or using a tool.
    Working,
    /// Needs the person: a permission prompt, a question or a dialog.
    Waiting,
    /// Its turn is over, or it has not been given one yet.
    Finished,
}

impl State {
    pub fn name(self) -> &'static str {
        match self {
            State::Working => "working",
            State::Waiting => "waiting",
            State::Finished => "finished",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Agent {
    pub session: String,
    pub folder: String,
    pub state: State,
    /// A short sentence for what it is doing or what it needs.
    pub reason: String,
    /// Orders the agents by their last change; larger is later.
    changed: u64,
    /// The tools whose permission requests are open. Tools run in parallel, so another tool
    /// finishing does not end the wait; the requested one finishing does.
    waiting_for: Vec<String>,
}

/// What an event did to the board.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Change {
    /// Nothing to tell anyone.
    Unchanged,
    /// An agent changed, appeared or went.
    Changed,
    /// An agent that was not waiting is now waiting. This is the only change that may raise a
    /// notification, so one waiting state gives one notice however many events report it.
    StartedWaiting,
}

#[derive(Default)]
pub struct Board {
    agents: HashMap<String, Agent>,
    clock: u64,
}

/// A string field of an event, if present and short enough.
fn field<'a>(event: &'a Value, name: &str, longest: usize) -> Option<&'a str> {
    event
        .get(name)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty() && text.len() <= longest)
}

/// Notices that mean the agent needs the person.
const WAITING_NOTICES: &[&str] = &[
    "permission_prompt",
    "elicitation_dialog",
    "elicitation_url_dialog",
    "agent_needs_input",
];

impl Board {
    /// Applies one hook event. An event without a session, from a subagent (its parent's own
    /// events say what the person sees), or of a kind not read here changes nothing.
    pub fn apply(&mut self, event: &Value) -> Change {
        let (Some(name), Some(session)) = (
            field(event, "hook_event_name", LONGEST_ID),
            field(event, "session_id", LONGEST_ID),
        ) else {
            return Change::Unchanged;
        };
        // A subagent's events carry the parent's session. Its permission requests and the
        // tools that ran after them are what the person sees there; the rest is the parent's.
        if event.get("agent_id").is_some()
            && !matches!(
                name,
                "PermissionRequest" | "PostToolUse" | "PostToolUseFailure"
            )
        {
            return Change::Unchanged;
        }
        let tool = field(event, "tool_name", LONGEST_ID);
        let mut waiting_for = self
            .agents
            .get(session)
            .map(|agent| agent.waiting_for.clone())
            .unwrap_or_default();
        let before = self.agents.get(session).map(|agent| agent.state);
        let notice = field(event, "message", LONGEST_TEXT).unwrap_or("");
        let next = match name {
            "SessionEnd" => {
                return if self.agents.remove(session).is_some() {
                    Change::Changed
                } else {
                    Change::Unchanged
                };
            }
            "SessionStart" if before.is_none() => (State::Finished, "Ready for a prompt".into()),
            "PostToolUse" | "PostToolUseFailure" if before == Some(State::Waiting) => {
                // The wait ends when a tool it was for has run; one asked about only by a
                // notice ends with any tool.
                let position = tool.and_then(|tool| waiting_for.iter().position(|t| t == tool));
                match position {
                    Some(index) => {
                        waiting_for.remove(index);
                    }
                    None if waiting_for.is_empty() => {}
                    None => return Change::Unchanged,
                }
                match self.agents.get(session) {
                    Some(agent) if !waiting_for.is_empty() => {
                        (State::Waiting, agent.reason.clone())
                    }
                    _ => (State::Working, "Working".into()),
                }
            }
            "UserPromptSubmit" | "PostToolUse" | "PostToolUseFailure" | "PermissionDenied" => {
                waiting_for.clear();
                (State::Working, "Working".into())
            }
            "PermissionRequest" => {
                let tool = tool.unwrap_or("a tool");
                waiting_for.push(tool.to_string());
                (State::Waiting, format!("Asks to use {tool}"))
            }
            "Notification" => {
                let kind = field(event, "notification_type", LONGEST_ID).unwrap_or("");
                if WAITING_NOTICES.contains(&kind) {
                    // A notice for a prompt already reported keeps its first sentence.
                    match self.agents.get(session) {
                        Some(agent)
                            if agent.state == State::Waiting && kind == "permission_prompt" =>
                        {
                            (State::Waiting, agent.reason.clone())
                        }
                        _ => (State::Waiting, notice_or(notice, "Needs your answer")),
                    }
                } else if kind == "idle_prompt" {
                    // Sent only once Claude Code has finished responding, so a prompt the
                    // person dismissed (no Stop follows an interrupt) is over too.
                    waiting_for.clear();
                    (State::Finished, "Waiting for a prompt".into())
                } else {
                    return Change::Unchanged;
                }
            }
            "Stop" => {
                waiting_for.clear();
                (State::Finished, "Finished".into())
            }
            "StopFailure" => {
                waiting_for.clear();
                (State::Finished, "Stopped with an error".into())
            }
            _ => return Change::Unchanged,
        };
        let folder = field(event, "cwd", LONGEST_TEXT).map(str::to_string);
        self.clock += 1;
        let changed = self.clock;
        let entry = self
            .agents
            .entry(session.to_string())
            .or_insert_with(|| Agent {
                session: session.to_string(),
                folder: String::new(),
                state: next.0,
                reason: String::new(),
                changed,
                waiting_for: Vec::new(),
            });
        entry.waiting_for = waiting_for;
        let unchanged = before.is_some()
            && entry.state == next.0
            && entry.reason == next.1
            && folder.as_ref().is_none_or(|folder| *folder == entry.folder);
        if unchanged {
            return Change::Unchanged;
        }
        entry.state = next.0;
        entry.reason = next.1;
        entry.changed = changed;
        if let Some(folder) = folder {
            entry.folder = folder;
        }
        self.trim();
        if next.0 == State::Waiting && before != Some(State::Waiting) {
            Change::StartedWaiting
        } else {
            Change::Changed
        }
    }

    fn trim(&mut self) {
        while self.agents.len() > MOST_AGENTS {
            let oldest = self
                .agents
                .values()
                .min_by_key(|agent| agent.changed)
                .map(|agent| agent.session.clone());
            match oldest {
                Some(session) => self.agents.remove(&session),
                None => break,
            };
        }
    }

    /// The agents, the most recently changed first.
    pub fn agents(&self) -> Vec<Agent> {
        let mut agents: Vec<Agent> = self.agents.values().cloned().collect();
        agents.sort_by_key(|agent| std::cmp::Reverse(agent.changed));
        agents
    }

    pub fn waiting(&self) -> usize {
        self.count(State::Waiting)
    }

    pub fn count(&self, state: State) -> usize {
        self.agents
            .values()
            .filter(|agent| agent.state == state)
            .count()
    }

    /// The board as the page sees it.
    pub fn status(&self) -> Value {
        json!({
            "waiting": self.waiting(),
            "working": self.count(State::Working),
            "finished": self.count(State::Finished),
            "agents": self.agents().iter().map(|agent| json!({
                "session": agent.session,
                "folder": agent.folder,
                "state": agent.state.name(),
                "reason": agent.reason,
            })).collect::<Vec<_>>(),
        })
    }
}

fn notice_or(notice: &str, otherwise: &str) -> String {
    if notice.is_empty() {
        otherwise.to_string()
    } else {
        notice.to_string()
    }
}
