import { defineSandbox } from 'eve/sandbox'
import { justbash } from 'eve/sandbox/just-bash'
import { workspacesDir } from '../lib/paths'

/**
 * The scan sandbox: a just-bash virtual shell with the host's fresh
 * repository checkouts mounted read-only at /workspace/repos. Agents get
 * ls/cat/rg/grep/find/wc/head/sed/jq etc. without a container, and cannot
 * modify the checkout. Swap `justbash` for `docker()` when scanners must
 * run real language toolchains.
 */
export default defineSandbox({
  description: 'Read-only view of the repository checkouts under analysis.',
  backend: () =>
    justbash({
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
    }),
})
