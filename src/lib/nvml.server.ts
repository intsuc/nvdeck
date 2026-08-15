/// <reference lib="deno.ns" />

import "@tanstack/react-start/server-only"
import process from "node:process"

import {
  createDefaultFanCurve,
  FAN_CURVE_TEMPERATURES,
  type FanControlMode,
  type FanCurvePoint,
  interpolateFanSpeed,
  type NvmlReadySnapshot,
  type NvmlSnapshot,
} from "./nvml.types"

const NVML_LIBRARY = "libnvidia-ml.so.1"
const NVML_SUCCESS = 0
const NVML_TEMPERATURE_GPU = 0
const NVML_TEMPERATURE_V1 = 0x0100000c
const NVML_FAN_POLICY_AUTOMATIC = 0
const NVML_FAN_POLICY_MANUAL = 1
const NVML_DEVICE_NAME_BUFFER_SIZE = 96
const CONTROL_INTERVAL_MS = 1_000
const GPU_INDEX = 0

const NVML_SYMBOLS = {
  nvmlInit_v2: { parameters: [], result: "i32" },
  nvmlShutdown: { parameters: [], result: "i32" },
  nvmlErrorString: { parameters: ["i32"], result: "pointer" },
  nvmlDeviceGetCount_v2: { parameters: ["buffer"], result: "i32" },
  nvmlDeviceGetHandleByIndex_v2: {
    parameters: ["u32", "buffer"],
    result: "i32",
  },
  nvmlDeviceGetName: {
    parameters: ["pointer", "buffer", "u32"],
    result: "i32",
  },
  nvmlDeviceGetNumFans: {
    parameters: ["pointer", "buffer"],
    result: "i32",
  },
  nvmlDeviceGetFanSpeed_v2: {
    parameters: ["pointer", "u32", "buffer"],
    result: "i32",
  },
  nvmlDeviceGetFanControlPolicy_v2: {
    parameters: ["pointer", "u32", "buffer"],
    result: "i32",
  },
  nvmlDeviceGetMinMaxFanSpeed: {
    parameters: ["pointer", "buffer", "buffer"],
    result: "i32",
  },
  nvmlDeviceGetTemperatureV: {
    parameters: ["pointer", "buffer"],
    result: "i32",
  },
  nvmlDeviceSetFanSpeed_v2: {
    parameters: ["pointer", "u32", "u32"],
    result: "i32",
  },
  nvmlDeviceSetDefaultFanSpeed_v2: {
    parameters: ["pointer", "u32"],
    result: "i32",
  },
} as const satisfies Deno.ForeignLibraryInterface

type NvmlLibrary = Deno.DynamicLibrary<typeof NVML_SYMBOLS>

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function getNvmlError(library: NvmlLibrary, code: number) {
  const pointer = library.symbols.nvmlErrorString(code)

  if (pointer === null) {
    return `NVML error ${code}`
  }

  return new Deno.UnsafePointerView(pointer).getCString()
}

function checkNvml(
  library: NvmlLibrary,
  code: number,
  operation: string,
) {
  if (code !== NVML_SUCCESS) {
    throw new Error(
      `${operation}: ${getNvmlError(library, code)} (NVML ${code})`,
    )
  }
}

function decodeCString(buffer: Uint8Array) {
  const terminator = buffer.indexOf(0)
  const bytes = terminator === -1 ? buffer : buffer.subarray(0, terminator)
  return new TextDecoder().decode(bytes)
}

class NvmlController {
  readonly #library: NvmlLibrary
  readonly #device: Deno.PointerValue
  readonly #gpuName: string
  readonly #fanCount: number
  readonly #fanMin: number
  readonly #fanMax: number
  #curve: FanCurvePoint[]
  #mode: FanControlMode
  #lastTarget: number | null = null
  #controlError: string | null = null
  #timer: ReturnType<typeof setInterval> | null = null
  #manualFans = new Set<number>()
  #closed = false

