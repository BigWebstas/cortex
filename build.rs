use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=CORTEX_REQUIRE_WEB_BUNDLE");
    println!("cargo:rerun-if-changed=web/out/cortex-assets.json");
    println!("cargo:rerun-if-changed=web/app/index.html");
    println!("cargo:rerun-if-changed=web/app/app.css");
    println!("cargo:rerun-if-changed=web/app/app.js");
    println!("cargo:rerun-if-changed=web/vendor/cytoscape-3.34.0.min.js");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let web_out_dir = manifest_dir.join("web/out");
    let manifest_path = web_out_dir.join("cortex-assets.json");
    let require_bundle = matches!(
        env::var("CORTEX_REQUIRE_WEB_BUNDLE").as_deref(),
        Ok("1" | "true" | "TRUE" | "yes")
    );

    let generated = if manifest_path.exists() {
        generate_from_manifest(&web_out_dir, &manifest_path)
    } else if require_bundle {
        panic!(
            "CORTEX_REQUIRE_WEB_BUNDLE is set, but {} does not exist. Run: pnpm --dir web build",
            manifest_path.display()
        );
    } else {
        String::from(
            "const EMBEDDED_WEB_BUNDLE: bool = false;\n\
             const EMBEDDED_ASSETS: &[EmbeddedAsset] = &[];\n",
        )
    };

    fs::write(out_dir.join("web_assets.rs"), generated).expect("write generated web_assets.rs");
}

fn generate_from_manifest(web_out_dir: &Path, manifest_path: &Path) -> String {
    let raw = fs::read_to_string(manifest_path).expect("read web/out/cortex-assets.json");
    let root = JsonValue::parse(&raw).expect("parse web/out/cortex-assets.json");
    let assets = root
        .field("assets")
        .and_then(JsonValue::as_array)
        .expect("cortex-assets.json must contain an `assets` array");

    let canonical_out = fs::canonicalize(web_out_dir).expect("canonicalize web/out");
    let mut code = String::from(
        "const EMBEDDED_WEB_BUNDLE: bool = true;\n\
         const EMBEDDED_ASSETS: &[EmbeddedAsset] = &[\n",
    );

    // `find_asset` binary-searches by byte order. The manifest is written with
    // locale-aware ordering, which places `-` and `_` differently, so re-sort.
    let mut ordered = assets
        .iter()
        .map(|item| {
            let request_path = item
                .field("request_path")
                .and_then(JsonValue::as_str)
                .expect("asset.request_path");
            (request_path, item)
        })
        .collect::<Vec<_>>();
    ordered.sort_by(|a, b| a.0.cmp(b.0));

    for (_, item) in ordered {
        let request_path = item
            .field("request_path")
            .and_then(JsonValue::as_str)
            .expect("asset.request_path");
        let file_path = item
            .field("file_path")
            .and_then(JsonValue::as_str)
            .expect("asset.file_path");
        let content_type = item
            .field("content_type")
            .and_then(JsonValue::as_str)
            .expect("asset.content_type");
        let cache = item
            .field("cache")
            .and_then(JsonValue::as_str)
            .expect("asset.cache");
        let etag = item
            .field("etag")
            .and_then(JsonValue::as_str)
            .expect("asset.etag");
        let hashes = item
            .field("inline_script_hashes")
            .and_then(JsonValue::as_array)
            .expect("asset.inline_script_hashes");

        validate_relative_path(file_path);
        let full_path = web_out_dir.join(file_path);
        let canonical_file = fs::canonicalize(&full_path).unwrap_or_else(|err| {
            panic!(
                "manifest references missing file {}: {err}",
                full_path.display()
            )
        });
        assert!(
            canonical_file.starts_with(&canonical_out),
            "manifest path escapes web/out: {file_path}"
        );
        println!("cargo:rerun-if-changed=web/out/{file_path}");

        let immutable = cache == "immutable";
        let hash_literals = hashes
            .iter()
            .map(|h| {
                let s = h
                    .as_str()
                    .expect("inline_script_hashes entry must be string");
                format!("{s:?}")
            })
            .collect::<Vec<_>>()
            .join(", ");

        code.push_str(&format!(
            "    EmbeddedAsset {{\n\
             \x20       request_path: {request_path:?},\n\
             \x20       content_type: {content_type:?},\n\
             \x20       immutable: {immutable},\n\
             \x20       etag: {etag:?},\n\
             \x20       inline_script_hashes: &[{hash_literals}],\n\
             \x20       bytes: include_bytes!(concat!(env!(\"CARGO_MANIFEST_DIR\"), \"/web/out/\", {file_path:?})),\n\
             \x20   }},\n"
        ));
    }

    code.push_str("];\n");
    code
}

fn validate_relative_path(file_path: &str) {
    assert!(
        !file_path.is_empty()
            && !file_path.starts_with('/')
            && !file_path.contains('\\')
            && !file_path.contains('\0')
            && !file_path.split('/').any(|seg| seg == "..")
            && !file_path.ends_with(".map"),
        "invalid asset file_path in cortex-assets.json: {file_path}"
    );
}

#[derive(Debug)]
enum JsonValue {
    Null,
    Bool,
    Number,
    String(String),
    Array(Vec<JsonValue>),
    Object(Vec<(String, JsonValue)>),
}

