// Runs the ruby.wasm VM off the main thread so long-running programs never
// freeze the page and can be stopped by terminating the worker.
importScripts("https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@2.10.1/dist/browser.umd.js");

let vm = null;
let pendingInput = null;

const post = (message) => self.postMessage(message);

// Called from Ruby (`JS.global.call(:__rubyReadLine).await`). The returned
// promise suspends Ruby until the page sends a line back.
self.__rubyReadLine = () =>
  new Promise((resolve) => {
    pendingInput = resolve;
    post({ type: "stdin-request" });
  });

self.__rubySleep = (ms) => new Promise((resolve) => ms >= 0 && setTimeout(resolve, ms));

async function init(module) {
  // DefaultRubyVM routes WASI stdout/stderr to console.log/console.warn, captured
  // at creation time, so swap them in just while the VM is instantiated.
  const { log, warn } = console;
  console.log = (text) => post({ type: "stdout", text });
  console.warn = (text) => post({ type: "stderr", text });
  try {
    ({ vm } = await self["ruby-wasm-wasi"].DefaultRubyVM(module));
  } finally {
    Object.assign(console, { log, warn });
  }
  const prelude = await (await fetch("prelude.rb")).text();
  vm.eval(prelude);
  post({ type: "ready", description: vm.eval("RUBY_DESCRIPTION").toString() });
}

async function evaluate(rubyCall, input) {
  self.__rubyInput = input;
  try {
    return (await vm.evalAsync(rubyCall)).toString();
  } catch (error) {
    post({ type: "stderr", text: `${error && error.message ? error.message : error}\n` });
    return "done";
  }
}

self.onmessage = async ({ data }) => {
  switch (data.type) {
    case "init":
      try {
        await init(data.module);
      } catch (error) {
        post({ type: "fatal", message: String(error && error.message ? error.message : error) });
      }
      break;
    case "run":
      await evaluate(`WebRuby.run(JS.global[:__rubyInput].to_s, "main.rb")`, data.code);
      post({ type: "done" });
      break;
    case "repl": {
      const status = await evaluate(
        `WebRuby.repl(JS.global[:__rubyInput].to_s, ${data.lineno | 0}, ${data.force ? "true" : "false"})`,
        data.code,
      );
      post({ type: "repl-result", status });
      break;
    }
    case "stdin":
      if (pendingInput) {
        const resolve = pendingInput;
        pendingInput = null;
        resolve(data.line);
      }
      break;
  }
};
