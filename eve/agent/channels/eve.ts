import { httpBasic, localDev } from 'eve/channels/auth'
import { eveChannel } from 'eve/channels/eve'

/** The tecdebt app authenticates with HTTP Basic; `eve dev` stays open locally. */
export default eveChannel({
  auth: [
    httpBasic({
      username: process.env.EVE_USERNAME ?? 'tecdebt',
      password: process.env.EVE_PASSWORD ?? 'dev-password',
    }),
    localDev(),
  ],
  turnPolicy: 'queue',
})
