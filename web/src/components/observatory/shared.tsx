"use client"

import { useState } from "react"

import { Banner } from "@/components/ui/aurora/banner"
import { Button } from "@/components/ui/aurora/button"
import { relativeTime } from "../../lib/observatory/view"

export function When({ value }: { value: string }) {
  // Read once per mount so rendering stays pure; Refresh remounts the lists.
  const [now] = useState(() => Date.now())
  return (
    <time dateTime={value} title={value}>
      {relativeTime(value, now)}
    </time>
  )
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  // No `title`: the banner would render it as a fourth-level heading.
  return (
    <Banner
      variant="error"
      description={`Could not load. ${message}`}
      action={
        <Button type="button" size="sm" onClick={onRetry}>
          Retry
        </Button>
      }
    />
  )
}

export function Toggle({
  pressed,
  onToggle,
  children,
}: {
  pressed: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      size="sm"
      shape="pill"
      variant={pressed ? "aurora" : "neutral"}
      aria-pressed={pressed}
      onClick={onToggle}
    >
      {children}
    </Button>
  )
}

export const toggled = <T,>(values: T[], value: T): T[] =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