  private constructor(
    library: NvmlLibrary,
    device: Deno.PointerValue,
    gpuName: string,
    fanCount: number,
    fanMin: number,
    fanMax: number,
    manualFans: number[],
  ) {
    this.#library = library
    this.#device = device
    this.#gpuName = gpuName
    this.#fanCount = fanCount
    this.#fanMin = fanMin
    this.#fanMax = fanMax
    this.#curve = createDefaultFanCurve(fanMin, fanMax)
    this.#manualFans = new Set(manualFans)
    this.#mode = manualFans.length === 0 ? "automatic" : "manual"
    this.#controlError = manualFans.length === 0
      ? null
      : `Manual control was detected at startup for fan indices ${
        manualFans.join(
          ", ",
        )
      }. Restore automatic fan control before applying a curve.`
  }

  static open() {
    const library = Deno.dlopen(NVML_LIBRARY, NVML_SYMBOLS)
    let initialized = false

    try {
      checkNvml(library, library.symbols.nvmlInit_v2(), "nvmlInit_v2")
      initialized = true

      const deviceCount = new Uint32Array(1)
      checkNvml(
        library,
        library.symbols.nvmlDeviceGetCount_v2(deviceCount),
        "nvmlDeviceGetCount_v2",
      )

      if (deviceCount[0] === 0) {
        throw new Error("NVML did not detect any available GPUs.")
      }

      const handleSlot = new BigUint64Array(1)
      checkNvml(
        library,
        library.symbols.nvmlDeviceGetHandleByIndex_v2(GPU_INDEX, handleSlot),
        `nvmlDeviceGetHandleByIndex_v2(${GPU_INDEX})`,
      )

      const device = Deno.UnsafePointer.create(handleSlot[0])
      if (device === null) {
        throw new Error("NVML returned a null GPU handle.")
      }

      const nameBuffer = new Uint8Array(NVML_DEVICE_NAME_BUFFER_SIZE)
      checkNvml(
        library,
        library.symbols.nvmlDeviceGetName(
          device,
          nameBuffer,
          nameBuffer.byteLength,
        ),
        "nvmlDeviceGetName",
      )

      const fanCount = new Uint32Array(1)
      checkNvml(
        library,
        library.symbols.nvmlDeviceGetNumFans(device, fanCount),
        "nvmlDeviceGetNumFans",
      )

      if (fanCount[0] === 0) {
        throw new Error("This GPU has no fans controllable through NVML.")
      }

      const manualFans: number[] = []

      for (let fanIndex = 0; fanIndex < fanCount[0]; fanIndex += 1) {
        const policy = new Uint32Array(1)
        checkNvml(
          library,
          library.symbols.nvmlDeviceGetFanControlPolicy_v2(
            device,
            fanIndex,
            policy,
          ),
          `nvmlDeviceGetFanControlPolicy_v2(${fanIndex})`,
        )

        if (policy[0] === NVML_FAN_POLICY_MANUAL) {
          manualFans.push(fanIndex)
        } else if (policy[0] !== NVML_FAN_POLICY_AUTOMATIC) {
          throw new Error(
            `Fan ${fanIndex} returned unsupported control policy ${policy[0]}.`,
          )
        }
      }

      const fanMin = new Uint32Array(1)
      const fanMax = new Uint32Array(1)
      checkNvml(
        library,
        library.symbols.nvmlDeviceGetMinMaxFanSpeed(
          device,
          fanMin,
          fanMax,
        ),
        "nvmlDeviceGetMinMaxFanSpeed",
      )

      return new NvmlController(
        library,
        device,
        decodeCString(nameBuffer),
        fanCount[0],
        fanMin[0],
        fanMax[0],
        manualFans,
      )
    } catch (error) {
      if (initialized) {
        library.symbols.nvmlShutdown()
      }
      library.close()
      throw error
    }
  }

  snapshot(): NvmlReadySnapshot {
    try {
      const temperature = this.#readTemperature()
      const fanSpeed = this.#readAverageFanSpeed()
      const targetFanSpeed = this.#mode === "curve"
        ? interpolateFanSpeed(this.#curve, temperature)
        : null

      return {
        status: "ready",
        gpuIndex: GPU_INDEX,
        gpuName: this.#gpuName,
        fanCount: this.#fanCount,
        fanMin: this.#fanMin,
        fanMax: this.#fanMax,
        temperature,
        fanSpeed,
        curve: this.#curve.map((point) => ({ ...point })),
        mode: this.#mode,
        targetFanSpeed,
        controlError: this.#controlError,
        sampledAt: Date.now(),
      }
    } catch (error) {
      if (this.#mode === "curve") {
        this.#stopCurveAfterError(error)
      }

      throw error
    }
  }

  applyCurve(curve: FanCurvePoint[]) {
    if (this.#mode === "manual") {
      throw new Error(
        "Manual control remains active for one or more fans. Restore automatic control first.",
      )
    }

    this.#curve = this.#validateCurve(curve)
    this.#controlError = null
    this.#mode = "curve"
    this.#runControlTick()

    if (this.#mode === "curve" && this.#timer === null) {
      this.#timer = setInterval(
        () => this.#runControlTick(),
        CONTROL_INTERVAL_MS,
      )
    }

    return this.snapshot()
  }

