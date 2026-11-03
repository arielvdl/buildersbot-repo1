import { Alert, AlertContent, AlertDescription, AlertIcon, AlertTitle, Info } from "@buildersbot/ui";
import type { JSX } from "@solidjs/web";
import { useText } from "../../text";

/**
 * Shown in place of the Billing content while billing is off. Every account is handled by the
 * Cultura Builder sales team for now.
 */
export function BillingEnterpriseNotice(): JSX.Element {
  const { t } = useText();
  return (
    <Alert tone="neutral" role="status">
      <AlertIcon>
        <Info aria-hidden="true" />
      </AlertIcon>
      <AlertContent>
        <AlertTitle>{t("billing.enterprise.title")}</AlertTitle>
        <AlertDescription>{t("billing.enterprise.description")}</AlertDescription>
      </AlertContent>
    </Alert>
  );
}
