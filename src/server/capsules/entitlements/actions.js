import { kvs } from "@forge/kvs";

/**
 * Get the current request context (session)
 */
const loadSession = async (req) => {
  return req.context;
};

/**
 * Check if the app is licensed for the current installation
 */
const checkLicense = async (req) => {
  return { isLicensed: true };
};

/**
 * Check if steward override is enabled globally
 */
const stewardOverrideEnabled = async () => {
  const globalPolicy = await kvs.get("admin-settings-global");
  return {
    enabled: globalPolicy?.allowAdminOverride !== false,
  };
};

export const actions = [
  ["load-session", loadSession],
  ["check-license", checkLicense],
  ["steward-override-enabled", stewardOverrideEnabled],
];
