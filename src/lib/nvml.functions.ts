import { createServerFn } from "@tanstack/react-start"
import { setResponseHeader } from "@tanstack/react-start/server"

import {
  applyNvmlFanCurve,
  readNvmlSnapshot,
  restoreNvmlAutomaticControl,
} from "./nvml.server"
import type { FanCurvePoint } from "./nvml.types"

function disableCaching() {
  setResponseHeader("Cache-Control", "no-store")
}

function validateCurveInput(input: unknown) {
  if (
    typeof input !== "object" ||
    input === null ||
    !("curve" in input) ||
    !Array.isArray(input.curve)
  ) {
    throw new Error("A fan curve point array is required.")
  }

  const curve: FanCurvePoint[] = []

  for (const item of input.curve) {
    if (
      typeof item !== "object" ||
      item === null ||
      !("temperature" in item) ||
      !("fanSpeed" in item) ||
      typeof item.temperature !== "number" ||
      !Number.isFinite(item.temperature) ||
      typeof item.fanSpeed !== "number" ||
      !Number.isFinite(item.fanSpeed)
    ) {
      throw new Error(
        "Each control point must include numeric temperature and fan speed values.",
      )
    }

    curve.push({
      temperature: item.temperature,
      fanSpeed: item.fanSpeed,
    })
  }

  return { curve }
}

export const getNvmlSnapshot = createServerFn({ method: "GET" }).handler(
  () => {
    disableCaching()
    return readNvmlSnapshot()
  },
)

export const setNvmlFanCurve = createServerFn({ method: "POST" })
  .validator(validateCurveInput)
  .handler(({ data }) => {
    disableCaching()
    return applyNvmlFanCurve(data.curve)
  })

export const restoreNvmlAutomatic = createServerFn({ method: "POST" })
  .handler(() => {
    disableCaching()
    return restoreNvmlAutomaticControl()
  })
