ENV["RACK_ENV"] ||= "development"

require './app'
run Sinatra::Application
