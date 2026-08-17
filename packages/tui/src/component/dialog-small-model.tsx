import { createMemo } from "solid-js"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { DialogModel } from "./dialog-model"
import { DialogVariant } from "./dialog-variant"

// The small model is the cheap model the server routes background work to:
// session titles, summaries, and other calls you never see. It is read
// server-side from config (Provider.getSmallModel reads cfg.small_model), so
// the choice has to be persisted to global config rather than held in TUI
// state -- a session-local value would never reach the code that uses it.
//
// Writing global config makes the server dispose its instances, which the sync
// layer already handles by re-bootstrapping, so the new value is reflected back
// here without a manual refetch.
export function DialogSmallModel() {
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()

  function split(value: string | undefined) {
    if (!value) return undefined
    const separator = value.indexOf("/")
    if (separator === -1) return undefined
    return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) }
  }

  const current = createMemo(() => split(sync.data.config.small_model))

  // Same derivation local.model.variant.list() uses, but for an arbitrary model
  // rather than the current chat model.
  function variantsFor(model: { providerID: string; modelID: string }) {
    const provider = sync.data.provider.find((item) => item.id === model.providerID)
    return Object.keys(provider?.models[model.modelID]?.variants ?? {})
  }

  function update(config: { small_model?: string; small_model_variant?: string }, message: string) {
    sdk.client.global.config
      .update({ config }, { throwOnError: true })
      .then(() => toast.show({ message, variant: "success" }))
      .catch(toast.error)
  }

  return (
    <DialogModel
      title="Select small model"
      current={current()}
      onPick={(model) => {
        const id = `${model.providerID}/${model.modelID}`
        const variants = variantsFor(model)
        if (variants.length === 0) {
          // Clearing small_model_variant matters: a variant left over from a
          // previous model would otherwise name a level this one does not have.
          dialog.clear()
          update({ small_model: id, small_model_variant: "" }, `Small model set to ${id}`)
          return
        }
        dialog.replace(() => (
          <DialogVariant
            title="Select small model reasoning"
            variants={variants}
            current={sync.data.config.small_model_variant}
            onPick={(variant) =>
              update(
                { small_model: id, small_model_variant: variant ?? "" },
                variant ? `Small model set to ${id} (${variant})` : `Small model set to ${id}`,
              )
            }
          />
        ))
      }}
    />
  )
}
