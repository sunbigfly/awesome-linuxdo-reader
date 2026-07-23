use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use base64::Engine;
use clap::{Parser, Subcommand};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tungstenite::Message;

const HEADER_START: &str = "// ==UserScript==";
const HEADER_END: &str = "// ==/UserScript==";

#[derive(Parser)]
#[command(name = "userscript-dev", version, about)]
struct Cli {
    /// Emit stable JSON. Commands already default to JSON; retained for composition.
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Verify the project-local Rust CLI and userscript source.
    Doctor {
        #[arg(long, default_value = "work/main.js")]
        source: PathBuf,
    },
    /// Inspect userscript metadata, hash, and request call sites.
    Inspect {
        #[arg(default_value = "work/main.js")]
        source: PathBuf,
    },
    /// Generate a Tampermonkey loader whose final @require points to local source.
    MakeLoader {
        #[arg(default_value = "work/main.js")]
        source: PathBuf,

        #[arg(long, default_value = "work/local-debug.user.js")]
        out: PathBuf,

        /// Replace an existing loader. Use only after explicit overwrite approval.
        #[arg(long)]
        force: bool,
    },
    /// Verify a generated loader and its source binding.
    VerifyLoader {
        #[arg(default_value = "work/local-debug.user.js")]
        loader: PathBuf,

        #[arg(long, default_value = "work/main.js")]
        source: PathBuf,
    },
    /// Record a Chrome tab through the DevTools Protocol at a fixed frame rate.
    Record {
        /// Chrome remote debugging endpoint in host:port form.
        #[arg(long, default_value = "127.0.0.1:9222")]
        endpoint: String,

        /// Browser-level DevTools websocket URL when HTTP target discovery is unavailable.
        #[arg(long)]
        browser_websocket: Option<String>,

        /// Select the first page whose URL contains this value.
        #[arg(long, default_value = "linux.do")]
        target_url: String,

        /// Recording duration in seconds.
        #[arg(long, default_value_t = 6)]
        duration: u64,

        /// Output frame rate. Frames are duplicated when the page is static.
        #[arg(long, default_value_t = 15)]
        fps: u32,

        /// Maximum captured frame width.
        #[arg(long, default_value_t = 960)]
        width: u32,

        /// Maximum captured frame height.
        #[arg(long, default_value_t = 600)]
        height: u32,

        /// JPEG quality used for captured frames.
        #[arg(long, default_value_t = 92)]
        quality: u8,

        /// New directory for numbered JPEG frames.
        #[arg(long)]
        out: PathBuf,
    },
}

impl Command {
    fn name(&self) -> &'static str {
        match self {
            Self::Doctor { .. } => "doctor",
            Self::Inspect { .. } => "inspect",
            Self::MakeLoader { .. } => "make-loader",
            Self::VerifyLoader { .. } => "verify-loader",
            Self::Record { .. } => "record",
        }
    }
}

#[derive(Serialize)]
struct Output {
    ok: bool,
    command: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ErrorOutput>,
}

#[derive(Serialize)]
struct ErrorOutput {
    kind: &'static str,
    message: String,
}

#[derive(Clone, Debug)]
struct MetadataEntry {
    key: String,
    value: String,
}

#[derive(Debug)]
struct ParsedUserscript {
    metadata: Vec<MetadataEntry>,
    metadata_errors: Vec<String>,
    body_start_line: usize,
}

#[derive(Serialize)]
struct CallSites {
    count: usize,
    lines: Vec<usize>,
}

#[derive(Serialize)]
struct InspectData {
    source: String,
    browser_file_uri: String,
    sha256: String,
    bytes: usize,
    lines: usize,
    metadata_valid: bool,
    metadata_errors: Vec<String>,
    name: String,
    version: String,
    run_at: String,
    matches: Vec<String>,
    includes: Vec<String>,
    grants: Vec<String>,
    connects: Vec<String>,
    requires: Vec<String>,
    download_urls: Vec<String>,
    update_urls: Vec<String>,
    request_calls: BTreeMap<String, CallSites>,
}

#[derive(Serialize)]
struct DoctorData {
    version: &'static str,
    offline: bool,
    python_required: bool,
    project_root: String,
    source: String,
    source_exists: bool,
    source_metadata_valid: Option<bool>,
    browser_file_uri: Option<String>,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let command_name = cli.command.name();
    let _json_requested = cli.json;

