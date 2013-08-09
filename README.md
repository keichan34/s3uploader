s3uploader
==========

A brief Sinatra app to allow users to send large files to you. When I say large, I mean large. S3 supports up to 5 terabyte files, but I don't think many browsers will allow that.

### Features

* Pause / resume uploads on the fly.
* Recoverable: resilient to browser crashes / computer shutdowns, etc.
* Multiple files.
* Directly to S3.

### Limitations

* The minimum chunk size for S3 is 5 megabytes, so files under 5 megabytes cannot be uploaded.

Relevant Configuration Variables
================================

## S3

* `S3_BUCKET_NAME`: The name of the bucket you want the files to be uploaded into.
* `S3_ACCESS_KEY`: The Access Key with read/write access to the bucket.
* `S3_SECRET_KEY`: The Secret Key with read/write access to the bucket.
* `S3_HOSTNAME`: The hostname (S3 region). Defaults to 's3.amazonaws.com'; valid values can be found [here](http://docs.aws.amazon.com/general/latest/gr/rande.html#s3_region).

## Frontend

* `HTTP_BASIC_PASSWORD`: Optional. If defined, will enable basic HTTP authentication.

Dependencies
============

* jQuery
* Underscore.js

Setup
=====

1. Make a new bucket.
2. Apply the attached [CORS policy](crossdomain.xml) to the bucket.
3. [Make a new IAM user and give it read/write access to the bucket.](http://keita.flagship.cc/2013/07/amazon-iam-policy-s3-bucket/)
4. Setup the configuration variables.

Changelog
=========

## Version 2.0

* Complete rewrite based on [resumable.js](https://github.com/23/resumable.js/); uses the [S3 Multipart API](http://docs.aws.amazon.com/AmazonS3/latest/dev/uploadobjusingmpu.html) to upload files.

## Version 1.1

* Re-release under the MIT license.

## Version 1.0

* Initial release
