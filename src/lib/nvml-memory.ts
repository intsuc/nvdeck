export const NVML_MEMORY_V2_SIZE = 40
export const NVML_MEMORY_V2_VERSION = 0x02000028

const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER)

type MemoryField = "total" | "reserved" | "free" | "used"

const MEMORY_FIELD_OFFSETS: Record<MemoryField, number> = {
  total: 8,
  reserved: 16,
  free: 24,
  used: 32,
}

export function createNvmlMemoryV2Buffer(): Uint8Array {
  const buffer = new Uint8Array(NVML_MEMORY_V2_SIZE)
  new DataView(buffer.buffer).setUint32(
    0,
    NVML_MEMORY_V2_VERSION,
    true,
  )
  return buffer
}

export function decodeNvmlMemoryV2(
  buffer: Uint8Array,
): { usedBytes: number; totalBytes: number } {
  if (buffer.byteLength !== NVML_MEMORY_V2_SIZE) {
    throw new Error(
      `NVML memory v2 buffer must be ${NVML_MEMORY_V2_SIZE} bytes; received ${buffer.byteLength}.`,
    )
  }

  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  )
  const version = view.getUint32(0, true)

  if (version !== NVML_MEMORY_V2_VERSION) {
    throw new Error(
      `NVML memory v2 buffer has version 0x${
        version.toString(16).padStart(8, "0")
      }; expected 0x${NVML_MEMORY_V2_VERSION.toString(16)}.`,
    )
  }

  const fields = Object.fromEntries(
    Object.entries(MEMORY_FIELD_OFFSETS).map(([field, offset]) => [
      field,
      view.getBigUint64(offset, true),
    ]),
  ) as Record<MemoryField, bigint>

  for (const [field, value] of Object.entries(fields)) {
    if (value > MAX_SAFE_INTEGER) {
      throw new Error(
        `NVML memory v2 ${field} exceeds JavaScript's safe integer range.`,
      )
    }
  }

  if (fields.total === 0n) {
    throw new Error("NVML memory v2 total must be greater than zero.")
  }

  for (const field of ["reserved", "free", "used"] as const) {
    if (fields[field] > fields.total) {
      throw new Error(
        `NVML memory v2 ${field} (${
          fields[field]
        } bytes) exceeds total (${fields.total} bytes).`,
      )
    }
  }

  return {
    usedBytes: Number(fields.used),
    totalBytes: Number(fields.total),
  }
}
