$LOAD_PATH.unshift File.join(__dir__, "support")
require "minitest/autorun"

real_stdin = $stdin
load File.expand_path("../site/prelude.rb", __dir__)
# The prelude swaps in the browser-backed stdin; restore the real one between tests.
$stdin = real_stdin

class PreludeTest < Minitest::Test
  def setup
    @js = JS.global
    @js.calls.clear
    @js.input.clear
    @stdin = WebRuby::Stdin.new
    @real_stdin, $stdin = $stdin, @stdin
  end

  def teardown
    $stdin = @real_stdin
  end

  def test_gets_waits_on_the_terminal_and_returns_the_line
    @js.input.push("Ada\n")
    assert_equal "Ada\n", gets
    assert_equal [[:__rubyReadLine]], @js.calls
  end

  def test_gets_supports_chomp_and_returns_nil_on_eof
    @js.input.push("hello\n", nil)
    assert_equal "hello", @stdin.gets(chomp: true)
    assert_nil @stdin.gets
  end

  def test_readline_raises_at_eof
    @js.input.push(nil)
    assert_raises(EOFError) { readline }
  end

  def test_each_line_and_readlines_read_until_eof
    @js.input.push("a\n", "b\n", nil, "c\n", "d\n", nil)
    assert_equal %w[a b], @stdin.each_line(chomp: true).to_a
    assert_equal ["c\n", "d\n"], readlines
  end

  def test_stdin_constant_is_replaced
    assert_kind_of WebRuby::Stdin, STDIN
    assert_predicate STDIN, :tty?
  end

  def test_sleep_delegates_to_js_in_milliseconds
    assert_kind_of Integer, sleep(0.25)
    assert_equal [[:__rubySleep, 250.0]], @js.calls
    assert_raises(ArgumentError) { sleep(-1) }
  end

  def test_incomplete_detects_unfinished_input
    ["def foo", "[1,", "foo(", "x = \"abc", "<<~X\nhi", "if true\n  puts 1"].each do |code|
      assert WebRuby.incomplete?(code), "expected #{code.inspect} to be incomplete"
    end
    ["1 + 1", "puts 1 end", "1 2"].each do |code|
      refute WebRuby.incomplete?(code), "expected #{code.inspect} to be complete"
    end
  end

  def test_repl_evaluates_and_prints_result
    out, = capture_io { assert_equal "done", WebRuby.repl("6 * 7", 1, false) }
    assert_equal "\e[2m=> 42\e[0m\n", out
  end

  def test_repl_asks_for_more_until_input_is_complete
    assert_equal "more", WebRuby.repl("def prelude_test_method", 1, false)
    capture_io { assert_equal "done", WebRuby.repl("def prelude_test_method\n  :ok\nend", 1, false) }
    assert_equal :ok, prelude_test_method
  end

  def test_repl_force_reports_syntax_errors_instead_of_waiting
    _, err = capture_io { assert_equal "done", WebRuby.repl("def broken(", 1, true) }
    assert_match(/\(SyntaxError\)\n\z/, err)
  end

  def test_repl_reports_exceptions
    out, err = capture_io { assert_equal "done", WebRuby.repl("undefined_thing", 3, false) }
    assert_empty out
    assert_match(/\A\(irb\):3:in .*undefined local variable or method 'undefined_thing'/, err)
  end

  def test_run_reports_errors_with_only_user_backtrace
    code = "def boom = raise(ArgumentError, 'bad')\nboom\n"
    _, err = capture_io { WebRuby.run(code, "main.rb") }
    assert_equal "main.rb:1:in 'Object#boom': bad (ArgumentError)\n\tfrom main.rb:2:in '<main>'\n", err
  end

  def test_run_treats_exit_as_normal_completion
    out, err = capture_io { WebRuby.run("puts 'bye'\nexit 1\nputs 'unreachable'", "main.rb") }
    assert_equal "bye\n", out
    assert_empty err
  end
end
