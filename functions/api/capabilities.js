/**
 * Fetch interest-graph data from Threshold for the authenticated user.
 *
 * GET /api/capabilities?token=<threshold-jwt>
 *
 * Returns the user's interest-graph data if they have it provisioned
 * and DeckyDecks is authorized to consume it via the trust graph.
 */

const THRESHOLD_BASE = 'https://thresholdlabs.io'

export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url)
    const token = url.searchParams.get('token')

    if (!token) {
      return Response.json({ interests: null, reason: 'no token' })
    }

    // Check what capabilities are available for this user via DeckyDecks
    const capsRes = await fetch(`${THRESHOLD_BASE}/api/apps/deckydecks/capabilities`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!capsRes.ok) {
      return Response.json({ interests: null, reason: 'capability lookup failed' })
    }

    const caps = await capsRes.json()
    const hasInterestGraph = Array.isArray(caps) && caps.some(
      c => c.capability_id === 'interest-graph'
    )

    if (!hasInterestGraph) {
      return Response.json({ interests: null, reason: 'interest-graph not composed' })
    }

    // Fetch the user's interest-graph data
    const graphRes = await fetch(`${THRESHOLD_BASE}/api/capabilities/interest-graph/data`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!graphRes.ok) {
      return Response.json({ interests: null, reason: 'no interest data available' })
    }

    const data = await graphRes.json()
    return Response.json({ interests: data })
  } catch (err) {
    return Response.json({ interests: null, reason: err.message })
  }
}
