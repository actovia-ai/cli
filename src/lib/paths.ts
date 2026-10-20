import { homedir } from 'node:os'
import { join } from 'node:path'

export function getActoviaHome(): string {
  return join(homedir(), '.actovia')
}

export function getSkillsDir(actoviaHome: string = getActoviaHome()): string {
  return join(actoviaHome, 'skills')
}
