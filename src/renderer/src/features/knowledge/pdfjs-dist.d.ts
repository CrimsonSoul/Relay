// pdfjs-dist publishes its declarations at `types/src/pdf.d.ts` and ships no `exports` map, so
// the deep `build/pdf.mjs` specifier the renderer imports resolves to a bare `.mjs` file with no
// adjacent declaration file. Without this alias every pdf.js import in the reader is implicitly
// `any`, which silently disables checking of the page/annotation/text-layer plumbing.
declare module 'pdfjs-dist/build/pdf.mjs' {
  export * from 'pdfjs-dist/types/src/pdf';
}
