import { createMemo } from "solid-js"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"
import { DialogModel } from "./dialog-model"

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
  const toast = useToast()

  const current = createMemo(() => {
    const value = sync.data.config.small_model
    if (!value) return undefined
    const separator = value.indexOf("/")
    if (separator === -1) return undefined
    return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) }
  })

  return (
    <DialogModel
      title="Select small model"
      current={current()}
      onPick={(model) => {
        const id = `${model.providerID}/${model.modelID}`
        sdk.client.global.config
          .update({ config: { small_model: id } }, { throwOnError: true })
          .then(() => toast.show({ message: `Small model set to ${id}`, variant: "success" }))
          .catch(toast.error)
      }}
    />
  )
}
