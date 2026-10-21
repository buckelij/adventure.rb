const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "site/examples.js"), "utf8"), context);
const example = context.window.EXAMPLES[0];

function play(...answers) {
  const result = spawnSync("ruby", [
    "-Itest/support", "-r./site/prelude.rb", "-e",
    'JS.global.input.concat(ARGV.drop(1).map { |line| "#{line}\\n" }); WebRuby.run(ARGV.first, "main.rb")',
    example.code, ...answers,
  ], { cwd: root, encoding: "utf8", timeout: 10_000, maxBuffer: 1_000_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Time to flip a coin: (HEADS|TAILS)\n/);
  assert.match(result.stdout, /THE END\nPlay again\? yes\/no\n/);
  return result.stdout;
}

test("the default game accepts the dragon password in Mordor", () => {
  assert.equal(example.name, "Mordor or The Shire");
  const output = play("Mordor", "yes", "dragon party time", "no");
  assert.match(output, /Put the ring in the volcano/);
  assert.match(output, /~ fire ~/);
  assert.match(output, /You may pass/);
  assert.doesNotMatch(output, /Wrong!/);
});

test("the default game rejects an incorrect dragon password", () => {
  const output = play("Mordor", "no", "wrong password", "no");
  assert.match(output, /Wrong! You must run!/);
  assert.doesNotMatch(output, /You may pass/);
});

test("the default game visits The Shire and displays the sea dragon", () => {
  const output = play("The Shire", "yes", "no");
  assert.match(output, /Make a hobbit house/);
  assert.match(output, /yes\? Either way, a river dragon wants to play/);
  assert.ok(output.includes("~~~\\_____))~~~~"));
});

test("the default game handles an unknown location", () => {
  assert.match(play("somewhere else", "no"), /That's not an option!/);
});

test("the default game can replay before exiting", () => {
  const output = play("The Shire", "yes", "yes", "Mordor", "yes", "dragon party time", "no");
  assert.equal(output.match(/Welcome to my game/g).length, 2);
  assert.match(output, /Make a hobbit house/);
  assert.match(output, /You may pass/);
});
