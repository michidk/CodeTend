{{/*
Expand the name of the chart.
*/}}
{{- define "codetend.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "codetend.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "codetend.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "codetend.labels" -}}
helm.sh/chart: {{ include "codetend.chart" . }}
{{ include "codetend.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "codetend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "codetend.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "codetend.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "codetend.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Image reference: prefer an immutable digest, else tag, else appVersion.
*/}}
{{- define "codetend.image" -}}
{{- $image := .image -}}
{{- if $image.digest -}}
{{- printf "%s@%s" $image.repository $image.digest -}}
{{- else -}}
{{- printf "%s:%s" $image.repository (default .appVersion $image.tag) -}}
{{- end -}}
{{- end }}

{{/*
Database secret name - truncate fullname to 49 chars (same as migration) to prevent collision
when fullname ends in "-migrations". Both secrets share the same prefix length.
*/}}
{{- define "codetend.dbSecretName" -}}
{{- printf "%s-db" (include "codetend.fullname" . | trunc 49 | trimSuffix "-") -}}
{{- end }}

{{/*
Migration database secret name - truncate fullname to leave room for "-migrations-db" suffix (14 chars)
*/}}
{{- define "codetend.migrationDbSecretName" -}}
{{- printf "%s-migrations-db" (include "codetend.fullname" . | trunc 49 | trimSuffix "-") -}}
{{- end }}

{{/*
Database URL construction - shared between app and migration secrets
*/}}
{{- define "codetend.databaseUrl" -}}
{{- if .Values.postgresql.external.url -}}
{{- .Values.postgresql.external.url -}}
{{- else -}}
{{- printf "postgresql://%s:%s@%s:%s/%s" .Values.postgresql.auth.username (required "postgresql.auth.password is required" .Values.postgresql.auth.password) (required "postgresql.external.host is required" .Values.postgresql.external.host) .Values.postgresql.external.port .Values.postgresql.auth.database -}}
{{- end -}}
{{- end }}

{{/*
Secret reference for DATABASE_URL, shared by the app container and the migration Job.
*/}}
{{- define "codetend.databaseUrlEnv" -}}
- name: DATABASE_URL
  {{- if .Values.postgresql.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.postgresql.existingSecret }}
      key: {{ .Values.postgresql.existingSecretKey }}
  {{- else }}
  valueFrom:
    secretKeyRef:
      name: {{ .secretName }}
      key: url
  {{- end }}
{{- end }}

{{/* Machine-facing MCP paths that must pass around Hodor's login form. */}}
{{- define "codetend.hodorBypassPaths" -}}
{{- $paths := .Values.hodor.bypassPaths | default list -}}
{{- if .Values.mcp.enabled -}}
{{- $paths = concat $paths (list
  "/api/mcp"
  "/.well-known/oauth-protected-resource/api/mcp"
  "/.well-known/oauth-authorization-server"
  "/oauth/register"
  "/oauth/token"
  "/oauth/revoke") -}}
{{- end -}}
{{- join "," (uniq $paths) -}}
{{- end -}}

{{/* MCP validates the original public host instead of the upstream address. */}}
{{- define "codetend.hodorPreserveHost" -}}
{{- or .Values.hodor.preserveHost .Values.mcp.enabled | ternary "true" "false" -}}
{{- end -}}

{{/*
Environment shared by the app and Eve containers: model endpoint, clone credentials,
data directory and the per-scan guardrails Eve reads directly.
*/}}
{{- define "codetend.sharedEnv" -}}
- name: TECDEBT_DATA_DIR
  value: {{ .Values.data.path | quote }}
- name: OPENAI_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.existingSecret }}
      key: {{ .Values.secrets.openaiApiKeyKey }}
{{- if .Values.model.baseUrlFromSecret }}
- name: OPENAI_BASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.existingSecret }}
      key: {{ .Values.secrets.openaiBaseUrlKey }}
{{- else if .Values.model.baseUrl }}
- name: OPENAI_BASE_URL
  value: {{ .Values.model.baseUrl | quote }}
{{- end }}
- name: TECDEBT_MODEL
  value: {{ .Values.model.id | quote }}
{{- with .Values.model.effort }}
- name: TECDEBT_EFFORT
  value: {{ . | quote }}
{{- end }}
{{- with .Values.model.contextWindowTokens }}
- name: TECDEBT_MODEL_CONTEXT_WINDOW_TOKENS
  value: {{ . | quote }}
{{- end }}
{{- with .Values.model.maxInputTokensPerSession }}
- name: TECDEBT_MAX_INPUT_TOKENS_PER_SESSION
  value: {{ . | quote }}
{{- end }}
{{- if .Values.github.appAuth.existingSecret }}
- name: GITHUB_APP_ID
  valueFrom:
    secretKeyRef:
      name: {{ .Values.github.appAuth.existingSecret }}
      key: {{ .Values.github.appAuth.appIdKey }}
- name: GITHUB_APP_PRIVATE_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.github.appAuth.existingSecret }}
      key: {{ .Values.github.appAuth.privateKeyKey }}
{{- end }}
{{- end }}