    match run(cli.command) {
        Ok((data, valid)) => {
            let output = Output {
                ok: valid,
                command: command_name,
                data: Some(data),
                error: None,
            };
            println!(
                "{}",
                serde_json::to_string(&output).expect("serialize output")
            );
            if valid {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(2)
            }
        }
        Err(error) => {
            let output = Output {
                ok: false,
                command: command_name,
                data: None,
                error: Some(ErrorOutput {
                    kind: "command_failed",
                    message: format!("{error:#}"),
                }),
            };
            println!(
                "{}",
                serde_json::to_string(&output).expect("serialize error")
            );
            ExitCode::from(2)
        }
    }
}

fn run(command: Command) -> Result<(Value, bool)> {
    match command {
        Command::Doctor { source } => doctor(&source),
        Command::Inspect { source } => {
            let data = inspect(&source)?;
            let valid = data.metadata_valid;
            Ok((serde_json::to_value(data)?, valid))
        }
        Command::MakeLoader { source, out, force } => make_loader(&source, &out, force),
        Command::VerifyLoader { loader, source } => verify_loader(&loader, &source),
        Command::Record {
            endpoint,
            browser_websocket,
            target_url,
            duration,
            fps,
            width,
            height,
            quality,
            out,
        } => record_tab(
            &endpoint,
            browser_websocket.as_deref(),
            &target_url,
            duration,
            fps,
            width,
            height,
            quality,
            &out,
        ),
    }
}

