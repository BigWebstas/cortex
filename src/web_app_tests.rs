use axum::body::to_bytes;
use axum::http::{Request, StatusCode, header};
use tower::util::ServiceExt;

use super::*;

async fn send(method: &str, path: &str, if_none_match: Option<&str>) -> axum::response::Response {
    let mut builder = Request::builder().method(method).uri(path);
    if let Some(etag) = if_none_match {
        builder = builder.header(header::IF_NONE_MATCH, etag);
    }
    router()
        .oneshot(builder.body(axum::body::Body::empty()).unwrap())
        .await
        .unwrap()
}

async fn get(path: &str) -> axum::response::Response {
    send("GET", path, None).await
}

#[tokio::test]
async fn app_route_serves_workspace_shell_with_no_store_and_strict_csp() {
    let response = get("/app/investigate").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );
    assert_eq!(
        response
            .headers()
            .get(header::X_CONTENT_TYPE_OPTIONS)
            .unwrap(),
        "nosniff"
    );
    let csp = response
        .headers()
        .get(header::CONTENT_SECURITY_POLICY)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(csp.contains("script-src 'self'"), "unexpected csp: {csp}");
    assert!(csp.contains("style-src 'self' 'unsafe-inline'"));
    assert!(
        !csp.contains("script-src 'self' 'unsafe-inline'") && !csp.contains("unsafe-eval"),
        "script-src must never allow unsafe-inline or unsafe-eval: {csp}"
    );
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let html = String::from_utf8(body.to_vec()).unwrap();
    assert!(html.contains("Cortex investigation workspace"));
    assert!(!html.contains("CORTEX_API_TOKEN="));
    assert!(html.contains("data-clear-token"));
}

#[tokio::test]
async fn app_spa_fallback_is_scoped_under_app_only() {
    let response = get("/app/some/deep/link").await;
    assert_eq!(response.status(), StatusCode::OK);

    for path in ["/api/stats", "/mcp", "/health", "/v1/logs"] {
        let response = get(path).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
    }
}

#[tokio::test]
async fn app_rejects_traversal_and_missing_static_assets() {
    for path in [
        "/app/assets/../index.html",
        "/app/assets/%2e%2e/index.html",
        "/app/_next/static/does-not-exist.js",
        "/app/assets/missing.js",
        "/app/bundle.js.map",
    ] {
        let response = get(path).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
    }
}

#[tokio::test]
async fn app_assets_have_expected_cache_policy_and_head_support() {
    let response = get("/app/assets/cytoscape-3.34.0.min.js").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get(header::CACHE_CONTROL).unwrap(),
        "public, max-age=31536000, immutable"
    );

    let head = send("HEAD", "/app/assets/cytoscape-3.34.0.min.js", None).await;
    assert_eq!(head.status(), StatusCode::OK);
    let head_body = to_bytes(head.into_body(), usize::MAX).await.unwrap();
    assert!(head_body.is_empty());
}

#[tokio::test]
async fn embedded_next_bundle_routes_and_conditional_etag_work() {
    if !EMBEDDED_WEB_BUNDLE {
        return;
    }

    for route in [
        "/app",
        "/app/",
        "/app/investigate",
        "/app/investigate/",
        "/app/agents",
        "/app/agents/",
    ] {
        let response = get(route).await;
        assert_eq!(response.status(), StatusCode::OK, "{route}");
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store",
            "{route}"
        );
        let etag = response
            .headers()
            .get(header::ETAG)
            .expect("embedded route must include ETag")
            .to_str()
            .unwrap()
            .to_string();
        let not_modified = send("GET", route, Some(&etag)).await;
        assert_eq!(not_modified.status(), StatusCode::NOT_MODIFIED, "{route}");
    }

    let static_chunk = EMBEDDED_ASSETS
        .iter()
        .find(|asset| asset.request_path.starts_with("/app/_next/static/"))
        .expect("Next.js static export must embed /app/_next/static/ assets");
    let response = get(static_chunk.request_path).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get(header::CACHE_CONTROL).unwrap(),
        "public, max-age=31536000, immutable"
    );
}

#[tokio::test]
async fn next_workspace_sources_avoid_unsafe_html_sinks_and_token_storage() {
    let sources = [
        (
            "investigation-api.ts",
            include_str!("../web/src/lib/investigation-api.ts"),
        ),
        (
            "host-sources.ts",
            include_str!("../web/src/lib/host-sources.ts"),
        ),
        (
            "workspace-shell.tsx",
            include_str!("../web/src/components/workspace-shell.tsx"),
        ),
        (
            "investigation-workspace.tsx",
            include_str!("../web/src/components/investigate/investigation-workspace.tsx"),
        ),
        (
            "ask-panel.tsx",
            include_str!("../web/src/components/investigate/ask-panel.tsx"),
        ),
        (
            "graph-canvas.tsx",
            include_str!("../web/src/components/investigate/graph-canvas.tsx"),
        ),
        (
            "evidence-panel.tsx",
            include_str!("../web/src/components/investigate/evidence-panel.tsx"),
        ),
        (
            "timeline-panel.tsx",
            include_str!("../web/src/components/investigate/timeline-panel.tsx"),
        ),
    ];

    for (name, source) in sources {
        for forbidden in [
            "dangerouslySetInnerHTML",
            "innerHTML",
            "outerHTML",
            "insertAdjacentHTML",
            "document.write",
            "localStorage",
            "sessionStorage",
            "document.cookie",
            "cytoscape-node-html-label",
            "tippy(",
        ] {
            assert!(
                !source.contains(forbidden),
                "{name} must not use forbidden sink or storage API: {forbidden}"
            );
        }
    }

    let api_src = include_str!("../web/src/lib/investigation-api.ts");
    assert!(api_src.contains("/api/v1/investigations/ask"));
    assert!(api_src.contains("/api/v1/graph/around"));
    assert!(api_src.contains("/api/v1/graph/explain"));
    assert!(api_src.contains("/api/v1/graph/evidence"));
    assert!(!api_src.contains("/api/ai/ask-history"));
}

#[tokio::test]
async fn graph_dependency_is_pinned_and_documented() {
    assert!(CYTOSCAPE_JS.contains("cytoscape"));
    assert!(include_str!("../web/vendor/THIRD_PARTY.md").contains("Version: `3.34.0`"));
    assert!(
        include_str!("../web/vendor/cytoscape-3.34.0.package.json")
            .contains("\"name\": \"cytoscape\"")
    );
    assert!(
        include_str!("../web/vendor/cytoscape-3.34.0.package.json")
            .contains("\"license\": \"MIT\"")
    );
    assert!(
        include_str!("../web/vendor/cytoscape-3.34.0.LICENSE")
            .contains("Permission is hereby granted")
    );
}

#[test]
fn every_embedded_asset_can_be_looked_up() {
    for asset in EMBEDDED_ASSETS {
        assert!(
            find_asset(asset.request_path).is_some(),
            "embedded asset is unreachable: {}",
            asset.request_path
        );
    }
}

// Playwright starts the actual production router and embedded assets. API fixtures
// are provided by the browser tests; this server has no collectors or database.
#[tokio::test]
#[ignore = "explicitly launched by the browser test runner"]
async fn browser_workspace_server() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:4173")
        .await
        .expect("bind isolated browser workspace server");
    axum::serve(listener, router())
        .with_graceful_shutdown(async {
            tokio::time::sleep(std::time::Duration::from_secs(180)).await;
        })
        .await
        .expect("serve browser workspace");
}
