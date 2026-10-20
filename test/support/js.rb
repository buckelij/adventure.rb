# Minimal stand-in for ruby.wasm's `js` library so site/prelude.rb can be
# loaded and tested with a regular CRuby.
module JS
  class Value
    def initialize(value) = @value = value
    def await = self
    def typeof = @value.is_a?(String) ? "string" : "object"
    def to_s = @value.to_s
  end

  class FakeGlobal
    attr_reader :calls, :input

    def initialize
      @calls = []
      @input = []
    end

    def call(name, *args)
      @calls << [name, *args]
      case name
      when :__rubyReadLine then Value.new(@input.shift)
      when :__rubySleep then Value.new(nil)
      else raise ArgumentError, "unexpected JS call: #{name}"
      end
    end
  end

  def self.global = (@global ||= FakeGlobal.new)
end
