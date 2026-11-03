import { describe, expect, test } from 'bun:test'
import { createOpenAI } from '@ai-sdk/openai'
import {
  dropProgressEvents,
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

describe('dropProgressEvents', () => {
  test('drops gateway keepalives and keeps every other event across chunk splits', async () => {
    const created =
      'event: response.created\ndata: {"type":"response.created","response":{"id":"r1","created_at":1,"model":"m"}}\n\n'
    const keepalive =
      'data: {"type":"response.in_progress","sequence_number":1,"response":{"id":"resp_keepalive","status":"in_progress"}}\n\n'
    const delta =
      'data: {"type":"response.output_text.delta","item_id":"i","delta":"hi"}\r\n\r\n'
    const done = 'data: [DONE]\n\n'
    const text = created + keepalive + delta + done
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < text.length; i += 7) {
          controller.enqueue(encoder.encode(text.slice(i, i + 7)))
        }
        controller.close()
      },
    })
    const output = await new Response(dropProgressEvents(body)).text()
    expect(output).toBe(
      created +
        'data: {"type":"response.output_text.delta","item_id":"i","delta":"hi"}\n\n' +
        done,
    )
  })
})

describe('gateway tool-call compatibility', () => {
  const item = {
    id: 'fc_test',
    type: 'function_call',
    call_id: 'call_test',
    name: 'bash',
    arguments: '{"command":"pwd"}',
  }
  const event = (tool: object) =>
    `data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: tool })}\n\n`

  test('the real SDK accepts a gateway tool call after normalization', async () => {
    const provider = createOpenAI({
      apiKey: 'fixture',
      fetch: async () => {
        const body = new Response(`${event(item)}data: [DONE]\n\n`).body
        if (!body) throw new Error('Missing fixture body')
        return new Response(dropProgressEvents(body), {
          headers: { 'content-type': 'text/event-stream' },
        })
      },
    })
    const { stream } = await provider
      .responses('claude/claude-sonnet-5-5')
      .doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
      })
    const parts = []
    for await (const part of stream) parts.push(part)
    expect(parts.filter((part) => part.type === 'error')).toEqual([])
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: 'tool-call',
        toolCallId: 'call_test',
        toolName: 'bash',
        input: '{"command":"pwd"}',
      }),
    )
  })

  test.each(['completed', 'incomplete', 'in_progress', 'invalid', null])(
    'preserves explicit status %s',
    async (status) => {
      const text = event({ ...item, status })
      const body = new Response(text).body
      if (!body) throw new Error('Missing fixture body')
      expect(await new Response(dropProgressEvents(body)).text()).toBe(text)
    },
  )

  test('preserves malformed data and upstream failures', async () => {
    const text =
      'data: {invalid}\n\ndata: {"type":"response.failed","response":{"error":{"message":"failed"}}}\n\n'
    const body = new Response(text).body
    if (!body) throw new Error('Missing fixture body')
    expect(await new Response(dropProgressEvents(body)).text()).toBe(text)
  })
})
