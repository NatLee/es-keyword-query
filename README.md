![Keyword Vault — compiler and keyword collections](https://raw.githubusercontent.com/NatLee/keyword-vault/main/docs/images/cover.png)

# es-keyword-query has moved to Keyword Vault

The maintained Rust library, CLI examples, compiler workbench and Traditional Chinese segmentation preview now live in **[NatLee/keyword-vault](https://github.com/NatLee/keyword-vault)**. This repository is retained as a read-only historical entry point. New issues and contributions belong in Keyword Vault.

The consolidation is released in [Keyword Vault PR #9](https://github.com/NatLee/keyword-vault/pull/9). The library keeps the `es-keyword-query` package name, `es_keyword_query` Rust module, compiler syntax and Rust 1.74 minimum. The full Vault service has its own newer toolchain requirements.

| Use | Maintained location |
|---|---|
| Rust library | [crates/es-keyword-query](https://github.com/NatLee/keyword-vault/tree/main/crates/es-keyword-query) |
| CLI and standalone inspection examples | [Compiler workbench guide](https://github.com/NatLee/keyword-vault/blob/main/docs/compiler-workbench.md) |
| Keyword collections, compiler and Chinese analysis UI | [Keyword Vault](https://github.com/NatLee/keyword-vault) |
| API, OAuth and MCP | [Current API and connection guide](https://github.com/NatLee/keyword-vault#account-connections-api-and-mcp) |
| Existing compiler service accounts | [Offline account migration](https://github.com/NatLee/keyword-vault/blob/main/docs/compiler-migration.md) |
| Migration and runtime verification | [Consolidation evidence](https://github.com/NatLee/keyword-vault/blob/main/docs/consolidation-verification.md) |

## Update a Rust dependency

```toml
[dependencies]
es-keyword-query = { git = "https://github.com/NatLee/keyword-vault", package = "es-keyword-query" }
```

For reproducible builds, add the reviewed consolidated release revision:

```toml
[dependencies]
es-keyword-query = { git = "https://github.com/NatLee/keyword-vault", package = "es-keyword-query", rev = "198ee523aa3a60d1313d03a6de65733971087a45" }
```

Imports stay the same:

```rust
use es_keyword_query::{Options, Query};
let query = Query::parse("(珍珠奶茶|(珍珠 鮮奶 ~))!廣告")?;
let compiled = query.to_query_string();
```

## Use the consolidated workbench

```sh
git clone https://github.com/NatLee/keyword-vault.git
cd keyword-vault
cargo run -p es-keyword-query --example inspect -- '茶&奶'
# Full application: nginx serves the UI and proxies the internal API.
docker compose up -d --build
```

Follow the [current first-administrator instructions](https://github.com/NatLee/keyword-vault#首次登入與建立管理員) for bootstrap; no default login is created. Chinese analysis previews use a pinned Traditional Chinese dictionary and show token offsets and dictionary fingerprints. Segmentation does not silently rewrite an existing query or install an Elasticsearch analyzer.

![Actual consolidated compiler workbench with Chinese analysis](https://raw.githubusercontent.com/NatLee/keyword-vault/main/docs/images/consolidation-workbench-desktop-light.png)

## Existing service deployments

Read the complete [migration procedure](https://github.com/NatLee/keyword-vault/blob/main/docs/compiler-migration.md) before moving accounts. Stop both services, checkpoint SQLite normally, create a dry-run report and apply it with a new verified backup. The importer preserves disabled/review/password-login restrictions and rejects unsupported schemas or conflicting identities. It does not replace the destination database.

Old sessions, API keys, OAuth clients/grants and usage records are **not** imported. Users sign in again; administrators configure the new provider callback origin, register clients again and issue scoped credentials. Compatibility operations `compile_query`, `inspect_query` and `extract_terms` retain their payload and `compile_error` contract, but require an explicitly selected `queries:read` scope on the new origin.

The old source and history remain available for reproducibility. [Read the pre-consolidation README at its original revision](https://github.com/NatLee/es-keyword-query/blob/03e6a4da27e53f74012964c064b2179ef4f70113/README.md). Archived code receives no new fixes; follow the maintained repository for updates.