impl JsonValue {
    fn parse(input: &str) -> Result<Self, String> {
        let mut parser = JsonParser {
            bytes: input.as_bytes(),
            pos: 0,
        };
        let value = parser.parse_value()?;
        parser.skip_ws();
        if parser.pos != parser.bytes.len() {
            return Err(format!("trailing bytes at offset {}", parser.pos));
        }
        Ok(value)
    }

    fn field(&self, name: &str) -> Option<&JsonValue> {
        match self {
            JsonValue::Object(entries) => entries.iter().find(|(k, _)| k == name).map(|(_, v)| v),
            _ => None,
        }
    }

    fn as_str(&self) -> Option<&str> {
        match self {
            JsonValue::String(s) => Some(s.as_str()),
            _ => None,
        }
    }

    fn as_array(&self) -> Option<&[JsonValue]> {
        match self {
            JsonValue::Array(items) => Some(items.as_slice()),
            _ => None,
        }
    }
}

struct JsonParser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> JsonParser<'a> {
    fn skip_ws(&mut self) {
        while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_whitespace() {
            self.pos += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn parse_value(&mut self) -> Result<JsonValue, String> {
        self.skip_ws();
        match self.peek() {
            Some(b'{') => self.parse_object(),
            Some(b'[') => self.parse_array(),
            Some(b'"') => self.parse_string().map(JsonValue::String),
            Some(b't') => self.expect_literal(b"true").map(|()| JsonValue::Bool),
            Some(b'f') => self.expect_literal(b"false").map(|()| JsonValue::Bool),
            Some(b'n') => self.expect_literal(b"null").map(|()| JsonValue::Null),
            Some(b'-' | b'0'..=b'9') => self.parse_number().map(|()| JsonValue::Number),
            other => Err(format!("unexpected byte {other:?} at offset {}", self.pos)),
        }
    }

    fn expect_literal(&mut self, lit: &[u8]) -> Result<(), String> {
        if self.bytes[self.pos..].starts_with(lit) {
            self.pos += lit.len();
            Ok(())
        } else {
            Err(format!("expected literal at offset {}", self.pos))
        }
    }

    fn parse_number(&mut self) -> Result<(), String> {
        while let Some(b) = self.peek() {
            if matches!(b, b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E') {
                self.pos += 1;
            } else {
                break;
            }
        }
        Ok(())
    }

    fn parse_string(&mut self) -> Result<String, String> {
        if self.peek() != Some(b'"') {
            return Err(format!("expected string at offset {}", self.pos));
        }
        self.pos += 1;
        let mut out = String::new();
        while self.pos < self.bytes.len() {
            let b = self.bytes[self.pos];
            self.pos += 1;
            match b {
                b'"' => return Ok(out),
                b'\\' => {
                    let esc = *self
                        .bytes
                        .get(self.pos)
                        .ok_or_else(|| "unterminated escape".to_string())?;
                    self.pos += 1;
                    match esc {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{0008}'),
                        b'f' => out.push('\u{000c}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let hex = std::str::from_utf8(
                                self.bytes
                                    .get(self.pos..self.pos + 4)
                                    .ok_or_else(|| "short unicode escape".to_string())?,
                            )
                            .map_err(|e| e.to_string())?;
                            self.pos += 4;
                            let code = u32::from_str_radix(hex, 16).map_err(|e| e.to_string())?;
                            let ch = char::from_u32(code)
                                .ok_or_else(|| "invalid unicode".to_string())?;
                            out.push(ch);
                        }
                        other => return Err(format!("invalid escape \\{other}")),
                    }
                }
                _ => {
                    let start = self.pos - 1;
                    while self.pos < self.bytes.len()
                        && self.bytes[self.pos] != b'"'
                        && self.bytes[self.pos] != b'\\'
                    {
                        self.pos += 1;
                    }
                    let slice = std::str::from_utf8(&self.bytes[start..self.pos])
                        .map_err(|e| e.to_string())?;
                    out.push_str(slice);
                }
            }
        }
        Err("unterminated string".to_string())
    }

    fn parse_array(&mut self) -> Result<JsonValue, String> {
        self.pos += 1; // '['
        let mut items = Vec::new();
        loop {
            self.skip_ws();
            if self.peek() == Some(b']') {
                self.pos += 1;
                return Ok(JsonValue::Array(items));
            }
            items.push(self.parse_value()?);
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    return Ok(JsonValue::Array(items));
                }
                other => return Err(format!("expected ',' or ']', got {other:?}")),
            }
        }
    }

    fn parse_object(&mut self) -> Result<JsonValue, String> {
        self.pos += 1; // '{'
        let mut entries = Vec::new();
        loop {
            self.skip_ws();
            if self.peek() == Some(b'}') {
                self.pos += 1;
                return Ok(JsonValue::Object(entries));
            }
            let key = self.parse_string()?;
            self.skip_ws();
            if self.peek() != Some(b':') {
                return Err(format!("expected ':' at offset {}", self.pos));
            }
            self.pos += 1;
            let value = self.parse_value()?;
            entries.push((key, value));
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(JsonValue::Object(entries));
                }
                other => return Err(format!("expected ',' or '}}', got {other:?}")),
            }
        }
    }
}
