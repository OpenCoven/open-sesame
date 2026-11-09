use claurst_api::{
    client::ClientConfig, AnthropicProvider, CodexProvider, LlmProvider, ProviderError,
    ProviderRequest, StopReason, StreamEvent, SystemPrompt,
};
use claurst_core::{
    config::Settings,
    types::{
        ContentBlock, ImageSource, Message, MessageContent, ToolDefinition, ToolResultContent,
    },
};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::BTreeMap,
    io::{self, Write},
    sync::Arc,
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
fn public_error(error: &ProviderError) -> &'static str {
    match error {
        ProviderError::AuthFailed { .. } => "Coven provider sign-in needs attention.",
        ProviderError::RateLimited { .. } => "The provider is rate limited. Wait, then resume.",
        ProviderError::QuotaExceeded { .. } => "The provider account has no available quota.",
        ProviderError::ModelNotFound { .. } => "The configured model is unavailable.",
        ProviderError::ContextOverflow { .. } => {
            "This task reached its context limit. Continue with a shorter request."
        }
        _ => {
            "The provider request failed. Your task is kept; check the connection before resuming."
        }
    }
}
async fn provider() -> Result<(Arc<dyn LlmProvider>, String, String, String, String), &'static str>
{
    let settings = Settings::load()
        .await
        .map_err(|_| "Coven settings could not be read.")?;
    let mut config = settings.effective_config();
    match std::env::var("OPEN_SESAME_COMPUTER_PROVIDER").as_deref() {
        Ok("codex") => {
            config.provider = Some("codex".into());
            config.model = None;
        }
        Ok("anthropic") => {
            config.provider = Some("anthropic".into());
            config.model = None;
        }
        Ok("coven") | Err(_) => {}
        _ => return Err("Unsupported computer provider"),
    }
    let model = config.effective_model().to_owned();
    let id = config.selected_provider_id().to_owned();
    if let Ok(expected) = std::env::var("OPEN_SESAME_COMPUTER_EXPECTED_PROVIDER") {
        if expected != id
            || std::env::var("OPEN_SESAME_COMPUTER_EXPECTED_MODEL")
                .ok()
                .as_deref()
                != Some(model.as_str())
        {
            return Err("Provider configuration changed. Review the task and approve again.");
        }
    }
    let own_key = std::env::var("OPEN_SESAME_COMPUTER_API_KEY")
        .ok()
        .filter(|s| !s.is_empty());
    let api_base = if own_key.is_some() {
        ClientConfig::default().api_base
    } else {
        config.resolve_anthropic_api_base()
    };
    let destination_url = reqwest::Url::parse(if id == "anthropic" {
        &api_base
    } else {
        "https://chatgpt.com"
    })
    .map_err(|_| "The configured provider address is invalid.")?;
    let destination = format!(
        "{}://{}{}",
        destination_url.scheme(),
        destination_url
            .host_str()
            .ok_or("The configured provider address is invalid.")?,
        destination_url
            .port()
            .map(|port| format!(":{port}"))
            .unwrap_or_default()
    );
    let route = claurst_core::oauth_config::pkce::code_challenge(&format!(
        "{id}\n{model}\n{}",
        if id == "anthropic" {
            api_base.as_str()
        } else {
            "coven-codex"
        }
    ));
    if let Ok(expected) = std::env::var("OPEN_SESAME_COMPUTER_EXPECTED_ROUTE") {
        if expected != route {
            return Err("Provider configuration changed. Review the task and approve again.");
        }
    }
    let engine: Arc<dyn LlmProvider> = match id.as_str() {
        "codex" | "openai-codex" => Arc::new(
            CodexProvider::from_stored()
                .ok_or("Connect Codex in Coven to use this configured provider.")?,
        ),
        "anthropic" => {
            let (key, bearer) = match own_key {
                Some(key) => (key, false),
                None => config.resolve_anthropic_auth_async().await.ok_or(
                    "Connect an Anthropic API account, or select a connected Coven Codex account.",
                )?,
            };
            if key.is_empty() {
                return Err("The configured Coven provider is not signed in.");
            }
            Arc::new(
                AnthropicProvider::from_config(ClientConfig {
                    api_key: key,
                    use_bearer_auth: bearer,
                    api_base,
                    ..Default::default()
                })
                .map_err(|_| "The configured provider could not be initialized.")?,
            )
        }
        _ => return Err("This Coven provider is not supported by the embedded engine."),
    };
    let capabilities = engine.capabilities();
    if !capabilities.image_input || !capabilities.tool_calling {
        return Err("Choose a Coven provider with image and tool support.");
    }
    Ok((engine, id, model, route, destination))
}
fn definition() -> ToolDefinition {
    ToolDefinition { name:"computer".into(), description:"Observe and operate the selected Mac display through Open Sesame. Observe first. Coordinates refer to the returned image; every input action requires the latest observation id, which is consumed. Actions are serial and return a fresh image. Ask the user before sensitive actions or when blocked. No shell, filesystem or other tools exist.".into(), input_schema:json!({"type":"object","additionalProperties":false,"properties":{"action":{"type":"string","enum":["observe","click","double_click","right_click","move","drag","type","key","scroll","wait","ask_user"]},"observation":{"type":"string"},"coordinate":{"type":"array","items":{"type":"number"},"minItems":2,"maxItems":2},"end_coordinate":{"type":"array","items":{"type":"number"},"minItems":2,"maxItems":2},"text":{"type":"string","maxLength":4000},"direction":{"type":"string","enum":["up","down","left","right"]},"amount":{"type":"integer","minimum":1,"maximum":20},"milliseconds":{"type":"integer","minimum":0,"maximum":2000}},"required":["action"]}) }
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
    let (engine, id, model, _, _) = provider().await?;
    emit(json!({"type":"ready","provider":id,"model":model}))?;
    execute(start, engine, model, native, url, token).await
}
async fn execute(
    start: Start,
    engine: Arc<dyn LlmProvider>,
    model: String,
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
        let request = ProviderRequest {
            model: model.clone(),
            messages: messages.clone(),
            system_prompt: Some(SystemPrompt::Text(SYSTEM.into())),
            tools: vec![definition()],
            max_tokens: 4096,
            temperature: None,
            top_p: None,
            top_k: None,
            stop_sequences: vec![],
            thinking: None,
            provider_options: json!({}),
        };
        let mut stream = engine
            .create_message_stream(request)
            .await
            .map_err(|e| public_error(&e))?;
        let mut blocks = BTreeMap::new();
        let mut arguments: BTreeMap<usize, String> = BTreeMap::new();
        let mut stopped = false;
        let mut stop_reason = None;
        let mut bytes = 0;
        while let Some(event) = tokio::time::timeout(Duration::from_secs(90), stream.next())
            .await
            .map_err(|_| "The provider stream stalled.")?
        {
            match event.map_err(|e| public_error(&e))? {
                StreamEvent::ContentBlockStart {
                    index,
                    content_block,
                } => {
                    if blocks.len() >= 32 || blocks.insert(index, content_block).is_some() {
                        return Err("Invalid provider content");
                    }
                }
                StreamEvent::TextDelta { index, text } => {
                    bytes += text.len();
                    if bytes > 131072 {
                        return Err("Provider reply is too large");
                    }
                    match blocks.entry(index).or_insert(ContentBlock::Text {
                        text: String::new(),
                    }) {
                        ContentBlock::Text { text: value } => value.push_str(&text),
                        _ => return Err("Invalid text stream"),
                    };
                    emit(json!({"type":"delta","text":text}))?;
                }
                StreamEvent::InputJsonDelta {
                    index,
                    partial_json,
                } => {
                    let value = arguments.entry(index).or_default();
                    value.push_str(&partial_json);
                    if value.len() > 32768 {
                        return Err("Tool request is too large");
                    }
                }
                StreamEvent::SignatureDelta { index, signature } => {
                    if let Some(ContentBlock::Thinking {
                        signature: value, ..
                    }) = blocks.get_mut(&index)
                    {
                        value.push_str(&signature)
                    }
                }
                StreamEvent::ThinkingDelta { index, thinking } => {
                    if let Some(ContentBlock::Thinking {
                        thinking: value, ..
                    }) = blocks.get_mut(&index)
                    {
                        value.push_str(&thinking)
                    }
                }
                StreamEvent::MessageDelta {
                    stop_reason: reason,
                    ..
                } => {
                    if reason.is_some() {
                        stop_reason = reason
                    }
                }
                StreamEvent::MessageStop => {
                    stopped = true;
                    break;
                }
                StreamEvent::Error { .. } => return Err("The provider stream failed."),
                _ => {}
            }
        }
        if !stopped || matches!(stop_reason, Some(StopReason::MaxTokens) | None) {
            return Err(
                "The provider reply did not finish cleanly. No pending action was executed.",
            );
        }
        for (index, value) in arguments {
            match blocks.get_mut(&index) {
                Some(ContentBlock::ToolUse { input, .. }) => {
                    *input = serde_json::from_str(&value).map_err(|_| "Invalid tool JSON")?
                }
                _ => return Err("Invalid tool stream"),
            }
        }
        let assistant: Vec<ContentBlock> = blocks.into_values().collect();
        let calls: Vec<_> = assistant
            .iter()
            .filter_map(|b| {
                if let ContentBlock::ToolUse { id, name, input } = b {
                    Some((id.clone(), name.clone(), input.clone()))
                } else {
                    None
                }
            })
            .collect();
        messages.push(Message::assistant_blocks(assistant));
        if !calls.is_empty() && stop_reason != Some(StopReason::ToolUse) {
            return Err("Tool reply did not finish cleanly. No pending action was executed.");
        }
        if calls.is_empty() {
            emit(json!({"type":"result","success":true}))?;
            return Ok(());
        }
        if calls.len() != 1 {
            return Err("The computer agent must act serially. Observe again before continuing.");
        }
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
        match provider().await {
            Ok((_, provider, model, route, destination)) => {
                let _ = emit(
                    json!({"configured":true,"provider":provider,"model":model,"route":route,"destination":destination}),
                );
            }
            Err(message) => {
                let _ = emit(json!({"configured":false,"message":message}));
            }
        }
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
