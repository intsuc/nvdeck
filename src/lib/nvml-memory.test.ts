/// <reference lib="deno.ns" />

import {
  createNvmlMemoryV2Buffer,
  decodeNvmlMemoryV2,
  NVML_MEMORY_V2_SIZE,
  NVML_MEMORY_V2_VERSION,
} from "./nvml-memory.ts"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function assertThrows(
  operation: () => unknown,
  expectedMessage: string,
) {
  try {
    operation()
  } catch (error) {
    assert(error instanceof Error, "Expected an Error to be thrown.")
    assert(
      error.message.includes(expectedMessage),
      `Expected error to include "${expectedMessage}", received "${error.message}".`,
    )
    return
  }

  throw new Error(`Expected an error containing "${expectedMessage}".`)
}

Deno.test("decodes the nvmlMemory_v2_t ABI and rejects unsafe or invalid values", () => {
  const buffer = createNvmlMemoryV2Buffer()
  const view = new DataView(buffer.buffer)

  assert(
    buffer.byteLength === NVML_MEMORY_V2_SIZE,
    "Expected a 40-byte buffer.",
  )
  assert(
    view.getUint32(0, true) === NVML_MEMORY_V2_VERSION,
    "Expected the NVML v2 structure version.",
  )

  view.setBigUint64(8, 24n * 1024n, true)
  view.setBigUint64(16, 2n * 1024n, true)
  view.setBigUint64(24, 14n * 1024n, true)
  view.setBigUint64(32, 8n * 1024n, true)

  const decoded = decodeNvmlMemoryV2(buffer)
  assert(decoded.totalBytes === 24 * 1024, "Expected total bytes at offset 8.")
  assert(decoded.usedBytes === 8 * 1024, "Expected used bytes at offset 32.")

  view.setBigUint64(32, BigInt(Number.MAX_SAFE_INTEGER) + 1n, true)
  assertThrows(() => decodeNvmlMemoryV2(buffer), "safe integer range")

  view.setBigUint64(8, 100n, true)
  view.setBigUint64(16, 0n, true)
  view.setBigUint64(24, 0n, true)
  view.setBigUint64(32, 101n, true)
  assertThrows(
    () => decodeNvmlMemoryV2(buffer),
    "used (101 bytes) exceeds total",
  )

  view.setBigUint64(8, 0n, true)
  view.setBigUint64(32, 0n, true)
  assertThrows(
    () => decodeNvmlMemoryV2(buffer),
    "total must be greater than zero",
  )
})
