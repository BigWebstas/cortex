"use client"

import { type ReactNode, createContext, useContext, useEffect, useState, useSyncExternalStore } from "react"

import { type Session, type SessionSnapshot, createSession } from "./session"

const AuthContext = createContext<Session | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session] = useState(createSession)
  // Leaving the route ends every request made with the token.
  useEffect(() => () => session.clear(), [session])
  return <AuthContext.Provider value={session}>{children}</AuthContext.Provider>
}

export function useAuth(): { session: Session; snapshot: SessionSnapshot } {
  const session = useContext(AuthContext)
  if (!session) throw new Error("useAuth requires an AuthProvider")
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  return { session, snapshot }
}
