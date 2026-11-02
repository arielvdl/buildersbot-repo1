import { useCSSVariable } from "uniwind";

/**
 * The colors of the sign-in controls. The brand lavender of the logo marks focus, so the controls
 * match the Scan QR code button. `--buildersbot-border-strong` is almost invisible on the dark canvas,
 * so a control shows as a filled surface with a clear ring only when it has focus or a state.
 */
export function useSignInColors() {
  const surface = useCSSVariable("--buildersbot-bg-control-active");
  const brand = useCSSVariable("--buildersbot-logo-production");
  const onBrand = useCSSVariable("--buildersbot-logo-eye");
  const text = useCSSVariable("--buildersbot-text-primary");
  const muted = useCSSVariable("--buildersbot-text-muted");
  const danger = useCSSVariable("--buildersbot-danger");
  const success = useCSSVariable("--buildersbot-success");
  const radius = useCSSVariable("--buildersbot-radius-lg");
  return {
    surface: String(surface ?? "#2a2a2a"),
    brand: String(brand ?? "#d6adf2"),
    onBrand: String(onBrand ?? "#040007"),
    text: String(text ?? "#ffffff"),
    muted: String(muted ?? "#979797"),
    danger: String(danger ?? "#fd2f3b"),
    success: String(success ?? "#31cf76"),
    radius: Number.parseFloat(String(radius ?? "12")),
  };
}

export type SignInColors = ReturnType<typeof useSignInColors>;

/** The height of every sign-in control, so a button and the field that replaces it match. */
export const SIGN_IN_CONTROL_HEIGHT = 52;
