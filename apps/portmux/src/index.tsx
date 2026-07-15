#!/usr/bin/env bun

import { BunRuntime } from "@effect/platform-bun"
import { CliRenderEvents, type CliRenderer, createCliRenderer } from "@opentui/core"
import { createRoot, type Root } from "@opentui/react"
import { acquireInstanceLock } from "@portmux/core"
import { Effect } from "effect"
import { App } from "./app.js"

interface TuiRuntime {
  readonly renderer: CliRenderer
  readonly root: Root
}

const acquireTui = Effect.tryPromise({
  try: async (): Promise<TuiRuntime> => {
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
      exitSignals: [],
      screenMode: "alternate-screen",
    })
    return { renderer, root: createRoot(renderer) }
  },
  catch: (cause) => new Error("Could not initialize OpenTUI", { cause }),
})

const runTui = ({ renderer, root }: TuiRuntime): Effect.Effect<void> =>
  Effect.async<void>((resume) => {
    const onDestroy = () => resume(Effect.void)
    renderer.once(CliRenderEvents.DESTROY, onDestroy)
    root.render(<App onExit={() => renderer.destroy()} />)
    return Effect.sync(() => {
      renderer.off(CliRenderEvents.DESTROY, onDestroy)
      root.unmount()
    })
  })

const releaseTui = ({ renderer }: TuiRuntime): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!renderer.isDestroyed) {
      renderer.destroy()
    }
  })

const tui = Effect.acquireUseRelease(acquireTui, runTui, releaseTui)

BunRuntime.runMain(
  Effect.acquireUseRelease(
    acquireInstanceLock(),
    () => tui,
    (lock) => lock.release.pipe(Effect.catchAll(() => Effect.void)),
  ),
)