  restoreAutomatic() {
    try {
      this.#restoreAutomaticInternal()
      this.#controlError = null
    } catch (error) {
      this.#controlError = errorMessage(error)
    }

    return this.snapshot()
  }

  close() {
    if (this.#closed) {
      return true
    }

    try {
      this.#restoreAutomaticInternal()
    } catch (error) {
      console.error(
        "Failed to restore automatic NVML fan control during shutdown.",
        error,
      )
      return false
    }

    const shutdownCode = this.#library.symbols.nvmlShutdown()
    if (shutdownCode !== NVML_SUCCESS) {
      console.error(
        `nvmlShutdown: ${getNvmlError(this.#library, shutdownCode)}`,
      )
    }

    this.#library.close()
    this.#closed = true
    return true
  }

  #readTemperature() {
    const temperatureBuffer = new Uint32Array([
      NVML_TEMPERATURE_V1,
      NVML_TEMPERATURE_GPU,
      0,
    ])
    checkNvml(
      this.#library,
      this.#library.symbols.nvmlDeviceGetTemperatureV(
        this.#device,
        temperatureBuffer,
      ),
      "nvmlDeviceGetTemperatureV",
    )

    return new Int32Array(temperatureBuffer.buffer)[2]
  }

  #readAverageFanSpeed() {
    let total = 0

    for (let fanIndex = 0; fanIndex < this.#fanCount; fanIndex += 1) {
      const speed = new Uint32Array(1)
      checkNvml(
        this.#library,
        this.#library.symbols.nvmlDeviceGetFanSpeed_v2(
          this.#device,
          fanIndex,
          speed,
        ),
        `nvmlDeviceGetFanSpeed_v2(${fanIndex})`,
      )
      total += speed[0]
    }

    return Math.round(total / this.#fanCount)
  }

  #validateCurve(curve: FanCurvePoint[]) {
    if (curve.length !== FAN_CURVE_TEMPERATURES.length) {
      throw new Error(
        `The fan curve must contain ${FAN_CURVE_TEMPERATURES.length} control points.`,
      )
    }

    const validated: FanCurvePoint[] = []

    for (let index = 0; index < curve.length; index += 1) {
      const point = curve[index]
      const expectedTemperature = FAN_CURVE_TEMPERATURES[index]
      const previous = validated[index - 1]

      if (!point || point.temperature !== expectedTemperature) {
        throw new Error(
          `Control point ${
            index + 1
          } must use a temperature of ${expectedTemperature} °C.`,
        )
      }

      if (!Number.isInteger(point.fanSpeed)) {
        throw new Error("Fan speed must be an integer.")
      }

      if (point.fanSpeed < this.#fanMin || point.fanSpeed > this.#fanMax) {
        throw new Error(
          `Fan speed must be within this GPU's supported range of ${this.#fanMin}–${this.#fanMax}%.`,
        )
      }

      if (previous && point.fanSpeed < previous.fanSpeed) {
        throw new Error(
          "Fan speed must be monotonically non-decreasing as temperature rises.",
        )
      }

      validated.push({ ...point })
    }

    if (validated.at(-1)?.fanSpeed !== this.#fanMax) {
      throw new Error(
        `Fan speed at 90 °C is locked at the safety limit of ${this.#fanMax}%.`,
      )
    }

    return validated
  }

  #runControlTick() {
    if (this.#mode !== "curve") {
      return
    }

    try {
      const temperature = this.#readTemperature()
      const target = interpolateFanSpeed(this.#curve, temperature)

      if (target === this.#lastTarget) {
        return
      }

      for (let fanIndex = 0; fanIndex < this.#fanCount; fanIndex += 1) {
        checkNvml(
          this.#library,
          this.#library.symbols.nvmlDeviceSetFanSpeed_v2(
            this.#device,
            fanIndex,
            target,
          ),
          `nvmlDeviceSetFanSpeed_v2(${fanIndex}, ${target})`,
        )
        this.#manualFans.add(fanIndex)
      }

      this.#lastTarget = target
    } catch (error) {
      this.#stopCurveAfterError(error)
    }
  }

  #stopCurveAfterError(error: unknown) {
    const controlMessage = errorMessage(error)
    let restoreMessage: string | null = null

    try {
      this.#restoreAutomaticInternal()
    } catch (restoreError) {
      restoreMessage = errorMessage(restoreError)
    }

    this.#controlError = restoreMessage
      ? `${controlMessage} Automatic control could not be restored: ${restoreMessage}`
      : `${controlMessage} Automatic control was restored for safety.`
  }

  #restoreAutomaticInternal() {
    if (this.#timer !== null) {
      clearInterval(this.#timer)
      this.#timer = null
    }

    const failures: string[] = []

    for (const fanIndex of this.#manualFans) {
      const code = this.#library.symbols.nvmlDeviceSetDefaultFanSpeed_v2(
        this.#device,
        fanIndex,
      )

      if (code !== NVML_SUCCESS) {
        failures.push(
          `Fan ${fanIndex}: ${
            getNvmlError(this.#library, code)
          } (NVML ${code})`,
        )
      } else {
        this.#manualFans.delete(fanIndex)
      }
    }

    this.#lastTarget = null

    if (failures.length > 0) {
      this.#mode = "manual"
      throw new Error(
        `Failed to restore automatic fan control: ${failures.join(", ")}`,
      )
    }

    this.#mode = "automatic"
  }
}

