import { NextRequest } from "next/server"

const HONO_API = "http://localhost:3001/api/projects"

export async function GET() {
  try {
    const res = await fetch(HONO_API)
    if (!res.ok) {
      return Response.json(
        { error: `Upstream error: ${res.status}` },
        { status: res.status }
      )
    }
    const data = await res.json()
    return Response.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch projects"
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const res = await fetch(HONO_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      return Response.json(
        { error: `Upstream error: ${res.status}`, details: text },
        { status: res.status }
      )
    }
    const data = await res.json()
    return Response.json(data, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create project"
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, ...updates } = body
    if (!id) {
      return Response.json({ error: "Project id is required" }, { status: 400 })
    }
    const res = await fetch(`${HONO_API}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    })
    if (!res.ok) {
      const text = await res.text()
      return Response.json(
        { error: `Upstream error: ${res.status}`, details: text },
        { status: res.status }
      )
    }
    const data = await res.json()
    return Response.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update project"
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) {
      return Response.json({ error: "Project id is required" }, { status: 400 })
    }
    const res = await fetch(`${HONO_API}/${id}`, { method: "DELETE" })
    if (!res.ok) {
      return Response.json(
        { error: `Upstream error: ${res.status}` },
        { status: res.status }
      )
    }
    return new Response(null, { status: 204 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete project"
    return Response.json({ error: msg }, { status: 500 })
  }
}
