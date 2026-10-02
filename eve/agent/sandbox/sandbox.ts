import { defineSandbox } from 'eve/sandbox'
import { JustBashSandbox } from 'eve/sandbox/just-bash'
import { workspacesDir } from '../lib/paths'

/**
 * The scan sandbox: a just-bash virtual shell with the host's fresh
 * repository checkouts mounted read-only at /workspace/repos. Agents get
 * ls/cat/rg/grep/find/wc/head/sed/jq etc. without a container, and cannot
 * modify the checkout. Swap `JustBashSandbox` for a container-backed
 * environment when scanners must
 * run real language toolchains.
 */
export const environment = JustBashSandbox.environment({
  autoInstall: false,
  filesystem: ({ defaultFilesystem, justBash }) => {
    const filesystem = new justBash.MountableFs({ base: defaultFilesystem })
    filesystem.mount(
      '/workspace/repos',
      new justBash.OverlayFs({
        root: workspacesDir(),
        mountPoint: '/',
        readOnly: true,
        maxFileReadSize: 4 * 1024 * 1024,
      }),
    )
    return filesystem
  },
})

export default defineSandbox(() => environment.open())
