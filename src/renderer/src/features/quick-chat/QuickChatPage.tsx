import { Textarea, Zap } from "@buildersbot/ui";
import { useText } from "@buildersbot/ui/text";
import { onSettled } from "solid-js";

/**
 * The Quick chat page in the middle pane. For now it shows only the empty start: the list of
 * conversations and the chat come next. A new draft has the focus, so the person can type at once.
 */
export function QuickChatPage() {
  const { t } = useText();
  let input: HTMLTextAreaElement | undefined;
  onSettled(() => input?.focus());
  return (
    <section class="quick-page" aria-label={t("quick.page.label")}>
      <div class="quick-page-empty">
        <span class="quick-page-bolt" aria-hidden="true">
          <Zap />
        </span>
        <h2 class="quick-page-title">{t("quick.empty.title")}</h2>
      </div>
      <div class="quick-page-composer">
        <Textarea
          ref={(element: HTMLTextAreaElement) => {
            input = element;
          }}
          rows={1}
          aria-label={t("quick.composer.label")}
          placeholder={t("quick.composer.placeholder")}
        />
      </div>
    </section>
  );
}
