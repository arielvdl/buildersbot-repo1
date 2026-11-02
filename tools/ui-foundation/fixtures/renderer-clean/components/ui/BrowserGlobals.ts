// window.buildersbot belongs in the application adapter.
export const documentation = "window.buildersbot";
export const viewport = () => window.innerWidth;
export const platformAction = (props: { buildersbot: () => void }) => props.buildersbot();
