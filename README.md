# NVDeck

NVDeck is a dashboard for monitoring and controlling NVIDIA GPUs via NVML.

## Requirements

- Linux with an NVIDIA driver that provides `libnvidia-ml.so.1`
- Deno 2.9 or newer
- Permission to use Deno FFI and to change GPU fan speeds through NVML

## Development

```sh
deno install
deno task dev
```

Open <http://localhost:3000>. The live temperature and fan percentage are
rendered as the current point inside the chart. Move a curve point vertically,
then select **Apply curve** to start curve control. Select **Restore automatic
control** before stopping the server when manual control is no longer needed.

The dashboard also shows the GPU's live power usage, software power cap, and
memory usage. NVML reports power in milliwatts; the dashboard converts it to
watts and renders GPU memory as used / total in MiB or GiB. These readings are
independent of fan control. If one is unsupported or fails, only that reading
becomes unavailable, the reason is shown, and no stale value is retained.

NVML does not store fan curves. While curve control is active, the Deno server
samples the GPU temperature once per second, interpolates the chart curve, and
sets every fan to the resulting target. A read or write failure triggers an
attempt to restore NVIDIA's automatic fan control and is shown in the dashboard.
SIGINT and SIGTERM also trigger restoration before exit. SIGKILL and power loss
cannot run cleanup; on the next start, the dashboard detects a remaining manual
fan policy and requires an explicit return to automatic control.

After a curve is applied successfully, the server attempts to save it in Deno's
`localStorage`; a dashboard warning reports any persistence failure. The saved
curve is restored in the chart after a restart, but it is never applied to the
fans automatically; fan control starts only after selecting **Apply curve**.
**Restore automatic control** does not delete the saved curve. Development,
generated-server, and compiled-executable runs use separate Deno storage
namespaces.

## Validation and executable build

```sh
deno task check
deno task compile
```

The executable still loads `libnvidia-ml.so.1` from the host NVIDIA driver at
runtime. It binds to `127.0.0.1` by default:

```sh
./dist/nvdeck
```
