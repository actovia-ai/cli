import { DesktopApiError, type DesktopClient } from './desktop-client'

/**
 * A read the desktop app refuses while it is locked: the first refusal asks
 * for the app-lock PIN once (a correct one unlocks the app and buys a pass),
 * and the read is tried again. Anything else is thrown as it came.
 */
export async function whileUnlocked<T>(
  client: DesktopClient,
  askPin: () => Promise<string>,
  read: () => Promise<T>
): Promise<T> {
  try {
    return await read()
  } catch (err) {
    if (!(err instanceof DesktopApiError) || err.code !== 'APP_LOCKED' || client.authorized) throw err
    await client.authorize(askPin)
    return await read()
  }
}

/** Buys a pass with the PIN unless this run holds one already. */
export async function ensurePass(client: DesktopClient, askPin: () => Promise<string>): Promise<void> {
  if (!client.authorized) await client.authorize(askPin)
}
