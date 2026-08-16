import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  useLayoutEffect,
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
  useXAxisDomain,
  useYAxisDomain,
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

type HorizontalViewport = { x: number; width: number }

type CurveControlPointProps = {
  point: FanCurvePoint
  currentReading: {
    temperature: number
    fanSpeed: number
    fanSpeedLabel: "Average fan speed" | "Fan speed"
  } | null
  horizontalViewport: HorizontalViewport
  disabled: boolean
  locked: boolean
  touchRevealed: boolean
  minimum: number
  maximum: number
  onTouchReveal: () => void
  onDrag: (fanSpeed: number) => void
  onKeyboardChange: (fanSpeed: number) => void
}

type PointFeedbackProps = {
  anchorX: number
  anchorY: number
  lines: string[]
  plotArea: { x: number; y: number; width: number; height: number }
  horizontalViewport: HorizontalViewport
  tone: string
  variant: "annotation" | "tooltip"
  groupRef?: Ref<SVGGElement>
}

function PointFeedback({
  anchorX,
  anchorY,
  lines,
  plotArea,
  horizontalViewport,
  tone,
  variant,
  groupRef,
}: PointFeedbackProps) {
  const plotRight = plotArea.x + plotArea.width
  const visibleLeft = horizontalViewport.width > 0
    ? horizontalViewport.x
    : plotArea.x
  const visibleRight = horizontalViewport.width > 0
    ? horizontalViewport.x + horizontalViewport.width
    : plotRight
  const visibleWidth = Math.max(1, visibleRight - visibleLeft)
  const preferredWidth = lines.length === 1 ? 320 : 400
  const width = Math.min(preferredWidth, plotArea.width, visibleWidth)
  const preferredHeight = lines.length === 1 ? 112 : lines.length * 80 + 16
  const height = Math.min(preferredHeight, plotArea.height)
  const plotBottom = plotArea.y + plotArea.height
  const spaceAbove = anchorY - plotArea.y
  const spaceBelow = plotBottom - anchorY
  const placeAbove = spaceAbove >= height + 8 || spaceAbove >= spaceBelow
  const idealY = placeAbove ? anchorY - height - 8 : anchorY + 8
  const x = Math.min(
    Math.max(anchorX - width / 2, visibleLeft),
    visibleRight - width,
  )
  const y = Math.min(
    Math.max(idealY, plotArea.y),
    plotBottom - height,
  )

  return (
    <g
      ref={groupRef}
      aria-hidden="true"
      pointerEvents="none"
      style={{ transform: `translate(${anchorX}px, ${anchorY}px)` }}
    >
      <foreignObject
        x={x - anchorX}
        y={y - anchorY}
        width={width}
        height={height}
      >
        <div
          className={`flex h-full ${placeAbove ? "items-end" : "items-start"}`}
        >
          <div
            className={variant === "tooltip"
              ? "w-full wrap-anywhere border border-current bg-background px-2 py-1 text-center text-xs leading-tight text-foreground"
              : "w-full wrap-anywhere border-l-2 border-current bg-background px-2 py-1 text-center text-xs leading-tight text-foreground"}
            style={{ color: tone }}
          >
            {lines.map((line) => (
              <span key={line} className="block text-foreground">
                {line}
              </span>
            ))}
          </div>
        </div>
      </foreignObject>
    </g>
  )
}

