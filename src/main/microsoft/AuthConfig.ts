export const msalConfig = {
  auth: {
    clientId: "ENTER_CLIENT_ID_HERE", // User must replace this
    authority: "https://login.microsoftonline.com/common",
    // redirectUri: "relay://auth" // For protocol handling if needed, but we might use loopback
  },
  system: {
    loggerOptions: {
      loggerCallback(_loglevel, message, _containsPii) {
        console.log(message);
      },
      piiLoggingEnabled: false,
      logLevel: 2,
    },
  },
};

export const GRAPH_SCOPES = ["User.Read", "People.Read", "User.ReadBasic.All"];
