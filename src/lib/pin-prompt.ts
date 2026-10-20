/**
 * Reads the app-lock PIN from the terminal without echoing it. Only from an
 * interactive terminal: the PIN is what tells Actovia a person is asking, so
 * it is never taken from an argument, an environment variable or a pipe.
 */
export interface PinInput {
  isTTY?: boolean
  setRawMode?: (mode: boolean) => unknown
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown
  off(event: 'data', listener: (chunk: Buffer | string) => void): unknown
  resume(): unknown
  pause(): unknown
}

export interface PinOutput {
  write(text: string): unknown
}

export class PinCancelled extends Error {
  constructor() {
    super('Cancelled.')
    this.name = 'PinCancelled'
  }
}

export function promptPin(
  question = 'Actovia app-lock PIN: ',
  input: PinInput = process.stdin,
  output: PinOutput = process.stderr
): Promise<string> {
  if (!input.isTTY || !input.setRawMode) {
    return Promise.reject(
      new Error('This command asks for the app-lock PIN and needs an interactive terminal.')
    )
  }
  output.write(question)
  input.setRawMode(true)
  input.resume()
  return new Promise((resolve, reject) => {
    let pin = ''
    const done = (finish: () => void) => {
      input.off('data', onData)
      input.setRawMode?.(false)
      input.pause()
      output.write('\n')
      finish()
    }
    const onData = (chunk: Buffer | string) => {
      for (const ch of chunk.toString()) {
        if (ch === '\r' || ch === '\n') return done(() => resolve(pin))
        // Ctrl-C, Ctrl-D, Escape
        if (ch === '\u0003' || ch === '\u0004' || ch === '\u001b') return done(() => reject(new PinCancelled()))
        if (ch === '\u007f' || ch === '\b') {
          pin = pin.slice(0, -1)
          continue
        }
        if (ch >= ' ') pin += ch
      }
    }
    input.on('data', onData)
  })
}