function CurveControlPoint({
  point,
  currentReading,
  horizontalViewport,
  disabled,
  locked,
  touchRevealed,
  minimum,
  maximum,
  onTouchReveal,
  onDrag,
  onKeyboardChange,
}: CurveControlPointProps) {
  const coordinate = useCartesianScale({
    x: point.temperature,
    y: point.fanSpeed,
  })
  const currentCoordinate = useCartesianScale({
    x: currentReading?.temperature ?? point.temperature,
    y: currentReading?.fanSpeed ?? point.fanSpeed,
  })
  const inverseYScale = useYAxisInverseScale()
  const plotArea = usePlotArea()
  const activePointer = useRef<number | null>(null)
  const pendingFocusPointerType = useRef<string | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [hasVisibleFocus, setHasVisibleFocus] = useState(false)

  if (!coordinate || !plotArea) {
    return null
  }

  const { x: cx, y: cy } = coordinate
  const overlapsCurrentReading = currentReading !== null &&
    currentCoordinate !== undefined &&
    Math.abs(currentCoordinate.x - cx) < 44 &&
    Math.abs(currentCoordinate.y - cy) < 44
  const interactionDisabled = disabled || locked
  const feedbackVariant = isHovered
    ? "tooltip"
    : hasVisibleFocus || touchRevealed
    ? "annotation"
    : null
  const feedbackLines = [
    `${
      overlapsCurrentReading ? "Control: " : ""
    }${point.temperature} °C / ${point.fanSpeed}%`,
    ...(locked ? ["Safety limit · locked"] : []),
    ...(overlapsCurrentReading && currentReading
      ? [
        `Current: ${currentReading.temperature} °C / ${currentReading.fanSpeed}%`,
        currentReading.fanSpeedLabel,
      ]
      : []),
  ]
  const currentReadingDescription = overlapsCurrentReading && currentReading
    ? ` Current reading: ${currentReading.temperature} °C and ${currentReading.fanSpeed}% ${currentReading.fanSpeedLabel.toLowerCase()}.`
    : ""

  function handleKeyDown(event: ReactKeyboardEvent<SVGRectElement>) {
    setHasVisibleFocus(true)

    if (interactionDisabled) {
      if (
        locked &&
        [
          "ArrowUp",
          "ArrowRight",
          "ArrowDown",
          "ArrowLeft",
          "Home",
          "End",
        ].includes(event.key)
      ) {
        event.preventDefault()
        event.stopPropagation()
      }
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
      {feedbackVariant
        ? (
          <ZIndexLayer zIndex={DefaultZIndexes.label}>
            <PointFeedback
              anchorX={cx}
              anchorY={cy}
              lines={feedbackLines}
              plotArea={plotArea}
              horizontalViewport={horizontalViewport}
              tone="var(--color-curve)"
              variant={feedbackVariant}
            />
          </ZIndexLayer>
        )
        : null}
      <ZIndexLayer zIndex={DefaultZIndexes.scatter}>
        <g>
          <rect
            x={cx - 22}
            y={cy - 22}
            width={44}
            height={44}
            fill="transparent"
            stroke="transparent"
            strokeWidth={2}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={locked
              ? `Fan speed at ${point.temperature} °C, safety limit, locked.${currentReadingDescription}`
              : `Fan speed at ${point.temperature} °C.${currentReadingDescription}`}
            aria-orientation="vertical"
            aria-valuemin={minimum}
            aria-valuemax={maximum}
            aria-valuenow={point.fanSpeed}
            aria-valuetext={locked
              ? `${point.fanSpeed}% at ${point.temperature} °C. Safety limit, locked.${currentReadingDescription}`
              : `${point.fanSpeed}% at ${point.temperature} °C.${currentReadingDescription}`}
            aria-disabled={disabled || undefined}
            aria-readonly={locked || undefined}
            style={{
              cursor: interactionDisabled ? "default" : "ns-resize",
              touchAction: interactionDisabled ? "manipulation" : "none",
            }}
            onPointerDown={(event: ReactPointerEvent<SVGRectElement>) => {
              if (!disabled && event.pointerType === "mouse") {
                pendingFocusPointerType.current = "mouse"
                event.currentTarget.focus({ preventScroll: true })
              } else {
                pendingFocusPointerType.current = null
              }

              if (event.pointerType !== "mouse") {
                event.preventDefault()
                event.stopPropagation()
                onTouchReveal()
              }

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
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") {
                setIsHovered(true)
              }
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") {
                setIsHovered(false)
              }
            }}
            onFocus={() => {
              setHasVisibleFocus(
                pendingFocusPointerType.current !== "mouse",
              )
              pendingFocusPointerType.current = null
            }}
            onBlur={() => setHasVisibleFocus(false)}
            onKeyDown={handleKeyDown}
          />
          {hasVisibleFocus
            ? (
              <rect
                x={cx - 10}
                y={cy - 10}
                width={20}
                height={20}
                fill="none"
                strokeWidth={3}
                pointerEvents="none"
                className="stroke-foreground forced-colors:stroke-[Highlight]"
              />
            )
            : null}
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
  fanSpeedLabel,
  horizontalViewport,
  hovered,
  touchRevealed,
}: {
  temperature: number
  fanSpeed: number
  fanSpeedLabel: "Average fan speed" | "Fan speed"
  horizontalViewport: HorizontalViewport
  hovered: boolean
  touchRevealed: boolean
}) {
  const coordinate = useCartesianScale({ x: temperature, y: fanSpeed })
  const plotArea = usePlotArea()
  const xDomain = useXAxisDomain()
  const yDomain = useYAxisDomain()
  const verticalLineRef = useRef<SVGGElement>(null)
  const horizontalLineRef = useRef<SVGGElement>(null)
  const pointRef = useRef<SVGGElement>(null)
  const feedbackRef = useRef<SVGGElement>(null)
  const previousFrame = useRef<
    {
      temperature: number
      fanSpeed: number
      x: number
      y: number
      scaleSignature: string
    } | null
  >(null)
  const [hasVisibleFocus, setHasVisibleFocus] = useState(false)
  const scaleSignature = JSON.stringify([
    plotArea?.x,
    plotArea?.y,
    plotArea?.width,
    plotArea?.height,
    xDomain,
    yDomain,
  ])
  const coordinateX = coordinate?.x
  const coordinateY = coordinate?.y

  useLayoutEffect(() => {
    if (coordinateX === undefined || coordinateY === undefined) {
      return
    }

    const frame = {
      temperature,
      fanSpeed,
      x: coordinateX,
      y: coordinateY,
      scaleSignature,
    }
    const previous = previousFrame.current
    const sampleChanged = previous !== null &&
      (previous.temperature !== temperature || previous.fanSpeed !== fanSpeed)
    const scaleChanged = previous !== null &&
      previous.scaleSignature !== scaleSignature
    const shouldAnimate = sampleChanged && !scaleChanged &&
      !globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
    const targets = [
      {
        element: verticalLineRef.current,
        from: previous ? `translateX(${previous.x}px)` : null,
        to: `translateX(${coordinateX}px)`,
      },
      {
        element: horizontalLineRef.current,
        from: previous ? `translateY(${previous.y}px)` : null,
        to: `translateY(${coordinateY}px)`,
      },
      {
        element: pointRef.current,
        from: previous ? `translate(${previous.x}px, ${previous.y}px)` : null,
        to: `translate(${coordinateX}px, ${coordinateY}px)`,
      },
      {
        element: feedbackRef.current,
        from: previous ? `translate(${previous.x}px, ${previous.y}px)` : null,
        to: `translate(${coordinateX}px, ${coordinateY}px)`,
      },
    ]

    for (const { element, from, to } of targets) {
      if (!element) {
        continue
      }

      const runningAnimations = element.getAnimations()
      const currentTransform = runningAnimations.length > 0
        ? getComputedStyle(element).transform
        : from
      runningAnimations.forEach((animation) => animation.cancel())

      if (shouldAnimate && currentTransform) {
        element.animate(
          [{ transform: currentTransform }, { transform: to }],
          {
            duration: 500,
            easing: "cubic-bezier(0, 0, 0.2, 1)",
          },
        )
      }
    }

    previousFrame.current = frame
  }, [
    coordinateX,
    coordinateY,
    fanSpeed,
    scaleSignature,
    temperature,
  ])

  useLayoutEffect(() => {
    const elements = [
      verticalLineRef.current,
      horizontalLineRef.current,
      pointRef.current,
      feedbackRef.current,
    ]

    return () => {
      elements.forEach((element) => {
        element?.getAnimations().forEach((animation) => animation.cancel())
      })
    }
  }, [])

  if (!coordinate || !plotArea) {
    return null
  }

  const feedbackVariant = hovered
    ? "tooltip"
    : touchRevealed || hasVisibleFocus
    ? "annotation"
    : null
  const feedbackLines = fanSpeedLabel === "Average fan speed"
    ? [`Current: ${temperature} °C`, fanSpeedLabel, `${fanSpeed}%`]
    : [`Current: ${temperature} °C`, `${fanSpeedLabel}: ${fanSpeed}%`]

  return (
    <>
      <ZIndexLayer zIndex={DefaultZIndexes.scatter - 1}>
        <g
          ref={verticalLineRef}
          aria-hidden="true"
          pointerEvents="none"
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
          ref={horizontalLineRef}
          aria-hidden="true"
          pointerEvents="none"
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
          ref={pointRef}
          style={{
            transform: `translate(${coordinate.x}px, ${coordinate.y}px)`,
          }}
        >
          <rect
            x={-22}
            y={-22}
            width={44}
            height={44}
            fill="transparent"
            stroke="transparent"
            strokeWidth={2}
            pointerEvents="none"
            data-current-reading-target=""
            role="img"
            tabIndex={0}
            aria-label={`Current temperature ${temperature} °C, ${fanSpeedLabel.toLowerCase()} ${fanSpeed}%`}
            onFocus={() => setHasVisibleFocus(true)}
            onBlur={() => setHasVisibleFocus(false)}
          />
          {hasVisibleFocus
            ? (
              <rect
                x={-10}
                y={-10}
                width={20}
                height={20}
                fill="none"
                strokeWidth={3}
                pointerEvents="none"
                className="stroke-foreground forced-colors:stroke-[Highlight]"
              />
            )
            : null}
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
      {feedbackVariant
        ? (
          <ZIndexLayer zIndex={DefaultZIndexes.label}>
            <PointFeedback
              anchorX={coordinate.x}
              anchorY={coordinate.y}
              lines={feedbackLines}
              plotArea={plotArea}
              horizontalViewport={horizontalViewport}
              tone="var(--color-current)"
              variant={feedbackVariant}
              groupRef={feedbackRef}
            />
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
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [horizontalViewport, setHorizontalViewport] = useState<
    HorizontalViewport
  >({ x: 0, width: 0 })
  const [hoveredCurrentSample, setHoveredCurrentSample] = useState<
    number | null
  >(null)
  const [touchRevealedPoint, setTouchRevealedPoint] = useState<string | null>(
    null,
  )
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
  const temperatureGaps = curve.slice(1).flatMap((point, index) => {
    const previousPoint = curve[index]
    const gap = previousPoint
      ? point.temperature - previousPoint.temperature
      : 0
    return gap > 0 ? [gap] : []
  })
  const smallestTemperatureGap = temperatureGaps.length > 0
    ? Math.min(...temperatureGaps)
    : 15
  const minimumPlotWidth = ((xMaximum - xMinimum) / smallestTemperatureGap) * 44
  const minimumChartWidth = Math.ceil(minimumPlotWidth + 128)

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) {
      return
    }

    const observer = new ResizeObserver(() => {
      setHoveredCurrentSample(null)
      setHorizontalViewport((current) => {
        const nextViewport = {
          x: scroller.scrollLeft,
          width: scroller.clientWidth,
        }
        return current.x === nextViewport.x &&
            current.width === nextViewport.width
          ? current
          : nextViewport
      })
    })
    observer.observe(scroller)

    return () => observer.disconnect()
  }, [])

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

  const fanSpeedLabel = snapshot && snapshot.fanCount > 1
    ? "Average fan speed"
    : "Fan speed"
  const currentLabel = snapshot
    ? `Current temperature ${snapshot.temperature} °C, ${fanSpeedLabel.toLowerCase()} ${snapshot.fanSpeed}%`
    : "Getting current readings"

  function hitsCurrentReading(
    container: HTMLDivElement,
    clientX: number,
    clientY: number,
  ) {
    const target = container.querySelector("[data-current-reading-target]")
    const bounds = target?.getBoundingClientRect()
    return Boolean(
      bounds && clientX >= bounds.left && clientX <= bounds.right &&
        clientY >= bounds.top && clientY <= bounds.bottom,
    )
  }

  return (
    <div
      ref={scrollerRef}
      className="w-full overflow-x-auto overscroll-x-contain"
      onScroll={(event) => {
        setHoveredCurrentSample(null)
        const nextViewport = {
          x: event.currentTarget.scrollLeft,
          width: event.currentTarget.clientWidth,
        }
        setHorizontalViewport((current) =>
          current.x === nextViewport.x && current.width === nextViewport.width
            ? current
            : nextViewport
        )
      }}
    >
      <ChartContainer
        config={chartConfig}
        className="h-[min(68svh,34rem)] min-h-88 w-full aspect-auto"
        style={{ minWidth: `max(32rem, ${minimumChartWidth}px)` }}
        role="group"
        aria-label={`${currentLabel}. Fan curve editor`}
        onPointerMove={(event) => {
          if (event.pointerType !== "mouse") {
            return
          }

          const target = event.target as Element
          if (target.closest?.('[role="slider"]')) {
            setHoveredCurrentSample(null)
            return
          }

          setHoveredCurrentSample(
            hitsCurrentReading(
                event.currentTarget,
                event.clientX,
                event.clientY,
              )
              ? snapshot?.sampledAt ?? null
              : null,
          )
        }}
        onPointerLeave={() => setHoveredCurrentSample(null)}
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse") {
            setTouchRevealedPoint(
              hitsCurrentReading(
                  event.currentTarget,
                  event.clientX,
                  event.clientY,
                )
                ? "current"
                : null,
            )
          }
        }}
      >
        <ComposedChart
          responsive
          data={curve}
          margin={{ top: 32, right: 24, bottom: 8, left: 8 }}
          style={{ width: "100%", height: "100%" }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="temperature"
            domain={[xMinimum, xMaximum]}
            allowDataOverflow
            height={64}
            interval="preserveStartEnd"
            minTickGap={36}
            tickCount={5}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => `${value} °C`}
            label={{
              value: "Temperature [°C]",
              position: "insideBottom",
              offset: 0,
              fill: "var(--muted-foreground)",
            }}
          />
          <YAxis
            type="number"
            dataKey="fanSpeed"
            domain={[0, yMaximum]}
            allowDataOverflow
            width={96}
            minTickGap={16}
            tickCount={6}
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
                fanSpeedLabel={fanSpeedLabel}
                horizontalViewport={horizontalViewport}
                hovered={hoveredCurrentSample === snapshot.sampledAt}
                touchRevealed={touchRevealedPoint === "current"}
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
                currentReading={snapshot
                  ? {
                    temperature: snapshot.temperature,
                    fanSpeed: snapshot.fanSpeed,
                    fanSpeedLabel,
                  }
                  : null}
                horizontalViewport={horizontalViewport}
                disabled={disabled}
                locked={!nextPoint}
                touchRevealed={touchRevealedPoint ===
                  `control-${point.temperature}`}
                minimum={previousPoint?.fanSpeed ?? fanMin}
                maximum={nextPoint?.fanSpeed ?? fanMax}
                onTouchReveal={() =>
                  setTouchRevealedPoint(`control-${point.temperature}`)}
                onDrag={(fanSpeed) => updatePoint(index, fanSpeed)}
                onKeyboardChange={(fanSpeed) => updatePoint(index, fanSpeed)}
              />
            )
          })}
        </ComposedChart>
      </ChartContainer>
    </div>
  )
}
