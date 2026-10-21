# Loaded into the Ruby VM before any user code runs.
# Bridges Ruby's standard input, sleep, and error reporting to the browser terminal.
require "js"

$stdout.sync = true
$stderr.sync = true

class Pictures
  MOUNTAIN_SCENE = <<~'ART'
       /\
      /  \    /\
     /    \  /  \
    /______\/____\
  ART

  BEACH_SCENE = <<~'ART'
      \ | /
    -- O --
      / | \
  ~~~~~~~~~~~~~~
  ..............
  ART

  CAT = <<~'ART'
     /\
   ( o.o )
    > ^ <
  ART

  COW = <<~'ART'
   ^__^
  (o  o)
  (____)
  || ||
  ART

  FLOWER = <<~'ART'
  ⠀⠀⠀⠀⠀⢠⢄⡠⡄
  ⠀⠀⠀⠀⠀⢰⠃⠀⠀⠈⡆
  ⠀⡤⠔⠒⠢⢼⡀⢀⡀⢀⡧⠔⠒⠢⢤
  ⡂ ⠀⠀⠀⠀⠑⣘⣁⠊⣀⠀⠀  ⠘⡄
  ⠀⠑⠤⣀⣀⡠⠭⡧⡼⠩⠅⣀⣀⠤⠊
      ⡔⠁⢀⠞⢀⡇⠓⢀⠈⠳⡀
    ⢰⡁⠀⠀ ⡸⢣⠀⠀⠀ ⠀⡇
  ⠀⠀⠀⠉⠧⠔⠊⠀⠀⠙⠲⠴⠉⠁
  ART

  GIRLSCOUTS = <<~'ART'
  ............*#######*............
  .........###############.........
  .........###############*........
  .........##########.**###........
  ..###############......###.*###..
  .*#############........###*.*##*.
  .*############........*###..*###.
  .###########....*#######...*####.
  .*########*...*####........#####.
  ..########....####*...*########*.
  ...*###*...*###*...###########...
  ..........####.....####*.........
  ..........###*...*#####..........
  ..............*#####*............
  ..............*####..............
  ART

  DRAGON = <<~'ART'
                 \||/
                |  @__oo
      /\  /\   / (__,,,|
     ) /^\) ^\/ _)
     )   _ /  / _)
 /\  )/\/ ||  | )_)
<  >      |(,,) )__)
 ||      /    \)___)\
 | \____(      )___) )___
  \______(_______;;; __;;x
  ART

  SEA_DRAGON = <<~'ART'
             `- -._  - - - -.
              `.     `--.     `.
        ,...  \          `.    ,-`.,
      (,     `/   \    ,__.__`.'
     ,'  ,--.  `,   \ '
    `o, )    \  :    |
      \,,'    /  /   /
      | :    /  ,' ,-/.    ,--.
      \'   /  ,' /  _  \  /  _  \~
            `.__,'   `.__,'   `.__,'
  ART
end

module WebRuby
  INCOMPLETE_INPUT = /unexpected end-of-input|meets end of file|before EOF|to close the/

  # Suspends Ruby (via Asyncify) until the user submits a line in the terminal.
  # Returns the line including its trailing newline, or nil on EOF (Ctrl-D).
  def self.read_line
    line = JS.global.call(:__rubyReadLine).await
    line.typeof == "string" ? line.to_s : nil
  end

  class Stdin
    def gets(*args, chomp: false)
      line = WebRuby.read_line
      line = line.chomp if line && chomp
      line
    end

    def readline(*args, chomp: false)
      gets(chomp: chomp) or raise EOFError, "end of file reached"
    end

    def each_line(*args, chomp: false)
      return enum_for(:each_line, chomp: chomp) unless block_given?

      while (line = gets(chomp: chomp))
        yield line
      end
      self
    end

    alias each each_line

    def readlines(*args, chomp: false) = each_line(chomp: chomp).to_a
    def read(*) = readlines.join
    def tty? = true
    alias isatty tty?
    def fileno = 0
    def sync = true
    def sync=(value); end
    def close; end
    def closed? = false
    def external_encoding = Encoding::UTF_8
    def set_encoding(*) = self
    def inspect = "#<IO:<STDIN>>"
  end

  def self.run(code, file)
    TOPLEVEL_BINDING.eval(code, file, 1)
  rescue SystemExit
  rescue Exception => e
    report(e, file)
  ensure
    $stdout.flush
  end

  # Returns "more" when the snippet is syntactically incomplete so the
  # terminal can keep reading lines; otherwise evaluates it and returns "done".
  def self.repl(code, lineno, force)
    return "more" if !force && incomplete?(code)
    result = TOPLEVEL_BINDING.eval(code, "(irb)", lineno)
    $stdout.write("\e[2m=> #{result.inspect}\e[0m\n")
    "done"
  rescue SystemExit
    "done"
  rescue Exception => e
    report(e, "(irb)")
    "done"
  end

  def self.incomplete?(code)
    RubyVM::InstructionSequence.compile(code, "(irb)")
    false
  rescue SyntaxError => e
    e.message.match?(INCOMPLETE_INPUT)
  end

  def self.report(error, file)
    if error.is_a?(SyntaxError)
      $stderr.write("#{error.message.chomp} (SyntaxError)\n")
      return
    end

    backtrace = (error.backtrace || []).select { |l| l.start_with?(file) }
    message = error.detailed_message(highlight: false)
    lines =
      if backtrace.empty?
        [message]
      else
        ["#{backtrace.first}: #{message}", *backtrace.drop(1).map { |line| "\tfrom #{line}" }]
      end

    $stderr.write(lines.join("\n") + "\n")
  rescue Exception
    $stderr.write("#{error.class}: #{error.message}\n")
  end
end

$stdin = WebRuby::Stdin.new
Object.send(:remove_const, :STDIN)
STDIN = $stdin

module Kernel
  private

  def gets(*args, **opts) = $stdin.gets(*args, **opts)
  def readline(*args, **opts) = $stdin.readline(*args, **opts)
  def readlines(*args, **opts) = $stdin.readlines(*args, **opts)

  def sleep(seconds = nil)
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    raise ArgumentError, "time interval must not be negative" if seconds&.negative?

    JS.global.call(:__rubySleep, seconds.nil? ? -1 : (seconds * 1000).to_f).await
    (Process.clock_gettime(Process::CLOCK_MONOTONIC) - started).round
  end
end