fn record_tab(
    endpoint: &str,
    browser_websocket: Option<&str>,
    target_url: &str,
    duration_secs: u64,
    fps: u32,
    width: u32,
    height: u32,
    quality: u8,
    out: &Path,
) -> Result<(Value, bool)> {
    if duration_secs == 0 {
        bail!("duration must be greater than zero");
    }
    if !(1..=60).contains(&fps) {
        bail!("fps must be between 1 and 60");
    }
    if width == 0 || height == 0 {
        bail!("width and height must be greater than zero");
    }
    if !(50..=100).contains(&quality) {
        bail!("quality must be between 50 and 100");
    }
    if out.exists() {
        bail!("output directory already exists: {}", out.display());
    }

    let mut page_url = String::new();
    let (websocket_url, browser_connection) = if let Some(url) = browser_websocket {
        (url.to_owned(), true)
    } else {
        let pages = devtools_pages(endpoint)?;
        let page = pages
            .as_array()
            .context("Chrome /json/list did not return an array")?
            .iter()
            .find(|page| {
                page.get("type").and_then(Value::as_str) == Some("page")
                    && page
                        .get("url")
                        .and_then(Value::as_str)
                        .is_some_and(|url| url.contains(target_url))
            })
            .ok_or_else(|| anyhow!("no Chrome page URL contains {target_url:?}"))?;
        page_url = page
            .get("url")
            .and_then(Value::as_str)
            .context("selected page has no URL")?
            .to_owned();
        let websocket_url = page
            .get("webSocketDebuggerUrl")
            .and_then(Value::as_str)
            .context("selected page has no webSocketDebuggerUrl")?
            .to_owned();
        (websocket_url, false)
    };

    fs::create_dir_all(out)
        .with_context(|| format!("create output directory {}", out.display()))?;
    let (mut socket, _) = tungstenite::connect(websocket_url.as_str())
        .with_context(|| format!("connect to Chrome page at {websocket_url}"))?;
    if let tungstenite::stream::MaybeTlsStream::Plain(stream) = socket.get_mut() {
        stream
            .set_read_timeout(Some(Duration::from_millis(250)))
            .context("set Chrome websocket read timeout")?;
    }

    let session_id = if browser_connection {
        send_cdp(&mut socket, 1, "Target.getTargets", json!({}), None)?;
        let targets = read_cdp_response(&mut socket, 1)?;
        let target = targets
            .pointer("/result/targetInfos")
            .and_then(Value::as_array)
            .context("Target.getTargets returned no targetInfos")?
            .iter()
            .find(|target| {
                target.get("type").and_then(Value::as_str) == Some("page")
                    && target
                        .get("url")
                        .and_then(Value::as_str)
                        .is_some_and(|url| url.contains(target_url))
            })
            .ok_or_else(|| anyhow!("no Chrome page URL contains {target_url:?}"))?;
        page_url = target
            .get("url")
            .and_then(Value::as_str)
            .context("selected target has no URL")?
            .to_owned();
        let target_id = target
            .get("targetId")
            .and_then(Value::as_str)
            .context("selected target has no targetId")?;
        send_cdp(
            &mut socket,
            2,
            "Target.attachToTarget",
            json!({ "targetId": target_id, "flatten": true }),
            None,
        )?;
        let attached = read_cdp_response(&mut socket, 2)?;
        Some(
            attached
                .pointer("/result/sessionId")
                .and_then(Value::as_str)
                .context("Target.attachToTarget returned no sessionId")?
                .to_owned(),
        )
    } else {
        None
    };
    let session = session_id.as_deref();

    send_cdp(&mut socket, 3, "Page.enable", json!({}), session)?;
    send_cdp(
        &mut socket,
        4,
        "Runtime.evaluate",
        json!({
            "expression": "(() => { const id = '__userscript_dev_screencast_tick'; document.getElementById(id)?.remove(); const node = document.createElement('div'); node.id = id; Object.assign(node.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', opacity: '0.001', pointerEvents: 'none', zIndex: '-1' }); document.documentElement.appendChild(node); node.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(1px)' }], { duration: 1000, iterations: Infinity }); return true; })()"
        }),
        session,
    )?;
    send_cdp(
        &mut socket,
        5,
        "Page.startScreencast",
        json!({
            "format": "jpeg",
            "quality": quality,
            "maxWidth": width,
            "maxHeight": height,
            "everyNthFrame": 1
        }),
        session,
    )?;

    let started = Instant::now();
    let duration = Duration::from_secs(duration_secs);
    let sample_interval = Duration::from_secs_f64(1.0 / f64::from(fps));
    let mut next_sample = Duration::ZERO;
    let mut last_frame: Option<Vec<u8>> = None;
    let mut frame_count = 0usize;

    while started.elapsed() < duration {
        match socket.read() {
            Ok(message) => {
                if !message.is_text() {
                    continue;
                }
                let text = message.to_text().context("decode Chrome websocket text")?;
                let event: Value = serde_json::from_str(text).context("parse Chrome CDP event")?;
                if event.get("method").and_then(Value::as_str) != Some("Page.screencastFrame") {
                    continue;
                }
                let params = event
                    .get("params")
                    .context("screencast frame has no params")?;
                let session_id = params
                    .get("sessionId")
                    .and_then(Value::as_u64)
                    .context("screencast frame has no sessionId")?;
                let encoded = params
                    .get("data")
                    .and_then(Value::as_str)
                    .context("screencast frame has no data")?;
                let current = base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .context("decode screencast JPEG")?;
                let elapsed = started.elapsed().min(duration);
                if last_frame.is_none() {
                    last_frame = Some(current.clone());
                }
                while next_sample <= elapsed && next_sample < duration {
                    write_recording_frame(out, frame_count, last_frame.as_ref().unwrap())?;
                    frame_count += 1;
                    next_sample += sample_interval;
                }
                last_frame = Some(current);
                send_cdp(
                    &mut socket,
                    10_000 + session_id,
                    "Page.screencastFrameAck",
                    json!({ "sessionId": session_id }),
                    session,
                )?;
            }
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(error) => return Err(error).context("read Chrome screencast frame"),
        }
    }

    let last_frame = last_frame.context("Chrome returned no screencast frames")?;
    while next_sample < duration {
        write_recording_frame(out, frame_count, &last_frame)?;
        frame_count += 1;
        next_sample += sample_interval;
    }
    send_cdp(&mut socket, 6, "Page.stopScreencast", json!({}), session)?;
    send_cdp(
        &mut socket,
        7,
        "Runtime.evaluate",
        json!({
            "expression": "document.getElementById('__userscript_dev_screencast_tick')?.remove()"
        }),
        session,
    )?;

    Ok((
        json!({
            "endpoint": endpoint,
            "target_url": page_url,
            "duration_seconds": duration_secs,
            "fps": fps,
            "frames": frame_count,
            "format": "jpeg",
            "quality": quality,
            "output_directory": absolute(out)?.display().to_string()
        }),
        true,
    ))
}

