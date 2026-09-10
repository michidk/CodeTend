import { describe, expect, test } from 'bun:test'
import { stripForeignReasoning } from '../agent/lib/model'

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
