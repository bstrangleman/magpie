/** The version in package.json, filled in by Vite (see vite.config.ts). */
declare const __APP_VERSION__: string;

/** Every Phosphor icon as [name, svg path, search terms] (see scripts/vite-phosphor.ts). */
declare module 'virtual:phosphor-icons' {
  const icons: [name: string, d: string, terms: string][];
  export default icons;
}
