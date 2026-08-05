/// <reference types="vite/client" />

/** SCSS CSS Modules — imported as `Record<string, string>`. */
declare module "*.module.scss" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

/** Global type declarations for CSS modules. */
declare module "*.css" {
  const _: string;
  export default _;
}
