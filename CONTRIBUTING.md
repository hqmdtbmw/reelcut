# Contributing to reelcut

Thanks for wanting to help. reelcut is early and there is a lot to do. This file is how we work.

## How to help

- Pick an open issue, or open one describing a real problem you hit while editing a video.
- Small, focused pull requests are best. One change per PR.
- Good first areas: more agent commands, better caption handling, export quality, tests for edge cases, docs that are wrong or unclear.

## Running it

```bash
cd web
npm install
npm run dev
```

Run the tests before you open a PR:

```bash
cd web && npm test
cd core && cargo test
```

If you changed the Rust core, rebuild the WebAssembly module too:

```bash
cd core
wasm-pack build --target web --out-dir ../web/src/wasm --out-name reelcut-core
```

## Code review

Every pull request is reviewed by a human before it merges. Expect comments, and expect to revise. A few things reviewers look for:

- The change solves a real editing problem, not a hypothetical one.
- Tests cover the new behaviour. If the change has logic, it has a test.
- The interface stays minimal. A new button needs a good reason to exist.
- Words stay plain. No marketing language in the UI, the README or the code comments.
- No em dashes anywhere in the code, comments, docs or UI text. Use a comma, a period or a colon instead.

## Style

- Rust: run `cargo fmt` and `cargo clippy` before you push.
- JavaScript: plain, readable code. Short functions. No clever tricks that need a comment to explain.
- Commit messages read like a person wrote them after doing the work, short and lowercase: "fix the fade on short clips", "add a test for split at the end". Never task-style messages, never "feat:" or "chore:" prefixes.
- If a change touches the timeline engine, change the Rust core first and mirror it in `web/src/timeline.js`, with tests on both sides.

## Reporting bugs

Open an issue with what you did, what you expected, and what happened instead. A short video of the problem helps more than a long description. Include your browser and operating system.
