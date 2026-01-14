const express = require("express");

function createGoogleOAuthRouter(options = {}) {
  const { googleAuth, sheetsScopes, refreshSheetCache, logger } = options;
  const router = express.Router();

  router.get("/google/oauth/start", (req, res) => {
    if (!googleAuth?.hasOAuthConfig()) {
      return res
        .status(500)
        .send("Google OAuth is not configured. Check your .env settings.");
    }

    const oauthClient = googleAuth.buildOAuthClient();
    const authUrl = oauthClient.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: sheetsScopes
    });

    return res.redirect(authUrl);
  });

  router.get("/google/oauth/callback", async (req, res) => {
    if (!googleAuth?.hasOAuthConfig()) {
      return res
        .status(500)
        .send("Google OAuth is not configured. Check your .env settings.");
    }

    const code = Array.isArray(req.query.code)
      ? req.query.code[0]
      : req.query.code;
    const error = Array.isArray(req.query.error)
      ? req.query.error[0]
      : req.query.error;

    if (error) {
      return res.status(400).send(`OAuth error: ${error}`);
    }

    if (!code) {
      return res.status(400).send("Missing OAuth code.");
    }

    try {
      const oauthClient = googleAuth.buildOAuthClient();
      const { tokens } = await oauthClient.getToken(code);
      oauthClient.setCredentials(tokens);
      googleAuth.setOAuthTokens(tokens);

      if (typeof refreshSheetCache === "function") {
        refreshSheetCache().catch((refreshError) => {
          logger?.warn?.("sheet_refresh_after_oauth_failed", {
            error: refreshError.message
          });
        });
      }

      return res.send(
        "Google OAuth connected. You can close this tab and use the bot."
      );
    } catch (oauthError) {
      logger?.error?.("google_oauth_callback_failed", {
        error: oauthError.response?.data || oauthError.message
      });
      return res.status(500).send("OAuth failed. Check server logs.");
    }
  });

  return router;
}

module.exports = {
  createGoogleOAuthRouter
};
