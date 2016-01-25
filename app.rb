require 'rubygems'
require 'bundler'

require 'sinatra'

if ENV["RACK_ENV"] == "development"
  require 'dotenv'
  Dotenv.load
end

require "base64"
require 'openssl'
require 'json'
require 'aws-sdk-resources'

S3_REGION      = ENV['S3_REGION'] || 'us-east-1'
S3_BUCKET_NAME = ENV['S3_BUCKET_NAME']
S3_ACCESS_KEY  = ENV['S3_ACCESS_KEY']
S3_SECRET_KEY  = ENV['S3_SECRET_KEY']

credentials = Aws::Credentials.new(
  S3_ACCESS_KEY,
  S3_SECRET_KEY)

set :public_folder, Proc.new { File.join(root, "public") }

use Rack::Auth::Basic, "Restricted Area" do |username, password|
  username == 'uploader' and password == ENV['HTTP_BASIC_PASSWORD']
end if ENV['HTTP_BASIC_PASSWORD']

use Rack::Static, :urls => ['/stylesheets', '/javascripts'], :root => 'public'

get '/' do
  send_file File.join(settings.public_folder, 'index.html')
end

get '/signS3put' do
  objectName = params['s3_object_name']
  client = Aws::S3::Client.new(
    region: S3_REGION,
    credentials: credentials)
  s3 = Aws::S3::Resource.new(client: client)
  obj = s3.bucket(S3_BUCKET_NAME).object(objectName)
  presignedUrl = obj.presigned_url(:put, acl: "bucket-owner-full-control")

  {
    signed_request: presignedUrl,
    url: obj.public_url
  }.to_json
end
