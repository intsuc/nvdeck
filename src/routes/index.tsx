import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"

import { FanCurveChart } from "@/components/fan-curve-chart"
import { GpuTelemetry } from "@/components/gpu-telemetry"
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
  type NvmlReadySnapshot,
  type NvmlSnapshot,
} from "@/lib/nvml.types"

const POLL_INTERVAL_MS = 2_000
const REQUEST_TIMEOUT_MS = 8_000
const STATUS_BADGE_CLASS =
  "h-auto max-w-full min-w-0 shrink py-1 text-center whitespace-normal wrap-anywhere"

export const Route = createFileRoute("/")({ component: Dashboard })

type PendingAction = "apply" | "restore" | null
type ConnectionState =
  | "connecting"
  | "live"
  | "refreshing"
  | "retrying"
  | "unavailable"
type CurveEditorState = {
  base: FanCurvePoint[] | null
  draft: FanCurvePoint[]
}

function requestErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function withRequestTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    return await request(controller.signal)
  } catch (error) {
    if (timedOut) {
      throw new Error(
        "The request timed out. Check the connection while the dashboard retries.",
        { cause: error },
      )
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function fanCurvesEqual(left: FanCurvePoint[], right: FanCurvePoint[]) {
  return left.length === right.length && left.every((point, index) => {
    const comparedPoint = right[index]
    return comparedPoint?.temperature === point.temperature &&
      comparedPoint.fanSpeed === point.fanSpeed
  })
}

function formatSampleAge(sampledAt: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - sampledAt) / 1_000))

  if (seconds < 5) {
    return "just now"
  }

  if (seconds < 60) {
    return `${seconds} seconds ago`
  }

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`
  }

  const hours = Math.floor(minutes / 60)
  return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
}

function SampleTimestamp({
  sampledAt,
  stale,
}: {
  sampledAt: number
  stale: boolean
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined

    function stopClock() {
      if (interval !== undefined) {
        clearInterval(interval)
        interval = undefined
      }
    }

    function startClock(refreshImmediately: boolean) {
      stopClock()
      if (document.visibilityState !== "visible") {
        return
      }

      if (refreshImmediately) {
        setNow(Date.now())
      }
      interval = setInterval(() => setNow(Date.now()), 1_000)
    }

    function handleVisibilityChange() {
      startClock(true)
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    startClock(false)

    return () => {
      stopClock()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  return (
    <span>
      {stale ? "Last sample" : "Sampled"} {formatSampleAge(sampledAt, now)}
    </span>
  )
}

function mergeReadyCurve(
  state: CurveEditorState,
  nextCurve: FanCurvePoint[],
  forceDraft = false,
): CurveEditorState {
  const wasDirty = state.base !== null &&
    !fanCurvesEqual(state.draft, state.base)

  return {
    base: nextCurve,
    draft: forceDraft || !wasDirty ? nextCurve : state.draft,
  }
}

function Dashboard() {
  const [snapshot, setSnapshot] = useState<NvmlSnapshot | null>(null)
  const [lastReadySnapshot, setLastReadySnapshot] = useState<
    NvmlReadySnapshot | null
  >(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    "connecting",
  )
  const [curveEditor, setCurveEditor] = useState<CurveEditorState>(() => ({
    base: null,
    draft: createDefaultFanCurve(),
  }))
  const mutationEpochRef = useRef(0)
  const mutationPendingRef = useRef(false)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [actionStatus, setActionStatus] = useState<string | null>(null)
  const [controlOutcomeUnknown, setControlOutcomeUnknown] = useState(false)

  const draftCurve = curveEditor.draft
  const isDirty = curveEditor.base !== null &&
    !fanCurvesEqual(curveEditor.draft, curveEditor.base)

  useEffect(() => {
    let cancelled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let activeController: AbortController | undefined
    let pollOnCompletion = false

    function clearScheduledPoll() {
      if (timeout !== undefined) {
        clearTimeout(timeout)
        timeout = undefined
      }
    }

    function schedulePoll() {
      clearScheduledPoll()

      if (cancelled || document.visibilityState !== "visible") {
        return
      }

      timeout = setTimeout(() => {
        timeout = undefined
        void poll()
      }, POLL_INTERVAL_MS)
    }

    function poll() {
      if (
        cancelled || document.visibilityState !== "visible"
      ) {
        return
      }

      if (mutationPendingRef.current) {
        schedulePoll()
        return
      }

      if (activeController !== undefined) {
        return
      }

      const mutationEpoch = mutationEpochRef.current
      const controller = new AbortController()
      activeController = controller
      let timedOut = false
      const requestTimeout = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, REQUEST_TIMEOUT_MS)

      void getNvmlSnapshot({
        signal: controller.signal,
      })
        .then((nextSnapshot) => {
          if (cancelled) {
            return
          }

          if (mutationEpoch === mutationEpochRef.current) {
            setSnapshot(nextSnapshot)
            setRequestError(null)

            if (nextSnapshot.status === "ready") {
              setLastReadySnapshot(nextSnapshot)
              setConnectionState("live")
              setControlOutcomeUnknown(false)
              setCurveEditor((current) =>
                mergeReadyCurve(current, nextSnapshot.curve)
              )
            } else {
              setConnectionState("unavailable")
            }
          }
        })
        .catch((error: unknown) => {
          if (
            !cancelled && mutationEpoch === mutationEpochRef.current &&
            (!controller.signal.aborted || timedOut)
          ) {
            setSnapshot(null)
            setConnectionState("retrying")
            setRequestError(
              timedOut
                ? "The request timed out. Retrying the NVML connection."
                : requestErrorMessage(error),
            )
          }
        })
        .finally(() => {
          clearTimeout(requestTimeout)

          if (activeController === controller) {
            activeController = undefined
          }

          if (!cancelled) {
            if (pollOnCompletion && document.visibilityState === "visible") {
              pollOnCompletion = false
              poll()
            } else {
              schedulePoll()
            }
          }
        })
    }

    function handleVisibilityChange() {
      clearScheduledPoll()

      if (document.visibilityState !== "visible") {
        pollOnCompletion = false
        activeController?.abort()
        setSnapshot(null)
        setConnectionState((current) =>
          current === "connecting" ? current : "refreshing"
        )
        return
      }

      if (activeController !== undefined) {
        pollOnCompletion = true
        return
      }

      void poll()
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    void poll()

    return () => {
      cancelled = true
      clearScheduledPoll()
      activeController?.abort()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  const readySnapshot = snapshot?.status === "ready" ? snapshot : null
  const identitySnapshot = readySnapshot ?? lastReadySnapshot
  const knownControlSnapshot = readySnapshot ?? lastReadySnapshot
  const unavailableMessage = snapshot?.status === "unavailable"
    ? snapshot.message
    : null
  function applyCurve() {
    if (!readySnapshot || pendingAction !== null) {
      return
    }

    setPendingAction("apply")
    mutationPendingRef.current = true
    setRequestError(null)
    setActionStatus(null)
    mutationEpochRef.current += 1

    void withRequestTimeout((signal) =>
      setNvmlFanCurve({
        data: { curve: draftCurve },
        signal,
      })
    )
      .then((nextSnapshot) => {
        mutationEpochRef.current += 1
        setSnapshot(nextSnapshot)
        setRequestError(null)

        if (nextSnapshot.status === "ready") {
          setLastReadySnapshot(nextSnapshot)
          setConnectionState("live")
          setControlOutcomeUnknown(false)
          setCurveEditor((current) =>
            mergeReadyCurve(current, nextSnapshot.curve)
          )
        } else {
          setConnectionState("unavailable")
          setControlOutcomeUnknown(true)
        }

        if (
          nextSnapshot.status === "ready" &&
          nextSnapshot.mode === "curve" &&
          nextSnapshot.controlError === null
        ) {
          setCurveEditor((current) =>
            mergeReadyCurve(current, nextSnapshot.curve, true)
          )
          setActionStatus(
            nextSnapshot.storageError === null
              ? "Fan curve applied and saved."
              : "Fan curve applied. Saving the curve needs attention.",
          )
        }
      })
      .catch((error: unknown) => {
        mutationEpochRef.current += 1
        setSnapshot(null)
        setConnectionState("retrying")
        setControlOutcomeUnknown(true)
        setRequestError(requestErrorMessage(error))
      })
      .finally(() => {
        mutationPendingRef.current = false
        setPendingAction(null)
      })
  }

  function restoreAutomatic() {
    if (pendingAction !== null) {
      return
    }

    setPendingAction("restore")
    mutationPendingRef.current = true
    setRequestError(null)
    setActionStatus(null)
    mutationEpochRef.current += 1

    void withRequestTimeout((signal) => restoreNvmlAutomatic({ signal }))
      .then((nextSnapshot) => {
        mutationEpochRef.current += 1
        setSnapshot(nextSnapshot)
        setRequestError(null)

        if (nextSnapshot.status === "ready") {
          setLastReadySnapshot(nextSnapshot)
          setConnectionState("live")
          setControlOutcomeUnknown(false)
          setCurveEditor((current) =>
            mergeReadyCurve(current, nextSnapshot.curve)
          )
          setActionStatus(
            nextSnapshot.mode === "automatic"
              ? "Automatic fan control restored."
              : null,
          )
        } else {
          setConnectionState("unavailable")
          setControlOutcomeUnknown(true)
        }
      })
      .catch((error: unknown) => {
        mutationEpochRef.current += 1
        setSnapshot(null)
        setConnectionState("retrying")
        setControlOutcomeUnknown(true)
        setRequestError(requestErrorMessage(error))
      })
      .finally(() => {
        mutationPendingRef.current = false
        setPendingAction(null)
      })
  }

  const controlBadge = knownControlSnapshot
    ? knownControlSnapshot.mode === "manual"
      ? (
        <Badge variant="destructive" className={STATUS_BADGE_CLASS}>
          {readySnapshot === null ? "Last known: " : ""}Manual control
        </Badge>
      )
      : (
        <Badge
          variant={knownControlSnapshot.mode === "curve"
            ? "default"
            : "secondary"}
          className={STATUS_BADGE_CLASS}
        >
          {readySnapshot === null ? "Last known: " : ""}
          {knownControlSnapshot.mode === "curve"
            ? "Curve control"
            : "Automatic control"}
        </Badge>
      )
    : null
  const connectionBadge = connectionState === "live"
    ? <Badge variant="outline" className={STATUS_BADGE_CLASS}>Live</Badge>
    : connectionState === "unavailable"
    ? (
      <Badge variant="destructive" className={STATUS_BADGE_CLASS}>
        Unavailable
      </Badge>
    )
    : connectionState === "retrying"
    ? (
      <Badge variant="destructive" className={STATUS_BADGE_CLASS}>
        <Spinner data-icon="inline-start" aria-hidden="true" />
        Connection lost · Retrying…
      </Badge>
    )
    : connectionState === "refreshing"
    ? (
      <Badge variant="secondary" className={STATUS_BADGE_CLASS}>
        <Spinner data-icon="inline-start" aria-hidden="true" />
        Refreshing…
      </Badge>
    )
    : (
      <Badge variant="secondary" className={STATUS_BADGE_CLASS}>
        <Spinner data-icon="inline-start" aria-hidden="true" />
        Connecting…
      </Badge>
    )

  return (
    <main className="grid min-h-svh place-items-center px-3 py-6 sm:px-6">
      <Card className="w-full max-w-6xl">
        <CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
          <CardTitle>
            <h1>NVDeck</h1>
          </CardTitle>
          <CardDescription className="min-w-0 wrap-anywhere tabular-nums">
            {identitySnapshot
              ? (
                <>
                  {identitySnapshot.gpuName} · GPU {identitySnapshot.gpuIndex}
                  {" · "}
                  {identitySnapshot.fanCount}{" "}
                  {identitySnapshot.fanCount === 1 ? "fan" : "fans"} ·{" "}
                  <SampleTimestamp
                    sampledAt={identitySnapshot.sampledAt}
                    stale={readySnapshot === null}
                  />
                </>
              )
              : connectionState === "connecting"
              ? "Checking the NVML connection for GPU 0"
              : `GPU 0 · ${
                connectionState === "unavailable"
                  ? "NVML unavailable"
                  : "Waiting to reconnect"
              }`}
          </CardDescription>
          <CardAction
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="col-start-1 row-start-3 row-span-1 mt-2 flex min-w-0 flex-wrap justify-self-start gap-2 md:col-start-2 md:row-start-1 md:row-span-2 md:mt-0 md:justify-self-end"
          >
            {controlBadge}
            {controlOutcomeUnknown
              ? (
                <Badge
                  variant="destructive"
                  className={STATUS_BADGE_CLASS}
                >
                  Control state unknown
                </Badge>
              )
              : null}
            {connectionBadge}
            {isDirty
              ? (
                <Badge variant="outline" className={STATUS_BADGE_CLASS}>
                  Unapplied changes
                </Badge>
              )
              : null}
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {unavailableMessage
            ? (
              <Alert variant="destructive">
                <AlertTitle>NVML unavailable</AlertTitle>
                <AlertDescription>
                  <p>{unavailableMessage}</p>
                  <p>
                    {lastReadySnapshot === null
                      ? "The chart shows an example curve until a saved curve can be loaded."
                      : "The last loaded curve remains visible for reference; current readings are hidden."}
                  </p>
                </AlertDescription>
              </Alert>
            )
            : null}
          {knownControlSnapshot?.controlError
            ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {readySnapshot === null ? "Last known: " : ""}
                  {knownControlSnapshot.mode === "manual"
                    ? "Automatic control must be restored"
                    : "Fan control stopped"}
                </AlertTitle>
                <AlertDescription>
                  {knownControlSnapshot.controlError}
                </AlertDescription>
              </Alert>
            )
            : null}
          {readySnapshot?.storageError
            ? (
              <Alert role="status">
                <AlertTitle>Fan curve storage warning</AlertTitle>
                <AlertDescription>
                  {readySnapshot.storageError}
                </AlertDescription>
              </Alert>
            )
            : null}
          {requestError
            ? (
              <Alert variant="destructive">
                <AlertTitle>Request failed</AlertTitle>
                <AlertDescription>
                  <p>{requestError}</p>
                  <p>
                    {lastReadySnapshot === null
                      ? "The chart shows an example curve until a saved curve can be loaded."
                      : "The last loaded curve remains visible for reference; current readings are marked as the last sample."}
                  </p>
                </AlertDescription>
              </Alert>
            )
            : null}
          <GpuTelemetry
            snapshot={identitySnapshot}
            connectionState={connectionState}
            stale={readySnapshot === null && identitySnapshot !== null}
          />
          <FanCurveChart
            curve={draftCurve}
            snapshot={readySnapshot}
            disabled={!readySnapshot || readySnapshot.mode === "manual" ||
              pendingAction !== null}
            onCurveChange={(curve) => {
              setActionStatus(null)
              setCurveEditor((current) => ({ ...current, draft: curve }))
            }}
          />
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3 md:flex-row md:items-center md:justify-between">
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="min-h-4 min-w-0 wrap-anywhere text-xs text-muted-foreground"
          >
            {actionStatus}
          </p>
          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row">
            <Button
              variant="outline"
              className="w-full shrink whitespace-normal md:w-auto md:shrink-0 md:whitespace-nowrap"
              disabled={pendingAction !== null ||
                (!controlOutcomeUnknown &&
                  snapshot?.status !== "unavailable" &&
                  (knownControlSnapshot === null ||
                    knownControlSnapshot.mode === "automatic"))}
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
              className="w-full shrink whitespace-normal md:w-auto md:shrink-0 md:whitespace-nowrap"
              disabled={!readySnapshot || pendingAction !== null ||
                readySnapshot.mode === "manual" ||
                (!isDirty && readySnapshot.mode === "curve" &&
                  readySnapshot.storageError === null)}
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