fn devtools_pages(endpoint: &str) -> Result<Value> {
    let mut stream = TcpStream::connect(endpoint)
        .with_context(|| format!("connect to Chrome remote debugging endpoint {endpoint}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .context("set Chrome target-list read timeout")?;
    write!(
        stream,
        "GET /json/list HTTP/1.0\r\nHost: {endpoint}\r\nConnection: close\r\n\r\n"
    )
    .context("request Chrome target list")?;
    let mut response = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => response.extend_from_slice(&buffer[..read]),
            Err(error)
                if !response.is_empty()
                    && matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
            {
                break;
            }
            Err(error) => return Err(error).context("read Chrome target list"),
        }
    }
    let split = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .context("Chrome target response has no HTTP body")?;
    let headers = String::from_utf8_lossy(&response[..split]);
    if !headers.starts_with("HTTP/1.1 200") && !headers.starts_with("HTTP/1.0 200") {
        bail!(
            "Chrome target request failed: {}",
            headers.lines().next().unwrap_or("unknown status")
        );
    }
    serde_json::from_slice(&response[split + 4..]).context("parse Chrome target list")
}

fn send_cdp(
    socket: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>,
    id: u64,
    method: &str,
    params: Value,
    session_id: Option<&str>,
) -> Result<()> {
    let mut command = json!({ "id": id, "method": method, "params": params });
    if let Some(session_id) = session_id {
        command["sessionId"] = Value::String(session_id.to_owned());
    }
    socket
        .send(Message::Text(command.to_string().into()))
        .with_context(|| format!("send CDP command {method}"))
}

fn read_cdp_response(
    socket: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>,
    id: u64,
) -> Result<Value> {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        match socket.read() {
            Ok(message) if message.is_text() => {
                let text = message.to_text().context("decode Chrome websocket text")?;
                let response: Value =
                    serde_json::from_str(text).context("parse Chrome response")?;
                if response.get("id").and_then(Value::as_u64) == Some(id) {
                    if let Some(error) = response.get("error") {
                        bail!("CDP command {id} failed: {error}");
                    }
                    return Ok(response);
                }
            }
            Ok(_) => {}
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(error) => return Err(error).context("read Chrome CDP response"),
        }
    }
    bail!("timed out waiting for CDP command {id}")
}

fn write_recording_frame(out: &Path, index: usize, bytes: &[u8]) -> Result<()> {
    let path = out.join(format!("frame-{index:06}.jpg"));
    fs::write(&path, bytes).with_context(|| format!("write frame {}", path.display()))
}

fn doctor(source: &Path) -> Result<(Value, bool)> {
    let project_root = std::env::current_dir().context("resolve current directory")?;
    let source_path = absolute(source)?;
    let source_exists = source_path.is_file();
    let (source_metadata_valid, browser_uri) = if source_exists {
        match read_userscript(&source_path) {
            Ok((_text, _, parsed)) => (
                Some(parsed.metadata_errors.is_empty()),
                Some(browser_file_uri(&source_path)?),
            ),
            Err(_) => (Some(false), Some(browser_file_uri(&source_path)?)),
        }
    } else {
        (None, None)
    };
    let data = DoctorData {
        version: env!("CARGO_PKG_VERSION"),
        offline: false,
        python_required: false,
        project_root: project_root.display().to_string(),
        source: source_path.display().to_string(),
        source_exists,
        source_metadata_valid,
        browser_file_uri: browser_uri,
    };
    Ok((
        serde_json::to_value(data)?,
        source_exists && source_metadata_valid == Some(true),
    ))
}

fn inspect(source: &Path) -> Result<InspectData> {
    let source = absolute(source)?;
    let (text, raw, parsed) = read_userscript(&source)?;
    let request_calls = request_call_sites(&text, parsed.body_start_line);
    Ok(InspectData {
        source: source.display().to_string(),
        browser_file_uri: browser_file_uri(&source)?,
        sha256: sha256_hex(&raw),
        bytes: raw.len(),
        lines: text.lines().count(),
        metadata_valid: parsed.metadata_errors.is_empty(),
        metadata_errors: parsed.metadata_errors,
        name: first_value(&parsed.metadata, "name"),
        version: first_value(&parsed.metadata, "version"),
        run_at: first_value(&parsed.metadata, "run-at"),
        matches: values(&parsed.metadata, "match"),
        includes: values(&parsed.metadata, "include"),
        grants: values(&parsed.metadata, "grant"),
        connects: values(&parsed.metadata, "connect"),
        requires: values(&parsed.metadata, "require"),
        download_urls: values(&parsed.metadata, "downloadURL"),
        update_urls: values(&parsed.metadata, "updateURL"),
        request_calls,
    })
}

