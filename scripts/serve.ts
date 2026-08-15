Deno.env.set("NITRO_HOST", Deno.env.get("NITRO_HOST") ?? "127.0.0.1")

await import("../.output/server/index.mjs")
