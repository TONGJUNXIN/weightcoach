/// <reference types="vite/client" />

declare module "*?url" {
  const url: string;
  export default url;
}

declare module "*?inline" {
  const dataUrl: string;
  export default dataUrl;
}
