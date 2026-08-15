export const FAN_CURVE_TEMPERATURES = [30, 45, 60, 75, 90] as const

export type FanCurvePoint = {
  temperature: number
  fanSpeed: number
}

export type FanControlMode = "automatic" | "curve" | "manual"

export type NvmlReadySnapshot = {
  status: "ready"
  gpuIndex: number
  gpuName: string
  fanCount: number
  fanMin: number
  fanMax: number
  temperature: number
  fanSpeed: number
  curve: FanCurvePoint[]
  mode: FanControlMode
  targetFanSpeed: number | null
  controlError: string | null
  sampledAt: number
}

export type NvmlUnavailableSnapshot = {
  status: "unavailable"
  message: string
  curve: FanCurvePoint[]
  sampledAt: number
}

export type NvmlSnapshot = NvmlReadySnapshot | NvmlUnavailableSnapshot

function interpolateRange(min: number, max: number, fraction: number) {
  return Math.round(min + (max - min) * fraction)
}

export function createDefaultFanCurve(
  fanMin = 30,
  fanMax = 100,
): FanCurvePoint[] {
  const fractions = [0, 0.1, 0.35, 0.65, 1] as const

  return FAN_CURVE_TEMPERATURES.map((temperature, index) => ({
    temperature,
    fanSpeed: interpolateRange(fanMin, fanMax, fractions[index]),
  }))
}

export function interpolateFanSpeed(
  curve: FanCurvePoint[],
  temperature: number,
) {
  const first = curve[0]
  const last = curve.at(-1)

  if (!first || !last) {
    throw new Error("The fan curve has no control points.")
  }

  if (temperature <= first.temperature) {
    return first.fanSpeed
  }

  if (temperature >= last.temperature) {
    return last.fanSpeed
  }

  for (let index = 1; index < curve.length; index += 1) {
    const lower = curve[index - 1]
    const upper = curve[index]

    if (!lower || !upper || temperature > upper.temperature) {
      continue
    }

    const position = (temperature - lower.temperature) /
      (upper.temperature - lower.temperature)

    return Math.round(
      lower.fanSpeed + (upper.fanSpeed - lower.fanSpeed) * position,
    )
  }

  throw new Error("No fan curve segment covers the current temperature.")
}
