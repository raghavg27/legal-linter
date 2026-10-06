import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({});

export async function presignUpload(key: string) {
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: 'public-media', Key: key }), { expiresIn: 300 });
}
