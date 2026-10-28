import type { Command } from 'commander'
import { render } from 'ink'
import React from 'react'

import { getSkillDetail, searchSkills, type SkillListItem } from '../lib/skills-sh-client'
import { getSkillsDir } from '../lib/paths'
import {
  installSkill,
  listInstalledSkills,
  uninstallSkill,
  type InstalledSkill
} from '../lib/skills-store'
import { getUpdateBadge } from '../lib/update-notifier'
import { App } from '../tui/app'
import { uiFor } from '../lib/ui'
import { printable } from './devices'
import { reportError } from './report-error'

interface JsonOpt {
  json?: boolean
  skillsDir?: string
  print?: (text: string) => void
  color?: boolean
}

const printer = (opts: JsonOpt) => opts.print ?? ((text: string) => console.log(text))

export async function runSkillsSearch(
  query: string,
  opts: JsonOpt = {}
): Promise<SkillListItem[]> {
  try {
    const { data } = await searchSkills(query)
    const print = printer(opts)
    const ui = uiFor(opts)
    if (opts.json) {
      print(JSON.stringify(data, null, 2))
    } else if (data.length === 0) {
      print(`No skills match "${printable(query)}".`)
    } else {
      const rows = data.map(item => [printable(item.id), ui.st.dim(`${item.installs.toLocaleString('en-US')} installs`)])
      for (const line of ui.table(rows, { right: [1] })) print(line)
    }
    return data
  } catch (err) {
    reportError(err, opts.json)
    return []
  }
}

export async function runSkillsInstall(
  id: string,
  opts: JsonOpt = {}
): Promise<InstalledSkill | null> {
  try {
    const detail = await getSkillDetail(id)
    const installed = await installSkill(opts.skillsDir ?? getSkillsDir(), detail)
    if (opts.json) {
      printer(opts)(JSON.stringify(installed, null, 2))
    } else {
      printer(opts)(uiFor(opts).done(`Installed ${printable(installed.displayName)} (${printable(installed.slug)}).`))
    }
    return installed
  } catch (err) {
    reportError(err, opts.json)
    return null
  }
}

export async function runSkillsList(opts: JsonOpt = {}): Promise<InstalledSkill[]> {
  try {
    const installed = await listInstalledSkills(opts.skillsDir ?? getSkillsDir())
    const print = printer(opts)
    const ui = uiFor(opts)
    if (opts.json) {
      print(JSON.stringify(installed, null, 2))
    } else if (installed.length === 0) {
      print('No skills installed.')
      print(ui.next('actovia skills'))
    } else {
      const rows = installed.map(skill =>
        skill.isActive
          ? [`${ui.st.green('●')} ${printable(skill.slug)}`, 'active']
          : [ui.st.dim(`○ ${printable(skill.slug)}`), ui.st.dim('off')]
      )
      for (const line of ui.table(rows)) print(line)
    }
    return installed
  } catch (err) {
    reportError(err, opts.json)
    return []
  }
}

export async function runSkillsUninstall(slug: string, opts: JsonOpt = {}): Promise<void> {
  try {
    await uninstallSkill(opts.skillsDir ?? getSkillsDir(), slug)
    if (!opts.json) printer(opts)(uiFor(opts).done(`Uninstalled ${printable(slug)}.`))
  } catch (err) {
    reportError(err, opts.json)
  }
}

export function registerSkillsCommand(program: Command): Command {
  const skills = program
    .command('skills')
    .description('Browse and manage skills.sh skills')
    .action(async () => {
      // Read from the cache the last launch populated — never block the TUI on
      // the network. The full one-liner still prints to stderr on exit.
      const updateNotice = await getUpdateBadge()
      // Take over the terminal like vim does and hand it back untouched on exit.
      render(<App updateNotice={updateNotice} />, { alternateScreen: true })
    })

  skills
    .command('search <query>')
    .description('Search skills.sh')
    .option('--json', 'output JSON instead of a formatted list')
    .action(async (query: string, opts: { json?: boolean }) => {
      await runSkillsSearch(query, opts)
    })

  skills
    .command('install <id>')
    .description('Install a skill by id (e.g. vercel-labs/skills/find-skills)')
    .option('--json', 'output JSON instead of a formatted message')
    .action(async (id: string, opts: { json?: boolean }) => {
      await runSkillsInstall(id, opts)
    })

  skills
    .command('list')
    .description('List installed skills')
    .option('--json', 'output JSON instead of a formatted list')
    .action(async (opts: { json?: boolean }) => {
      await runSkillsList(opts)
    })

  skills
    .command('uninstall <slug>')
    .description('Uninstall a skill')
    .option('--json', 'output JSON instead of a formatted message')
    .action(async (slug: string, opts: { json?: boolean }) => {
      await runSkillsUninstall(slug, opts)
    })

  return skills
}
