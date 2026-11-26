# Compiler atlas implementation plan

Goal: make the Rust compiler's structure explorable without pretending a static page runs arbitrary Rust code.

The atlas uses a deep ocean drafting canvas, fine coordinate lines, mint and coral clauses, a tree inspection surface and a sequential compiler rail. Visitors choose finite verified specimens, switch precise/raw output, inspect a clause, and compose a grouped filter. A CLI example compiles arbitrary local input. The page explicitly labels its finite dataset and runs offline.

Architecture: `Query::clauses()` exposes a flat preorder view of the existing AST with parent indices, original joiners, direct negation, resolved phrase slop and compiled fragments. It does not infer Boolean precedence or execute a search. `examples/inspect.rs` emits JSON; `examples/build_atlas.rs` writes the verified fixture data used by the dependency-free browser page. JSON is a development dependency only. The same crate source is vendored into Keyword Vault.

- [x] Add failing Rust tests for hierarchy, joiners, exclusions, escaped terms and configured slop.
- [x] Implement the inspection API and CLI; mirror source/tests to Keyword Vault.
- [x] Generate fixture data from Rust; implement selectable specimens, stage rail, focused clauses, mode/filter controls, copy/export, and light/dark controls.
- [x] Run Rust tests, format, Clippy, rustdoc and fixture freshness checks.
- [x] Run real Chrome desktop/mobile/dark interactions and update screenshots and README.
- [x] Review the final diff, commit, push and create a PR without merging.

Validation must verify displayed outputs against generated Rust data. The graph represents written grouping and order, not search-engine precedence or result counts. The finite specimens keep the graph readable; arbitrary expressions and their complete inspection data are available through the CLI.

## Verification results

- Rust: 16 integration tests and one doctest pass. Format, Clippy with warnings denied and rustdoc pass.
- Generated fixture freshness: `cargo run --example build_atlas -- --check` passes and is part of CI.
- Chrome opens the actual page using `file://`: all 8 specimens, both output modes, 14 grouped filter outputs, stage switching, clause selection and JSON download pass.
- Widths 320, 390, 768, 1024 and 1440 have no document overflow. Dark/light screenshots are real captures from `docs/capture-reference.py`.
- No browser parser is duplicated. Arbitrary local input is supported by the Rust CLI; the browser is explicitly limited to the generated specimens.
- The CLI and example generator use a development-only JSON dependency. Library source/tests match the Keyword Vault vendored copy.
