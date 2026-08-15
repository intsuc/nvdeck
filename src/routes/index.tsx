import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"

import { FanCurveChart } from "@/components/fan-curve-chart"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import {
  getNvmlSnapshot,
  restoreNvmlAutomatic,
  setNvmlFanCurve,
} from "@/lib/nvml.functions"
import {
  createDefaultFanCurve,
  type FanCurvePoint,
  type NvmlSnapshot,
} from "@/lib/nvml.types"

const POLL_INTERVAL_MS = 2_000

export const Route = createFileRoute("/")({ component: Dashboard })

type PendingAction = "apply" | "restore" | null

function fanCurvesEqual(left: FanCurvePoint[], right: FanCurvePoint[]) {
  return left.length === right.length && left.every((point, index) => {
    const comparedPoint = right[index]
    return comparedPoint?.temperature === point.temperature &&
      comparedPoint.fanSpeed === point.fanSpeed
  })
}

function Dashboard() {
  const [snapshot, setSnapshot] = useState<NvmlSnapshot | null>(null)
  const [draftCurve, setDraftCurve] = useState<FanCurvePoint[]>(() =>
    createDefaultFanCurve()
  )
  const [isDirty, setIsDirty] = useState(false)
  const isDirtyRef = useRef(false)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [requestError, setRequestError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    async function poll() {
      try {
        const nextSnapshot = await getNvmlSnapshot()

        if (cancelled) {
          return
        }

        setSnapshot(nextSnapshot)
        setRequestError(null)

        if (!isDirtyRef.current) {
          setDraftCurve(nextSnapshot.curve)
        }
      } catch (error) {
        if (!cancelled) {
          setSnapshot(null)
          setRequestError(
            error instanceof Error ? error.message : String(error),
          )
        }
      }

      if (!cancelled) {
        timeout = setTimeout(poll, POLL_INTERVAL_MS)
      }
    }

    void poll()

    return () => {
      cancelled = true
      if (timeout !== undefined) {
        clearTimeout(timeout)
      }
    }
  }, [])

  const readySnapshot = snapshot?.status === "ready" ? snapshot : null
  const unavailableMessage = snapshot?.status === "unavailable"
    ? snapshot.message
    : null

  async function applyCurve() {
    if (!readySnapshot || pendingAction !== null) {
      return
    }

    setPendingAction("apply")
    setRequestError(null)

    try {
      const nextSnapshot = await setNvmlFanCurve({
        data: { curve: draftCurve },
      })
      setSnapshot(nextSnapshot)

      if (nextSnapshot.status === "ready") {
        setDraftCurve(nextSnapshot.curve)
        isDirtyRef.current = false
        setIsDirty(false)
      }
    } catch (error) {
      setSnapshot(null)
      setRequestError(error instanceof Error ? error.message : String(error))
    }

    setPendingAction(null)
  }

  async function restoreAutomatic() {
    if (pendingAction !== null) {
      return
    }

    setPendingAction("restore")
    setRequestError(null)

    try {
      const nextSnapshot = await restoreNvmlAutomatic()
      setSnapshot(nextSnapshot)

      if (nextSnapshot.status === "ready") {
        setDraftCurve(nextSnapshot.curve)
        isDirtyRef.current = false
        setIsDirty(false)
      }
    } catch (error) {
      setSnapshot(null)
      setRequestError(error instanceof Error ? error.message : String(error))
    }

    setPendingAction(null)
  }

  const statusBadge = readySnapshot
    ? readySnapshot.mode === "manual"
      ? <Badge variant="destructive">Manual control</Badge>
      : (
        <Badge
          variant={readySnapshot.mode === "curve" ? "default" : "secondary"}
        >
          {readySnapshot.mode === "curve"
            ? "Curve control"
            : "Automatic control"}
        </Badge>
      )
    : unavailableMessage
    ? <Badge variant="destructive">Unavailable</Badge>
    : (
      <Badge variant="secondary">
        <Spinner data-icon="inline-start" aria-hidden="true" />
        Connecting…
      </Badge>
    )

  return (
    <main className="grid min-h-svh place-items-center px-3 py-6 sm:px-6">
      <Card className="w-full max-w-6xl">
        <CardHeader>
          <CardTitle role="heading" aria-level={1}>NVDeck</CardTitle>
          <CardDescription>
            {readySnapshot
              ? `${readySnapshot.gpuName} · GPU ${readySnapshot.gpuIndex} · ${readySnapshot.fanCount} ${
                readySnapshot.fanCount === 1 ? "fan" : "fans"
              }`
              : "Checking the NVML connection for GPU 0"}
          </CardDescription>
          <CardAction className="flex gap-2">
            {statusBadge}
            {isDirty
              ? <Badge variant="outline">Unapplied changes</Badge>
              : null}
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {unavailableMessage
            ? (
              <Alert variant="destructive">
                <AlertTitle>NVML unavailable</AlertTitle>
                <AlertDescription>{unavailableMessage}</AlertDescription>
              </Alert>
            )
            : null}
          {readySnapshot?.controlError
            ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {readySnapshot.mode === "manual"
                    ? "Automatic control must be restored"
                    : "Fan control stopped"}
                </AlertTitle>
                <AlertDescription>
                  {readySnapshot.controlError}
                </AlertDescription>
              </Alert>
            )
            : null}
          {requestError
            ? (
              <Alert variant="destructive">
                <AlertTitle>Request failed</AlertTitle>
                <AlertDescription>{requestError}</AlertDescription>
              </Alert>
            )
            : null}
          <FanCurveChart
            curve={draftCurve}
            snapshot={readySnapshot}
            disabled={!readySnapshot || readySnapshot.mode === "manual" ||
              pendingAction !== null}
            onCurveChange={(curve) => {
              const isChanged = readySnapshot !== null &&
                !fanCurvesEqual(curve, readySnapshot.curve)
              isDirtyRef.current = isChanged
              setDraftCurve(curve)
              setIsDirty(isChanged)
            }}
          />
        </CardContent>
        <CardFooter className="justify-end">
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={snapshot === null ||
                readySnapshot?.mode === "automatic" || pendingAction !== null}
              onClick={() => void restoreAutomatic()}
            >
              {pendingAction === "restore"
                ? (
                  <>
                    <Spinner data-icon="inline-start" aria-hidden="true" />
                    Restoring…
                  </>
                )
                : "Restore automatic control"}
            </Button>
            <Button
              disabled={!readySnapshot || pendingAction !== null ||
                readySnapshot.mode === "manual" ||
                (!isDirty && readySnapshot.mode === "curve")}
              onClick={() => void applyCurve()}
            >
              {pendingAction === "apply"
                ? (
                  <>
                    <Spinner data-icon="inline-start" aria-hidden="true" />
                    Applying…
                  </>
                )
                : "Apply curve"}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </main>
  )
}
