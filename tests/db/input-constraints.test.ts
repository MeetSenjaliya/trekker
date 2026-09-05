import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asSuperuser, getDb, ids } from './harness'

/**
 * Value bounds, not access.
 *
 * `src/lib/schemas.ts` caps message length, name length, bio length, cost and
 * capacity — in the browser. The app writes through PostgREST with the
 * publishable key, so anything that skips the form skips those caps too. 0009
 * put the same bounds in the database; this file is what keeps them there.
 *
 * Everything runs through asSuperuser deliberately, which is the one use the
 * actor's own docs allow it for: RLS is bypassed, so a rejected INSERT can only
 * have been rejected by the CHECK. Under asUser a policy denial and a
 * constraint violation both raise, and a test that cannot tell them apart would
 * stay green if the constraint were dropped tomorrow.
 *
 * Each constraint is asserted twice — once on the first value outside the
 * bound, once on the bound itself — because an off-by-one in a CHECK is the
 * failure a single-sided test misses.
 */
describe('input validation CHECK constraints', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  const insertMessage = (len: number) =>
    asSuperuser(db, (tx) =>
      tx.query(
        `insert into public.conversation_messages (conversation_id, user_id, message)
         values ($1, $2, repeat('x', $3))`,
        [ids.conversation.approvedActive, ids.user.trekkerA, len],
      ),
    )

  const insertTrek = (col: 'estimated_cost' | 'max_participants', value: number) =>
    asSuperuser(db, (tx) =>
      tx.query(
        `insert into public.treks (title, difficulty, company_id, ${col}) values ('Probe', 'Easy', $1, $2)`,
        [ids.company.approved, value],
      ),
    )

  const insertBatch = (value: number | null) =>
    asSuperuser(db, (tx) =>
      tx.query(
        `insert into public.trek_batches (trek_id, batch_date, max_participants)
         values ($1, current_date + 90, $2)`,
        [ids.trek.approvedActive, value],
      ),
    )

  const updateProfile = (
    col: 'full_name' | 'bio' | 'phone_no' | 'emergency_no',
    value: string | null,
  ) =>
    asSuperuser(db, (tx) =>
      tx.query(`update public.profiles set ${col} = $1 where id = $2`, [
        value,
        ids.user.trekkerA,
      ]),
    )

  describe('conversation_messages.message', () => {
    it('rejects a message one character over the 2000-char cap', async () => {
      await expect(insertMessage(2001)).rejects.toThrow(/violates check constraint/i)
    })

    it('accepts a message of exactly 2000 characters', async () => {
      await expect(insertMessage(2000)).resolves.toBeDefined()
    })

    it('rejects a blank message that is not soft-deleted', async () => {
      await expect(insertMessage(0)).rejects.toThrow(/violates check constraint/i)
    })

    it('rejects a whitespace-only message, which trim would have caught', async () => {
      // messageSchema trims before its min(1), so '   ' is not a message. The
      // CHECK uses btrim for the same reason — a length-only floor would call
      // this a three-character message.
      await expect(
        asSuperuser(db, (tx) =>
          tx.query(
            `insert into public.conversation_messages (conversation_id, user_id, message)
             values ($1, $2, '   ')`,
            [ids.conversation.approvedActive, ids.user.trekkerA],
          ),
        ),
      ).rejects.toThrow(/violates check constraint/i)
    })

    it('accepts the blank a soft-delete leaves behind', async () => {
      // The one row shape allowed to be empty. messages/page.tsx blanks
      // `message` when setting is_deleted, so an unconditional floor would
      // break deletion — hence the is_deleted arm rather than no floor at all.
      await expect(
        asSuperuser(db, (tx) =>
          tx.query(
            `insert into public.conversation_messages (conversation_id, user_id, message, is_deleted)
             values ($1, $2, '', true)`,
            [ids.conversation.approvedActive, ids.user.trekkerA],
          ),
        ),
      ).resolves.toBeDefined()
      // Reaching that shape through the API is a separate question, and RLS
      // answers it — see 'refuses a message that arrives already soft-deleted'
      // in chat.test.ts.
    })
  })

  describe('treks.estimated_cost', () => {
    it('rejects a negative cost', async () => {
      await expect(insertTrek('estimated_cost', -1)).rejects.toThrow(/violates check constraint/i)
    })

    it('accepts zero, so a free trek stays free', async () => {
      await expect(insertTrek('estimated_cost', 0)).resolves.toBeDefined()
    })
  })

  describe('max_participants', () => {
    it('rejects zero capacity on a trek', async () => {
      await expect(insertTrek('max_participants', 0)).rejects.toThrow(/violates check constraint/i)
    })

    it('rejects negative capacity on a trek', async () => {
      await expect(insertTrek('max_participants', -5)).rejects.toThrow(/violates check constraint/i)
    })

    it('accepts a capacity of one on a trek', async () => {
      await expect(insertTrek('max_participants', 1)).resolves.toBeDefined()
    })

    it('rejects zero capacity on a batch', async () => {
      await expect(insertBatch(0)).rejects.toThrow(/violates check constraint/i)
    })

    it('accepts a capacity of one on a batch', async () => {
      await expect(insertBatch(1)).resolves.toBeDefined()
    })

    it('still accepts null on a batch, which means uncapped', async () => {
      await expect(insertBatch(null)).resolves.toBeDefined()
    })
  })

  describe('profiles', () => {
    it('rejects a full_name one character over 100', async () => {
      await expect(updateProfile('full_name', 'x'.repeat(101))).rejects.toThrow(
        /violates check constraint/i,
      )
    })

    it('accepts a full_name of exactly 100 characters', async () => {
      await expect(updateProfile('full_name', 'x'.repeat(100))).resolves.toBeDefined()
    })

    it('still accepts a null full_name, the unset value handle_new_user writes', async () => {
      await expect(updateProfile('full_name', null)).resolves.toBeDefined()
    })

    it('rejects a bio one character over 500', async () => {
      await expect(updateProfile('bio', 'x'.repeat(501))).rejects.toThrow(
        /violates check constraint/i,
      )
    })

    it('accepts a bio of exactly 500 characters', async () => {
      await expect(updateProfile('bio', 'x'.repeat(500))).resolves.toBeDefined()
    })

    it('rejects an over-long emergency contact name and phone', async () => {
      await expect(updateProfile('emergency_contact', 'x'.repeat(101))).rejects.toThrow(
        /violates check constraint/i,
      )
      await expect(updateProfile('emergency_no', 'x'.repeat(21))).rejects.toThrow(
        /violates check constraint/i,
      )
    })
  })

  describe('phone columns look like phone numbers (0013)', () => {
    // The character class is profileUpdateSchema's, so the accepted shapes are
    // exactly what the form would have let through; 'x' stands for every value
    // that is not a phone number at all — an email, a URL, a sentence.
    for (const col of ['phone_no', 'emergency_no'] as const) {
      it(`rejects a ${col} containing letters`, async () => {
        await expect(updateProfile(col, 'call me maybe')).rejects.toThrow(
          /violates check constraint/i,
        )
      })

      it(`accepts a formatted ${col}`, async () => {
        await expect(updateProfile(col, '+91 (987) 654-3210')).resolves.toBeDefined()
      })

      it(`still accepts an empty and a null ${col}, both meaning unset`, async () => {
        await expect(updateProfile(col, '')).resolves.toBeDefined()
        await expect(updateProfile(col, null)).resolves.toBeDefined()
      })
    }

    it('rejects a phone_no one character over 20', async () => {
      await expect(updateProfile('phone_no', '9'.repeat(21))).rejects.toThrow(
        /violates check constraint/i,
      )
    })

    it('accepts a phone_no of exactly 20 characters', async () => {
      await expect(updateProfile('phone_no', '9'.repeat(20))).resolves.toBeDefined()
    })
  })

  describe('companies.website (0014)', () => {
    // The only constraint in this file that closes an XSS rather than a size:
    // both company screens render this value into an href React does not
    // sanitize, so an executable scheme here runs in the platform admin's
    // session on the page where they approve the application.
    const setWebsite = (value: string | null) =>
      asSuperuser(db, (tx) =>
        tx.query(`update public.companies set website = $1 where id = $2`, [
          value,
          ids.company.approved,
        ]),
      )

    for (const scheme of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      '//evil.example',
      'ftp://example.com',
    ]) {
      it(`rejects ${scheme}`, async () => {
        await expect(setWebsite(scheme)).rejects.toThrow(/violates check constraint/i)
      })
    }

    it('accepts http and https, in any case — new URL() lowercases the scheme before Zod sees it', async () => {
      await expect(setWebsite('https://himalayan-trails.example')).resolves.toBeDefined()
      await expect(setWebsite('http://himalayan-trails.example')).resolves.toBeDefined()
      await expect(setWebsite('HTTPS://himalayan-trails.example')).resolves.toBeDefined()
    })

    it('still accepts null, the value a blank field is written as', async () => {
      await expect(setWebsite(null)).resolves.toBeDefined()
    })

    it("rejects '', which no app writer produces — both send `website || null`", async () => {
      await expect(setWebsite('')).rejects.toThrow(/violates check constraint/i)
    })
  })

  describe('companies (0015)', () => {
    // 0009/0011 never reached this table. Every bound here is the Zod one, and
    // the phone character class is the same one 0013 put on profiles.
    const setCompany = (col: string, value: string | null) =>
      asSuperuser(db, (tx) =>
        tx.query(`update public.companies set ${col} = $1 where id = $2`, [
          value,
          ids.company.approved,
        ]),
      )

    const caps: [string, number][] = [
      ['name', 100],
      ['description', 1000],
      ['contact_phone', 20],
      ['contact_email', 254],
    ]

    for (const [col, cap] of caps) {
      // contact_email/contact_phone also carry a format rule, so pad with a
      // value that satisfies it rather than with 'x'.
      const fill = (n: number) =>
        col === 'contact_email'
          ? 'a'.repeat(n - '@ex.co'.length) + '@ex.co'
          : col === 'contact_phone'
            ? '9'.repeat(n)
            : 'x'.repeat(n)

      it(`rejects a ${col} one character over ${cap}`, async () => {
        await expect(setCompany(col, fill(cap + 1))).rejects.toThrow(/violates check constraint/i)
      })

      it(`accepts a ${col} of exactly ${cap}`, async () => {
        await expect(setCompany(col, fill(cap))).resolves.toBeDefined()
      })
    }

    it('rejects a contact_phone that is not a phone number', async () => {
      await expect(setCompany('contact_phone', 'call me maybe')).rejects.toThrow(
        /violates check constraint/i,
      )
      await expect(setCompany('contact_phone', '+91 (987) 654-3210')).resolves.toBeDefined()
    })

    it('rejects a contact_email that is not an address', async () => {
      for (const bad of ['not an email', 'https://example.com', 'a@b@c', 'a b@example.com']) {
        await expect(setCompany('contact_email', bad)).rejects.toThrow(
          /violates check constraint/i,
        )
      }
      await expect(setCompany('contact_email', 'ops@himalayan-trails.example')).resolves.toBeDefined()
    })

    it("still accepts '' and null on both optional contact columns, as Zod does", async () => {
      for (const col of ['contact_email', 'contact_phone']) {
        await expect(setCompany(col, '')).resolves.toBeDefined()
        await expect(setCompany(col, null)).resolves.toBeDefined()
      }
    })
  })

  describe('trek text columns', () => {
    const insertTrekText = (col: string, value: string) =>
      asSuperuser(db, (tx) =>
        tx.query(
          `insert into public.treks (title, difficulty, company_id, ${col}) values ('Probe', 'Easy', $1, $2)`,
          [ids.company.approved, value],
        ),
      )

    // Each pair is the Zod cap from trekFormSchema and the first value past it.
    const caps: [string, number][] = [
      ['description', 2000],
      ['location', 200],
      ['meeting_point', 300],
      ['meeting_point2', 300],
    ]

    for (const [col, cap] of caps) {
      it(`rejects a ${col} one character over ${cap}`, async () => {
        await expect(insertTrekText(col, 'x'.repeat(cap + 1))).rejects.toThrow(
          /violates check constraint/i,
        )
      })

      it(`accepts a ${col} of exactly ${cap}`, async () => {
        await expect(insertTrekText(col, 'x'.repeat(cap))).resolves.toBeDefined()
      })
    }

    it('rejects a title over 150 characters', async () => {
      await expect(
        asSuperuser(db, (tx) =>
          tx.query(`insert into public.treks (title, difficulty, company_id) values ($1, 'Easy', $2)`, [
            'x'.repeat(151),
            ids.company.approved,
          ]),
        ),
      ).rejects.toThrow(/violates check constraint/i)
    })

    it('bounds gear_checklist on the joined string, matching the textarea Zod caps', async () => {
      // The Zod cap is on the raw newline-separated textarea, not the array, so
      // the CHECK reconstructs that string. Two 1000-char items plus the
      // separator is 2001 — over by exactly the newline, which a per-element or
      // array-length rule would miss.
      const overByANewline = asSuperuser(db, (tx) =>
        tx.query(
          `insert into public.treks (title, difficulty, company_id, gear_checklist)
           values ('Probe', 'Easy', $1, array[$2, $3])`,
          [ids.company.approved, 'x'.repeat(1000), 'y'.repeat(1000)],
        ),
      )
      await expect(overByANewline).rejects.toThrow(/violates check constraint/i)

      const exactly2000 = asSuperuser(db, (tx) =>
        tx.query(
          `insert into public.treks (title, difficulty, company_id, gear_checklist)
           values ('Probe', 'Easy', $1, array[$2, $3])`,
          [ids.company.approved, 'x'.repeat(1000), 'y'.repeat(999)],
        ),
      )
      await expect(exactly2000).resolves.toBeDefined()
    })
  })

  describe('handle_new_user clamps the signup name', () => {
    // profiles_full_name_len (0009) turned an over-long name into a raise
    // inside an AFTER INSERT trigger with no exception handler, which aborts
    // the enclosing auth.users insert — signup fails outright rather than
    // leaving a partial account. 0010 clamps instead. The form is capped too,
    // but a provider display name would not be.
    it('truncates a 150-character name to 100 instead of failing the signup', async () => {
      const uid = '00000000-0000-4000-8000-00000000f009'
      const name = await asSuperuser(db, async (tx) => {
        await tx.query(
          `insert into auth.users (id, email, raw_user_meta_data)
           values ($1, 'long.name@example.test', jsonb_build_object('full_name', $2::text))`,
          [uid, 'x'.repeat(150)],
        )
        return (
          await tx.query<{ full_name: string }>(
            `select full_name from public.profiles where id = $1`,
            [uid],
          )
        ).rows[0]?.full_name
      })
      expect(name).toHaveLength(100)
    })

    it('still stores null for a blank name rather than an empty string', async () => {
      const uid = '00000000-0000-4000-8000-00000000f00a'
      const name = await asSuperuser(db, async (tx) => {
        await tx.query(
          `insert into auth.users (id, email, raw_user_meta_data)
           values ($1, 'blank.name@example.test', '{"full_name":"   "}')`,
          [uid],
        )
        return (
          await tx.query<{ full_name: string | null }>(
            `select full_name from public.profiles where id = $1`,
            [uid],
          )
        ).rows[0]?.full_name
      })
      expect(name).toBeNull()
    })
  })
})
