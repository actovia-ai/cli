import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'

import { PinCancelled, promptPin } from './pin-prompt'

function fakeTty(isTTY = true) {
  const tty = Object.assign(new EventEmitter(), {
    isTTY,
    raw: false,
    setRawMode(mode: boolean) {
      tty.raw = mode
    },
    resume() {},
    pause() {}
  })
  return tty
}

const silent = () => {
  const written: string[] = []
  return { written, write: (t: string) => written.push(t) }
}

describe('promptPin', () => {
  test('reads the PIN without echoing it, with backspace', async () => {
    const tty = fakeTty()
    const out = silent()
    const pin = promptPin('PIN: ', tty, out)
    expect(tty.raw).toBe(true)
    tty.emit('data', '12x')
    tty.emit('data', '\u007f')
    tty.emit('data', '34\r')
    expect(await pin).toBe('1234')
    expect(tty.raw).toBe(false)
    expect(out.written.join('')).toBe('PIN: \n')
  })

  test('Ctrl-C cancels', async () => {
    const tty = fakeTty()
    const pin = promptPin('PIN: ', tty, silent())
    tty.emit('data', '12\u0003')
    await expect(pin).rejects.toBeInstanceOf(PinCancelled)
  })

  test('refuses without an interactive terminal — never a piped PIN', async () => {
    await expect(promptPin('PIN: ', fakeTty(false), silent())).rejects.toThrow(/interactive terminal/)
  })
})
