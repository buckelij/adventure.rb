# adventure.rb

AI Generated.

Write and run Ruby in your browser, in the spirit of [TryRuby](https://github.com/ruby/TryRuby).
The editor sits on the left and an interactive terminal on the right. Everything is a static site
powered by [ruby.wasm](https://github.com/ruby/ruby.wasm) (CRuby 3.4 compiled to WebAssembly).

- **Default example**: choose Mordor or The Shire in a beginner-friendly text adventure.
  A built-in `Pictures` class provides placeholder ASCII art through `MOUNTAIN_SCENE`,
  `BEACH_SCENE`, `DRAGON`, and `SEA_DRAGON`; no import is needed.
- **▶ Run** (Ctrl/⌘ + Enter) runs `main.rb` in a fresh Ruby VM. When it finishes, the terminal
  becomes an `irb`-style REPL where the program's top-level variables and methods are still available.
- **Interactive input**: `gets`, `STDIN.gets`, `$stdin.each_line`, `readline` and similar pause the
  program and wait for you to type in the terminal. Ctrl-D sends EOF (`gets` returns `nil`).
- **■ Stop** (or Ctrl-C) kills a runaway program, and ↺ **Reset** starts a fresh VM.
- **Your code lives in the URL**: the address bar updates as you type (without adding back-button
  entries), so reopening an accidentally closed tab brings your work back. **Share** copies that link.
  Code is deflate-compressed and base64url-encoded (`#z=…`); plain `#code=…` links also work.
- `sleep`, ANSI colors and `warn`/`$stderr` are supported.

## How it works

Ruby runs inside a Web Worker ([`site/ruby-worker.js`](site/ruby-worker.js)) so the page stays
responsive and a stuck program can be terminated. [`site/prelude.rb`](site/prelude.rb) replaces
`$stdin`/`Kernel#gets` with versions that call a JavaScript function returning a Promise, and
`JS::Object#await` suspends the Ruby VM (via Asyncify) until the terminal sends the line back.
No `SharedArrayBuffer` or cross-origin isolation headers are needed, so it works on GitHub Pages.

## Development

```sh
cd site && python3 -m http.server 8000
# open http://localhost:8000
```

Run the tests for the Ruby prelude (uses a stub of ruby.wasm's `js` library, so plain CRuby 3.4 works):

```sh
ruby test/prelude_test.rb
node --test test/examples_test.js
```

## Deployment

The [Pages workflow](.github/workflows/pages.yml) publishes the `site/` folder on every push to
`main`. In the repository settings, go to **Pages** and set **Source** to **GitHub Actions**.
