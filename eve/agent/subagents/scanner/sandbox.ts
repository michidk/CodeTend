// Give every scanner session its own just-bash backend. Reusing the parent's
// sandbox lets concurrent scanners race on Eve's local sandbox metadata and
// can strand otherwise independent analyses when one reads a partial write.
// The shared definition still mounts the same repository checkout read-only.
export { default } from '../../sandbox/sandbox'