fn make_loader(source: &Path, out: &Path, force: bool) -> Result<(Value, bool)> {
    let source = absolute(source)?;
    let out = absolute(out)?;
    let (_text, raw, parsed) = read_userscript(&source)?;
    if !parsed.metadata_errors.is_empty() {
        bail!(
            "source metadata invalid: {}",
            parsed.metadata_errors.join("; ")
        );
    }
    if out.exists() && !force {
        bail!(
            "output exists; pass --force only after explicit overwrite approval: {}",
            out.display()
        );
    }
    let content = debug_loader(&source, &parsed.metadata)?;
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("create output directory {}", parent.display()))?;
    }
    fs::write(&out, content.as_bytes())
        .with_context(|| format!("write loader {}", out.display()))?;
    Ok((
        json!({
            "source": source.display().to_string(),
            "source_sha256": sha256_hex(&raw),
            "output": out.display().to_string(),
            "local_require": browser_file_uri(&source)?,
            "bytes": content.len(),
        }),
        true,
    ))
}

fn verify_loader(loader: &Path, source: &Path) -> Result<(Value, bool)> {
    let loader = absolute(loader)?;
    let source = absolute(source)?;
    let (_loader_text, loader_raw, loader_parsed) = read_userscript(&loader)?;
    let (_source_text, source_raw, source_parsed) = read_userscript(&source)?;
    let requirements = values(&loader_parsed.metadata, "require");
    let local_require = browser_file_uri(&source)?;
    let checks = BTreeMap::from([
        (
            "local_require_is_last",
            requirements
                .last()
                .is_some_and(|value| browser_file_uri_matches(value, &local_require)),
        ),
        (
            "local_version",
            first_value(&loader_parsed.metadata, "version") == "0.0.0-local",
        ),
        (
            "no_update_urls",
            values(&loader_parsed.metadata, "downloadURL").is_empty()
                && values(&loader_parsed.metadata, "updateURL").is_empty(),
        ),
        (
            "source_metadata_valid",
            source_parsed.metadata_errors.is_empty(),
        ),
    ]);
    let valid = loader_parsed.metadata_errors.is_empty() && checks.values().all(|value| *value);
    Ok((
        json!({
            "loader": loader.display().to_string(),
            "loader_sha256": sha256_hex(&loader_raw),
            "source": source.display().to_string(),
            "source_sha256": sha256_hex(&source_raw),
            "checks": checks,
            "metadata_errors": loader_parsed.metadata_errors,
        }),
        valid,
    ))
}

fn absolute(path: &Path) -> Result<PathBuf> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        Ok(std::env::current_dir()
            .context("resolve current directory")?
            .join(path))
    }
}

fn read_userscript(path: &Path) -> Result<(String, Vec<u8>, ParsedUserscript)> {
    let raw = fs::read(path).with_context(|| format!("read {}", path.display()))?;
    let text = String::from_utf8(raw.clone())
        .map_err(|_| anyhow!("source is not UTF-8: {}", path.display()))?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text).to_string();
    let parsed = parse_metadata(&text)?;
    Ok((text, raw, parsed))
}

