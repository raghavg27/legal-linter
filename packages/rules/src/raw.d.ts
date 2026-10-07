// Rule data files are imported as text. defineRule() validates them.
declare module '*.yaml?raw' {
  const content: string;
  export default content;
}
