require 'rubygems'
require 'bundler'

require 'sinatra'
require 'sinatra/namespace'

require 'dotenv'
Dotenv.load

require 'aws-sdk'

require "base64"
require 'openssl'
require 'json'

AWS_REGION = ENV['AWS_REGION']
S3_HOSTNAME = ENV['S3_HOSTNAME'] || 's3.amazonaws.com'
S3_BUCKET_NAME = ENV['S3_BUCKET_NAME']
S3_ACCESS_KEY = ENV['S3_ACCESS_KEY']
S3_SECRET_KEY = ENV['S3_SECRET_KEY']

AWS.config access_key_id: S3_ACCESS_KEY, secret_access_key: S3_SECRET_KEY, region: AWS_REGION

set :public_folder, Proc.new { File.join(root, "public") }

use Rack::Session::Cookie, :key => 's3uploader',
                           :path => '/',
                           :expire_after => 2592000,
                           :secret => (ENV['SESSION_SECRET'] || 'super duper secret')

use Rack::Auth::Basic, "Restricted Area" do |username, password|
  username == 'uploader' and password == ENV['HTTP_BASIC_PASSWORD']
end if ENV['HTTP_BASIC_PASSWORD']

use Rack::Static, :urls => ['/stylesheets', '/javascripts'], :root => 'public'

set :haml, format: :html5

get '/' do
  haml :index
end

namespace '/transfer' do

  before do
    @s3 = AWS::S3.new
    @bucket = @s3.buckets[S3_BUCKET_NAME]

    response.headers['Content-Type'] = 'application/json'
  end

  post '/initiate' do
    object_name = params['s3_object_name']
    local_identifier = params['local_identifier']
    # mimeType = params['s3_object_type']

    object = @bucket.objects[object_name]

    return [403, { error: 'object_exists' }.to_json] if object.exists?

    upload = object.multipart_upload

    session[:uploads] ||= []

    if ( existing_upload = session[:uploads].select { |e| e[:l] == local_identifier }.first )
      multipart_id = existing_upload[:i]
    else
      multipart_id = upload.id
      session[:uploads] << { n: object_name, i: multipart_id, l: local_identifier }
    end

    [200, { multipart_id: multipart_id }.to_json]
  end

  get '/signature_for_chunk' do
    multipart_id = params['current_multipart_id']
    return [404, {error: 'start_transfer_first'}.to_json] unless multipart_id

    chunk_number = params['chunk_number']
    object_name = params['object_name']

    date = Time.now
    expires = Time.now.to_i + 100

    stringToSign = "PUT\n\n\n\nx-amz-date:#{date.rfc822}\n/#{S3_BUCKET_NAME}/#{object_name}?partNumber=#{chunk_number}&uploadId=#{multipart_id}"
    sig = Base64.strict_encode64(OpenSSL::HMAC.digest('sha1', S3_SECRET_KEY, stringToSign))

    {
      multipart_id: multipart_id,
      signature: sig,
      expires: expires,
      date: date.rfc822,
      object_name: object_name,
      string_to_sign: stringToSign
    }.to_json
  end

  post '/finalize' do
    multipart_id = params['current_multipart_id']

    return [404, {error: 'start_transfer_first'}.to_json] unless multipart_id

    upload = @bucket.multipart_uploads.select { |e| e.id == multipart_id }.first

    return [404, {error: 'start_transfer_first'}.to_json] unless upload

    begin
      upload.complete *upload.parts
    rescue Exception => e
      return [500, { error: e.message }.to_json ]
    end

    # Cleanup the persistence array
    (session[:uploads] || []).reject! { |e| e[:i] == multipart_id }

    { success: true }.to_json
  end

  get '/parts' do
    multipart_id = params['current_multipart_id']
    return [404, {error: 'start_transfer_first', parts: []}.to_json] if !multipart_id or !(session[:uploads].map { |e| e[:i] }.include? multipart_id)

    upload = @bucket.multipart_uploads.select { |e| e.id == multipart_id }.first

    if !upload
      # It looks like this transfer doesn't exist anymore. Let's get rid of it.
      (session[:uploads] || []).reject! { |e| e[:i] == multipart_id }
      return [404, { error: 'start_transfer_first', parts: []}.to_json]
    end

    {
      multipart_id: upload.id,
      parts: upload.parts.map { |e| { part_number: e.part_number, etag: e.etag, size: e.size, last_modified: e.last_modified } }
    }.to_json
  end

  get '/initiated_transfers' do
    {
      uploads: (session[:uploads] || []).map { |e| { object_name: e[:n], multipart_id: e[:i], local_identifier: e[:l] } }
    }.to_json
  end

end
