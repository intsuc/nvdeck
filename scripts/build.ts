import { createBuilder } from "vite"

const builder = await createBuilder({}, null)

await builder.buildApp()
await builder.runDevTools()

// Vite leaves an idle Node-compatible handle under Deno after SPA prerendering.
Deno.exit(0)
