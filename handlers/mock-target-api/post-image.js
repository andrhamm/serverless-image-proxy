/* eslint-disable no-console, import/no-extraneous-dependencies */
import AWS from 'aws-sdk';

const s3 = new AWS.S3({ apiVersion: '2006-03-01' });

const {
  S3_BUCKET_NAME_IMAGES,
} = process.env;

export const handler = async (event) => {
  const contentType = event.headers['Content-Type'] || event.headers['content-type'];
  const contentLength = event.headers['Content-Length'] || event.headers['content-length'];
  const ext = contentType.endsWith('png') ? '.png' : '.jpg';

  const image = Buffer.from(event.body, 'base64');
  const s3Resp = await s3.upload({
    Bucket: S3_BUCKET_NAME_IMAGES,
    Body: image,
    Key: `images-testing/${event.requestContext.requestId}${ext}`,
    ContentType: contentType,
    ContentLength: contentLength,
  }).promise();

  const response = {
    statusCode: 200,
    body: JSON.stringify({
      ...s3Resp,
    }),
  };

  return response;
};
/* eslint-enable no-console, import/no-extraneous-dependencies */
