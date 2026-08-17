import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"

export function DialogVariant(props: {
  // Set together when the dialog picks a variant for a model other than the one
  // you are chatting with. onPick owns the selection, so nothing is written to
  // local.model, and the variant list has to be supplied by the caller because
  // local.model.variant.list() only ever describes the current chat model.
  title?: string
  variants?: string[]
  current?: string
  onPick?: (variant: string | undefined) => void
}) {
  const local = useLocal()
  const dialog = useDialog()

  const list = createMemo(() => (props.onPick ? (props.variants ?? []) : local.model.variant.list()))

  function select(variant: string | undefined) {
    dialog.clear()
    if (props.onPick) {
      props.onPick(variant)
      return
    }
    local.model.variant.set(variant)
  }

  const options = createMemo(() => {
    return [
      {
        value: "default",
        title: "Default",
        onSelect: () => select(undefined),
      },
      ...list().map((variant) => ({
        value: variant,
        title: variant,
        onSelect: () => select(variant),
      })),
    ]
  })

  return (
    <DialogSelect<string>
      options={options()}
      title={props.title ?? "Select variant"}
      current={props.onPick ? props.current : local.model.variant.selected()}
      flat={true}
    />
  )
}
