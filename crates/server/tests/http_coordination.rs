//! Integration test for the InfiniteCode-shaped HTTP bridge.
//!
//! Boots the axum router on a loopback `127.0.0.1:0` listener and exercises
//! the lifecycle:
//!
//!   1. `GET  /api/healthz` — should return 200 (no auth).
//!   2. `POST /api/v1/auth/login` — exchange password for bearer token.
//!   3. `POST /api/v1/infinitecode/session` — admit a session.
//!   4. `GET  /api/v1/infinitecode/session/:id` — poll and verify shape.
//!   5. `POST /api/v1/infinitecode/session` — admit a *second* session for the
//!      same acting user; the first one should be marked `superseded`.
//!   6. `GET  /api/v1/infinitecode/session/:first_id` — should now 409.
//!   7. `DELETE /api/v1/infinitecode/session/:second_id` — should release.
//!
//! Each test pre-creates a tempdir + SQLite database, then runs the bridge
//! against that database. We serialise the test suite so the bridge doesn't
//! compete for the same `infinitecode.db` path (we use unique tempdirs so
//! contention is impossible).

use std::sync::Arc;
use std::time::Instant;

use infinitecode_config::InfiniteCodeBridgeConfig;
use infinitecode_protocol::{AuthLoginRequest, CoordinationSessionRequest};
use infinitecode_server::db::Database;
use infinitecode_server::db_infinitecode::migrate_database;
use infinitecode_server::http::{HttpBridgeState, build_router};
use reqwest::StatusCode;
use smol_str::SmolStr;
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

fn test_bridge_cfg() -> InfiniteCodeBridgeConfig {
    InfiniteCodeBridgeConfig {
        enabled: true,
        password: Some("test-password".to_string()),
        token_ttl_secs: 60,
        default_session_length_secs: 3600,
        ads_enabled: false,
        serper_base_url: None,
        context7_base_url: None,
    }
}

async fn start_test_server() -> (reqwest::Client, String, TempDir, CancellationToken) {
    let dir = TempDir::new().expect("create tempdir");
    let db_path = dir.path().join("infinitecode.db");
    let db = Arc::new(Database::open(db_path).expect("open db"));
    migrate_database(&db).expect("infinitecode migrate");

    let state = HttpBridgeState::new(db, test_bridge_cfg(), Instant::now());
    let router = build_router(state);

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind loopback");
    let local_addr = listener.local_addr().expect("local_addr");
    let url = format!("http://{local_addr}");
    let shutdown = CancellationToken::new();
    let shutdown_clone = shutdown.clone();
    tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                shutdown_clone.cancelled().await;
            })
            .await;
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .expect("client");
    (client, url, dir, shutdown)
}

