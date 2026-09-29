import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import { scannerAgentMessage } from '../eve/agent/lib/scanner-message'
import { SEVERITY_ORDER, scannerResultSchema } from '../src/lib/findings'
import { getScanner } from '../src/lib/scanners'

const severity = z.enum(['low', 'medium', 'high', 'critical'])
const cases = z
  .array(
    z.object({
      id: z.string(),
      scanners: z.array(z.string()),
      files: z.record(z.string(), z.string()),
      expected: z.array(
        z.object({
          scannerId: z.string(),
          path: z.string(),
          minSeverity: severity,
          maxSeverity: severity,
          rootCause: z.string(),
        }),
      ),
    }),
  )
  .parse(
    JSON.parse(
      await readFile(
        new URL('../evals/scanners/cases.json', import.meta.url),
        'utf8',
      ),
    ),
  )
const resultsSchema = z.array(
  z.object({
    caseId: z.string(),
    scanners: z.array(
      z.object({ scannerId: z.string(), result: scannerResultSchema }),
    ),
    rescan: z
      .array(z.object({ scannerId: z.string(), result: scannerResultSchema }))
      .optional(),
  }),
)
const [command, destination, previousResults] = process.argv.slice(2)
if (!destination || !['prepare', 'score'].includes(command ?? '')) {
  throw new Error(
    'Usage: bun run eval:scanners prepare <new-directory> [first-pass-results.json] | score <results.json>',
  )
}
if (command === 'prepare') {
  // Exclusive creation prevents overwriting a user's directory or following
  // pre-existing fixture symlinks. Rescans use a separate export directory.
  const root = resolve(destination)
  await mkdir(root, { recursive: false })
  const prior = previousResults
    ? resultsSchema.parse(JSON.parse(await readFile(previousResults, 'utf8')))
    : []
  const instructions = await readFile(
    new URL('../eve/agent/subagents/scanner/instructions.md', import.meta.url),
    'utf8',
  )
  const expected: unknown[] = []
  for (const fixture of cases) {
    const repository = resolve(root, fixture.id, 'repository')
    for (const [path, contents] of Object.entries(fixture.files)) {
      const file = resolve(repository, path)
      if (!file.startsWith(`${repository}/`))
        throw new Error('Fixture path escapes repository')
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, contents, { flag: 'wx' })
    }
    const scanners = fixture.scanners.map((id) => {
      const definition = getScanner(id)
      if (!definition) throw new Error(`Unknown scanner ${id}`)
      const previous = prior
        .find((result) => result.caseId === fixture.id)
        ?.scanners.find((result) => result.scannerId === id)?.result
      return {
        ...definition,
        executionProfile: {
          model: process.env.TECDEBT_MODEL ?? 'evaluation-runner',
          effort: 'high' as const,
        },
        attentionHistory: [],
        hypotheses: (previous?.findings ?? []).map((finding, index) => ({
          findingId: index + 1,
          fingerprint: finding.fingerprint,
          title: finding.title,
          severity: finding.severity,
          description: finding.description,
          locations: finding.locations,
        })),
      }
    })
    for (const scanner of scanners) {
      const message = scannerAgentMessage({
        scanner,
        siblingScanners: scanners,
        repoPath: repository,
        repositoryName: fixture.id,
        workspace: {
          name: fixture.id,
          hostPath: repository,
          commitSha: 'fixture-v1',
          fileCount: Object.keys(fixture.files).length,
          files: [],
          topLevel: [
            ...new Set(
              Object.keys(fixture.files).map(
                (path) => path.split('/')[0] ?? path,
              ),
            ),
          ],
        },
        knowledge: {
          refreshed: true,
          overview: 'Inspect the fixture repository directly.',
          summary: {
            languages: [],
            frameworks: [],
            subsystems: [],
            concepts: [],
          },
          sources: [],
          reason: 'Evaluation fixture.',
          dependencyGraph: {
            edges: [],
            cycles: [],
            cycleStatus: 'unavailable',
            componentCount: null,
          },
        },
        gitnexusRepo: null,
        previousCommitSha: previousResults ? 'fixture-v1' : null,
        target: { kind: 'repository' },
        maxInputTokens: 30_000,
        attentionHistory: [],
        securityProfile: null,
      })
      await writeFile(
        resolve(root, fixture.id, `${scanner.id}.json`),
        JSON.stringify(
          {
            system: instructions,
            message,
            outputSchema: z.toJSONSchema(scannerResultSchema, {
              target: 'draft-7',
              io: 'input',
            }),
          },
          null,
          2,
        ),
      )
    }
    expected.push({ caseId: fixture.id, expected: fixture.expected })
  }
  await writeFile(
    resolve(root, 'rubric.json'),
    JSON.stringify(expected, null, 2),
  )
  console.log(
    `Prepared ${cases.length} isolated fixtures and production scanner prompts in ${root}. Keep rubric.json outside scanner sandboxes.`,
  )
} else {
  const results = resultsSchema.parse(
    JSON.parse(await readFile(destination, 'utf8')),
  )
  const failures: string[] = []
  for (const fixture of cases) {
    const matches = results.filter((result) => result.caseId === fixture.id)
    const actual = matches[0]
    if (matches.length !== 1 || !actual) {
      failures.push(`${fixture.id}: expected exactly one result`)
      continue
    }
    for (const scannerId of fixture.scanners) {
      const rows = actual.scanners.filter(
        (result) => result.scannerId === scannerId,
      )
      if (rows.length !== 1)
        failures.push(
          `${fixture.id}/${scannerId}: missing or repeated scanner result`,
        )
    }
    const found = actual.scanners.flatMap((row) =>
      row.result.findings.map((finding) => ({
        scannerId: row.scannerId,
        finding,
      })),
    )
    if (found.length !== fixture.expected.length)
      failures.push(
        `${fixture.id}: expected ${fixture.expected.length} findings, got ${found.length} (miss or duplicate/false positive)`,
      )
    for (const expected of fixture.expected) {
      const matching = found.filter(
        (row) =>
          row.scannerId === expected.scannerId &&
          [
            ...row.finding.locations,
            ...row.finding.evidence.flatMap((e) =>
              e.kind === 'file' ? [e] : [],
            ),
          ].some((location) => location.path === expected.path),
      )
      if (matching.length !== 1) {
        failures.push(
          `${fixture.id}: ownership/location mismatch for ${expected.rootCause}`,
        )
        continue
      }
      const rank = SEVERITY_ORDER[matching[0]?.finding.severity ?? 'low']
      if (
        rank > SEVERITY_ORDER[expected.minSeverity] ||
        rank < SEVERITY_ORDER[expected.maxSeverity]
      )
        failures.push(`${fixture.id}: severity outside rubric range`)
    }
    if (!actual.rescan) {
      failures.push(`${fixture.id}: missing unchanged rescan`)
      continue
    }
    for (const first of actual.scanners) {
      const second = actual.rescan.filter(
        (row) => row.scannerId === first.scannerId,
      )
      if (second.length !== 1) {
        failures.push(
          `${fixture.id}/${first.scannerId}: missing or repeated rescan`,
        )
        continue
      }
      const rescanned = second[0]?.result
      const identities = (
        result: z.infer<typeof scannerResultSchema> | undefined,
      ) =>
        (result?.findings ?? [])
          .map((f) => `${f.fingerprint}:${f.severity}`)
          .sort()
      if (
        JSON.stringify(identities(first.result)) !==
        JSON.stringify(identities(rescanned))
      )
        failures.push(
          `${fixture.id}/${first.scannerId}: unchanged-rescan identity/severity drift`,
        )
      for (const [index, finding] of first.result.findings.entries()) {
        const verdict = rescanned?.hypothesisVerdicts.find(
          (v) => v.previousFindingId === index + 1,
        )
        if (
          verdict?.verdict !== 'confirmed' ||
          !rescanned?.findings.some(
            (f) =>
              f.previousFindingId === index + 1 &&
              f.fingerprint === finding.fingerprint,
          )
        )
          failures.push(
            `${fixture.id}/${first.scannerId}: unchanged finding not verified with its prior identity`,
          )
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        cases: cases.length,
        failures,
        semanticReview:
          'Also compare each description and recommendation with rubric.rootCause; a matching file is not proof of a correct finding.',
      },
      null,
      2,
    ),
  )
  if (failures.length) process.exitCode = 1
}
