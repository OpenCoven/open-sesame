use claurst_core::types::{ContentBlock, ImageSource, Message, MessageContent, ToolResultContent};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    io::{self, Write},
    time::Duration,
};
use tokio::io::{AsyncBufReadExt, AsyncReadExt};

const SYSTEM: &str = include_str!("system-prompt.txt");
const MAX_ACTIONS: usize = 40;
const MAX_TURNS: usize = 24;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Start {
    prompt: String,
    #[serde(default)]
    history: Vec<History>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct History {
    role: String,
    text: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Action {
    action: Kind,
    observation: Option<String>,
    coordinate: Option<[f64; 2]>,
    end_coordinate: Option<[f64; 2]>,
    text: Option<String>,
    direction: Option<String>,
    amount: Option<u32>,
    milliseconds: Option<u32>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Kind {
    Observe,
    Click,
    DoubleClick,
    RightClick,
    Move,
    Drag,
    Type,
    Key,
    Scroll,
    Wait,
    AskUser,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Plan {
    message: String,
    action: Option<Action>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeReply {
    summary: String,
    #[serde(default)]
    error: bool,
    observation: Option<Observation>,
    image: Option<String>,
    #[serde(default)]
    paused: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Observation {
    id: String,
    width: u32,
    height: u32,
    app: String,
    display: String,
}

fn emit(value: serde_json::Value) -> Result<(), &'static str> {
    let out = io::stdout();
    let mut locked = out.lock();
    serde_json::to_writer(&mut locked, &value).map_err(|_| "Output closed")?;
    locked.write_all(b"\n").map_err(|_| "Output closed")?;
    locked.flush().map_err(|_| "Output closed")
}
// Retain text/tool pairing while bounding screenshot memory and provider input.
fn prune_images(messages: &mut [Message]) {
    let mut remaining = 4;
    for message in messages.iter_mut().rev() {
        if let MessageContent::Blocks(blocks) = &mut message.content {
            for block in blocks.iter_mut().rev() {
                if matches!(block, ContentBlock::Image { .. }) {
                    if remaining > 0 {
                        remaining -= 1;
                    } else {
                        *block = ContentBlock::Text {
                            text: "[Earlier screen image retired; use the latest observation.]"
                                .into(),
                        };
                    }
                }
            }
        }
    }
}
fn validate(action: &Action) -> Result<(), &'static str> {
    if action
        .text
        .as_ref()
        .is_some_and(|t| t.len() > 16000 || t.contains('\0'))
    {
        return Err("Invalid action text");
    }
    for point in [&action.coordinate, &action.end_coordinate]
        .into_iter()
        .flatten()
    {
        if point
            .iter()
            .any(|p| !p.is_finite() || *p < 0.0 || *p > 16384.0)
        {
            return Err("Invalid coordinate");
        }
    }
    if !matches!(action.action, Kind::Observe | Kind::AskUser)
        && action
            .observation
            .as_ref()
            .is_none_or(|s| s.is_empty() || s.len() > 100)
    {
        return Err("Observe before acting");
    }
    Ok(())
}
fn result_blocks(
    id: String,
    reply: NativeReply,
) -> Result<(Vec<ContentBlock>, bool), &'static str> {
    if reply.summary.len() > 16000 {
        return Err("Native reply is too large");
    }
    if reply.image.is_some() != reply.observation.is_some() {
        return Err("Image and geometry must share one observation");
    }
    let mut blocks = vec![ContentBlock::ToolResult {
        tool_use_id: id,
        content: ToolResultContent::Text(reply.summary),
        is_error: Some(reply.error),
    }];
    if let Some(observation) = reply.observation {
        if observation.width == 0
            || observation.height == 0
            || observation.width > 4096
            || observation.height > 4096
            || observation.id.len() > 100
        {
            return Err("Invalid native observation");
        }
        blocks.push(ContentBlock::Text {
            text: serde_json::to_string(&observation).map_err(|_| "Invalid observation")?,
        });
    }
    if let Some(image) = reply.image {
        if image.is_empty()
            || image.len() > 5_500_000
            || !image
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"+/=".contains(&c))
        {
            return Err("Invalid native image");
        }
        blocks.push(ContentBlock::Image {
            source: ImageSource {
                source_type: "base64".into(),
                media_type: Some("image/jpeg".into()),
                data: Some(image),
                url: None,
            },
        });
    }
    Ok((blocks, reply.paused))
}
async fn run(start: Start) -> Result<(), &'static str> {
    if start.prompt.trim().is_empty()
        || start.prompt.len() > 32768
        || start.history.len() > 30
        || start
            .history
            .iter()
            .any(|h| h.text.len() > 16000 || !matches!(h.role.as_str(), "user" | "assistant"))
    {
        return Err("Invalid task");
    }
    let endpoint =
        std::env::var("OPEN_SESAME_COMPUTER_ENDPOINT").map_err(|_| "Native session unavailable")?;
    let url = reqwest::Url::parse(&endpoint).map_err(|_| "Invalid native session")?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || url.path() != "/computer"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
    {
        return Err("Invalid native session");
    }
    let token =
        std::env::var("OPEN_SESAME_COMPUTER_TOKEN").map_err(|_| "Native session unavailable")?;
    if token.len() < 32 || token.len() > 128 {
        return Err("Invalid native session");
    }
    let native = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(175))
        .build()
        .map_err(|_| "Native channel unavailable")?;
    emit(json!({"type":"ready"}))?;
    execute(start, native, url, token).await
}
async fn execute(
    start: Start,
    native: reqwest::Client,
    url: reqwest::Url,
    token: String,
) -> Result<(), &'static str> {
    let mut messages: Vec<Message> = start
        .history
        .into_iter()
        .map(|h| {
            if h.role == "assistant" {
                Message::assistant(h.text)
            } else {
                Message::user(h.text)
            }
        })
        .collect();
    messages.push(Message::user(start.prompt));
    let mut actions = 0;
    for turn in 0..MAX_TURNS {
        prune_images(&mut messages);
        emit(json!({"type":"status","text":"Thinking","turn":turn+1}))?;
        let mut planner = url.clone();
        planner.set_path("/planner");
        let response = native
            .post(planner)
            .bearer_auth(&token)
            .json(&json!({"system":SYSTEM,"messages":messages}))
            .send()
            .await
            .map_err(|_| "CLI planner was interrupted")?;
        if !response.status().is_success() {
            return Err("CLI planner rejected this task. Check sign-in and approve again.");
        }
        let data = response
            .bytes()
            .await
            .map_err(|_| "Planner response interrupted")?;
        if data.len() > 32768 {
            return Err("Planner reply is too large");
        }
        let plan: Plan = serde_json::from_slice(&data)
            .map_err(|_| "Incomplete or invalid planner reply. No pending action was executed.")?;
        if plan.message.len() > 16000 {
            return Err("Planner message is too large");
        }
        if !plan.message.is_empty() {
            emit(json!({"type":"delta","text":plan.message}))?;
        }
        let Some(action) = plan.action else {
            emit(json!({"type":"result","success":true}))?;
            return Ok(());
        };
        validate(&action)?;
        let id = format!("computer-{}", turn + 1);
        let input = serde_json::to_value(&action).map_err(|_| "Invalid action")?;
        messages.push(Message::assistant_blocks(vec![
            ContentBlock::Text { text: plan.message },
            ContentBlock::ToolUse {
                id: id.clone(),
                name: "computer".into(),
                input: input.clone(),
            },
        ]));
        let calls = vec![(id, "computer".to_string(), input)];
        for (id, name, input) in calls {
            if name != "computer" {
                return Err("Unrecognized tool refused");
            }
            actions += 1;
            if actions > MAX_ACTIONS {
                return Err("Action limit reached. Review the screen before continuing.");
            }
            let action: Action =
                serde_json::from_value(input).map_err(|_| "Invalid computer action")?;
            validate(&action)?;
            emit(json!({"type":"action","action":action.action,"step":actions}))?;
            let response = native
                .post(url.clone())
                .bearer_auth(&token)
                .json(&action)
                .send()
                .await
                .map_err(|_| "Native action was interrupted")?;
            if !response.status().is_success() {
                return Err("Native session rejected this action");
            }
            let data = response
                .bytes()
                .await
                .map_err(|_| "Native response interrupted")?;
            if data.len() > 5_600_000 {
                return Err("Native response is too large");
            }
            let reply: NativeReply =
                serde_json::from_slice(&data).map_err(|_| "Invalid native response")?;
            let (content, paused) = result_blocks(id, reply)?;
            messages.push(Message::user_blocks(content));
            if paused {
                emit(json!({"type":"paused"}))?;
                return Ok(());
            }
        }
    }
    Err("Turn limit reached. Review the screen before continuing.")
}
#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args == ["--version"] {
        println!("Open Sesame Coven computer engine 0.1.0 / Coven d23b1ea");
        return;
    }
    if args == ["--status"] {
        let _ = emit(json!({"available":true,"transport":"account-owned-cli","version":2}));
        return;
    }
    if !args.is_empty() {
        let _ = emit(json!({"type":"error","message":"Unsupported engine command"}));
        std::process::exit(1)
    }
    let mut line = String::new();
    let mut reader = tokio::io::BufReader::new(tokio::io::stdin()).take(524289);
    let result = match reader.read_line(&mut line).await {
        Ok(_) if line.len() <= 524288 => match serde_json::from_str(&line) {
            Ok(start) => {
                tokio::select! {value=run(start)=>value,_=tokio::signal::ctrl_c()=>Err("Task cancelled"),_=tokio::time::sleep(Duration::from_secs(600))=>Err("Task time limit reached")}
            }
            _ => Err("Invalid task input"),
        },
        _ => Err("Task input is too large"),
    };
    if let Err(message) = result {
        let _ = emit(json!({"type":"error","message":message}));
        std::process::exit(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn images_use_typed_blocks_with_matching_observation_geometry() {
        let reply = NativeReply {
            summary: "Fixture observation".into(),
            error: false,
            observation: Some(Observation {
                id: "fixture-frame".into(),
                width: 640,
                height: 480,
                app: "Fixture".into(),
                display: "Fixture display".into(),
            }),
            image: Some("/9j/Zml4dHVyZQ==".into()),
            paused: false,
        };
        let (blocks, paused) = result_blocks("call-1".into(), reply).unwrap();
        assert!(!paused);
        assert_eq!(blocks.len(), 3);
        assert!(
            matches!(&blocks[0],ContentBlock::ToolResult{content:ToolResultContent::Text(text),..} if text=="Fixture observation")
        );
        assert!(
            matches!(&blocks[2],ContentBlock::Image{source} if source.media_type.as_deref()==Some("image/jpeg") && source.data.as_deref()==Some("/9j/Zml4dHVyZQ=="))
        );
    }
    #[test]
    fn image_without_geometry_and_out_of_bounds_frames_are_rejected() {
        let reply = NativeReply {
            summary: "Fixture".into(),
            error: false,
            observation: None,
            image: Some("/9j/Zml4dHVyZQ==".into()),
            paused: false,
        };
        assert!(result_blocks("call".into(), reply).is_err());
        let reply = NativeReply {
            summary: "Fixture".into(),
            error: false,
            observation: Some(Observation {
                id: "frame".into(),
                width: 4097,
                height: 480,
                app: "Fixture".into(),
                display: "Fixture".into(),
            }),
            image: Some("/9j/Zml4dHVyZQ==".into()),
            paused: false,
        };
        assert!(result_blocks("call".into(), reply).is_err());
    }
    #[test]
    fn only_computer_actions_with_finite_bound_coordinates_are_accepted() {
        assert!(
            serde_json::from_value::<Action>(json!({"action":"shell","text":"ignored"})).is_err()
        );
        assert!(
            serde_json::from_value::<Action>(json!({"action":"observe","bridge":"ignored"}))
                .is_err()
        );
        let mut action: Action =
            serde_json::from_value(json!({"action":"click","coordinate":[1,2]})).unwrap();
        assert!(validate(&action).is_err());
        action.observation = Some("frame".into());
        assert!(validate(&action).is_ok());
        action.coordinate = Some([f64::NAN, 0.]);
        assert!(validate(&action).is_err());
    }
}

#[cfg(test)]
mod integration_tests;
