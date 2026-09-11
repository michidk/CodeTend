import { describe, expect, test } from 'bun:test'
import {
  modelSettingsMiddleware,
  resolveModelSettings,
  stripForeignReasoning,
} from '../agent/lib/model'

type TransformParams = NonNullable<typeof stripForeignReasoning.transformParams>
type CallOptions = Parameters<TransformParams>[0]['params']
type Model = Parameters<TransformParams>[0]['model']

describe('stripForeignReasoning', () => {
  test('removes reasoning parts from assistant messages only', async () => {
    const params: CallOptions = {
      prompt: [
        { role: 'system', content: 'You scan code.' },
        { role: 'user', content: [{ type: 'text', text: 'go' }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: '',
              providerOptions: { anthropic: { signature: 'abc' } },
            },
            { type: 'text', text: 'Looking at src/.' },
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'read_file',
              input: { path: 'src/index.ts' },
            },
          ],
        },
      ],
    }

    const transformed = await stripForeignReasoning.transformParams?.({
      type: 'generate',
      params,
      model: {} as Model,
    })

    expect(transformed?.prompt[0]).toEqual(params.prompt[0])
    expect(transformed?.prompt[1]).toEqual(params.prompt[1])
    const assistant = transformed?.prompt[2]
    expect(assistant?.role).toBe('assistant')
    if (assistant?.role !== 'assistant') throw new Error('unreachable')
    expect(assistant.content.map((part) => part.type)).toEqual([
      'text',
      'tool-call',
    ])
  })
})

describe('resolveModelSettings', () => {
  test('defaults to GPT-5.6 Sol at medium effort', () => {
    expect(resolveModelSettings({})).toEqual({
      modelId: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
    })
  })

  test('raises the default effort for Claude ids served through a gateway', () => {
    expect(
      resolveModelSettings({ TECDEBT_MODEL: 'anthropic/claude-opus-5' }),
    ).toEqual({ modelId: 'anthropic/claude-opus-5', reasoningEffort: 'high' })
  })

  test('honours an explicit effort and ignores unknown values', () => {
    expect(
      resolveModelSettings({ TECDEBT_EFFORT: 'XHigh' }).reasoningEffort,
    ).toBe('xhigh')
    expect(
      resolveModelSettings({ TECDEBT_EFFORT: 'turbo' }).reasoningEffort,
    ).toBe('medium')
  })
})

describe('modelSettingsMiddleware', () => {
  const params: CallOptions = {
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
  }

  test('sends effort and low verbosity for native OpenAI reasoning models', async () => {
    const transformed = await modelSettingsMiddleware({
      modelId: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
    }).transformParams?.({ type: 'generate', params, model: {} as Model })

    expect(transformed?.providerOptions?.openai).toEqual({
      reasoningEffort: 'medium',
      textVerbosity: 'low',
    })
  })

  test('forces reasoning options for gateway model ids without changing the system role', async () => {
    const transformed = await modelSettingsMiddleware({
      modelId: 'anthropic/claude-opus-5',
      reasoningEffort: 'high',
    }).transformParams?.({ type: 'generate', params, model: {} as Model })

    expect(transformed?.providerOptions?.openai).toEqual({
      reasoningEffort: 'high',
      textVerbosity: 'low',
      forceReasoning: true,
      systemMessageMode: 'system',
    })
  })

  test('lets per-call provider options win', async () => {
    const transformed = await modelSettingsMiddleware({
      modelId: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
    }).transformParams?.({
      type: 'generate',
      params: {
        ...params,
        providerOptions: { openai: { reasoningEffort: 'low' } },
      },
      model: {} as Model,
    })

    expect(transformed?.providerOptions?.openai).toMatchObject({
      reasoningEffort: 'low',
      textVerbosity: 'low',
    })
  })
})
