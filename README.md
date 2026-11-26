![es-keyword-query compiler pipeline](docs/images/cover.svg)

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

[Browse the offline field reference](docs/index.html) · [API docs: `cargo doc --open`](#development)

![Reference page with verified compilation examples](docs/images/reference-desktop.png)

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

The responsive [field reference](docs/index.html) opens directly in a browser,
requires no build or server, and displays three fixed examples covered by Rust
tests. It is a reference, not an in-browser implementation of the parser.
The [SVG cover](docs/images/cover.svg) is an editable compiler diagram.

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
