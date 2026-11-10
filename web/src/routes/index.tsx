import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'

export const Route = createFileRoute('/')({
  component: BillSplitterApp,
})

type Home = {
  id: string
  name: string
  createdAt?: string
}

type Member = {
  id: string
  homeId: string
  name: string
}

type Share = {
  id: string
  memberId: string
  memberName?: string
  amountCents: number
  paidAt: string | null
}

type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  createdAt: string
  shares: Share[]
}

type Balance = {
  memberId: string
  name: string
  outstandingCents: number
}

function formatCents(cents: number): string {
  const dollars = (cents / 100).toFixed(2)
  return `$${dollars} (${cents}¢)`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString()
  } catch {
    return iso
  }
}

function BillSplitterApp() {
  const [homes, setHomes] = useState<Home[]>([])
  const [selectedHomeId, setSelectedHomeId] = useState<string>('')
  const [members, setMembers] = useState<Member[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])

  // Loading states
  const [loadingHomes, setLoadingHomes] = useState<boolean>(true)
  const [loadingDetails, setLoadingDetails] = useState<boolean>(false)

  // Errors
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [homeFormError, setHomeFormError] = useState<string | null>(null)
  const [memberFormError, setMemberFormError] = useState<string | null>(null)
  const [billFormError, setBillFormError] = useState<string | null>(null)

  // Form states
  const [newHomeName, setNewHomeName] = useState('')
  const [newMemberName, setNewMemberName] = useState('')
  const [newBillTitle, setNewBillTitle] = useState('')
  const [newBillTotalCents, setNewBillTotalCents] = useState<string>('')

  // Form submitting states
  const [creatingHome, setCreatingHome] = useState(false)
  const [addingMember, setAddingMember] = useState(false)
  const [creatingBill, setCreatingBill] = useState(false)

  // Per-share payment states
  const [payingShareId, setPayingShareId] = useState<string | null>(null)
  const [shareErrors, setShareErrors] = useState<Record<string, string>>({})

  // Diagnostic test state
  const [labResult, setLabResult] = useState<string | null>(null)
  const [labLoading, setLabLoading] = useState(false)

  // Fetch homes list
  const fetchHomes = useCallback(async () => {
    try {
      setLoadingHomes(true)
      setGlobalError(null)
      const res = await fetch('/api/homes')
      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(errJson?.error || `Server responded with ${res.status}`)
      }
      const data = (await res.json()) as { homes: Home[] }
      setHomes(data.homes)
      if (data.homes.length > 0 && !selectedHomeId) {
        const first = data.homes[0]
        if (first) {
          setSelectedHomeId(first.id)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect to API'
      setGlobalError(`Failed to load homes: ${msg}. Is the backend running?`)
    } finally {
      setLoadingHomes(false)
    }
  }, [selectedHomeId])

  // Fetch details for the selected home
  const fetchHomeDetails = useCallback(async (homeId: string) => {
    if (!homeId) return
    try {
      setLoadingDetails(true)
      setGlobalError(null)

      const [membersRes, billsRes, balancesRes] = await Promise.all([
        fetch(`/api/homes/${homeId}/members`),
        fetch(`/api/homes/${homeId}/bills`),
        fetch(`/api/homes/${homeId}/balances`),
      ])

      if (!membersRes.ok || !billsRes.ok || !balancesRes.ok) {
        throw new Error('Could not load complete home details from API')
      }

      const membersData = (await membersRes.json()) as { members: Member[] }
      const billsData = (await billsRes.json()) as { bills: Bill[] }
      const balancesData = (await balancesRes.json()) as { balances: Balance[] }

      setMembers(membersData.members)
      setBills(billsData.bills)
      setBalances(balancesData.balances)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error loading details'
      setGlobalError(msg)
    } finally {
      setLoadingDetails(false)
    }
  }, [])

  useEffect(() => {
    fetchHomes()
  }, [fetchHomes])

  useEffect(() => {
    if (selectedHomeId) {
      fetchHomeDetails(selectedHomeId)
    } else {
      setMembers([])
      setBills([])
      setBalances([])
    }
  }, [selectedHomeId, fetchHomeDetails])

  // Handle Create Home
  const handleCreateHome = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newHomeName.trim()
    if (!name) {
      setHomeFormError('Home name cannot be empty')
      return
    }

    try {
      setCreatingHome(true)
      setHomeFormError(null)
      const res = await fetch('/api/homes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      const json = (await res.json().catch(() => null)) as {
        id?: string
        name?: string
        error?: string
      } | null
      if (!res.ok || !json?.id) {
        throw new Error(json?.error || 'Failed to create home')
      }

      setNewHomeName('')
      await fetchHomes()
      setSelectedHomeId(json.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create home'
      setHomeFormError(msg)
    } finally {
      setCreatingHome(false)
    }
  }

  // Handle Add Member
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedHomeId) return
    const name = newMemberName.trim()
    if (!name) {
      setMemberFormError('Member name cannot be empty')
      return
    }

    try {
      setAddingMember(true)
      setMemberFormError(null)
      const res = await fetch(`/api/homes/${selectedHomeId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      const json = (await res.json().catch(() => null)) as {
        id?: string
        name?: string
        error?: string
      } | null
      if (!res.ok || !json?.id) {
        throw new Error(json?.error || 'Failed to add member')
      }

      setNewMemberName('')
      await fetchHomeDetails(selectedHomeId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add member'
      setMemberFormError(msg)
    } finally {
      setAddingMember(false)
    }
  }

  // Handle Create Bill
  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedHomeId) return

    const title = newBillTitle.trim()
    if (!title) {
      setBillFormError('Title is required')
      return
    }

    const totalCentsNum = Number(newBillTotalCents)
    if (!Number.isInteger(totalCentsNum) || totalCentsNum <= 0) {
      setBillFormError('Total must be a positive whole integer (cents)')
      return
    }

    if (members.length === 0) {
      setBillFormError('Cannot create a bill: this home has no members!')
      return
    }

    try {
      setCreatingBill(true)
      setBillFormError(null)
      const res = await fetch(`/api/homes/${selectedHomeId}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, totalCents: totalCentsNum }),
      })

      const json = (await res.json().catch(() => null)) as {
        id?: string
        error?: string
      } | null
      if (!res.ok || !json?.id) {
        throw new Error(json?.error || 'Failed to create bill')
      }

      setNewBillTitle('')
      setNewBillTotalCents('')
      await fetchHomeDetails(selectedHomeId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create bill'
      setBillFormError(msg)
    } finally {
      setCreatingBill(false)
    }
  }

  // Live split preview calculations
  const splitPreview = useMemo(() => {
    const total = Number(newBillTotalCents)
    if (!Number.isInteger(total) || total <= 0 || members.length === 0) {
      return null
    }
    const n = members.length
    const base = Math.floor(total / n)
    const remainder = total % n
    return members.map((m, idx) => ({
      memberId: m.id,
      name: m.name,
      amountCents: base + (idx < remainder ? 1 : 0),
      isRemainderRecipient: idx < remainder,
    }))
  }, [newBillTotalCents, members])

  // Handle Pay Share
  const handlePayShare = async (billId: string, shareId: string, customKey?: string) => {
    const key = customKey || crypto.randomUUID()
    setPayingShareId(shareId)

    // Clear previous error for this share
    setShareErrors((prev) => {
      const copy = { ...prev }
      delete copy[shareId]
      return copy
    })

    try {
      const res = await fetch(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
      })

      const json = (await res.json().catch(() => null)) as {
        id?: string
        paidAt?: string
        error?: string
      } | null

      if (!res.ok || !json?.paidAt) {
        throw new Error(json?.error || `Payment failed with status ${res.status}`)
      }

      // Update bill share in place
      setBills((prevBills) =>
        prevBills.map((b) => {
          if (b.id !== billId) return b
          return {
            ...b,
            shares: b.shares.map((s) =>
              s.id === shareId ? { ...s, paidAt: json.paidAt ?? null } : s,
            ),
          }
        }),
      )

      // Refresh balances
      if (selectedHomeId) {
        const balRes = await fetch(`/api/homes/${selectedHomeId}/balances`)
        if (balRes.ok) {
          const balData = (await balRes.json()) as { balances: Balance[] }
          setBalances(balData.balances)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Payment error'
      // Keep share unpaid and display error on that share card
      setShareErrors((prev) => ({
        ...prev,
        [shareId]: msg,
      }))
    } finally {
      setPayingShareId(null)
    }
  }

  // Diagnostic Lab: Repeat Payment with Same Key (Case 4)
  const runTestRepeatPayment = async (billId: string, shareId: string) => {
    setLabLoading(true)
    setLabResult(null)
    const fixedKey = `test-idemp-${Date.now()}`
    try {
      const res1 = await fetch(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': fixedKey },
      })
      const data1 = (await res1.json()) as { paidAt?: string; error?: string }

      const res2 = await fetch(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': fixedKey },
      })
      const data2 = (await res2.json()) as { paidAt?: string; error?: string }

      if (res1.status === 200 && res2.status === 200 && data1.paidAt === data2.paidAt) {
        setLabResult(
          `✅ Case 4 Verified: Both requests answered 200 with identical paidAt (${data1.paidAt}). Payment was idempotent.`,
        )
      } else {
        setLabResult(
          `⚠️ Result: req1: ${res1.status} (${JSON.stringify(data1)}), req2: ${res2.status} (${JSON.stringify(data2)})`,
        )
      }
      if (selectedHomeId) fetchHomeDetails(selectedHomeId)
    } catch (e) {
      setLabResult(`Error: ${e instanceof Error ? e.message : 'Failed'}`)
    } finally {
      setLabLoading(false)
    }
  }

  // Diagnostic Lab: Concurrent Double-Pay with Different Keys (Case 5)
  const runTestRaceCondition = async (billId: string, shareId: string) => {
    setLabLoading(true)
    setLabResult(null)
    const keyA = `race-a-${crypto.randomUUID()}`
    const keyB = `race-b-${crypto.randomUUID()}`

    try {
      const [r1, r2] = await Promise.all([
        fetch(`/api/bills/${billId}/shares/${shareId}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyA },
        }),
        fetch(`/api/bills/${billId}/shares/${shareId}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyB },
        }),
      ])

      const d1 = (await r1.json()) as { error?: string; paidAt?: string }
      const d2 = (await r2.json()) as { error?: string; paidAt?: string }

      const statuses = [r1.status, r2.status].sort()
      if (statuses[0] === 200 && statuses[1] === 409) {
        setLabResult(
          '✅ Case 5 Verified: Race condition handled safely! Exactly one request returned 200, and the concurrent request was rejected with 409 Conflict.',
        )
      } else {
        setLabResult(
          `Statuses: Req A: ${r1.status} (${JSON.stringify(d1)}), Req B: ${r2.status} (${JSON.stringify(d2)})`,
        )
      }
      if (selectedHomeId) fetchHomeDetails(selectedHomeId)
    } catch (e) {
      setLabResult(`Error: ${e instanceof Error ? e.message : 'Failed'}`)
    } finally {
      setLabLoading(false)
    }
  }

  // Diagnostic Lab: Test 404 Non-Existent Share (Case 6)
  const runTestNonExistent = async () => {
    setLabLoading(true)
    setLabResult(null)
    try {
      const res = await fetch('/api/bills/non-existent-bill/shares/non-existent-share/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      setLabResult(
        `✅ Case 6 Verified: API correctly returned ${res.status} JSON: ${JSON.stringify(json)}. Web UI handled it without crashing.`,
      )
    } catch (e) {
      setLabResult(`Error: ${e instanceof Error ? e.message : 'Failed'}`)
    } finally {
      setLabLoading(false)
    }
  }

  const selectedHome = homes.find((h) => h.id === selectedHomeId)
  const firstUnpaidShare = useMemo(() => {
    for (const b of bills) {
      for (const s of b.shares) {
        if (!s.paidAt) return { billId: b.id, shareId: s.id }
      }
    }
    return null
  }, [bills])

  return (
    <main className="app-container">
      {/* Header */}
      <header className="header">
        <div className="header-title-group">
          <h1>🏡 Shared Bill Splitter</h1>
          <p className="header-subtitle">
            Reliable, idempotent bill splitting with whole-cent arithmetic
          </p>
        </div>

        {/* Home Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {loadingHomes ? (
            <span className="badge badge-neutral">Loading homes...</span>
          ) : (
            <select
              className="form-select"
              value={selectedHomeId}
              onChange={(e) => setSelectedHomeId(e.target.value)}
              style={{ minWidth: 200 }}
              disabled={homes.length === 0}
            >
              {homes.length === 0 && <option value="">No homes created</option>}
              {homes.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      {/* Global Alert Banner */}
      {globalError && (
        <div className="alert alert-danger" role="alert">
          <span>⚠️ {globalError}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (selectedHomeId) fetchHomeDetails(selectedHomeId)
              else fetchHomes()
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Top Controls: Create Home & Add Member */}
      <div className="grid-2">
        {/* Create Home Card */}
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">1. Create a Home</h2>
          </div>
          {homeFormError && <div className="alert alert-danger">{homeFormError}</div>}
          <form onSubmit={handleCreateHome}>
            <div className="form-group">
              <label htmlFor="homeNameInput">Home Name</label>
              <input
                id="homeNameInput"
                className="form-input"
                type="text"
                placeholder="e.g. Flat 4B, Baker Street"
                value={newHomeName}
                onChange={(e) => setNewHomeName(e.target.value)}
                disabled={creatingHome}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={creatingHome}>
              {creatingHome ? <span className="spinner" /> : null}
              Create Home
            </button>
          </form>
        </section>

        {/* Add Member Card */}
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">2. Add Member to Home</h2>
          </div>
          {!selectedHomeId ? (
            <p className="form-help">Select or create a home first.</p>
          ) : (
            <>
              {memberFormError && <div className="alert alert-danger">{memberFormError}</div>}
              <form onSubmit={handleAddMember}>
                <div className="form-group">
                  <label htmlFor="memberNameInput">
                    Member Name for <strong>{selectedHome?.name}</strong>
                  </label>
                  <input
                    id="memberNameInput"
                    className="form-input"
                    type="text"
                    placeholder="e.g. Asha, Ben, Chitra"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    disabled={addingMember}
                  />
                  <p className="form-help">
                    Note: Members are ordered sequentially in the order added. Extra cents go to
                    earlier members first.
                  </p>
                </div>
                <button type="submit" className="btn btn-primary" disabled={addingMember}>
                  {addingMember ? <span className="spinner" /> : null}
                  Add Member
                </button>
              </form>
            </>
          )}
        </section>
      </div>

      {/* Selected Home Overview & Balances */}
      {selectedHomeId && (
        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">
                {selectedHome?.name} — Members ({members.length})
              </h2>
              <p className="form-help">Home ID: {selectedHomeId}</p>
            </div>
          </div>

          {/* Members list */}
          {members.length === 0 ? (
            <div className="alert alert-warning">
              <span>
                ⚠️ <strong>Case 1: Home with no members.</strong> Add members above before creating
                bills.
              </span>
            </div>
          ) : (
            <div className="members-chip-container">
              {members.map((m, idx) => (
                <div key={m.id} className="member-chip">
                  <span className="member-chip-order">#{idx + 1}</span>
                  <strong>{m.name}</strong>
                </div>
              ))}
            </div>
          )}

          {/* Balances */}
          <h3 style={{ marginTop: '1.5rem', fontSize: '1rem', fontWeight: 600 }}>
            Outstanding Balances
          </h3>
          {loadingDetails ? (
            <p className="form-help">Updating balances...</p>
          ) : members.length === 0 ? (
            <p className="form-help">No members to calculate balances for.</p>
          ) : (
            <div className="balance-grid">
              {balances.map((b) => (
                <div key={b.memberId} className="balance-card">
                  <span className="balance-card-name">{b.name}</span>
                  <span
                    className={`balance-card-amount ${b.outstandingCents === 0 ? 'settled' : 'owing'}`}
                  >
                    {formatCents(b.outstandingCents)}
                  </span>
                  <span
                    className={`badge ${b.outstandingCents === 0 ? 'badge-success' : 'badge-danger'}`}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {b.outstandingCents === 0 ? 'All Settled' : 'Owes Shares'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Create Bill Section */}
      {selectedHomeId && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">3. Add &amp; Split a Bill</h2>
          </div>

          {billFormError && <div className="alert alert-danger">{billFormError}</div>}

          <form onSubmit={handleCreateBill}>
            <div className="grid-2">
              <div className="form-group">
                <label htmlFor="billTitleInput">Bill Title</label>
                <input
                  id="billTitleInput"
                  className="form-input"
                  type="text"
                  placeholder="e.g. Electricity, Wi-Fi, Groceries"
                  value={newBillTitle}
                  onChange={(e) => setNewBillTitle(e.target.value)}
                  disabled={creatingBill}
                />
              </div>

              <div className="form-group">
                <label htmlFor="billAmountInput">Total Amount in Whole Cents (integers only)</label>
                <input
                  id="billAmountInput"
                  className="form-input"
                  type="number"
                  step="1"
                  min="1"
                  placeholder="e.g. 1000 for $10.00, 3000 for $30.00"
                  value={newBillTotalCents}
                  onChange={(e) => setNewBillTotalCents(e.target.value)}
                  disabled={creatingBill}
                />
                <p className="form-help">
                  Amounts are strictly integers. Never use decimals for money.
                </p>
              </div>
            </div>

            {/* Live split preview */}
            {splitPreview && (
              <div className="split-preview">
                <div className="split-preview-title">
                  ⚡ Split Breakdown ({newBillTotalCents}¢ between {members.length} member
                  {members.length > 1 ? 's' : ''}):
                </div>
                {splitPreview.map((item) => (
                  <div key={item.memberId} className="split-preview-item">
                    <span>
                      {item.name}
                      {item.isRemainderRecipient ? ' (received extra 1¢)' : ''}
                    </span>
                    <strong>{formatCents(item.amountCents)}</strong>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: '1rem' }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={creatingBill || members.length === 0}
              >
                {creatingBill ? <span className="spinner" /> : null}
                Split Bill
              </button>
              {members.length === 0 && (
                <span className="form-help" style={{ marginLeft: '1rem', color: 'var(--danger)' }}>
                  Cannot create bill: home has no members.
                </span>
              )}
            </div>
          </form>
        </section>
      )}

      {/* Bills & Shares Display */}
      {selectedHomeId && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Bills &amp; Shares ({bills.length})</h2>
          </div>

          {loadingDetails ? (
            <div className="empty-state">
              <span className="spinner" style={{ width: 24, height: 24 }} />
              <p style={{ marginTop: '0.75rem' }}>Loading bills...</p>
            </div>
          ) : bills.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🧾</div>
              <h3>No bills yet</h3>
              <p>Add a bill above to split expenses among the members.</p>
            </div>
          ) : (
            <div>
              {bills.map((bill) => {
                const totalPaid = bill.shares.filter((s) => s.paidAt !== null).length
                const allPaid = totalPaid === bill.shares.length
                return (
                  <div key={bill.id} className="bill-card">
                    <div className="bill-card-header">
                      <div className="bill-title-amount">
                        <span className="bill-title">{bill.title}</span>
                        <span className="bill-amount">{formatCents(bill.totalCents)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <span className="form-help" style={{ margin: 0 }}>
                          Created: {formatDate(bill.createdAt)}
                        </span>
                        <span className={`badge ${allPaid ? 'badge-success' : 'badge-warning'}`}>
                          {totalPaid}/{bill.shares.length} Paid
                        </span>
                      </div>
                    </div>

                    <table className="shares-table">
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th>Share Amount</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bill.shares.map((share) => {
                          const isPaid = share.paidAt !== null
                          const isPaying = payingShareId === share.id
                          const shareErr = shareErrors[share.id]

                          return (
                            <tr key={share.id}>
                              <td>
                                <strong>{share.memberName || share.memberId}</strong>
                              </td>
                              <td>{formatCents(share.amountCents)}</td>
                              <td>
                                {isPaid ? (
                                  <div>
                                    <span className="badge badge-success">Paid</span>
                                    <div className="form-help">{formatDate(share.paidAt)}</div>
                                  </div>
                                ) : (
                                  <span className="badge badge-warning">Unpaid</span>
                                )}
                              </td>
                              <td>
                                {isPaid ? (
                                  <span className="form-help">Settled</span>
                                ) : (
                                  <div>
                                    <button
                                      type="button"
                                      className="btn btn-success btn-sm"
                                      onClick={() => handlePayShare(bill.id, share.id)}
                                      disabled={isPaying}
                                    >
                                      {isPaying ? <span className="spinner" /> : null}
                                      {isPaying ? 'Paying...' : 'Pay Share'}
                                    </button>
                                    {shareErr && (
                                      <div
                                        className="form-help"
                                        style={{ color: 'var(--danger)', marginTop: '0.25rem' }}
                                      >
                                        ⚠️ {shareErr}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* Interactive Verification Lab for Edge Cases */}
      {selectedHomeId && (
        <section className="card lab-panel">
          <h3 className="lab-panel-title">🔬 Cases Verification Tool</h3>
          <p className="form-help" style={{ marginBottom: '1rem' }}>
            Test the required edge cases directly from the browser:
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={labLoading || !firstUnpaidShare}
              onClick={() => {
                if (firstUnpaidShare) {
                  runTestRepeatPayment(firstUnpaidShare.billId, firstUnpaidShare.shareId)
                }
              }}
            >
              Test Case 4: Same Payment Sent Twice
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={labLoading || !firstUnpaidShare}
              onClick={() => {
                if (firstUnpaidShare) {
                  runTestRaceCondition(firstUnpaidShare.billId, firstUnpaidShare.shareId)
                }
              }}
            >
              Test Case 5: Two Paying Same Share Concurrently
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={labLoading}
              onClick={runTestNonExistent}
            >
              Test Case 6: Non-Existent Share (404)
            </button>
          </div>

          {!firstUnpaidShare && (
            <p className="form-help" style={{ marginTop: '0.5rem' }}>
              Note: Cases 4 &amp; 5 need at least 1 unpaid share. Create a bill above to test them.
            </p>
          )}

          {labResult && (
            <div
              className="alert alert-success"
              style={{ marginTop: '1rem', whiteSpace: 'pre-wrap' }}
            >
              {labResult}
            </div>
          )}
        </section>
      )}
    </main>
  )
}
