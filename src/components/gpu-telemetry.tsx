import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Meter, MeterIndicator, MeterTrack } from "@/components/ui/meter"
import type { NvmlReadySnapshot } from "@/lib/nvml.types"

const MEBIBYTE = 1024 ** 2
const GIBIBYTE = 1024 ** 3
const TELEMETRY_NUMBER_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
})

type TelemetryConnectionState =
  | "connecting"
  | "live"
  | "refreshing"
  | "retrying"
  | "unavailable"

const TELEMETRY_CONNECTION_COPY: Record<
  TelemetryConnectionState,
  { value: string; detail: string }
> = {
  connecting: {
    value: "Connecting…",
    detail: "Waiting for a current reading.",
  },
  live: {
    value: "Refreshing…",
    detail: "Waiting for the next current reading.",
  },
  refreshing: {
    value: "Refreshing…",
    detail: "Updating readings after the dashboard became visible.",
  },
  retrying: {
    value: "Retrying…",
    detail: "Current readings are temporarily unavailable.",
  },
  unavailable: {
    value: "Unavailable",
    detail: "Current readings are unavailable.",
  },
}

function formatPower(milliwatts: number) {
  return `${TELEMETRY_NUMBER_FORMAT.format(milliwatts / 1_000)} W`
}

function formatMemoryBytes(bytes: number) {
  const useMebibytes = bytes < GIBIBYTE
  const divisor = useMebibytes ? MEBIBYTE : GIBIBYTE
  const unit = useMebibytes ? "MiB" : "GiB"

  return `${TELEMETRY_NUMBER_FORMAT.format(bytes / divisor)} ${unit}`
}

function getPercentage(value: number, maximum: number) {
  return maximum > 0 ? value / maximum * 100 : null
}

function formatPercentage(percentage: number) {
  if (percentage > 0 && percentage < 0.1) {
    return "<0.1%"
  }

  return `${TELEMETRY_NUMBER_FORMAT.format(percentage)}%`
}

function describePercentage(percentage: number) {
  return percentage > 0 && percentage < 0.1
    ? "less than 0.1%"
    : formatPercentage(percentage)
}

function getTelemetryErrors(snapshot: NvmlReadySnapshot) {
  const metrics = [
    { label: "Power usage", metric: snapshot.power.draw },
    { label: "Power cap", metric: snapshot.power.cap },
    { label: "Memory usage", metric: snapshot.memory },
  ] as const

  return metrics.flatMap(({ label, metric }) =>
    metric.status === "unavailable" ? [{ label, message: metric.message }] : []
  )
}

function PowerRail({
  drawMilliwatts,
  capMilliwatts,
}: {
  drawMilliwatts: number
  capMilliwatts: number
}) {
  const percentage = getPercentage(drawMilliwatts, capMilliwatts)

  if (percentage === null) {
    return <CardDescription>Usage / cap unavailable</CardDescription>
  }

  const draw = formatPower(drawMilliwatts)
  const cap = formatPower(capMilliwatts)
  const scaleMaximum = Math.max(drawMilliwatts, capMilliwatts)
  const isOverCap = drawMilliwatts > capMilliwatts
  const overCap = isOverCap ? formatPower(drawMilliwatts - capMilliwatts) : null
  const valueDescription = overCap === null
    ? `${describePercentage(percentage)} of cap`
    : `${overCap} over cap`

  return (
    <Meter
      value={drawMilliwatts}
      min={0}
      max={scaleMaximum}
      aria-label="Power usage relative to cap"
      aria-valuetext={`${draw} power usage, ${cap} cap, ${valueDescription}`}
    >
      <MeterTrack marker>
        <MeterIndicator marker />
        {isOverCap
          ? (
            <span
              aria-hidden="true"
              className="absolute top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-foreground"
              style={{ left: `${capMilliwatts / scaleMaximum * 100}%` }}
            />
          )
          : null}
      </MeterTrack>
      <div className="flex items-center justify-between gap-3">
        <CardDescription>0 W</CardDescription>
        <CardDescription className="tabular-nums">
          {overCap === null
            ? `${formatPercentage(percentage)} of cap`
            : `${overCap} over cap`}
        </CardDescription>
      </div>
    </Meter>
  )
}