fn parse_metadata(text: &str) -> Result<ParsedUserscript> {
    let lines: Vec<&str> = text.lines().collect();
    let start = lines
        .iter()
        .position(|line| line.trim() == HEADER_START)
        .ok_or_else(|| anyhow!("userscript metadata start marker not found"))?;
    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find_map(|(index, line)| (line.trim() == HEADER_END).then_some(index))
        .ok_or_else(|| anyhow!("userscript metadata end marker not found"))?;

    let mut metadata = Vec::new();
    let mut errors = Vec::new();
    for (index, line) in lines.iter().enumerate().take(end).skip(start + 1) {
        if line.trim().is_empty() {
            continue;
        }
        let Some(rest) = line.trim_start().strip_prefix("//") else {
            errors.push(format!("unparsed metadata line {}", index + 1));
            continue;
        };
        let Some(rest) = rest.trim_start().strip_prefix('@') else {
            errors.push(format!("unparsed metadata line {}", index + 1));
            continue;
        };
        let split_at = rest.find(char::is_whitespace).unwrap_or(rest.len());
        let key = rest[..split_at].trim();
        let value = rest[split_at..].trim();
        if key.is_empty() {
            errors.push(format!("empty metadata key at line {}", index + 1));
            continue;
        }
        metadata.push(MetadataEntry {
            key: key.to_string(),
            value: value.to_string(),
        });
    }
    if first_value(&metadata, "name").is_empty() {
        errors.push("missing @name".to_string());
    }
    if values(&metadata, "match").is_empty() && values(&metadata, "include").is_empty() {
        errors.push("missing @match/@include".to_string());
    }
    Ok(ParsedUserscript {
        metadata,
        metadata_errors: errors,
        body_start_line: end + 2,
    })
}

fn values(metadata: &[MetadataEntry], key: &str) -> Vec<String> {
    metadata
        .iter()
        .filter(|entry| entry.key.eq_ignore_ascii_case(key))
        .map(|entry| entry.value.clone())
        .collect()
}

fn first_value(metadata: &[MetadataEntry], key: &str) -> String {
    values(metadata, key).into_iter().next().unwrap_or_default()
}

fn request_call_sites(text: &str, body_start_line: usize) -> BTreeMap<String, CallSites> {
    let patterns: [(&str, &[&str]); 4] = [
        ("event_source", &["new EventSource(", "new EventSource ("]),
        (
            "gm_xml_http_request",
            &[
                "GM_xmlhttpRequest",
                "GM.xmlHttpRequest",
                "GM?.xmlHttpRequest",
            ],
        ),
        ("web_socket", &["new WebSocket(", "new WebSocket ("]),
        (
            "xml_http_request",
            &["new XMLHttpRequest(", "new XMLHttpRequest ("],
        ),
    ];
    let mut calls = patterns
        .into_iter()
        .map(|(name, needles)| {
            let lines = text
                .lines()
                .enumerate()
                .filter(|(index, line)| {
                    *index + 1 >= body_start_line
                        && needles.iter().any(|needle| line.contains(needle))
                })
                .map(|(index, _)| index + 1)
                .collect::<Vec<_>>();
            (
                name.to_string(),
                CallSites {
                    count: lines.len(),
                    lines,
                },
            )
        })
        .collect::<BTreeMap<_, _>>();
    let fetch_lines = text
        .lines()
        .enumerate()
        .filter(|(index, line)| {
            *index + 1 >= body_start_line && contains_identifier_call(line, "fetch")
        })
        .map(|(index, _)| index + 1)
        .collect::<Vec<_>>();
    calls.insert(
        "fetch".to_string(),
        CallSites {
            count: fetch_lines.len(),
            lines: fetch_lines,
        },
    );
    calls
}

fn contains_identifier_call(line: &str, identifier: &str) -> bool {
    let bytes = line.as_bytes();
    let mut offset = 0;
    while let Some(relative) = line[offset..].find(identifier) {
        let start = offset + relative;
        let end = start + identifier.len();
        let valid_prefix = start == 0 || !is_identifier_byte(bytes[start - 1]);
        let mut cursor = end;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if valid_prefix && cursor < bytes.len() && bytes[cursor] == b'(' {
            return true;
        }
        offset = end;
    }
    false
}

fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$')
}

fn debug_loader(source: &Path, metadata: &[MetadataEntry]) -> Result<String> {
    let name = first_value(metadata, "name");
    let mut output = vec![
        HEADER_START.to_string(),
        format!("// @name         {name}（本地调试）"),
        "// @version      0.0.0-local".to_string(),
        "// @description  从本地源码加载；保存源码后刷新页面生效".to_string(),
    ];
    for entry in metadata {
        let key = entry.key.to_ascii_lowercase();
        if matches!(
            key.as_str(),
            "name" | "description" | "version" | "downloadurl" | "updateurl"
        ) || key.starts_with("name:")
            || key.starts_with("description:")
        {
            continue;
        }
        output.push(
            format!("// @{} {}", entry.key, entry.value)
                .trim_end()
                .to_string(),
        );
    }
    output.push(format!("// @require      {}", browser_file_uri(source)?));
    output.push(HEADER_END.to_string());
    output.push(String::new());
    Ok(output.join("\n"))
}

