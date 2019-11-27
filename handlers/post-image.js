/* eslint-disable no-console, import/no-extraneous-dependencies, no-bitwise, consistent-return */
import AWS from 'aws-sdk';
import aws4 from 'aws4';
import axios from 'axios';

const kms = new AWS.KMS({ apiVersion: '2014-11-01' });
const s3 = new AWS.S3({ apiVersion: '2006-03-01' });
const lambda = new AWS.Lambda({ apiVersion: '2015-03-31' });

const secretNames = [
  'TARGET_AWS_KEY',
  'TARGET_AWS_SECRET',
];

const {
  TARGET_API_HOST,
  TARGET_API_PATH,
  TARGET_API_REGION,
  LAMBDA_FUNCTION_ARN_RESIZE,
  S3_BUCKET_NAME_IMAGES,
  // // These are present but we don't need the constants
  // TARGET_AWS_KEY_ENCRYPTED,
  // TARGET_AWS_SECRET_ENCRYPTED,
} = process.env;

let secrets;
let decryptPromise;

async function decryptSecrets() {
  return new Promise(async (resolve) => {
    if (secrets) resolve(secrets);

    const allSecrets = await Promise.all(
      secretNames.map((secretName => new Promise(async (resSingle) => {
        const envVar = `${secretName}_ENCRYPTED`;
        const encryptedSecret = process.env[envVar];
        const decryptResult = await kms.decrypt({
          CiphertextBlob: Buffer.from(encryptedSecret, 'base64'),
        }).promise();

        const decrypted = decryptResult.Plaintext.toString();
        const result = {};
        result[secretName] = decrypted;
        resSingle(result);
      }))),
    );

    secrets = Object.assign({}, ...allSecrets);

    resolve(secrets);
  });
}

export const handler = async (event) => {
  const s3Payload = JSON.parse(event.Records[0].body);

  if (s3Payload.Event && s3Payload.Event === 's3:TestEvent') {
    return `Skipping test event: ${JSON.stringify(s3Payload)}`;
  }

  if (s3Payload.Records.length !== 1) {
    throw new Error('Expected exactly 1 S3 event record!');
  }

  if (!decryptPromise && !secrets) decryptPromise = decryptSecrets();

  const s3Event = s3Payload.Records[0].s3;
  console.log(`S3 event record: ${JSON.stringify(s3Event)}`);

  const {
    bucket: { name: bucketName },
    object: {
      key: objectKey,
      size: objectSizeInBytes,
      versionId: objectVersionId,
    },
  } = s3Event;

  if (bucketName !== S3_BUCKET_NAME_IMAGES) {
    throw new Error(`S3 event bucket name invalid. Expected ${S3_BUCKET_NAME_IMAGES}, saw ${bucketName}!`);
  }

  const archiveKey = objectKey.replace('images/', 'images-archive/');

  const fileExt = objectKey.slice((objectKey.lastIndexOf('.') - 1 >>> 0) + 2);

  if (!objectKey.startsWith('images/') || !(fileExt === 'png' || fileExt === 'jpg' || fileExt === 'jpeg')) {
    // The S3 bucket events should be configured with a filter, but just in case...
    return `S3 object is not a valid image file (${objectKey}). Skipping.`;
  }

  console.log(`Processing ${S3_BUCKET_NAME_IMAGES}/${objectKey} from S3`);

  const s3Params = {
    Bucket: S3_BUCKET_NAME_IMAGES,
    Key: objectKey,
  };

  if (objectSizeInBytes > 5000000) { // 5Mb
    console.log(`Image is larger than 5Mb (${objectSizeInBytes}). Resizing and compressing...`);

    const lambdaResp = await lambda.invoke({
      FunctionName: LAMBDA_FUNCTION_ARN_RESIZE,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify({
        getObjectParams: {
          ...s3Params,
          VersionId: objectVersionId,
        },
      }),
    }).promise();

    const result = JSON.parse(lambdaResp.Payload);

    if (result.VersionId) {
      // resize was successful, a new event will be triggered
      return;
    }

    console.log(lambdaResp);

    throw new Error('Resize failed');
  }

  let s3Obj;
  try {
    s3Obj = await s3.getObject(s3Params).promise();
  } catch (e) {
    if (e.code === 'NoSuchKey') {
      // check if this key is already archived

      try {
        await s3.headObject({ ...s3Params, Key: archiveKey }).promise();

        return 'Object is missing but a matching object exists in the archive. Skipping.';
      } catch (e2) {
        // throw original exception
      }
    }

    console.log(s3Params);
    console.log(e);
    throw e;
  }

  const metaData = s3Obj.Metadata;
    const path = `${TARGET_API_PATH}/image`;

    secrets = secrets || await decryptPromise;

    const signedRequest = aws4.sign({
      host: TARGET_API_HOST,
      url: `https://${TARGET_API_HOST}${path}`,
      service: 'execute-api',
      path,
      method: 'POST',
      data: s3Obj.Body,
      body: s3Obj.Body,
      headers: {
        'Content-Type': s3Obj.ContentType,
        'Content-Length': s3Obj.ContentLength,
      },
    }, {
      accessKeyId: secrets.TARGET_AWS_KEY,
      secretAccessKey: secrets.TARGET_AWS_SECRET,
      region: TARGET_API_REGION,
    });

    delete signedRequest.headers.Host;
    delete signedRequest.headers['Content-Length'];

    let resp;
    try {
      resp = await axios(signedRequest);
    } catch (err) {
      if (err.response) {
        console.log(`Target API response from ${TARGET_API_HOST} (${err.response.status}): ${JSON.stringify(err.response.data)}`);
      }

      throw err;
    }

  console.log(`Target API response from ${TARGET_API_HOST} (${resp.status}): ${JSON.stringify(resp.data)}`);

  console.log(`Archiving ${objectKey} to ${archiveKey}`);

  await s3.copyObject({
    Bucket: S3_BUCKET_NAME_IMAGES,
    CopySource: `${S3_BUCKET_NAME_IMAGES}/${objectKey}`,
    Key: archiveKey,
  }).promise();

  await s3.deleteObject(s3Params).promise();
};