function PowerCard({ snapshot }: { snapshot: NvmlReadySnapshot }) {
  const draw = snapshot.power.draw.status === "available"
    ? snapshot.power.draw.value.milliwatts
    : null
  const cap = snapshot.power.cap.status === "available"
    ? snapshot.power.cap.value.milliwatts
    : null

  return (
    <Card size="sm" className="min-h-40">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>Power</CardTitle>
        <CardDescription>Usage / cap</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <p className="font-heading text-2xl font-medium tabular-nums">
            {draw === null ? "Unavailable" : formatPower(draw)}
          </p>
          <CardDescription className="text-right tabular-nums">
            {cap === null ? "Cap unavailable" : `${formatPower(cap)} cap`}
          </CardDescription>
        </div>
        {draw !== null && cap !== null
          ? (
            <PowerRail
              drawMilliwatts={draw}
              capMilliwatts={cap}
            />
          )
          : (
            <CardDescription>
              Usage / cap unavailable
            </CardDescription>
          )}
      </CardContent>
    </Card>
  )
}

function MemoryCard({ snapshot }: { snapshot: NvmlReadySnapshot }) {
  if (snapshot.memory.status === "unavailable") {
    return (
      <Card size="sm" className="min-h-40">
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>Memory usage</CardTitle>
          <CardDescription>Used / total</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <p className="font-heading text-2xl font-medium">Unavailable</p>
            <CardDescription>Total unavailable</CardDescription>
          </div>
          <CardDescription>Usage percentage unavailable</CardDescription>
        </CardContent>
      </Card>
    )
  }

  const { usedBytes, totalBytes } = snapshot.memory.value
  const percentage = getPercentage(usedBytes, totalBytes) ?? 0
  const used = formatMemoryBytes(usedBytes)
  const total = formatMemoryBytes(totalBytes)

  return (
    <Card size="sm" className="min-h-40">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>Memory usage</CardTitle>
        <CardDescription>Used / total</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <p className="font-heading text-2xl font-medium tabular-nums">
            {used}
          </p>
          <CardDescription className="text-right tabular-nums">
            {total} total
          </CardDescription>
        </div>
        <Meter
          value={usedBytes}
          min={0}
          max={totalBytes}
          aria-label="Memory usage"
          aria-valuetext={`${used} used of ${total}, ${
            describePercentage(percentage)
          } used`}
        >
          <MeterTrack>
            <MeterIndicator minimumVisible={usedBytes > 0} />
          </MeterTrack>
          <div className="flex items-center justify-between gap-3">
            <CardDescription>0 B</CardDescription>
            <CardDescription className="tabular-nums">
              {formatPercentage(percentage)} used
            </CardDescription>
          </div>
        </Meter>
      </CardContent>
    </Card>
  )
}

function TelemetryPlaceholderCard({
  title,
  relationship,
  state,
}: {
  title: string
  relationship: string
  state: TelemetryConnectionState
}) {
  const copy = TELEMETRY_CONNECTION_COPY[state]

  return (
    <Card size="sm" className="min-h-40">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>{title}</CardTitle>
        <CardDescription>{relationship}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-4">
        <p className="font-heading text-lg font-medium">{copy.value}</p>
        <CardDescription>{copy.detail}</CardDescription>
      </CardContent>
    </Card>
  )
}

export function GpuTelemetry({
  snapshot,
  connectionState,
  stale,
}: {
  snapshot: NvmlReadySnapshot | null
  connectionState: TelemetryConnectionState
  stale: boolean
}) {
  const errors = snapshot === null ? [] : getTelemetryErrors(snapshot)

  return (
    <>
      {snapshot !== null && stale
        ? (
          <Alert role="status">
            <AlertTitle>Last GPU telemetry</AlertTitle>
            <AlertDescription>
              These readings are from the last successful sample and are not
              current.
            </AlertDescription>
          </Alert>
        )
        : null}
      {errors.length > 0
        ? (
          <Alert role="status">
            <AlertTitle>GPU telemetry partially unavailable</AlertTitle>
            <AlertDescription>
              {errors.map(({ label, message }) => (
                <p key={label}>
                  {label}: {message}
                </p>
              ))}
            </AlertDescription>
          </Alert>
        )
        : null}
      <section
        aria-label="GPU telemetry"
        aria-busy={snapshot === null && connectionState !== "unavailable"}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {snapshot === null
          ? (
            <>
              <TelemetryPlaceholderCard
                title="Power"
                relationship="Usage / cap"
                state={connectionState}
              />
              <TelemetryPlaceholderCard
                title="Memory usage"
                relationship="Used / total"
                state={connectionState}
              />
            </>
          )
          : (
            <>
              <PowerCard snapshot={snapshot} />
              <MemoryCard snapshot={snapshot} />
            </>
          )}
      </section>
    </>
  )
}
