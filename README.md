s3uploader
==========

A brief Sinatra app to allow users to send large files to you.

Relevant Configuration Variables
================================

## S3

* `S3_BUCKET_NAME`: The name of the bucket you want the files to be uploaded into.
* `S3_ACCESS_KEY`: The Access Key with read/write access to the bucket.
* `S3_SECRET_KEY`: The Secret Key with read/write access to the bucket.
* `S3_HOSTNAME`: The hostname (S3 region). Defaults to 's3.amazonaws.com'; valid values can be found [here](http://docs.aws.amazon.com/general/latest/gr/rande.html#s3_region).

## Frontend

* `HTTP_BASIC_PASSWORD`: Optional. If defined, will enable basic HTTP authentication.

Setup
=====

1. Make a new bucket.
2. Apply the attached [CORS policy](crossdomain.xml) to the bucket.
3. [Make a new IAM user and give it read/write access to the bucket.](http://keita.flagship.cc/2013/07/amazon-iam-policy-s3-bucket/)
4. Setup the configuration variables.