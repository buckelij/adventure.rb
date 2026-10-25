(() => {
  "use strict";

  const RUBY_WASM_URL = "https://cdn.jsdelivr.net/npm/@ruby/3.4-wasm-wasi@2.10.1/dist/ruby+stdlib.wasm";
  const STORAGE_KEY = "adventure.rb:code";
  const MAX_OUTPUT_CHARS = 500_000;

  const $ = (id) => document.getElementById(id);
  const ui = {
    run: $("run"),
    stop: $("stop"),
    reset: $("reset"),
    clear: $("clear"),
    share: $("share"),
    examples: $("examples"),
    status: $("status"),
    terminal: $("terminal"),
    output: $("term-output"),
    inputLine: $("term-input-line"),
    prompt: $("term-prompt"),
    input: $("term-input"),
    divider: $("divider"),
    editorPane: document.querySelector(".editor-pane"),
  };

  // ---------------------------------------------------------------------------
  // Editor
  // ---------------------------------------------------------------------------

  const editor = CodeMirror.fromTextArea($("editor"), {
    mode: "ruby",
    theme: "material-darker",
    lineNumbers: true,
    matchBrackets: true,
    indentUnit: 2,
    tabSize: 2,
    extraKeys: {
      "Ctrl-Enter": () => run(),
      "Cmd-Enter": () => run(),
      Tab: (cm) => (cm.somethingSelected() ? cm.indentSelection("add") : cm.replaceSelection("  ")),
      "Shift-Tab": (cm) => cm.indentSelection("subtract"),
    },
  });

  // URL formats: "#z=" is deflate-raw compressed UTF-8, "#code=" is plain UTF-8.
  // Both are base64url. "#code=" is the synchronous fallback (used while a tab is
  // closing, since CompressionStream is async) and keeps older links working.
  const canCompress = typeof CompressionStream === "function" && typeof DecompressionStream === "function";

  function toBase64Url(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromBase64Url(text) {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  }

  async function pipeBytes(bytes, stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  }

  const plainHash = (code) => `#code=${toBase64Url(new TextEncoder().encode(code))}`;

  async function compactHash(code) {
    const plain = plainHash(code);
    if (!canCompress) return plain;
    const compressed = `#z=${toBase64Url(await pipeBytes(new TextEncoder().encode(code), new CompressionStream("deflate-raw")))}`;
    // Deflate adds overhead, so tiny snippets can be shorter uncompressed.
    return compressed.length < plain.length ? compressed : plain;
  }

  async function codeFromHash() {
    const match = location.hash.match(/^#(z|code)=(.+)$/);
    if (!match) return null;
    try {
      let bytes = fromBase64Url(match[2]);
      if (match[1] === "z") bytes = await pipeBytes(bytes, new DecompressionStream("deflate-raw"));
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  }

  const urlWithHash = (hash) => `${location.origin}${location.pathname}${location.search}${hash}`;

  function replaceUrl(url) {
    if (url === location.href) return;
    try {
      history.replaceState(history.state, "", url);
    } catch {
      // Safari throttles replaceState; the next save will catch up.
    }
  }

  // Mirrors the code into localStorage and the current history entry's URL, so
  // reopening a closed tab (or restoring a session) brings the code back.
  // replaceState keeps edits from piling up as back-button entries.
  let saveTimer = null;
  let saveSeq = 0;
  async function persistCode() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const seq = ++saveSeq;
    const code = editor.getValue();
    localStorage.setItem(STORAGE_KEY, code);
    const url = urlWithHash(await compactHash(code));
    // Drop stale results if the code changed while compressing.
    if (seq === saveSeq) replaceUrl(url);
    return url;
  }

  editor.on("change", () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistCode, 500);
  });

  // The page may be gone before async compression finishes, so write the
  // uncompressed form synchronously first, then upgrade it if there's time.
  function flushPendingSave() {
    if (saveTimer === null) return;
    replaceUrl(urlWithHash(plainHash(editor.getValue())));
    persistCode();
  }
  window.addEventListener("pagehide", flushPendingSave);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushPendingSave());

  function loadCode(code) {
    saveSeq++;
    editor.setValue(code);
    // setValue fires "change"; this code is already saved, so cancel that save.
    clearTimeout(saveTimer);
    saveTimer = null;
    localStorage.setItem(STORAGE_KEY, code);
  }

  // Pasting a different share link into this tab only changes the hash.
  window.addEventListener("hashchange", async () => {
    const code = await codeFromHash();
    if (code !== null && code !== editor.getValue()) loadCode(code);
  });

  const codeLoaded = (async () => {
    const code = (await codeFromHash()) ?? localStorage.getItem(STORAGE_KEY) ?? window.EXAMPLES[0].code;
    loadCode(code);
    editor.clearHistory();
    await persistCode();
  })();

  ui.examples.append(new Option("Examples…", ""));
  window.EXAMPLES.forEach((example, i) => ui.examples.append(new Option(example.name, String(i))));
  ui.examples.addEventListener("change", () => {
    const example = window.EXAMPLES[Number(ui.examples.value)];
    if (example) {
      editor.setValue(example.code);
      editor.focus();
    }
    ui.examples.value = "";
  });

  ui.share.addEventListener("click", async () => {
    const url = await persistCode();
    try {
      await navigator.clipboard.writeText(url);
      flashStatus("Link copied to clipboard");
    } catch {
      flashStatus("Link is in the address bar");
    }
  });

  // ---------------------------------------------------------------------------
  // Terminal
  // ---------------------------------------------------------------------------

  const term = {
    queue: [],
    flushScheduled: false,
    sgr: { fg: null, bold: false, dim: false, italic: false, underline: false },
    chars: 0,
    lastChar: "\n",
  };

  function enqueue(text, cls) {
    term.queue.push([text, cls]);
    if (!term.flushScheduled) {
      term.flushScheduled = true;
      requestAnimationFrame(flushOutput);
    }
  }

  function flushOutput() {
    term.flushScheduled = false;
    const items = term.queue;
    if (!items.length) return;
    term.queue = [];
    for (const [text, cls] of items) writeAnsi(text, cls);
    trimOutput();
    scrollToBottom();
  }

  function sgrClasses() {
    const s = term.sgr;
    const classes = [];
    if (s.fg !== null) classes.push(`ansi-fg-${s.fg}`);
    if (s.bold) classes.push("ansi-bold");
    if (s.dim) classes.push("ansi-dim");
    if (s.italic) classes.push("ansi-italic");
    if (s.underline) classes.push("ansi-underline");
    return classes;
  }

  function applySgr(params) {
    const s = term.sgr;
    const codes = params === "" ? [0] : params.split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) Object.assign(s, { fg: null, bold: false, dim: false, italic: false, underline: false });
      else if (code === 1) s.bold = true;
      else if (code === 2) s.dim = true;
      else if (code === 3) s.italic = true;
      else if (code === 4) s.underline = true;
      else if (code === 22) s.bold = s.dim = false;
      else if (code === 23) s.italic = false;
      else if (code === 24) s.underline = false;
      else if (code >= 30 && code <= 37) s.fg = code - 30;
      else if (code >= 90 && code <= 97) s.fg = code - 90 + 8;
      else if (code === 39) s.fg = null;
      else if (code === 38 && codes[i + 1] === 5) {
        s.fg = codes[i + 2] < 16 ? codes[i + 2] : null;
        i += 2;
      } else if (code === 38 && codes[i + 1] === 2) i += 4;
      else if (code === 48 && codes[i + 1] === 5) i += 2;
      else if (code === 48 && codes[i + 1] === 2) i += 4;
    }
  }

  function writeAnsi(text, baseClass) {
    text = text.replace(/\r\n/g, "\n");
    // eslint-disable-next-line no-control-regex
    const escape = /\x1b\[([0-9;?]*)([A-Za-z])/g;
    let last = 0;
    let match;
    while ((match = escape.exec(text))) {
      appendText(text.slice(last, match.index), baseClass);
      const [, params, command] = match;
      if (command === "m") applySgr(params);
      else if (command === "J" && (params === "2" || params === "3")) clearTerminal();
      last = escape.lastIndex;
    }
    appendText(text.slice(last), baseClass);
  }

  function appendText(text, baseClass) {
    if (!text) return;
    const className = [baseClass, ...sgrClasses()].filter(Boolean).join(" ");
    const previous = ui.inputLine.previousSibling;
    if (previous && previous.nodeType === Node.ELEMENT_NODE && previous.className === className) {
      previous.firstChild.appendData(text);
    } else {
      const span = document.createElement("span");
      if (className) span.className = className;
      span.textContent = text;
      ui.output.insertBefore(span, ui.inputLine);
    }
    term.chars += text.length;
    term.lastChar = text[text.length - 1];
  }

  function trimOutput() {
    while (term.chars > MAX_OUTPUT_CHARS && ui.output.firstChild !== ui.inputLine) {
      term.chars -= ui.output.firstChild.textContent.length;
      ui.output.firstChild.remove();
    }
  }

  function writeLine(text, cls) {
    flushOutput();
    if (term.lastChar !== "\n") appendText("\n");
    appendText(`${text}\n`, cls);
    scrollToBottom();
  }

  function ensureNewline() {
    flushOutput();
    if (term.lastChar !== "\n") appendText("\n");
  }

  function clearTerminal() {
    while (ui.output.firstChild !== ui.inputLine) ui.output.firstChild.remove();
    term.chars = 0;
    term.lastChar = "\n";
  }

  function scrollToBottom() {
    ui.terminal.scrollTop = ui.terminal.scrollHeight;
  }

  function placeCaretAtEnd() {
    const range = document.createRange();
    range.selectNodeContents(ui.input);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function showInput(prompt, { focus = true } = {}) {
    flushOutput();
    ui.prompt.textContent = prompt;
    ui.input.textContent = "";
    ui.inputLine.hidden = false;
    inputHistory.index = currentHistory().length;
    scrollToBottom();
    if (focus) ui.input.focus({ preventScroll: true });
  }

  function hideInput() {
    ui.inputLine.hidden = true;
    ui.input.textContent = "";
  }

  // Commits the current input line to the transcript, like a terminal echo.
  function echoInput(text, cls) {
    appendText(ui.prompt.textContent, ui.prompt.textContent ? "prompt-echo" : "");
    appendText(`${text}\n`, cls);
  }

  const inputHistory = { repl: [], stdin: [], index: 0 };
  const currentHistory = () => (state.mode === "stdin" ? inputHistory.stdin : inputHistory.repl);

  function navigateHistory(delta) {
    const entries = currentHistory();
    const index = Math.min(Math.max(inputHistory.index + delta, 0), entries.length);
    if (index === inputHistory.index) return;
    inputHistory.index = index;
    ui.input.textContent = entries[index] ?? "";
    placeCaretAtEnd();
  }

  // ---------------------------------------------------------------------------
  // Ruby VM (runs inside a Web Worker)
  // ---------------------------------------------------------------------------

  const state = {
    module: null,
    worker: null,
    ready: null,
    mode: "loading", // loading | idle (REPL prompt) | busy | stdin
    vmUsed: false,
    replBuffer: [],
    replLine: 1,
    pendingStdin: [],
    description: "",
  };

  function setMode(mode) {
    state.mode = mode;
    const loaded = state.module !== null;
    ui.run.disabled = !loaded;
    ui.reset.disabled = !loaded;
    ui.stop.disabled = !(mode === "busy" || mode === "stdin");
    ui.status.classList.toggle("running", mode === "busy" || mode === "stdin");
    ui.status.classList.remove("error");
    ui.status.textContent = {
      loading: ui.status.textContent,
      idle: state.description ? `${state.description.split(" ").slice(0, 2).join(" ")} ready` : "Ready",
      busy: "Running…",
      stdin: "Waiting for input…",
    }[mode];
  }

  let statusTimer;
  function flashStatus(message) {
    const previous = ui.status.textContent;
    ui.status.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      if (ui.status.textContent === message) ui.status.textContent = previous;
    }, 2000);
  }

  function showError(message) {
    ui.status.textContent = message;
    ui.status.classList.add("error");
  }

  async function downloadRuby() {
    const response = await fetch(RUBY_WASM_URL);
    if (!response.ok) throw new Error(`Failed to download Ruby (HTTP ${response.status})`);
    const contentType = response.headers.get("content-type")?.split(";")[0].trim();
    if (
      response.body &&
      typeof WebAssembly.compileStreaming === "function" &&
      contentType === "application/wasm"
    ) {
      ui.status.textContent = "Downloading and compiling Ruby…";
      return WebAssembly.compileStreaming(response);
    }

    const total = Number(response.headers.get("content-length")) || 0;
    if (!response.body) return WebAssembly.compile(await response.arrayBuffer());

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      const mb = (received / 1048576).toFixed(1);
      ui.status.textContent = total
        ? `Downloading Ruby… ${Math.round((received / total) * 100)}%`
        : `Downloading Ruby… ${mb} MB`;
    }
    ui.status.textContent = "Compiling Ruby…";
    return WebAssembly.compile(await new Blob(chunks).arrayBuffer());
  }

  function startVM() {
    state.worker?.terminate();
    hideInput();
    state.mode = "loading";
    state.vmUsed = false;
    state.replBuffer = [];
    state.replLine = 1;
    state.pendingStdin = [];
    Object.assign(term.sgr, { fg: null, bold: false, dim: false, italic: false, underline: false });
    ui.stop.disabled = true;
    ui.status.classList.remove("running", "error");
    ui.status.textContent = "Starting Ruby…";

    const worker = new Worker("ruby-worker.js");
    state.worker = worker;
    state.ready = new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.type === "ready") {
          state.description = data.description;
          setMode("idle");
          resolve();
        } else if (data.type === "fatal") {
          reject(new Error(data.message));
        } else {
          handleWorkerMessage(data);
        }
      };
      worker.onerror = (event) => reject(new Error(event.message || "Ruby worker failed to start"));
    });
    state.ready.catch((error) => showError(`Ruby failed to start: ${error.message}`));
    worker.postMessage({ type: "init", module: state.module });
    return state.ready;
  }

  function handleWorkerMessage(data) {
    switch (data.type) {
      case "stdout":
        enqueue(data.text, "");
        break;
      case "stderr":
        enqueue(data.text, "stderr");
        break;
      case "stdin-request":
        flushOutput();
        if (state.pendingStdin.length) {
          const line = state.pendingStdin.shift();
          echoInput(line, "stdin-echo");
          sendStdin(`${line}\n`);
        } else {
          setMode("stdin");
          showInput("");
        }
        break;
      case "done":
        ensureNewline();
        showReplPrompt();
        break;
      case "repl-result":
        ensureNewline();
        if (data.status === "more") {
          showReplPrompt();
        } else {
          state.replLine += state.replBuffer.length;
          state.replBuffer = [];
          showReplPrompt();
        }
        break;
    }
  }

  function sendStdin(line) {
    setMode("busy");
    state.worker.postMessage({ type: "stdin", line });
  }

  function replPrompt() {
    const line = String(state.replLine + state.replBuffer.length).padStart(3, "0");
    return `irb(main):${line}${state.replBuffer.length ? "*" : ">"} `;
  }

  function showReplPrompt(options) {
    setMode("idle");
    showInput(replPrompt(), options);
  }

  function banner() {
    writeLine(`${state.description}`, "info");
    writeLine("Press ▶ Run to run main.rb, or type Ruby below.", "info");
  }

  async function run() {
    if (!state.module) return;
    const code = editor.getValue();
    localStorage.setItem(STORAGE_KEY, code);
    clearTerminal();
    if (state.vmUsed || state.mode !== "idle") {
      try {
        await startVM();
      } catch {
        return;
      }
    }
    hideInput();
    state.vmUsed = true;
    setMode("busy");
    state.worker.postMessage({ type: "run", code });
  }

  async function stop() {
    if (state.mode !== "busy" && state.mode !== "stdin") return;
    hideInput();
    writeLine("^C", "");
    writeLine("Program stopped. Started a fresh Ruby VM.", "info");
    try {
      await startVM();
      showReplPrompt();
    } catch {
      // Status already shows the error.
    }
  }

  async function reset() {
    if (!state.module) return;
    clearTerminal();
    try {
      await startVM();
      banner();
      showReplPrompt();
    } catch {
      // Status already shows the error.
    }
  }

  function submitInput() {
    const text = ui.input.textContent.replace(/\u00a0/g, " ");
    if (state.mode === "stdin") {
      const [first, ...rest] = text.split("\n");
      if (first) inputHistory.stdin.push(first);
      echoInput(first, "stdin-echo");
      hideInput();
      state.pendingStdin.push(...rest);
      sendStdin(`${first}\n`);
    } else if (state.mode === "idle") {
      if (text.trim()) inputHistory.repl.push(text);
      echoInput(text, "");
      hideInput();
      state.replBuffer.push(text);
      const code = state.replBuffer.join("\n");
      if (!code.trim()) {
        state.replLine += state.replBuffer.length;
        state.replBuffer = [];
        showReplPrompt();
        return;
      }
      // A blank line while continuing a multi-line entry forces evaluation, so
      // a syntax error can never trap the user in continuation mode.
      const force = state.replBuffer.length > 1 && !text.trim();
      state.vmUsed = true;
      setMode("busy");
      state.worker.postMessage({ type: "repl", code, lineno: state.replLine, force });
    }
  }

  // ---------------------------------------------------------------------------
  // Terminal input events
  // ---------------------------------------------------------------------------

  // plaintext-only keeps typed/pasted newlines as "\n" text instead of <br>/<div>.
  ui.input.setAttribute("contenteditable", "plaintext-only");
  if (ui.input.contentEditable !== "plaintext-only") ui.input.setAttribute("contenteditable", "true");

  ui.input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey;
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) return run();
      if (event.shiftKey) return document.execCommand("insertText", false, "\n");
      submitInput();
    } else if (ctrl && event.key.toLowerCase() === "c" && window.getSelection().isCollapsed) {
      event.preventDefault();
      if (state.mode === "stdin") {
        stop();
      } else if (state.mode === "idle") {
        echoInput(`${ui.input.textContent}^C`, "");
        state.replLine += state.replBuffer.length;
        state.replBuffer = [];
        showReplPrompt();
      }
    } else if (ctrl && event.key.toLowerCase() === "d" && ui.input.textContent === "") {
      event.preventDefault();
      if (state.mode === "stdin") {
        echoInput("^D", "info");
        hideInput();
        setMode("busy");
        state.worker.postMessage({ type: "stdin", line: null });
      }
    } else if (ctrl && event.key.toLowerCase() === "l") {
      event.preventDefault();
      clearTerminal();
    } else if (event.key === "ArrowUp" && !ui.input.textContent.includes("\n")) {
      event.preventDefault();
      navigateHistory(-1);
    } else if (event.key === "ArrowDown" && !ui.input.textContent.includes("\n")) {
      event.preventDefault();
      navigateHistory(1);
    }
  });

  ui.input.addEventListener("paste", (event) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
    document.execCommand("insertText", false, text);
  });

  // Ctrl+C anywhere stops a running program (unless the user is copying text).
  document.addEventListener("keydown", (event) => {
    const inEditor = event.target instanceof Element && event.target.closest(".CodeMirror");
    if (event.ctrlKey && event.key.toLowerCase() === "c" && state.mode === "busy" && !inEditor && window.getSelection().isCollapsed) {
      event.preventDefault();
      stop();
    }
  });

  ui.terminal.addEventListener("mouseup", () => {
    if (!ui.inputLine.hidden && window.getSelection().isCollapsed) {
      ui.input.focus({ preventScroll: true });
      if (!ui.input.contains(window.getSelection().anchorNode)) placeCaretAtEnd();
    }
  });

  ui.run.addEventListener("click", run);
  ui.stop.addEventListener("click", stop);
  ui.reset.addEventListener("click", reset);
  ui.clear.addEventListener("click", () => {
    clearTerminal();
    if (!ui.inputLine.hidden) ui.input.focus({ preventScroll: true });
  });

  // ---------------------------------------------------------------------------
  // Resizable split
  // ---------------------------------------------------------------------------

  function setSplit(percent) {
    const clamped = Math.min(Math.max(percent, 15), 85);
    ui.editorPane.style.flexBasis = `${clamped}%`;
    editor.refresh();
    return clamped;
  }

  let split = 50;
  ui.divider.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    ui.divider.setPointerCapture(event.pointerId);
    ui.divider.classList.add("dragging");
    const workspace = ui.divider.parentElement.getBoundingClientRect();
    const move = (e) => (split = setSplit(((e.clientX - workspace.left) / workspace.width) * 100));
    const up = () => {
      ui.divider.classList.remove("dragging");
      ui.divider.removeEventListener("pointermove", move);
      ui.divider.removeEventListener("pointerup", up);
    };
    ui.divider.addEventListener("pointermove", move);
    ui.divider.addEventListener("pointerup", up);
  });
  ui.divider.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") split = setSplit(split - 2);
    if (event.key === "ArrowRight") split = setSplit(split + 2);
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  (async () => {
    try {
      state.module = await downloadRuby();
      await codeLoaded;
      await startVM();
      banner();
      showReplPrompt({ focus: false });
    } catch (error) {
      showError(`Could not load Ruby: ${error.message}`);
      writeLine(`Could not load Ruby: ${error.message}`, "stderr");
    }
  })();
})();
