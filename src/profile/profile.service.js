const { logger: defaultLogger } = require("../../utils/logger");

function createProfileService(options = {}) {
  const {
    seatalkMcpTools,
    requestWithAuth,
    profileUrl,
    profileMethod,
    profileLookupEnabled,
    profileLookupCooldownMs,
    profileCacheMinutes,
    greetingOverridesJson,
    logger = defaultLogger
  } = options;

  const profileCache = new Map();
  let profileLookupDisabledUntilMs = 0;
  const greetingOverrides = loadGreetingOverrides(greetingOverridesJson, logger);

  function getSeatalkIdentity(event) {
    const sender = event?.sender || event?.message?.sender || null;
    return {
      seatalk_id: event?.seatalk_id || sender?.seatalk_id || null,
      employee_code: event?.employee_code || sender?.employee_code || null,
      email: event?.email || sender?.email || null
    };
  }

  function formatUserName(event) {
    if (event?.name) {
      return event.name;
    }

    const sender = event?.sender || event?.message?.sender;
    const senderName =
      sender?.name ||
      sender?.display_name ||
      sender?.displayName ||
      sender?.full_name ||
      sender?.fullName;
    if (senderName) {
      return senderName;
    }

    const identity = getSeatalkIdentity(event);
    if (identity.email) {
      const localPart = String(identity.email).split("@")[0] || "";
      const cleaned = localPart.replace(/[._-]+/g, " ").trim();
      if (cleaned) {
        return toTitleCase(cleaned);
      }
    }

    if (identity.employee_code) {
      return `Employee ${identity.employee_code}`;
    }

    if (identity.seatalk_id) {
      return `User ${identity.seatalk_id}`;
    }

    return "there";
  }

  function formatFirstName(value) {
    const cleaned = String(value || "").trim();
    if (!cleaned) {
      return "there";
    }
    return cleaned.split(/\s+/)[0];
  }

  function buildGreetingFromName(name) {
    const firstName = formatFirstName(name);
    return `Hello ${firstName} \u{1F44B} How are you today, how can I help \u{1F642}?`;
  }

  function getPhilippinesHour() {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone: "Asia/Manila"
      });
      const hour = Number(formatter.format(new Date()));
      if (Number.isFinite(hour)) {
        return hour;
      }
    } catch (error) {
      // Fall through to manual calc.
    }

    const utcHour = new Date().getUTCHours();
    return (utcHour + 8) % 24;
  }

  function getTimeOfDayGreeting() {
    const hour = getPhilippinesHour();
    if (hour < 12) {
      return "Good Morning";
    }
    if (hour < 18) {
      return "Good Afternoon";
    }
    return "Good Evening";
  }

  function getTitleForProfile(profile) {
    const email = String(profile.email || "").toLowerCase();
    const isSpx = email.endsWith("@spxexpress.com");
    if (!isSpx) {
      return "";
    }

    if (profile.gender === "female") {
      return "Ma'am";
    }

    return "Sir";
  }

  function getGreetingOverride(profile) {
    const email = String(profile.email || "").toLowerCase();
    if (!email) {
      return null;
    }
    const override = greetingOverrides.get(email);
    if (!override) {
      return null;
    }

    const title = override.gender === "female" ? "Ma'am" : "Sir";
    return `Hello ${title} ${override.name} \u{1F44B}, How can I assist you today?`;
  }

  function shouldSkipProfileLookup() {
    if (!profileLookupEnabled) {
      return true;
    }
    if (
      profileLookupDisabledUntilMs &&
      Date.now() < profileLookupDisabledUntilMs
    ) {
      return true;
    }
    return false;
  }

  function getSeatalkErrorCode(error) {
    const code =
      error?.normalized?.code ||
      error?.payload?.code ||
      error?.response?.data?.code;
    return Number.isFinite(Number(code)) ? Number(code) : null;
  }

  function disableProfileLookupTemporarily(reason) {
    if (!profileLookupCooldownMs) {
      return;
    }
    profileLookupDisabledUntilMs =
      Date.now() + profileLookupCooldownMs;
    logger.warn("profile_lookup_disabled", {
      reason,
      untilMs: profileLookupDisabledUntilMs
    });
  }

  function getProfileCacheKey(event) {
    const identity = getSeatalkIdentity(event);
    return identity.seatalk_id || identity.employee_code || identity.email || null;
  }

  function getCachedProfile(key) {
    if (!key || !profileCache.has(key)) {
      return null;
    }

    const entry = profileCache.get(key);
    if (!entry || Date.now() > entry.expiresAtMs) {
      profileCache.delete(key);
      return null;
    }

    return entry;
  }

  function cacheProfile(key, profile) {
    if (!key || !profile || !profile.name || profileCacheMinutes <= 0) {
      return;
    }

    profileCache.set(key, {
      name: profile.name,
      gender: profile.gender || null,
      email: profile.email || null,
      expiresAtMs: Date.now() + profileCacheMinutes * 60 * 1000
    });
  }

  function extractGender(profile) {
    if (!profile) {
      return null;
    }
    const candidates = [
      profile.gender,
      profile.sex,
      profile.gender_code,
      profile.is_male,
      profile.isMale,
      profile.is_female,
      profile.isFemale,
      profile.title
    ];
    const normalized = candidates
      .map((value) => normalizeGender(value))
      .find((value) => value);
    return normalized || null;
  }

  function extractDisplayName(profile) {
    if (!profile) {
      return null;
    }
    if (Array.isArray(profile)) {
      return extractDisplayName(profile[0]);
    }
    if (typeof profile === "string") {
      return profile.trim() || null;
    }

    const candidates = [
      profile.name,
      profile.display_name,
      profile.displayName,
      profile.employee_name,
      profile.user_name,
      profile.full_name,
      profile.fullName,
      profile.nickname,
      profile.user?.name,
      profile.user?.display_name,
      profile.employee?.name,
      profile.employee?.display_name
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
    return null;
  }

  function extractEmail(profile) {
    if (!profile) {
      return null;
    }
    const candidates = [
      profile.company_email,
      profile.email,
      profile.companyEmail,
      profile.user?.email,
      profile.employee?.email
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
    return null;
  }

  async function fetchSeatalkProfileViaMcp(event) {
    if (!seatalkMcpTools?.tools?.get_employee_profile) {
      return null;
    }

    const identity = getSeatalkIdentity(event);
    if (!identity.seatalk_id && !identity.employee_code && !identity.email) {
      return null;
    }

    const response = await seatalkMcpTools.tools.get_employee_profile({
      seatalk_id: identity.seatalk_id,
      employee_code: identity.employee_code,
      email: identity.email
    });
    if (!response) {
      return null;
    }
    if (response?.code !== 0) {
      return null;
    }

    const profile = response.employee || response.profile || response.data;
    return {
      name: extractDisplayName(profile),
      gender: extractGender(profile),
      email: extractEmail(profile)
    };
  }

  async function fetchSeatalkProfile(event) {
    if (shouldSkipProfileLookup()) {
      return null;
    }

    if (seatalkMcpTools) {
      try {
        const profile = await fetchSeatalkProfileViaMcp(event);
        if (profile?.name) {
          return profile;
        }
      } catch (error) {
        if (getSeatalkErrorCode(error) === 103) {
          disableProfileLookupTemporarily("permission_denied");
        }
        logger.warn("mcp_profile_lookup_failed", { error: error.message });
      }
    }

    if (!profileUrl) {
      return null;
    }

    const identity = getSeatalkIdentity(event);
    const payload = {};
    if (identity.seatalk_id) {
      payload.seatalk_id = identity.seatalk_id;
    }
    if (identity.employee_code) {
      payload.employee_code = identity.employee_code;
    }
    if (identity.email) {
      payload.email = identity.email;
    }

    if (!Object.keys(payload).length) {
      return null;
    }

    try {
      const response = await requestWithAuth(
        profileMethod,
        profileUrl,
        payload
      );
      const data = response.data?.data ?? response.data;
      return {
        name: extractDisplayName(data),
        gender: extractGender(data),
        email: extractEmail(data)
      };
    } catch (error) {
      if (getSeatalkErrorCode(error) === 103) {
        disableProfileLookupTemporarily("permission_denied");
      }
      logger.warn("seatalk_profile_lookup_failed", {
        error: error.response?.data || error.message
      });
      return null;
    }
  }

  async function getSeatalkProfileDetails(event) {
    const cacheKey = getProfileCacheKey(event);
    const cached = getCachedProfile(cacheKey);
    const identity = getSeatalkIdentity(event);

    if (cached?.name) {
      return {
        name: cached.name,
        gender: cached.gender,
        email: cached.email || identity.email || null
      };
    }

    const fetched = await fetchSeatalkProfile(event);
    if (fetched?.name) {
      const profile = {
        name: fetched.name,
        gender: fetched.gender,
        email: identity.email || null
      };
      cacheProfile(cacheKey, profile);
      return profile;
    }

    return {
      name: formatUserName(event),
      gender: null,
      email: identity.email || null
    };
  }

  async function buildGreeting(event) {
    const profile = await getSeatalkProfileDetails(event);
    const override = getGreetingOverride(profile);
    if (override) {
      return override;
    }

    const name = formatFirstName(profile.name);
    const title = getTitleForProfile(profile);
    const timeGreeting = getTimeOfDayGreeting();
    if (title) {
      return `Hello ${title} ${name} \u{1F44B} ${timeGreeting}!\nHow can I assist you today?`;
    }

    return `Hello ${name} \u{1F44B} ${timeGreeting}!\nHow can I assist you today?`;
  }

  return {
    buildGreeting,
    buildGreetingFromName,
    getSeatalkProfileDetails
  };
}

function loadGreetingOverrides(raw, logger) {
  const overrides = new Map();
  if (!raw) {
    return overrides;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return overrides;
    }
    Object.entries(parsed).forEach(([email, value]) => {
      const normalizedEmail = String(email || "").toLowerCase().trim();
      if (!normalizedEmail || !value || typeof value !== "object") {
        return;
      }
      overrides.set(normalizedEmail, {
        name: value.name || "",
        gender: value.gender || null,
        omitTimeGreeting: Boolean(value.omitTimeGreeting)
      });
    });
  } catch (error) {
    logger.warn("greeting_overrides_invalid", { error: error.message });
  }

  return overrides;
}

function normalizeGender(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "boolean") {
    return value ? "male" : "female";
  }

  const normalized = String(value).toLowerCase().trim();
  if (["m", "male", "man", "boy", "1"].includes(normalized)) {
    return "male";
  }
  if (["f", "female", "woman", "girl", "2"].includes(normalized)) {
    return "female";
  }

  if (normalized.includes("mr") || normalized.includes("sir")) {
    return "male";
  }
  if (normalized.includes("ms") || normalized.includes("mrs")) {
    return "female";
  }

  return null;
}

function toTitleCase(value) {
  return String(value)
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

module.exports = {
  createProfileService
};
