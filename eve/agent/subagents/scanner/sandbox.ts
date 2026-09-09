import { defineSandbox } from 'eve/sandbox'

export default defineSandbox(({ parent }) => {
  if (parent === null) throw new Error('scanner must run as a subagent')
  return parent.sandbox
})
