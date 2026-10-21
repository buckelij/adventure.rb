window.EXAMPLES = [
  {
    name: "Mordor or The Shire",
    code: `# puts - put words on the screen
# gets - get words from the keyboard
# =    - remember a value (a number or words)
# ==   - compare two values
# if   - do something when two values are the same

# Pictures is available by default.

loop do
  puts "Welcome to my game. Try to do it if you dare!"
  puts "Do you want to go to 'Mordor' or 'The Shire'?"

  location = ""

  answer = gets.chomp
  if answer == "Mordor"
    location = "Mordor"
    puts Pictures::MOUNTAIN_SCENE
    puts "Put the ring in the volcano"
  elsif answer == "The Shire"
    location = "The Shire"
    puts Pictures::BEACH_SCENE
    puts "Make a hobbit house"
  else
    puts "That's not an option!"
  end

  if location == "Mordor"
    puts "Do you want to fight the orcs?"
    answer = gets.chomp
    puts "Great! Except it's dragon time."
    puts Pictures::DRAGON
    puts "The dragon says 'What's the password'?"
    password = "dragon party time"
    answer = gets.chomp
    if answer == password
      puts "You may pass"
    else
      puts "Wrong! You must run!"
    end
  end

  if location == "The Shire"
    puts "Do you want to play with the hobbits?"
    answer = gets.chomp
    puts "#{answer}? Either way, a river dragon wants to play."
    puts Pictures::SEA_DRAGON
  end

  coinflip = ""
  coin = rand(2)
  if coin == 0
    coinflip = "HEADS"
  else
    coinflip = "TAILS"
  end
  puts "Time to flip a coin: #{coinflip}"

  puts "THE END"
  puts "Play again? yes/no"
  answer = gets.chomp
  if answer == "no"
    exit
  end
end
`,
  },
  {
    name: "Text adventure",
    code: `# A tiny text adventure. Press Run, then type commands in the terminal.
ROOMS = {
  hall:    { desc: "You are in a dusty hall. Doors lead north and east.",
             exits: { "north" => :library, "east" => :kitchen } },
  library: { desc: "Shelves of crumbling books surround you. A brass key glints on a desk.",
             exits: { "south" => :hall }, item: "key" },
  kitchen: { desc: "A cold kitchen. A locked door is set into the east wall.",
             exits: { "west" => :hall, "east" => :garden } },
  garden:  { desc: "Sunlight! You have escaped into an overgrown garden.", exits: {} },
}

print "What is your name, adventurer? "
name = gets&.chomp
name = "stranger" if name.nil? || name.empty?
puts "Welcome, #{name}! Type 'help' for commands."

room = :hall
inventory = []

loop do
  puts
  puts ROOMS[room][:desc]
  if room == :garden
    puts "\\e[32mYou win, #{name}!\\e[0m"
    break
  end

  print "> "
  input = gets
  break puts("\\nFarewell!") if input.nil?
  verb, noun = input.strip.downcase.split(" ", 2)

  case verb
  when "go"
    target = ROOMS[room][:exits][noun]
    if target == :garden && !inventory.include?("key")
      puts "The door is locked."
    elsif target
      room = target
    else
      puts "You can't go that way."
    end
  when "take"
    if ROOMS[room][:item] == noun
      inventory << ROOMS[room].delete(:item)
      puts "Taken: #{noun}."
    else
      puts "There is no #{noun} here."
    end
  when "inventory", "i"
    puts inventory.empty? ? "You carry nothing." : "You carry: #{inventory.join(", ")}"
  when "help"
    puts "Commands: go <direction>, take <item>, inventory, quit"
  when "quit"
    puts "Farewell, #{name}!"
    break
  else
    puts "I don't understand '#{input.strip}'."
  end
end
`,
  },
  {
    name: "Hello, name",
    code: `print "What's your name? "
name = gets.chomp
puts "Hello, #{name}! 👋"

print "How old are you? "
age = gets.to_i
puts "In ten years you'll be #{age + 10}."
`,
  },
  {
    name: "Number guessing",
    code: `secret = rand(1..100)
puts "I'm thinking of a number between 1 and 100."

1.step do |tries|
  print "Guess ##{tries}: "
  guess = gets&.to_i or break
  if guess < secret
    puts "Too low!"
  elsif guess > secret
    puts "Too high!"
  else
    puts "You got it in #{tries} tries! 🎉"
    break
  end
end
`,
  },
  {
    name: "Countdown with sleep",
    code: `5.downto(1) do |i|
  puts "#{i}..."
  sleep 1
end
puts "\\e[1;33mLiftoff! 🚀\\e[0m"
`,
  },
  {
    name: "Classes & blocks",
    code: `class Greeter
  def initialize(greeting) = @greeting = greeting

  def greet(*names)
    names.map { |name| "#{@greeting}, #{name}!" }
  end
end

greeter = Greeter.new("Hello")
puts greeter.greet("Matz", "world")

# After running, try this in the terminal:
#   greeter.greet("you")
`,
  },
];
