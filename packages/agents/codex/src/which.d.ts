declare module 'which' {
  export function which(command: string): Promise<string>;
}
