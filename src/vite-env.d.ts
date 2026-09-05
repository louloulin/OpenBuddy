/// <reference types="vite/client" />

// Side-effect CSS imports from workspace packages.
declare module "*.css" {
  const css: string;
  export default css;
}
declare module "@openbuddy/ui-theme/styles" {
  const css: string;
  export default css;
}
