# serverless-image-proxy

A serverless service for forwarding (POSTing) an matching S3 object to an HTTP API. Images are resized if necessary.

## Overview

### `postImage`

This Lambda function is triggered by `ObjectCreated` events in the associated S3 Bucket which are queued to the SQS queue for processing and better observability. The Lambda sends the S3 object (an uploaded photo) to the target API.

### `resize`

This Lambda function is invoked by the `postImage` Lambda function when the S3 event indicates that the object is larger than 5Mb. The `resize` function is invoked synchronously and compresses and resizes the image *in-place* in S3. The S3 bucket has versioning enabled in order to preserve the original image data, but the original file name is used. After `resize` is invoked, the `postImage` function exits successfully because the call to `putObject` in the `resize` function will result in a new S3 notification event for the same object key. This is done in order to simplify the logic in `postImage`.

### Layer: `sharp`

This is a layer that provides the [Sharp](https://github.com/lovell/sharp) package and its dependencies and native extensions. This package presents a challenge because it must be built in an environment that matches the platform and architecture of the Lambda environment. See notes in the development section below for maintenance details.

---

## Deployment

NOTE: See the notes on the `NPM Install` section below! The `sharp` Lambda Layer must be compiled before deployment starts!

Take care to use the correct AWS Credential "profile". By default, this service assumes you have the credentials set in `~/.aws/credentials` with the profile name equal to that environment's AWS Account Name (`staging`). If your profiles are named differently, be sure to use the `--profile` argument.

Note: Run these commands in the `serverless` directory

    serverless deploy --stage [stage|prod]

Specify profile override

    serverless deploy --stage stage --profile staging

---

## Logs

Logs are located in CloudWatch Logs. They can be viewed from your browser via the AWS Console:

* [`prefix=/aws/lambda/serverless-image-proxy-*`](https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logs:prefix=/aws/lambda/serverless-image-proxy-)

You can interactively tail the logs for a given Lambda function by using the Serverless command line tools like so:

    serverless logs -f <functionName> -t

i.e.

    serverless logs -f postImage -t

---

## Development

### NPM Install

One of the package dependencies for the `resize` function, [Sharp](https://github.com/lovell/sharp), must be [compiled specially](http://sharp.pixelplumbing.com/en/stable/install/#aws-lambda) for the Lambda environment. We use a Lambda Layer to avoid conflicts with the node_modules for local development.

    # with docker running...
    npm run layer:sharp
    
    # now layer/nodejs/node_modules should contain the sharp package and its dependencies

Now you can deploy the service.

### Invoke a function locally

NOTE: Run these commands in the `serverless` directory

Lambdas can be invoked locally as long as your local environment has AWS credentials with the required IAM roles and permissions. Invoke locally and optionally specify event data like so:

    serverless invoke local -f postImage -d '{"foo":"bar"}'

For more advanced options when invoking locally, see the [Serverless Doc: Invoke Local](https://serverless.com/framework/docs/providers/aws/cli-reference/invoke-local/)

### Secrets with KMS

On the initial deploy, you must first comment out the `awsKmsKeyArn` property in `serverless.yml`. Once the first deploy is finished, go to the [Encryption Keys section of the IAM Dashboard in the AWS Console](https://console.aws.amazon.com/iam/home?region=us-east-1#/encryptionKeys/us-east-1) and copy the ARN for the `loyalty-api-events-secrets`. Update the value of the `aws-kms-key-arn-secrets` property (with the copied ARN) in the appropriate config file (i.e. `config.stage.yml` for staging). Uncomment the `awsKmsKeyArn` property in `serverless.yml` and redeploy.

#### Add a new encrypted secret

The following command outputs the encrypted and base64-encoded string representation of the secret provided with the `--plaintext` option. Add the result to the function environment in `serverless.yml` and commit to source control.

    aws kms encrypt --key-id alias/loyalty-api-events-secrets --output text --query CiphertextBlob --plaintext 'mysecret'

Note: you must have the necessary IAM permission and be added to `resources.Resources.SecretsKMSKey.KeyPolicy.Statement[0].Principal.AWS` in `serverless.yml` (requires a deploy by existing user from that list).