let controller: NvmlController | undefined
let shuttingDown = false

function getController() {
  if (shuttingDown) {
    throw new Error("The NVML service is shutting down.")
  }

  controller ??= NvmlController.open()
  return controller
}

function unavailableSnapshot(error: unknown): NvmlSnapshot {
  return {
    status: "unavailable",
    message:
      `Unable to connect to NVML. Check the NVIDIA driver and Deno FFI permissions. ${
        errorMessage(error)
      }`,
    curve: createDefaultFanCurve(),
    sampledAt: Date.now(),
  }
}

export function readNvmlSnapshot(): NvmlSnapshot {
  try {
    return getController().snapshot()
  } catch (error) {
    return unavailableSnapshot(error)
  }
}

export function applyNvmlFanCurve(curve: FanCurvePoint[]): NvmlSnapshot {
  let activeController: NvmlController

  try {
    activeController = getController()
  } catch (error) {
    return unavailableSnapshot(error)
  }

  return activeController.applyCurve(curve)
}

export function restoreNvmlAutomaticControl(): NvmlSnapshot {
  let activeController: NvmlController

  try {
    activeController = getController()
  } catch (error) {
    return unavailableSnapshot(error)
  }

  try {
    return activeController.restoreAutomatic()
  } catch (error) {
    return unavailableSnapshot(error)
  }
}

function closeController() {
  controller?.close()
}

function closeControllerAfterUnhandledError() {
  closeController()
  closeController()
}

function closeControllerForShutdown(exitCode: number) {
  shuttingDown = true
  closeController()

  setTimeout(() => {
    closeController()
    Deno.exit(exitCode)
  }, 500)
}

function handleSigInt() {
  closeControllerForShutdown(130)
}

function handleSigTerm() {
  closeControllerForShutdown(143)
}

globalThis.addEventListener("unload", closeController)
globalThis.addEventListener("error", closeControllerAfterUnhandledError)
globalThis.addEventListener(
  "unhandledrejection",
  closeControllerAfterUnhandledError,
)
process.once("exit", closeController)
process.once("SIGINT", handleSigInt)
process.once("SIGTERM", handleSigTerm)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    globalThis.removeEventListener("unload", closeController)
    globalThis.removeEventListener("error", closeControllerAfterUnhandledError)
    globalThis.removeEventListener(
      "unhandledrejection",
      closeControllerAfterUnhandledError,
    )
    process.off("exit", closeController)
    process.off("SIGINT", handleSigInt)
    process.off("SIGTERM", handleSigTerm)
    controller?.close()
    controller = undefined
  })
}