async fn login(client: &reqwest::Client, url: &str, password: &str) -> String {
    let response = client
        .post(format!("{url}/api/v1/auth/login"))
        .json(&AuthLoginRequest {
            password: SmolStr::new(password),
        })
        .send()
        .await
        .expect("login send");
    assert_eq!(response.status(), StatusCode::OK, "login should 200 OK");
    let body: serde_json::Value = response.json().await.expect("login json");
    body.get("token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .expect("token in body")
}

fn admit_request(
    instance: &str,
    user: &str,
    model: &str,
    device_fingerprint: Option<&str>,
) -> CoordinationSessionRequest {
    CoordinationSessionRequest {
        instance_id: SmolStr::new(instance),
        acting_user_id: SmolStr::new(user),
        model: SmolStr::new(model),
        iso_country_code: None,
        device_fingerprint: device_fingerprint.map(SmolStr::new),
        app_version: Some(SmolStr::new("infinitecode-test")),
    }
}

#[tokio::test]
async fn healthz_returns_ok_without_auth() {
    let (client, url, _dir, _shutdown) = start_test_server().await;
    let response = client
        .get(format!("{url}/api/healthz"))
        .send()
        .await
        .expect("healthz");
    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value = response.json().await.expect("healthz json");
    assert_eq!(body.get("status").and_then(|v| v.as_str()), Some("ok"));
}

#[tokio::test]
async fn login_with_wrong_password_returns_401() {
    let (client, url, _dir, _shutdown) = start_test_server().await;
    let response = client
        .post(format!("{url}/api/v1/auth/login"))
        .json(&AuthLoginRequest {
            password: SmolStr::new("WRONG"),
        })
        .send()
        .await
        .expect("login wrong");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn protected_route_without_bearer_returns_401() {
    let (client, url, _dir, _shutdown) = start_test_server().await;
    let response = client
        .post(format!("{url}/api/v1/infinitecode/session"))
        .json(&admit_request("inst", "user", "minimax/minimax-m3", None))
        .send()
        .await
        .expect("post without bearer");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn admit_poll_release_lifecycle_with_bearer() {
    let (client, url, _dir, _shutdown) = start_test_server().await;
    let token = login(&client, &url, "test-password").await;

    // Admit
    let admit = client
        .post(format!("{url}/api/v1/infinitecode/session"))
        .bearer_auth(&token)
        .json(&admit_request(
            "instance-A",
            "user-1",
            "minimax/minimax-m3",
            None,
        ))
        .send()
        .await
        .expect("admit");
    assert_eq!(admit.status(), StatusCode::CREATED);
    let body: serde_json::Value = admit.json().await.expect("admit body");
    assert_eq!(body.get("status").and_then(|v| v.as_str()), Some("active"),);
    assert_eq!(
        body.get("instance_id").and_then(|v| v.as_str()),
        Some("instance-A"),
    );

    // Poll
    let poll = client
        .get(format!("{url}/api/v1/infinitecode/session/instance-A"))
        .bearer_auth(&token)
        .send()
        .await
        .expect("poll");
    assert_eq!(poll.status(), StatusCode::OK);
    let body: serde_json::Value = poll.json().await.expect("poll body");
    assert_eq!(body.get("status").and_then(|v| v.as_str()), Some("active"),);
    let bucket = body.get("bucket").and_then(|v| v.as_str()).unwrap_or("");
    assert!(
        bucket == "premium" || bucket == "unlimited",
        "bucket should be valid; got {bucket}"
    );

    // Release
    let release = client
        .delete(format!("{url}/api/v1/infinitecode/session/instance-A"))
        .bearer_auth(&token)
        .send()
        .await
        .expect("release");
    assert_eq!(release.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn same_user_different_device_fingerprints_both_stay_active() {
    // Per-(user, device) active-session rule: opening a second session
    // for the SAME Supabase user on a DIFFERENT device_fingerprint does
    // NOT supersede the first session. Both stay Active.
    // (Prior strict-per-user rule would have rotated the first; we
    // deliberately replaced that with this test on commit 1e071a6.)
    let (client, url, _dir, _shutdown) = start_test_server().await;
    let token = login(&client, &url, "test-password").await;

    let _ = client
        .post(format!("{url}/api/v1/infinitecode/session"))
        .bearer_auth(&token)
        .json(&admit_request(
            "instance-A",
            "user-1",
            "minimax/minimax-m3",
            Some("device-1"),
        ))
        .send()
        .await
        .expect("first admit on device-1");
    let _ = client
        .post(format!("{url}/api/v1/infinitecode/session"))
        .bearer_auth(&token)
        .json(&admit_request(
            "instance-B",
            "user-1",
            "deepseek/deepseek-v4-pro",
            Some("device-2"),
        ))
        .send()
        .await
        .expect("second admit on device-2 same user");

    // Both instances stay Active; the GET on the first one returns 200.
    let response = client
        .get(format!("{url}/api/v1/infinitecode/session/instance-A"))
        .bearer_auth(&token)
        .send()
        .await
        .expect("poll first instance");
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "same user across two devices must both stay Active under per-(user, device)"
    );
}

#[tokio::test]
async fn different_user_same_device_fingerprint_supersedes_first() {
    // Per-device collision rule: a different Supabase user signing in on
    // the SAME physical device ends the prior user's row. The new user
    // becomes Active; the prior row flips to Superseded and a follow-up
    // GET on its instance id responds 409 CONFLICT.
    let (client, url, _dir, _shutdown) = start_test_server().await;
    let token = login(&client, &url, "test-password").await;

    let _ = client
        .post(format!("{url}/api/v1/infinitecode/session"))
        .bearer_auth(&token)
        .json(&admit_request(
            "instance-A",
            "user-1",
            "minimax/minimax-m3",
            Some("shared-device"),
        ))
        .send()
        .await
        .expect("user-1 admit on shared-device");
    let _ = client
        .post(format!("{url}/api/v1/infinitecode/session"))
        .bearer_auth(&token)
        .json(&admit_request(
            "instance-B",
            "user-2",
            "deepseek/deepseek-v4-pro",
            Some("shared-device"),
        ))
        .send()
        .await
        .expect("user-2 admit on shared-device");

    // user-1's row was flipped to Superseded (reason:
    // `different_account_on_device`). GET on instance-A returns 409.
    let response = client
        .get(format!("{url}/api/v1/infinitecode/session/instance-A"))
        .bearer_auth(&token)
        .send()
        .await
        .expect("poll superseded prior-user row");
    assert_eq!(
        response.status(),
        StatusCode::CONFLICT,
        "different account on same device must end the prior user's session"
    );
}

#[tokio::test]
async fn ads_auction_returns_empty_default() {
    let (client, url, _dir, _shutdown) = start_test_server().await;
    let token = login(&client, &url, "test-password").await;

    let response = client
        .post(format!("{url}/api/v1/ads"))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "placement": "desktop-inline-chat",
            "messages": [],
        }))
        .send()
        .await
        .expect("auction");
    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value = response.json().await.expect("auction body");
    assert!(
        body.get("auction").map(|v| v.is_null()).unwrap_or(false),
        "auction should be null when ads_enabled=false; got {body}",
    );
}
