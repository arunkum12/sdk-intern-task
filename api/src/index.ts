import { Hono } from 'hono'

type HomeRow = {
  id: string
  name: string
  created_at: string
}

type BillRow = {
  id: string
  home_id: string
  title: string
  total_cents: number
  created_at: string
}

type ShareRow = {
  id: string
  bill_id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  idempotency_key: string | null
  created_at: string
}

type BalanceRow = {
  memberId: string
  name: string
  outstandingCents: number
}

const app = new Hono<{ Bindings: Env }>()

app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json({ error: err.message || 'Internal server error' }, 500)
})

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// GET /api/homes - List all homes (helper for UI)
app.get('/api/homes', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT id, name, created_at as createdAt FROM homes ORDER BY created_at DESC',
  ).all<{ id: string; name: string; createdAt: string }>()
  return c.json({ homes: result.results })
})

// GET /api/homes/:homeId - Get single home details
app.get('/api/homes/:homeId', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }
  return c.json({ id: home.id, name: home.name })
})

// POST /api/homes - Create a home
app.post('/api/homes', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('name' in body) ||
    typeof (body as { name: unknown }).name !== 'string' ||
    (body as { name: string }).name.trim().length === 0
  ) {
    return c.json({ error: 'Name is required' }, 400)
  }

  const name = (body as { name: string }).name.trim()
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  await c.env.DB.prepare('INSERT INTO homes (id, name, created_at) VALUES (?, ?, ?)')
    .bind(id, name, createdAt)
    .run()

  return c.json({ id, name }, 201)
})

// GET /api/homes/:homeId/members - List members of a home
app.get('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const members = await c.env.DB.prepare(
    'SELECT id, home_id as homeId, name FROM members WHERE home_id = ? ORDER BY order_index ASC, created_at ASC',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; name: string }>()

  return c.json({ members: members.results })
})

// POST /api/homes/:homeId/members - Add a member to a home
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('name' in body) ||
    typeof (body as { name: unknown }).name !== 'string' ||
    (body as { name: string }).name.trim().length === 0
  ) {
    return c.json({ error: 'Name is required' }, 400)
  }

  const name = (body as { name: string }).name.trim()
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  const orderResult = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM members WHERE home_id = ?',
  )
    .bind(homeId)
    .first<{ next_order: number }>()

  const orderIndex = orderResult?.next_order ?? 0

  await c.env.DB.prepare(
    'INSERT INTO members (id, home_id, name, order_index, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, homeId, name, orderIndex, createdAt)
    .run()

  return c.json({ id, homeId, name }, 201)
})

// GET /api/homes/:homeId/bills - List bills for a home (helper for UI)
app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const billsQuery = await c.env.DB.prepare(
    'SELECT id, home_id as homeId, title, total_cents as totalCents, created_at as createdAt FROM bills WHERE home_id = ? ORDER BY created_at DESC',
  )
    .bind(homeId)
    .all<Omit<BillRow, 'created_at'> & { createdAt: string }>()

  const sharesQuery = await c.env.DB.prepare(
    `SELECT 
      s.id, 
      s.bill_id as billId, 
      s.member_id as memberId, 
      m.name as memberName, 
      s.amount_cents as amountCents, 
      s.paid_at as paidAt 
    FROM shares s
    JOIN members m ON m.id = s.member_id
    JOIN bills b ON b.id = s.bill_id
    WHERE b.home_id = ?
    ORDER BY m.order_index ASC`,
  )
    .bind(homeId)
    .all<{
      id: string
      billId: string
      memberId: string
      memberName: string
      amountCents: number
      paidAt: string | null
    }>()

  const sharesByBill = new Map<
    string,
    Array<{
      id: string
      memberId: string
      memberName: string
      amountCents: number
      paidAt: string | null
    }>
  >()

  for (const s of sharesQuery.results) {
    const list = sharesByBill.get(s.billId) ?? []
    list.push({
      id: s.id,
      memberId: s.memberId,
      memberName: s.memberName,
      amountCents: s.amountCents,
      paidAt: s.paidAt,
    })
    sharesByBill.set(s.billId, list)
  }

  const bills = billsQuery.results.map((b) => ({
    id: b.id,
    homeId: b.home_id,
    title: b.title,
    totalCents: b.total_cents,
    createdAt: b.createdAt,
    shares: sharesByBill.get(b.id) ?? [],
  }))

  return c.json({ bills })
})

