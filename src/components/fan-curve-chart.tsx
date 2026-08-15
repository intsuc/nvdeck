import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react"
import {
  CartesianGrid,
  ComposedChart,
  DefaultZIndexes,
  Line,
  useCartesianScale,
  usePlotArea,
  useYAxisInverseScale,
  XAxis,
  YAxis,
  ZIndexLayer,
} from "recharts"

import { type ChartConfig, ChartContainer } from "@/components/ui/chart"
import type { FanCurvePoint, NvmlReadySnapshot } from "@/lib/nvml.types"

const chartConfig = {
  curve: {
    label: "Fan curve",
    color: "var(--foreground)",
  },
  current: {
    label: "Current reading",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

type FanCurveChartProps = {
  curve: FanCurvePoint[]
  snapshot: NvmlReadySnapshot | null
  disabled: boolean
  onCurveChange: (curve: FanCurvePoint[]) => void
}

type CurveControlPointProps = {
  point: FanCurvePoint
  disabled: boolean
  locked: boolean
  minimum: number
  maximum: number
  onDrag: (fanSpeed: number) => void
  onKeyboardChange: (fanSpeed: number) => void
}

function CurveControlPoint({
  point,
  disabled,
  locked,
  minimum,
  maximum,
  onDrag,
  onKeyboardChange,
}: CurveControlPointProps) {
  const coordinate = useCartesianScale({
    x: point.temperature,
    y: point.fanSpeed,
  })
  const inverseYScale = useYAxisInverseScale()
  const activePointer = useRef<number | null>(null)
  const [isHovered, setIsHovered] = useState(false)

  if (!coordinate) {
    return null
  }

  const { x: cx, y: cy } = coordinate
  const interactionDisabled = disabled || locked
  const labelWidth = 112
  const labelX = cx - labelWidth / 2
  const labelY = cy < 44 ? cy + 14 : cy - 32

  function handleKeyDown(event: ReactKeyboardEvent<SVGRectElement>) {
    if (interactionDisabled) {
      return
    }

    const step = event.shiftKey ? 5 : 1
    let nextValue: number | null = null

    switch (event.key) {
      case "ArrowUp":
      case "ArrowRight":
        nextValue = point.fanSpeed + step
        break
      case "ArrowDown":
      case "ArrowLeft":
        nextValue = point.fanSpeed - step
        break
      case "Home":
        nextValue = minimum
        break
      case "End":
        nextValue = maximum
        break
      default:
        return
    }

    event.preventDefault()
    event.stopPropagation()
    onKeyboardChange(nextValue)
  }

  function handlePointerMove(event: ReactPointerEvent<SVGRectElement>) {
    if (
      activePointer.current !== event.pointerId ||
      interactionDisabled ||
      !inverseYScale
    ) {
      return
    }

    const svg = event.currentTarget.ownerSVGElement
    if (!svg) {
      return
    }

    const bounds = svg.getBoundingClientRect()
    const viewBox = svg.viewBox.baseVal
    if (bounds.height === 0 || viewBox.height === 0) {
      return
    }

    const chartY = viewBox.y +
      ((event.clientY - bounds.top) / bounds.height) * viewBox.height
    const fanSpeed = inverseYScale(chartY)

    if (typeof fanSpeed === "number" && Number.isFinite(fanSpeed)) {
      event.preventDefault()
      onDrag(fanSpeed)
    }
  }

  function finishPointer(event: ReactPointerEvent<SVGRectElement>) {
    if (activePointer.current !== event.pointerId) {
      return
    }

    activePointer.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <>
      {isHovered
        ? (
          <ZIndexLayer zIndex={DefaultZIndexes.label}>
            <g pointerEvents="none" aria-hidden="true">
              <rect
                x={labelX}
                y={labelY}
                width={labelWidth}
                height={22}
                fill="var(--background)"
                stroke="var(--color-curve)"
              />
              <text
                x={cx}
                y={labelY + 15}
                textAnchor="middle"
                fill="var(--foreground)"
                fontSize={11}
              >
                {point.temperature} °C / {point.fanSpeed}%
              </text>
            </g>
          </ZIndexLayer>
        )
        : null}
      <ZIndexLayer zIndex={DefaultZIndexes.scatter}>
        <g>
          <rect
            x={cx - 14}
            y={cy - 14}
            width={28}
            height={28}
            fill="transparent"
            role="slider"
            tabIndex={interactionDisabled ? -1 : 0}
            aria-label={`Fan speed at ${point.temperature} °C`}
            aria-orientation="vertical"
            aria-valuemin={minimum}
            aria-valuemax={maximum}
            aria-valuenow={point.fanSpeed}
            aria-valuetext={`${point.fanSpeed}% at ${point.temperature} °C`}
            aria-disabled={interactionDisabled}
            style={{
              cursor: interactionDisabled ? "default" : "ns-resize",
              touchAction: interactionDisabled ? "auto" : "none",
            }}
            onPointerDown={(event: ReactPointerEvent<SVGRectElement>) => {
              if (interactionDisabled || event.button !== 0) {
                return
              }
              event.preventDefault()
              event.stopPropagation()
              activePointer.current = event.pointerId
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={finishPointer}
            onPointerCancel={finishPointer}
            onLostPointerCapture={() => {
              activePointer.current = null
            }}
            onPointerEnter={() => setIsHovered(true)}
            onPointerLeave={() => setIsHovered(false)}
            onKeyDown={handleKeyDown}
          />
          <rect
            x={cx - 5}
            y={cy - 5}
            width={10}
            height={10}
            fill={locked ? "var(--color-curve)" : "var(--background)"}
            stroke="var(--color-curve)"
            strokeWidth={2}
            pointerEvents="none"
          />
        </g>
      </ZIndexLayer>
    </>
  )
}

function CurrentReading({
  temperature,
  fanSpeed,
}: {
  temperature: number
  fanSpeed: number
}) {
  const coordinate = useCartesianScale({ x: temperature, y: fanSpeed })
  const plotArea = usePlotArea()
  const [isHovered, setIsHovered] = useState(false)

  if (!coordinate || !plotArea) {
    return null
  }

  const labelWidth = 150
  const labelHeight = 24
  const absoluteLabelX = Math.min(
    Math.max(coordinate.x + 10, plotArea.x),
    plotArea.x + plotArea.width - labelWidth,
  )
  const absoluteLabelY = coordinate.y - labelHeight - 10 < plotArea.y
    ? coordinate.y + 10
    : coordinate.y - labelHeight - 10
  const labelX = absoluteLabelX - coordinate.x
  const labelY = absoluteLabelY - coordinate.y
  const movementClassName =
    "transition-transform duration-500 ease-out motion-reduce:transition-none"

  return (
    <>
      <ZIndexLayer zIndex={DefaultZIndexes.scatter}>
        <g
          aria-hidden="true"
          pointerEvents="none"
          className={movementClassName}
          style={{ transform: `translateX(${coordinate.x}px)` }}
        >
          <line
            x1={0}
            x2={0}
            y1={plotArea.y}
            y2={plotArea.y + plotArea.height}
            stroke="var(--color-current)"
            strokeDasharray="3 3"
          />
        </g>
        <g
          aria-hidden="true"
          pointerEvents="none"
          className={movementClassName}
          style={{ transform: `translateY(${coordinate.y}px)` }}
        >
          <line
            x1={plotArea.x}
            x2={plotArea.x + plotArea.width}
            y1={0}
            y2={0}
            stroke="var(--color-current)"
            strokeDasharray="3 3"
          />
        </g>
        <g
          aria-hidden="true"
          className={movementClassName}
          style={{
            transform: `translate(${coordinate.x}px, ${coordinate.y}px)`,
          }}
        >
          <rect
            x={-14}
            y={-14}
            width={28}
            height={28}
            fill="transparent"
            onPointerEnter={() => setIsHovered(true)}
            onPointerLeave={() => setIsHovered(false)}
          />
          <rect
            x={-5}
            y={-5}
            width={10}
            height={10}
            fill="var(--color-current)"
            stroke="var(--background)"
            strokeWidth={2}
            pointerEvents="none"
          />
        </g>
      </ZIndexLayer>
      {isHovered
        ? (
          <ZIndexLayer zIndex={DefaultZIndexes.label}>
            <g
              aria-hidden="true"
              pointerEvents="none"
              className={movementClassName}
              style={{
                transform: `translate(${coordinate.x}px, ${coordinate.y}px)`,
              }}
            >
              <rect
                x={labelX}
                y={labelY}
                width={labelWidth}
                height={labelHeight}
                fill="var(--background)"
                stroke="var(--color-current)"
              />
              <text
                x={labelX + 8}
                y={labelY + 16}
                fill="var(--foreground)"
                fontSize={11}
              >
                Current: {temperature} °C / {fanSpeed}%
              </text>
            </g>
          </ZIndexLayer>
        )
        : null}
    </>
  )
}

export function FanCurveChart({
  curve,
  snapshot,
  disabled,
  onCurveChange,
}: FanCurveChartProps) {
  const fanMin = snapshot?.fanMin ?? curve[0]?.fanSpeed ?? 0
  const fanMax = snapshot?.fanMax ?? curve.at(-1)?.fanSpeed ?? 100
  const currentTemperature = snapshot?.temperature
  const currentFanSpeed = snapshot?.fanSpeed
  const xMinimum = currentTemperature === undefined
    ? 20
    : Math.min(20, Math.floor(currentTemperature / 10) * 10)
  const xMaximum = currentTemperature === undefined
    ? 100
    : Math.max(100, Math.ceil(currentTemperature / 10) * 10)
  const yMaximum = currentFanSpeed === undefined
    ? 100
    : Math.max(100, Math.ceil(currentFanSpeed / 10) * 10)

  function updatePoint(index: number, requestedFanSpeed: number) {
    const point = curve[index]
    const nextPoint = curve[index + 1]
    const previousPoint = curve[index - 1]

    if (!point || !nextPoint) {
      return
    }

    const minimum = previousPoint?.fanSpeed ?? fanMin
    const maximum = nextPoint.fanSpeed
    const fanSpeed = Math.min(
      maximum,
      Math.max(minimum, Math.round(requestedFanSpeed)),
    )

    if (fanSpeed === point.fanSpeed) {
      return
    }

    onCurveChange(
      curve.map((candidate, candidateIndex) =>
        candidateIndex === index ? { ...candidate, fanSpeed } : candidate
      ),
    )
  }

  const currentLabel = snapshot
    ? `Current temperature ${snapshot.temperature} °C, fan speed ${snapshot.fanSpeed}%`
    : "Getting current readings"

  return (
    <ChartContainer
      config={chartConfig}
      className="h-[min(68svh,34rem)] min-h-88 w-full aspect-auto"
      initialDimension={{ width: 960, height: 520 }}
      role="group"
      aria-label={`${currentLabel}. Fan curve editor`}
    >
      <ComposedChart
        accessibilityLayer
        data={curve}
        margin={{ top: 32, right: 24, bottom: 22, left: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="temperature"
          domain={[xMinimum, xMaximum]}
          allowDataOverflow
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => `${value} °C`}
          label={{
            value: "Temperature [°C]",
            position: "insideBottom",
            offset: -14,
            fill: "var(--muted-foreground)",
          }}
        />
        <YAxis
          type="number"
          dataKey="fanSpeed"
          domain={[0, yMaximum]}
          allowDataOverflow
          width={64}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => `${value}%`}
          label={{
            value: "Fan speed [%]",
            angle: -90,
            position: "insideLeft",
            fill: "var(--muted-foreground)",
          }}
        />
        <Line
          type="linear"
          dataKey="fanSpeed"
          name="curve"
          stroke="var(--color-curve)"
          strokeWidth={2}
          isAnimationActive={false}
          activeDot={false}
          dot={false}
        />
        {snapshot
          ? (
            <CurrentReading
              temperature={snapshot.temperature}
              fanSpeed={snapshot.fanSpeed}
            />
          )
          : null}
        {curve.map((point, index) => {
          const nextPoint = curve[index + 1]
          const previousPoint = curve[index - 1]

          return (
            <CurveControlPoint
              key={point.temperature}
              point={point}
              disabled={disabled}
              locked={!nextPoint}
              minimum={previousPoint?.fanSpeed ?? fanMin}
              maximum={nextPoint?.fanSpeed ?? fanMax}
              onDrag={(fanSpeed) => updatePoint(index, fanSpeed)}
              onKeyboardChange={(fanSpeed) => updatePoint(index, fanSpeed)}
            />
          )
        })}
      </ComposedChart>
    </ChartContainer>
  )
}
