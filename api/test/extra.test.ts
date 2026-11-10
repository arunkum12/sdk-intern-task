import { describe, expect, it } from 'vitest'
import { type Balance, call, createBill, createHome, type Share } from './helpers'

describe('extra edge cases & concurrency', () => {
  it('handles two different concurrent payments for the same share: exactly one succeeds', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]
    if (!share) throw new Error('no share')

    const key1 = crypto.randomUUID()
    const key2 = crypto.randomUUID()

    // Send both concurrently
    const [res1, res2] = await Promise.all([
      call<Share>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': key1 },
      }),
      call<Share>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': key2 },
      }),
    ])

    const statuses = [res1.status, res2.status].sort()
    expect(statuses).toEqual([200, 409])

    const successRes = res1.status === 200 ? res1 : res2
    expect(successRes.body.id).toBe(share.id)
    expect(successRes.body.paidAt).toEqual(expect.any(String))
  })

  it('handles two identical concurrent payments with the same key: both return 200 with identical paidAt', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]
    if (!share) throw new Error('no share')

    const key = crypto.randomUUID()

    const [res1, res2] = await Promise.all([
      call<Share>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': key },
      }),
      call<Share>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': key },
      }),
    ])

    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    expect(res1.body.paidAt).toBe(res2.body.paidAt)
  })

  it('returns 404 when share belongs to another bill', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill1 = await createBill(homeId, 1000)
    const bill2 = await createBill(homeId, 2000)

    const shareFromBill2 = bill2.body.shares[0]
    if (!shareFromBill2) throw new Error('no share')

    const res = await call('POST', `/api/bills/${bill1.body.id}/shares/${shareFromBill2.id}/pay`, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    })

    expect(res.status).toBe(404)
  })

  it('rejects invalid amounts: NaN, Infinity, negative, float', async () => {
    const { homeId } = await createHome(['Asha'])

    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '500']) {
      const res = await call('POST', `/api/homes/${homeId}/bills`, {
        body: { title: 'Test', totalCents: invalid },
      })
      expect(res.status).toBe(422)
      expect(res.body).toHaveProperty('error')
    }
  })

  it('rejects empty or whitespace title for bill', async () => {
    const { homeId } = await createHome(['Asha'])
    const res = await call('POST', `/api/homes/${homeId}/bills`, {
      body: { title: '   ', totalCents: 100 },
    })
    expect(res.status).toBe(422)
    expect(res.body).toHaveProperty('error')
  })

  it('rejects empty or whitespace name for home or member', async () => {
    const homeRes = await call('POST', '/api/homes', {
      body: { name: '   ' },
    })
    expect(homeRes.status).toBe(400)
    expect(homeRes.body).toHaveProperty('error')

    const validHome = await call<{ id: string }>('POST', '/api/homes', {
      body: { name: 'Valid Home' },
    })

    const memberRes = await call('POST', `/api/homes/${validHome.body.id}/members`, {
      body: { name: '   ' },
    })
    expect(memberRes.status).toBe(400)
    expect(memberRes.body).toHaveProperty('error')
  })

  it('returns 0 outstanding cents for home with members having no bills', async () => {
    const { homeId, members } = await createHome(['Asha', 'Ben'])
    const res = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
    expect(res.status).toBe(200)
    expect(res.body.balances).toEqual([
      { memberId: members[0]?.id, name: 'Asha', outstandingCents: 0 },
      { memberId: members[1]?.id, name: 'Ben', outstandingCents: 0 },
    ])
  })
})

