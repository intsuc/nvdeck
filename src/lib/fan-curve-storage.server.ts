/// <reference lib="deno.ns" />

import "@tanstack/react-start/server-only"

import type { FanCurvePoint } from "./nvml.types"

const FAN_CURVE_STORAGE_KEY = "nvdeck.fan-curve"
const FAN_CURVE_SCHEMA_VERSION = 1

export type FanCurveStorageIdentity = {
  gpuIndex: number
  gpuName: string
  fanMin: number
  fanMax: number
}

type PersistedFanCurve = FanCurveStorageIdentity & {
  schemaVersion: typeof FAN_CURVE_SCHEMA_VERSION
  points: FanCurvePoint[]
  savedAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function decodePoints(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("The saved control points are not an array.")
  }

  return value.map((point, index) => {
    if (
      !isRecord(point) ||
      typeof point.temperature !== "number" ||
      !Number.isFinite(point.temperature) ||
      typeof point.fanSpeed !== "number" ||
      !Number.isFinite(point.fanSpeed)
    ) {
      throw new Error(`Saved control point ${index + 1} is invalid.`)
    }

    return {
      temperature: point.temperature,
      fanSpeed: point.fanSpeed,
    }
  })
}

function decodePersistedFanCurve(value: unknown): PersistedFanCurve {
  if (!isRecord(value)) {
    throw new Error("The saved value is not an object.")
  }

  if (value.schemaVersion !== FAN_CURVE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported saved fan curve schema version: ${
        String(value.schemaVersion)
      }.`,
    )
  }

  if (
    !Number.isInteger(value.gpuIndex) ||
    typeof value.gpuName !== "string" ||
    !Number.isInteger(value.fanMin) ||
    !Number.isInteger(value.fanMax) ||
    typeof value.savedAt !== "number" ||
    !Number.isFinite(value.savedAt)
  ) {
    throw new Error("The saved fan curve metadata is invalid.")
  }

  return {
    schemaVersion: FAN_CURVE_SCHEMA_VERSION,
    gpuIndex: value.gpuIndex as number,
    gpuName: value.gpuName,
    fanMin: value.fanMin as number,
    fanMax: value.fanMax as number,
    points: decodePoints(value.points),
    savedAt: value.savedAt,
  }
}

function assertMatchingGpu(
  saved: PersistedFanCurve,
  current: FanCurveStorageIdentity,
) {
  if (
    saved.gpuIndex !== current.gpuIndex ||
    saved.gpuName !== current.gpuName ||
    saved.fanMin !== current.fanMin ||
    saved.fanMax !== current.fanMax
  ) {
    throw new Error(
      "The saved fan curve belongs to a different GPU or fan-speed range.",
    )
  }
}

export function loadPersistedFanCurve(identity: FanCurveStorageIdentity) {
  const serialized = globalThis.localStorage.getItem(FAN_CURVE_STORAGE_KEY)

  if (serialized === null) {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(serialized)
  } catch (error) {
    throw new Error("The saved fan curve is not valid JSON.", {
      cause: error,
    })
  }

  const saved = decodePersistedFanCurve(parsed)
  assertMatchingGpu(saved, identity)
  return saved.points
}

export function savePersistedFanCurve(
  identity: FanCurveStorageIdentity,
  points: FanCurvePoint[],
) {
  const value: PersistedFanCurve = {
    schemaVersion: FAN_CURVE_SCHEMA_VERSION,
    ...identity,
    points: points.map((point) => ({ ...point })),
    savedAt: Date.now(),
  }

  globalThis.localStorage.setItem(
    FAN_CURVE_STORAGE_KEY,
    JSON.stringify(value),
  )
}
