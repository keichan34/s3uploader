require 'rubygems'
require 'bundler'

require 'sinatra'
require 'dotenv'

require "base64"
require 'openssl'
require 'json'

S3_HOSTNAME = ENV['S3_HOSTNAME'] || 's3.amazonaws.com'
S3_BUCKET_NAME = ENV['S3_BUCKET_NAME']
S3_ACCESS_KEY = ENV['S3_ACCESS_KEY']
S3_SECRET_KEY = ENV['S3_SECRET_KEY']

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
  mimeType = params['s3_object_type']
  expires = Time.now.to_i + 100 # PUT request to S3 must start within 100 seconds

  amzHeaders = "x-amz-acl:bucket-owner-full-control" # set the public read permission on the uploaded file
  stringToSign = "PUT\n\n#{mimeType}\n#{expires}\n#{amzHeaders}\n/#{S3_BUCKET_NAME}/#{objectName}";
  sig = CGI::escape(Base64.strict_encode64(OpenSSL::HMAC.digest('sha1', S3_SECRET_KEY, stringToSign)))

  {
    signed_request: CGI::escape("https://#{S3_HOSTNAME}/#{S3_BUCKET_NAME}/#{objectName}?AWSAccessKeyId=#{S3_ACCESS_KEY}&Expires=#{expires}&Signature=#{sig}"),
    url: "https://#{S3_HOSTNAME}/#{S3_BUCKET_NAME}/#{objectName}"
  }.to_json
end
