use crate::surfaces::get;
use axum::{
    Router,
    body::Body,
    extract::OriginalUri,
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{
            CACHE_CONTROL, CONTENT_SECURITY_POLICY, CONTENT_TYPE, ETAG, IF_NONE_MATCH,
            REFERRER_POLICY, X_CONTENT_TYPE_OPTIONS,
        },
    },
    response::{IntoResponse, Response},
};

struct EmbeddedAsset {
    request_path: &'static str,
    content_type: &'static str,
    immutable: bool,
    etag: &'static str,
    inline_script_hashes: &'static [&'static str],
    bytes: &'static [u8],
}

include!(concat!(env!("OUT_DIR"), "/web_assets.rs"));

const LEGACY_INDEX_HTML: &str = include_str!("../web/app/index.html");
const LEGACY_APP_CSS: &str = include_str!("../web/app/app.css");
const LEGACY_APP_JS: &str = include_str!("../web/app/app.js");
const CYTOSCAPE_JS: &str = include_str!("../web/vendor/cytoscape-3.34.0.min.js");

// Cytoscape positions its canvas layers with element style properties. CSP
// treats those properties as inline styles, so the workspace permits inline
// style rules while script execution never receives unsafe-inline or unsafe-eval.
const LEGACY_CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; \
                          font-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; \
                          frame-ancestors 'none'; worker-src 'self'; manifest-src 'self'";
const NO_STORE: &str = "no-store";
const IMMUTABLE: &str = "public, max-age=31536000, immutable";

pub fn router() -> Router {
    use crate::surfaces::ContractRouterExt as _;
    Router::new()
        .contract_route("GET /app", get(serve_app))
        .contract_route("GET /app/", get(serve_app))
        .contract_route("GET /app/investigate", get(serve_app))
        .contract_route("GET /app/assets/{*path}", get(serve_asset))
        .contract_route("GET /app/{*path}", get(serve_app))
}

async fn serve_app(OriginalUri(uri): OriginalUri, headers: HeaderMap) -> Response {
    let path = uri.path();
    if has_unsafe_path_syntax(path) {
        return not_found();
    }
    if EMBEDDED_WEB_BUNDLE {
        return serve_embedded_route(path, &headers);
    }
    if looks_like_static_asset_path(path) {
        return not_found();
    }
    serve_legacy_index()
}

async fn serve_asset(
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    axum::extract::Path(path): axum::extract::Path<String>,
) -> Response {
    if has_unsafe_path_syntax(uri.path()) || has_unsafe_path_syntax(&path) {
        return not_found();
    }
    if EMBEDDED_WEB_BUNDLE {
        if let Some(asset) = find_asset(uri.path()) {
            return asset_response(asset, &headers);
        }
        return not_found();
    }
    serve_legacy_asset(&path)
}

fn serve_embedded_route(path: &str, headers: &HeaderMap) -> Response {
    if let Some(asset) = find_asset(path) {
        return asset_response(asset, headers);
    }
    if !path.ends_with('/') {
        let with_slash = format!("{path}/");
        if let Some(asset) = find_asset(&with_slash) {
            return asset_response(asset, headers);
        }
    }
    if looks_like_static_asset_path(path) {
        return not_found();
    }
    // Scoped SPA fallback under /app/* for deep links.
    if let Some(fallback) = find_asset("/app/investigate/").or_else(|| find_asset("/app/")) {
        return asset_response(fallback, headers);
    }
    not_found()
}

fn find_asset(request_path: &str) -> Option<&'static EmbeddedAsset> {
    EMBEDDED_ASSETS
        .binary_search_by(|asset| asset.request_path.cmp(request_path))
        .ok()
        .map(|idx| &EMBEDDED_ASSETS[idx])
}

fn has_unsafe_path_syntax(path: &str) -> bool {
    path.contains('\0')
        || path.contains('\\')
        || path.contains("%2e")
        || path.contains("%2E")
        || path.contains("%5c")
        || path.contains("%5C")
        || path.split('/').any(|seg| seg == "..")
}

