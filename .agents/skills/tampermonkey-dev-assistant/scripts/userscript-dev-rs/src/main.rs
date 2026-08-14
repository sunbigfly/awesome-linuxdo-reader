use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::{Context, Result, anyhow, bail};
use clap::{Parser, Subcommand};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

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
}

impl Command {
    fn name(&self) -> &'static str {
        match self {
            Self::Doctor { .. } => "doctor",
            Self::Inspect { .. } => "inspect",
            Self::MakeLoader { .. } => "make-loader",
            Self::VerifyLoader { .. } => "verify-loader",
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
    }
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
        offline: true,
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
    if let Some(rest) = normalized.strip_prefix("/mnt/") {
        let mut parts = rest.splitn(2, '/');
        let drive = parts.next().unwrap_or_default();
        let tail = parts.next().unwrap_or_default();
        if drive.len() == 1 && drive.as_bytes()[0].is_ascii_alphabetic() {
            return Ok(format!(
                "file:///{}:/{}",
                drive.to_ascii_uppercase(),
                percent_encode_path(tail)
            ));
        }
    }
    Ok(format!("file://{}", percent_encode_path(&normalized)))
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