// POST /api/homes/:homeId/bills - Create a bill and split it among members
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 422)
  }

  if (typeof body !== 'object' || body === null) {
    return c.json({ error: 'Invalid body' }, 422)
  }

  const { title, totalCents } = body as { title?: unknown; totalCents?: unknown }

  if (typeof totalCents !== 'number' || !Number.isInteger(totalCents) || totalCents <= 0) {
    return c.json({ error: 'Total must be a positive whole number' }, 422)
  }

  if (typeof title !== 'string' || title.trim().length === 0) {
    return c.json({ error: 'Title is required' }, 422)
  }

  const membersResult = await c.env.DB.prepare(
    'SELECT id, name FROM members WHERE home_id = ? ORDER BY order_index ASC, created_at ASC',
  )
    .bind(homeId)
    .all<{ id: string; name: string }>()

  const members = membersResult.results
  if (members.length === 0) {
    return c.json({ error: 'Home has no members' }, 422)
  }

  const numMembers = members.length
  const base = Math.floor(totalCents / numMembers)
  const remainder = totalCents % numMembers

  const billId = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  const shares: Array<{
    id: string
    memberId: string
    amountCents: number
    paidAt: string | null
  }> = []
  const statements: D1PreparedStatement[] = []

  statements.push(
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(billId, homeId, title.trim(), totalCents, createdAt),
  )

  for (let i = 0; i < numMembers; i++) {
    const member = members[i]
    if (!member) continue
    const amountCents = base + (i < remainder ? 1 : 0)
    const shareId = crypto.randomUUID()

    shares.push({
      id: shareId,
      memberId: member.id,
      amountCents,
      paidAt: null,
    })

    statements.push(
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at, idempotency_key, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?)',
      ).bind(shareId, billId, member.id, amountCents, createdAt),
    )
  }

  await c.env.DB.batch(statements)

  return c.json(
    {
      id: billId,
      homeId,
      title: title.trim(),
      totalCents,
      shares,
    },
    201,
  )
})

// POST /api/bills/:billId/shares/:shareId/pay - Pay a share
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const idempotencyKey = c.req.header('Idempotency-Key')

  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const key = idempotencyKey.trim()

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?')
    .bind(billId)
    .first<BillRow>()
  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  const share = await c.env.DB.prepare(
    'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<ShareRow>()
  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  // If already paid:
  if (share.paid_at !== null) {
    if (share.idempotency_key === key) {
      return c.json({
        id: share.id,
        memberId: share.member_id,
        amountCents: share.amount_cents,
        paidAt: share.paid_at,
      })
    }
    return c.json({ error: 'Share already paid with a different idempotency key' }, 409)
  }

  // Atomically attempt to pay
  const now = new Date().toISOString()
  const updateResult = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
  )
    .bind(now, key, shareId, billId)
    .run()

  if (updateResult.meta.changes === 1) {
    return c.json({
      id: share.id,
      memberId: share.member_id,
      amountCents: share.amount_cents,
      paidAt: now,
    })
  }

  // If changes === 0, a concurrent request must have just paid this share
  const currentShare = await c.env.DB.prepare(
    'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<ShareRow>()

  if (currentShare && currentShare.idempotency_key === key) {
    return c.json({
      id: currentShare.id,
      memberId: currentShare.member_id,
      amountCents: currentShare.amount_cents,
      paidAt: currentShare.paid_at,
    })
  }

  return c.json({ error: 'Share already paid with a different idempotency key' }, 409)
})

// GET /api/homes/:homeId/balances - Outstanding balances for all members
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const result = await c.env.DB.prepare(
    `SELECT 
      m.id AS memberId,
      m.name,
      COALESCE(
        (SELECT SUM(s.amount_cents) 
         FROM shares s 
         JOIN bills b ON b.id = s.bill_id 
         WHERE s.member_id = m.id 
           AND b.home_id = m.home_id 
           AND s.paid_at IS NULL), 
        0
      ) AS outstandingCents
    FROM members m
    WHERE m.home_id = ?
    ORDER BY m.order_index ASC, m.created_at ASC`,
  )
    .bind(homeId)
    .all<BalanceRow>()

  return c.json({ balances: result.results })
})

export default app
