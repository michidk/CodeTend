import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { SecurityProfile } from '@/lib/security-scans'

const LIST_FIELDS = [
  ['assets', 'Assets'],
  ['entryPoints', 'Entry points and untrusted inputs'],
  ['trustBoundaries', 'Trust boundaries'],
  ['authAssumptions', 'Authentication and authorization assumptions'],
  ['sensitiveDataPaths', 'Sensitive data paths'],
  ['privilegedActions', 'Privileged actions'],
  ['securityInvariants', 'Security invariants'],
  ['priorities', 'Review priorities'],
  ['exclusions', 'Explicit exclusions'],
] as const satisfies readonly [
  Exclude<keyof SecurityProfile, 'projectOverview'>,
  string,
][]

export function SecurityProfileView({ profile }: { profile: SecurityProfile }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Project overview</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {profile.projectOverview || 'No overview was inferred.'}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {LIST_FIELDS.map(([field, label]) => (
          <Card key={field}>
            <CardHeader>
              <CardTitle>{label}</CardTitle>
            </CardHeader>
            <CardContent>
              {profile[field].length > 0 ? (
                <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                  {profile[field].map((value) => (
                    <li key={value}>{value}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nothing was inferred from the repository.
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
