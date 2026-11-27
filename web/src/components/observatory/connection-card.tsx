"use client"

import { type FormEvent, useEffect, useState } from "react"

import { Banner } from "@/components/ui/aurora/banner"
import { Button } from "@/components/ui/aurora/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/aurora/card"
import { Input } from "@/components/ui/aurora/input"
import { ObservatoryApiError, listRepositories } from "../../lib/observatory/api"
import { useAuth } from "../../lib/observatory/auth-context"

type Check = { epoch: number; failed: boolean }

export function ConnectionCard() {
  const { session, snapshot } = useAuth()
  const [check, setCheck] = useState<Check | null>(null)

  // Confirms the token before the page claims to be connected.
  useEffect(() => {
    const token = session.getToken()
    if (snapshot.status !== "connected" || !token) return
    const { epoch, signal } = snapshot
    listRepositories(token, { limit: 1 }, { signal })
      .then(() => setCheck({ epoch, failed: false }))
      .catch((error: unknown) => {
        if (signal.aborted) return
        if (error instanceof ObservatoryApiError && (error.status === 401 || error.status === 403)) {
          session.unauthorized(epoch)
        } else {
          setCheck({ epoch, failed: true })
        }
      })
  }, [session, snapshot])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const token = new FormData(form).get("token")
    // Empty the field so the token does not stay in the page.
    form.reset()
    session.connect(typeof token === "string" ? token : "")
  }

  const current = check?.epoch === snapshot.epoch ? check : null
  const connected = snapshot.status === "connected"

  return (
    <div className="grid gap-3">
      {snapshot.status === "unauthorized" && (
        <Banner
          variant="error"
          description="Token rejected. The token was cleared from memory. Enter a valid CORTEX_API_TOKEN to reconnect."
        />
      )}
      {current?.failed && (
        <Banner
          variant="warn"
          description="Cortex is unavailable. The server did not answer. Clear the token and connect again."
        />
      )}
      <Card>
        <CardHeader>
          <CardTitle as="h2">
            <span data-connection-state>
              {connected ? (current && !current.failed ? "Connected" : "Connecting") : "Disconnected"}
            </span>
          </CardTitle>
          <CardDescription>
            The bearer token is kept in memory only and is forgotten when the page closes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {connected ? (
            <Button type="button" onClick={() => session.clear()}>
              Clear token
            </Button>
          ) : (
            <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={handleSubmit}>
              <label className="grid gap-1 text-sm" htmlFor="observatory-token">
                Bearer token
                <Input id="observatory-token" name="token" type="password" autoComplete="off" />
              </label>
              <Button type="submit" variant="aurora">
                Connect
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