fn browser_file_uri(path: &Path) -> Result<String> {
    let absolute = absolute(path)?;
    let normalized = absolute.to_string_lossy().replace('\\', "/");
    Ok(browser_file_uri_from_normalized(&normalized))
}

fn browser_file_uri_from_normalized(normalized: &str) -> String {
    if let Some(rest) = normalized.strip_prefix("/mnt/") {
        let mut parts = rest.splitn(2, '/');
        let drive = parts.next().unwrap_or_default();
        let tail = parts.next().unwrap_or_default();
        if drive.len() == 1 && drive.as_bytes()[0].is_ascii_alphabetic() {
            return format!(
                "file:///{}:/{}",
                drive.to_ascii_uppercase(),
                percent_encode_path(tail)
            );
        }
    }
    let bytes = normalized.as_bytes();
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/' {
        return format!("file:///{}", percent_encode_path(normalized));
    }
    format!("file://{}", percent_encode_path(normalized))
}

fn browser_file_uri_matches(left: &str, right: &str) -> bool {
    let is_windows_file_uri = |value: &str| {
        let bytes = value.as_bytes();
        bytes.len() >= 11
            && value[..8].eq_ignore_ascii_case("file:///")
            && bytes[8].is_ascii_alphabetic()
            && bytes[9] == b':'
            && bytes[10] == b'/'
    };
    if is_windows_file_uri(left) && is_windows_file_uri(right) {
        left.eq_ignore_ascii_case(right)
    } else {
        left == right
    }
}

fn percent_encode_path(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~' | b'/' | b':') {
            output.push(byte as char);
        } else {
            output.push_str(&format!("%{byte:02X}"));
        }
    }
    output
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"// ==UserScript==
// @name Demo
// @version 1.2.3
// @match https://example.com/*
// @grant GM_xmlhttpRequest
// @require https://cdn.example/a.js
// @downloadURL https://example.com/demo.user.js
// ==/UserScript==

fetch('/api');
enqueueNestedPrefetch('/not-a-fetch-call');
GM_xmlhttpRequest({ method: 'GET' });
"#;

    #[test]
    fn parses_metadata_and_body_calls() {
        let parsed = parse_metadata(SAMPLE).unwrap();
        assert!(parsed.metadata_errors.is_empty());
        assert_eq!(first_value(&parsed.metadata, "name"), "Demo");
        let calls = request_call_sites(SAMPLE, parsed.body_start_line);
        assert_eq!(calls["fetch"].count, 1);
        assert_eq!(calls["gm_xml_http_request"].count, 1);
        assert_eq!(calls["fetch"].lines, vec![10]);
    }

    #[test]
    fn converts_wsl_windows_path_to_browser_uri() {
        let path = Path::new("/mnt/c/Users/Test User/work/main.js");
        assert_eq!(
            browser_file_uri(path).unwrap(),
            "file:///C:/Users/Test%20User/work/main.js"
        );
    }

    #[test]
    fn converts_native_windows_path_to_browser_uri() {
        assert_eq!(
            browser_file_uri_from_normalized("C:/Users/Test User/work/main.js"),
            "file:///C:/Users/Test%20User/work/main.js"
        );
    }

    #[test]
    fn compares_windows_file_uris_case_insensitively() {
        assert!(browser_file_uri_matches(
            "file:///C:/Users/Test/work/main.js",
            "file:///C:/users/test/work/main.js"
        ));
        assert!(!browser_file_uri_matches(
            "file:///C:/Users/Test/work/main.js",
            "file:///D:/Users/Test/work/main.js"
        ));
    }

    #[test]
    fn loader_drops_update_urls_and_appends_local_source() {
        let parsed = parse_metadata(SAMPLE).unwrap();
        let loader = debug_loader(Path::new("/mnt/c/work/main.js"), &parsed.metadata).unwrap();
        assert!(!loader.contains("@downloadURL"));
        assert!(loader.contains("@version      0.0.0-local"));
        assert!(loader.contains("// @require      file:///C:/work/main.js\n// ==/UserScript=="));
    }
}
