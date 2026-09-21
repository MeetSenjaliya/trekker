import { AwsClient } from 'aws4fetch'

// Server-only: the access keys must never reach a client bundle.

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

export function r2Client(): AwsClient {
  return new AwsClient({
    accessKeyId: required('R2_ACCESS_KEY_ID'),
    secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    service: 's3',
    region: 'auto',
  })
}

// The S3 endpoint the signed PUT goes to.
export function r2ObjectUrl(key: string): string {
  return `https://${required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${required('R2_BUCKET')}/${key}`
}

// The URL stored in the database and rendered by <Image>.
export function publicUrl(key: string): string {
  return `${required('NEXT_PUBLIC_R2_PUBLIC_URL').replace(/\/$/, '')}/${key}`
}
