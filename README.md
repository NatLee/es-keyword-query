![es-keyword-query — Small syntax. Explicit logic.](docs/images/cover.png)

# es-keyword-query

A compact boolean keyword syntax that compiles to an Elasticsearch / OpenSearch
[`query_string`](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-query-string-query.html).

It is meant for people who maintain long keyword lists (brand monitoring, media
tracking, content filters) and should not have to write Lucene by hand.

```
(apple|(apple pie ~))&store!rumor
```

becomes

```
("apple" OR ("apple pie"~20)) AND "store" NOT "rumor"
```

[Open the Compiler Foundry](docs/index.html) · [API docs: `cargo doc --open`](#development)

The source, stages, clause inspector and compiled artifact use distinct surfaces.
Selection feedback lasts 160–180ms and follows the Rust-generated clauses; reduced
motion immediately shows the final state. [Watch the actual workflow (WebM)](docs/images/feature-motion.webm).
[Style, responsive and accessibility checks](docs/themed-motion-verification.md).

## A query through the foundry

Open [Compiler Foundry](docs/index.html) and follow the same `Discovery` specimen,
`(tea|coffee)&shop!ad`, through these three steps. These are real captures of the
checked-in Rust-generated atlas, not a live search cluster. The browser explores
eight finite examples; use the [CLI](#development) for arbitrary expressions.

**1. Choose the source.** Select **Discovery**, then **00 Source**. The source panel
shows the unchanged expression; the initial Precise mode quotes each term.

![Step 1: Discovery selected with its original expression and precise output](docs/images/workflow-01.png)

**2. Read the structure and change the output mode.** Open **02 Structure**, select
**ad** (click, or focus and press Enter), and choose **Raw · pass through**. The
inspector identifies a direct exclusion; ordinary terms now pass through unquoted.
The selected source remains unchanged.

![Step 2: ad selected as a direct exclusion and Raw mode emits unquoted terms](docs/images/workflow-02.png)

**3. Compose and export.** Open **03 Compile**, choose **Phrase distance** under
**Restrict with a filter**, then **Export inspection**. Both expressions are grouped
before AND. The downloaded JSON's `query_string` matches the displayed output and
retains the Discovery source. This image is a crop of the actual release workbench.

![Step 3: Phrase distance filter composed with the same Discovery query](docs/images/workflow-03.png)

[Reproduce these captures and inspect the checks](docs/workflow-verification.md).
The separate [editable cover](docs/images/src/cover.html) is repository artwork.

<details><summary>Full application gallery · light, dark and mobile</summary>

![Light Compiler Foundry](docs/images/reference-light.png)
![Dark Compiler Foundry with a Rust-generated grouping diagram](docs/images/reference-desktop.png)
<img src="docs/images/reference-mobile.png" alt="Mobile Compiler Foundry" width="390">

</details>

## Syntax

| Syntax | Meaning | Output |
|---|---|---|
| `a&b` | both | `"a" AND "b"` |
| `a\|b` | either | `"a" OR "b"` |
| `a!b` | the first without the second | `"a" NOT "b"` |
| `(a\|b)&c` | grouping | `("a" OR "b") AND "c"` |
| `(a b ~)` | the words within 20 positions of each other | `("a b"~20)` |
| `(a b ~5)` | the words within 5 positions | `("a b"~5)` |
| `\&` `\|` `\!` `\~` `\(` `\)` `\\` | the literal character | |

- Input is NFKC-normalised, so full-width `＆ ｜ ！ （ ）` work like their ASCII forms.
- Every term is quoted and matches as an exact phrase. Turn `precise` off to
  pass terms through unquoted, which lets wildcards (`iphone*`) and field names
  (`title:apple`) reach Lucene.
- Operators are written out in the order typed and no precedence is added.
  Use parentheses whenever `&` and `|` are mixed.

## Usage

```toml
[dependencies]
es-keyword-query = { git = "https://github.com/NatLee/es-keyword-query" }
```

```rust
use es_keyword_query::{Options, Query};

let query = Query::parse("(珍珠奶茶|(珍珠 鮮奶 ~))!廣告")?;
query.to_query_string(); // ("珍珠奶茶" OR ("珍珠 鮮奶"~20)) NOT "廣告"
query.terms();           // ["珍珠奶茶", "珍珠 鮮奶", "廣告"]

// Unquoted terms and a different default slop.
let options = Options { precise: false, default_slop: 10, ..Options::default() };
Query::parse_with("iphone*&(case|cover)", options)?.to_query_string();
// iphone* AND (case OR cover)
```

Put the result in a `query_string` query:

```json
{ "query": { "query_string": { "query": "<output>", "fields": ["title", "content"] } } }
```

## Composing filters

`filtered_by` groups **both** expressions before joining them with AND. This
keeps a filter containing OR from leaking into the main query:

```rust
use es_keyword_query::Query;
let search = Query::parse("tea|coffee")?;
let filter = Query::parse("shop|cafe")?;
assert_eq!(search.filtered_by(&filter),
    r#"("shop" OR "cafe") AND ("tea" OR "coffee")"#);
```

## Errors

`Query::parse` returns an `Error` with a `kind`, the character `position`, and a
message in English (`message()`, also `Display`) and Traditional Chinese
(`message_zh()`).

| Input | Kind |
|---|---|
| empty string, `()` | `Empty` |
| `a&&b`, `a&\|b` | `ConsecutiveOperators` |
| `&a`, `a\|`, `!a` | `DanglingOperator` |
| `((a)` | `UnbalancedParentheses` |
| `(a)b`, `a ~ b` | `MissingOperator` |
| `~a`, `(a\|b)~` | `BadProximity` |
| `*` | `LoneWildcard` |
| `a**` | `ConsecutiveWildcards` |
| a comma, when `Comma::Reject` is set | `Comma` |
| more than 128 nested groups | `NestingTooDeep` |

## Commas

By default a comma is part of the term. `Comma::Join(Joiner::Or)` splits the
input on top-level commas instead: `a,b|c` becomes `("a") OR ("b" OR "c")`.

## Development

The crate has one runtime dependency, `unicode-normalization`. It does not
connect to a search cluster or execute searches. Query behavior still depends
on the target engine's fields and analyzers; proximity slop is not a character
count. Raw mode intentionally passes Lucene syntax through and is not an
escaping boundary for untrusted input.

The [Compiler Foundry](docs/index.html) opens directly in a browser, works offline,
and explores **eight finite Rust-generated specimens**. Select a clause in the
branch diagram, follow source → normalization → structure → compilation, switch precise/raw
output, and compose a grouped filter. Copy the compiled query or export its JSON
inspection. It does not compile arbitrary input in the browser. The cobalt blueprint and black/cyan
drafting surfaces expose the production stages, active clause and exact release artifact.
Arrow keys, Home and End move between stage tabs. Barlow Condensed is bundled
locally with its [license and provenance](docs/fonts/README.md); no font CDN is required.

For arbitrary expressions, use the local CLI:

```sh
cargo run --example inspect -- '(tea|coffee)&shop!ad'
cargo run --example inspect -- '(apple pie ~)' --raw --slop=5
```

It prints JSON with `valid`, compiled output, normalized input and a flat clause
list, or a structured syntax error (exit status 1). Unknown options exit with 2.

The same inspection is available in Rust:

```rust
let query = es_keyword_query::Query::parse("(tea|coffee)&shop")?;
let clauses = query.clauses();
assert_eq!(clauses[1].parent, Some(0));
assert_eq!(clauses[2].joiner, Some(es_keyword_query::Joiner::Or));
```

`Clause` records parent indices, node kind, direct exclusion, joiner, normalized
term, resolved phrase slop and exact leaf output. It preserves written structure;
it does not infer Boolean precedence or predict engine results.

Regenerate the checked-in atlas data after parser changes:

```sh
cargo run --example build_atlas
cargo run --example build_atlas -- --check
```

The library retains one runtime dependency. `serde_json` is used only by development
examples. The README opens with a separate illustrated cover; the walkthrough and gallery are actual application captures. [Visual insights notes](docs/visual-insights.md)
cover the design, reading order, tests and browser verification.

```
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo doc --no-deps --open
```

[Design and audit notes](docs/design-and-audit.md) describe the layout, parser
fixes, and validation scope.

## License

[MIT](LICENSE) © 2022 Nat Lee

## Account connections, API and MCP

The library remains independent: its Cargo manifest and runtime dependency graph are unchanged. The optional server is a separate Rust 1.88+ package with SQLite accounts, password sessions and the native compiler workbench.

```sh
cargo run --manifest-path server/Cargo.toml --locked
# In another terminal, bootstrap the first administrator using password stdin:
cargo run --manifest-path server/Cargo.toml --locked -- bootstrap demo
```

The server defaults to `http://127.0.0.1:8670`; `ES_SERVER_BIND`, `ES_SERVER_DATA_DIR`, `ES_SERVER_DATABASE_PATH` and `ES_SERVER_STATIC_DIR` configure the listener, database and static files. On an empty installation, open the server to reach `/first-login`. Choose a username (3–32 letters, numbers, `_`, `.` or `-`), an optional display name (up to 40 characters), and a matching password and confirmation (8–200 characters). The first account becomes the administrator and signs in immediately. Setup then closes; `/first-login` returns to normal login or the signed-in workspace.

Registration for subsequent accounts defaults to **Closed**. Administrators can change it in Connections to **Administrator approval** or **Open**, review pending requests with an approval or a rejection reason, and browse registration history. `/register` accepts a username (3–64 letters, numbers, `_`, `.` or `-`), optional display name (up to 100 characters), and matching password and confirmation (12–256 characters). All applicants become members. Approval requests receive no session or workspace access until approved; open registration signs the member in immediately. Closing registration leaves existing accounts working. Administrators can also create member accounts directly in Connections.

HTTP first-account setup accepts real loopback peers without a deployment code. For Docker or another nonloopback deployment, configure `ACCESS_SETUP_TOKEN` with a cryptographically random secret of 32–512 characters in the server environment or a protected Docker env file, alongside the canonical `ACCESS_PUBLIC_URL`. The first-login form then asks for the **Deployment setup code**. Missing or incorrect codes are refused; an unset token keeps remote setup locked. Blank, short or oversized configured tokens prevent startup. Forwarded headers never turn a remote connection into loopback. The token is never returned by the state API, logged, placed in a URL or stored in browser storage. Remove it from deployment configuration after creating the administrator.

The CLI bootstrap remains available and reads its password from stdin until EOF. It creates only the initial administrator and does not open a listener. Administrators can create/disable local member accounts. Disabling an account invalidates its sessions and bearer access.

`ACCESS_PUBLIC_URL` is the canonical origin used for issuer, resource, callback and same-origin checks. Use HTTPS in deployment; HTTPS forces Secure cookies. Configure GitHub with `ACCESS_GITHUB_CLIENT_ID` / `ACCESS_GITHUB_CLIENT_SECRET`, and Google with `ACCESS_GOOGLE_CLIENT_ID` / `ACCESS_GOOGLE_CLIENT_SECRET`. Register these exact callback URLs with the providers:

- `{origin}/oauth/callback/github`
- `{origin}/oauth/callback/google`

Sign into an existing account and link a provider identity in Connections, or use a configured Google/GitHub button on `/register` when registration is enabled. Registration follows the same approval/open policy as password accounts. The normal sign-in buttons require an existing binding. Provider accounts use the provider's stable identity; accounts are never merged by email. Missing provider configuration produces disabled sign-in buttons with an explanation and no signup action. Disconnecting cannot remove the final login method.

Connections creates a personal key with explicit scope (`queries:read`), audience (`{origin}/api/v1` and/or `{origin}/mcp`) and expiry. Copy its raw value once; closing the panel removes it from the UI, and it is never stored in browser storage. Revoke keys and OAuth grants from the same page. Only cookie sessions can manage connections, clients and consent.

Domain operations are `compile_query`, `inspect_query`, `extract_terms`. API calls use `POST /api/v1/{operation}`, JSON arguments and `Authorization: Bearer <key-or-access-token>`; `/api/v1/openapi.json` describes the fixed schemas. No caller-supplied destination URL or identity header is supported. MCP uses Streamable HTTP at `/mcp`, negotiated version **2026-07-28**, discovery and normal SDK tool calls (no custom initialize payload). OAuth clients discover metadata, use authorization code + PKCE S256, exact resource/audience and the native immutable consent form; administrators register approved client redirect URIs in Connections. Public dynamic registration is disabled by default; set `ACCESS_DYNAMIC_CLIENT_REGISTRATION=true` only when needed. Admin registration remains available.

Usage shows real UTC daily counts for 7/30/90 days, outcomes, transports and pending attempts. A real domain operation records one attempt across API/MCP; discovery, management and rejected credentials do not inflate usage. Detailed audit retention is 90 days. Event payloads omit raw keys, tokens and domain arguments/results. Legacy HTTP spans record method and matched route patterns; access routes and internal dispatch avoid payload tracing.

![Personal key metadata after the raw value was closed](docs/images/access-01.png)
![Actual local API and MCP usage](docs/images/access-02.png)
![Native OAuth consent](docs/images/access-03.png)

[First-login browser, Docker and security verification](docs/first-login-verification.md) includes fresh empty-database captures:

![First-entry administrator creation in Compiler Foundry](docs/images/first-login-light-1440.png)

[Registration and administrator review verification](docs/registration-verification.md) records the registration browser checks and capture provenance.

![Administrator review of a real pending member application](docs/images/registration-review-light-1440.png)

[Mobile dark account review](docs/images/registration-review-dark-390.png)

These are real local workflows with synthetic domain data and the feature-gated loopback provider, including signed Google OIDC verification. They do not claim live provider registration. [Access verification and reproduction](docs/access-verification.md) records tests, screenshot provenance and remaining deployment checks.
