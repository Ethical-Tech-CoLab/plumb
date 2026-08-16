===== https://cawg.io/about/identity-framework/ =====
CAWG identity assertions require secure digital credentials. A claim of authorship, as described by the CAWG identity assertion, can only be signed using a digital credential using a private/public key pair. This serves to prevent false claims of authorship. [...] 1. X.509 certificates. As part of an interim governance plan, S/MIME certificates typically used to convey organizational identity and widely available through well-governed certificate authorities, can be used to sign CAWG identity assertions.

   |  |  |
    --- |
   |  | These certificates are not compatible with the C2PA claim generator certificates used to sign C2PA manifests. |
2. Identity claims aggregation credentials. These credentials are a specialized version of W3C Verifiable Credentials which allow a trusted platform vendor (known here as an identity claims aggregator) to gather information about a user, typically an individual content creator, and replay those signals on their behalf to sign CAWG identity assertions. [...] ## CAWG credential types

An important aspect of the CAWG identity assertion is that it is built to make use of many credential types. The core requirements for credential formats are that they:

1. Are independently verifiable. (In other words, a public key for a given credential can be located by any interested verifying party.)
2. Have the capacity to sign arbitrary binary payloads. In practice, the payloads are relatively small (typically 1KB or less). The content of the payload, when signed by private keys controlled by the credential holder, indicates the credential holder’s knowledge of the specific digital media asset being described.

As of this writing, the 1.2 version of the CAWG identity assertion describes two credential types:

