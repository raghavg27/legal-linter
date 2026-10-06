// Rule data files are imported as text and validated by defineRule().
declare module '*.yaml?raw' {
  const content: string;
  export default content;
}
