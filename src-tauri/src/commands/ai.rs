//! AI 供应商调用（SRS 9.1 / 9.5 / 附录 C）。
//! 统一 POST {base_url}/chat/completions；Key 只在 Rust 内从 Windows 凭据管理器读取，前端永不接触明文。
//! 超时 30s；401/403 不重试；429 退避 2 次（1s/3s）；5xx/超时重试 1 次后降级。
//! 业务计算（成本估算、预算判定、ai_runs 元数据写库、Zod 校验/降级）留在 TypeScript（SRS 3.5），
//! 本模块只返回 content + usage，由前端 lib/aiService.ts 记账与降级。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

// 附录 A：修改提示词必须保留 prompt_version；前端 ai_runs 元数据写入时需与此一致。
#[allow(dead_code)]
pub const PROMPT_VERSION: &str = "V1.0";
const KEY_SERVICE: &str = "com.weightcoach.desktop";
const TIMEOUT_SECS: u64 = 30;
const MAX_TOKENS: u32 = 1200;
const TEMPERATURE: f64 = 0.3;

#[derive(Deserialize)]
pub struct ChatArgs {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub messages: Vec<Value>,
    pub json_mode: Option<bool>,
}

#[derive(Serialize)]
pub struct ChatResult {
    pub content: String,
    pub usage: Usage,
}

#[derive(Serialize, Default)]
pub struct Usage {
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "code")]
pub enum AppError {
    NoKey { message: String },
    Auth { message: String },
    RateLimit { message: String },
    Timeout { message: String },
    Server { message: String },
    Network { message: String },
    Budget { message: String },
    Other { message: String },
}

impl AppError {
    pub fn message(&self) -> &str {
        match self {
            AppError::NoKey { message } | AppError::Auth { message } | AppError::RateLimit { message }
            | AppError::Timeout { message } | AppError::Server { message } | AppError::Network { message }
            | AppError::Budget { message } | AppError::Other { message } => message,
        }
    }
}

impl From<AppError> for String {
    fn from(e: AppError) -> String {
        serde_json::to_string(&e).unwrap_or_else(|_| "{\"code\":\"OTHER\"}".to_string())
    }
}

/// 重试策略（可单测）：成功范围与需退避的 429/5xx 返回策略，终态错误直接返回 AppError。
#[derive(Debug, PartialEq, Eq)]
enum RetryPolicy {
    Ok,           // 2xx，解析响应
    NoRetry,      // 其它 4xx：不重试，按 Other 处理
    Times(u32),   // 429：退避重试次数（1s/3s）
    Once,         // 5xx：重试 1 次
}

fn status_policy(code: u16) -> Result<RetryPolicy, AppError> {
    if (200..300).contains(&code) {
        return Ok(RetryPolicy::Ok);
    }
    match code {
        401 | 403 => Err(AppError::Auth { message: "密钥无效，请重新填写。".into() }),
        429 => Ok(RetryPolicy::Times(2)),
        500..=599 => Ok(RetryPolicy::Once),
        _ => Ok(RetryPolicy::NoRetry),
    }
}

/// 从 Windows 凭据管理器读取密钥；account = ai-key-{provider}（与 secrets.rs 完全一致）。
fn read_key(provider: &str) -> Result<String, AppError> {
    let account = format!("ai-key-{provider}");
    let entry = keyring::Entry::new(KEY_SERVICE, &account)
        .map_err(|e| AppError::Other { message: format!("凭据访问失败：{e}") })?;
    match entry.get_password() {
        Ok(k) if !k.trim().is_empty() => Ok(k),
        Ok(_) => Err(AppError::NoKey { message: "还没配置密钥，请到设置里填写。".into() }),
        Err(keyring::Error::NoEntry) => Err(AppError::NoKey { message: "还没配置密钥，请到设置里填写。".into() }),
        Err(e) => Err(AppError::Other { message: format!("凭据访问失败：{e}") }),
    }
}

/// 构造统一请求体（SRS 9.1）：model / messages / temperature=0.3 / max_tokens=1200 / 可选 response_format。
fn build_body(args: &ChatArgs) -> Value {
    let mut body = serde_json::json!({
        "model": args.model,
        "messages": args.messages,
        "temperature": TEMPERATURE,
        "max_tokens": MAX_TOKENS,
    });
    if args.json_mode.unwrap_or(false) {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }
    body
}