fn looks_like_static_asset_path(path: &str) -> bool {
    if path.starts_with("/app/_next/") || path.starts_with("/app/assets/") {
        return true;
    }
    let last_segment = path.rsplit('/').next().unwrap_or("");
    last_segment.contains('.')
}

fn asset_response(asset: &EmbeddedAsset, headers: &HeaderMap) -> Response {
    let cache_control = if asset.immutable { IMMUTABLE } else { NO_STORE };
    let etag_header = format!("\"{}\"", asset.etag);
    let csp = build_csp(asset.inline_script_hashes);

    if matches_etag(headers, asset.etag) {
        let mut response = StatusCode::NOT_MODIFIED.into_response();
        apply_common_headers(
            response.headers_mut(),
            asset.content_type,
            cache_control,
            Some(&etag_header),
            &csp,
        );
        return response;
    }

    let mut response = (StatusCode::OK, Body::from(asset.bytes)).into_response();
    apply_common_headers(
        response.headers_mut(),
        asset.content_type,
        cache_control,
        Some(&etag_header),
        &csp,
    );
    response
}

fn matches_etag(headers: &HeaderMap, expected: &str) -> bool {
    let Some(raw) = headers.get(IF_NONE_MATCH).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    raw.split(',').any(|candidate| {
        let trimmed = candidate.trim();
        let unweak = trimmed.strip_prefix("W/").unwrap_or(trimmed).trim();
        unweak == "*" || unweak.trim_matches('"') == expected
    })
}

fn build_csp(inline_script_hashes: &[&str]) -> String {
    let mut script_src = String::from("script-src 'self'");
    for hash in inline_script_hashes {
        script_src.push_str(" '");
        script_src.push_str(hash);
        script_src.push('\'');
    }
    format!(
        "default-src 'self'; {script_src}; style-src 'self' 'unsafe-inline'; connect-src 'self'; \
         font-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; \
         frame-ancestors 'none'; worker-src 'self'; manifest-src 'self'"
    )
}

fn apply_common_headers(
    headers: &mut HeaderMap,
    content_type: &'static str,
    cache_control: &'static str,
    etag: Option<&str>,
    csp: &str,
) {
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static(cache_control));
    headers.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    if let Some(etag) = etag
        && let Ok(val) = HeaderValue::from_str(etag)
    {
        headers.insert(ETAG, val);
    }
    if let Ok(val) = HeaderValue::from_str(csp) {
        headers.insert(CONTENT_SECURITY_POLICY, val);
    }
}

fn serve_legacy_index() -> Response {
    text_response(
        StatusCode::OK,
        "text/html; charset=utf-8",
        NO_STORE,
        LEGACY_CSP,
        LEGACY_INDEX_HTML,
    )
}

fn serve_legacy_asset(path: &str) -> Response {
    match path {
        "app.css" => text_response(
            StatusCode::OK,
            "text/css; charset=utf-8",
            NO_STORE,
            LEGACY_CSP,
            LEGACY_APP_CSS,
        ),
        "app.js" => text_response(
            StatusCode::OK,
            "application/javascript; charset=utf-8",
            NO_STORE,
            LEGACY_CSP,
            LEGACY_APP_JS,
        ),
        "cytoscape-3.34.0.min.js" => text_response(
            StatusCode::OK,
            "application/javascript; charset=utf-8",
            IMMUTABLE,
            LEGACY_CSP,
            CYTOSCAPE_JS,
        ),
        _ => not_found(),
    }
}

fn not_found() -> Response {
    text_response(
        StatusCode::NOT_FOUND,
        "text/plain; charset=utf-8",
        NO_STORE,
        LEGACY_CSP,
        "not found",
    )
}

fn text_response(
    status: StatusCode,
    content_type: &'static str,
    cache_control: &'static str,
    csp: &str,
    body: &'static str,
) -> Response {
    let mut response = (status, Body::from(body)).into_response();
    apply_common_headers(
        response.headers_mut(),
        content_type,
        cache_control,
        None,
        csp,
    );
    response
}

#[cfg(test)]
#[path = "web_app_tests.rs"]
mod tests;
