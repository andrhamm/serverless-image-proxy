/* eslint-disable no-console, import/no-extraneous-dependencies */
import AWS from 'aws-sdk';
// eslint-disable-next-line import/no-unresolved
import sharp from 'sharp';

const s3 = new AWS.S3({ apiVersion: '2006-03-01' });

export const handler = async (event, context, callback) => {
  const { Key: objectKey, Bucket: bucketName } = event.getObjectParams;

  if (!objectKey || !bucketName) {
    throw new Error('Missing object key or bucket name.');
  }

  const s3Params = { Key: objectKey, Bucket: bucketName };

  const s3Obj = await s3.getObject(s3Params).promise();

  const origImage = s3Obj.Body;

  let origFormat;

  if (s3Obj.ContentType === 'image/jpeg' || s3Obj.ContentType === 'image/jpg') {
    origFormat = 'jpeg';
  } if (s3Obj.ContentType === 'image/png') {
    origFormat = 'png';
  }

  // always convert to jpeg, then compress/resize, then back to orig format
  const transformer = sharp(origImage)
    .jpeg({ quality: 70 })
    .resize({ height: 2000, width: 2000, fit: 'inside' })
    .toFormat(origFormat);

  const newImage = await transformer.toBuffer();

  // overwrite image with optimized image
  const resp = await s3.putObject({
    ...s3Params,
    Body: newImage,
    ContentType: s3Obj.ContentType,
    Metadata: {
      ...s3Obj.Metadata,
      previous_version_id: s3Obj.VersionId || 'null',
      resized: (new Date()).toString(),
    },
  }).promise();

  console.log(`File size reduced from ${origImage.byteLength} bytes to ${newImage.byteLength} bytes (Object version ${resp.VersionId})`);

  callback(null, resp);
};