/// 解析 choices[0].message.content 与 usage。
fn parse_result(text: &str) -> Result<ChatResult, AppError> {
    let v: Value = serde_json::from_str(text)
        .map_err(|_| AppError::Other { message: "服务返回格式异常，已使用本地版本。".into() })?;
    let content = v.get("choices")
        .and_then(Value::as_array)
        .and_then(|a| a.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if content.is_empty() {
        return Err(AppError::Other { message: "服务未返回内容，已使用本地版本。".into() });
    }
    let usage = v.get("usage").map(|u| Usage {
        prompt_tokens: u.get("prompt_tokens").and_then(Value::as_i64),
        completion_tokens: u.get("completion_tokens").and_then(Value::as_i64),
    }).unwrap_or_default();
    Ok(ChatResult { content, usage })
}

#[tauri::command]
pub async fn ai_chat(args: ChatArgs) -> Result<ChatResult, AppError> {
    let key = read_key(&args.provider)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .build()
        .map_err(|e| AppError::Other { message: format!("创建请求客户端失败：{e}") })?;
    let url = format!("{}/chat/completions", args.base_url.trim_end_matches('/'));
    let body = build_body(&args);

    let mut retries_left = 0u32;
    let mut budget_set = false;
    let mut backoff_secs = 1u64;
    loop {
        let send = client
            .post(&url)
            .bearer_auth(&key)
            .json(&body)
            .send()
            .await;

        match send {
            Ok(resp) => {
                let status = resp.status().as_u16();
                // 先取状态策略：401/403 立即失败且不重试
                let policy = match status_policy(status) {
                    Ok(p) => p,
                    Err(e) => return Err(e),
                };
                let text = resp.text().await.unwrap_or_default();
                match policy {
                    RetryPolicy::Ok => return parse_result(&text),
                    RetryPolicy::NoRetry => {
                        return Err(AppError::Other { message: format!("服务返回 HTTP {status}，请稍后重试。") });
                    }
                    RetryPolicy::Times(_) | RetryPolicy::Once => {
                        // 首次遇到可重试错误时初始化额度：429 退避 2 次；5xx 重试 1 次。
                        // 之后无论再到 429 还是 5xx，都共享同一额度，避免无限重试。
                        let is_rate_limit = matches!(policy, RetryPolicy::Times(_));
                        if !budget_set {
                            retries_left = if is_rate_limit { 2 } else { 1 };
                            budget_set = true;
                        }
                        if retries_left == 0 {
                            return Err(if is_rate_limit {
                                AppError::RateLimit { message: "服务繁忙，稍后再试。".into() }
                            } else {
                                AppError::Server { message: "服务暂时不可用，已使用本地版本。".into() }
                            });
                        }
                        retries_left -= 1;
                        tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
                        backoff_secs = 3;
                        continue;
                    }
                }
            }
            Err(e) => {
                if e.is_timeout() {
                    if retries_left == 0 {
                        return Err(AppError::Timeout { message: "连接超时，请重试。".into() });
                    }
                    retries_left -= 1;
                    tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
                    backoff_secs = 3;
                    continue;
                }
                return Err(AppError::Network { message: "网络不可用，已使用本地数据。".into() });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_policy_classifies_retries() {
        assert_eq!(status_policy(200), Ok(RetryPolicy::Ok));
        assert_eq!(status_policy(204), Ok(RetryPolicy::Ok));
        assert!(matches!(status_policy(401), Err(AppError::Auth { .. })));
        assert!(matches!(status_policy(403), Err(AppError::Auth { .. })));
        assert_eq!(status_policy(429), Ok(RetryPolicy::Times(2)));
        assert_eq!(status_policy(500), Ok(RetryPolicy::Once));
        assert_eq!(status_policy(503), Ok(RetryPolicy::Once));
        assert_eq!(status_policy(400), Ok(RetryPolicy::NoRetry));
    }

    #[test]
    fn build_body_sets_common_params() {
        let args = ChatArgs {
            provider: "deepseek".into(),
            base_url: "https://api.deepseek.com".into(),
            model: "deepseek-chat".into(),
            messages: vec![serde_json::json!({ "role": "user", "content": "hi" })],
            json_mode: Some(true),
        };
        let body = build_body(&args);
        assert_eq!(body["temperature"], TEMPERATURE);
        assert_eq!(body["max_tokens"], MAX_TOKENS);
        assert_eq!(body["response_format"]["type"], "json_object");
        assert_eq!(body["model"], "deepseek-chat");
    }

    #[test]
    fn build_body_without_json_mode() {
        let args = ChatArgs {
            provider: "qwen".into(), base_url: "https://x".into(), model: "qwen-plus".into(),
            messages: vec![], json_mode: None,
        };
        assert!(build_body(&args).get("response_format").is_none());
    }

    #[test]
    fn parse_result_reads_content_and_usage() {
        let raw = r#"{"choices":[{"message":{"role":"assistant","content":"{\"answer\":\"ok\"}"}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}"#;
        let r = parse_result(raw).expect("parse ok");
        assert_eq!(r.content, "{\"answer\":\"ok\"}");
        assert_eq!(r.usage.prompt_tokens, Some(10));
        assert_eq!(r.usage.completion_tokens, Some(5));
    }

    #[test]
    fn parse_result_rejects_empty_or_invalid() {
        assert!(parse_result("not json").is_err());
        assert!(parse_result(r#"{"choices":[]}"#).is_err());
    }

    #[test]
    fn app_error_serializes_to_tagged_json() {
        let s = String::from(AppError::Auth { message: "bad key".into() });
        let v: Value = serde_json::from_str(&s).expect("valid json");
        assert_eq!(v["code"], "AUTH");
        assert_eq!(v["message"], "bad key");
    }
}
