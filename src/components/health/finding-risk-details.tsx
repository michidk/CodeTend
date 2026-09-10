import { Badge } from '@/components/ui/badge'
import type {
  FindingClassification,
  FindingPriority,
  SecurityContext,
  VulnerabilityMetadata,
} from '@/lib/findings'

interface FindingRiskData {
  readonly classification: FindingClassification | null
  readonly securityContext: SecurityContext | null
  readonly vulnerability: VulnerabilityMetadata | null
  readonly priority: FindingPriority | null
  readonly priorityScore: number | null
  readonly priorityReasons: readonly string[]
}

export function FindingRiskDetails({
  finding,
}: {
  readonly finding: FindingRiskData
}) {
  const classification = [
    ...(finding.classification?.cwes ?? []),
    ...(finding.classification?.owasp ?? []),
  ]
  const vulnerability = finding.vulnerability
  if (
    classification.length === 0 &&
    !vulnerability &&
    !finding.priority &&
    !finding.securityContext
  ) {
    return null
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <div>
        <RiskHeading>Contextual priority</RiskHeading>
        <p className="mt-1">
          {finding.priority ? (
            <>
              <span className="font-semibold capitalize">
                {finding.priority}
              </span>
              {finding.priorityScore == null
                ? null
                : ` · ${Math.round(finding.priorityScore)}/100`}
            </>
          ) : (
            'Not scored'
          )}
        </p>
        {finding.priorityReasons.length > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {finding.priorityReasons.join(' · ')}
          </p>
        ) : null}
      </div>

      {classification.length > 0 ? (
        <div>
          <RiskHeading>Classification</RiskHeading>
          <div className="mt-1 flex flex-wrap gap-1">
            {classification.map((label) => (
              <Badge key={label} variant="outline">
                {label}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {finding.securityContext ? (
        <div>
          <RiskHeading>Repository context</RiskHeading>
          <p className="mt-1 text-xs text-muted-foreground">
            Reachability: {finding.securityContext.reachability} · Exposure:{' '}
            {finding.securityContext.exposure} · Data sensitivity:{' '}
            {finding.securityContext.dataSensitivity}
          </p>
        </div>
      ) : null}

      {vulnerability ? (
        <VulnerabilityDetails vulnerability={vulnerability} />
      ) : null}
    </div>
  )
}

function VulnerabilityDetails({
  vulnerability,
}: {
  readonly vulnerability: VulnerabilityMetadata
}) {
  const cvss = vulnerability.cvss[0]
  const epss = vulnerability.epss[0]
  const kev = vulnerability.kev[0]
  return (
    <>
      <div>
        <RiskHeading>Matched package</RiskHeading>
        <p className="mt-1">
          <code>
            {vulnerability.package.ecosystem}/{vulnerability.package.name}@
            {vulnerability.package.version}
          </code>
        </p>
        {vulnerability.package.purl ? (
          <p className="mt-1 break-all text-xs text-muted-foreground">
            {vulnerability.package.purl}
          </p>
        ) : null}
      </div>

      <div>
        <RiskHeading>Published advisories</RiskHeading>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {vulnerability.advisories.map((advisory) =>
            advisory.url ? (
              <a
                key={advisory.id}
                href={advisory.url}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-link hover:underline"
              >
                {advisory.id}
              </a>
            ) : (
              <span key={advisory.id}>{advisory.id}</span>
            ),
          )}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Metric
          label="CVSS"
          value={
            cvss ? `${cvss.score.toFixed(1)} (${cvss.version})` : 'Unavailable'
          }
          detail={cvss?.vector}
        />
        <Metric
          label="EPSS"
          value={
            epss ? `${(epss.probability * 100).toFixed(2)}%` : 'Unavailable'
          }
          detail={
            epss
              ? `${(epss.percentile * 100).toFixed(1)}th percentile · ${epss.date}`
              : undefined
          }
        />
        <Metric
          label="CISA KEV"
          value={kev ? 'Known exploited' : 'Not listed'}
          detail={
            kev ? `Added ${kev.dateAdded} · due ${kev.dueDate}` : undefined
          }
        />
      </div>

      {kev ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs">
          <span className="font-semibold text-destructive-text">
            Required action:
          </span>{' '}
          {kev.requiredAction}
          {kev.knownRansomwareCampaignUse !== 'Unknown'
            ? ` Ransomware use: ${kev.knownRansomwareCampaignUse}.`
            : ''}
        </div>
      ) : null}

      <div>
        <RiskHeading>Match evidence</RiskHeading>
        <p className="mt-1 text-xs text-muted-foreground">
          {vulnerability.match.confidence} confidence ·{' '}
          {vulnerability.match.method} ·{' '}
          {vulnerability.match.evidence.join(' · ')}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {vulnerability.fixedVersions.length > 0
            ? `Fixed versions: ${vulnerability.fixedVersions.join(', ')}`
            : 'No fixed version is listed by OSV.'}
        </p>
      </div>
    </>
  )
}

function Metric({
  label,
  value,
  detail,
}: {
  readonly label: string
  readonly value: string
  readonly detail?: string
}) {
  return (
    <div className="rounded-md border border-border bg-background/60 p-2">
      <RiskHeading>{label}</RiskHeading>
      <p className="mt-1 font-semibold">{value}</p>
      {detail ? (
        <p className="mt-1 break-all text-[0.7rem] text-muted-foreground">
          {detail}
        </p>
      ) : null}
    </div>
  )
}

function RiskHeading({ children }: { readonly children: string }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  )
}
