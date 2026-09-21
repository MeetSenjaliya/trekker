import { describe, expect, it, vi } from 'vitest'
import { authorizeUpload, bucketFor, objectKey, sniffImageType, type RpcCheck } from './uploadRules'

const uid = '00000000-0000-4000-8000-00000000a001'
const companyId = '00000000-0000-4000-8000-0000000c0001'
const trekId = '00000000-0000-4000-8000-0000000e0001'

describe('objectKey', () => {
  // Same layout Supabase Storage used, so copied and new objects interleave
  // under one prefix and the URL rewrite in Part 3 is a single replace().
  it('keys avatars and review photos under the caller, never under an id from the request', () => {
    expect(objectKey('avatar', { companyId }, uid, 'jpeg', 1700000000000, 'abcdef')).toBe(
      `avatars/${uid}/1700000000000-abcdef.jpg`,
    )
    expect(objectKey('review', {}, uid, 'png', 1, 'ffffff')).toBe(`trek-reviews/${uid}/1-ffffff.png`)
  })

  it('keys company images under the company, covers with the cover- prefix', () => {
    expect(objectKey('company-logo', { companyId }, uid, 'webp', 1, '000000')).toBe(
      `company-logos/${companyId}/1-000000.webp`,
    )
    expect(objectKey('company-cover', { companyId }, uid, 'jpeg', 1, '000000')).toBe(
      `company-logos/${companyId}/cover-1-000000.jpg`,
    )
  })

  it('keys trek covers under company then trek', () => {
    expect(objectKey('trek-cover', { companyId, trekId }, uid, 'png', 1, '123456')).toBe(
      `trek-images/${companyId}/${trekId}/1-123456.png`,
    )
  })

  it('maps every kind to a bucket', () => {
    expect(bucketFor('avatar')).toBe('avatars')
    expect(bucketFor('review')).toBe('trek-reviews')
    expect(bucketFor('company-logo')).toBe('company-logos')
    expect(bucketFor('company-cover')).toBe('company-logos')
    expect(bucketFor('trek-cover')).toBe('trek-images')
  })
})

describe('sniffImageType', () => {
  const bytes = (...b: number[]) => new Uint8Array(b)
  const ascii = (s: string) => new Uint8Array(s.split('').map((c) => c.charCodeAt(0)))

  it('recognises JPEG, PNG and WebP by their magic bytes', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe('jpeg')
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe('png')
    expect(sniffImageType(ascii('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp')
  })

  it('rejects SVG, HTML and GIF regardless of extension or declared type', () => {
    expect(sniffImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull()
    expect(sniffImageType(ascii('<!doctype html><script>'))).toBeNull()
    expect(sniffImageType(ascii('GIF89a'))).toBeNull()
  })

  it('rejects a RIFF container that is not WebP, and truncated buffers', () => {
    expect(sniffImageType(ascii('RIFF\0\0\0\0WAVEfmt '))).toBeNull()
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull()
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull()
    expect(sniffImageType(new Uint8Array(0))).toBeNull()
  })
})

describe('authorizeUpload', () => {
  const rpcAnswering = (answers: Record<string, boolean>): RpcCheck =>
    vi.fn(async (fn: string) => answers[fn] ?? false)

  it('lets anyone signed in upload an avatar or review photo without asking the database', async () => {
    const rpc = rpcAnswering({})
    expect(await authorizeUpload('avatar', {}, rpc)).toBe(true)
    expect(await authorizeUpload('review', {}, rpc)).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })

  // company-logos policy: is_company_member(c) AND is_company_writable(c).
  it.each(['company-logo', 'company-cover'] as const)(
    '%s needs membership of a writable company',
    async (kind) => {
      expect(
        await authorizeUpload(kind, { companyId }, rpcAnswering({ is_company_member: true, is_company_writable: true })),
      ).toBe(true)
      expect(
        await authorizeUpload(kind, { companyId }, rpcAnswering({ is_company_member: false, is_company_writable: true })),
      ).toBe(false)
      expect(
        await authorizeUpload(kind, { companyId }, rpcAnswering({ is_company_member: true, is_company_writable: false })),
      ).toBe(false)
      expect(await authorizeUpload(kind, {}, rpcAnswering({ is_company_member: true, is_company_writable: true }))).toBe(
        false,
      )
    },
  )

  it('asks the membership question about the companyId supplied, nothing else', async () => {
    const rpc = rpcAnswering({ is_company_member: true, is_company_writable: true })
    await authorizeUpload('company-logo', { companyId }, rpc)
    expect(rpc).toHaveBeenCalledWith('is_company_member', { p_company_id: companyId })
    expect(rpc).toHaveBeenCalledWith('is_company_writable', { p_company_id: companyId })
  })

  // trek-images policy: is_approved_company_member(c) — a pending company can
  // set a logo but not publish trek imagery.
  it('trek-cover needs an approved company and both ids', async () => {
    expect(
      await authorizeUpload('trek-cover', { companyId, trekId }, rpcAnswering({ is_approved_company_member: true })),
    ).toBe(true)
    expect(
      await authorizeUpload('trek-cover', { companyId, trekId }, rpcAnswering({ is_approved_company_member: false })),
    ).toBe(false)
    expect(
      await authorizeUpload('trek-cover', { companyId }, rpcAnswering({ is_approved_company_member: true })),
    ).toBe(false)
    expect(await authorizeUpload('trek-cover', { trekId }, rpcAnswering({ is_approved_company_member: true }))).toBe(
      false,
    )
  })

  it('does not accept a company that is merely a member of, but frozen, for a trek cover', async () => {
    // is_company_member + is_company_writable saying yes is the company-logos
    // rule; it must not leak into the trek-images decision.
    expect(
      await authorizeUpload(
        'trek-cover',
        { companyId, trekId },
        rpcAnswering({ is_company_member: true, is_company_writable: true, is_approved_company_member: false }),
      ),
    ).toBe(false)
  })
})
