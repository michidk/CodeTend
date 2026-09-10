import { httpBasic, localDev } from 'eve/channels/auth'
import { eveChannel } from 'eve/channels/eve'

/** The tecdebt app authenticates with HTTP Basic; `eve dev` stays open locally. */
const password = process.env.EVE_PASSWORD
if (!password && process.env.NODE_ENV === 'production') {
  throw new Error('EVE_PASSWORD is required in production')
}

export default eveChannel({
  auth: [
    httpBasic({
      username: process.env.EVE_USERNAME ?? 'tecdebt',
      password: password ?? 'dev-password',
    }),
    localDev(),
  ],
  turnPolicy: 'queue',
})
