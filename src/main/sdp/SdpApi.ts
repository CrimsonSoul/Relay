// The SDP Cloud API this server calls. A leaf module, so every SDP module (including those
// SdpProvider itself imports) can use these values at load time.

/** The SDP Cloud tenant Relay reads and writes. */
export const SDP_ORIGIN = 'https://support.campingworld.com';
export const SDP_API = `${SDP_ORIGIN}/app/itdesk/api/v3`;
export const SDP_REQUESTS = `${SDP_API}/requests`;

/** Headers for an SDP v3 API call made with a Zoho access token. */
export const sdpHeaders = (token: string) => ({
  Authorization: `Zoho-oauthtoken ${token}`,
  Accept: 'application/vnd.manageengine.sdp.v3+json',
});

/** Plain text as the HTML SDP stores for descriptions, notes and messages. */
export const sdpHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\n', '<br>');
